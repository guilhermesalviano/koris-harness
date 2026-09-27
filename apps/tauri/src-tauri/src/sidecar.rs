//! Supervision of the Node child process that runs the koris server.
//!
//! The Electron app gets this for free — `apps/desktop/server-runtime.ts` just
//! `require()`s the server and calls `startServer()` in its own process. Rust
//! can't, so everything that call used to imply (lifetime, shutdown, log
//! plumbing, orphan safety) lives here instead.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::config::Paths;

/// Generous: first launch runs migrations, seeds default beats and syncs skills.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(60);
/// Matches the quit race in `apps/desktop/main.ts` — never let a stuck stop wedge the exit.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
/// Enough stderr to explain a startup crash on the error page without flooding it.
const STDERR_TAIL_LINES: usize = 20;

pub struct Sidecar {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct SidecarState(pub Mutex<Option<Sidecar>>);

/// `node`, unless `KORIS_NODE` points at a specific runtime.
fn node_command() -> String {
    std::env::var("KORIS_NODE").unwrap_or_else(|_| "node".to_string())
}

/// Spawn the bootstrap and block until it reports its port.
pub fn start(paths: &Paths) -> Result<(u16, Sidecar), String> {
    if !paths.bootstrap.exists() {
        return Err(format!(
            "Sidecar entry not found at {}.\nRun `pnpm build && pnpm build:tauri` first.",
            paths.bootstrap.display()
        ));
    }

    let mut child = Command::new(node_command())
        .arg(&paths.bootstrap)
        .env("KORIS_APP_DIR", &paths.app_dir)
        .env("KORIS_DATA_DIR", &paths.data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Could not spawn `{}`: {error}. Is Node on PATH?",
                node_command()
            )
        })?;

    let stdout = child.stdout.take().ok_or("child stdout was not piped")?;
    let stderr = child.stderr.take().ok_or("child stderr was not piped")?;
    let stdin = child.stdin.take();

    let tail = Arc::new(Mutex::new(Vec::<String>::new()));
    spawn_stderr_reader(stderr, Arc::clone(&tail));
    let handshake = spawn_stdout_reader(stdout);

    let sidecar = Sidecar { child, stdin };
    match handshake.recv_timeout(HANDSHAKE_TIMEOUT) {
        Ok(Ok(port)) => Ok((port, sidecar)),
        Ok(Err(message)) => Err(fail(sidecar, &message, &tail)),
        // The reader thread always reports before dropping its sender, so a
        // disconnect here means the thread itself died — treat it like a crash.
        Err(RecvTimeoutError::Disconnected) => Err(fail(sidecar, "", &tail)),
        Err(RecvTimeoutError::Timeout) => Err(fail(
            sidecar,
            &format!(
                "The server did not report a port within {}s.",
                HANDSHAKE_TIMEOUT.as_secs()
            ),
            &tail,
        )),
    }
}

/// Kill the half-started child, then compose the message shown on the error page.
fn fail(mut sidecar: Sidecar, message: &str, tail: &Arc<Mutex<Vec<String>>>) -> String {
    sidecar.stop();

    let mut out = if message.is_empty() {
        "The server exited before reporting a port.".to_string()
    } else {
        message.to_string()
    };

    let tail = tail.lock().unwrap_or_else(|error| error.into_inner());
    if !tail.is_empty() {
        out.push_str("\n\nLast output:\n");
        out.push_str(&tail.join("\n"));
    }
    out
}

fn spawn_stderr_reader(stderr: std::process::ChildStderr, tail: Arc<Mutex<Vec<String>>>) {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[koris-server] {line}");
            let mut tail = tail.lock().unwrap_or_else(|error| error.into_inner());
            if tail.len() == STDERR_TAIL_LINES {
                tail.remove(0);
            }
            tail.push(line);
        }
    });
}

/// Reads stdout forever, forwarding server logs and reporting the first
/// handshake line (`KORIS_PORT=` / `KORIS_ERROR=`) back to the caller.
fn spawn_stdout_reader(stdout: std::process::ChildStdout) -> mpsc::Receiver<Result<u16, String>> {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let mut announced = false;

        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !announced {
                if let Some(raw) = line.strip_prefix("KORIS_PORT=") {
                    announced = true;
                    let _ = tx.send(
                        raw.trim()
                            .parse::<u16>()
                            .map_err(|_| format!("Unparseable handshake line: {line}")),
                    );
                    continue;
                }
                if let Some(message) = line.strip_prefix("KORIS_ERROR=") {
                    announced = true;
                    let _ = tx.send(Err(message.to_string()));
                    continue;
                }
            }
            println!("[koris-server] {line}");
        }

        // stdout closed with no handshake: the child died during startup. An
        // empty message tells `fail` to lead with the stderr tail instead.
        if !announced {
            let _ = tx.send(Err(String::new()));
        }
    });

    rx
}

impl Sidecar {
    pub fn stop(&mut self) {
        // Ask politely first: the bootstrap calls the server's own stop(), which
        // closes the web server, channels, heartbeat and skill sync.
        if let Some(mut stdin) = self.stdin.take() {
            let _ = stdin.write_all(b"shutdown\n");
            let _ = stdin.flush();
            // Dropping stdin here also closes it, which is the bootstrap's EOF guard.
        }

        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }

        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Stop the managed sidecar, if one is running. Safe to call more than once.
pub fn stop(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(mut sidecar) = guard.take() {
        sidecar.stop();
    }
}
