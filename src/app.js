import './style.css';
import { newMeeting, addObservation, addConsultation, textChatPayload, evidence, searchMeeting, timeLabel, validateBackup } from './core.js';
import { saveMeeting, listMeetings, saveAudio, getAudio, meetingAudio, saveFrame, getFrame } from './storage.js';
import { capture, SampleChunks, pcm16, wav, base64 } from './audio.js';
import { Consultation } from './live.js';
import { post } from './api.js';
import { VisualObserver, readVideoFrame } from './vision.js';
import { safeMeetingName, imageFiles, zipImages } from './image-export.js';

const $ = id => document.getElementById(id);
let meeting, meetings = [], config = { configured: false }, recorder = null, recording = false, recordBusy = false;
let sampleChunks, savedSeconds = 0, ingest = Promise.resolve(), writes = Promise.resolve(), processing = false, queue = [];
let summaryBusy = false, chatBusy = false;
let imageExportBusy = false;
let transcriptionPaused = false;
const PAUSED_TRANSCRIPTION = 'API上限のため文字起こしを一時停止しています。録音音声は保存しています。';
const video = document.createElement('video'); video.muted = true; video.playsInline = true;
let latestFrame = null;
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function persist() {
  const snapshot = structuredClone(meeting);
  writes = writes.then(() => saveMeeting(snapshot)).catch(() => notice('ブラウザーへの保存に失敗しました。空き容量を確認し、記録を書き出してください。'));
  return writes;
}
const live = new Consultation({ changed: () => { render(); persist(); },
  status: text => { $('talk-status').textContent = text; renderControls(); }, error: notice });
const vision = new VisualObserver({
  readFrame: () => readVideoFrame(video, savedSeconds),
  changed: () => { if (meeting) { meeting.visualEnabled = vision.enabled; $('vision-enabled').checked = vision.enabled; renderControls(); } },
  error: message => { notice(message); persist(); },
  observed: async frame => {
    await saveFrame({ id: frame.id, meetingId: meeting.id, image: frame.image, mimeType: frame.mimeType, at: frame.at });
    latestFrame = frame;
    meeting.visuals ||= [];
    meeting.visuals.push({ id: frame.id, source: frame.source, at: frame.at, capturedAt: frame.capturedAt, text: frame.text });
    // The voice session receives the timed interpretation without a second image upload.
    live.updateContext({ source: 'meeting-visual', at: frame.at, text: frame.text, provenance: 'AIの静止画読取り・原発言ではない' });
    await persist(); render();
  }
});

function renderControls() {
  $('download-images').disabled = imageExportBusy || !meeting?.visuals?.length;
  $('download-images').textContent = imageExportBusy ? '画像をまとめています…' : '画像を保存（ZIP）';
  const busy = recording || recordBusy || processing || queue.length || live.state !== 'idle' || summaryBusy || chatBusy || vision.busy;
  $('new').disabled = !!busy; $('meetings').disabled = !!busy; $('import').disabled = !!busy; $('import-button').disabled = !!busy;
  $('record').disabled = recording || recordBusy; $('stop-record').disabled = !recording || recordBusy;
  $('talk').disabled = !config.configured || live.state !== 'idle' || chatBusy; $('stop-talk').disabled = live.state !== 'active';
  $('send-chat').disabled = !config.configured || chatBusy || ['connecting', 'stopping'].includes(live.state);
  $('chat-message').disabled = !config.configured || chatBusy;
  $('send-chat').textContent = chatBusy ? '回答を待っています…' : '送信';
  $('chat-status').textContent = chatBusy ? '会議記録を踏まえて回答しています。' : '';
  $('summarize').disabled = !config.configured || summaryBusy || !meeting?.segments.some(s => s.status === 'done' && s.text);
  $('record-badge').textContent = recordBusy ? '準備・保存中' : recording ? '記録中' : '待機中';
  $('record-badge').className = `badge ${recording ? 'active' : ''}`;
  $('talk-badge').textContent = live.state === 'active' ? '対話中' : live.state === 'idle' ? '静かに同席' : '接続処理中';
  $('talk-badge').className = `badge ${live.state === 'active' ? 'active' : ''}`;
  document.querySelector('.consultation').classList.toggle('live', live.state === 'active');
  $('pending').textContent = `文字起こし ${meeting?.segments.filter(s => s.status === 'pending').length || 0}件待ち`;
  $('transcription-status').textContent = transcriptionPaused ? PAUSED_TRANSCRIPTION : '';
  $('resume-transcription').hidden = !transcriptionPaused;
  $('resume-transcription').disabled = processing;
  $('record-time').textContent = timeLabel(savedSeconds);
  $('vision-enabled').disabled = !config.configured;
  $('read-frame').disabled = !config.configured || !vision.available || vision.busy;
  $('vision-status').textContent = `${vision.busy ? '映像を読取り中' : vision.enabled ? '映像オン' : '映像オフ'} · 読取り送信 ${vision.sent}枚（このページ）`;
  $('vision-preview').hidden = !latestFrame;
  if (latestFrame && $('vision-preview').dataset.frame !== latestFrame.id) {
    $('vision-preview').src = `data:${latestFrame.mimeType};base64,${latestFrame.image}`;
    $('vision-preview').dataset.frame = latestFrame.id;
  }
}
function entry(container, text, meta, className = '') {
  const node = document.createElement('div'); node.className = `entry ${className}`;
  const label = document.createElement('span'); label.className = 'meta'; label.textContent = meta;
  node.append(label, document.createTextNode(text)); container.append(node); return node;
}
function empty(container, text) { const node = document.createElement('div'); node.className = 'empty'; node.textContent = text; container.append(node); }
function render() {
  if (!meeting) return;
  $('segments').replaceChildren(); $('consultations').replaceChildren();
  for (const s of meeting.segments) {
    const label = `${timeLabel(s.start)}–${timeLabel(s.end)} · ${s.kind === 'note' ? '会議メモ（手入力）' : '会議音声'}`;
    const node = entry($('segments'), s.status === 'done' ? s.text || '（発言なし）' : s.status === 'pending' ? '文字起こし待ち…' : '文字起こし未完了。音声が保存されていれば再試行できます。', label, s.status === 'failed' ? 'failed' : '');
    if (s.status === 'failed' && s.error) { const reason = document.createElement('p'); reason.textContent = s.error; node.append(reason); }
    if (s.status === 'failed' && config.configured && !s.kind) {
      const retry = document.createElement('button'); retry.className = 'text-button'; retry.textContent = '再試行';
      retry.disabled = processing;
      retry.onclick = () => { transcriptionPaused = false; s.status = 'pending'; delete s.error; queue.push(s); persist(); render(); processQueue(); }; node.append(document.createElement('br'), retry);
    }
  }
  if (!meeting.segments.length) empty($('segments'), '会議の記録を開始すると、ここに発言が届きます。');
  $('visuals').replaceChildren();
  for (const v of (meeting.visuals || []).slice(-10)) entry($('visuals'), v.text, `${timeLabel(v.at)} · AIの静止画読取り（解釈を含む）`);
  if (!meeting.visuals?.length) empty($('visuals'), '映像オン、または「今の画面だけ読む」で映像を参照できます。');
  for (const c of meeting.consultations) entry($('consultations'), c.text,
    `${c.role === 'user' ? 'あなた' : '同席者'} · ${new Date(c.at).toLocaleTimeString('ja-JP')} ${c.interrupted ? '· 応答途中で終了' : ''}`, c.role);
  if (!meeting.consultations.length) empty($('consultations'), '「どう思う？」から、相談を始められます。');
  $('summary').textContent = meeting.summary ? `AIの要約（原発言ではありません） · ${timeLabel(meeting.summary.through)}まで\n${meeting.summary.text}` : '会議記録がたまったら要約できます。';
  $('segments').scrollTop = $('segments').scrollHeight; $('consultations').scrollTop = $('consultations').scrollHeight;
  renderControls();
}
function selectMeeting(value) {
  meeting = value; $('title').value = meeting.title;
  meeting.visualEnabled = vision.enabled;
  latestFrame = null;
  const frameId = meeting.visuals?.at(-1)?.id;
  if (frameId) getFrame(frameId).then(frame => { if (meeting === value && frame) { latestFrame = frame; renderControls(); } }).catch(() => {});
  savedSeconds = Math.max(0, ...meeting.segments.map(s => s.end));
  $('results').replaceChildren(); $('talk-status').textContent = '静かな同席状態です。';
  $('meetings').replaceChildren();
  for (const m of [...meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const option = document.createElement('option'); option.value = m.id; option.textContent = m.title; $('meetings').append(option);
  }
  $('meetings').value = meeting.id; render();
}
async function processQueue() {
  if (processing) return;
  processing = true; renderControls();
  while (queue.length) {
    const segment = queue.shift();
    try {
      const audio = await getAudio(segment.id);
      if (!audio) throw new Error('この区間の音声がありません。JSONのバックアップには音声が含まれません。');
      const result = await post('/api/transcribe', { audio: base64(new Uint8Array(await audio.blob.arrayBuffer())) });
      segment.text = result.text; segment.status = 'done'; delete segment.error; live.updateContext(segment);
    } catch (error) {
      segment.status = 'failed'; segment.error = error.message;
      if (error.status === 429) {
        transcriptionPaused = true;
        for (const waiting of queue.splice(0)) { waiting.status = 'failed'; waiting.error = PAUSED_TRANSCRIPTION; }
      }
      notice(error.status === 429 ? `${error.message} 録音は継続し、文字起こしの自動送信を一時停止しました。` : error.message);
    }
    await persist(); render();
  }
  processing = false; render();
}
async function startRecording() {
  if (recording || recordBusy) return;
  recordBusy = true; renderControls(); notice('');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (!stream.getAudioTracks().length) throw new Error('音声が共有されていません。会議タブを選び、「タブの音声を共有」を有効にしてください。');
    video.srcObject = stream;
    await video.play();
    const offset = savedSeconds;
    recorder = await capture(stream, (samples, rate) => {
      if (!sampleChunks) sampleChunks = new SampleChunks(rate * 10, (chunk, start) => {
        const id = crypto.randomUUID();
        const segment = { id, source: 'meeting', start: offset + start / rate, end: offset + (start + chunk.length) / rate, text: '', status: config.configured && !transcriptionPaused ? 'pending' : 'failed' };
        const blob = new Blob([wav(pcm16(chunk), rate)], { type: 'audio/wav' });
        ingest = ingest.then(async () => {
          await saveAudio({ id, meetingId: meeting.id, start: segment.start, rate, blob });
          if (transcriptionPaused) { segment.status = 'failed'; segment.error = PAUSED_TRANSCRIPTION; }
          addObservation(meeting, segment); await persist();
          const savedSegment = meeting.segments.find(s => s.id === id);
          if (transcriptionPaused) { savedSegment.status = 'failed'; savedSegment.error = PAUSED_TRANSCRIPTION; await persist(); }
          else if (config.configured) { queue.push(savedSegment); processQueue(); }
          render();
        }).catch(() => { notice('音声の保存に失敗しました。空き容量を確認してください。'); stopRecording(); });
      });
      sampleChunks.push(samples); savedSeconds = offset + (sampleChunks.offset + sampleChunks.length) / rate; renderControls();
    });
    meeting.endedAt = null; recording = true; recordBusy = false;
    vision.setAvailable(true);
    for (const track of stream.getTracks()) track.addEventListener('ended', () => stopRecording(), { once: true });
    if (!config.configured) notice('APIキー未設定のため、会議音声だけをローカル保存します。設定後に文字起こしを再試行できます。');
    renderControls();
  } catch (error) {
    vision.setAvailable(false); video.srcObject = null;
    stream?.getTracks().forEach(t => t.stop()); recordBusy = false; notice(error.message); renderControls();
  }
}
async function stopRecording() {
  if (!recording || recordBusy) return;
  recordBusy = true; renderControls();
  vision.setAvailable(false);
  try {
    await recorder.stop(); sampleChunks?.flush(); await ingest;
    meeting.endedAt = new Date().toISOString(); await persist();
  } finally { video.srcObject = null; sampleChunks = null; recorder = null; recording = false; recordBusy = false; render(); }
}

$('record').onclick = startRecording; $('stop-record').onclick = stopRecording;
$('resume-transcription').onclick = () => { transcriptionPaused = false; notice('今後の音声の文字起こしを再開します。保存済みの未完了区間は各「再試行」で処理できます。'); render(); };
$('vision-enabled').onchange = () => {
  meeting.visualEnabled = $('vision-enabled').checked;
  vision.setEnabled(meeting.visualEnabled);
  live.updateContext({ source: 'visual-setting', enabled: meeting.visualEnabled, text: meeting.visualEnabled ? '映像の定期読取りを有効にした。' : '映像の定期読取りを無効にした。今後の画面を見たと主張しない。以前の読取り記録は残る。' });
  persist();
};
$('vision-interval').onchange = () => vision.setInterval(Number($('vision-interval').value));
$('read-frame').onclick = () => vision.read(true);
$('talk').onclick = () => live.start(meeting); $('stop-talk').onclick = () => live.stop();
$('chat-form').onsubmit = async event => {
  event.preventDefault();
  const message = $('chat-message').value.trim();
  if (!message || chatBusy || !config.configured || ['connecting', 'stopping'].includes(live.state)) return;
  chatBusy = true; notice(''); renderControls();
  try {
    // End voice input before taking a snapshot so the two modes share one history.
    if (live.state === 'active') await live.stop();
    const payload = textChatPayload(meeting, message);
    if (vision.enabled && latestFrame) payload.frame = { image: latestFrame.image, mimeType: latestFrame.mimeType, at: latestFrame.at };
    addConsultation(meeting, 'user', message); await persist(); render();
    $('chat-message').value = '';
    if (!vision.enabled) delete payload.frame;
    const result = await post('/api/chat', payload);
    addConsultation(meeting, 'model', result.text); await persist(); render();
  } catch (error) {
    $('chat-message').value = message;
    notice(`${error.message} 相談文は履歴に残しています。入力欄から再送できます。`);
  } finally { chatBusy = false; renderControls(); $('chat-message').focus(); }
};
$('chat-message').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault(); $('chat-form').requestSubmit();
  }
});
document.addEventListener('keydown', event => {
  if (event.altKey && event.shiftKey && event.code === 'KeyC') {
    event.preventDefault(); if (live.state === 'active') live.stop(); else if (live.state === 'idle' && config.configured && !chatBusy) live.start(meeting);
  }
});
$('title').onchange = async () => { meeting.title = $('title').value.trim() || '新しい会議'; await persist(); $('meetings').selectedOptions[0].textContent = meeting.title; };
$('new').onclick = async () => { const value = newMeeting(); meetings.push(value); selectMeeting(value); await persist(); notice(''); };
$('meetings').onchange = () => selectMeeting(meetings.find(m => m.id === $('meetings').value));
$('note-form').onsubmit = async event => {
  event.preventDefault(); const text = $('note').value.trim(); if (!text) return;
  const segment = { id: crypto.randomUUID(), source: 'meeting', kind: 'note', start: savedSeconds, end: savedSeconds, text, status: 'done' };
  addObservation(meeting, segment); $('note').value = ''; live.updateContext(segment); await persist(); render();
};
$('search-form').onsubmit = event => {
  event.preventDefault(); $('results').replaceChildren();
  const results = searchMeeting(meeting, $('query').value);
  for (const s of results) entry($('results'), s.text, `${timeLabel(s.start)}–${timeLabel(s.end)} · 会議記録`);
  if (!results.length) empty($('results'), '一致する発言がありません。短い語句で試してください。');
};
$('summarize').onclick = async () => {
  summaryBusy = true; renderControls();
  const segments = meeting.segments.filter(s => s.status === 'done' && s.text);
  const through = Math.max(...segments.map(s => s.end));
  const target = meeting;
  try {
    const data = await post('/api/summary', { evidence: segments.map(evidence).join('\n') });
    target.summary = { text: data.text, through, at: new Date().toISOString() }; await persist();
  } catch (error) { notice(error.message); }
  finally { summaryBusy = false; render(); }
};
function download(blob, name) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').onclick = () => download(new Blob([JSON.stringify({ version: 1, audioIncluded: false, meeting }, null, 2)], { type: 'application/json' }), 'withviewer-record.json');
$('download-images').onclick = async () => {
  if (imageExportBusy) return;
  const target = meeting, title = target.title;
  const observations = [...(target.visuals || [])];
  imageExportBusy = true; renderControls();
  try {
    const stored = await Promise.all(observations.map(item => getFrame(item.id)));
    const frames = stored.filter(frame => frame && frame.meetingId === target.id);
    if (!frames.length) throw new Error('このブラウザーに保存された会議画像がありません。JSONの読込みには画像本体は含まれません。');
    download(zipImages(imageFiles(title, frames)), `${safeMeetingName(title)}_画像.zip`);
    notice(`${frames.length}枚の画像をZIPに保存しました。${frames.length < observations.length ? '画像本体がない記録は除外しました。' : ''}`);
  } catch (error) { notice(error.message); }
  finally { imageExportBusy = false; renderControls(); }
};
$('import-button').onclick = () => $('import').click();
$('import').onchange = async () => {
  try {
    const file = $('import').files[0]; if (!file) return;
    if (file.size > 5_000_000) throw new Error('記録ファイルは5MB以内にしてください。');
    const imported = validateBackup(JSON.parse(await file.text())); meetings.push(imported); selectMeeting(imported); await persist(); notice('会議記録と相談履歴を読み込みました。JSONには録音音声は含まれません。');
  } catch (error) { notice(error.message); }
  finally { $('import').value = ''; }
};
$('download-audio').onclick = async () => {
  try {
    const chunks = (await meetingAudio(meeting.id)).sort((a, b) => a.start - b.start);
    if (!chunks.length) throw new Error('保存した会議音声がありません。');
    if (chunks.some(c => c.rate !== chunks[0].rate)) throw new Error('録音のサンプルレートが混在しています。同じ音声設定で記録してください。');
    const parts = await Promise.all(chunks.map(async c => new Uint8Array((await c.blob.arrayBuffer()).slice(44))));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0; for (const p of parts) { bytes.set(p, offset); offset += p.length; }
    download(new Blob([wav(bytes, chunks[0].rate)], { type: 'audio/wav' }), 'withviewer-meeting.wav');
  } catch (error) { notice(error.message); }
};
window.addEventListener('beforeunload', event => {
  if (recording || recordBusy || processing || live.state !== 'idle' || chatBusy || vision.busy) { event.preventDefault(); event.returnValue = ''; }
});

async function initialize() {
  try {
    const response = await fetch('/api/config'); if (!response.ok) throw new Error(response.status === 401 ? 'ログインが必要です。ページを開き直してログインしてください。' : 'サーバー設定を確認できません。'); config = await response.json();
    if (config.authProvider === 'firebase') {
      $('app-main').hidden = true; $('login-panel').hidden = false; $('connection').textContent = 'ログイン待ち';
      if (!config.firebase || config.setupError) { $('google-login').disabled = true; $('login-status').textContent = config.setupError || 'Firebaseの設定を確認してください。'; return; }
      const { prepareGoogleLogin } = await import('./auth.js');
      const session = await prepareGoogleLogin(config.firebase, { loginButton: $('google-login'), logoutButton: $('cloud-logout'),
        status: $('login-status'), beforeLogout: async () => { await live.stop(); await stopRecording(); await ingest; await writes; } });
      if (!session) return;
      config.configured = session.configured; $('app-main').hidden = false; $('login-panel').hidden = true;
    }
    $('connection').textContent = config.configured ? 'Gemini 接続準備済み' : 'APIキー未設定';
    $('connection').className = `badge ${config.configured ? 'active' : 'warn'}`;
    meetings = await listMeetings();
    // Pending requests cannot survive a page reload; keep their audio retryable.
    for (const m of meetings) {
      let changed = false; for (const s of m.segments) if (s.status === 'pending') { s.status = 'failed'; changed = true; }
      if (changed) await saveMeeting(m);
    }
    if (!meetings.length) meetings.push(newMeeting());
    selectMeeting([...meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]); await persist();
    if (!config.configured) notice(config.deployment === 'cloudflare' ? 'CloudflareのSecretにGEMINI_API_KEYを設定してください。' : '音声・テキストでの相談にはGemini APIキーの設定が必要です。.env.exampleを参考に.envを作成し、アプリを再起動してください。');
  } catch (error) { notice(error.message); document.querySelectorAll('button,input,select').forEach(el => el.disabled = true); }
}
initialize();
