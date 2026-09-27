//! Path and environment resolution — the Rust port of `apps/desktop/config.ts`.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Roots the sidecar needs. Mirrors the `KORIS_APP_DIR` / `KORIS_DATA_DIR` split
/// the server expects (`core/src/config/index.ts:128-129`).
pub struct Paths {
    /// Read-only root holding `dist/`, `dist-web/`, `plugins/skills/`, `core/load/`.
    pub app_dir: PathBuf,
    /// Writable root for `koris.json`, `memory/`, `logs/`.
    pub data_dir: PathBuf,
    /// The compiled sidecar entry (`pnpm build:tauri` output).
    pub bootstrap: PathBuf,
}

/// `<repoRoot>` in dev. Baked at compile time: this crate lives at
/// `<repoRoot>/apps/tauri/src-tauri`, so the root is three directories up. The
/// built binary sits under `target/`, so a runtime `current_exe()` walk would
/// need a different depth — this is the stable one.
fn dev_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
}

pub fn resolve(app: &AppHandle) -> Result<Paths, String> {
    if tauri::is_dev() {
        let root = dev_repo_root();
        return Ok(Paths {
            app_dir: root.clone(),
            data_dir: root.clone(),
            bootstrap: root
                .join("apps")
                .join("tauri")
                .join("sidecar")
                .join("out")
                .join("bootstrap.js"),
        });
    }

    // Packaging is out of scope for this app (see apps/tauri/README.md), but the
    // seam is kept so wiring a bundle later is configuration, not a rewrite: the
    // server tree would ship as a resource and user data would live in appData.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("could not resolve the resource dir: {error}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve the app data dir: {error}"))?;

    Ok(Paths {
        app_dir: resource_dir.join("server"),
        data_dir,
        bootstrap: resource_dir.join("sidecar").join("bootstrap.js"),
    })
}

/// `1` forces devtools and dev behaviour. Same variable the Electron app reads,
/// so a single export covers both shells.
pub fn is_dev_mode() -> bool {
    tauri::is_dev() || std::env::var("KORIS_DESKTOP_DEV").as_deref() == Ok("1")
}
