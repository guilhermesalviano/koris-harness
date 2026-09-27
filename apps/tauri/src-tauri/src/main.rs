// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod menu;
mod sidecar;
mod window;

use std::sync::{Arc, Mutex};

use tauri::{Manager, RunEvent};
use tauri_plugin_window_state::{StateFlags, WindowExt};

fn main() {
    let origin: window::Origin = Arc::new(Mutex::new(None));

    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch focuses the window we already have rather than
            // starting a second server (apps/desktop/main.ts:18-27).
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(sidecar::SidecarState::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            let dev = config::is_dev_mode();

            let menu = menu::build(&handle, dev)?;
            let win = window::create(&handle, Arc::clone(&origin), menu)?;
            let _ =
                win.restore_state(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED);

            // Boot the server off the main thread so the splash paints immediately.
            let origin = Arc::clone(&origin);
            std::thread::spawn(move || {
                let paths = match config::resolve(&handle) {
                    Ok(paths) => paths,
                    Err(message) => {
                        eprintln!("[koris-tauri] {message}");
                        window::show_error(&win, &message);
                        return;
                    }
                };

                match sidecar::start(&paths) {
                    Ok((port, child)) => {
                        let app_origin = format!("http://127.0.0.1:{port}");
                        println!("[koris-tauri] koris server ready at {app_origin}");

                        // Set before navigating: the guard must already accept
                        // the origin when the load starts.
                        *origin.lock().unwrap_or_else(|e| e.into_inner()) =
                            Some(app_origin.clone());
                        handle
                            .state::<sidecar::SidecarState>()
                            .0
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .replace(child);

                        window::show_app(&win, &app_origin, dev);
                    }
                    Err(message) => {
                        eprintln!("[koris-tauri] {message}");
                        window::show_error(&win, &message);
                    }
                }
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            let Some(win) = app.get_webview_window("main") else {
                return;
            };
            match event.id().as_ref() {
                menu::RELOAD_ID => {
                    let _ = win.eval("window.location.reload()");
                }
                menu::DEVTOOLS_ID =>
                {
                    #[cfg(any(debug_assertions, feature = "devtools"))]
                    if win.is_devtools_open() {
                        win.close_devtools();
                    } else {
                        win.open_devtools();
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the koris app")
        .run(|handle, event| {
            // The last chance to stop the child cleanly. Dropping its stdin on
            // the way out is the backstop if this never runs.
            if let RunEvent::Exit = event {
                sidecar::stop(handle);
            }
        });
}
