//! Window creation, navigation policy and the splash → app → error transitions.
//! Rust port of `apps/desktop/window.ts`.

use std::sync::{Arc, Mutex};

use tauri::menu::Menu;
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;
use url::{form_urlencoded, Url};

/// The dashboard origin isn't known until the sidecar reports its port, so the
/// navigation guard reads it through here. Mirrors `appOrigin` in `window.ts`.
pub type Origin = Arc<Mutex<Option<String>>>;

pub fn create(app: &AppHandle, origin: Origin, menu: Menu<Wry>) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();

    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("koris")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .background_color(tauri::window::Color(0x0e, 0x0e, 0x10, 0xff))
        .menu(menu)
        .on_navigation(move |url| {
            if is_internal(url, &origin) {
                return true;
            }
            // Anything else is a link out of the app: hand it to the OS browser
            // and refuse the navigation, exactly like setWindowOpenHandler +
            // will-navigate do in the Electron shell.
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = handle.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()
}

fn is_internal(url: &Url, origin: &Origin) -> bool {
    // The bundled splash/error pages: `tauri://localhost` on Linux and macOS,
    // `http://tauri.localhost` on Windows.
    if url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || matches!(url.scheme(), "data" | "blob")
    {
        return true;
    }

    match origin.lock() {
        Ok(guard) => guard
            .as_deref()
            .is_some_and(|app_origin| url.as_str().starts_with(app_origin)),
        Err(_) => false,
    }
}

/// Swap the splash for the running dashboard.
pub fn show_app(window: &WebviewWindow, origin: &str, dev: bool) {
    if let Ok(url) = Url::parse(origin) {
        let _ = window.navigate(url);
    }

    if dev {
        #[cfg(any(debug_assertions, feature = "devtools"))]
        window.open_devtools();
    }
}

/// Replace the splash with the startup-failure page.
pub fn show_error(window: &WebviewWindow, message: &str) {
    let encoded: String = form_urlencoded::byte_serialize(message.as_bytes()).collect();
    let target = window
        .url()
        .ok()
        .and_then(|base| base.join(&format!("error.html?message={encoded}")).ok());

    if let Some(url) = target {
        let _ = window.navigate(url);
    }
}
