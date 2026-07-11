/// WebCraft Node sidecar manager — spawns `packages/server/dist/sidecar.mjs`
/// on app boot, captures its ephemeral port from stdout, and exposes the
/// port to the renderer via `webcraft_sidecar_port` command.
///
/// Lifecycle:
///   - Spawned in setup() with --port 0 (kernel picks free port)
///   - First stdout line "SIDECAR_READY <port>" gives us the bound port
///   - On window CloseRequested we send SIGTERM (handled by on_window_event in lib.rs)
///   - If the binary exits unexpectedly, calls return 0 (renderer knows to retry)

use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::thread;

#[derive(Default)]
pub struct SidecarState {
    pub port: Arc<Mutex<u16>>,
    pub pid: Arc<Mutex<Option<u32>>>,
}

#[tauri::command]
pub fn webcraft_sidecar_port(state: tauri::State<SidecarState>) -> u16 {
    *state.port.lock().unwrap()
}

/// Locate the sidecar bundle. In dev we use the workspace path (cargo
/// runs from apps/desktop/src-tauri). In production we expect the bundle
/// next to the binary under Resources/.
fn sidecar_bundle_path() -> Option<std::path::PathBuf> {
    let candidates = [
        // dev: webcraft/apps/desktop/src-tauri → ../../packages/server/dist/sidecar.mjs
        "../../packages/server/dist/sidecar.mjs",
        "../../../packages/server/dist/sidecar.mjs",
        // production: alongside binary
        "resources/sidecar.mjs",
        "../Resources/sidecar.mjs",
    ];
    for c in candidates.iter() {
        let p = std::path::PathBuf::from(c);
        if p.exists() {
            return Some(p.canonicalize().unwrap_or(p));
        }
        // Also try relative to current_exe
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let p2 = parent.join(c);
                if p2.exists() {
                    return Some(p2.canonicalize().unwrap_or(p2));
                }
            }
        }
    }
    None
}

/// Find a usable `node` binary. We try PATH first, then common Homebrew /
/// nvm install paths because Tauri's spawn doesn't inherit shell PATH.
fn locate_node() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for c in candidates.iter() {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    // nvm: ~/.nvm/versions/node/<latest>/bin/node
    if let Some(home) = std::env::var_os("HOME") {
        let nvm = std::path::PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm) {
            let mut versions: Vec<_> = entries.flatten().collect();
            versions.sort_by_key(|e| e.file_name());
            if let Some(last) = versions.last() {
                let bin = last.path().join("bin/node");
                if bin.exists() {
                    return bin.to_str().map(String::from);
                }
            }
        }
    }
    Some("node".to_string())
}

pub fn spawn_sidecar(state: tauri::State<SidecarState>) {
    let bundle = match sidecar_bundle_path() {
        Some(p) => p,
        None => {
            eprintln!("[sidecar] bundle not found — LSP/RAG/MCP unavailable");
            return;
        }
    };
    let node = match locate_node() {
        Some(n) => n,
        None => {
            eprintln!("[sidecar] node binary not found");
            return;
        }
    };
    eprintln!("[sidecar] spawning {} {}", node, bundle.display());
    let child = Command::new(&node)
        .arg(bundle)
        .arg("--port")
        .arg("0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[sidecar] spawn failed: {}", e);
            return;
        }
    };
    *state.pid.lock().unwrap() = Some(child.id());
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    let port_handle = state.port.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if let Some(rest) = line.strip_prefix("SIDECAR_READY ") {
                if let Ok(p) = rest.trim().parse::<u16>() {
                    *port_handle.lock().unwrap() = p;
                    eprintln!("[sidecar] ready on 127.0.0.1:{}", p);
                }
            } else {
                eprintln!("[sidecar] {}", line);
            }
        }
    });
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            eprintln!("[sidecar:err] {}", line);
        }
    });

    // Reap child on process exit
    thread::spawn(move || {
        let _ = child.wait();
        eprintln!("[sidecar] exited");
    });
}
