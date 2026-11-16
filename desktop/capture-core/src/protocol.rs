//! The messages of the Vren live socket. They match the extension and the server.

use serde::Serialize;
use serde_json::Value;

pub const CLIENT_VERSION: &str = concat!("desktop-", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "session.configure")]
    Configure { role: String, sources: Vec<String>, room: bool, client_version: String },
    #[serde(rename = "audio.frame")]
    AudioFrame { source: String, sequence: u64, sample_rate: u32, channels: u8, payload: String },
    #[serde(rename = "client.heartbeat")]
    Heartbeat {},
    #[serde(rename = "session.pause")]
    Pause {},
    #[serde(rename = "session.resume")]
    Resume {},
    #[serde(rename = "session.stop")]
    Stop {},
    #[serde(rename = "image.ask")]
    ImageAsk { image: String, mime: String },
}

impl ClientMessage {
    pub fn audio(source: &str, sequence: u64, payload: String) -> Self {
        Self::AudioFrame { source: source.to_string(), sequence, sample_rate: 16_000, channels: 1, payload }
    }
}

/// What the server tells us. Kept as JSON so new fields never break the app.
pub type ServerEvent = Value;

pub fn event_type(event: &ServerEvent) -> &str {
    event.get("type").and_then(Value::as_str).unwrap_or("")
}

pub fn event_id(event: &ServerEvent) -> Option<&str> {
    event.get("event_id").and_then(Value::as_str)
}

/// The server closes with a 44xx code when it will not take us back: ended, expired, revoked, or another app is listening.
pub fn is_final_close(code: u16) -> bool {
    (4400..4500).contains(&code)
}

/// The same short, plain wording the extension uses.
pub fn plain_reason(reason: &str) -> &'static str {
    match reason {
        "CAPTURE_CLIENT_ALREADY_CONNECTED" => "Another Vren app is already listening to this session.",
        "PAIRING_REVOKED" => "You were disconnected from the website.",
        "SESSION_ENDED" => "This session has ended.",
        "SESSION_EXPIRED" => "This session ran out of time.",
        _ => "The connection closed.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_serialise_the_way_the_server_reads_them() {
        let json = serde_json::to_value(ClientMessage::Configure {
            role: "capture".into(),
            sources: vec!["tab".into(), "microphone".into()],
            room: false,
            client_version: "x".into(),
        })
        .unwrap();
        assert_eq!(json["type"], "session.configure");
        assert_eq!(json["sources"][1], "microphone");
        assert_eq!(serde_json::to_value(ClientMessage::Stop {}).unwrap()["type"], "session.stop");
        let frame = serde_json::to_value(ClientMessage::audio("tab", 7, "AAAA".into())).unwrap();
        assert_eq!((frame["type"].as_str(), frame["sequence"].as_u64(), frame["sample_rate"].as_u64()), (Some("audio.frame"), Some(7), Some(16000)));
    }

    #[test]
    fn only_44xx_closes_are_final() {
        assert!(is_final_close(4409) && is_final_close(4403) && is_final_close(4408));
        assert!(!is_final_close(1006) && !is_final_close(1000) && !is_final_close(4500));
    }

    #[test]
    fn reasons_are_plain() {
        assert!(plain_reason("CAPTURE_CLIENT_ALREADY_CONNECTED").contains("Another Vren app"));
        assert_eq!(plain_reason("???"), "The connection closed.");
    }
}
