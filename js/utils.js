/* =========================================================
   utils.js — Utilidades compartidas
   1. Formatos, tonalidades y compases   4. Búsqueda inteligente (título, autor, letra…)
   2. Iconos                             5. Enlaces de audio/video
   3. Creación de elementos DOM          6. Varios (toast, almacenamiento, normalización)
   // ---------------------------------------------------------
   // Funciones pequeñas y «puras» (no dependen del resto de la app) que
   // usan muchos archivos. Tenerlas juntas evita repetir código.
   // =========================================================
   ========================================================= */

/* ---------- 1. Formatos, tonalidades, compases ---------- */
// Los 3 formatos de PDF de cada canción. key es el nombre del campo
// en el modelo interno (song.letra, song.acordes, song.partitura).
export const FORMATS = [
  { key: 'letra', label: 'Letra', long: 'Solo letra', icon: 'lyrics' },
  { key: 'acordes', label: 'Acordes', long: 'Letra con cifrado', icon: 'chords' },
  { key: 'partitura', label: 'Partitura', long: 'Partitura musical', icon: 'score' },
];
export const FORMAT_KEYS = FORMATS.map((f) => f.key);
export const formatInfo = (key) => FORMATS.find((f) => f.key === key);

// Compases admitidos por el metrónomo y límites de BPM (pulsos por minuto).
export const SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '12/8'];
export const DEFAULT_BPM = 100;
export const BPM_MIN = 30;
export const BPM_MAX = 300;

// Tonalidades: internamente se usa notación inglesa (D, Bm, F#m) porque
// es corta y estándar; en Firestore se guarda en español («Re Mayor»).
// keyToName() y parseKey() traducen en ambos sentidos.
const NOTE_ES = {
  C: 'Do', 'C#': 'Do♯', Db: 'Re♭', D: 'Re', 'D#': 'Re♯', Eb: 'Mi♭', E: 'Mi', F: 'Fa', 'F#': 'Fa♯',
  Gb: 'Sol♭', G: 'Sol', 'G#': 'Sol♯', Ab: 'La♭', A: 'La', 'A#': 'La♯', Bb: 'Si♭', B: 'Si',
};
export const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** Nombres en español para guardar en Firestore: "D" → "Re Mayor", "Bm" → "Si menor" */
const NOTE_ES_PLAIN = {
  C: 'Do', 'C#': 'Do#', Db: 'Reb', D: 'Re', 'D#': 'Re#', Eb: 'Mib', E: 'Mi', F: 'Fa', 'F#': 'Fa#',
  Gb: 'Solb', G: 'Sol', 'G#': 'Sol#', Ab: 'Lab', A: 'La', 'A#': 'La#', Bb: 'Sib', B: 'Si',
};
export function keyToName(code) {
  if (!code) return '';
  const minor = /m$/.test(code);
  const es = NOTE_ES_PLAIN[minor ? code.slice(0, -1) : code];
  return es ? `${es} ${minor ? 'menor' : 'Mayor'}` : code;
}
/** Texto libre → código: "Re Mayor" → "D", "si menor" → "Bm", "Fa# menor" → "F#m", "Am" → "Am".
 *  Si no se reconoce, devuelve el texto tal cual (se mostrará así). */
// parseKey: «Re Mayor» / «si menor» / «D» → código interno («D», «Bm»).
// Acepta mayúsculas/minúsculas y sostenidos/bemoles escritos a mano.
export function parseKey(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^[A-G](#|b)?m?$/.test(t)) return t;
  const m = norm(t).replace(/♯/g, '#').replace(/♭/g, 'b')
    .match(/^(do|re|mi|fa|sol|la|si)\s*(#|b(?![a-z])|sostenido|bemol)?\s*(mayor|menor|m\b|maj)?/);
  if (!m) return t;
  const root = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' }[m[1]];
  const acc = m[2] === '#' || m[2] === 'sostenido' ? '#' : m[2] === 'b' || m[2] === 'bemol' ? 'b' : '';
  const minor = m[3] === 'menor' || m[3] === 'm';
  return `${root}${acc}${minor ? 'm' : ''}`;
}

/** "F#m" → "Fa♯m" (símbolos musicales) */
// prettyKey: «F#m» → «F♯m» (símbolos musicales reales para mostrar).
export const prettyKey = (k) => (k ? k.replace('#', '♯').replace(/^([A-G])b/, '$1♭') : '');
/** "Am" → "La menor (Am)", "C" → "Do Mayor (C)" */
export function keyLabel(k) {
  if (!k) return '';
  const minor = /m$/.test(k);
  const es = NOTE_ES[minor ? k.slice(0, -1) : k];
  return es ? `${es} ${minor ? 'menor' : 'Mayor'} (${prettyKey(k)})` : k;
}

/* ---------- 2. Iconos SVG (24×24) ---------- */
// Iconos SVG dibujados como trazos (paths). Se insertan como texto HTML,
// así no hay que descargar imágenes y heredan el color del texto
// (stroke="currentColor" en el CSS).
const ICONS = {
  lyrics: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  chords: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14M9.7 8v13M14.3 8v13"/><circle cx="9.7" cy="12.5" r="1.4" fill="currentColor"/><circle cx="14.3" cy="16" r="1.4" fill="currentColor"/>',
  score: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  download: '<path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9m0 0-5 5m5-5 5 5M4 3h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  cloud: '<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  metronome: '<path d="M9 3h6l4 18H5z"/><path d="M12 15 17 6"/><path d="M7.5 15h9"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shrink: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  setlist: '<path d="M3 6h12M3 12h12M3 18h7"/><path d="M17 15v6l5-3z" fill="currentColor"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  offline: '<path d="M1 1l22 22M16.7 11.1A11 11 0 0 1 19 12.6M5 12.6a11 11 0 0 1 5.2-2.5M10.7 5.1A16 16 0 0 1 22.6 9M1.4 9a16 16 0 0 1 4.3-2.7M8.5 16.1a6 6 0 0 1 7 0M12 20h.01"/>',
  saveOffline: '<path d="M12 13v8m0 0-3.5-3.5M12 21l3.5-3.5"/><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="M5 4l10 8-10 8z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  prev: '<path d="M19 20 9 12l10-8z" fill="currentColor" stroke="none"/><path d="M5 19V5"/>',
  feather: '<path d="M20.2 12.2A6 6 0 0 0 11.8 3.8L5 10.5V19h8.5z"/><path d="M16 8 2 22M17.5 15H9"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  wifi: '<path d="M5 12.6a11 11 0 0 1 14 0M1.4 9a16 16 0 0 1 21.2 0M8.5 16.1a6 6 0 0 1 7 0M12 20h.01"/>',
  bug: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 7l-3 2M5 7l3 2M19 13h-3M5 13h3M19 19l-3-2M5 19l3-2M12 6V3"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
};
// aria-hidden: los lectores de pantalla ignoran el icono decorativo.
export const icon = (name, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

/* ---------- 3. Creación de elementos ---------- */
/**
 * el('button', { class: 'btn', text: 'Hola', onclick: fn }, ...hijos)
 * Claves especiales: class, text, html, dataset, on<evento>.
 */
// el(): crea elementos del DOM de forma compacta. Ejemplo:
//   el('button', { class: 'btn', text: 'Hola', onclick: fn }, hijo1, hijo2)
// equivale a createElement + className + textContent + addEventListener
// + append. «text» usa textContent (seguro: no interpreta HTML, evita
// inyección de código); «html» usa innerHTML (solo con contenido propio,
// como los iconos). Los hijos null/false se ignoran, lo que permite
// escribir condiciones: cond ? el(...) : null.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/** Campo de formulario con etiqueta accesible. */
// field(): etiqueta + campo + ayuda, enlazados con for/id (accesibilidad:
// al pulsar la etiqueta se enfoca el campo).
export function field(labelText, input, hint) {
  if (!input.id) input.id = uid('f');
  return el('div', { class: 'field' },
    el('label', { for: input.id, text: labelText }),
    input,
    hint ? (hint instanceof Node ? hint : el('p', { class: 'field-hint', text: hint })) : null);
}

/* ---------- 4. Búsqueda ---------- */
// norm(): quita tildes y pasa a minúsculas para comparar sin errores:
// «Canción» y «cancion» coinciden. normalize('NFD') separa la letra de
// su tilde y el regex elimina las tildes sueltas.
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Para buscar: sin tildes, minúsculas y sin signos de puntuación. */
export const searchNorm = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();

// Intl.Collator ordena según las reglas del español (ñ, tildes) y con
// numeric: true pone «Salmo 2» antes que «Salmo 10».
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
export const sortByTitle = (songs) => [...songs].sort((a, b) => collator.compare(a.titulo, b.titulo) || a.numero - b.numero);
export const sortByNumber = (songs) => [...songs].sort((a, b) => a.numero - b.numero);

// "5", "#5", "nº 5", "Canción 5", "canción #5" → búsqueda exacta por número
const NUMBER_QUERY = /^(cancion\s*)?(#|n[o°º]\.?\s*)?\s*(\d+)$/;

/** Texto normalizado + mapa de posiciones al original (para resaltar fragmentos de la letra). */
// Para buscar FRASES en la letra se crea una versión normalizada del
// texto y un mapa de posiciones hacia el original; así, al encontrar
// «rompio mis cadenas», se puede resaltar el fragmento real con tildes.
function indexText(text) {
  let out = '';
  const map = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    for (const ch of text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()) {
      if (/[a-z0-9]/.test(ch)) { out += ch; map.push(i); space = false; }
      else if (!space) { out += ' '; map.push(i); space = true; }
    }
  }
  return { out, map };
}
// WeakMap: guarda el índice de cada canción sin impedir que el navegador
// libere memoria cuando la canción ya no existe (caché sin fugas).
const lyricsCache = new WeakMap();
const lyricsIndex = (song) => {
  if (!lyricsCache.has(song)) lyricsCache.set(song, indexText(song.letraTexto || ''));
  return lyricsCache.get(song);
};

// Recorta unas palabras antes y después de la coincidencia para mostrar
// el contexto en los resultados («…me dio vida nueva y…»).
function snippetAt(text, idx, q) {
  const start = idx.map[q.pos];
  const end = idx.map[q.pos + q.len - 1] + 1;
  const a = Math.max(0, start - 40);
  const b = Math.min(text.length, end + 50);
  const clean = (s) => s.replace(/\s+/g, ' ');
  return {
    before: (a > 0 ? '…' : '') + clean(text.slice(a, start)).trimStart(),
    match: text.slice(start, end),
    after: clean(text.slice(end, b)).trimEnd() + (b < text.length ? '…' : ''),
  };
}

/**
 * Busca por número, título, autor, categoría, etiquetas, tono y FRASES DE LA LETRA.
 * Devuelve [{ song, snippet? }] respetando el orden recibido (A-Z).
 * snippet = { before, match, after } cuando la coincidencia está en la letra.
 */
export function searchSongs(songs, query = '', { category = '', tag = '' } = {}) {
  const q = searchNorm(query);
  // Orden de prioridad de la búsqueda:
  //   1) número exacto, 2) título/autor/categoría/tono/etiquetas,
  //   3) frase literal en la letra, 4) todas las palabras en cualquier campo.
  const num = norm(query).match(NUMBER_QUERY);
  const words = q.split(' ').filter((w) => w.length > 2);
  const exact = [];
  const results = [];

  for (const song of songs) {
    if (category && song.categoria !== category) continue;
    if (tag && !song.tags.some((t) => norm(t) === norm(tag))) continue;
    if (!q) { results.push({ song }); continue; }
    if (num && Number(num[3]) === song.numero) { exact.push({ song }); continue; }

    // Título: cualquier parte. Autor, categoría, tono y etiquetas: desde el inicio de una palabra
    const title = searchNorm(song.titulo);
    const meta = ` ${searchNorm([song.autor, song.categoria, song.tono, ...song.tags].join(' '))}`;
    if (title.includes(q) || meta.includes(` ${q}`)) { results.push({ song }); continue; }

    const idx = lyricsIndex(song);
    const pos = q.length >= 3 ? idx.out.indexOf(q) : -1;
    if (pos >= 0) { results.push({ song, snippet: snippetAt(song.letraTexto, idx, { pos, len: q.length }) }); continue; }

    // Todas las palabras presentes (en cualquier orden / campo)
    if (words.length > 1 && words.every((w) => title.includes(w) || meta.includes(` ${w}`) || idx.out.includes(w))) {
      const w = words.find((x) => idx.out.includes(x));
      results.push({ song, snippet: w ? snippetAt(song.letraTexto, idx, { pos: idx.out.indexOf(w), len: w.length }) : null });
    }
  }
  return [...exact, ...results];
}

/** Etiquetas desde texto "alegre, entrada; navidad" → ['alegre','entrada','navidad'] */
export function parseTags(text) {
  const seen = new Set();
  return String(text || '').split(/[,;]/).map((t) => t.trim().replace(/\s+/g, ' ').slice(0, 30))
    .filter((t) => t && !seen.has(norm(t)) && seen.add(norm(t))).slice(0, 20);
}

/* ---------- 5. Enlaces de audio/video ---------- */
/** Devuelve { type: 'youtube', id } | { type: 'link', host } | null (solo http/https). */
// Reconoce enlaces de YouTube en todas sus formas (watch?v=, youtu.be,
// shorts, embed) y extrae el ID de 11 caracteres para incrustarlo.
// Cualquier otro enlace https se abre aparte.
export function parseMediaUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : (u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/) || [])[2];
  }
  if (id && /^[\w-]{11}$/.test(id)) return { type: 'youtube', id, url: u.href, host: 'YouTube' };
  return { type: 'link', url: u.href, host };
}

/* ---------- 6. Varios ---------- */
/** Garantiza que toda canción tenga todos los campos con el tipo correcto. */
/**
 * Texto seguro para mostrar: null, undefined, NaN y los textos literales
 * «null» / «undefined» (p. ej. guardados por una versión anterior o a mano
 * en la consola de Firestore) se convierten en '' para que nunca se impriman.
 */
// (Se usa en normalizeSong, más abajo.)
export function cleanText(v) {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '';
  const t = String(v).trim();
  return /^(null|undefined|nan)$/i.test(t) ? '' : t;
}

/** replaceChildren que ignora null / undefined / false / '' (evita que aparezca «null» en pantalla). */
export function setChildren(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c != null && c !== false && c !== ''));
  return node;
}

// normalizeSong: garantiza que toda canción tenga todos los campos con el
// tipo correcto, venga de Firestore, del modo demo o de una copia guardada.
// Así el resto del código puede confiar en que, por ejemplo, song.tags
// siempre es un array. Defensa importante contra datos incompletos.
export function normalizeSong(s) {
  const bpm = Math.round(Number(s.bpm));
  const compas = cleanText(s.compas);
  return {
    id: s.id,
    numero: Number(s.numero),
    titulo: cleanText(s.titulo) || 'Sin título',
    autor: cleanText(s.autor),
    tono: cleanText(s.tono),
    categoria: cleanText(s.categoria),
    tags: Array.isArray(s.tags) ? s.tags.map(cleanText).filter(Boolean) : [],
    letraTexto: cleanText(s.letraTexto),
    audioUrl: cleanText(s.audioUrl),
    bpm: bpm >= BPM_MIN && bpm <= BPM_MAX ? bpm : null,
    compas: SIGNATURES.includes(compas) ? compas : '',
    letra: cleanText(s.letra) || null,
    acordes: cleanText(s.acordes) || null,
    partitura: cleanText(s.partitura) || null,
  };
}

/** Repertorio (setlist): lista ordenada de canciones para un evento. */
export function normalizeSetlist(s) {
  return {
    id: s.id,
    nombre: String(s.nombre || 'Repertorio'),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(s.fecha || '') ? s.fecha : '',
    notas: String(s.notas || ''),
    songIds: Array.isArray(s.songIds) ? s.songIds.filter(Boolean) : [],
  };
}

/** "2026-11-15" → "dom 15 nov 2026" */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Identificador único corto (para ids de repertorios, campos, etc.).
export function uid(prefix = '') {
  if (window.crypto?.randomUUID) return prefix + crypto.randomUUID();
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
export const formatBytes = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const safeFileName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').trim();
export const isPdf = (file) => file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));

// Lectura/escritura en localStorage protegidas con try/catch: en modo
// incógnito o con el almacenamiento lleno, localStorage puede fallar.
export function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } }

let toastTimer;
// toast(): mensaje flotante temporal (3,2 s). role="status" + aria-live
// hacen que los lectores de pantalla lo anuncien. requestAnimationFrame
// espera al siguiente cuadro para que la animación CSS se active.
export function toast(message, type = 'info') {
  let node = document.getElementById('toast');
  if (!node) { node = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(node); }
  node.className = `toast toast-${type}`;
  node.textContent = message;
  requestAnimationFrame(() => node.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
}
