// AudioWorkletProcessor that accumulates 4000 mono samples at 16 kHz (or equivalent 250ms at any rate)
// and posts compact Float32 buffers with minimal overhead.
class VrenPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const targetFrames = options?.processorOptions?.chunkSamples || 4000;
    this.chunkSamples = targetFrames;
    this.buffer = new Float32Array(targetFrames);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    if (!ch0 || ch0.length === 0) return true;
    const ch1 = input[1];

    for (let i = 0; i < ch0.length; i += 1) {
      const sample = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      this.buffer[this.offset] = sample;
      this.offset += 1;
      if (this.offset >= this.chunkSamples) {
        const out = this.buffer.slice(0, this.chunkSamples);
        this.port.postMessage(out, [out.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("vren-pcm-processor", VrenPcmProcessor);

