/* =========================================================
   SetlistView.js — Página de un repertorio (#/r/<id>)
   - Lista ordenada con tono, tempo y compás de cada canción
   - «Empezar»: abre la 1ª canción con la barra anterior/siguiente
   - «Guardar sin conexión»: descarga todos sus PDFs para el ensayo
   ========================================================= */
import { store } from '../store.js';
import { el, icon, prettyKey, formatDate, formatBytes, FORMATS, FORMAT_KEYS, toast, setChildren } from '../utils.js';
import { offlineStatus, savePdfs } from '../services/offline.js';
import { openSetlistForm } from './SetlistForm.js';

// PÁGINA DE UN REPERTORIO (#/r/<id>): lista ordenada de canciones con
// «Empezar» (abre la primera y activa la barra anterior/siguiente),
// Editar, Exportar y «Guardar sin conexión».
export function SetlistView(ctx) {
  let current = null;
  const head = el('div', { class: 'setlist-head' });
  const actions = el('div', { class: 'setlist-actions' });
  const offlineBox = el('div', { class: 'offline-box' });
  const list = el('ol', { class: 'setlist-songs' });

  const view = el('section', { class: 'view container setlist-view', hidden: true, 'aria-label': 'Repertorio' },
    el('button', { class: 'btn btn-ghost back-link', type: 'button', html: `${icon('back')}<span>Volver</span>`, onclick: () => ctx.back('#/') }),
    head, actions, offlineBox, list);

  const songsOf = (setlist) => {
    const byId = new Map(store.get().songs.map((s) => [s.id, s]));
    return setlist.songIds.map((id) => byId.get(id)).filter(Boolean);
  };
  // PDFs del repertorio → URLs descargables (Cloudinary)
  const pdfRefs = (songs) => songs.flatMap((s) => FORMAT_KEYS.map((k) => s[k])).filter(Boolean);
  const refsOf = (songs) => pdfRefs(songs).map((r) => ctx.backend.resolvePdfUrl(r)).filter(Boolean);

  // Descargar un archivo generado en el navegador: se crea un Blob, se le da
  // una URL temporal y se simula un clic en un enlace <a download>. Después
  // se revoca la URL para liberar memoria.
  function downloadJson(setlist) {
    const blob = new Blob([ctx.setlists.exportJson([setlist])], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${setlist.nombre.replace(/[\\/:*?"<>|]+/g, '')}.zimrat.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Repertorio exportado. Ábrelo en otro dispositivo con «Importar».', 'success');
  }

  // Abrir una canción desde el repertorio la marca como «repertorio activo».
  function open(song) {
    ctx.setActiveSetlist(current.id);
    ctx.go(`#/c/${song.numero}`);
  }

  // Caja «Guardar sin conexión»: comprueba cuántos PDFs del repertorio ya
  // están en la caché (offline.js) y ofrece descargarlos todos de una vez,
  // con progreso «3 de 10». Ideal antes de un ensayo sin internet.
  async function renderOffline(songs) {
    const refs = refsOf(songs);
    const status = await offlineStatus(refs);
    if (!status.total) {
      setChildren(offlineBox, el('p', { class: 'offline-note', html: `${icon('check')}<span>Los PDFs de este repertorio ya están en este dispositivo.</span>` }));
      return;
    }
    const all = status.saved === status.total;
    const btn = el('button', {
      class: `btn ${all ? '' : 'btn-soft'}`, type: 'button',
      html: `${icon('saveOffline')}<span>${all ? 'Actualizar copia' : 'Guardar sin conexión'}</span>`,
    });
    const text = el('p', { class: 'offline-note' },
      el('span', { class: 'btn-ico', html: icon(all ? 'check' : 'offline') }),
      el('span', { text: all ? `Disponible sin conexión (${status.total} PDF)` : `${status.saved} de ${status.total} PDF guardados en este dispositivo` }));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const result = await savePdfs(refs, (done, total) => { btn.lastElementChild.textContent = `Descargando ${done}/${total}…`; });
        toast(result.failed ? `Guardados ${result.total - result.failed} de ${result.total} PDF (revisa la conexión)` : `Listo: ${result.total} PDF guardados (${formatBytes(result.bytes)})`, result.failed ? 'error' : 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
      renderOffline(songs);
    });
    setChildren(offlineBox, el('div', { class: `offline-card ${all ? 'is-saved' : ''}` }, text, btn));
  }

  function render(setlist) {
    current = setlist;
    const songs = songsOf(setlist);
    setChildren(head, 
      el('p', { class: 'detail-eyebrow' }, el('span', { class: 'btn-ico', html: icon('setlist') }), el('span', { text: 'Repertorio' }),
        setlist.fecha ? el('span', { class: 'cat-link static', text: formatDate(setlist.fecha) }) : null),
      el('h1', { class: 'detail-title', text: setlist.nombre }),
      setlist.notas ? el('p', { class: 'setlist-notes', text: setlist.notas }) : null);

    setChildren(actions, 
      el('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: !songs.length, html: `${icon('play')}<span>Empezar</span>`, onclick: () => open(songs[0]) }),
      el('button', { class: 'btn btn-lg', type: 'button', html: `${icon('edit')}<span>Editar</span>`, onclick: () => openSetlistForm(ctx, setlist) }),
      el('button', { class: 'btn btn-lg btn-ghost', type: 'button', title: 'Descargar un archivo para pasarlo a otro dispositivo o compartirlo', html: `${icon('download')}<span>Exportar</span>`, onclick: () => downloadJson(setlist) }));

    setChildren(list, ...(songs.length ? songs.map((song, i) => el('li', {},
      el('button', { class: 'song setlist-row', type: 'button', 'aria-label': `${i + 1}. ${song.titulo}`, onclick: () => open(song) },
        el('span', { class: 'setlist-index', text: i + 1 }),
        el('span', { class: 'song-info' },
          el('span', { class: 'song-title', text: song.titulo }),
          el('span', { class: 'song-meta', text: [`#${song.numero}`, song.autor, song.bpm && `${song.bpm} BPM`, song.compas].filter(Boolean).join(' · ') }),
          el('span', { class: 'chips' }, ...FORMATS.map((f) => el('span', { class: `chip chip-${f.key} ${song[f.key] ? '' : 'chip-off'}`, text: f.label })))),
        song.tono ? el('span', { class: 'key-badge', title: 'Tono', text: prettyKey(song.tono) }) : null,
        el('span', { class: 'song-chev', html: icon('chevron') }))))
      : [el('li', { class: 'empty' }, el('p', { class: 'empty-title', text: 'Este repertorio está vacío' }), el('p', { class: 'muted', text: 'El administrador puede añadir canciones desde el Panel.' }))]));

    renderOffline(songs);
  }

  // Si cambian los datos (p. ej. se edita el repertorio), se vuelve a dibujar
  store.subscribe((state) => {
    if (view.hidden || !current) return;
    const fresh = state.setlists.find((s) => s.id === current.id);
    if (fresh && fresh !== current) render(fresh);
  });

  return {
    element: view,
    open(setlist) { if (setlist !== current || view.hidden) render(setlist); },
  };
}
