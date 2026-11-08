/* =========================================================
   sw.js — Service Worker de Zimrat: la app funciona SIN CONEXIÓN
   ---------------------------------------------------------
   Cachés:
     zimrat-v7.2             código de la app (se renueva con VERSION)
     zimrat-sdk              SDK de Firebase desde gstatic (URLs con versión → inmutables)
     zimrat-pdfs-recientes   últimos PDFs abiertos (máx. RECENT_PDFS)
     zimrat-pdfs-guardados   PDFs de repertorios «guardados sin conexión»
     zimrat-data             copia de canciones y repertorios (la escribe la app)
   (Firestore además mantiene su propia caché offline en IndexedDB.)
   Estrategias:
     · Código y páginas        → primero la red (siempre lo último); sin red, la copia.
     · SDK de Firebase         → primero la caché.
     · PDFs de Cloudinary (res.cloudinary.com) → primero la caché (cada subida
       tiene una URL nueva con versión, así que nunca quedan desactualizados).
     · PDFs locales de /pdfs → caché al instante + actualización en segundo plano.
     · Auth / Firestore / subidas a Cloudinary / YouTube → no se interceptan.
   Sube VERSION cuando publiques cambios de código.
   ========================================================= */
// VERSION: nombre de la caché del código. Al cambiarlo, el navegador instala
// el Service Worker nuevo y borra la caché antigua (ver «activate»).
const VERSION = 'zimrat-v7.2';
const SDK_CACHE = 'zimrat-sdk';
const RECENT_PDF_CACHE = 'zimrat-pdfs-recientes';
const RECENT_PDFS = 30;
const KEEP = new Set([VERSION, SDK_CACHE, RECENT_PDF_CACHE, 'zimrat-pdfs-guardados', 'zimrat-data']);
const SDK = ['app', 'auth', 'firestore', 'analytics'].map((m) => `https://www.gstatic.com/firebasejs/11.0.1/firebase-${m}.js`);

// SHELL («carcasa»): todos los archivos necesarios para abrir la app sin red.
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'songs.json', 'setlists.json', 'manifest.json',
  'js/store.js', 'js/utils.js',
  'js/firebase/init.js', 'js/firebase/auth.js',
  'js/services/backend.js', 'js/services/demo-backend.js', 'js/services/firebase-backend.js', 'js/services/theme.js',
  'js/services/cloudinary.js', 'js/services/logger.js', 'js/services/setlists.js',
  'js/services/metronome.js', 'js/services/pdf-text.js', 'js/services/offline.js', 'js/services/recent.js',
  'js/components/Header.js', 'js/components/SongList.js', 'js/components/SongDetail.js', 'js/components/FormatPicker.js',
  'js/components/Metronome.js', 'js/components/MediaPlayer.js', 'js/components/PdfViewer.js',
  'js/components/SetlistView.js', 'js/components/SetlistNav.js', 'js/components/SetlistForm.js',
  'js/components/LoginModal.js', 'js/components/AdminPanel.js', 'js/components/SongForm.js',
  'js/components/Modal.js', 'js/components/ConfirmDialog.js', 'js/components/FeedbackModal.js',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

// INSTALL: se ejecuta al instalar una versión nueva. Descarga la carcasa y
// el SDK de Firebase. event.waitUntil() mantiene vivo el SW hasta terminar.
// skipWaiting(): la versión nueva se activa sin esperar a cerrar pestañas.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await (await caches.open(VERSION)).addAll(SHELL);
    // SDK de Firebase: si falla (sin red), se guardará la próxima vez que se use
    const sdk = await caches.open(SDK_CACHE);
    await Promise.all(SDK.map((u) => sdk.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

// ACTIVATE: limpia cachés de versiones anteriores. clients.claim() hace que
// el SW controle desde ya las pestañas abiertas.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Borra versiones viejas (también las del antiguo «cancionero»)
    await Promise.all(keys.filter((k) => /^(zimrat|cancionero)-/.test(k) && !KEEP.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isPdf = (url) => /\.pdf$/i.test(url.pathname);
const isCloudinaryFile = (url) => url.hostname === 'res.cloudinary.com';
const isFirebaseSdk = (url) => url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');

// FETCH: intercepta CADA descarga de la página y elige estrategia:
//   SDK Firebase → caché primero · PDF Cloudinary → caché primero
//   PDFs locales → caché + actualización · código propio → red primero
//   Firestore, Auth, subidas a Cloudinary, YouTube → no se tocan (red directa).
// Las peticiones con «range» (descargas parciales) tampoco se interceptan.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  if (isFirebaseSdk(url)) { event.respondWith(sdkCacheFirst(req)); return; }
  if (isCloudinaryFile(url)) { event.respondWith(pdfCacheFirst(req, event)); return; }
  if (!sameOrigin) return;                              // Auth, Firestore, subidas, YouTube…: siempre red
  if (url.pathname.includes('/__datos__/')) return;     // copia de datos: la gestiona la app
  if (isPdf(url)) { event.respondWith(staleWhileRevalidate(req, event)); return; }
  event.respondWith(networkFirst(req));
});

// RED PRIMERO: intenta descargar (versión más nueva) y guarda una copia;
// si no hay red, usa la copia. Para navegación sin copia, index.html.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
  }
}

/** Guarda un PDF en «recientes» y elimina los más antiguos si se pasa del límite. */
// Caché de recientes con límite: se borra y vuelve a añadir para que quede
// al final; si hay más de RECENT_PDFS, se eliminan los más antiguos.
async function rememberPdf(req, res) {
  const cache = await caches.open(RECENT_PDF_CACHE);
  await cache.delete(req);             // así queda al final (el más reciente)
  await cache.put(req, res);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - RECENT_PDFS))) await cache.delete(old);
}

// CACHÉ PRIMERO: las URLs del SDK llevan versión (11.0.1), nunca cambian.
async function sdkCacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SDK_CACHE)).put(req, res.clone());
  return res;
}

/** PDFs de Cloudinary: URL inmutable → si está guardado, no se vuelve a descargar. */
async function pdfCacheFirst(req, event) {
  const cached = await caches.match(req);
  if (cached) { event.waitUntil(rememberPdf(req, cached.clone())); return cached; }
  const res = await fetch(req);
  if (res.ok) event.waitUntil(rememberPdf(req, res.clone()));
  return res;
}

// «STALE-WHILE-REVALIDATE»: responde al instante con la copia (aunque sea
// vieja) y en segundo plano descarga la nueva para la próxima vez.
async function staleWhileRevalidate(req, event) {
  const cached = await caches.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok) event.waitUntil(rememberPdf(req, res.clone()));
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || Response.error();
}
