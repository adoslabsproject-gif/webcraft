use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use uuid::Uuid;

/// Integrated terminal PTY backend.
///
/// Each call to `pty_spawn` allocates a PTY pair, spawns the user's shell
/// inside it, and starts a reader thread that emits chunks of stdout as
/// Tauri events (`pty://output:<id>`). The renderer (xterm.js) consumes
/// those events and feeds keystrokes back via `pty_input`.

pub struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Arc<Mutex<PtyHandle>>>>,
}

#[derive(Serialize, Deserialize)]
pub struct SpawnArgs {
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub shell: Option<String>,
}

#[derive(Serialize)]
pub struct SpawnResult {
    pub id: String,
}

#[tauri::command]
pub fn pty_spawn<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PtyState>,
    args: SpawnArgs,
) -> Result<SpawnResult, String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            cols: args.cols.unwrap_or(120),
            rows: args.rows.unwrap_or(30),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = args.shell.unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(shell);
    if let Some(cwd) = &args.cwd {
        cmd.cwd(cwd);
    }
    // Ensure interactive shells emit a prompt
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let event_name = format!("pty://output:{}", id);

    {
        let app_for_reader = app.clone();
        let ev = event_name.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let _ = app_for_reader.emit(&ev, chunk);
                    }
                    Err(_) => break,
                }
            }
            let _ = app_for_reader.emit(&format!("pty://exit:{}", id), ());
        });
    }
    let _ = id; // borrow checker happiness

    let handle = PtyHandle {
        master: pair.master,
        writer,
        child,
    };

    let new_id = event_name
        .strip_prefix("pty://output:")
        .unwrap_or_default()
        .to_string();

    state
        .sessions
        .lock()
        .insert(new_id.clone(), Arc::new(Mutex::new(handle)));

    let _ = app.app_handle();
    Ok(SpawnResult { id: new_id })
}

#[tauri::command]
pub fn pty_input(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let session = sessions.get(&id).ok_or_else(|| "Session not found".to_string())?;
    let mut handle = session.lock();
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let session = sessions.get(&id).ok_or_else(|| "Session not found".to_string())?;
    let handle = session.lock();
    handle
        .master
        .resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(session) = sessions.remove(&id) {
        let mut handle = session.lock();
        let _ = handle.child.kill();
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

#[cfg(not(target_os = "windows"))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}
