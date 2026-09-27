//! Application menu — the Rust port of `apps/desktop/menu.ts`.
//!
//! Not cosmetic: without an Edit submenu carrying the standard accelerators,
//! Cmd+C / Cmd+V do not work at all in the chat input on macOS.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const RELOAD_ID: &str = "koris:reload";
pub const DEVTOOLS_ID: &str = "koris:devtools";

pub fn build<R: Runtime>(app: &AppHandle<R>, dev: bool) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    // macOS puts quit/about/services under the app menu; everywhere else File owns quit.
    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "koris",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        menu.append(&app_menu)?;
    }

    // Built branch-wise rather than with a `#[cfg]` inside the slice literal —
    // attributes on array elements aren't stable.
    let close = PredefinedMenuItem::close_window(app, None)?;
    #[cfg(target_os = "macos")]
    let file_menu = Submenu::with_items(app, "File", true, &[&close])?;
    #[cfg(not(target_os = "macos"))]
    let file_menu = {
        let quit = PredefinedMenuItem::quit(app, None)?;
        Submenu::with_items(app, "File", true, &[&close, &quit])?
    };

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    // Tauri has no predefined reload/devtools items the way Electron's viewMenu
    // role does, so these are custom and handled in `main.rs`.
    let reload = MenuItem::with_id(app, RELOAD_ID, "Reload", true, Some("CmdOrCtrl+R"))?;
    let view_menu = if dev {
        let devtools = MenuItem::with_id(
            app,
            DEVTOOLS_ID,
            "Toggle Developer Tools",
            true,
            Some("CmdOrCtrl+Shift+I"),
        )?;
        Submenu::with_items(app, "View", true, &[&reload, &devtools])?
    } else {
        Submenu::with_items(app, "View", true, &[&reload])?
    };

    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    menu.append(&view_menu)?;

    Ok(menu)
}
