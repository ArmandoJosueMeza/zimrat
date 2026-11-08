/* =========================================================
   SetlistNav.js — Barra «anterior / siguiente» al recorrer un repertorio
   Aparece en la ficha y en el visor cuando la canción forma parte
   del repertorio activo (el que abriste desde su página).
   ========================================================= */
import { store } from '../store.js';
import { el, icon, FORMAT_KEYS } from '../utils.js';

/** Posición de la canción en el repertorio activo, o null. */
// Calcula dónde está la canción dentro del repertorio activo (store.activeSetlist),
// ignorando canciones que ya no existen. Devuelve la anterior y la siguiente.
export function setlistPosition(song) {
  const { activeSetlist, setlists, songs } = store.get();
  if (!activeSetlist || !song) return null;
  const list = setlists.find((s) => s.id === activeSetlist);
  if (!list) return null;
  const byId = new Map(songs.map((s) => [s.id, s]));
  const ids = list.songIds.filter((id) => byId.has(id));
  const index = ids.indexOf(song.id);
  if (index < 0) return null;
  return {
    list, index, total: ids.length,
    prev: index > 0 ? byId.get(ids[index - 1]) : null,
    next: index < ids.length - 1 ? byId.get(ids[index + 1]) : null,
  };
}

/**
 * fmt: si se indica (visor), el salto abre el mismo formato en la otra canción
 *      (o el primero disponible; si no tiene PDFs, su ficha).
 */
// En el visor, intenta abrir el MISMO formato en la siguiente canción (si estabas
// en Acordes, sigue en Acordes); si no lo tiene, el primero disponible.
export function goToSetlistSong(ctx, target, fmt) {
  if (!fmt) return ctx.replace(`#/c/${target.numero}`);
  const nextFmt = target[fmt] ? fmt : FORMAT_KEYS.find((k) => target[k]);
  if (!nextFmt) return ctx.back(`#/c/${target.numero}`);
  ctx.jumpViewer(target.numero, nextFmt);
}

export function SetlistNav(ctx, song, { fmt } = {}) {
  const pos = setlistPosition(song);
  if (!pos) return null;
  const btn = (target, dir) => el('button', {
    class: 'btn btn-icon setlist-btn', type: 'button', disabled: !target,
    'aria-label': target ? `${dir === 'next' ? 'Siguiente' : 'Anterior'}: ${target.titulo}` : dir === 'next' ? 'Es la última' : 'Es la primera',
    title: target ? target.titulo : '', html: icon(dir),
    onclick: () => goToSetlistSong(ctx, target, fmt),
  });
  return el('nav', { class: 'setlist-nav', 'aria-label': `Repertorio ${pos.list.nombre}` },
    btn(pos.prev, 'prev'),
    el('a', {
      class: 'setlist-info', href: `#/r/${pos.list.id}`, title: 'Ver el repertorio completo',
      onclick: (e) => { e.preventDefault(); ctx.go(`#/r/${pos.list.id}`); },
    },
      el('span', { class: 'setlist-name' }, el('span', { class: 'btn-ico', html: icon('setlist') }), el('span', { text: pos.list.nombre })),
      el('span', { class: 'setlist-pos', text: `${pos.index + 1} de ${pos.total}${pos.next ? ` · Sigue: ${pos.next.titulo}` : ' · Última canción'}` })),
    btn(pos.next, 'next'),
    el('button', {
      class: 'btn btn-icon btn-ghost setlist-close', type: 'button', 'aria-label': 'Salir del repertorio', title: 'Salir del repertorio', html: icon('close'),
      onclick: (e) => { ctx.setActiveSetlist(null); e.currentTarget.closest('.setlist-nav').remove(); },
    }));
}

