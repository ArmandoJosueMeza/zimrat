/* =========================================================
   AdminPanel.js — Panel del administrador (zimratapp@gmail.com)
   ---------------------------------------------------------
   · Monitor de conexión con Firebase (verde «Conectado» / rojo «Error»)
   · Pestañas: Canciones (CRUD) · Sugerencias (buzón público)
               · Registro de errores (red, Cloudinary, Firestore…)
               · Archivos Cloudinary (PDFs huérfanos pendientes de borrar)
   (Los repertorios son locales de cada usuario: no se gestionan aquí.)
   ========================================================= */
import config from '../../config.js';
import { store } from '../store.js';
import { el, icon, searchSongs, sortByTitle, sortByNumber, prettyKey, FORMATS, toast } from '../utils.js';
import { pendingLogs, onLogsChanged, flushLogQueue } from '../services/logger.js';
import { mediaLibraryUrl } from '../services/cloudinary.js';
import { openSongForm } from './SongForm.js';
import { confirmDialog } from './ConfirmDialog.js';

// Ayudantes de presentación: fecha corta en español y nombres legibles.
const fmtTime = (ms) => new Date(ms).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const SOURCE_LABEL = { firestore: 'Firestore', cloudinary: 'Cloudinary', red: 'Red', pdf: 'PDF', auth: 'Login', javascript: 'JavaScript' };
const TYPE_LABEL = { sugerencia: 'Sugerencia', error: 'Error', comentario: 'Comentario' };

// PANEL DEL ADMINISTRADOR (#/admin). Solo se ve con sesión de admin
// (app.js protege la ruta y firestore.rules protege los datos).
// Estructura: cabecera → monitor de conexión → aviso del modo → pestañas
//   [Canciones] [Sugerencias] [Registro de errores] [Archivos Cloudinary]
export function AdminPanel(ctx) {
  let filter = '';
  let order = 'titulo';

  const search = el('input', { type: 'search', placeholder: 'Filtrar por título, número, autor o letra…', 'aria-label': 'Filtrar canciones', autocomplete: 'off' });
  search.addEventListener('input', () => { filter = search.value; render(store.get(), true); });

  const sortSelect = el('select', { 'aria-label': 'Ordenar' },
    el('option', { value: 'titulo', text: 'Orden: A-Z' }),
    el('option', { value: 'numero', text: 'Orden: número' }));
  sortSelect.addEventListener('change', () => { order = sortSelect.value; render(store.get(), true); });

  const stats = el('div', { class: 'stats' });
  const rows = el('div', { class: 'admin-list' });
  const banner = el('div');
  const newBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button', html: `${icon('plus')}<span>Nueva canción</span>`, onclick: () => openSongForm(ctx) });
  const songsPane = el('div', {},
    stats,
    el('div', { class: 'admin-tools' },
      el('div', { class: 'search search-sm' }, el('span', { class: 'search-ico', html: icon('search') }), search),
      sortSelect),
    rows);

  /* ---------- Monitor de conexión ---------- */
  const connBox = el('div', { class: 'conn-box', role: 'status', 'aria-live': 'polite' });
  const checkBtn = el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('refresh')}<span>Verificar ahora</span>`, onclick: () => ctx.checkConnection() });
  // Dibuja la tarjeta de conexión a partir de store.connection (lo actualiza
  // ctx.checkConnection en app.js). data-state colorea: ok verde, error rojo.
  function renderConn({ connection, online }) {
    const c = connection || {};
    const state = !online ? 'error' : c.state || 'checking';
    connBox.dataset.state = state;
    const title = state === 'ok' ? (c.demo ? 'Modo demo · sin servidor' : 'Conectado a Firebase')
      : state === 'error' ? 'Error de conexión' : 'Comprobando conexión…';
    const detail = !online ? 'El dispositivo no tiene conexión a internet.'
      : state === 'ok' ? (c.demo ? 'Los datos se guardan en este navegador.' : `Firestore respondió en ${c.ms} ms · proyecto «${config.FIREBASE.projectId}»`)
        : state === 'error' ? (c.message || 'No se pudo contactar con Firestore.') : 'Consultando el servidor de Firestore…';
    connBox.replaceChildren(
      el('span', { class: 'conn-dot', 'aria-hidden': 'true' }),
      el('div', { class: 'conn-text' },
        el('strong', { text: title }),
        el('p', { text: detail }),
        c.at ? el('p', { class: 'conn-time', text: `Última comprobación: ${new Date(c.at).toLocaleTimeString('es')} · se repite cada ${config.CONNECTION_CHECK_SECONDS} s` }) : null),
      checkBtn);
    checkBtn.disabled = state === 'checking';
  }

  /* ---------- Pestañas ---------- */
  const panes = { songs: songsPane, feedback: el('div', { hidden: true }), logs: el('div', { hidden: true }), trash: el('div', { hidden: true }) };
  const TABS = [['songs', 'list', 'Canciones', 'Canciones'], ['feedback', 'message', 'Sugerencias', 'Buzón'], ['logs', 'bug', 'Registro de errores', 'Errores']];
  if (ctx.backend.cloudinaryCleanup) TABS.push(['trash', 'cloud', 'Archivos Cloudinary', 'Nube']);
  const tabBtns = {};
  let tab = 'songs';
  const tabBar = el('div', { class: 'admin-tabs', role: 'tablist', 'aria-label': 'Secciones del panel' },
    ...TABS.map(([key, ic, label, short]) => {
      tabBtns[key] = el('button', { class: 'admin-tab', type: 'button', role: 'tab', 'aria-selected': String(key === tab), dataset: { tab: key },
        html: `${icon(ic)}<span class="tab-full">${label}</span><span class="tab-short">${short}</span><span class="tab-badge" hidden></span>`, onclick: () => selectTab(key) });
      return tabBtns[key];
    }));
  // Cambia de pestaña: marca aria-selected (accesibilidad), muestra su panel
  // y carga sus datos al abrirla (no antes: ahorra lecturas de Firestore).
  function selectTab(key) {
    tab = key;
    for (const k of Object.keys(panes)) { tabBtns[k]?.setAttribute('aria-selected', String(k === key)); panes[k].hidden = k !== key; }
    newBtn.hidden = key !== 'songs';
    if (key === 'feedback') loadFeedback();
    if (key === 'logs') loadLogs();
    if (key === 'trash') loadTrash();
  }
  const setBadge = (key, n) => { if (!tabBtns[key]) return; const b = tabBtns[key].querySelector('.tab-badge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); };

  const view = el('section', { class: 'view container container-wide', 'aria-label': 'Panel de administración', hidden: true },
    el('div', { class: 'admin-head' },
      el('div', {},
        el('h1', {}, 'Panel de administración ', el('span', { class: 'version-pill', text: `v${config.APP_VERSION}` })),
        el('p', { class: 'muted', text: 'Canciones con PDFs en Cloudinary, buzón de sugerencias y registro de errores.' })),
      newBtn),
    connBox,
    banner,
    tabBar,
    panes.songs, panes.feedback, panes.logs, panes.trash);

  function renderBanner() {
    if (ctx.backend.mode === 'firebase' && ctx.backend.emulators) {
      banner.replaceChildren(el('div', { class: 'notice notice-warn' },
        el('span', { html: icon('info') }),
        el('div', {}, el('strong', { text: 'Firebase · emuladores locales' }), el('p', { text: 'Estás usando Auth y Firestore simulados en tu PC (Emulator UI: http://127.0.0.1:4000). Los PDFs sí se suben a Cloudinary.' }))));
    } else if (ctx.backend.mode === 'firebase') {
      banner.replaceChildren(el('div', { class: 'notice notice-ok' },
        el('span', { html: icon('cloud') }),
        el('div', {}, el('strong', { text: 'Publicación en tiempo real' }), el('p', { text: `Los cambios se ven al instante en todos los dispositivos. Los PDFs se suben a Cloudinary («${config.CLOUDINARY.cloudName}», preset «${config.CLOUDINARY.uploadPreset}»).` }))));
    } else {
      banner.replaceChildren(el('div', { class: 'notice notice-warn' },
        el('span', { html: icon('info') }),
        el('div', {},
          el('strong', { text: 'Modo demo' }),
          el('p', { text: 'Los cambios se guardan solo en este navegador. Cambia BACKEND a «firebase» en config.js para publicarlos (ver README).' })),
        el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('refresh')}<span>Restablecer ejemplos</span>`, onclick: resetDemo })));
    }
  }

  async function resetDemo() {
    const ok = await confirmDialog({ title: 'Restablecer datos de ejemplo', message: 'Se borrarán todas las canciones y PDFs de este navegador y se cargarán las de ejemplo.', confirmText: 'Restablecer', danger: true });
    if (!ok) return;
    await ctx.backend.resetDemo();
    await ctx.reloadSongs();
    toast('Datos de ejemplo restablecidos', 'success');
  }

  // ELIMINAR CANCIÓN: confirmación → backend.deleteSong (borra el documento y
  // apunta sus PDFs en «cloudinaryTrash») → se quita de los repertorios
  // locales → recarga. El aviso indica cuántos PDFs quedan por borrar en la nube.
  async function remove(song) {
    const files = FORMATS.filter((f) => song[f.key]).length;
    const cloud = ctx.backend.cloudinaryCleanup;
    const ok = await confirmDialog({
      title: 'Eliminar canción',
      message: `Se eliminará «${song.titulo}» (#${song.numero}) para todos los usuarios. Esta acción no se puede deshacer.`
        + (files ? (cloud
          ? ` Sus ${files} PDF dejarán de usarse y quedarán en «Archivos Cloudinary» para que los borres de la nube.`
          : ` También se borrarán sus ${files} PDF de este navegador.`) : ''),
      confirmText: 'Eliminar', danger: true,
    });
    if (!ok) return;
    try {
      const result = await ctx.backend.deleteSong(song);
      ctx.setlists.removeSong(song.id); // también de los repertorios locales de este navegador
      await ctx.reloadData();
      toast(result?.orphaned
        ? `«${song.titulo}» eliminada. ${result.orphaned} PDF pendiente(s) de borrar en Cloudinary (Panel → Archivos Cloudinary).`
        : `«${song.titulo}» eliminada`, 'success');
    } catch (err) {
      toast(err.message || 'No se pudo eliminar.', 'error');
    }
  }

  // Fila de la lista: chips de formatos (tachados si faltan) y aviso «Sin letra»
  // si no se podrá encontrar por frases.
  function row(song) {
    const badges = el('div', { class: 'chips' }, ...FORMATS.map((f) => {
      const has = Boolean(song[f.key]);
      return has
        ? el('button', { class: `chip chip-${f.key} chip-btn`, type: 'button', title: `Ver ${f.label}`, text: f.label, onclick: () => ctx.go(`#/c/${song.numero}/${f.key}`) })
        : el('span', { class: `chip chip-${f.key} chip-off`, title: `${f.label}: falta`, text: f.label });
    }));
    return el('div', { class: 'admin-row' },
      el('span', { class: 'song-num', text: song.numero }),
      el('div', { class: 'admin-info' },
        el('p', { class: 'song-title', text: song.titulo }),
        el('p', { class: 'admin-meta' },
          ...[song.autor, song.categoria, song.tono && `Tono ${prettyKey(song.tono)}`, song.bpm && `${song.bpm} BPM`, song.compas]
            .filter(Boolean).flatMap((x, i) => (i ? [el('span', { class: 'sep', text: '·' }), x] : [x])),
          song.letraTexto ? null : el('span', { class: 'warn-pill', title: 'Sin letra en texto: no aparecerá al buscar por frases', text: 'Sin letra' })),
        badges),
      el('div', { class: 'admin-actions' },
        el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Editar ${song.titulo}`, html: `${icon('edit')}<span class="hide-sm">Editar</span>`, onclick: () => openSongForm(ctx, song) }),
        el('button', { class: 'btn btn-sm btn-ghost btn-danger-text', type: 'button', 'aria-label': `Eliminar ${song.titulo}`, html: `${icon('trash')}<span class="hide-sm">Eliminar</span>`, onclick: () => remove(song) })));
  }

  /**
   * Ejecuta un borrado en la base de datos con el botón bloqueado (evita
   * dobles clics). Solo si Firestore confirma, se quita de la lista.
   */
  // Patrón de borrado SEGURO: bloquea el botón, espera la confirmación del
  // servidor y solo entonces se quita de la lista. Si falla, el elemento sigue
  // ahí y se informa el motivo. Devuelve true/false.
  async function busyDelete(btn, action) {
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span><span class="hide-sm">Eliminando…</span>';
    try {
      await action();
      return true;
    } catch (err) {
      toast(err.message || 'No se pudo eliminar de la base de datos.', 'error');
      btn.disabled = false;
      btn.innerHTML = html;
      return false;
    }
  }

  /* ---------- Sugerencias ---------- */
  let feedback = [];
  let fbFilter = 'all';
  const fbList = el('div', { class: 'card-list' });
  const fbFilterSel = el('select', { 'aria-label': 'Filtrar sugerencias' },
    el('option', { value: 'all', text: 'Todas' }), el('option', { value: 'unread', text: 'Sin leer' }),
    ...Object.entries(TYPE_LABEL).map(([v, t]) => el('option', { value: v, text: t })));
  fbFilterSel.addEventListener('change', () => { fbFilter = fbFilterSel.value; renderFeedback(); });
  const clearReadBtn = el('button', { class: 'btn btn-sm btn-ghost btn-danger-text', type: 'button', html: `${icon('trash')}<span>Eliminar leídas</span>`, onclick: clearReadFeedback });
  panes.feedback.append(
    el('div', { class: 'admin-tools' },
      fbFilterSel,
      el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('refresh')}<span>Actualizar</span>`, onclick: () => loadFeedback() }),
      clearReadBtn),
    fbList);
  const syncUnread = () => store.set({ feedbackUnread: feedback.filter((x) => !x.read).length });
  // Borra en Firestore (en lote) todos los mensajes ya leídos y vuelve a leer la lista.
  async function clearReadFeedback() {
    const ids = feedback.filter((f) => f.read).map((f) => f.id);
    if (!ids.length) return;
    if (!(await confirmDialog({ title: 'Eliminar sugerencias leídas', message: `Se borrarán definitivamente de la base de datos ${ids.length} mensaje(s) ya leído(s).`, confirmText: 'Eliminar', danger: true }))) return;
    if (await busyDelete(clearReadBtn, () => ctx.backend.clearFeedback(ids))) {
      toast(`${ids.length} mensaje(s) eliminados de la base de datos`, 'success');
      await loadFeedback(); // vuelve a leer del servidor: refleja el estado real
    }
  }

  // Lee el buzón desde el servidor y actualiza el contador de no leídos.
  async function loadFeedback() {
    fbList.replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'spinner' })));
    try {
      feedback = await ctx.backend.listFeedback();
      store.set({ feedbackUnread: feedback.filter((f) => !f.read).length });
      renderFeedback();
    } catch (err) {
      fbList.replaceChildren(el('div', { class: 'notice notice-error' }, el('span', { html: icon('alert') }), el('div', {}, el('strong', { text: 'No se pudieron leer las sugerencias' }), el('p', { text: err.message }))));
    }
  }
  function renderFeedback() {
    const items = feedback.filter((f) => fbFilter === 'all' || (fbFilter === 'unread' ? !f.read : f.type === fbFilter));
    clearReadBtn.disabled = !feedback.some((f) => f.read);
    clearReadBtn.innerHTML = `${icon('trash')}<span>Eliminar leídas</span>`;
    fbList.replaceChildren(...(items.length ? items.map(feedbackCard)
      : [el('div', { class: 'empty' }, el('p', { class: 'empty-title', text: feedback.length ? 'Nada con este filtro' : 'Buzón vacío' }), el('p', { class: 'muted', text: 'Los mensajes enviados con el botón «Sugerencias» aparecen aquí.' }))]));
  }
  // Tarjeta de un mensaje: tipo, fecha, canción, texto y acciones
  // «Marcar leída» (updateDoc read: true) y «Eliminar» (deleteDoc).
  function feedbackCard(f) {
    const markBtn = f.read ? null : el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('check')}<span>Marcar leída</span>`, onclick: async () => {
      try { await ctx.backend.markFeedbackRead(f.id); f.read = true; store.set({ feedbackUnread: feedback.filter((x) => !x.read).length }); renderFeedback(); } catch (err) { toast(err.message, 'error'); }
    } });
    const delBtn = el('button', { class: 'btn btn-sm btn-ghost btn-danger-text', type: 'button', 'aria-label': 'Eliminar mensaje', html: `${icon('trash')}<span class="hide-sm">Eliminar</span>`, onclick: async () => {
      if (!(await confirmDialog({ title: 'Eliminar mensaje', message: 'Se borrará definitivamente de la base de datos. No se puede deshacer.', confirmText: 'Eliminar', danger: true }))) return;
      if (await busyDelete(delBtn, () => ctx.backend.deleteFeedback(f.id))) {
        feedback = feedback.filter((x) => x.id !== f.id);
        syncUnread();
        renderFeedback();
        toast('Mensaje eliminado de la base de datos', 'success');
      }
    } });
    return el('article', { class: `info-card fb-card ${f.read ? 'is-read' : 'is-unread'}` },
      el('div', { class: 'info-card-head' },
        el('span', { class: `type-pill type-${f.type}`, text: TYPE_LABEL[f.type] || f.type }),
        f.read ? null : el('span', { class: 'new-pill', text: 'Nuevo' }),
        el('span', { class: 'info-time', text: fmtTime(f.createdAt) })),
      f.songTitle ? el('p', { class: 'info-song' }, el('span', { html: icon('music') }), el('span', { text: f.songTitle })) : null,
      el('p', { class: 'info-msg', text: f.message }),
      (f.name || f.contact) ? el('p', { class: 'info-meta', text: [f.name, f.contact].filter(Boolean).join(' · ') }) : null,
      el('div', { class: 'info-actions' }, markBtn, delBtn));
  }

  /* ---------- Registro de errores ---------- */
  let logs = [];
  let logFilter = 'all';
  const logList = el('div', { class: 'card-list' });
  const pendingBox = el('div');
  const logFilterSel = el('select', { 'aria-label': 'Filtrar por origen' },
    el('option', { value: 'all', text: 'Todos los orígenes' }),
    ...Object.entries(SOURCE_LABEL).map(([v, t]) => el('option', { value: v, text: t })));
  logFilterSel.addEventListener('change', () => { logFilter = logFilterSel.value; renderLogs(); });
  const clearBtn = el('button', { class: 'btn btn-sm btn-ghost btn-danger-text', type: 'button', html: `${icon('trash')}<span>Vaciar registro</span>`, onclick: clearAll });
  panes.logs.append(
    el('p', { class: 'muted', text: 'Fallos de red, de Cloudinary (subidas), de Firestore, de PDFs y de JavaScript registrados en cualquier dispositivo. Solo tú puedes verlos.' }),
    el('div', { class: 'admin-tools' },
      logFilterSel,
      el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('refresh')}<span>Actualizar</span>`, onclick: () => loadLogs() }),
      clearBtn),
    pendingBox,
    logList);

  // Errores que este dispositivo registró sin conexión y aún no envió.
  function renderPending() {
    const n = pendingLogs().length;
    pendingBox.replaceChildren(...(n ? [el('div', { class: 'notice notice-warn' },
      el('span', { html: icon('offline') }),
      el('div', {}, el('strong', { text: `${n} error(es) pendientes en este dispositivo` }), el('p', { text: 'Se registraron sin conexión y se enviarán al volver internet.' })),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'Enviar ahora', onclick: async () => { await flushLogQueue(); loadLogs(); } }))] : []));
  }
  async function loadLogs() {
    renderPending();
    logList.replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'spinner' })));
    try {
      logs = await ctx.backend.listLogs();
      setBadge('logs', logs.length);
      renderLogs();
    } catch (err) {
      logList.replaceChildren(el('div', { class: 'notice notice-error' }, el('span', { html: icon('alert') }), el('div', {}, el('strong', { text: 'No se pudo leer el registro' }), el('p', { text: err.message || 'Error' }))));
    }
  }
  function renderLogs() {
    const items = logs.filter((l) => logFilter === 'all' || l.source === logFilter);
    clearBtn.disabled = !items.length;
    clearBtn.innerHTML = `${icon('trash')}<span>${logFilter === 'all' ? 'Vaciar registro' : 'Vaciar filtrados'}</span>`;
    logList.replaceChildren(...(items.length ? items.map(logCard)
      : [el('div', { class: 'empty' }, el('p', { class: 'empty-title', text: logs.length ? 'Nada con este filtro' : 'Sin errores registrados' }), el('p', { class: 'muted', text: '¡Todo funciona correctamente!' }))]));
  }
  // Tarjeta de un error: origen, código, mensaje y «Detalles» (página, rol,
  // navegador y contexto en JSON con sangría).
  function logCard(l) {
    const delBtn = logDeleteButton(l);
    let context = l.context;
    try { context = JSON.stringify(JSON.parse(l.context), null, 1); } catch { /* texto */ }
    return el('article', { class: `info-card log-card log-${l.source}` },
      el('div', { class: 'info-card-head' },
        el('span', { class: `src-pill src-${l.source}`, text: SOURCE_LABEL[l.source] || l.source }),
        l.code ? el('code', { class: 'log-code', text: l.code }) : null,
        el('span', { class: 'info-time', text: fmtTime(l.createdAt) })),
      el('p', { class: 'info-msg', text: l.message }),
      el('details', { class: 'log-details' },
        el('summary', { text: 'Detalles' }),
        el('pre', { text: [`Página: ${l.page || '—'}`, `Rol: ${l.userRole || '—'} · ${l.online === false ? 'sin conexión' : 'con conexión'}`, `Navegador: ${l.userAgent || '—'}`, context && context !== '{}' ? `Contexto: ${context}` : ''].filter(Boolean).join('\n') })),
      el('div', { class: 'info-actions' }, delBtn));
  }
  function logDeleteButton(l) {
    const btn = el('button', { class: 'btn btn-sm btn-ghost btn-danger-text', type: 'button', 'aria-label': 'Eliminar registro', html: `${icon('trash')}<span class="hide-sm">Eliminar</span>`, onclick: async () => {
      if (await busyDelete(btn, () => ctx.backend.deleteLog(l.id))) {
        logs = logs.filter((x) => x.id !== l.id);
        setBadge('logs', logs.length);
        renderLogs();
        toast('Registro eliminado de la base de datos', 'success');
      }
    } });
    return btn;
  }
  // Vacía el registro (todo o solo el origen filtrado) con borrado en lote.
  async function clearAll() {
    const ids = (logFilter === 'all' ? logs : logs.filter((l) => l.source === logFilter)).map((l) => l.id);
    if (!ids.length) return;
    const scope = logFilter === 'all' ? 'todo el historial' : `los registros de «${SOURCE_LABEL[logFilter]}»`;
    if (!(await confirmDialog({ title: 'Vaciar registro de errores', message: `Se borrarán definitivamente de la base de datos ${ids.length} registro(s) (${scope}).`, confirmText: 'Vaciar', danger: true }))) return;
    if (await busyDelete(clearBtn, () => ctx.backend.clearLogs(ids))) {
      toast(`${ids.length} registro(s) eliminados de la base de datos`, 'success');
      clearBtn.innerHTML = `${icon('trash')}<span>Vaciar registro</span>`;
      await loadLogs(); // vuelve a leer del servidor: refleja el estado real
    }
  }
  onLogsChanged(() => { if (!view.hidden && tab === 'logs') renderPending(); });

  /* ---------- Archivos Cloudinary huérfanos ----------
     Con un preset «unsigned» el navegador puede subir pero NO borrar
     (borrar exige el API Secret, que nunca debe ir en el código público).
     Por eso, al eliminar una canción o reemplazar un PDF, el archivo se
     apunta aquí y el admin lo borra en la Media Library de Cloudinary. */
  let trash = [];
  const trashList = el('div', { class: 'card-list' });
  const clearTrashBtn = el('button', { class: 'btn btn-sm btn-ghost btn-danger-text', type: 'button', html: `${icon('trash')}<span>Vaciar lista</span>`, onclick: clearTrashAll });
  if (ctx.backend.cloudinaryCleanup) {
    panes.trash.append(
      el('div', { class: 'notice notice-warn' },
        el('span', { html: icon('info') }),
        el('div', {},
          el('strong', { text: 'PDFs que ya no usa ninguna canción' }),
          el('p', { text: 'Por seguridad, la app no puede borrar archivos de Cloudinary (haría falta la clave secreta, que nunca debe estar en el navegador). Bórralos en la Media Library: copia el ID, búscalo y elimínalo. Luego pulsa «Ya lo borré». Así la cuenta gratuita no se llena.' }))),
      el('div', { class: 'admin-tools', style: 'margin-top:12px' },
        el('a', { class: 'btn btn-sm', href: mediaLibraryUrl(), target: '_blank', rel: 'noopener noreferrer', html: `${icon('external')}<span>Abrir Media Library</span>` }),
        el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('refresh')}<span>Actualizar</span>`, onclick: () => loadTrash() }),
        clearTrashBtn),
      trashList);
  }
  // Lista de PDFs huérfanos de Cloudinary (colección «cloudinaryTrash»).
  async function loadTrash() {
    trashList.replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'spinner' })));
    try {
      trash = await ctx.backend.listTrash();
      setBadge('trash', trash.length);
      renderTrash();
    } catch (err) {
      trashList.replaceChildren(el('div', { class: 'notice notice-error' }, el('span', { html: icon('alert') }), el('div', {}, el('strong', { text: 'No se pudo leer la lista' }), el('p', { text: err.message || 'Error' }))));
    }
  }
  function renderTrash() {
    clearTrashBtn.disabled = !trash.length;
    trashList.replaceChildren(...(trash.length ? trash.map(trashCard)
      : [el('div', { class: 'empty' }, el('p', { class: 'empty-title', text: 'Nada pendiente' }), el('p', { class: 'muted', text: 'Todos los PDFs de Cloudinary están en uso.' }))]));
  }
  function trashCard(t) {
    const copy = el('button', { class: 'btn btn-sm', type: 'button', html: `${icon('check')}<span>Copiar ID</span>`, onclick: async () => {
      try { await navigator.clipboard.writeText(t.publicId || t.url); toast('ID copiado: pégalo en el buscador de la Media Library', 'success'); } catch { toast(t.publicId || t.url); }
    } });
    const done = el('button', { class: 'btn btn-sm btn-ghost', type: 'button', html: `${icon('check')}<span>Ya lo borré</span>`, onclick: async () => {
      try { await ctx.backend.deleteTrash(t.id); trash = trash.filter((x) => x.id !== t.id); setBadge('trash', trash.length); renderTrash(); } catch (err) { toast(err.message, 'error'); }
    } });
    return el('article', { class: 'info-card trash-card' },
      el('div', { class: 'info-card-head' },
        el('span', { class: 'src-pill src-cloudinary', text: t.reason || 'sin uso' }),
        el('span', { class: 'info-time', text: fmtTime(t.createdAt) })),
      t.songTitle ? el('p', { class: 'info-song' }, el('span', { html: icon('music') }), el('span', { text: t.songTitle })) : null,
      el('code', { class: 'trash-id', text: t.publicId || t.url }),
      el('div', { class: 'info-actions' },
        el('a', { class: 'btn btn-sm btn-ghost', href: t.url, target: '_blank', rel: 'noopener noreferrer', html: `${icon('eye')}<span class="hide-sm">Ver PDF</span>` }),
        copy, done));
  }
  async function clearTrashAll() {
    if (!(await confirmDialog({ title: 'Vaciar lista', message: `Se quitarán ${trash.length} elementos de la lista. Hazlo solo si ya borraste esos PDFs en Cloudinary (vaciar la lista NO los borra de la nube).`, confirmText: 'Vaciar', danger: true }))) return;
    try { await ctx.backend.clearTrash(trash.map((t) => t.id)); trash = []; setBadge('trash', 0); renderTrash(); } catch (err) { toast(err.message || 'No se pudo vaciar.', 'error'); }
  }

  let lastSongs;
  // Pestaña Canciones: estadísticas (cuántas tienen cada formato), filtro,
  // orden A-Z o por número, y las filas.
  function render(state, force = false) {
    const { songs } = state;
    if (!force && songs === lastSongs) return;
    lastSongs = songs;
    const count = (k) => songs.filter((s) => s[k]).length;
    stats.replaceChildren(
      el('div', { class: 'stat' }, el('span', { class: 'stat-num', text: songs.length }), el('span', { class: 'stat-label', text: 'Canciones' })),
      ...FORMATS.map((f) => el('div', { class: `stat stat-${f.key}` },
        el('span', { class: 'stat-num', text: count(f.key) }), el('span', { class: 'stat-label', text: `Con ${f.label.toLowerCase()}` }))));

    const sorted = order === 'numero' ? sortByNumber(songs) : sortByTitle(songs);
    const items = searchSongs(sorted, filter).map((r) => r.song);
    rows.replaceChildren(...(items.length
      ? items.map(row)
      : [el('div', { class: 'empty' }, el('p', { class: 'empty-title', text: songs.length ? 'Sin resultados' : 'Aún no hay canciones' }), el('p', { class: 'muted', text: songs.length ? 'Prueba con otro filtro.' : 'Pulsa «Nueva canción» para empezar.' }))]));
  }

  renderBanner();
  let wasVisible = false;
  let lastTrashSongs = null;
  let trashTimer;
  // Suscripción única al store: redibuja canciones, conexión e insignias;
  // al volver al panel refresca la pestaña abierta y el contador de huérfanos.
  store.subscribe((st) => {
    render(st);
    renderConn(st);
    setBadge('feedback', st.feedbackUnread || 0);
    const visible = st.route === 'admin' && Boolean(st.session);
    if (visible && !wasVisible && tab !== 'songs') selectTab(tab); // refresca al volver al panel
    // Contador de PDFs huérfanos: al entrar al panel y cada vez que cambian las canciones
    if (visible && ctx.backend.cloudinaryCleanup && (!wasVisible || st.songs !== lastTrashSongs)) {
      lastTrashSongs = st.songs;
      clearTimeout(trashTimer);
      trashTimer = setTimeout(() => ctx.backend.listTrash().then((t) => { trash = t; setBadge('trash', t.length); if (tab === 'trash') renderTrash(); }).catch(() => {}), 600);
    }
    wasVisible = visible;
  });
  render(store.get());
  renderConn(store.get());
  return view;
}
