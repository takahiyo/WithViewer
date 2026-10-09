export function pcm16(samples) {
  const data = new ArrayBuffer(samples.length * 2);
  const view = new DataView(data);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * (samples[i] < 0 ? 32768 : 32767)), true);
  return new Uint8Array(data);
}
export function base64(bytes) {
  let string = '';
  for (let i = 0; i < bytes.length; i += 8192) string += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(string);
}
export function wav(pcm, rate) {
  const bytes = new Uint8Array(44 + pcm.length);
  const v = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, pcm.length, true); bytes.set(pcm, 44);
  return bytes;
}

// Split by sample count, not wall-clock timers: consultation activity cannot create gaps.
export class SampleChunks {
  constructor(size, emit) { this.size = size; this.emit = emit; this.parts = []; this.length = 0; this.offset = 0; }
  push(samples) {
    let pos = 0;
    while (pos < samples.length) {
      const n = Math.min(this.size - this.length, samples.length - pos);
      this.parts.push(samples.slice(pos, pos + n)); this.length += n; pos += n;
      if (this.length === this.size) this.flush();
    }
  }
  flush() {
    if (!this.length) return;
    const combined = new Float32Array(this.length);
    let pos = 0;
    for (const part of this.parts) { combined.set(part, pos); pos += part.length; }
    const start = this.offset; this.offset += this.length; this.parts = []; this.length = 0;
    this.emit(combined, start);
  }
}

export async function capture(stream, onSamples) {
  const context = new AudioContext({ sampleRate: 16000 });
  let node, source;
  try {
    await context.audioWorklet.addModule('/pcm-worklet.js');
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'pcm-capture');
    const silent = context.createGain(); silent.gain.value = 0;
    node.port.onmessage = event => onSamples(event.data, context.sampleRate);
    source.connect(node); node.connect(silent); silent.connect(context.destination);
    await context.resume();
    return { rate: context.sampleRate, async stop() {
      // Ask the audio thread to deliver its final partial packet before closing.
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 500);
        node.port.onmessage = event => {
          if (event.data === 'flushed') { clearTimeout(timer); resolve(); }
          else onSamples(event.data, context.sampleRate);
        };
        node.port.postMessage('flush');
      });
      source.disconnect(); node.disconnect(); node.port.onmessage = null;
      stream.getTracks().forEach(t => t.stop()); await context.close();
    } };
  } catch (error) {
    source?.disconnect(); node?.disconnect(); stream.getTracks().forEach(t => t.stop()); await context.close(); throw error;
  }
}

export class AudioPlayer {
  constructor(context = new AudioContext({ sampleRate: 24000 })) { this.context = context; this.sources = new Set(); this.next = 0; }
  async resume() { await this.context.resume(); }
  play(data) {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const buffer = this.context.createBuffer(1, bytes.length / 2, 24000);
    const floats = buffer.getChannelData(0);
    for (let i = 0; i < floats.length; i++) floats[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    this.sources.add(source); this.next = Math.max(this.next, this.context.currentTime); source.start(this.next); this.next += buffer.duration;
  }
  interrupt() { for (const source of this.sources) source.stop(); this.sources.clear(); this.next = this.context.currentTime; }
  async close() { this.interrupt(); await this.context.close(); }
}
