/* =========================================================
   SongDetail.js — Ficha de la canción
   Datos (número, autor, tono, compás, BPM, categoría, etiquetas),
   botones de Letra/Acordes/Partitura, metrónomo, video y letra en texto.
   ========================================================= */
import { store } from '../store.js';
import { el, icon, keyLabel, prettyKey, DEFAULT_BPM, setChildren } from '../utils.js';
import * as metro from '../services/metronome.js';
import { FormatButtons } from './FormatPicker.js';
import { Metronome } from './Metronome.js';
import { MediaPlayer } from './MediaPlayer.js';
import { SetlistNav } from './SetlistNav.js';
import { addRecent } from '../services/recent.js';

// FICHA DE LA CANCIÓN: datos (tono, tempo, compás, etiquetas), botones de
// los 3 PDFs, metrónomo, video de referencia y la letra en texto.
// La vista se crea una vez; open(song) la rellena con otra canción.
export function SongDetail(ctx) {
  const metronome = Metronome(); // una sola instancia, reutilizada en todas las canciones
  const navSlot = el('div', { class: 'detail-setlist' });
  const header = el('div', { class: 'detail-head' });
  const formats = el('section', { class: 'card', 'aria-label': 'Documentos' });
  const side = el('div', { class: 'detail-side' });
  const extra = el('div', { class: 'detail-extra' });

  const view = el('section', { class: 'view container container-wide detail', hidden: true, 'aria-label': 'Detalle de la canción' },
    el('button', { class: 'btn btn-ghost back-link', type: 'button', html: `${icon('back')}<span>Volver</span>`, onclick: () => ctx.back('#/') }),
    navSlot,
    header,
    el('div', { class: 'detail-grid' },
      el('div', { class: 'detail-main' }, formats, extra),
      side));

  // Casilla de dato (Tono / Tempo / Compás) con valor y texto secundario.
  function metaItem(label, value, sub) {
    return el('div', { class: 'meta-item' },
      el('span', { class: 'meta-label', text: label }),
      el('span', { class: 'meta-value', text: value || '—' }),
      sub ? el('span', { class: 'meta-sub', text: sub }) : null);
  }

  // setChildren (y no replaceChildren) ignora los valores null de las
  // condiciones; así nunca aparece la palabra «null» en pantalla.
  function render(song) {
    setChildren(header, 
      el('p', { class: 'detail-eyebrow' },
        el('span', { class: 'song-num', text: song.numero }),
        el('span', { text: `Canción #${song.numero}` }),
        song.categoria ? el('button', {
          class: 'cat-link', type: 'button', text: song.categoria, title: `Ver todas: ${song.categoria}`,
          onclick: () => { store.set({ category: song.categoria, tag: '', query: '' }); ctx.go('#/'); },
        }) : null),
      el('h1', { class: 'detail-title', text: song.titulo }),
      song.autor ? el('p', { class: 'detail-author', text: song.autor }) : null,
      el('div', { class: 'meta-grid' },
        el('div', { class: 'meta-item meta-key' },
          el('span', { class: 'meta-label', text: 'Tono' }),
          el('span', { class: 'meta-value', text: song.tono ? prettyKey(song.tono) : '—' }),
          song.tono ? el('span', { class: 'meta-sub', text: keyLabel(song.tono).replace(/\s*\(.*\)$/, '') }) : null),
        metaItem('Tempo', song.bpm ? `${song.bpm}` : '—', song.bpm ? 'BPM' : `Sin definir (${DEFAULT_BPM})`),
        metaItem('Compás', song.compas || '—', song.compas ? null : 'Sin definir (4/4)')),
      song.tags.length
        ? el('div', { class: 'tag-list', 'aria-label': 'Etiquetas' }, ...song.tags.map((t) => el('button', {
            class: 'tag', type: 'button', title: `Ver canciones con «${t}»`, html: icon('tag'),
            onclick: () => { store.set({ tag: t, category: '', query: '' }); ctx.go('#/'); },
          }, t)))
        : null);

    setChildren(formats, 
      el('div', { class: 'card-head' }, el('h2', { html: `${icon('lyrics')}<span>Documentos</span>` })),
      FormatButtons(song, (fmt) => ctx.go(`#/c/${song.numero}/${fmt}`)));

    const media = song.audioUrl ? MediaPlayer(song.audioUrl, song.titulo) : null;
    setChildren(side, metronome, ...(media ? [media] : []));

    setChildren(extra, ...(song.letraTexto
      ? [el('details', { class: 'card lyrics-card' },
          el('summary', { html: `${icon('lyrics')}<span>Ver letra en texto</span>${icon('chevron', 'summary-chev')}` }),
          el('div', { class: 'lyrics-text', text: song.letraTexto }))]
      : []));
  }

  let current = null;
  return {
    element: view,
    // open(): carga BPM y compás en el metrónomo, redibuja solo si es otra
    // canción, la añade a «recientes» y muestra la barra del repertorio activo.
    open(song) {
      metro.loadSong(song);
      if (song !== current) {
        render(song);
        current = song;
        window.scrollTo(0, 0);
        store.set({ recent: addRecent(song.id) });
      }
      const nav = SetlistNav(ctx, song);
      setChildren(navSlot, ...(nav ? [nav] : []));
    },
    hide() { current = null; },
  };
}
