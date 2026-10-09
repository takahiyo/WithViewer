class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(2048); this.used = 0; this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.stopped = true;
        if (this.used) this.port.postMessage(this.buffer.slice(0, this.used));
        this.used = 0; this.port.postMessage('flushed');
      }
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.buffer[this.used++] = value / channels.length;
      if (this.used === this.buffer.length) { this.port.postMessage(this.buffer); this.buffer = new Float32Array(2048); this.used = 0; }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
