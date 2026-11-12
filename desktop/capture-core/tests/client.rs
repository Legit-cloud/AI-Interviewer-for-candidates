//! The live client against a small fake Vren server on this computer.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::{frame::coding::CloseCode, CloseFrame};
use tokio_tungstenite::tungstenite::Message;
use vren_capture_core::pcm::pcm_to_base64;
use vren_capture_core::protocol::{event_type, ClientMessage};
use vren_capture_core::{spawn, ClientHandle, Event, SessionConfig, Status};

type Seen = Arc<Mutex<Vec<serde_json::Value>>>;

fn config(port: u16) -> SessionConfig {
    SessionConfig {
        ws_url: format!("ws://127.0.0.1:{port}/v1/live/s?token=t"),
        role: "capture".into(),
        sources: vec!["tab".into(), "microphone".into()],
        room: false,
    }
}

fn collect() -> (impl Fn(Event) + Send + Sync + 'static, mpsc::UnboundedReceiver<Event>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (move |e| { let _ = tx.send(e); }, rx)
}

async fn next_status(rx: &mut mpsc::UnboundedReceiver<Event>, want: Status) {
    timeout(Duration::from_secs(10), async {
        while let Some(e) = rx.recv().await {
            if e.is_status(&want) {
                return;
            }
        }
        panic!("never saw {want:?}");
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {want:?}"));
}

trait IsStatus {
    fn is_status(&self, s: &Status) -> bool;
}
impl IsStatus for Event {
    fn is_status(&self, s: &Status) -> bool {
        matches!(self, Event::Status(x) if x == s)
    }
}

#[tokio::test]
async fn sends_configure_then_audio_in_order_and_ends_when_the_server_finalises() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen: Seen = Arc::default();
    let server_seen = seen.clone();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        ws.send(Message::Text(r#"{"event_id":"e1","type":"session.ready","role":"capture"}"#.into())).await.unwrap();
        while let Some(Ok(Message::Text(text))) = ws.next().await {
            let v: serde_json::Value = serde_json::from_str(&text).unwrap();
            let stop = v["type"] == "session.stop";
            server_seen.lock().unwrap().push(v);
            if stop {
                ws.send(Message::Text(r#"{"event_id":"e2","type":"session.finalized","retained_transcript":false}"#.into())).await.unwrap();
            }
        }
    });

    let (on_event, mut rx) = collect();
    let handle: ClientHandle = spawn(config(port), on_event);
    next_status(&mut rx, Status::Connected).await;
    for seq in 1..=3u64 {
        handle.send_audio("tab", seq, pcm_to_base64(&[seq as i16; 8]));
    }
    handle.send(ClientMessage::Pause {}).await;
    handle.send(ClientMessage::Resume {}).await;
    handle.send(ClientMessage::Stop {}).await;
    next_status(&mut rx, Status::Closed(None)).await;

    let seen = seen.lock().unwrap();
    let kinds: Vec<&str> = seen.iter().map(|v| v["type"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["session.configure", "audio.frame", "audio.frame", "audio.frame", "session.pause", "session.resume", "session.stop"]);
    assert_eq!(seen[0]["sources"], serde_json::json!(["tab", "microphone"]));
    assert_eq!(seen[0]["role"], "capture");
    let seqs: Vec<u64> = seen.iter().filter(|v| v["type"] == "audio.frame").map(|v| v["sequence"].as_u64().unwrap()).collect();
    assert_eq!(seqs, [1, 2, 3]);
    assert_eq!(seen[1]["sample_rate"], 16000);
}

#[tokio::test]
async fn server_events_reach_the_app() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        ws.send(Message::Text(r#"{"event_id":"e1","type":"answer.ready","answer":{"answer":"Hello"}}"#.into())).await.unwrap();
        tokio::time::sleep(Duration::from_secs(5)).await;
    });
    let (on_event, mut rx) = collect();
    let _handle = spawn(config(port), on_event);
    let got = timeout(Duration::from_secs(10), async {
        loop {
            if let Some(Event::Server(v)) = rx.recv().await {
                return v;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(event_type(&got), "answer.ready");
    assert_eq!(got["answer"]["answer"], "Hello");
}

#[tokio::test]
async fn a_refusal_from_the_server_is_final_and_is_not_retried() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let accepts = Arc::new(Mutex::new(0u32));
    let counted = accepts.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            *counted.lock().unwrap() += 1;
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let _ = ws.close(Some(CloseFrame { code: CloseCode::Library(4409), reason: "CAPTURE_CLIENT_ALREADY_CONNECTED".into() })).await;
        }
    });
    let (on_event, mut rx) = collect();
    let _handle = spawn(config(port), on_event);
    next_status(&mut rx, Status::Closed(Some("CAPTURE_CLIENT_ALREADY_CONNECTED".into()))).await;
    tokio::time::sleep(Duration::from_millis(1500)).await; // long enough for a wrongly retried connection
    assert_eq!(*accepts.lock().unwrap(), 1, "a refused client must not keep knocking");
}

#[tokio::test]
async fn a_dropped_connection_reconnects_and_asks_for_what_it_missed() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let queries: Arc<Mutex<Vec<String>>> = Arc::default();
    let seen_queries = queries.clone();
    tokio::spawn(async move {
        let mut n = 0;
        while let Ok((stream, _)) = listener.accept().await {
            n += 1;
            let q = seen_queries.clone();
            let mut ws = tokio_tungstenite::accept_hdr_async(stream, move |req: &Request, resp: Response| {
                q.lock().unwrap().push(req.uri().query().unwrap_or("").to_string());
                Ok(resp)
            })
            .await
            .unwrap();
            if n == 1 {
                ws.send(Message::Text(r#"{"event_id":"evt_first","type":"session.ready"}"#.into())).await.unwrap();
                tokio::time::sleep(Duration::from_millis(200)).await;
                drop(ws); // the network drops, no close frame
            } else {
                ws.send(Message::Text(r#"{"event_id":"evt_second","type":"session.ready"}"#.into())).await.unwrap();
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    });
    let (on_event, mut rx) = collect();
    let _handle = spawn(config(port), on_event);
    next_status(&mut rx, Status::Reconnecting).await;
    next_status(&mut rx, Status::Connected).await;
    let queries = queries.lock().unwrap();
    assert_eq!(queries.len(), 2);
    assert!(!queries[0].contains("last_event_id"));
    assert!(queries[1].contains("last_event_id=evt_first"), "second connection asked for: {}", queries[1]);
    assert!(queries[1].contains("token=t"));
}

#[tokio::test]
async fn slow_connections_drop_the_newest_audio_instead_of_waiting() {
    let (handle, mut rx) = ClientHandle::detached(2);
    for seq in 1..=5u64 {
        handle.send_audio("tab", seq, "AAAA".into());
    }
    assert_eq!(handle.dropped_frames(), 3);
    assert!(rx.recv().await.is_some() && rx.recv().await.is_some());
}

#[tokio::test]
async fn gives_up_cleanly_when_nothing_is_listening() {
    // nothing is listening on this port
    let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let (on_event, mut rx) = collect();
    let _handle = spawn(config(port), on_event);
    next_status(&mut rx, Status::Reconnecting).await; // it tries again before giving up
}
