/// WebCraft — Tauri 2 application entry.
///
/// Native modules:
///   pty.rs    — integrated terminal backend (portable-pty)
///   menu.rs   — native menu bar + accelerators (emits menu:* events)
///   fs_ops.rs — IDE-grade filesystem commands (bypass plugin-fs ACL)

mod fs_ops;
mod menu;
mod pty;
mod sidecar;

use fs_ops::{
    webcraft_exists, webcraft_mkdir, webcraft_read_dir, webcraft_read_file, webcraft_remove,
    webcraft_rename, webcraft_write_file,
};
use pty::{pty_input, pty_kill, pty_resize, pty_spawn, PtyState};
use sidecar::{webcraft_sidecar_port, SidecarState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Quit the whole app when the last window is closed. Default Tauri
        // behaviour keeps the binary running in background on macOS — that
        // wastes CPU (Vite/Cargo watchers) and heats the laptop up.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle().clone();
                app.exit(0);
            }
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(PtyState::default())
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_input,
            pty_resize,
            pty_kill,
            webcraft_read_file,
            webcraft_write_file,
            webcraft_read_dir,
            webcraft_mkdir,
            webcraft_remove,
            webcraft_rename,
            webcraft_exists,
            webcraft_sidecar_port,
        ])
        .setup(|app| {
            menu::install(app.handle())?;
            sidecar::spawn_sidecar(app.state::<SidecarState>());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WebCraft");
}
