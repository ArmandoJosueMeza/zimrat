/* =========================================================
   logger.js — Registro de errores del sistema
   ---------------------------------------------------------
   logError(fuente, error, contexto) registra cualquier fallo:
     fuentes: 'firestore' | 'cloudinary' | 'red' | 'pdf' | 'auth' | 'javascript'
   · Destino: el backend activo (Firebase → colección «errorLogs»;
     demo → este navegador). Lo configura app.js con setLogSink().
   · Sin conexión, los errores esperan en localStorage y se envían al volver.
   · Anti-spam: sin duplicados y máximo 25 por visita.
   · También captura errores no controlados (window.onerror y promesas).
   Solo el administrador puede ver el registro (Panel → Registro de errores).
   ========================================================= */
// QUEUE_KEY: cola de errores pendientes en localStorage (sin conexión).
// SOURCES: orígenes válidos (coinciden con firestore.rules).
// MAX_PER_VISIT: tope para no inundar la base de datos si algo falla en bucle.
const QUEUE_KEY = 'zimrat-error-queue';
const SOURCES = ['firestore', 'cloudinary', 'red', 'pdf', 'auth', 'javascript'];
const MAX_PER_VISIT = 25;

// sink («sumidero»): función que guarda cada error en su destino final.
// La configura app.js con setLogSink(); este archivo no sabe si es
// Firebase o el modo demo (así el registro no depende del backend).
let sink = null;          // async (entry) => void
let role = 'publico';
const seen = new Set();
let count = 0;
const listeners = new Set();

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50))); } catch { /* sin almacenamiento */ } };
const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
const notify = () => listeners.forEach((fn) => fn());

export const setLogRole = (isAdmin) => { role = isAdmin ? 'admin' : 'publico'; };
export const onLogsChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const pendingLogs = () => readQueue();

export function setLogSink(fn) {
  sink = fn;
  flushLogQueue();
}

// logError(origen, error, contexto): lo llaman todos los servicios.
// 1. Siempre lo muestra en la consola del navegador (para depurar).
// 2. Evita duplicados (mismo origen + mensaje) y respeta el tope por visita.
// 3. Recorta cada campo al tamaño que permiten las reglas de Firestore.
// 4. Con conexión → lo envía (máx. 10 s); sin conexión o si falla → a la cola.
export async function logError(source, err, context = {}) {
  console.error(`[Zimrat:${source}]`, err, context);
  const src = SOURCES.includes(source) ? source : 'javascript';
  const message = String(err?.message || err || 'Error desconocido').slice(0, 1000);
  const key = `${src}|${message}`;
  if (seen.has(key) || count >= MAX_PER_VISIT) return;
  seen.add(key);
  count++;
  const entry = {
    source: src,
    message,
    code: String(err?.code ?? err?.status ?? '').slice(0, 100),
    context: JSON.stringify(context).slice(0, 500),
    page: (location.pathname + location.hash).slice(0, 200),
    userAgent: navigator.userAgent.slice(0, 300),
    online: navigator.onLine,
    userRole: role,
  };
  if (!sink || !navigator.onLine) {
    writeQueue([...readQueue(), { ...entry, at: Date.now() }]);
  } else {
    try { await timeout(sink(entry), 10000); } catch { writeQueue([...readQueue(), { ...entry, at: Date.now() }]); }
  }
  notify();
}

// Envía los errores que esperaban en la cola (al recuperar la conexión o al
// configurar el destino). Los que vuelven a fallar regresan a la cola.
export async function flushLogQueue() {
  const queue = readQueue();
  if (!sink || !queue.length || !navigator.onLine) return;
  writeQueue([]);
  const failed = [];
  for (const { at, ...entry } of queue) {
    try {
      await timeout(sink({ ...entry, context: `${entry.context} · registrado sin conexión: ${new Date(at).toISOString()}`.slice(0, 500) }), 10000);
    } catch {
      failed.push({ ...entry, at });
    }
  }
  if (failed.length) writeQueue([...failed, ...readQueue()]);
  notify();
}

/** Errores no controlados de toda la página */
// Captura errores NO controlados de toda la página:
// · 'error': excepciones de JavaScript.
// · 'unhandledrejection': promesas rechazadas sin .catch() ni try/catch.
// · 'online': al volver internet, envía la cola pendiente.
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    if (!e.error && !e.message) return; // errores de carga de recursos sin mensaje
    logError('javascript', e.error || e.message, { archivo: e.filename, linea: e.lineno });
  });
  window.addEventListener('unhandledrejection', (e) => logError('javascript', e.reason || 'Promesa rechazada'));
  window.addEventListener('online', () => flushLogQueue());
}
