/* =========================================================
   backend.js — Elige automáticamente el origen de datos
   ---------------------------------------------------------
   Ambos backends exponen la MISMA interfaz, así los componentes
   no necesitan saber de dónde vienen los datos:

     mode                       'demo' | 'firebase'
     listSongs()                → [{ id, numero, titulo, autor, tono, categoria, tags[],
                                     letraTexto, audioUrl, bpm, compas,
                                     letra, acordes, partitura }]
                                   (letra/acordes/partitura = referencia al PDF, o null)
     getPdfBlob(ref)            → Blob del PDF
     getSession()               → { email } | null
     onAuthChange(fn)           fn(session) al entrar/salir
     signIn(email, password)    → { email }   (lanza Error si falla)
     signOut()
     saveSong(data, changes)    crea o actualiza
         data    = { id?, numero, titulo, autor, tono, categoria, tags,
                     letraTexto, audioUrl, bpm, compas }
         changes = { files: { letra?: File, ... }, remove: { letra?: true, ... }, onProgress?(formato, %) }
     deleteSong(song)
     pdfMode                    'upload' (se suben archivos PDF: demo → IndexedDB, Firebase → Cloudinary)
     resolvePdfUrl(ref)         URL descargable del PDF (para guardarlo sin conexión) o null
     watchSongs(fn)             (opcional) tiempo real: fn(canciones) en cada cambio
     checkConnection()          → { ok, ms } | { ok: false, message }
     sendFeedback(data) · listFeedback() · markFeedbackRead(id) · deleteFeedback(id)
     logSink(entry) · listLogs() · deleteLog(id) · clearLogs(ids)
     resetDemo()                (solo modo demo)

   Los REPERTORIOS no pasan por el backend: son locales de cada usuario
   (ver setlists.js).

   Además, getBackend() envuelve listSongs con una
   COPIA SIN CONEXIÓN: si la red falla, devuelve los últimos datos
   guardados y marca backend.fromCache = true.
   ========================================================= */
import config from '../../config.js';
import { saveData, loadData } from './offline.js';

// instance: el backend se crea una sola vez y se reutiliza (patrón «singleton»).
let instance;

export const usesFirebase = () => config.BACKEND === 'firebase';

// import() dinámico: solo se descarga el archivo del backend elegido.
// Así el modo demo no descarga Firebase y viceversa.
export async function getBackend() {
  if (instance) return instance;
  const module = usesFirebase()
    ? await import('./firebase-backend.js')
    : await import('./demo-backend.js');
  const impl = await module.createBackend(config);
  instance = withOfflineCopy(impl);
  return instance;
}

/** Guarda cada lectura correcta; si la red falla, usa la última copia. */
// Object.create(impl) crea un objeto que «hereda» todos los métodos del
// backend real; luego se sustituye solo listSongs por una versión que:
//   · si la lectura funciona → guarda una copia (saveData) y la devuelve;
//   · si falla → devuelve la última copia y marca fromCache = true
//     (la cabecera muestra «Sin conexión»).
// Es el patrón «decorador»: añade comportamiento sin modificar el original.
function withOfflineCopy(impl) {
  const wrapped = Object.create(impl);
  wrapped.fromCache = false;
  for (const [method, key] of [['listSongs', 'songs']]) {
    wrapped[method] = async () => {
      try {
        const data = await impl[method]();
        wrapped.fromCache = false;
        saveData(`${impl.mode}-${key}`, data);
        return data;
      } catch (err) {
        const copy = await loadData(`${impl.mode}-${key}`);
        if (!copy) throw err;
        wrapped.fromCache = true;
        return copy;
      }
    };
  }
  // Tiempo real: también actualiza la copia sin conexión
  // Lo mismo para el tiempo real: cada actualización que llega del servidor
  // (no de la caché) refresca también la copia sin conexión.
  if (impl.watchSongs) {
    wrapped.watchSongs = (callback) => impl.watchSongs((songs, fromCache) => {
      if (!fromCache) saveData(`${impl.mode}-songs`, songs);
      callback(songs, fromCache);
    });
  }
  return wrapped;
}
