/* =========================================================
   demo-backend.js — MODO DEMO
   - Canciones y PDFs subidos: IndexedDB (solo en este navegador)
     Base «zimrat-demo» · almacenes: songs, files
   - Datos iniciales: songs.json + carpeta /pdfs (1ª vez)
   - Login SIMULADO con las credenciales de config.js
   - Buzón de sugerencias y registro de errores: localStorage de este navegador
   ⚠️ No es seguro: cualquiera puede leer config.js. Úsalo para probar.
   // ---------------------------------------------------------
   // Implementa EXACTAMENTE la misma interfaz que firebase-backend.js
   // (listSongs, saveSong, signIn…). Gracias a eso, los componentes no
   // saben si hablan con la nube o con el navegador: backend.js elige uno
   // según config.BACKEND. Es el patrón «adaptador».
   // =========================================================
   ========================================================= */
import { FORMAT_KEYS, uid, norm, normalizeSong, storageGet, storageSet } from '../utils.js';

// Metadatos editables de cada canción
// Campos de la canción que se copian desde el formulario al guardar.
const META = ['numero', 'titulo', 'autor', 'tono', 'categoria', 'tags', 'letraTexto', 'audioUrl', 'bpm', 'compas'];

const DB_NAME = 'zimrat-demo';
const DB_VERSION = 1;
const SEED_FLAG = 'zimrat-demo-seeded';
const SESSION_KEY = 'zimrat-demo-session';
const FEEDBACK_KEY = 'zimrat-demo-feedback';
const LOGS_KEY = 'zimrat-demo-logs';
// Ayudantes para listas guardadas en localStorage (buzón y registro).
// writeList guarda como máximo 300 elementos para no llenar el almacenamiento.
const readList = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
const writeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list.slice(0, 300))); } catch { /* sin espacio */ } };
// Los PDFs subidos en demo se guardan en IndexedDB; en la canción se anota
// una referencia del tipo «idb:<id>» para saber dónde buscarlos.
const LOCAL_PREFIX = 'idb:'; // referencias a PDFs guardados en IndexedDB

/* ---------- IndexedDB ---------- */
let dbPromise;
// IndexedDB: base de datos del navegador capaz de guardar archivos (Blob).
// Su API original usa eventos (onsuccess/onerror); aquí se envuelve en una
// Promise para poder usar await. onupgradeneeded crea los «almacenes»
// (songs, files) la primera vez. dbPromise ??= abre la base solo una vez.
function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      for (const name of ['songs', 'files']) {
        if (!names.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
// tx(): ejecuta una operación dentro de una «transacción» (readonly o
// readwrite) y espera a que termine (oncomplete) o falle.
async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Operación cancelada (¿sin espacio?)'));
  });
}
// Atajos legibles: db.all('songs'), db.put('files', registro)…
const db = {
  all: (s) => tx(s, 'readonly', (st) => st.getAll()),
  get: (s, id) => tx(s, 'readonly', (st) => st.get(id)),
  put: (s, v) => tx(s, 'readwrite', (st) => st.put(v)),
  del: (s, id) => tx(s, 'readwrite', (st) => st.delete(id)),
  clear: (s) => tx(s, 'readwrite', (st) => st.clear()),
};

/* ---------- Datos iniciales ---------- */
async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? await res.json() : [];
  } catch {
    return []; // sin archivo: se empieza vacío
  }
}

// Primera visita: carga las canciones de ejemplo de songs.json.
async function seed() {
  for (const s of await fetchJson('songs.json')) {
    await db.put('songs', normalizeSong({ ...s, id: uid() }));
  }
  storageSet(SEED_FLAG, '1');
}

// delay(): espera artificial para simular la latencia de una red real.
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createBackend(config) {
  const existing = await db.all('songs');
  if (!existing.length && !storageGet(SEED_FLAG)) await seed();

  const listeners = new Set();
  const notify = (s) => listeners.forEach((fn) => fn(s));
  // La «sesión» demo se guarda en sessionStorage: se borra al cerrar la
  // pestaña. No hay seguridad real (cualquiera puede ver config.js).
  const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } };
  const requireAdmin = () => { if (!readSession()) throw new Error('Debes iniciar sesión como administrador.'); };
  const isLocal = (ref) => typeof ref === 'string' && ref.startsWith(LOCAL_PREFIX);
  const deleteLocal = (ref) => (isLocal(ref) ? db.del('files', ref.slice(LOCAL_PREFIX.length)) : null);

  return {
    mode: 'demo',
    pdfMode: 'upload',
    // resolvePdfUrl: URL descargable para «guardar sin conexión»; los PDFs
    // de IndexedDB ya están en el dispositivo, así que devuelve null.
    resolvePdfUrl: (ref) => (isLocal(ref) ? null : ref), // los subidos ya están en el dispositivo

    listSongs: async () => (await db.all('songs')).map(normalizeSong),

    // getPdfBlob: devuelve los bytes del PDF (Blob) para que PDF.js lo dibuje,
    // desde IndexedDB o descargándolo (PDFs de ejemplo de la carpeta /pdfs).
    async getPdfBlob(ref) {
      if (isLocal(ref)) {
        const rec = await db.get('files', ref.slice(LOCAL_PREFIX.length));
        if (!rec) throw new Error('El archivo ya no existe en este navegador.');
        return rec.blob;
      }
      const res = await fetch(ref);
      if (!res.ok) throw new Error(`No se pudo descargar el PDF (${res.status}).`);
      return res.blob();
    },

    getSession: readSession,
    onAuthChange: (fn) => listeners.add(fn),

    // Login simulado: compara con las credenciales de config.js.
    // notify() avisa a app.js (onAuthChange) de que hay sesión.
    async signIn(email, password) {
      await delay(350); // simula la red
      const ok = norm(email) === norm(config.DEMO_ADMIN_EMAIL) && password === config.DEMO_ADMIN_PASSWORD;
      if (!ok) throw new Error('Correo o contraseña incorrectos.');
      const session = { email: config.DEMO_ADMIN_EMAIL };
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignorar */ }
      notify(session);
      return session;
    },

    async signOut() {
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignorar */ }
      notify(null);
    },

    async saveSong(data, { files = {}, remove = {}, onProgress } = {}) {
      requireAdmin();
      const all = await db.all('songs');
      const dup = all.find((s) => s.numero === data.numero && s.id !== data.id);
      if (dup) throw new Error(`El número ${data.numero} ya lo usa «${dup.titulo}».`);

      const song = data.id
        ? { ...(await db.get('songs', data.id)) }
        : { id: uid(), letra: null, acordes: null, partitura: null };
      for (const key of META) song[key] = data[key];

      for (const key of FORMAT_KEYS) {
        if (files[key]) {
          const fileId = uid();
          onProgress?.(key, 100); // demo: se guarda al instante en este navegador
          await db.put('files', { id: fileId, blob: files[key], name: files[key].name });
          await deleteLocal(song[key]);
          song[key] = LOCAL_PREFIX + fileId;
        } else if (remove[key]) {
          await deleteLocal(song[key]);
          song[key] = null;
        }
      }
      await db.put('songs', normalizeSong(song));
      navigator.storage?.persist?.();
      return song;
    },

    async deleteSong(song) {
      requireAdmin();
      for (const key of FORMAT_KEYS) await deleteLocal(song[key]);
      await db.del('songs', song.id);
    },

    /* ----- Conexión (simulada: siempre disponible salvo sin internet) ----- */
    async checkConnection() {
      return navigator.onLine ? { ok: true, ms: 0, demo: true } : { ok: false, message: 'El dispositivo no tiene conexión a internet.' };
    },

    /* ----- Buzón de sugerencias (localStorage) ----- */
    async sendFeedback(data) {
      writeList(FEEDBACK_KEY, [{ ...data, id: uid('fb-'), read: false, createdAt: Date.now() }, ...readList(FEEDBACK_KEY)]);
    },
    async listFeedback() { requireAdmin(); return readList(FEEDBACK_KEY); },
    async markFeedbackRead(id) { requireAdmin(); writeList(FEEDBACK_KEY, readList(FEEDBACK_KEY).map((f) => (f.id === id ? { ...f, read: true } : f))); },
    async deleteFeedback(id) { requireAdmin(); writeList(FEEDBACK_KEY, readList(FEEDBACK_KEY).filter((f) => f.id !== id)); },
    async clearFeedback(ids) { requireAdmin(); const set = new Set(ids); writeList(FEEDBACK_KEY, readList(FEEDBACK_KEY).filter((f) => !set.has(f.id))); },

    /* ----- Registro de errores (localStorage) ----- */
    async logSink(entry) { writeList(LOGS_KEY, [{ ...entry, id: uid('log-'), createdAt: Date.now() }, ...readList(LOGS_KEY)]); },
    async listLogs() { requireAdmin(); return readList(LOGS_KEY); },
    async deleteLog(id) { requireAdmin(); writeList(LOGS_KEY, readList(LOGS_KEY).filter((l) => l.id !== id)); },
    async clearLogs(ids) { requireAdmin(); const set = new Set(ids); writeList(LOGS_KEY, readList(LOGS_KEY).filter((l) => !set.has(l.id))); },

    /* ----- PDFs huérfanos: en demo los PDFs viven en IndexedDB y se borran al instante ----- */
    cloudinaryCleanup: false,
    async listTrash() { return []; },
    async deleteTrash() {},
    async clearTrash() {},

    async resetDemo() {
      requireAdmin();
      await db.clear('songs');
      await db.clear('files');
      await seed();
    },
  };
}
