/* =========================================================
   offline.js — Uso sin conexión (complementa al Service Worker)
   ---------------------------------------------------------
   1. Copia de los DATOS (canciones y repertorios) en Cache Storage:
      si la red falla, la app muestra la última copia guardada.
      (En modo demo los datos ya están en IndexedDB.)
   2. «Guardar sin conexión» un repertorio: descarga todos sus PDFs
      a una caché permanente que el Service Worker usa sin red.
   Los PDFs que se abren se guardan solos en una caché de recientes
   (ver sw.js), así que lo último que consultaste también funciona.
   ========================================================= */
// Cache Storage (window.caches) es un almacén del navegador pensado para
// guardar respuestas HTTP. Lo comparten la página y el Service Worker,
// por eso un PDF guardado aquí se puede abrir después sin red.
export const DATA_CACHE = 'zimrat-data';
export const SAVED_PDF_CACHE = 'zimrat-pdfs-guardados';

const hasCaches = () => typeof window !== 'undefined' && 'caches' in window; // requiere https o localhost
// Los datos se guardan como si fueran un archivo «__datos__/clave.json»
// (Cache Storage exige una URL como clave). sw.js ignora esa ruta.
const dataKey = (key) => new URL(`./__datos__/${key}.json`, location.href).href;
const absolute = (url) => new URL(url, location.href).href;

// saveData: guarda una copia JSON (la usa backend.js tras cada lectura buena).
// new Response(...) envuelve el texto como si viniera de un servidor.
export async function saveData(key, value) {
  if (!hasCaches()) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(dataKey(key), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* sin espacio o no permitido: se ignora */ }
}

// loadData: devuelve la última copia, o null si no hay.
export async function loadData(key) {
  if (!hasCaches()) return null;
  try {
    const res = await (await caches.open(DATA_CACHE)).match(dataKey(key));
    return res ? res.json() : null;
  } catch {
    return null;
  }
}

/** Solo las referencias descargables (las 'idb:' del modo demo ya son locales). */
export const downloadable = (refs) => [...new Set(refs.filter((r) => r && !String(r).startsWith('idb:')).map(absolute))];

/** ¿Cuántos de estos PDFs están disponibles sin conexión (en cualquier caché)? */
// Promise.all lanza todas las comprobaciones a la vez y espera a que
// terminen (más rápido que una por una).
export async function offlineStatus(refs) {
  const urls = downloadable(refs);
  if (!urls.length) return { total: 0, saved: 0 };       // todo local (modo demo) o sin PDFs
  if (!hasCaches()) return { total: urls.length, saved: 0 };
  const found = await Promise.all(urls.map((u) => caches.match(u).then(Boolean).catch(() => false)));
  return { total: urls.length, saved: found.filter(Boolean).length };
}

/** Descarga y guarda PDFs en la caché permanente. onProgress(hechos, total). */
// savePdfs: «Guardar sin conexión» de un repertorio. Descarga cada PDF
// con cache: 'reload' (fuerza la versión del servidor) y lo guarda.
// Si uno falla, sigue con los demás y al final informa cuántos fallaron.
// onProgress permite mostrar «3 de 10…» en la interfaz.
export async function savePdfs(refs, onProgress) {
  if (!hasCaches()) throw new Error('Tu navegador no permite guardar sin conexión en esta dirección (usa https o localhost).');
  const urls = downloadable(refs);
  const cache = await caches.open(SAVED_PDF_CACHE);
  let done = 0;
  let bytes = 0;
  const failed = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) throw new Error(String(res.status));
      bytes += Number(res.headers.get('content-length')) || (await res.clone().blob()).size;
      await cache.put(url, res);
    } catch {
      failed.push(url);
    }
    onProgress?.(++done, urls.length);
  }
  return { total: urls.length, failed: failed.length, bytes };
}

export async function removeSavedPdfs(refs) {
  if (!hasCaches()) return;
  const cache = await caches.open(SAVED_PDF_CACHE);
  await Promise.all(downloadable(refs).map((u) => cache.delete(u)));
}
