/* =========================================================
   firebase-backend.js — Backend real: Firebase «zimrat» + Cloudinary
   ---------------------------------------------------------
   · Auth       → js/firebase/auth.js (solo config.ADMIN_EMAIL es administrador)
   · Firestore  → colecciones:
       songs      { number, title, artist, key, category, tags[], lyricsText,
                    pdfLinks: { lyrics, chords, score }, bpm, timeSignature,
                    audioUrl, updatedAt }      (lectura pública, escritura admin)
       feedback   buzón de sugerencias        (envío público, lectura admin)
       errorLogs  registro de errores          (envío público, lectura admin)
       cloudinaryTrash  PDFs que ya no usa ninguna canción (solo admin;
                  ver la nota técnica de cloudinary.js)
   · PDFs       → Cloudinary (subida directa sin firma, ver cloudinary.js);
                  en Firestore se guarda la URL segura (https://res.cloudinary.com/…)
   · Tiempo real: onSnapshot actualiza la lista en todos los dispositivos.
   · Offline: caché persistente de Firestore (IndexedDB).
   Dentro de la app se usan nombres en español; fromDoc/toDoc traducen.
   ========================================================= */
import config from '../../config.js';
import { FORMAT_KEYS, normalizeSong, keyToName, parseKey } from '../utils.js';
import { uploadPdf, deleteByToken, publicIdFromUrl, isCloudinaryUrl } from './cloudinary.js';
import { logError } from './logger.js';

// SDK: URL base de los módulos de Firebase (misma versión en todos).
// LINK_KEYS: traduce el nombre interno de cada formato al campo de Firestore.
const SDK = 'https://www.gstatic.com/firebasejs/11.0.1';
const LINK_KEYS = { letra: 'lyrics', acordes: 'chords', partitura: 'score' };

// fromDoc: DOCUMENTO de Firestore (inglés) → CANCIÓN de la app (español).
// snap.id es el id del documento; snap.data() devuelve sus campos.
// También lee campos de versiones anteriores para no perder datos viejos.
function fromDoc(snap) {
  const d = snap.data();
  return normalizeSong({
    id: snap.id,
    numero: d.number,
    titulo: d.title,
    autor: d.artist,
    tono: parseKey(d.key),                     // "Re Mayor" → "D"
    categoria: d.category,
    tags: d.tags,
    letraTexto: d.lyricsText || d.chordsText,  // chordsText: versión anterior
    audioUrl: d.audioUrl,
    bpm: d.bpm,
    compas: d.timeSignature,
    letra: d.pdfLinks?.lyrics || null,
    acordes: d.pdfLinks?.chords || null,
    partitura: d.pdfLinks?.score || d.scorePdfUrl || null, // scorePdfUrl: versión anterior
  });
}

// toDoc: CANCIÓN de la app → DOCUMENTO de Firestore. Debe incluir solo los
// campos que permite firestore.rules (validSong), o el servidor lo rechaza.
// serverTimestamp(): la fecha la pone el servidor (no el reloj del móvil).
function toDoc(data, pdfLinks, serverTimestamp) {
  return {
    number: data.numero,
    title: data.titulo,
    artist: data.autor || '',
    key: keyToName(data.tono) || data.tono || '',   // "D" → "Re Mayor"
    category: data.categoria || '',
    tags: data.tags || [],
    lyricsText: data.letraTexto || '',
    pdfLinks,
    audioUrl: data.audioUrl || '',
    bpm: data.bpm ?? null,
    timeSignature: data.compas || '',
    updatedAt: serverTimestamp(),
  };
}

// Códigos de error de Firestore → mensajes comprensibles para el admin.
const FIRESTORE_ERRORS = {
  'permission-denied': 'Permiso denegado. Revisa que hayas iniciado sesión con zimratapp@gmail.com y que firestore.rules esté publicado.',
  unavailable: 'Firestore no está disponible ahora (¿sin conexión?).',
  'failed-precondition': 'Firestore no está listo. ¿Creaste la base de datos en la consola de Firebase?',
  'not-found': 'No se encontró la base de datos de Firestore. Créala en la consola de Firebase.',
  timeout: 'Firestore no respondió a tiempo.',
};
const friendly = (err) => Object.assign(new Error(FIRESTORE_ERRORS[err?.code] || err?.message || 'Error de Firebase.'), { code: err?.code });
// withTimeout: Promise.race «hace competir» la operación con un temporizador;
// si el temporizador gana, se rechaza con código 'timeout'. Evita que la
// interfaz se quede esperando para siempre con mala conexión.
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);

// createBackend: se llama UNA vez desde backend.js. Carga los módulos con
// import() dinámico (en modo demo no se descarga nada de Firebase), abre
// Firestore, espera a conocer la sesión y devuelve el objeto con todos los
// métodos que usa la app.
export async function createBackend() {
  const { app, usingEmulators, startAnalytics } = await import('../firebase/init.js');
  const { loginAdmin, logoutAdmin, listenAuthState } = await import('../firebase/auth.js');
  const fs = await import(`${SDK}/firebase-firestore.js`);

  let db;
  try {
    // persistentLocalCache: Firestore guarda una copia de los datos en
    // IndexedDB → la app abre y lee canciones aunque no haya internet.
    // persistentMultipleTabManager: varias pestañas comparten esa caché.
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.initializeFirestore(app, {}); // navegadores sin IndexedDB: solo memoria
  }
  if (usingEmulators) {
    const { host, firestorePort } = config.FIREBASE_EMULATORS;
    fs.connectFirestoreEmulator(db, host, firestorePort);
  }
  // Analytics se arranca sin esperar (no bloquea la carga).
  startAnalytics();

  // Referencias a las colecciones (como «tablas») de la base de datos.
  const songsCol = fs.collection(db, 'songs');
  const feedbackCol = fs.collection(db, 'feedback');
  const logsCol = fs.collection(db, 'errorLogs');
  const trashCol = fs.collection(db, 'cloudinaryTrash');

  /**
   * Apunta en «cloudinaryTrash» los PDFs de Cloudinary que dejan de usarse
   * (canción eliminada, PDF reemplazado o quitado). No bloquea: si falla,
   * solo se registra el error; la canción ya quedó guardada/eliminada.
   */
  async function trashFiles(urls, songTitle, reason) {
    const list = [...new Set(urls)].filter((u) => isCloudinaryUrl(u));
    for (const url of list) {
      try {
        await withTimeout(fs.addDoc(trashCol, {
          url: url.slice(0, 500), publicId: publicIdFromUrl(url).slice(0, 300),
          songTitle: String(songTitle || '').slice(0, 200), reason, createdAt: fs.serverTimestamp(),
        }), 10000);
      } catch (err) {
        logError('firestore', err, { accion: 'apuntar PDF huérfano', url: url.slice(0, 200) });
      }
    }
    return list.length;
  }

  /** Ejecuta una operación de Firestore; si falla, la registra y lanza un error claro. */
  // guard: envoltorio común para operaciones de Firestore. Añade tiempo
  // límite, registra el fallo en el registro de errores y lo traduce a un
  // mensaje claro. Los errores de validación propios (sin code) pasan tal cual.
  async function guard(action, fn, ms = 15000) {
    try {
      return await withTimeout(fn(), ms);
    } catch (err) {
      if (!err.code || err.code === 'formato') throw err; // errores de validación propios
      logError('firestore', err, { accion: action });
      throw friendly(err);
    }
  }

  /**
   * Borrado REAL en Firestore (no solo en pantalla) para buzón y registro.
   * · 1 documento  → deleteDoc(doc(db, colección, id))
   * · varios       → writeBatch en lotes de 400 (límite de Firestore: 500)
   * · Exige sesión de admin y conexión: sin internet, Firestore dejaría el
   *   borrado «pendiente» en la caché local y la base de datos no cambiaría
   *   hasta reconectar; así el admin sabe en el momento si se borró.
   * · La promesa solo se resuelve cuando el SERVIDOR confirma el borrado
   *   (las reglas exigen ser zimratapp@gmail.com). Si falla, lanza un error
   *   claro y la interfaz NO quita el elemento de la lista.
   * · No usa guard(): si falla el borrado de un registro de errores no se
   *   crea otro registro (evita bucles).
   */
  /** Lee del SERVIDOR (lo borrado no reaparece desde la caché); sin conexión, usa la caché. */
  async function fresh(q) {
    if (!navigator.onLine) return fs.getDocs(q);
    try { return await fs.getDocsFromServer(q); } catch (err) {
      if (err?.code === 'permission-denied') throw err;
      return fs.getDocs(q);
    }
  }

  async function deleteForever(colName, ids) {
    requireAdmin();
    const list = [...new Set(ids)].filter(Boolean);
    try {
      if (list.length === 1) {
        await withTimeout(fs.deleteDoc(fs.doc(db, colName, list[0])), 15000);
      } else {
        for (let i = 0; i < list.length; i += 400) {
          const batch = fs.writeBatch(db);
          list.slice(i, i + 400).forEach((id) => batch.delete(fs.doc(db, colName, id)));
          await withTimeout(batch.commit(), 20000);
        }
      }
      return list.length;
    } catch (err) {
      console.error(`[Zimrat] No se pudo borrar en «${colName}»`, err);
      throw friendly(err);
    }
  }

  // Se espera la PRIMERA respuesta de Auth antes de devolver el backend:
  // así la app sabe desde el inicio si hay un admin conectado (sin parpadeo
  // del botón «Admin»). Después, cada cambio de sesión se notifica a los
  // «listeners» (app.js se suscribe con onAuthChange).
  /* ---------- Sesión ---------- */
  const listeners = new Set();
  let session = null;
  await new Promise((resolve) => {
    let first = true;
    listenAuthState((isAdmin, user) => {
      const next = isAdmin ? { email: user.email, uid: user.uid } : null;
      const changed = (next?.uid || null) !== (session?.uid || null);
      session = next;
      if (first) { first = false; resolve(); } else if (changed) listeners.forEach((fn) => fn(session));
    });
  });

  // Comprobación en el CLIENTE antes de escribir (da mensajes claros).
  // La comprobación definitiva la hace el SERVIDOR con firestore.rules.
  const requireAdmin = () => {
    if (!session) throw new Error('Debes iniciar sesión como administrador.');
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para guardar o eliminar datos.');
  };

  return {
    mode: 'firebase',
    emulators: usingEmulators,
    pdfMode: 'upload', // el formulario sube archivos PDF (a Cloudinary)

    /* ----- Canciones ----- */
    // getDocs: lectura única de toda la colección. docs.map(fromDoc) convierte
    // cada documento en una canción.
    listSongs: () => guard('leer canciones', async () => (await fs.getDocs(songsCol)).docs.map(fromDoc)),

    /** Tiempo real: callback(canciones) cada vez que cambian en Firestore. Devuelve la función para dejar de escuchar. */
    // onSnapshot: «suscripción» en tiempo real. Firestore envía la colección
    // completa al principio y de nuevo cada vez que cambia algo. snap.metadata
    // .fromCache indica si los datos vienen de la caché local (sin conexión).
    watchSongs(callback) {
      return fs.onSnapshot(songsCol, (snap) => callback(snap.docs.map(fromDoc), snap.metadata.fromCache),
        (err) => logError('firestore', err, { accion: 'escuchar cambios de canciones' }));
    },

    resolvePdfUrl: (ref) => ref || null, // las URLs de Cloudinary se descargan directamente

    // Descarga el PDF de Cloudinary con fetch() y devuelve un Blob (bytes).
    // Cloudinary permite peticiones desde otros dominios (CORS), por eso
    // PDF.js puede leerlo. Cada fallo se traduce a un mensaje útil:
    // 401/403 = la entrega de PDFs está bloqueada en la configuración.
    async getPdfBlob(url) {
      if (/drive\.google\.com/.test(url)) throw Object.assign(new Error('Este PDF es un enlace antiguo de Google Drive. Edita la canción y sube el PDF de nuevo.'), { code: 'drive' });
      let res;
      try { res = await fetch(url); } catch (err) { throw Object.assign(new Error('No se pudo descargar el PDF (¿sin conexión?).'), { code: 'red', cause: err }); }
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Cloudinary bloqueó el PDF. Activa «Allow delivery of PDF and ZIP files» en Cloudinary → Settings → Security.'), { code: String(res.status) });
      if (!res.ok) throw Object.assign(new Error(`No se pudo descargar el PDF (error ${res.status}).`), { code: String(res.status) });
      return res.blob();
    },

    getSession: () => session,
    onAuthChange: (fn) => listeners.add(fn),

    // Inicia sesión (auth.js). Los errores de credenciales no se registran
    // (son normales); los demás (red, configuración) sí.
    async signIn(email, password) {
      const result = await loginAdmin(email, password);
      if (!result.success) {
        const credential = ['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'];
        if (result.code && !credential.includes(result.code)) logError('auth', Object.assign(new Error(result.error), { code: result.code }), { accion: 'login' });
        throw new Error(result.error);
      }
      session = { email: result.user.email, uid: result.user.uid };
      listeners.forEach((fn) => fn(session));
      return session;
    },

    async signOut() {
      await logoutAdmin();
      session = null;
      listeners.forEach((fn) => fn(null));
    },

    /**
     * Crea o actualiza una canción.
     * changes = { files: { letra?: File, … }, remove: { letra?: true, … }, onProgress?(formato, %) }
     * Primero sube los PDFs nuevos a Cloudinary y luego guarda el documento.
     */
    // FLUJO DE GUARDADO:
    //   1. ¿Número repetido? (Firestore no tiene «único»: se consulta con where)
    //   2. Si es edición, se leen los enlaces anteriores (prev).
    //   3. Por cada formato: si hay archivo nuevo → se sube a Cloudinary;
    //      si se marcó quitar → enlace vacío; si no → se conserva el anterior.
    //   4. setDoc guarda el documento completo (crea o reemplaza).
    //   5. Los PDFs que dejan de usarse se apuntan en «cloudinaryTrash».
    //   Si algo falla tras subir, rollback() intenta deshacer las subidas.
    async saveSong(data, { files = {}, remove = {}, onProgress } = {}) {
      requireAdmin();
      const dup = await guard('comprobar número', () => fs.getDocs(fs.query(songsCol, fs.where('number', '==', data.numero))));
      const clash = dup.docs.find((d) => d.id !== data.id);
      if (clash) throw new Error(`El número ${data.numero} ya lo usa «${clash.data().title}».`);

      // fs.doc(songsCol) sin id genera un id nuevo automáticamente (canción nueva).
      const ref = data.id ? fs.doc(db, 'songs', data.id) : fs.doc(songsCol);
      const prev = data.id ? (await guard('leer canción', () => fs.getDoc(ref))).data() : null;
      const pdfLinks = {};
      const uploaded = [];  // subidas de este guardado (para deshacerlas si algo falla)
      const replaced = [];  // PDFs anteriores que dejan de usarse
      // Si falla algo después de subir, intenta borrar lo recién subido (delete_token)
      // y apunta como huérfano lo que no se pudo borrar.
      const rollback = async () => {
        const left = [];
        for (const u of uploaded) if (!(await deleteByToken(u.deleteToken))) left.push(u.url);
        if (left.length) await trashFiles(left, data.titulo, 'subida sin guardar');
      };
      for (const [key, field] of Object.entries(LINK_KEYS)) {
        const old = prev?.pdfLinks?.[field] || (field === 'score' ? prev?.scorePdfUrl : '') || '';
        if (files[key]) {
          try {
            const up = await uploadPdf(files[key], (pct) => onProgress?.(key, pct));
            uploaded.push(up);
            pdfLinks[field] = up.url;
            if (old && old !== up.url) replaced.push(old);
          } catch (err) {
            logError('cloudinary', err, { archivo: files[key].name, tamano: files[key].size, cancion: data.titulo });
            await rollback();
            throw err;
          }
        } else {
          pdfLinks[field] = remove[key] ? '' : old;
          if (remove[key] && old) replaced.push(old);
        }
      }
      try {
        await guard(data.id ? 'editar canción' : 'crear canción', () => fs.setDoc(ref, toDoc(data, pdfLinks, fs.serverTimestamp)));
      } catch (err) {
        await rollback();
        throw err;
      }
      if (replaced.length) await trashFiles(replaced, data.titulo, 'reemplazado o quitado');
      return ref.id;
    },

    /**
     * Elimina la canción. Orden: 1) se borra el documento de Firestore (la
     * canción desaparece al instante en todos los dispositivos); 2) sus PDFs
     * de Cloudinary se apuntan en «cloudinaryTrash» para borrarlos después
     * (ver nota técnica en cloudinary.js). Devuelve { orphaned: nº de PDFs }.
     */
    async deleteSong(song) {
      requireAdmin();
      await guard('eliminar canción', () => fs.deleteDoc(fs.doc(db, 'songs', song.id)));
      const orphaned = await trashFiles(FORMAT_KEYS.map((k) => song[k]).filter(Boolean), `#${song.numero} ${song.titulo}`, 'canción eliminada');
      return { orphaned };
    },

    /* ----- PDFs huérfanos en Cloudinary (solo admin) ----- */
    // Lista de PDFs sin uso (ver nota técnica en cloudinary.js).
    cloudinaryCleanup: true,
    listTrash: () => guard('leer PDFs huérfanos', async () => (await fs.getDocs(fs.query(trashCol, fs.orderBy('createdAt', 'desc'), fs.limit(300)))).docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toMillis?.() || Date.now() }))),
    deleteTrash: (id) => guard('quitar de la lista', () => fs.deleteDoc(fs.doc(db, 'cloudinaryTrash', id))),
    async clearTrash(ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = fs.writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => batch.delete(fs.doc(db, 'cloudinaryTrash', id)));
        await guard('vaciar lista', () => batch.commit());
      }
    },

    /* ----- Conexión real con el servidor de Firestore (sin caché) ----- */
    // getDocsFromServer obliga a preguntar al servidor (ignora la caché):
    // así se sabe si hay conexión REAL con Firestore. performance.now() mide
    // cuánto tardó (latencia en ms).
    async checkConnection() {
      if (!navigator.onLine) return { ok: false, message: 'El dispositivo no tiene conexión a internet.' };
      const t0 = performance.now();
      try {
        await withTimeout(fs.getDocsFromServer(fs.query(songsCol, fs.limit(1))), 8000);
        return { ok: true, ms: Math.round(performance.now() - t0) };
      } catch (err) {
        return {
          ok: false,
          error: err,
          message: err.code === 'permission-denied' ? 'Firestore responde, pero las reglas niegan la lectura.'
            : err.code === 'timeout' ? 'Firestore no respondió en 8 segundos.' : (FIRESTORE_ERRORS[err.code] || err.message || 'Error de conexión.'),
        };
      }
    },

    /* ----- Buzón de sugerencias (colección «feedback») ----- */
    // addDoc crea un documento con id automático. read: false = «sin leer».
    sendFeedback: (data) => guard('enviar sugerencia', () => fs.addDoc(feedbackCol, { ...data, read: false, createdAt: fs.serverTimestamp() })),
    listFeedback: () => guard('leer sugerencias', async () => (await fresh(fs.query(feedbackCol, fs.orderBy('createdAt', 'desc'), fs.limit(200)))).docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toMillis?.() || Date.now() }))),
    markFeedbackRead: (id) => guard('marcar sugerencia leída', () => fs.updateDoc(fs.doc(db, 'feedback', id), { read: true })),
    /** Borra DEFINITIVAMENTE la sugerencia en Firestore: deleteDoc(doc(db, 'feedback', id)). */
    deleteFeedback: (id) => deleteForever('feedback', [id]),
    /** Borra varias sugerencias (p. ej. todas las leídas) en lotes. */
    clearFeedback: (ids) => deleteForever('feedback', ids),

    /* ----- Registro de errores (colección «errorLogs») ----- */
    // logSink: destino del registro de errores (lo usa logger.js). No usa
    // guard() para no crear un bucle (un error al registrar un error).
    logSink: (entry) => fs.addDoc(logsCol, { ...entry, createdAt: fs.serverTimestamp() }),
    listLogs: async () => (await withTimeout(fresh(fs.query(logsCol, fs.orderBy('createdAt', 'desc'), fs.limit(200))), 15000)).docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toMillis?.() || Date.now() })),
    /** Borra DEFINITIVAMENTE el registro en Firestore: deleteDoc(doc(db, 'errorLogs', id)). */
    deleteLog: (id) => deleteForever('errorLogs', [id]),
    /** Vacía el historial: borra en Firestore todos los ids indicados. */
    clearLogs: (ids) => deleteForever('errorLogs', ids),
  };
}
