import { post } from './api.js';

export async function readVideoFrame(video, seconds) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('共有映像の準備ができていません。少し待って再試行してください。');
  const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
  return { id: crypto.randomUUID(), source: 'meeting-visual', at: seconds, capturedAt: new Date().toISOString(),
    image: dataUrl.split(',')[1], mimeType: 'image/jpeg', width: canvas.width, height: canvas.height };
}

// No backlog: at most one image request at a time; disabling clears future work.
export class VisualObserver {
  constructor({ readFrame, observed, changed, error, analyze = frame => post('/api/observe-frame', { image: frame.image, mimeType: frame.mimeType }) }) {
    Object.assign(this, { readFrame, observed, changed, error, analyze });
    this.enabled = false; this.available = false; this.busy = false; this.interval = 30000; this.sent = 0;
  }
  setAvailable(value) { this.available = value; clearTimeout(this.timer); if (value && this.enabled) this.read(); this.changed(); }
  setEnabled(value) { this.enabled = value; clearTimeout(this.timer); if (value && this.available) this.read(); this.changed(); }
  setInterval(value) { if (![15000, 30000, 60000].includes(value)) return; this.interval = value; clearTimeout(this.timer); this.schedule(); this.changed(); }
  schedule() {
    clearTimeout(this.timer);
    if (this.enabled && this.available && !this.busy) this.timer = setTimeout(() => this.read(), this.interval);
  }
  async read(manual = false) {
    if (!this.available || this.busy || (!manual && !this.enabled)) return;
    clearTimeout(this.timer); this.busy = true; this.changed();
    try {
      const frame = await this.readFrame();
      if (!this.available || (!manual && !this.enabled)) return;
      // A manual one-shot is allowed while periodic observation is disabled.
      this.sent++; this.changed();
      const result = await this.analyze(frame);
      await this.observed({ ...frame, text: result.text });
    } catch (error) {
      if (error.status === 429) { this.enabled = false; this.changed(); }
      this.error(error.status === 429 ? `${error.message} 映像の自動読取りを停止しました。` : error.message);
    }
    finally { this.busy = false; this.changed(); this.schedule(); }
  }
}
