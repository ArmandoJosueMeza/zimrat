/* =========================================================
   setlists.js — Repertorios LOCALES de cada usuario (localStorage)
   ---------------------------------------------------------
   · Cualquier persona (sin login) puede crear, editar y borrar los suyos.
   · Se guardan solo en ESTE navegador: son privados y no tocan Firestore.
   · Exportar / importar en JSON para pasarlos a otro dispositivo o compartirlos
     con el equipo. Cada canción se guarda con su id y su número, así se
     reconoce también si los ids cambian (p. ej. en modo demo).
   ========================================================= */
import { uid, normalizeSetlist, storageGet, storageSet } from '../utils.js';

// Todos los repertorios se guardan juntos como un único texto JSON bajo
// esta clave de localStorage. Un repertorio es:
//   { id, nombre, fecha, notas, songIds: [id1, id2, …] }  (orden = orden del evento)
// Se guardan los IDS de las canciones, no copias: si el admin corrige una
// canción, el repertorio muestra la versión nueva automáticamente.
const KEY = 'zimrat-repertorios';

// LEER: JSON.parse convierte el texto en objetos; normalizeSetlist repara
// datos incompletos. Si algo está corrupto, se devuelve [] (nunca rompe).
export function loadSetlists() {
  try {
    const data = JSON.parse(storageGet(KEY) || '[]');
    return Array.isArray(data) ? data.map(normalizeSetlist) : [];
  } catch {
    return [];
  }
}

// GUARDAR: JSON.stringify convierte los objetos en texto. A diferencia de
// la lectura, aquí SÍ se lanza el error para que la interfaz avise de que
// no se guardó (modo privado o almacenamiento lleno).
function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error('No se pudo guardar en este navegador (¿modo privado o sin espacio?).');
  }
  return list;
}

// CREAR o EDITAR (CRUD): si no tiene id se le asigna uno nuevo (crear);
// si ya existe en la lista, se reemplaza (editar).
export function saveSetlist(data) {
  const list = normalizeSetlist({ ...data, id: data.id || uid('rep-') });
  if (!list.nombre.trim()) throw new Error('El repertorio necesita un nombre.');
  const all = loadSetlists();
  const i = all.findIndex((s) => s.id === list.id);
  if (i >= 0) all[i] = list; else all.push(list);
  persist(all);
  return list;
}

// BORRAR: se guarda la lista sin ese repertorio.
export function deleteSetlist(id) {
  persist(loadSetlists().filter((s) => s.id !== id));
}

/** Quita una canción borrada de todos los repertorios de este navegador. */
export function removeSongEverywhere(songId) {
  const all = loadSetlists();
  if (all.some((s) => s.songIds.includes(songId))) persist(all.map((s) => ({ ...s, songIds: s.songIds.filter((id) => id !== songId) })));
}

/** JSON portátil con uno o varios repertorios. */
// EXPORTAR: genera un archivo .zimrat.json legible (null, 2 = con sangría).
// Guarda id, número y título de cada canción para poder reconocerlas al
// importar en otro dispositivo.
export function exportSetlists(lists, songs) {
  const byId = new Map(songs.map((s) => [s.id, s]));
  return JSON.stringify({
    app: 'Zimrat', tipo: 'repertorios', version: 1, exportado: new Date().toISOString(),
    repertorios: lists.map((l) => ({
      nombre: l.nombre, fecha: l.fecha, notas: l.notas,
      canciones: l.songIds.map((id) => byId.get(id)).filter(Boolean).map((s) => ({ id: s.id, numero: s.numero, titulo: s.titulo })),
    })),
  }, null, 2);
}

/** Importa un JSON exportado; reconoce las canciones por id o, si no, por número. Devuelve cuántos se importaron. */
// IMPORTAR: valida el archivo y busca cada canción primero por id y, si no
// existe (otro dispositivo o modo demo), por número. Las que no se
// encuentran se omiten. Los repertorios importados reciben ids nuevos.
export function importSetlists(text, songs) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('El archivo no es un JSON válido.'); }
  const items = Array.isArray(data?.repertorios) ? data.repertorios : null;
  if (!items) throw new Error('El archivo no contiene repertorios de Zimrat.');
  const ids = new Set(songs.map((s) => s.id));
  const byNumber = new Map(songs.map((s) => [s.numero, s.id]));
  const all = loadSetlists();
  for (const r of items) {
    const songIds = (r.canciones || []).map((c) => (ids.has(c.id) ? c.id : byNumber.get(Number(c.numero)))).filter(Boolean);
    all.push(normalizeSetlist({ id: uid('rep-'), nombre: r.nombre, fecha: r.fecha, notas: r.notas, songIds }));
  }
  persist(all);
  return items.length;
}

/** Datos de ejemplo (solo modo demo, la primera vez): setlists.json usa números de canción. */
export async function seedExampleSetlists(songs) {
  const FLAG = 'zimrat-repertorios-ejemplo';
  if (storageGet(FLAG) || loadSetlists().length) return false;
  try {
    const res = await fetch('setlists.json', { cache: 'no-cache' });
    if (!res.ok) return false;
    const byNumber = new Map(songs.map((s) => [s.numero, s.id]));
    const all = (await res.json()).map((s) => normalizeSetlist({ ...s, id: uid('rep-'), songIds: (s.numeros || []).map((n) => byNumber.get(n)).filter(Boolean) }));
    persist(all);
    storageSet(FLAG, '1');
    return true;
  } catch {
    return false;
  }
}
