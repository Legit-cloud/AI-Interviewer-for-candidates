// Hides the extra console window on Windows release builds. The window is an ordinary, visible app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vren_ai_desktop_lib::run()
}
