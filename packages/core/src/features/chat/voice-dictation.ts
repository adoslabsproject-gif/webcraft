import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/// Voice dictation — LOCAL whisper STT running in the Rust core (sherpa-onnx
/// + cpal mic capture), NOT the Web Speech API: WKWebView (macOS) and
/// WebView2 (Windows) never implemented SpeechRecognition, so the old
/// browser-based path silently did nothing in packaged builds.
///
/// Flow: start() begins native mic capture; stop() ends it and transcribes
/// the whole utterance offline (whisper-small int8). The ~232MB model is
/// downloaded once from the WebCraft GitHub release at first use — progress
/// is surfaced through onStatus.

export interface Dictation {
  start: (lang?: string) => void;
  stop: () => void;
  destroy: () => void;
}

export interface DictationHandlers {
  onInterim: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
  /// Lifecycle messages worth showing near the mic button: model download
  /// progress ("Preparing voice model… 42%"), transcription in progress.
  onStatus?: (msg: string | null) => void;
}

/// Native STT is always available — the model downloads on demand.
export function isDictationSupported(): boolean {
  return true;
}

/// Map a BCP-47 tag ("it-IT", "en-US") to whisper's 2-letter code.
function whisperLang(tag: string | undefined): string {
  if (!tag) return '';
  return tag.slice(0, 2).toLowerCase();
}

export function createDictation(h: DictationHandlers): Dictation | null {
  let recording = false;
  let destroyed = false;
  let language = '';

  async function ensureModel(): Promise<boolean> {
    try {
      if (await invoke<boolean>('voice_stt_present')) return true;
    } catch (e) {
      h.onError(String(e));
      return false;
    }
    let unlisten: UnlistenFn | null = null;
    try {
      h.onStatus?.('Preparing voice model (one-time download)…');
      unlisten = await listen<{ downloaded: number; total: number; done: boolean }>(
        'stt-download-progress',
        (event) => {
          const { downloaded, total, done } = event.payload;
          if (done) h.onStatus?.('Extracting voice model…');
          else h.onStatus?.(`Downloading voice model… ${Math.round((downloaded / total) * 100)}%`);
        },
      );
      await invoke('voice_stt_download');
      h.onStatus?.(null);
      return true;
    } catch (e) {
      h.onStatus?.(null);
      h.onError(`Voice model download failed: ${String(e)}`);
      return false;
    } finally {
      unlisten?.();
    }
  }

  return {
    start(lang) {
      if (recording || destroyed) return;
      language = whisperLang(lang);
      void (async () => {
        if (!(await ensureModel()) || destroyed) {
          h.onEnd();
          return;
        }
        try {
          await invoke('voice_start');
          recording = true;
          h.onStatus?.('Listening…');
        } catch (e) {
          h.onError(String(e));
          h.onEnd();
        }
      })();
    },
    stop() {
      if (!recording) {
        h.onEnd();
        return;
      }
      recording = false;
      void (async () => {
        try {
          h.onStatus?.('Transcribing…');
          const text = await invoke<string>('voice_stop_transcribe', { language });
          h.onStatus?.(null);
          if (text) h.onFinal(text);
        } catch (e) {
          h.onStatus?.(null);
          h.onError(String(e));
        } finally {
          h.onEnd();
        }
      })();
    },
    destroy() {
      destroyed = true;
      if (recording) {
        recording = false;
        // Best-effort: stop the native capture, discard the transcript.
        void invoke('voice_stop_transcribe', { language }).catch(() => {});
      }
    },
  };
}
