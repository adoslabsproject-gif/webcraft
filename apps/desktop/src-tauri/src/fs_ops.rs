use std::path::Path;

/// Native file operations — bypass tauri-plugin-fs ACL.
///
/// The plugin-fs ACL is convenient for declaratively scoping web-facing
/// apps, but for a desktop IDE where the user has just picked a folder
/// via the OS file dialog, the only reasonable scope is "everything the
/// user can read". These commands serve that need.
///
/// Security note: invoke-handler runs in the renderer's IPC channel; the
/// renderer is sandboxed (CSP) and only ships our own bundle, so there is
/// no third-party code that could call these arbitrarily.

#[tauri::command]
pub async fn webcraft_read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub async fn webcraft_write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&path, content).await.map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[tauri::command]
pub async fn webcraft_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let mut rd = tokio::fs::read_dir(&path).await.map_err(|e| e.to_string())?;
    while let Some(e) = rd.next_entry().await.map_err(|e| e.to_string())? {
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        // metadata() follows symlinks; symlink_metadata() / file_type() do
        // not. pnpm node_modules entries are symlinks to dirs elsewhere —
        // we must follow them or click-to-open breaks with "is a directory".
        let is_directory = match tokio::fs::metadata(&p).await {
            Ok(meta) => meta.is_dir(),
            Err(_) => e
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false),
        };
        out.push(DirEntry {
            name,
            path: p.to_string_lossy().into_owned(),
            is_directory,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn webcraft_mkdir(path: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn webcraft_remove(path: String) -> Result<(), String> {
    let meta = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if meta.is_dir() {
        tokio::fs::remove_dir_all(&path).await.map_err(|e| e.to_string())
    } else {
        tokio::fs::remove_file(&path).await.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn webcraft_rename(from: String, to: String) -> Result<(), String> {
    tokio::fs::rename(&from, &to).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn webcraft_exists(path: String) -> Result<bool, String> {
    Ok(tokio::fs::try_exists(&path).await.unwrap_or(false))
}
