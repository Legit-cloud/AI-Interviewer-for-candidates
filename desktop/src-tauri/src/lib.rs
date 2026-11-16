//! The desktop app: two ordinary, visible windows.
//!
//! * `main` is where the person connects with the 6-digit code from the website and chooses what to listen to.
//! * `overlay` is a small answers box that stays on top. It can be dragged, resized and made click-through
//!   (Ctrl/Cmd+Shift+L toggles that). It is a normal window with the app's real name, so it is listed in the
//!   taskbar and can appear in a screen share. The app does not try to hide from screen capture or monitoring.
//!
//! Sound is captured and sent by `vren-capture-core`. This file only connects it to the windows.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use vren_capture_core::devices::{self, CaptureHandle, DeviceInfo};
use vren_capture_core::pairing;
use vren_capture_core::pcm::pcm_to_base64;
use vren_capture_core::protocol::{plain_reason, ClientMessage};
use vren_capture_core::{spawn, ClientHandle, Event, SessionConfig, Status};

#[derive(Default)]
struct AppState {
    client: Mutex<Option<ClientHandle>>,
    captures: Mutex<Vec<CaptureHandle>>,
    locked: Mutex<bool>,
}

#[derive(Serialize)]
struct PairedOut {
    session_id: String,
    ws_token: String,
    ws_path: String,
    job_title: String,
    company: String,
    ws_url: String,
}

#[derive(Deserialize)]
struct StartArgs {
    ws_url: String,
    /// Only show answers; never capture sound (another Vren app is the one listening).
    display_only: bool,
    /// Phone or in-person: the microphone hears the interviewer.
    room: bool,
    system_device: Option<String>,
    mic_device: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Wire {
    Server { event: serde_json::Value },
    Status { status: &'static str, detail: Option<String> },
}

#[tauri::command]
async fn redeem(server: String, code: String, role: String) -> Result<PairedOut, String> {
    let role = if role == "display" { "display" } else { "capture" };
    let server = pairing::normalize_server(&server).map_err(|e| e.to_string())?;
    let paired = pairing::redeem(&server, &code, role).await.map_err(|e| e.to_string())?;
    let ws_url = pairing::ws_url(&server, &paired.ws_path, &paired.ws_token).map_err(|e| e.to_string())?;
    Ok(PairedOut {
        session_id: paired.session_id,
        ws_token: paired.ws_token,
        ws_path: paired.ws_path,
        job_title: paired.job_title,
        company: paired.company,
        ws_url,
    })
}

#[tauri::command]
fn list_devices() -> Vec<DeviceInfo> {
    devices::list_devices()
}

fn emit_status(app: &AppHandle, status: &'static str, detail: Option<String>) {
    let _ = app.emit("vren://event", Wire::Status { status, detail });
}

#[tauri::command]
async fn start(app: AppHandle, state: State<'_, AppState>, args: StartArgs) -> Result<(), String> {
    stop_inner(&state, false).await;

    let mut sources: Vec<String> = Vec::new();
    if !args.display_only {
        if args.room {
            sources.push("microphone".into());
        } else {
            if args.system_device.is_some() {
                sources.push("tab".into());
            }
            if args.mic_device.is_some() {
                sources.push("microphone".into());
            }
        }
        if sources.is_empty() {
            return Err("Pick a sound to listen to first.".into());
        }
    }

    let events_app = app.clone();
    let handle = spawn(
        SessionConfig {
            ws_url: args.ws_url,
            role: if args.display_only { "display".into() } else { "capture".into() },
            sources: sources.clone(),
            room: args.room && !args.display_only,
        },
        move |event| match event {
            Event::Server(event) => {
                let _ = events_app.emit("vren://event", Wire::Server { event });
            }
            Event::Status(status) => match status {
                Status::Connecting => emit_status(&events_app, "connecting", None),
                Status::Connected => emit_status(&events_app, "connected", None),
                Status::Reconnecting => emit_status(&events_app, "reconnecting", None),
                Status::Closed(reason) => emit_status(&events_app, "closed", reason),
            },
        },
    );

    let mut captures = Vec::new();
    let wanted: Vec<(&str, Option<String>)> = if args.room {
        vec![("microphone", args.mic_device.clone())]
    } else {
        vec![("tab", args.system_device.clone()), ("microphone", args.mic_device.clone())]
    };
    if !args.display_only {
        for (source, device) in wanted {
            let Some(device) = device else { continue };
            let sender = handle.clone();
            let sequence = Arc::new(AtomicU64::new(0));
            let source_name = source.to_string();
            match devices::start_capture(&device, move |chunk| {
                let n = sequence.fetch_add(1, Ordering::Relaxed) + 1;
                sender.send_audio(&source_name, n, pcm_to_base64(&chunk));
            }) {
                Ok(c) => captures.push(c),
                Err(message) => {
                    // Release anything already started and tell the person why.
                    for mut c in captures {
                        c.stop();
                    }
                    handle.send(ClientMessage::Stop {}).await;
                    return Err(message);
                }
            }
        }
    }

    *state.captures.lock().unwrap() = captures;
    *state.client.lock().unwrap() = Some(handle);
    Ok(())
}

async fn stop_inner(state: &AppState, tell_server: bool) {
    let captures: Vec<CaptureHandle> = std::mem::take(&mut *state.captures.lock().unwrap());
    for mut c in captures {
        c.stop();
    }
    let client = state.client.lock().unwrap().take();
    if let Some(client) = client {
        if tell_server {
            client.send(ClientMessage::Stop {}).await;
        }
    }
}

#[tauri::command]
async fn stop(state: State<'_, AppState>) -> Result<(), String> {
    stop_inner(&state, true).await;
    Ok(())
}

#[tauri::command]
async fn pause(state: State<'_, AppState>) -> Result<(), String> {
    let client = state.client.lock().unwrap().clone();
    if let Some(c) = client {
        c.send(ClientMessage::Pause {}).await;
    }
    Ok(())
}

#[tauri::command]
async fn resume(state: State<'_, AppState>) -> Result<(), String> {
    let client = state.client.lock().unwrap().clone();
    if let Some(c) = client {
        c.send(ClientMessage::Resume {}).await;
    }
    Ok(())
}

#[tauri::command]
fn overlay_show(app: AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("overlay").ok_or("The answers box is missing.")?;
    w.show().map_err(|e| e.to_string())?;
    w.set_always_on_top(true).map_err(|e| e.to_string())
}

#[tauri::command]
fn overlay_hide(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn set_lock(app: &AppHandle, locked: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        w.set_ignore_cursor_events(locked).map_err(|e| e.to_string())?;
    }
    *app.state::<AppState>().locked.lock().unwrap() = locked;
    let _ = app.emit("vren://locked", locked);
    Ok(())
}

/// Locked means clicks pass through the box to whatever is behind it. Ctrl/Cmd+Shift+L unlocks it.
#[tauri::command]
fn overlay_lock(app: AppHandle, locked: bool) -> Result<(), String> {
    set_lock(&app, locked)
}

pub fn run() {
    let unlock = Shortcut::new(Some(Modifiers::SHIFT | Modifiers::CONTROL | Modifiers::SUPER), Code::KeyL);
    let unlock_ctrl = Shortcut::new(Some(Modifiers::SHIFT | Modifiers::CONTROL), Code::KeyL);
    let unlock_meta = Shortcut::new(Some(Modifiers::SHIFT | Modifiers::SUPER), Code::KeyL);
    let _ = unlock; // kept for clarity: the two real shortcuts are Ctrl+Shift+L and Cmd+Shift+L

    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let now_locked = *app.state::<AppState>().locked.lock().unwrap();
                        let _ = set_lock(app, !now_locked);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // If one of these is taken by another program, the app still works; the Lock button just cannot be undone by keys.
            let _ = app.global_shortcut().register(unlock_ctrl);
            let _ = app.global_shortcut().register(unlock_meta);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            redeem, list_devices, start, stop, pause, resume, overlay_show, overlay_hide, overlay_lock
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vren AI");
}

#[allow(dead_code)]
fn _plain(reason: &str) -> &'static str {
    plain_reason(reason)
}
