//! Everything the desktop app needs apart from its windows, so it can be built and tested on its own.

pub mod client;
pub mod pairing;
pub mod pcm;
pub mod protocol;

#[cfg(feature = "audio")]
pub mod devices;

pub use client::{spawn, ClientHandle, Event, SessionConfig, Status};
