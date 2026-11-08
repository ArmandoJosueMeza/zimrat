/* =========================================================
   SetlistForm.js — Crear / editar un repertorio LOCAL (cualquier usuario)
   Buscar canciones → añadir → ordenar con ▲▼ → guardar en este navegador.
   ========================================================= */
import { store } from '../store.js';
import { el, icon, field, searchSongs, prettyKey, toast } from '../utils.js';
import { Modal } from './Modal.js';
import { confirmDialog } from './ConfirmDialog.js';

// FORMULARIO DE REPERTORIO (crear o editar; disponible para cualquier usuario):
// nombre, fecha, notas y selector de canciones con buscador.
// «selected» guarda los ids elegidos EN ORDEN; las flechas ↑ ↓ los reordenan.
// Al guardar se llama a ctx.setlists.save() → localStorage (sin servidor).
export function openSetlistForm(ctx, setlist = null) {
  const editing = Boolean(setlist);
  const m = Modal({ title: editing ? 'Editar repertorio' : 'Nuevo repertorio', eyebrow: 'Se guarda solo en este dispositivo', size: 'lg', dismissable: false });
  const { songs } = store.get();
  const byId = new Map(songs.map((s) => [s.id, s]));
  let selected = (setlist?.songIds || []).filter((id) => byId.has(id));

  const nombre = el('input', { type: 'text', maxlength: '120', required: true, placeholder: 'Ej. Repertorio Domingo', value: setlist?.nombre || '', autocomplete: 'off' });
  const fecha = el('input', { type: 'date', value: setlist?.fecha || '' });
  const notas = el('textarea', { rows: '2', maxlength: '500', placeholder: 'Indicaciones para los músicos (opcional)' });
  notas.value = setlist?.notas || '';

  /* ----- Buscador para añadir ----- */
  const finder = el('input', { type: 'search', placeholder: 'Buscar canción por título, número o letra…', autocomplete: 'off', 'aria-label': 'Buscar canción para añadir' });
  const results = el('div', { class: 'picker-results' });
  const chosen = el('ol', { class: 'picker-chosen', 'aria-live': 'polite' });
  const chosenCount = el('span', { class: 'muted' });

  // Resultados del buscador (reutiliza searchSongs de utils.js), sin las ya elegidas.
  function renderResults() {
    const found = searchSongs(songs, finder.value).map((r) => r.song).filter((s) => !selected.includes(s.id)).slice(0, finder.value ? 8 : 5);
    results.replaceChildren(...(found.length ? found.map((song) => el('button', {
      class: 'picker-item', type: 'button', 'aria-label': `Añadir ${song.titulo}`,
      onclick: () => { selected.push(song.id); renderChosen(); renderResults(); finder.focus(); },
    },
      el('span', { class: 'song-num', text: song.numero }),
      el('span', { class: 'picker-title', text: song.titulo }),
      song.tono ? el('span', { class: 'key-badge', text: prettyKey(song.tono) }) : null,
      el('span', { class: 'picker-add', html: `${icon('plus')}<span>Añadir</span>` })))
      : [el('p', { class: 'muted picker-empty', text: finder.value ? 'Sin resultados (o ya están todas añadidas).' : 'Todas las canciones están añadidas.' })]));
  }

  // Reordenar: intercambia la canción con la anterior o la siguiente del array.
  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= selected.length) return;
    [selected[i], selected[j]] = [selected[j], selected[i]];
    renderChosen();
    chosen.children[j]?.querySelector(delta < 0 ? '.mv-up' : '.mv-down')?.focus();
  }

  function renderChosen() {
    chosenCount.textContent = `${selected.length} ${selected.length === 1 ? 'canción' : 'canciones'}`;
    chosen.replaceChildren(...(selected.length ? selected.map((id, i) => {
      const song = byId.get(id);
      return el('li', { class: 'chosen-item' },
        el('span', { class: 'setlist-index', text: i + 1 }),
        el('span', { class: 'picker-title' }, el('strong', { text: song.titulo }), el('small', { class: 'muted', text: [`#${song.numero}`, song.tono && prettyKey(song.tono), song.bpm && `${song.bpm} BPM`].filter(Boolean).join(' · ') })),
        el('span', { class: 'chosen-actions' },
          el('button', { class: 'btn btn-icon btn-ghost mv-up', type: 'button', disabled: i === 0, 'aria-label': `Subir ${song.titulo}`, html: icon('up'), onclick: () => move(i, -1) }),
          el('button', { class: 'btn btn-icon btn-ghost mv-down', type: 'button', disabled: i === selected.length - 1, 'aria-label': `Bajar ${song.titulo}`, html: icon('down'), onclick: () => move(i, 1) }),
          el('button', { class: 'btn btn-icon btn-ghost btn-danger-text', type: 'button', 'aria-label': `Quitar ${song.titulo}`, html: icon('close'), onclick: () => { selected.splice(i, 1); renderChosen(); renderResults(); } })));
    }) : [el('li', { class: 'muted picker-empty', text: 'Aún no hay canciones. Añádelas desde el buscador.' })]));
  }

  finder.addEventListener('input', renderResults);

  const error = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', html: `${icon('check')}<span>${editing ? 'Guardar cambios' : 'Crear repertorio'}</span>` });
  const cancel = el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => m.close() });
  const del = editing ? el('button', { class: 'btn btn-ghost btn-danger-text form-delete', type: 'button', html: `${icon('trash')}<span>Eliminar</span>` }) : null;

  const form = el('form', { class: 'form', novalidate: true },
    el('fieldset', { class: 'form-section' }, el('legend', { text: 'Datos' }),
      el('div', { class: 'form-row form-row-2' }, field('Nombre', nombre), field('Fecha del evento', fecha)),
      field('Notas', notas)),
    el('fieldset', { class: 'form-section' }, el('legend', { text: 'Canciones' }),
      el('div', { class: 'picker' },
        el('div', { class: 'picker-col' }, el('p', { class: 'label', text: 'Añadir' }), finder, results),
        el('div', { class: 'picker-col' }, el('p', { class: 'label' }, 'Orden del repertorio · ', chosenCount), chosen))),
    error,
    el('div', { class: 'modal-actions form-actions' }, del, cancel, submit));

  // Borrar repertorio (solo al editar; «del?.» porque al crear no existe el botón).
  del?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Eliminar repertorio', message: `Se eliminará «${setlist.nombre}». Las canciones no se borran.`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    try {
      ctx.setlists.remove(setlist.id);
      m.close();
      toast('Repertorio eliminado', 'success');
      if (location.hash.startsWith('#/r/')) ctx.replace('#/');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const name = nombre.value.trim().replace(/\s+/g, ' ');
    if (!name) { error.textContent = 'Escribe un nombre para el repertorio.'; nombre.focus(); return; }
    submit.disabled = cancel.disabled = true;
    m.setBusy(true);
    try {
      const saved = ctx.setlists.save({ id: setlist?.id, nombre: name, fecha: fecha.value, notas: notas.value.trim(), songIds: selected });
      m.setBusy(false);
      m.close();
      toast(editing ? 'Repertorio guardado' : `«${name}» creado`, 'success');
      if (!editing) ctx.go(`#/r/${saved.id}`);
    } catch (err) {
      error.textContent = err.message || 'No se pudo guardar.';
      submit.disabled = cancel.disabled = false;
      m.setBusy(false);
    }
  });

  renderResults();
  renderChosen();
  m.body.append(form);
  m.open();
  nombre.focus();
}
