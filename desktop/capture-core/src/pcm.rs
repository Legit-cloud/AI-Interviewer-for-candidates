//! Turning whatever the sound card gives us into the format the server wants:
//! mono, 16 kHz, 16-bit, in 250 ms chunks.

use base64::{engine::general_purpose::STANDARD, Engine as _};

pub const TARGET_RATE: u32 = 16_000;
/// 250 ms at 16 kHz.
pub const CHUNK_SAMPLES: usize = 4_000;

/// Mixes interleaved frames down to one channel.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

pub fn f32_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped * 32768.0) as i16
    } else {
        (clamped * 32767.0) as i16
    }
}

pub fn i16_to_f32(sample: i16) -> f32 {
    sample as f32 / 32768.0
}

pub fn u16_to_f32(sample: u16) -> f32 {
    (sample as f32 - 32768.0) / 32768.0
}

/// Streaming converter. Feed it device buffers of any size; it returns whole 250 ms chunks as they fill.
/// Down-sampling averages each group of input samples, which also keeps high frequencies from folding back.
pub struct Chunker {
    channels: usize,
    ratio: f64,
    acc: f64,
    count: f64,
    phase: f64,
    pending: Vec<i16>,
}

impl Chunker {
    pub fn new(in_rate: u32, channels: u16) -> Self {
        Self {
            channels: channels.max(1) as usize,
            ratio: (in_rate.max(1) as f64 / TARGET_RATE as f64).max(1.0),
            acc: 0.0,
            count: 0.0,
            phase: 0.0,
            pending: Vec::with_capacity(CHUNK_SAMPLES * 2),
        }
    }

    pub fn push_f32(&mut self, interleaved: &[f32]) -> Vec<Vec<i16>> {
        for s in downmix(interleaved, self.channels) {
            self.acc += s as f64;
            self.count += 1.0;
            self.phase += 1.0;
            if self.phase >= self.ratio {
                self.pending.push(f32_to_i16((self.acc / self.count) as f32));
                self.acc = 0.0;
                self.count = 0.0;
                self.phase -= self.ratio;
            }
        }
        let mut out = Vec::new();
        while self.pending.len() >= CHUNK_SAMPLES {
            out.push(self.pending.drain(..CHUNK_SAMPLES).collect());
        }
        out
    }

    pub fn push_i16(&mut self, interleaved: &[i16]) -> Vec<Vec<i16>> {
        let f: Vec<f32> = interleaved.iter().map(|s| i16_to_f32(*s)).collect();
        self.push_f32(&f)
    }

    pub fn push_u16(&mut self, interleaved: &[u16]) -> Vec<Vec<i16>> {
        let f: Vec<f32> = interleaved.iter().map(|s| u16_to_f32(*s)).collect();
        self.push_f32(&f)
    }
}

/// Little-endian bytes, base64 encoded, as the server expects.
pub fn pcm_to_base64(samples: &[i16]) -> String {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    STANDARD.encode(bytes)
}

/// Root-mean-square level, for a level meter and for tests.
pub fn rms(samples: &[i16]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    (sum / samples.len() as f64).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, hz: f32, seconds: f32, channels: usize) -> Vec<f32> {
        let n = (rate as f32 * seconds) as usize;
        let mut out = Vec::with_capacity(n * channels);
        for i in 0..n {
            let v = (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin() * 0.5;
            for _ in 0..channels {
                out.push(v);
            }
        }
        out
    }

    fn zero_crossings(samples: &[i16]) -> usize {
        samples.windows(2).filter(|w| (w[0] < 0) != (w[1] < 0)).count()
    }

    #[test]
    fn downmix_averages_channels() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(downmix(&[0.25, 0.75], 1), vec![0.25, 0.75]);
    }

    #[test]
    fn samples_convert_without_overflow() {
        assert_eq!(f32_to_i16(2.0), 32767);
        assert_eq!(f32_to_i16(-2.0), -32768);
        assert_eq!(f32_to_i16(0.0), 0);
        assert!((i16_to_f32(i16::MIN) + 1.0).abs() < 1e-6);
        assert!(u16_to_f32(32768).abs() < 1e-6);
    }

    #[test]
    fn sixteen_k_mono_passes_through_in_whole_chunks() {
        let mut c = Chunker::new(16_000, 1);
        let chunks = c.push_f32(&sine(16_000, 440.0, 1.0, 1));
        assert_eq!(chunks.len(), 4); // one second is four 250 ms chunks
        assert!(chunks.iter().all(|ch| ch.len() == CHUNK_SAMPLES));
    }

    #[test]
    fn forty_eight_k_stereo_becomes_sixteen_k_mono_with_the_same_pitch() {
        let mut c = Chunker::new(48_000, 2);
        let chunks = c.push_f32(&sine(48_000, 440.0, 2.0, 2));
        let all: Vec<i16> = chunks.concat();
        // two seconds at 16 kHz, less whatever is still waiting for a full chunk
        assert!(all.len() >= 28_000 && all.len() <= 32_000, "got {}", all.len());
        // 440 Hz crosses zero about 880 times a second
        let per_second = zero_crossings(&all) as f64 / (all.len() as f64 / 16_000.0);
        assert!((per_second - 880.0).abs() < 40.0, "pitch drifted: {per_second}");
        assert!(rms(&all) > 8_000.0, "the signal should still be loud");
    }

    #[test]
    fn forty_four_one_k_works_too_and_odd_buffer_sizes_do_not_change_the_result() {
        let input = sine(44_100, 300.0, 1.5, 1);
        let mut whole = Chunker::new(44_100, 1);
        let a: Vec<i16> = whole.push_f32(&input).concat();
        let mut pieces = Chunker::new(44_100, 1);
        let mut b: Vec<i16> = Vec::new();
        for part in input.chunks(997) {
            b.extend(pieces.push_f32(part).concat());
        }
        assert_eq!(a, b);
        assert!(a.len() > 18_000);
    }

    #[test]
    fn silence_stays_silent() {
        let mut c = Chunker::new(48_000, 1);
        let all: Vec<i16> = c.push_f32(&vec![0.0; 48_000]).concat();
        assert!(rms(&all) < 1.0);
    }

    #[test]
    fn base64_is_little_endian_pcm() {
        assert_eq!(pcm_to_base64(&[1, -1]), "AQD//w==");
    }
}
