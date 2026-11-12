//! Talks to a real Vren server: pairs with a code, sends a few seconds of tone as audio, then stops the session.
//!
//!     cargo run --example smoke -- http://localhost:8000 123456 [capture|display]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use vren_capture_core::pairing::{redeem, ws_url};
use vren_capture_core::pcm::{pcm_to_base64, Chunker};
use vren_capture_core::protocol::{event_type, ClientMessage};
use vren_capture_core::{spawn, Event, SessionConfig};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (server, code) = (args[1].clone(), args[2].clone());
    let role = args.get(3).cloned().unwrap_or_else(|| "capture".into());

    let paired = redeem(&server, &code, &role).await.expect("pairing failed");
    println!("paired with session {} ({})", paired.session_id, role);
    let url = ws_url(&server, &paired.ws_path, &paired.ws_token).unwrap();

    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let log = seen.clone();
    let handle = spawn(
        SessionConfig { ws_url: url, role: role.clone(), sources: vec!["tab".into()], room: false },
        move |e| match e {
            Event::Server(v) => log.lock().unwrap().push(event_type(&v).to_string()),
            Event::Status(s) => println!("status: {s:?}"),
        },
    );

    tokio::time::sleep(Duration::from_millis(800)).await;
    if role == "capture" {
        // 3 seconds of a 48 kHz stereo tone, converted exactly as the real capture does
        let mut chunker = Chunker::new(48_000, 2);
        let tone: Vec<f32> = (0..48_000 * 3).flat_map(|i| {
            let v = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48_000.0).sin() * 0.4;
            [v, v]
        }).collect();
        let mut seq = 0u64;
        for part in tone.chunks(4_800) {
            for chunk in chunker.push_f32(part) {
                seq += 1;
                handle.send_audio("tab", seq, pcm_to_base64(&chunk));
            }
        }
        println!("sent {seq} audio frames");
    }
    handle.send(ClientMessage::Pause {}).await;
    handle.send(ClientMessage::Resume {}).await;
    handle.send(ClientMessage::Stop {}).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    println!("server events: {:?}", seen.lock().unwrap());
}
