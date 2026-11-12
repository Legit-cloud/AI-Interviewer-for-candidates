//! Trading the 6-digit code from the Vren website for a token that covers one live session.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Paired {
    pub session_id: String,
    pub ws_token: String,
    pub ws_path: String,
    #[serde(default)]
    pub job_title: String,
    #[serde(default)]
    pub company: String,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PairError {
    #[error("Type the 6-digit code from the Vren website.")]
    BadFormat,
    #[error("The server address must start with https:// (or http://localhost).")]
    InsecureServer,
    #[error("That code is invalid or has expired.")]
    InvalidCode,
    #[error("Too many tries. Wait a few minutes and try again.")]
    TooManyTries,
    #[error("Could not reach Vren AI. Check your connection and the server address.")]
    Network,
    #[error("The server did not understand the reply.")]
    BadReply,
}

/// `https://api.example.com/` -> `https://api.example.com`. Plain http is only allowed for this computer.
pub fn normalize_server(raw: &str) -> Result<String, PairError> {
    let url = url::Url::parse(raw.trim().trim_end_matches('/')).map_err(|_| PairError::InsecureServer)?;
    let local = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err(PairError::InsecureServer);
    }
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{}://{}{}", url.scheme(), url.host_str().unwrap_or_default(), port))
}

pub fn ws_url(server: &str, ws_path: &str, token: &str) -> Result<String, PairError> {
    let mut url = url::Url::parse(server).and_then(|base| base.join(ws_path)).map_err(|_| PairError::BadReply)?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme).map_err(|_| PairError::BadReply)?;
    url.query_pairs_mut().append_pair("token", token);
    Ok(url.to_string())
}

/// `role` is "capture" (this app listens) or "display" (it only shows answers, so it never competes with another app).
pub async fn redeem(server: &str, code: &str, role: &str) -> Result<Paired, PairError> {
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(PairError::BadFormat);
    }
    let server = normalize_server(server)?;
    let response = reqwest::Client::new()
        .post(format!("{server}/v1/pairing/redeem"))
        .json(&serde_json::json!({ "code": code, "role": role }))
        .send()
        .await
        .map_err(|_| PairError::Network)?;
    match response.status().as_u16() {
        200 => response.json::<Paired>().await.map_err(|_| PairError::BadReply),
        429 => Err(PairError::TooManyTries),
        _ => Err(PairError::InvalidCode),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn servers_must_be_https_unless_local() {
        assert_eq!(normalize_server("https://api.example.com/").unwrap(), "https://api.example.com");
        assert_eq!(normalize_server("http://localhost:8000").unwrap(), "http://localhost:8000");
        assert_eq!(normalize_server("http://127.0.0.1:8000/").unwrap(), "http://127.0.0.1:8000");
        assert_eq!(normalize_server("http://example.com"), Err(PairError::InsecureServer));
        assert_eq!(normalize_server("not a url"), Err(PairError::InsecureServer));
    }

    #[test]
    fn websocket_url_carries_the_token() {
        assert_eq!(ws_url("https://a.com", "/v1/live/x", "t0k").unwrap(), "wss://a.com/v1/live/x?token=t0k");
        assert_eq!(ws_url("http://localhost:8000", "/v1/live/x", "t").unwrap(), "ws://localhost:8000/v1/live/x?token=t");
    }

    #[tokio::test]
    async fn a_bad_code_never_reaches_the_network() {
        for bad in ["12345", "1234567", "12a456", ""] {
            assert_eq!(redeem("http://localhost:1", bad, "capture").await, Err(PairError::BadFormat));
        }
        assert_eq!(redeem("http://localhost:1", "123456", "capture").await, Err(PairError::Network));
    }
}
