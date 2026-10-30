import type { Clip } from './types';

export class ClipStore {
  private db: IDBDatabase | null = null;
  private memory = new Map<string, Clip>();
  persistent = false;
  async open() {
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('soccar-local', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('clips', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Storage is blocked by another tab.'));
      });
      this.persistent = true;
    } catch { this.persistent = false; }
  }
  async list(): Promise<Clip[]> {
    if (!this.db) return [...this.memory.values()].sort((a, b) => b.createdAt - a.createdAt);
    return (await this.request<Clip[]>('readonly', store => store.getAll())).sort((a, b) => b.createdAt - a.createdAt);
  }
  async put(clip: Clip) {
    if (!this.db) { this.memory.set(clip.id, clip); return; }
    await this.request('readwrite', store => store.put(clip));
  }
  async delete(id: string) {
    if (!this.db) { this.memory.delete(id); return; }
    await this.request('readwrite', store => store.delete(id));
  }
  private request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction('clips', mode);
      const request = run(transaction.objectStore('clips'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction aborted.'));
    });
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const safeName = (name: string) => name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'soccar-clip';

export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  startedAt = 0;
  saving = false;
  onSaved: (clip: Clip) => void = () => {};
  onError: (message: string) => void = () => {};
  get recording() { return this.recorder?.state === 'recording'; }
  get supported() { return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'; }
  start(canvas: HTMLCanvasElement, audio?: MediaStreamTrack) {
    if (!this.supported) throw new Error('Video recording is not supported in this browser. Try current Chrome, Edge, or Firefox.');
    if (this.recorder || this.saving) return;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('This browser does not have a supported recording codec.');
    this.stream = canvas.captureStream(60);
    if (audio) this.stream.addTrack(audio);
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
    this.chunks = [];
    const recorder = this.recorder;
    recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
    recorder.onerror = () => { this.cleanUp(); this.onError('The browser stopped recording. Your previous clips are safe.'); };
    recorder.onstop = () => {
      if (!this.chunks.length) { this.cleanUp(); this.onError('No video frames were captured. Try a longer recording.'); return; }
      const blob = new Blob(this.chunks, { type: recorder.mimeType });
      const duration = Math.max(0.1, (performance.now() - this.startedAt) / 1000);
      const now = Date.now();
      const clip: Clip = { id: crypto.randomUUID(), title: `Freeplay · ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, createdAt: now, duration, blob, mime: recorder.mimeType, size: blob.size };
      this.cleanUp(); this.onSaved(clip);
    };
    this.startedAt = performance.now(); recorder.start(1000);
  }
  stop() { if (this.recorder?.state === 'recording') { this.saving = true; this.recorder.stop(); } }
  private cleanUp() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null; this.recorder = null; this.chunks = []; this.saving = false;
  }
}
