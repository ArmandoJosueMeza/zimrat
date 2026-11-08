/* =========================================================
   SongForm.js — Crear / editar canción (solo administradores)
   Secciones: Datos · Música (tono, BPM, compás) · Organización
   (categoría, etiquetas) · Audio/Video · Letra para búsqueda · PDFs
   // ---------------------------------------------------------
   // FLUJO COMPLETO AL GUARDAR UNA CANCIÓN
   //   1. El admin rellena datos y elige PDFs (cada PDF se valida al
   //      elegirlo: tipo, extensión, firma %PDF- y tamaño).
   //   2. «Guardar» valida los datos (número único, título, BPM, enlace).
   //   3. backend.saveSong(): sube cada PDF nuevo a Cloudinary mostrando
   //      el progreso en su casilla y después guarda el documento en
   //      Firestore con las URLs.
   //   4. onSnapshot (tiempo real) actualiza la lista en todos los dispositivos.
   // Los cambios de archivos se acumulan en el objeto «changes»:
   //   changes.files  = { letra: File, … }   → PDFs nuevos a subir
   //   changes.remove = { acordes: true, … } → PDFs a quitar
   // =========================================================
   ========================================================= */
import config from '../../config.js';
import { store } from '../store.js';
import {
  el, icon, field, FORMATS, SIGNATURES, MAJOR_KEYS, MINOR_KEYS, BPM_MIN, BPM_MAX,
  keyLabel, parseTags, parseMediaUrl, formatBytes, toast,
} from '../utils.js';
import { extractPdfText } from '../services/pdf-text.js';
import { validatePdfFile } from '../services/cloudinary.js';
import { logError } from '../services/logger.js';
import { Modal } from './Modal.js';

/** Peso del PDF para datos móviles: ligero / aceptable / pesado. */
// Etiqueta de peso pensada para músicos con datos móviles.
function weightBadge(bytes) {
  const mb = bytes / 1048576;
  const [cls, text] = mb <= config.PDF_LIGHT_MB ? ['w-light', 'Ligero']
    : mb <= config.PDF_HEAVY_MB ? ['w-ok', 'Aceptable'] : ['w-heavy', 'Pesado'];
  return el('span', { class: `weight ${cls}`, title: mb > config.PDF_HEAVY_MB ? 'Tardará en cargar con datos móviles: conviene optimizarlo (ver consejos).' : '', text });
}

/**
 * Casilla de archivo para un formato (subir, reemplazar, quitar, arrastrar y soltar).
 * Validación ESTRICTA (validatePdfFile): solo application/pdf con firma %PDF-.
 * Si el archivo no cumple, la casilla se pone en rojo con el motivo y se rechaza.
 */
// Estados de la casilla (data-state, define el color en el CSS):
//   empty (sin PDF) · current (ya tiene PDF) · new (PDF nuevo elegido)
//   · removed (se quitará al guardar). La clase .invalid la pone roja.
function FileSlot(format, currentRef, changes, onAccept) {
  const input = el('input', { type: 'file', accept: 'application/pdf', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  const status = el('p', { class: 'slot-status' });
  const alertBox = el('p', { class: 'slot-alert', role: 'alert', hidden: true });
  const bar = el('span', { class: 'slot-progress-bar' });
  const progress = el('div', { class: 'slot-progress', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `Subida de ${format.label}` }, bar);
  const pickBtn = el('button', { class: 'btn btn-sm', type: 'button' });
  const undoBtn = el('button', { class: 'btn btn-sm btn-ghost', type: 'button' });
  const slot = el('div', { class: `slot slot-${format.key}` },
    el('span', { class: 'slot-ico', html: icon(format.icon) }),
    el('div', { class: 'slot-body' }, el('p', { class: 'slot-title', text: format.label }), status, alertBox, progress),
    el('div', { class: 'slot-actions' }, pickBtn, undoBtn),
    input);

  // render() redibuja la casilla según su estado actual.
  function render() {
    const file = changes.files[format.key];
    const removed = changes.remove[format.key];
    slot.dataset.state = file ? 'new' : removed ? 'removed' : currentRef ? 'current' : 'empty';
    const setStatus = (text, ok) => { status.replaceChildren(...(ok ? [el('span', { class: 'ok-ico', html: icon('check') })] : []), el('span', { text })); };
    if (file) {
      // Nombre en su propia línea (recortado con «…» si es largo) y detalles debajo:
      // así un nombre de archivo largo nunca ensancha el modal.
      status.replaceChildren(
        el('span', { class: 'slot-file' }, el('span', { class: 'ok-ico', html: icon('check') }), el('span', { class: 'slot-file-name', text: file.name, title: file.name })),
        el('span', { class: 'slot-file-meta' }, el('span', { text: formatBytes(file.size) }), weightBadge(file.size), el('span', { text: 'Se subirá a Cloudinary al guardar' })));
      pickBtn.innerHTML = `${icon('upload')}<span>Cambiar</span>`;
      undoBtn.hidden = false;
      undoBtn.innerHTML = `${icon('close')}<span>Descartar</span>`;
    } else if (currentRef && removed) {
      setStatus('Se quitará al guardar');
      pickBtn.innerHTML = `${icon('upload')}<span>Subir PDF</span>`;
      undoBtn.hidden = false;
      undoBtn.innerHTML = `${icon('undo')}<span>Deshacer</span>`;
    } else if (currentRef) {
      setStatus('PDF cargado', true);
      pickBtn.innerHTML = `${icon('upload')}<span>Reemplazar</span>`;
      undoBtn.hidden = false;
      undoBtn.innerHTML = `${icon('trash')}<span>Quitar</span>`;
    } else {
      setStatus('Sin archivo · elige o arrastra un PDF');
      pickBtn.innerHTML = `${icon('upload')}<span>Subir PDF</span>`;
      undoBtn.hidden = true;
    }
    pickBtn.setAttribute('aria-label', `${pickBtn.textContent} (${format.label})`);
    undoBtn.setAttribute('aria-label', `${undoBtn.textContent} (${format.label})`);
  }

  const clearAlert = () => { alertBox.hidden = true; alertBox.replaceChildren(); slot.classList.remove('invalid'); };
  // Alerta roja dentro de la casilla + animación de «sacudida» (shake).
  // void slot.offsetWidth reinicia la animación si se rechazan dos archivos seguidos.
  function showAlert(message) {
    alertBox.replaceChildren(el('span', { html: icon('alert') }), el('span', { text: message }));
    alertBox.hidden = false;
    slot.classList.remove('invalid');
    void slot.offsetWidth; // reinicia la animación
    slot.classList.add('invalid');
  }

  // Punto ÚNICO de entrada de archivos (botón o arrastrar y soltar): si no
  // pasa validatePdfFile, se rechaza y se conserva lo anterior.
  async function accept(file) {
    if (!file) return;
    const check = await validatePdfFile(file);
    if (!check.ok) {
      showAlert(check.message);
      toast(`Archivo rechazado: ${check.message}`, 'error');
      return; // no se guarda nada: se conserva el PDF anterior
    }
    clearAlert();
    changes.files[format.key] = file;
    delete changes.remove[format.key];
    render();
    onAccept?.(file);
    if (file.size > config.PDF_HEAVY_MB * 1048576) toast(`«${file.name}» pesa ${formatBytes(file.size)}: cargará lento con datos móviles. Mira los consejos para aligerarlo.`);
  }

  pickBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { accept(input.files[0]); input.value = ''; });
  undoBtn.addEventListener('click', () => {
    clearAlert();
    if (changes.files[format.key]) delete changes.files[format.key];
    else if (changes.remove[format.key]) delete changes.remove[format.key];
    else if (currentRef) changes.remove[format.key] = true;
    render();
  });
  // Arrastrar y soltar: dragover con preventDefault() permite soltar;
  // drop entrega el archivo (e.dataTransfer.files).
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('drag'));
  slot.addEventListener('drop', (e) => { e.preventDefault(); slot.classList.remove('drag'); accept(e.dataTransfer.files[0]); });

  render();
  return {
    element: slot,
    /** Progreso de subida 0-100 (null = ocultar) */
    setProgress(pct) {
      progress.hidden = pct == null;
      if (pct == null) { render(); return; }
      bar.style.width = `${pct}%`;
      progress.setAttribute('aria-valuenow', String(pct));
      status.replaceChildren(el('span', { text: pct >= 100 ? 'Subido a Cloudinary ✓' : `Subiendo a Cloudinary… ${pct}%` }));
    },
    lock(on) { pickBtn.disabled = undoBtn.disabled = on; },
  };
}

const section = (title, ...children) =>
  el('fieldset', { class: 'form-section' }, el('legend', { text: title }), ...children);

// Abre el formulario en una ventana modal. Si recibe «song» edita; si no, crea.
// dismissable: false → un clic fuera no cierra (no se pierde lo escrito).
// nextNumber propone el siguiente número libre.
export function openSongForm(ctx, song = null) {
  const editing = Boolean(song);
  const m = Modal({
    title: editing ? 'Editar canción' : 'Nueva canción',
    eyebrow: editing ? `Canción #${song.numero}` : 'Completa los datos',
    size: 'lg', dismissable: false,
  });
  const { songs } = store.get();
  const nextNumber = songs.reduce((max, s) => Math.max(max, s.numero), 0) + 1;

  /* ----- Datos ----- */
  const numero = el('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', required: true, value: String(editing ? song.numero : nextNumber) });
  const titulo = el('input', { type: 'text', required: true, maxlength: '200', placeholder: 'Ej. Amanecer', value: song?.titulo || '', autocomplete: 'off' });
  const autor = el('input', { type: 'text', maxlength: '120', placeholder: 'Ej. Coro Juvenil', value: song?.autor || '', autocomplete: 'off', list: 'authors-list' });
  const authorsList = el('datalist', { id: 'authors-list' }, ...[...new Set(songs.map((s) => s.autor).filter(Boolean))].sort().map((a) => el('option', { value: a })));

  /* ----- Música ----- */
  const tono = el('select', {},
    el('option', { value: '', text: '— Sin especificar —' }),
    el('optgroup', { label: 'Mayores' }, ...MAJOR_KEYS.map((k) => el('option', { value: k, text: keyLabel(k) }))),
    el('optgroup', { label: 'Menores' }, ...MINOR_KEYS.map((k) => el('option', { value: k, text: keyLabel(k) }))));
  if (song?.tono && ![...MAJOR_KEYS, ...MINOR_KEYS].includes(song.tono)) tono.append(el('option', { value: song.tono, text: song.tono })); // tono escrito a mano en Firestore
  tono.value = song?.tono || '';
  const bpm = el('input', { type: 'number', min: String(BPM_MIN), max: String(BPM_MAX), step: '1', inputmode: 'numeric', placeholder: '120', value: song?.bpm ? String(song.bpm) : '' });
  const compas = el('select', {}, el('option', { value: '', text: '— Sin especificar —' }), ...SIGNATURES.map((x) => el('option', { value: x, text: x })));
  compas.value = song?.compas || '';

  /* ----- Organización ----- */
  const categories = [...new Set([...config.DEFAULT_CATEGORIES, ...songs.map((s) => s.categoria).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'es'));
  const categoria = el('input', { type: 'text', maxlength: '60', placeholder: 'Ej. Música Sacra', value: song?.categoria || '', list: 'cats-list', autocomplete: 'off' });
  const catsList = el('datalist', { id: 'cats-list' }, ...categories.map((c) => el('option', { value: c })));
  const tags = el('input', { type: 'text', placeholder: 'alegre, entrada, comunión', value: (song?.tags || []).join(', '), autocomplete: 'off' });
  const tagPreview = el('div', { class: 'tag-list tag-preview', 'aria-live': 'polite' });
  const renderTags = () => tagPreview.replaceChildren(...parseTags(tags.value).map((t) => el('span', { class: 'tag', html: icon('tag') }, t)));
  tags.addEventListener('input', renderTags);
  renderTags();

  /* ----- Audio / video ----- */
  const audio = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://www.youtube.com/watch?v=…', value: song?.audioUrl || '', autocomplete: 'off' });
  const audioHint = el('p', { class: 'field-hint' });
  const renderAudioHint = () => {
    const v = audio.value.trim();
    const media = v ? parseMediaUrl(v) : null;
    audioHint.className = `field-hint ${v && !media ? 'hint-error' : media ? 'hint-ok' : ''}`;
    audioHint.textContent = !v ? 'Opcional. YouTube se muestra integrado; otros enlaces (Spotify, SoundCloud…) se abren aparte.'
      : !media ? 'El enlace debe empezar por https://' : media.type === 'youtube' ? '✓ Video de YouTube detectado' : `✓ Enlace a ${media.host}`;
  };
  audio.addEventListener('input', renderAudioHint);
  renderAudioHint();

  /* ----- Letra en texto ----- */
  const changes = { files: {}, remove: {} };
  const letraTexto = el('textarea', { rows: '7', placeholder: 'Pega aquí la letra (o extráela del PDF) para poder buscar por frases…', spellcheck: 'true' });
  letraTexto.value = song?.letraTexto || '';
  const extractBtn = el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('lyrics')}<span>Extraer del PDF de letra</span>` });
  // Extrae el texto del PDF de letra con PDF.js (pdf-text.js) y lo pone en
  // el campo «letra» para que la canción se pueda buscar por frases. Se
  // lanza sola al elegir el PDF de letra (silent: sin avisos si no hay texto).
  async function extractFrom(blobOrNull, { silent = false } = {}) {
    try {
      let source = blobOrNull || changes.files.letra || null;
      if (!source && song?.letra && !changes.remove.letra) source = await ctx.backend.getPdfBlob(song.letra);
      if (!source) { toast('Primero sube el PDF de «Letra».', 'error'); return; }
      extractBtn.disabled = true;
      const text = await extractPdfText(source);
      if (!text) { if (!silent) toast('Ese PDF no contiene texto (¿es escaneado?). Escribe la letra a mano.', 'error'); return; }
      letraTexto.value = text;
      toast('Letra extraída del PDF. Revísala si hace falta.', 'success');
    } catch (err) {
      logError('pdf', err, { accion: 'extraer letra', cancion: titulo.value });
      if (!silent) toast(err.message && err.code ? err.message : 'No se pudo leer el PDF.', 'error');
    } finally {
      extractBtn.disabled = false;
    }
  }
  extractBtn.addEventListener('click', () => extractFrom(null));

  /* ----- PDFs ----- */
  // Una casilla por formato. Object.fromEntries crea { letra: casilla, … }
  // para poder llamar después a fileSlots[clave].setProgress(%).
  const fileSlots = Object.fromEntries(FORMATS.map((f) => [f.key, FileSlot(f, song?.[f.key], changes,
    f.key === 'letra' ? (file) => { if (!letraTexto.value.trim()) extractFrom(file, { silent: true }); } : null)]));
  const slots = FORMATS.map((f) => fileSlots[f.key].element);

  /* ----- Formulario ----- */
  const error = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', html: `${icon('check')}<span>${editing ? 'Guardar cambios' : 'Crear canción'}</span>` });
  const cancel = el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => m.close() });

  const form = el('form', { class: 'form', novalidate: true },
    section('Datos de la canción',
      el('div', { class: 'form-row form-row-num' }, field('Número', numero), field('Título', titulo)),
      field('Autor / Intérprete', autor), authorsList),
    section('Música',
      el('div', { class: 'form-row form-row-3' }, field('Tono', tono), field('BPM', bpm), field('Compás', compas))),
    section('Organización',
      el('div', { class: 'form-row form-row-2' },
        field('Categoría / Género', categoria),
        field('Etiquetas', tags, 'Separadas por comas')),
      catsList, tagPreview),
    section('Audio / Video de referencia', field('Enlace', audio, audioHint)),
    section('Archivos PDF',
      el('p', { class: 'field-hint', text: `Elige los PDF desde este dispositivo: se suben a Cloudinary al guardar. Solo se aceptan archivos PDF (application/pdf) de hasta ${config.MAX_PDF_MB} MB.` }),
      el('div', { class: 'slots' }, ...slots),
      el('details', { class: 'pdf-tips' },
        el('summary', { html: `${icon('feather')}<span>Consejos para PDFs ligeros (recomendado: menos de ${config.PDF_LIGHT_MB} MB)</span>` }),
        el('ul', {},
          el('li', { text: 'Exporta desde Word, MuseScore o Sibelius con «Guardar como PDF» y la opción «Tamaño mínimo / Publicación en línea».' }),
          el('li', { text: 'Para partituras escaneadas: escala de grises, 150–200 ppp. Más resolución no se nota en pantalla y multiplica el peso.' }),
          el('li', { text: 'Comprime PDFs pesados con herramientas gratuitas (p. ej. «Comprimir PDF» de iLovePDF/Smallpdf) o con Ghostscript (ver README).' }),
          el('li', { text: 'Un PDF con texto real (no escaneado) pesa menos, se ve nítido con zoom y permite extraer la letra para la búsqueda.' }),
          el('li', { text: 'Separa cada formato en su propio archivo: los músicos solo descargan el que necesitan.' })))),
    section('Letra para la búsqueda',
      field('Texto de la letra', letraTexto, 'Permite encontrar la canción escribiendo una frase. Se rellena sola al elegir el PDF de letra.'),
      el('div', {}, extractBtn)),
    error,
    el('div', { class: 'modal-actions form-actions' }, cancel, submit));

  // GUARDAR: validaciones → bloquear botones → saveSong con onProgress
  // (actualiza la barra de cada casilla) → recargar → cerrar.
  // Si algo falla, se muestra el mensaje en el formulario y se desbloquea todo.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const fail = (msg, input) => { error.textContent = msg; input?.focus(); input?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

    const n = Number(numero.value);
    const t = titulo.value.trim().replace(/\s+/g, ' ');
    const b = bpm.value.trim() ? Number(bpm.value) : null;
    const url = audio.value.trim();
    if (!Number.isInteger(n) || n < 1) return fail('El número debe ser un entero mayor que 0.', numero);
    if (!t) return fail('Escribe el título de la canción.', titulo);
    const dup = store.get().songs.find((s) => s.numero === n && s.id !== song?.id);
    if (dup) return fail(`El número ${n} ya lo usa «${dup.titulo}».`, numero);
    if (b !== null && (!Number.isInteger(b) || b < BPM_MIN || b > BPM_MAX)) return fail(`El BPM debe estar entre ${BPM_MIN} y ${BPM_MAX}.`, bpm);
    if (url && !parseMediaUrl(url)) return fail('El enlace de audio/video debe empezar por https://', audio);
    // Doble control: vuelve a validar cada PDF justo antes de subirlo
    for (const f of FORMATS) {
      const file = changes.files[f.key];
      if (!file) continue;
      const check = await validatePdfFile(file);
      if (!check.ok) return fail(`«${f.label}»: ${check.message}`);
    }

    const data = {
      id: song?.id, numero: n, titulo: t,
      autor: autor.value.trim(), tono: tono.value, bpm: b, compas: compas.value,
      categoria: categoria.value.trim().replace(/\s+/g, ' '), tags: parseTags(tags.value),
      audioUrl: url, letraTexto: letraTexto.value.trim(),
    };

    submit.disabled = cancel.disabled = true;
    m.setBusy(true);
    submit.innerHTML = '<span class="spinner spinner-sm"></span><span>Guardando…</span>';
    const uploading = Object.keys(changes.files);
    Object.values(fileSlots).forEach((x) => x.lock(true));
    uploading.forEach((k) => fileSlots[k].setProgress(0));
    if (uploading.length) submit.innerHTML = '<span class="spinner spinner-sm"></span><span>Subiendo PDFs…</span>';
    try {
      await ctx.backend.saveSong(data, { ...changes, onProgress: (key, pct) => fileSlots[key]?.setProgress(pct) });
      await ctx.reloadSongs();
      m.setBusy(false);
      m.close();
      toast(editing ? 'Cambios guardados' : `«${t}» creada`, 'success');
    } catch (err) {
      console.error(err);
      error.textContent = err.message || 'No se pudo guardar.';
      Object.values(fileSlots).forEach((x) => { x.lock(false); x.setProgress(null); });
      submit.disabled = cancel.disabled = false;
      m.setBusy(false);
      submit.innerHTML = `${icon('check')}<span>${editing ? 'Guardar cambios' : 'Crear canción'}</span>`;
    }
  });

  m.body.append(form);
  m.open();
  titulo.focus();
}
