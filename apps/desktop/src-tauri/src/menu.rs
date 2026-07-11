use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Build the native application menu (macOS top bar + Windows window menu)
/// and wire each item to a Tauri event the renderer listens to.
///
/// Convention: menu items emit events with stable ids like `menu:file:open`,
/// `menu:edit:find`, `menu:view:toggle-sidebar`. The renderer subscribes via
/// `listen('menu:...')`.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let about_meta = AboutMetadataBuilder::new()
        .name(Some("WebCraft".to_string()))
        .version(Some(env!("CARGO_PKG_VERSION").to_string()))
        .copyright(Some("© 2026 Nicola Cucurachi".to_string()))
        .website(Some("https://github.com/adoslabsproject-gif/webcraft".to_string()))
        .website_label(Some("Project repository".to_string()))
        .build();

    // ── WebCraft (app menu, macOS only — Windows ignores) ────────────────
    let app_menu = SubmenuBuilder::new(app, "WebCraft")
        .item(&PredefinedMenuItem::about(app, None, Some(about_meta))?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:app:settings", "Settings…")
            .accelerator("CmdOrCtrl+,")
            .build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // ── File ────────────────────────────────────────────────────────────
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("menu:file:open-folder", "Open Folder…")
            .accelerator("CmdOrCtrl+O")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:file:new", "New File")
            .accelerator("CmdOrCtrl+N")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:file:save", "Save")
            .accelerator("CmdOrCtrl+S")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:file:save-as", "Save As…")
            .accelerator("Shift+CmdOrCtrl+S")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:file:close-tab", "Close Tab")
            .accelerator("CmdOrCtrl+W")
            .build(app)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // ── Edit ────────────────────────────────────────────────────────────
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:edit:find", "Find")
            .accelerator("CmdOrCtrl+F")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:edit:replace", "Replace")
            .accelerator("CmdOrCtrl+H")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:edit:find-in-files", "Find in Files…")
            .accelerator("Shift+CmdOrCtrl+F")
            .build(app)?)
        .build()?;

    // ── View ────────────────────────────────────────────────────────────
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("menu:view:command-palette", "Command Palette…")
            .accelerator("Shift+CmdOrCtrl+P")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:view:explorer", "Explorer")
            .accelerator("Shift+CmdOrCtrl+E")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:view:search", "Search")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:view:git", "Source Control")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:view:chat", "AI Chat")
            .accelerator("CmdOrCtrl+L")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:view:db-studio", "DB Studio")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:view:dev-server", "Dev Server")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:view:terminal", "Toggle Terminal")
            .accelerator("CmdOrCtrl+`")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:view:diff", "Toggle Diff Stream")
            .build(app)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // ── Window ──────────────────────────────────────────────────────────
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .build()?;

    // ── Help ────────────────────────────────────────────────────────────
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("menu:help:docs", "Documentation")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("menu:help:keybindings", "Keyboard Shortcuts")
            .accelerator("CmdOrCtrl+K CmdOrCtrl+S")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:help:issue", "Report Issue")
            .build(app)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    app.set_menu(menu)?;

    let app_handle = app.clone();
    app.on_menu_event(move |_, event| {
        let id = event.id().as_ref().to_string();
        if id.starts_with("menu:") {
            let _ = app_handle.emit(&id, ());
        }
    });

    Ok(())
}
