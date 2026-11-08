/* =========================================================
   app.js — Punto de entrada: arranque, rutas y contexto compartido
   ---------------------------------------------------------
   Rutas (en el hash de la URL, se pueden compartir):
     #/                  → inicio: recientes, repertorios, buscador y lista
     #/c/5               → ficha de la canción nº 5 (datos, metrónomo, video)
     #/c/5/acordes       → visor del PDF de acordes de la canción nº 5
     #/r/<id>            → repertorio (setlist)
     #/admin             → panel del administrador (requiere login)
   Además: registro de errores (logger.js), tiempo real (onSnapshot),
   monitor de conexión con Firebase y buzón público de sugerencias.
   // ---------------------------------------------------------
   // CÓMO FUNCIONA (visión general)
   //   1. Al cargar: aplica el tema y activa la captura global de errores.
   //   2. boot(): crea el «backend» (Firebase o demo), recupera la sesión,
   //      conecta el registro de errores, construye la interfaz y carga
   //      las canciones.
   //   3. route(): lee la URL (#/…) y muestra la vista que corresponde.
   //      Se ejecuta al arrancar, al navegar con ctx.go() y con los botones
   //      Atrás/Adelante del navegador (evento «popstate»).
   //   4. El objeto «ctx» (contexto) se pasa a TODOS los componentes. Es su
   //      forma de pedir cosas a la app sin conocerse entre sí: navegar,
   //      recargar datos, usar el backend o los repertorios.
   //   5. El estado compartido (canciones, sesión, conexión…) vive en
   //      store.js: los componentes se «suscriben» y se redibujan solos.
   // =========================================================
   ========================================================= */
// ---------------------------------------------------------
// IMPORTACIONES
// Cada import trae una pieza de la app. Las rutas son relativas a
// este archivo; el navegador las descarga como módulos ES (sin
// empaquetador ni compilación).
// ---------------------------------------------------------
import config from './config.js';
import { store } from './js/store.js';
import { el, icon, sortByTitle, FORMAT_KEYS, formatInfo, toast } from './js/utils.js';
import { initTheme } from './js/services/theme.js';
import { getBackend } from './js/services/backend.js';
import { getRecent } from './js/services/recent.js';
// «import * as» trae todas las funciones del módulo bajo un nombre
// (setlistStore.loadSetlists(), metro.stop()…).
import * as setlistStore from './js/services/setlists.js';
import * as metro from './js/services/metronome.js';
import { Header } from './js/components/Header.js';
import { SongList } from './js/components/SongList.js';
import { SongDetail } from './js/components/SongDetail.js';
import { SetlistView } from './js/components/SetlistView.js';
import { PdfViewer } from './js/components/PdfViewer.js';
import { AdminPanel } from './js/components/AdminPanel.js';
import { openLogin } from './js/components/LoginModal.js';
import { FeedbackButton } from './js/components/FeedbackModal.js';
import { installGlobalErrorHandlers, setLogSink, setLogRole, logError } from './js/services/logger.js';
//
// ---------------------------------------------------------
// 1) INICIALIZACIÓN INMEDIATA (antes de esperar a nada)
// ---------------------------------------------------------
// initTheme(): aplica el tema claro/oscuro guardado.
// installGlobalErrorHandlers(): desde este momento cualquier error de
// JavaScript no controlado se registra (ver js/services/logger.js).

initTheme();
installGlobalErrorHandlers();

// Variables del módulo (privadas de este archivo):
// · root: el <div id="app"> de index.html, donde se monta toda la interfaz.
// · ACTIVE_SETLIST_KEY: clave de sessionStorage del repertorio que se recorre.
// · views: referencias a las vistas creadas en boot().
// · listScroll: posición de scroll de la lista, para restaurarla al volver.
const root = document.getElementById('app');
const ACTIVE_SETLIST_KEY = 'zimrat-repertorio-activo';
let views;
let listScroll = 0;
let pendingJump = null; // ver ctx.jumpViewer

/** Contexto compartido que reciben todos los componentes. */
// ---------------------------------------------------------
// 2) CONTEXTO COMPARTIDO «ctx»
// ---------------------------------------------------------
// Es un objeto normal con funciones. Los componentes lo reciben como
// parámetro (por ejemplo SongList(ctx)) y lo usan para:
// · navegar (go, replace, back, jumpViewer);
// · recargar datos (reloadData) y usar el backend (ctx.backend);
// · gestionar repertorios locales (ctx.setlists).
// Ventaja: ningún componente importa a otro para navegar, así cada
// pieza se puede entender y probar por separado.
const ctx = {
  // Se rellena en boot() con el backend elegido en config.BACKEND.
  backend: null,

  /** Navega a una ruta nueva (queda en el historial). */
  go(hash) {
    if (location.hash === hash) return;
    // history.pushState cambia la URL SIN recargar la página y añade una
    // entrada al historial. { app: true } marca que la entrada la creó la
    // app, para que «Volver» sepa si puede usar history.back().
    history.pushState({ app: true }, '', hash);
    route();
  },
  /** Cambia la ruta sin crear historial (p. ej. pestañas del visor, anterior/siguiente). */
  replace(hash) {
    // replaceState sustituye la entrada actual (no se acumula historial).
    history.replaceState(history.state, '', hash);
    route();
  },
  /** «Volver»: usa el historial si venimos de la app; si no, va a `fallback`. */
  back(fallback = '#/') {
    if (history.state?.app) history.back();
    else ctx.replace(fallback);
  },

  /**
   * Desde el visor, salta a otra canción del repertorio dejando el historial
   * coherente: «Volver» lleva a la ficha de la canción NUEVA.
   * (Retrocede una entrada, la sustituye por la ficha nueva y añade el visor.)
   */
  jumpViewer(numero, fmt) {
    const detail = `#/c/${numero}`;
    const viewer = `${detail}/${fmt}`;
    if (!history.state?.app || !views.viewer.isOpen) return ctx.replace(viewer);
    pendingJump = { detail, viewer };
    history.back();
  },

  /** Recorre un repertorio: activa la barra «anterior / siguiente». */
  setActiveSetlist(id) {
    store.set({ activeSetlist: id || null });
    try { if (id) sessionStorage.setItem(ACTIVE_SETLIST_KEY, id); else sessionStorage.removeItem(ACTIVE_SETLIST_KEY); } catch { /* ignorar */ }
  },

  /** Carga las canciones (con copia sin conexión de respaldo) y los repertorios locales. */
  // async/await: la función espera a que el backend responda sin
  // bloquear la página. Si falla (sin conexión, reglas…), se guarda el
  // error en el store y se avisa con un «toast» (mensaje flotante).
  // Para el modo demo además siembra repertorios de ejemplo.
  async reloadData() {
    try {
      const songs = sortByTitle(await ctx.backend.listSongs());
      if (ctx.backend.mode === 'demo') await setlistStore.seedExampleSetlists(songs);
      store.set({ songs, setlists: setlistStore.loadSetlists(), loading: false, error: null, fromCache: ctx.backend.fromCache });
    } catch (err) {
      console.error(err);
      store.set({ loading: false, error: err.message, setlists: setlistStore.loadSetlists() });
      toast(err.message, 'error');
    }
  },

  /** Repertorios LOCALES (localStorage): cualquier usuario, sin login. */
  // Repertorios LOCALES: viven en localStorage de cada navegador (ver
  // js/services/setlists.js). Cada método guarda y luego llama a
  // refresh(), que publica la lista nueva en el store para redibujar.
  setlists: {
    save(data) { const list = setlistStore.saveSetlist(data); ctx.setlists.refresh(); return list; },
    remove(id) {
      setlistStore.deleteSetlist(id);
      if (store.get().activeSetlist === id) ctx.setActiveSetlist(null);
      ctx.setlists.refresh();
    },
    removeSong(songId) { setlistStore.removeSongEverywhere(songId); ctx.setlists.refresh(); },
    refresh() { store.set({ setlists: setlistStore.loadSetlists() }); },
    exportJson: (lists) => setlistStore.exportSetlists(lists, store.get().songs),
    importJson(text) { const n = setlistStore.importSetlists(text, store.get().songs); ctx.setlists.refresh(); return n; },
  },
};
// Alias: los formularios llaman a ctx.reloadSongs().
ctx.reloadSongs = ctx.reloadData; // nombre usado por los formularios

// ---------------------------------------------------------
// 3) MONITOR DE CONEXIÓN Y CONTADOR DEL BUZÓN (solo administrador)
// ---------------------------------------------------------
// checkConnection() pregunta al SERVIDOR de Firestore (no a la caché)
// y guarda el resultado en store.connection; el panel y la cabecera
// se redibujan solos (verde «Conectado» / rojo «Error de conexión»).
// connBusy evita lanzar dos comprobaciones a la vez.
// Si la conexión pasa de bien a mal, se deja constancia en el registro.
/* ---------- Monitor de conexión con Firebase (solo admin) ---------- */
let connTimer = null;
let connBusy = false;
ctx.checkConnection = async () => {
  if (connBusy || !ctx.backend?.checkConnection) return;
  connBusy = true;
  store.set({ connection: { ...store.get().connection, state: 'checking' } });
  try {
    const r = await ctx.backend.checkConnection();
    const prev = store.get().connection?.state;
    store.set({ connection: { ...r, state: r.ok ? 'ok' : 'error', at: Date.now() } });
    if (!r.ok && prev === 'ok' && r.error) logError(r.error.code === 'timeout' ? 'red' : 'firestore', r.error, { accion: 'monitor de conexión' });
  } finally {
    connBusy = false;
  }
};
/** Unread del buzón para la insignia del botón «Panel». */
// Cuenta las sugerencias sin leer para la insignia roja del botón «Panel».
ctx.refreshFeedbackCount = async () => {
  if (!store.get().session) return;
  try { store.set({ feedbackUnread: (await ctx.backend.listFeedback()).filter((f) => !f.read).length }); } catch { /* se verá en el panel */ }
};
// Arranca o detiene el monitor según haya sesión de administrador.
// setInterval repite la comprobación cada CONNECTION_CHECK_SECONDS;
// document.hidden evita gastar datos si la pestaña no está visible.
function syncAdminMonitors(session) {
  clearInterval(connTimer);
  connTimer = null;
  if (!session) { store.set({ connection: null, feedbackUnread: 0 }); return; }
  ctx.checkConnection();
  ctx.refreshFeedbackCount();
  connTimer = setInterval(() => { if (!document.hidden) ctx.checkConnection(); }, config.CONNECTION_CHECK_SECONDS * 1000);
}

// ---------------------------------------------------------
// 4) ENRUTADOR (router)
// ---------------------------------------------------------
// parseRoute() convierte la URL en un objeto. Ejemplos:
//   #/c/5/acordes → { name: 'viewer', numero: 5, fmt: 'acordes' }
//   #/r/abc       → { name: 'setlist', id: 'abc' }
//   #/admin       → { name: 'admin' }
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'admin') return { name: 'admin' };
  if (parts[0] === 'r' && parts[1]) return { name: 'setlist', id: parts[1] };
  if (parts[0] === 'c' && parts[1]) return { name: parts[2] ? 'viewer' : 'detail', numero: Number(parts[1]), fmt: parts[2] };
  return { name: 'list' };
}

// Muestra UNA vista base (lista, ficha, repertorio o panel) y oculta
// las demás con el atributo hidden. También guarda/restaura el scroll
// de la lista y apaga el metrónomo al salir de una canción.
function showBase(base) {
  const prev = store.get().route;
  if (prev === 'list' && base !== 'list') listScroll = window.scrollY;
  views.list.hidden = base !== 'list';
  views.detail.element.hidden = base !== 'detail';
  views.setlist.element.hidden = base !== 'setlist';
  views.admin.hidden = base !== 'admin';
  if (base !== 'detail') views.detail.hide();
  if (base === 'list' || base === 'admin') metro.stop(); // al salir de la canción, se apaga
  store.set({ route: base });
  if (base === 'list' && prev !== 'list') requestAnimationFrame(() => window.scrollTo(0, listScroll));
  if ((base === 'admin' || base === 'setlist') && prev !== base) window.scrollTo(0, 0);
}

// route(): decide qué mostrar según la URL actual. Se llama:
// · al arrancar, · desde ctx.go/replace, · en el evento popstate.
function route() {
  const r = parseRoute();
  const { session, songs, setlists } = store.get();

  // Protección de la ruta del panel: sin sesión, vuelve al inicio y abre
  // el login. (Aunque alguien forzara la vista, firestore.rules impide
  // escribir sin ser el administrador.)
  if (r.name === 'admin' && !session) {
    ctx.replace('#/');
    openLogin(ctx, { onSuccess: () => ctx.go('#/admin') });
    return;
  }

  if (r.name === 'list' || r.name === 'admin') {
    views.viewer.close();
    showBase(r.name);
    document.title = r.name === 'admin' ? `Panel · ${config.APP_NAME}` : config.APP_NAME;
    return;
  }

  if (r.name === 'setlist') {
    const list = setlists.find((s) => s.id === r.id);
    if (!list) { toast('Ese repertorio ya no existe', 'error'); ctx.replace('#/'); return; }
    views.viewer.close();
    showBase('setlist');
    views.setlist.open(list);
    document.title = `${list.nombre} · ${config.APP_NAME}`;
    return;
  }

  // Busca la canción por su número; si la URL pide un formato que no
  // existe (p. ej. sin partitura), vuelve a la ficha con un aviso.
  // Ficha o visor de una canción
  const song = songs.find((s) => s.numero === r.numero);
  if (!song) { toast(`No existe la canción #${r.numero}`, 'error'); ctx.replace('#/'); return; }

  if (r.name === 'viewer') {
    if (!FORMAT_KEYS.includes(r.fmt) || !song[r.fmt]) {
      toast(`Esta canción no tiene ${formatInfo(r.fmt)?.label.toLowerCase() || 'ese formato'}`, 'error');
      ctx.replace(`#/c/${song.numero}`);
      return;
    }
    if (store.get().route !== 'admin') { showBase('detail'); views.detail.open(song); }
    views.viewer.open(song, r.fmt);
    document.title = `${song.titulo} (${formatInfo(r.fmt).label}) · ${config.APP_NAME}`;
  } else {
    views.viewer.close();
    showBase('detail');
    views.detail.open(song);
    document.title = `${song.titulo} · ${config.APP_NAME}`;
  }
}

// ---------------------------------------------------------
// 5) ARRANQUE: boot()
// ---------------------------------------------------------
// Pasos: crear backend → sesión → registro de errores → eventos de
// conexión → construir la interfaz → cargar canciones → tiempo real
// → escuchar el historial → primera ruta.
// Si el backend no se puede crear (config.js mal, sin internet la
// primera vez…), muestra una pantalla de error en lugar de la app.
async function boot() {
  try {
    ctx.backend = await getBackend();
  } catch (err) {
    console.error(err);
    root.replaceChildren(el('div', { class: 'fatal' },
      el('span', { html: icon('info') }),
      el('h1', { text: 'No se pudo iniciar la app' }),
      el('p', { text: err.message }),
      el('p', { class: 'muted', text: 'Revisa config.js y tu conexión a internet.' })));
    return;
  }

  let active = null;
  try { active = sessionStorage.getItem(ACTIVE_SETLIST_KEY); } catch { /* ignorar */ }
  const session = ctx.backend.getSession();
  store.set({ mode: ctx.backend.mode, session, recent: getRecent(), activeSetlist: active });

  // Registro de errores → backend activo (Firestore «errorLogs» o este navegador)
  setLogRole(Boolean(session));
  // setLogSink: le dice al registro de errores DÓNDE guardar cada error
  // (Firebase → colección «errorLogs»; demo → este navegador).
  setLogSink((entry) => ctx.backend.logSink(entry));
  syncAdminMonitors(session);

  // Cada vez que alguien entra o sale: actualiza el store, el rol del
  // registro de errores y el monitor; si sale estando en el panel, va
  // al inicio.
  ctx.backend.onAuthChange((s) => {
    store.set({ session: s });
    setLogRole(Boolean(s));
    syncAdminMonitors(s);
    if (!s && store.get().route === 'admin') ctx.replace('#/');
  });

  // Conexión: aviso y recarga al volver
  // Eventos del navegador «offline» / «online»: avisan del estado de la
  // red. Al volver la conexión se recargan los datos.
  window.addEventListener('offline', () => { store.set({ online: false }); toast('Sin conexión: usando los datos guardados'); if (store.get().session) ctx.checkConnection(); });
  window.addEventListener('online', () => { store.set({ online: true }); toast('Conexión recuperada', 'success'); ctx.reloadData(); if (store.get().session) ctx.checkConnection(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && store.get().session) ctx.checkConnection(); });

  // Construcción de la interfaz: cada componente es una función que
  // devuelve elementos del DOM. Se montan una sola vez y luego se
  // muestran/ocultan según la ruta (más rápido que recrearlos).
  const viewer = PdfViewer(ctx);
  views = { list: SongList(ctx), detail: SongDetail(ctx), setlist: SetlistView(ctx), admin: AdminPanel(ctx), viewer };
  root.replaceChildren(
    Header(ctx),
    el('main', { id: 'main' }, views.list, views.detail.element, views.setlist.element, views.admin,
      el('footer', { class: 'app-footer', text: `${config.APP_NAME} v${config.APP_VERSION} · PDFs en Cloudinary` })),
    viewer.element,
    FeedbackButton(ctx));

  await ctx.reloadData();

  // Tiempo real: cualquier cambio en Firestore llega a todos los dispositivos
  // Tiempo real: con Firebase, onSnapshot avisa cada vez que cambia la
  // colección «songs» en CUALQUIER dispositivo, y se actualiza la lista.
  // El «?.» (encadenamiento opcional) evita error si el backend (demo)
  // no tiene watchSongs.
  ctx.backend.watchSongs?.((songs, fromCache) => {
    store.set({ songs: sortByTitle(songs), fromCache: Boolean(fromCache) && !navigator.onLine, loading: false, error: null });
  });
  // popstate: botones Atrás/Adelante. pendingJump completa el truco de
  // ctx.jumpViewer (saltar entre canciones desde el visor dejando un
  // historial coherente).
  window.addEventListener('popstate', () => {
    if (pendingJump) {
      const { detail, viewer } = pendingJump;
      pendingJump = null;
      history.replaceState(history.state, '', detail);
      history.pushState({ app: true }, '', viewer);
    }
    route();
  });
  route();
}

boot();

// ---------------------------------------------------------
// 6) PWA: registro del Service Worker (sw.js)
// ---------------------------------------------------------
// El Service Worker es un script que el navegador ejecuta aparte y que
// intercepta las descargas: guarda la app y los PDFs para usarlos sin
// conexión. Solo funciona en https o en localhost.
/* ---------- PWA: Service Worker ----------
   Estrategia «primero la red» para el código: online siempre ves la
   última versión; sin conexión se usa la copia guardada. Requiere
   https o localhost. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.warn));
}
