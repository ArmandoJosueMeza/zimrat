/* =========================================================
   db.js — Almacenamiento local con IndexedDB
   - store "songs": { numero, titulo, letra:{fileId,name}|null, partitura:{...}|null }
   - store "files": { id, blob, name }
   ========================================================= */
'use strict';

const DB = (() => {
  const NAME = 'cancionero';
  const VERSION = 1;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'numero' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    getAllSongs: () => run('songs', 'readonly', (s) => s.getAll()),
    getSong: (numero) => run('songs', 'readonly', (s) => s.get(numero)),
    putSong: (song) => run('songs', 'readwrite', (s) => s.put(song)),
    deleteSong: (numero) => run('songs', 'readwrite', (s) => s.delete(numero)),
    getFile: (id) => run('files', 'readonly', (s) => s.get(id)),
    putFile: (file) => run('files', 'readwrite', (s) => s.put(file)),
    deleteFile: (id) => run('files', 'readwrite', (s) => s.delete(id)),
  };
})();
