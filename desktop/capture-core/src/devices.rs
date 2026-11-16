//! Sound devices. Needs the `audio` feature (cpal).
//!
//! * Windows: every output device can be captured as "system sound" (loopback), which is how a native Zoom or
//!   Teams call is heard.
//! * Linux: PulseAudio and PipeWire expose "Monitor of ..." inputs for the same purpose.
//! * macOS: the system does not allow capturing output directly. Install a virtual device such as BlackHole,
//!   send the call's sound to it, and pick it here as an input.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use serde::Serialize;
use std::sync::mpsc;
use std::thread;

use crate::pcm::Chunker;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DeviceInfo {
    /// Stable id: `input:<name>` or `loopback:<name>`.
    pub id: String,
    /// What to show the person.
    pub label: String,
    pub kind: String,
    pub is_default: bool,
    /// Looks like a way to hear the computer's own sound (monitor, loopback, BlackHole and similar).
    pub hears_system: bool,
}

fn looks_like_system_sound(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("monitor") || n.contains("blackhole") || n.contains("loopback") || n.contains("stereo mix") || n.contains("soundflower")
}

pub fn list_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    let default_in = host.default_input_device().and_then(|d| d.name().ok());
    let default_out = host.default_output_device().and_then(|d| d.name().ok());
    let mut out = Vec::new();

    if let Ok(inputs) = host.input_devices() {
        for d in inputs {
            if let Ok(name) = d.name() {
                let hears_system = looks_like_system_sound(&name);
                out.push(DeviceInfo {
                    id: format!("input:{name}"),
                    label: if hears_system { format!("Computer sound: {name}") } else { format!("Microphone: {name}") },
                    kind: "input".into(),
                    is_default: default_in.as_deref() == Some(name.as_str()),
                    hears_system,
                });
            }
        }
    }
    // Windows lets an output device be recorded as it plays.
    if cfg!(target_os = "windows") {
        if let Ok(outputs) = host.output_devices() {
            for d in outputs {
                if let Ok(name) = d.name() {
                    out.push(DeviceInfo {
                        id: format!("loopback:{name}"),
                        label: format!("Computer sound: {name}"),
                        kind: "loopback".into(),
                        is_default: default_out.as_deref() == Some(name.as_str()),
                        hears_system: true,
                    });
                }
            }
        }
    }
    out
}

/// A running capture. Dropping it (or calling `stop`) releases the device.
pub struct CaptureHandle {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl CaptureHandle {
    pub fn stop(&mut self) {
        if let Some(tx) = self.stop.take() {
            let _ = tx.send(());
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn plain_error(err: impl std::fmt::Display) -> String {
    format!("Could not listen to that device ({err}). Check that it is plugged in and that Vren AI is allowed to use the microphone in your system settings.")
}

/// Starts listening. `on_chunk` gets 250 ms of 16 kHz mono sound at a time, from the audio thread, so keep it quick.
pub fn start_capture<F>(device_id: &str, mut on_chunk: F) -> Result<CaptureHandle, String>
where
    F: FnMut(Vec<i16>) + Send + 'static,
{
    let (kind, name) = device_id.split_once(':').ok_or_else(|| "Unknown device.".to_string())?;
    let (kind, name) = (kind.to_string(), name.to_string());
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    // A cpal stream cannot move between threads on every system, so it lives on its own thread.
    let thread = thread::spawn(move || {
        let host = cpal::default_host();
        let found = if kind == "loopback" {
            host.output_devices().ok().and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(name.as_str())))
        } else {
            host.input_devices().ok().and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(name.as_str())))
        };
        let Some(device) = found else {
            let _ = ready_tx.send(Err("That device is not available any more. Pick another one.".into()));
            return;
        };
        let config = if kind == "loopback" { device.default_output_config() } else { device.default_input_config() };
        let config = match config {
            Ok(c) => c,
            Err(e) => {
                let _ = ready_tx.send(Err(plain_error(e)));
                return;
            }
        };
        let rate = config.sample_rate().0;
        let channels = config.channels();
        let mut chunker = Chunker::new(rate, channels);
        let err_fn = |e| eprintln!("sound stream error: {e}");
        let stream_config = config.clone().into();

        let built = match config.sample_format() {
            SampleFormat::F32 => device.build_input_stream(&stream_config, move |d: &[f32], _| {
                for chunk in chunker.push_f32(d) {
                    on_chunk(chunk);
                }
            }, err_fn, None),
            SampleFormat::I16 => device.build_input_stream(&stream_config, move |d: &[i16], _| {
                for chunk in chunker.push_i16(d) {
                    on_chunk(chunk);
                }
            }, err_fn, None),
            SampleFormat::U16 => device.build_input_stream(&stream_config, move |d: &[u16], _| {
                for chunk in chunker.push_u16(d) {
                    on_chunk(chunk);
                }
            }, err_fn, None),
            other => {
                let _ = ready_tx.send(Err(format!("This device uses a sound format Vren AI does not support yet ({other:?}).")));
                return;
            }
        };
        let stream = match built {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(plain_error(e)));
                return;
            }
        };
        if let Err(e) = stream.play() {
            let _ = ready_tx.send(Err(plain_error(e)));
            return;
        }
        let _ = ready_tx.send(Ok(()));
        let _ = stop_rx.recv(); // wait until asked to stop, then drop the stream
        drop(stream);
    });

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(CaptureHandle { stop: Some(stop_tx), thread: Some(thread) }),
        Ok(Err(message)) => Err(message),
        Err(_) => Err("The sound system did not start.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_sound_devices_are_recognised_by_name() {
        for n in ["Monitor of Built-in Audio", "BlackHole 2ch", "Stereo Mix (Realtek)", "CABLE Loopback"] {
            assert!(looks_like_system_sound(n), "{n}");
        }
        for n in ["MacBook Pro Microphone", "USB Headset"] {
            assert!(!looks_like_system_sound(n), "{n}");
        }
    }

    #[test]
    fn a_bad_device_id_is_refused_clearly() {
        assert!(start_capture("nonsense", |_| {}).is_err());
        let err = start_capture("input:definitely-not-a-device-xyz", |_| {}).err().unwrap_or_default();
        assert!(!err.is_empty());
    }
}
