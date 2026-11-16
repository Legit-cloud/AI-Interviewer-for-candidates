#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use std::{thread, time::Duration};
use tauri::{Manager, Window};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowDisplayAffinity, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

/// Applies WDA_EXCLUDEFROMCAPTURE to the overlay and reads it back so we know
/// whether Windows actually accepted it. Returns the affinity value read back.
#[cfg(target_os = "windows")]
fn exclude_from_capture(window: &Window, enable: bool) -> Result<u32, String> {
    // Tauri's own content-protection path (tao calls SetWindowDisplayAffinity).
    let _ = window.set_content_protected(enable);

    let raw = window.hwnd().map_err(|e| format!("hwnd unavailable: {e}"))?;
    let hwnd = HWND(raw.0 as isize);
    let wanted = if enable { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };

    unsafe {
        if let Err(err) = SetWindowDisplayAffinity(hwnd, wanted) {
            return Err(format!("SetWindowDisplayAffinity failed: {err:?}"));
        }
        let mut current: u32 = 0;
        GetWindowDisplayAffinity(hwnd, &mut current)
            .map_err(|e| format!("GetWindowDisplayAffinity failed: {e:?}"))?;
        if current != wanted.0 {
            return Err(format!(
                "affinity not applied (wanted 0x{:X}, got 0x{:X})",
                wanted.0, current
            ));
        }
        Ok(current)
    }
}

#[cfg(not(target_os = "windows"))]
fn exclude_from_capture(window: &Window, enable: bool) -> Result<u32, String> {
    window
        .set_content_protected(enable)
        .map(|_| 1)
        .map_err(|e| e.to_string())
}

/// Retries the exclusion on the main thread until DWM accepts it. Calling it
/// once in `.setup()` can fail because the window is not mapped yet.
fn enforce_capture_exclusion(window: Window) {
    thread::spawn(move || {
        for attempt in 1..=20 {
            let (tx, rx) = std::sync::mpsc::channel();
            let w = window.clone();
            let _ = window.run_on_main_thread(move || {
                let _ = tx.send(exclude_from_capture(&w, true));
            });
            match rx.recv_timeout(Duration::from_secs(2)) {
                Ok(Ok(_)) => {
                    println!("[stealth] capture exclusion active (attempt {attempt})");
                    return;
                }
                Ok(Err(e)) => eprintln!("[stealth] attempt {attempt}: {e}"),
                Err(_) => eprintln!("[stealth] attempt {attempt}: main thread timeout"),
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
}

/// Called from React. Returns a short status string so the UI can show
/// whether the overlay is really hidden from screen capture.
#[tauri::command]
fn apply_stealth(
    window: Window,
    enable_capture_exclude: bool,
    ignore_mouse: bool,
) -> Result<String, String> {
    window
        .set_ignore_cursor_events(ignore_mouse)
        .map_err(|e| format!("click-through failed: {e}"))?;
    let affinity = exclude_from_capture(&window, enable_capture_exclude)?;
    Ok(format!("affinity=0x{affinity:X}"))
}

#[tauri::command]
fn set_click_through(window: Window, ignore: bool) -> Result<String, String> {
    apply_stealth(window, true, ignore)
}

#[tauri::command]
fn close_app(window: Window) {
    let _ = window.close();
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_window("main") {
                enforce_capture_exclusion(window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![apply_stealth, set_click_through, close_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
