// Audio stays in IndexedDB on this browser; each chunk commits separately.
export class RecordingStore {
  constructor() { this.db = null; }
  async open() {
    if (!this.db) this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open('karaoke.recordings.v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('takes', { keyPath: 'id' });
        request.result.createObjectStore('chunks', { keyPath: ['id', 'index'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.db = null; reject(request.error); };
      request.onblocked = () => { this.db = null; reject(new Error('錄音資料庫被其他分頁占用。')); };
    });
    return this.db;
  }
  async transaction(mode, work) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['takes', 'chunks'], mode); let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('錄音儲存失敗。'));
      work(tx, value => { result = value; });
    });
  }
  save(meta, chunk, index, track = 'mix') {
    return this.transaction('readwrite', tx => {
      tx.objectStore('takes').put(meta);
      if (chunk) tx.objectStore('chunks').put({ id: track === 'voice' ? meta.id + ':voice' : meta.id, index, blob: chunk });
    });
  }
  list() {
    return this.transaction('readonly', (tx, done) => {
      tx.objectStore('takes').getAll().onsuccess = event => done(event.target.result.filter(x => x.bytes > 0).sort((a,b) => b.created - a.created));
    });
  }
  blob(meta, track = 'mix') {
    const id = track === 'voice' ? meta.id + ':voice' : meta.id;
    return this.transaction('readonly', (tx, done) => {
      tx.objectStore('chunks').getAll(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER])).onsuccess = event => done(new Blob(event.target.result.map(x => x.blob), { type: meta.mime }));
    });
  }
  delete(id) {
    return this.transaction('readwrite', tx => {
      tx.objectStore('takes').delete(id);
      tx.objectStore('chunks').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));
      tx.objectStore('chunks').delete(IDBKeyRange.bound([id+':voice',0],[id+':voice',Number.MAX_SAFE_INTEGER]));
    });
  }
}
