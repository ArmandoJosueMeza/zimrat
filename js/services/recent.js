/* =========================================================
   recent.js — Historial de canciones vistas (en este dispositivo)
   Se guarda en localStorage: no requiere login ni servidor.
   ========================================================= */
import config from '../../config.js';
import { storageGet, storageSet } from '../utils.js';

// Se guarda un array de ids en formato JSON (localStorage solo guarda texto).
const KEY = 'zimrat-recientes';

// Lectura defensiva: si el valor guardado está corrupto o no es un array
// de textos, devuelve [] en lugar de romper la app.
export function getRecent() {
  try {
    const ids = JSON.parse(storageGet(KEY) || '[]');
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Pone la canción al principio del historial (sin duplicados). */
// Pone la canción al principio, quita duplicados con filter y recorta a
// un máximo con slice. Se guardan al menos 10 aunque se muestren menos.
export function addRecent(songId) {
  const ids = [songId, ...getRecent().filter((id) => id !== songId)].slice(0, Math.max(config.RECENT_COUNT, 10));
  storageSet(KEY, JSON.stringify(ids));
  return ids;
}

export function clearRecent() {
  storageSet(KEY, '[]');
  return [];
}
