//! Voice dictation — local whisper STT via sherpa-onnx (same stack as the
//! Liara app: cpal mic capture on a dedicated thread + whisper-small int8).
//!
//! The model is NOT bundled (keeps the installers light): it is downloaded
//! on-demand from the WebCraft GitHub release `stt-models-v1` at first mic
//! use, sha256-verified and extracted under app-data/models/stt. Fully
//! offline afterwards — no cloud STT, works identically on macOS/Windows/
//! Linux because the webview's (absent) SpeechRecognition API is not used.

use sha2::{Digest, Sha256};
use sherpa_rs::whisper::{WhisperConfig, WhisperRecognizer};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const MODEL_URL: &str = "https://github.com/adoslabsproject-gif/webcraft/releases/download/stt-models-v1/webcraft-stt-whisper-small-v1.zip";
const MODEL_SHA256: &str = "a4a27e323dfc1b0986d762367c156c0789391ae577f4f34eac837556195ec10b";
const MODEL_BYTES: u64 = 232_435_304;
const MODEL_DIR: &str = "sherpa-onnx-whisper-small";

fn stt_base(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("models")
        .join("stt");
    Ok(dir)
}

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(stt_base(app)?.join(MODEL_DIR))
}

/// Push-to-talk recording session: click to record, click again to stop and
/// transcribe. The cpal stream (not Send on all platforms) lives entirely on
/// its own thread; samples are downmixed to mono f32 as they arrive.
pub struct RecState {
    active: AtomicBool,
    rate: AtomicU32,
    buffer: Mutex<Vec<f32>>,
}
impl Default for RecState {
    fn default() -> Self {
        Self {
            active: AtomicBool::new(false),
            rate: AtomicU32::new(16000),
            buffer: Mutex::new(Vec::new()),
        }
    }
}

/// Whisper recognizer cache — construction loads ~350MB of weights, so the
/// instance is built once and reused. Keyed by language: switching the UI
/// language rebuilds the recognizer.
struct Stt {
    language: String,
    inner: WhisperRecognizer,
}
impl Stt {
    fn load(dir: &PathBuf, language: &str) -> Result<Self, String> {
        if !dir.exists() {
            return Err(format!("STT model not found in {}", dir.display()));
        }
        let s = |p: PathBuf| p.to_string_lossy().into_owned();
        let cfg = WhisperConfig {
            encoder: s(dir.join("small-encoder.int8.onnx")),
            decoder: s(dir.join("small-decoder.int8.onnx")),
            tokens: s(dir.join("small-tokens.txt")),
            language: language.to_string(),
            ..Default::default()
        };
        Ok(Self {
            language: language.to_string(),
            inner: WhisperRecognizer::new(cfg).map_err(|e| format!("STT load: {e}"))?,
        })
    }
}

pub struct VoiceState {
    rec: Arc<RecState>,
    stt: Arc<Mutex<Option<Stt>>>,
    downloading: AtomicBool,
}
impl Default for VoiceState {
    fn default() -> Self {
        Self {
            rec: Arc::new(RecState::default()),
            stt: Arc::new(Mutex::new(None)),
            downloading: AtomicBool::new(false),
        }
    }
}

/// True when the whisper model files are already on disk.
#[tauri::command]
pub fn voice_stt_present(app: AppHandle) -> bool {
    model_dir(&app)
        .map(|d| d.join("small-encoder.int8.onnx").exists())
        .unwrap_or(false)
}

/// Download + verify + extract the STT model (one-time, ~232MB). Emits
/// `stt-download-progress` {downloaded, total, done} on the given window.
/// Idempotent; refuses concurrent downloads.
#[tauri::command]
pub async fn voice_stt_download(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, VoiceState>,
) -> Result<(), String> {
    if voice_stt_present(app.clone()) {
        return Ok(());
    }
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("model download already in progress".into());
    }
    // Release the busy flag on every exit path (the flag lives in managed
    // state, so it is re-fetched from the AppHandle after the blocking task).
    let downloading_release = {
        let app = app.clone();
        move || {
            if let Some(s) = app.try_state::<VoiceState>() {
                s.downloading.store(false, Ordering::SeqCst);
            }
        }
    };

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let base = stt_base(&app)?;
        std::fs::create_dir_all(&base).map_err(|e| format!("mkdir: {e}"))?;
        let zip_path = base.join("stt-model.zip.part");

        // Download with progress.
        let resp = ureq::get(MODEL_URL)
            .call()
            .map_err(|e| format!("download: {e}"))?;
        let total = resp
            .header("Content-Length")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(MODEL_BYTES);
        let mut reader = resp.into_reader();
        let mut out = std::fs::File::create(&zip_path).map_err(|e| format!("create: {e}"))?;
        let mut hasher = Sha256::new();
        let mut downloaded: u64 = 0;
        let mut last_emit: u64 = 0;
        let mut buf = [0u8; 65536];
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("read: {e}"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| format!("write: {e}"))?;
            hasher.update(&buf[..n]);
            downloaded += n as u64;
            // Throttle progress events to ~every 1MB.
            if downloaded - last_emit >= 1_048_576 {
                last_emit = downloaded;
                let _ = window.emit(
                    "stt-download-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total, "done": false }),
                );
            }
        }
        drop(out);

        let digest = format!("{:x}", hasher.finalize());
        if digest != MODEL_SHA256 {
            let _ = std::fs::remove_file(&zip_path);
            return Err(format!("sha256 mismatch: got {digest}"));
        }

        // Extract (anti zip-slip via enclosed_name), then drop the zip.
        let file = std::fs::File::open(&zip_path).map_err(|e| format!("open zip: {e}"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("read zip: {e}"))?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| format!("entry {i}: {e}"))?;
            let Some(rel) = entry.enclosed_name() else { continue };
            let out_path = base.join(rel);
            if entry.is_dir() {
                std::fs::create_dir_all(&out_path).map_err(|e| format!("mkdir: {e}"))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
                }
                let mut outf =
                    std::fs::File::create(&out_path).map_err(|e| format!("create {out_path:?}: {e}"))?;
                std::io::copy(&mut entry, &mut outf).map_err(|e| format!("extract: {e}"))?;
            }
        }
        let _ = std::fs::remove_file(&zip_path);
        let _ = window.emit(
            "stt-download-progress",
            serde_json::json!({ "downloaded": total, "total": total, "done": true }),
        );
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?;

    downloading_release();
    result
}

/// Start capturing from the default microphone until `voice_stop_transcribe`.
#[tauri::command]
pub fn voice_start(state: State<'_, VoiceState>) -> Result<(), String> {
    let rec = state.rec.clone();
    if rec.active.swap(true, Ordering::SeqCst) {
        return Ok(()); // already recording
    }
    rec.buffer.lock().unwrap().clear();
    std::thread::spawn(move || {
        let cleanup = rec.clone();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
            let stop = |s: &RecState| s.active.store(false, Ordering::SeqCst);
            let host = cpal::default_host();
            let Some(device) = host.default_input_device() else { return stop(&rec) };
            let Ok(config) = device.default_input_config() else { return stop(&rec) };
            rec.rate.store(config.sample_rate().0, Ordering::SeqCst);
            let channels = (config.channels() as usize).max(1);
            let st = rec.clone();
            let err_fn = |e| eprintln!("microphone error: {e}");
            let built = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &_| {
                        if !st.active.load(Ordering::Relaxed) {
                            return;
                        }
                        let mut g = st.buffer.lock().unwrap();
                        for frame in data.chunks(channels) {
                            g.push(frame.iter().sum::<f32>() / channels as f32);
                        }
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &_| {
                        if !st.active.load(Ordering::Relaxed) {
                            return;
                        }
                        let mut g = st.buffer.lock().unwrap();
                        for frame in data.chunks(channels) {
                            g.push(
                                frame.iter().map(|&x| x as f32 / 32768.0).sum::<f32>()
                                    / channels as f32,
                            );
                        }
                    },
                    err_fn,
                    None,
                ),
                _ => return stop(&rec),
            };
            let Ok(stream) = built else { return stop(&rec) };
            if stream.play().is_err() {
                return stop(&rec);
            }
            // Hold the stream alive on this thread until released.
            while rec.active.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            drop(stream);
        }));
        cleanup.active.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// Stop the recording and transcribe what was captured. `language` is a
/// whisper 2-letter code ("en", "it", …); pass "" for auto-detect.
#[tauri::command]
pub async fn voice_stop_transcribe(
    app: AppHandle,
    state: State<'_, VoiceState>,
    language: String,
) -> Result<String, String> {
    let rec = state.rec.clone();
    let stt_slot = state.stt.clone();
    let dir = model_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        rec.active.store(false, Ordering::SeqCst);
        // Let the capture thread flush and drop the stream.
        std::thread::sleep(std::time::Duration::from_millis(90));
        let mut samples = std::mem::take(&mut *rec.buffer.lock().unwrap());
        let rate = rec.rate.load(Ordering::SeqCst);
        if samples.len() < (rate as usize) / 4 {
            return Ok(String::new()); // < ~0.25s of audio → ignore
        }
        // Trailing silence helps whisper close the last word cleanly.
        samples.extend(std::iter::repeat(0.0f32).take((rate as usize) * 3 / 5));
        let mut g = stt_slot.lock().unwrap();
        let needs_load = match g.as_ref() {
            Some(stt) => stt.language != language,
            None => true,
        };
        if needs_load {
            *g = Some(Stt::load(&dir, &language)?);
        }
        let stt = g.as_mut().expect("stt loaded above");
        Ok(stt.inner.transcribe(rate, &samples).text.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
