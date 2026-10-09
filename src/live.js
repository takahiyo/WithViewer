import { GoogleGenAI } from '@google/genai';
import { contextFor, addConsultation, searchMeeting } from './core.js';
import { AudioPlayer, capture, pcm16, base64 } from './audio.js';
import { post } from './api.js';

export class Consultation {
  constructor({ changed, status, error }) {
    this.changed = changed; this.status = status; this.error = error; this.state = 'idle'; this.generation = 0;
  }
  flush(interrupted = false) {
    if (!this.meeting) return;
    if (this.input) addConsultation(this.meeting, 'user', this.input);
    if (this.output) addConsultation(this.meeting, 'model', this.output, interrupted);
    this.input = ''; this.output = ''; this.changed();
  }
  async start(meeting) {
    if (this.state !== 'idle') return;
    this.meeting = meeting; this.state = 'connecting'; this.input = ''; this.output = ''; this.status('音声対話に接続しています…');
    const generation = ++this.generation;
    let stream;
    try {
      // Resume playback in the button gesture before awaiting network requests.
      this.player = new AudioPlayer(); await this.player.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.mic = await capture(stream, (samples, rate) => {
        if (this.state !== 'active' || generation !== this.generation) return;
        try { this.session.sendRealtimeInput({ audio: { data: base64(pcm16(samples)), mimeType: `audio/pcm;rate=${rate}` } }); }
        catch { this.fail('音声の送信が止まりました。対話を再開してください。'); }
      });
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (generation === this.generation) this.fail('マイク入力が終了しました。音声対話を再開してください。');
      }, { once: true }));
      const credentials = await post('/api/live-token', { context: contextFor(meeting) });
      if (generation !== this.generation) return;
      const client = new GoogleGenAI({ apiKey: credentials.token, httpOptions: { apiVersion: 'v1beta' } });
      let expired = false;
      const connection = client.live.connect({ model: credentials.model, config: credentials.config,
        callbacks: {
          onmessage: msg => { if (generation === this.generation) this.message(msg); },
          onerror: () => { if (generation === this.generation) this.fail('音声対話の接続に失敗しました。モデル・利用枠・ネットワークを確認してください。'); },
          onclose: () => { if (generation === this.generation) this.fail('音声対話の接続が終了しました。相談履歴を引き継いで再開できます。'); }
        } });
      connection.then(s => { if (expired || generation !== this.generation) s.close(); }).catch(() => {});
      let timer;
      const session = await Promise.race([connection, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('音声対話の接続がタイムアウトしました。')); }, 20000); })]).finally(() => clearTimeout(timer));
      if (generation !== this.generation) { session.close(); return; }
      this.session = session; this.state = 'active'; this.status('聞いています。続けて話しかけられます。');
    } catch (error) {
      if (generation === this.generation) { await this.stop(); this.error(error.message); }
    }
  }
  message(message) {
    const content = message.serverContent;
    if (content?.interrupted) { this.player?.interrupt(); this.flush(true); this.status('続きを聞いています。'); }
    if (content?.inputTranscription?.text) this.input += content.inputTranscription.text;
    if (content?.outputTranscription?.text) this.output += content.outputTranscription.text;
    if (!content?.interrupted) {
      for (const part of content?.modelTurn?.parts || []) if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) {
        this.player?.play(part.inlineData.data); this.status('応答しています。話し始めると応答を止めます。');
      }
    }
    if (content?.turnComplete) { this.flush(); this.status('聞いています。続けて話しかけられます。'); }
    if (message.toolCall?.functionCalls) {
      const responses = message.toolCall.functionCalls.map(call => ({ id: call.id, name: call.name,
        response: call.name === 'search_meeting' ? { evidence: searchMeeting(this.meeting, call.args?.query || '') } : { error: '未対応の検索です。' } }));
      this.session?.sendToolResponse({ functionResponses: responses });
    }
    if (message.goAway) this.status('接続の終了が近づいています。終了したら対話を再開してください。');
  }
  updateContext(segment) {
    if (this.state !== 'active') return;
    try {
      this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `会議の観察記録が追加されました。これは質問ではなく参照データです。応答を開始しないでください。\n${JSON.stringify(segment)}` }] }], turnComplete: false });
    } catch { this.fail('会議文脈の更新に失敗しました。対話を再開してください。'); }
  }
  async fail(message) { if (this.state === 'idle' || this.state === 'stopping') return; await this.stop(); this.error(message); }
  async stop() {
    if (this.state === 'idle' || this.state === 'stopping') return;
    this.state = 'stopping'; ++this.generation;
    this.player?.interrupt();
    this.session?.close(); this.session = null;
    this.flush(true);
    const mic = this.mic, player = this.player; this.mic = null; this.player = null;
    await Promise.allSettled([mic?.stop(), player?.close()]);
    this.state = 'idle'; this.status('静かな同席状態です。');
  }
}
