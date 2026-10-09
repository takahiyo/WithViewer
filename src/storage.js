const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('withviewer', 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('meetings')) request.result.createObjectStore('meetings', { keyPath: 'id' });
    if (!request.result.objectStoreNames.contains('audio')) {
      const audio = request.result.createObjectStore('audio', { keyPath: 'id' }); audio.createIndex('meetingId', 'meetingId');
    }
    if (!request.result.objectStoreNames.contains('frames')) request.result.createObjectStore('frames', { keyPath: 'id' });
  };
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  request.onblocked = () => reject(new Error('保存形式の更新のため、同じアプリを開いている別のタブを閉じて再読み込みしてください。'));
  request.onerror = () => reject(request.error);
});

async function operation(store, mode, run) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました。'));
  });
}
export const saveMeeting = meeting => operation('meetings', 'readwrite', s => s.put(meeting));
export const listMeetings = () => operation('meetings', 'readonly', s => s.getAll());
export const saveAudio = chunk => operation('audio', 'readwrite', s => s.put(chunk));
export const getAudio = id => operation('audio', 'readonly', s => s.get(id));
export const meetingAudio = id => operation('audio', 'readonly', s => s.index('meetingId').getAll(id));
export const saveFrame = frame => operation('frames', 'readwrite', s => s.put(frame));
export const getFrame = id => operation('frames', 'readonly', s => s.get(id));
export const meetingFrames = id => operation('frames', 'readonly', s => s.getAll()).then(frames => frames.filter(f => f.meetingId === id));
export async function restoreArchive({ meeting, audio, frames }) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meetings', 'audio', 'frames'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('復元を保存できません。端末の空き容量を確認してください。'));
    // add, not put: identity collisions abort the whole transaction.
    try {
      tx.objectStore('meetings').add(meeting);
      audio.forEach(chunk => tx.objectStore('audio').add(chunk));
      frames.forEach(frame => tx.objectStore('frames').add(frame));
    } catch (error) { tx.abort(); reject(error); }
  });
}
