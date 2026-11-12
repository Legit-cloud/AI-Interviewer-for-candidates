//! The live-session client: one WebSocket to the Vren server that sends audio up and brings events back.
//! It reconnects by itself (asking the server to replay what was missed) unless the server says it will not
//! take us back (session ended, another app is listening, and so on).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::time::{interval, sleep, Instant, MissedTickBehavior};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::protocol::{event_id, event_type, is_final_close, ClientMessage, ServerEvent, CLIENT_VERSION};

const MAX_RECONNECTS: u32 = 6;
const HEARTBEAT: Duration = Duration::from_secs(20);
const STOP_GRACE: Duration = Duration::from_secs(3);
const QUEUE: usize = 128;

#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    Connecting,
    Connected,
    Reconnecting,
    /// Closed for good. The text is the server's reason, if it gave one.
    Closed(Option<String>),
}

#[derive(Debug, Clone)]
pub enum Event {
    Server(ServerEvent),
    Status(Status),
}

#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub ws_url: String,
    pub role: String,
    pub sources: Vec<String>,
    /// Phone or in-person interview: the microphone hears the interviewer.
    pub room: bool,
}

/// What the rest of the app holds. Sending audio never waits: if the connection is slow the newest frames are dropped.
#[derive(Clone)]
pub struct ClientHandle {
    tx: mpsc::Sender<ClientMessage>,
    dropped: Arc<AtomicU64>,
}

impl ClientHandle {
    pub fn send_audio(&self, source: &str, sequence: u64, payload: String) {
        if self.tx.try_send(ClientMessage::audio(source, sequence, payload)).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub async fn send(&self, message: ClientMessage) {
        let _ = self.tx.send(message).await;
    }

    /// Audio frames dropped because the connection could not keep up.
    pub fn dropped_frames(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }

    #[doc(hidden)]
    pub fn detached(capacity: usize) -> (Self, mpsc::Receiver<ClientMessage>) {
        let (tx, rx) = mpsc::channel(capacity);
        (Self { tx, dropped: Arc::new(AtomicU64::new(0)) }, rx)
    }
}

pub fn spawn<F>(config: SessionConfig, on_event: F) -> ClientHandle
where
    F: Fn(Event) + Send + Sync + 'static,
{
    let (handle, rx) = ClientHandle::detached(QUEUE);
    tokio::spawn(run(config, rx, Arc::new(on_event)));
    handle
}

enum Outcome {
    /// We are finished (stopped or the session ended).
    Done,
    /// The connection dropped; try again.
    Lost,
    /// The server will not take us back.
    Refused(String),
}

fn url_with_replay(base: &str, last_event_id: &Option<String>) -> String {
    match (url::Url::parse(base), last_event_id) {
        (Ok(mut url), Some(id)) => {
            url.query_pairs_mut().append_pair("last_event_id", id);
            url.to_string()
        }
        _ => base.to_string(),
    }
}

async fn run(config: SessionConfig, mut rx: mpsc::Receiver<ClientMessage>, on_event: Arc<dyn Fn(Event) + Send + Sync>) {
    let mut last_event_id: Option<String> = None;
    let mut attempts = 0u32;
    let mut finished = false;

    loop {
        on_event(Event::Status(if attempts == 0 { Status::Connecting } else { Status::Reconnecting }));
        if let Ok((ws, _)) = connect_async(url_with_replay(&config.ws_url, &last_event_id)).await {
            attempts = 0;
            on_event(Event::Status(Status::Connected));
            match session(ws, &config, &mut rx, &mut last_event_id, &mut finished, &on_event).await {
                Outcome::Done => {
                    on_event(Event::Status(Status::Closed(None)));
                    return;
                }
                Outcome::Refused(reason) => {
                    on_event(Event::Status(Status::Closed(Some(reason))));
                    return;
                }
                Outcome::Lost => {}
            }
        }
        if finished {
            on_event(Event::Status(Status::Closed(None)));
            return;
        }
        attempts += 1;
        if attempts > MAX_RECONNECTS {
            on_event(Event::Status(Status::Closed(None)));
            return;
        }
        on_event(Event::Status(Status::Reconnecting));
        sleep(Duration::from_millis((1000u64 << (attempts - 1)).min(8000))).await;
    }
}

async fn session<S>(
    ws: tokio_tungstenite::WebSocketStream<S>,
    config: &SessionConfig,
    rx: &mut mpsc::Receiver<ClientMessage>,
    last_event_id: &mut Option<String>,
    finished: &mut bool,
    on_event: &Arc<dyn Fn(Event) + Send + Sync>,
) -> Outcome
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut write, mut read) = ws.split();
    let hello = ClientMessage::Configure {
        role: config.role.clone(),
        sources: config.sources.clone(),
        room: config.room,
        client_version: CLIENT_VERSION.to_string(),
    };
    if send(&mut write, &hello).await.is_err() {
        return Outcome::Lost;
    }

    let mut beat = interval(HEARTBEAT);
    beat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    beat.tick().await; // the first tick is immediate
    let mut stop_deadline: Option<Instant> = None;

    loop {
        let grace = async {
            match stop_deadline {
                Some(deadline) => sleep(deadline.saturating_duration_since(Instant::now())).await,
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            incoming = read.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    let Ok(event) = serde_json::from_str::<ServerEvent>(&text) else { continue };
                    if let Some(id) = event_id(&event) {
                        *last_event_id = Some(id.to_string());
                    }
                    let kind = event_type(&event).to_string();
                    on_event(Event::Server(event));
                    if kind == "session.finalized" || kind == "session.expired" {
                        *finished = true;
                        let _ = write.send(Message::Close(None)).await;
                        return Outcome::Done;
                    }
                }
                Some(Ok(Message::Close(frame))) => {
                    if let Some(frame) = frame {
                        let code: u16 = frame.code.into();
                        if is_final_close(code) {
                            return Outcome::Refused(frame.reason.to_string());
                        }
                    }
                    return if *finished { Outcome::Done } else { Outcome::Lost };
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => return if *finished { Outcome::Done } else { Outcome::Lost },
            },
            outgoing = rx.recv() => match outgoing {
                Some(message) => {
                    let is_stop = matches!(message, ClientMessage::Stop {});
                    if send(&mut write, &message).await.is_err() {
                        return Outcome::Lost;
                    }
                    if is_stop {
                        stop_deadline = Some(Instant::now() + STOP_GRACE); // give the server a moment to finish the session
                    }
                }
                None => {
                    let _ = write.send(Message::Close(None)).await;
                    return Outcome::Done;
                }
            },
            _ = beat.tick() => {
                if send(&mut write, &ClientMessage::Heartbeat {}).await.is_err() {
                    return Outcome::Lost;
                }
            }
            _ = grace => {
                let _ = write.send(Message::Close(None)).await;
                return Outcome::Done;
            }
        }
    }
}

async fn send<W>(write: &mut W, message: &ClientMessage) -> Result<(), ()>
where
    W: futures_util::Sink<Message> + Unpin,
{
    let text = serde_json::to_string(message).map_err(|_| ())?;
    write.send(Message::Text(text)).await.map_err(|_| ())
}
