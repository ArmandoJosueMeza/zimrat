/* =========================================================
   PdfViewer.js — Visor de PDF con PDF.js
   ---------------------------------------------------------
   Cómo se usa PDF.js aquí (lib/pdf.min.js + lib/pdf.worker.min.js):
     1. getDocument({ data }) abre el PDF a partir de sus bytes.
     2. Se crea un «hueco» por página con su tamaño exacto.
     3. Un IntersectionObserver dibuja cada página en un <canvas> solo
        cuando se acerca a la pantalla (carga diferida → rápido en móviles).
   Funciones: pestañas de formato, zoom, imprimir, descargar,
   MODO PRESENTACIÓN (oculta todo salvo la partitura), MODO ALTO
   CONTRASTE (blanco sobre negro), mini metrónomo y anterior/siguiente
   del repertorio.
   ========================================================= */
import { el, icon, FORMATS, formatInfo, safeFileName, storageGet, storageSet, toast } from '../utils.js';
import { MetronomeMini } from './Metronome.js';
import { SetlistNav, setlistPosition, goToSetlistSong } from './SetlistNav.js';
import * as metro from '../services/metronome.js';
import { logError } from '../services/logger.js';

// PDF.js se cargó en index.html (variable global). workerSrc indica el archivo
// del «worker» de PDF.js: el trabajo pesado de decodificar el PDF se hace en
// otro hilo, así la interfaz no se congela con partituras grandes.
const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
// Un <canvas> demasiado grande falla en Safari de iPhone/iPad; si una página
// superaría este número de píxeles, se reduce su resolución.
const MAX_CANVAS_AREA = 16_000_000; // límite seguro en iOS Safari
const CONTRAST_KEY = 'zimrat-alto-contraste';
const TOOLS_IDLE_MS = 2800;

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;

// Estado interno del visor:
// · song / fmt: canción y formato abiertos.
// · pdf: documento de PDF.js cargado.
// · blobUrl: URL local del PDF (para el botón Descargar).
// · renderToken: número que aumenta con cada carga; si el usuario cambia
//   de PDF mientras otro se está dibujando, el trabajo viejo detecta que
//   su token ya no es el actual y se detiene (evita mezclar páginas).
// · observer: el IntersectionObserver de las páginas (ver layoutPages).
export function PdfViewer(ctx) {
  let song = null;
  let fmt = null;
  let pdf = null;
  let blobUrl = null;
  let zoom = 1;
  let renderToken = 0;
  let observer = null;

  /* ---------- Elementos ---------- */
  const title = el('strong', { class: 'viewer-name' });
  const subtitle = el('span', { class: 'viewer-sub' });
  const tabs = el('div', { class: 'viewer-tabs', role: 'tablist', 'aria-label': 'Formato' });
  const navSlot = el('div', { class: 'viewer-setlist' });
  const pages = el('div', { class: 'pdf-pages', tabindex: '0', 'aria-label': 'Páginas del PDF' });
  const zoomLabel = el('span', { class: 'zoom-label', text: '100%' });
  const iconBtn = (name, label, extra = '') => el('button', { class: `btn btn-icon ${extra}`, type: 'button', 'aria-label': label, title: label, html: icon(name) });

  const printBtn = el('button', { class: 'btn btn-primary', type: 'button', 'aria-label': 'Imprimir', title: 'Imprimir', html: `${icon('print')}<span class="hide-sm">Imprimir</span>` });
  const downloadBtn = el('a', { class: 'btn btn-icon', href: '#', download: '', 'aria-label': 'Descargar PDF', title: 'Descargar PDF', html: icon('download') });
  const metroBtn = iconBtn('metronome', 'Metrónomo');
  const contrastBtn = iconBtn('contrast', 'Alto contraste (poca luz)');
  const focusBtn = el('button', { class: 'btn btn-soft focus-btn', type: 'button', 'aria-label': 'Modo presentación', title: 'Modo presentación (tecla F)', html: `${icon('expand')}<span class="hide-md">Presentación</span>` });
  metroBtn.setAttribute('aria-pressed', 'false');
  contrastBtn.setAttribute('aria-pressed', 'false');

  // Herramientas flotantes del modo presentación (se ocultan solas)
  const ftContrast = iconBtn('contrast', 'Alto contraste', 'ft-btn');
  const ftMetro = iconBtn('metronome', 'Metrónomo', 'ft-btn');
  const ftPrev = iconBtn('prev', 'Canción anterior del repertorio', 'ft-btn');
  const ftNext = iconBtn('next', 'Canción siguiente del repertorio', 'ft-btn');
  const ftZoomOut = el('button', { class: 'btn btn-icon ft-btn', type: 'button', 'aria-label': 'Alejar', text: '−' });
  const ftZoomIn = el('button', { class: 'btn btn-icon ft-btn', type: 'button', 'aria-label': 'Acercar', text: '+' });
  const ftTitle = el('span', { class: 'ft-title' });
  const ftExit = el('button', { class: 'btn ft-exit', type: 'button', 'aria-label': 'Salir del modo presentación', html: `${icon('shrink')}<span>Salir</span>` });
  const focusTools = el('div', { class: 'focus-tools', role: 'toolbar', 'aria-label': 'Controles del modo presentación' },
    ftExit, ftTitle, el('span', { class: 'ft-spacer' }), ftPrev, ftNext, ftZoomOut, ftZoomIn, ftContrast, ftMetro);

  const mini = MetronomeMini({ onClose: () => showMetronome(false) });
  const miniWrap = el('div', { class: 'metro-mini-wrap', hidden: true }, mini);

  const view = el('section', { class: 'viewer', hidden: true, 'aria-label': 'Visor de PDF' },
    el('div', { class: 'viewer-bar' },
      el('div', { class: 'viewer-row' },
        el('button', { class: 'btn btn-ghost viewer-back', type: 'button', 'aria-label': 'Volver a la canción', html: `${icon('back')}<span class="hide-sm">Volver</span>`, onclick: () => ctx.back(`#/c/${song.numero}`) }),
        el('div', { class: 'viewer-title' }, title, subtitle),
        el('div', { class: 'viewer-actions' },
          el('div', { class: 'zoom', role: 'group', 'aria-label': 'Zoom' },
            el('button', { class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Alejar', text: '−', onclick: () => setZoom(zoom - 0.25) }),
            zoomLabel,
            el('button', { class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Acercar', text: '+', onclick: () => setZoom(zoom + 0.25) })),
          contrastBtn, metroBtn, downloadBtn, printBtn, focusBtn)),
      el('div', { class: 'viewer-row2' }, tabs, navSlot)),
    pages,
    focusTools,
    miniWrap);

  /* ---------- Alto contraste ---------- */
  // ALTO CONTRASTE: añade la clase .contrast al visor; el CSS invierte los
  // colores del canvas (blanco sobre negro), útil en escenarios oscuros.
  // Se recuerda en localStorage. Al imprimir siempre se usan colores normales.
  function setContrast(on, save = true) {
    view.classList.toggle('contrast', on);
    for (const b of [contrastBtn, ftContrast]) { b.setAttribute('aria-pressed', String(on)); b.classList.toggle('btn-soft', on); }
    if (save) { storageSet(CONTRAST_KEY, on ? '1' : '0'); toast(on ? 'Alto contraste activado' : 'Alto contraste desactivado'); }
  }
  setContrast(storageGet(CONTRAST_KEY) === '1', false);
  const toggleContrast = () => setContrast(!view.classList.contains('contrast'));
  contrastBtn.addEventListener('click', toggleContrast);
  ftContrast.addEventListener('click', toggleContrast);

  /* ---------- Metrónomo flotante ---------- */
  function showMetronome(show) {
    miniWrap.hidden = !show;
    for (const b of [metroBtn, ftMetro]) { b.setAttribute('aria-pressed', String(show)); b.classList.toggle('btn-soft', show); }
  }
  metroBtn.addEventListener('click', () => showMetronome(miniWrap.hidden));
  ftMetro.addEventListener('click', () => showMetronome(miniWrap.hidden));

  /* ---------- Modo presentación ---------- */
  let idleTimer;
  const isFocus = () => view.classList.contains('focus');
  // MODO PRESENTACIÓN: oculta todo salvo la partitura. Los controles
  // flotantes aparecen al mover el ratón/tocar y se esconden tras unos
  // segundos de inactividad (idleTimer).
  function wakeTools() {
    if (!isFocus()) return;
    view.classList.remove('tools-hidden');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!focusTools.matches(':hover') && !focusTools.querySelector(':focus-visible')) view.classList.add('tools-hidden'); }, TOOLS_IDLE_MS);
  }
  // requestFullscreen() pide pantalla completa al navegador (debe ocurrir
  // tras un gesto del usuario). Si el navegador no lo permite (iPhone), el
  // modo presentación funciona igual ocupando toda la ventana.
  async function setFocus(on) {
    view.classList.toggle('focus', on);
    if (on) {
      wakeTools();
      try {
        if (view.requestFullscreen) await view.requestFullscreen();
        else if (view.webkitRequestFullscreen) view.webkitRequestFullscreen();
      } catch { /* iPhone: sin pantalla completa del sistema, pero sin barras */ }
      ftExit.focus({ preventScroll: true });
    } else {
      clearTimeout(idleTimer);
      view.classList.remove('tools-hidden');
      if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
      focusBtn.focus({ preventScroll: true });
    }
    setTimeout(layoutPages, 200);
  }
  focusBtn.addEventListener('click', () => setFocus(true));
  ftExit.addEventListener('click', () => setFocus(false));
  ftZoomIn.addEventListener('click', () => setZoom(zoom + 0.25));
  ftZoomOut.addEventListener('click', () => setZoom(zoom - 0.25));
  ftPrev.addEventListener('click', () => { const p = setlistPosition(song); if (p?.prev) goToSetlistSong(ctx, p.prev, fmt); });
  ftNext.addEventListener('click', () => { const p = setlistPosition(song); if (p?.next) goToSetlistSong(ctx, p.next, fmt); });
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) view.addEventListener(ev, wakeTools, { passive: true });
  pages.addEventListener('scroll', wakeTools, { passive: true });
  const onFsChange = () => { if (!fsElement() && isFocus()) setFocus(false); };
  // Si el usuario sale de pantalla completa con Esc, se sincroniza el estado.
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  /* ---------- Pestañas y repertorio ---------- */
  function renderTabs() {
    tabs.replaceChildren(...FORMATS.map((f) => {
      const available = Boolean(song?.[f.key]);
      return el('button', {
        class: `tab tab-${f.key}`, type: 'button', role: 'tab',
        'aria-selected': String(f.key === fmt), disabled: !available,
        title: available ? f.long : `${f.label}: no disponible`,
        html: `${icon(f.icon)}<span>${f.label}</span>`,
        onclick: () => { if (f.key !== fmt) ctx.replace(`#/c/${song.numero}/${f.key}`); },
      });
    }));
    const nav = SetlistNav(ctx, song, { fmt });
    navSlot.replaceChildren(...(nav ? [nav] : []));
    const pos = setlistPosition(song);
    ftPrev.hidden = ftNext.hidden = !pos;
    ftPrev.disabled = !pos?.prev;
    ftNext.disabled = !pos?.next;
    ftTitle.textContent = `#${song.numero} · ${song.titulo}${pos ? ` (${pos.index + 1}/${pos.total})` : ''}`;
  }

  /* ---------- Carga y dibujo ---------- */
  function message(text, { spinner = false, retry = false } = {}) {
    observer?.disconnect();
    pages.replaceChildren(el('div', { class: 'viewer-msg' },
      spinner ? el('div', { class: 'spinner' }) : el('span', { html: icon('info') }),
      el('p', { text }),
      retry ? el('button', { class: 'btn', type: 'button', html: `${icon('refresh')}<span>Reintentar</span>`, onclick: () => load() }) : null));
  }

  // CARGA DEL PDF:
  // 1. ctx.backend.getPdfBlob() descarga los bytes (Cloudinary o IndexedDB).
  // 2. URL.createObjectURL crea una URL local para el botón Descargar.
  // 3. pdfjsLib.getDocument({ data }) abre el documento.
  // 4. layoutPages() prepara las páginas.
  // Si falla, se muestra un mensaje (distinto sin conexión) con «Reintentar»
  // y el error se guarda en el registro (logError 'pdf').
  async function load() {
    const token = ++renderToken;
    message('Cargando PDF…', { spinner: true });
    printBtn.disabled = true;
    try {
      const blob = await ctx.backend.getPdfBlob(song[fmt]);
      if (token !== renderToken) return;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      downloadBtn.href = blobUrl;
      downloadBtn.download = safeFileName(`${song.numero} - ${song.titulo} - ${formatInfo(fmt).label}.pdf`);
      pdf?.destroy();
      pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
      if (token !== renderToken) return;
      printBtn.disabled = false;
      pages.scrollTop = 0;
      await layoutPages();
    } catch (err) {
      if (token !== renderToken) return;
      const offline = !navigator.onLine;
      if (!offline) logError('pdf', err, { accion: 'abrir PDF', cancion: `${song.numero} ${song.titulo}`, formato: fmt, url: String(song[fmt] || '').slice(0, 200) });
      message(offline ? 'Sin conexión: este PDF no está guardado en el dispositivo. Ábrelo una vez con internet (o guarda su repertorio) para tenerlo disponible.' : `No se pudo abrir el PDF. ${err.message || ''}`, { retry: true });
    }
  }

  /** Crea un hueco por página (tamaño exacto) y deja que el observador dibuje las visibles. */
  // CARGA DIFERIDA (lazy loading) para móviles:
  // 1. Se crea un «hueco» vacío por página con su tamaño exacto (así la barra
  //    de scroll es correcta desde el principio).
  // 2. IntersectionObserver avisa cuando un hueco se acerca a la pantalla
  //    (rootMargin 150%: con antelación) y solo entonces se dibuja.
  // Un PDF de 20 páginas no dibuja las 20 al abrirse: ahorra memoria y batería.
  async function layoutPages() {
    if (!pdf || view.hidden) return;
    const token = ++renderToken;
    observer?.disconnect();
    const maxWidth = isFocus() ? 1500 : 980;
    const cssWidth = Math.max(220, Math.min(pages.clientWidth - 24, maxWidth) * zoom);
    const slots = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const base = (await pdf.getPage(i)).getViewport({ scale: 1 });
      if (token !== renderToken) return;
      const slot = el('div', { class: 'pdf-page', role: 'img', 'aria-label': `Página ${i} de ${pdf.numPages}`, dataset: { page: i } });
      slot.style.width = `${Math.floor(cssWidth)}px`;
      slot.style.height = `${Math.floor(base.height * (cssWidth / base.width))}px`;
      slots.push(slot);
    }
    pages.replaceChildren(...slots);
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !entry.target.dataset.drawn) {
          entry.target.dataset.drawn = '1';
          drawPage(entry.target, cssWidth, token);
        }
      }
    }, { root: pages, rootMargin: '150% 0px' }); // dibuja con antelación
    slots.forEach((s) => observer.observe(s));
  }

  // DIBUJAR UNA PÁGINA:
  // · getViewport({ scale }) calcula el tamaño en píxeles.
  // · devicePixelRatio: en pantallas «retina» se dibuja con más píxeles para
  //   que el texto se vea nítido.
  // · page.render({ canvasContext, viewport }) pinta la página en el canvas.
  async function drawPage(slot, cssWidth, token) {
    const page = await pdf.getPage(Number(slot.dataset.page));
    if (token !== renderToken) return;
    const base = page.getViewport({ scale: 1 });
    let px = (cssWidth / base.width) * (window.devicePixelRatio || 1);
    const area = base.width * base.height * px * px;
    if (area > MAX_CANVAS_AREA) px *= Math.sqrt(MAX_CANVAS_AREA / area);
    const viewport = page.getViewport({ scale: px });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    slot.append(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }

  // Zoom entre 50 % y 300 %: vuelve a calcular las páginas con el nuevo ancho.
  function setZoom(z) {
    zoom = Math.min(3, Math.max(0.5, z));
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    layoutPages();
  }

  /* ---------- Imprimir (siempre en colores normales) ---------- */
  // IMPRIMIR: se dibuja cada página como imagen PNG a escala 2,5 (~180 ppp) en
  // el contenedor #printArea, y window.print() abre el diálogo del navegador.
  // El CSS @media print oculta toda la app y deja solo esas imágenes.
  // Al terminar (afterprint) se liberan las imágenes.
  async function print() {
    if (!pdf) return;
    printBtn.disabled = true;
    toast('Preparando impresión…');
    const area = document.getElementById('printArea');
    const urls = [];
    try {
      area.replaceChildren();
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.5 }); // ≈180 ppp
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = new Image();
        img.src = url;
        img.alt = `Página ${i}`;
        await img.decode().catch(() => {});
        area.append(img);
      }
      const cleanup = () => { area.replaceChildren(); urls.forEach(URL.revokeObjectURL); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
    } catch (err) {
      console.error(err);
      toast('No se pudo imprimir. Usa «Descargar» e imprime desde tu visor.', 'error');
    } finally {
      printBtn.disabled = false;
    }
  }
  printBtn.addEventListener('click', print);

  /* ---------- Eventos globales ---------- */
  let resizeTimer;
  // Al girar el móvil o cambiar el tamaño de ventana se recalculan las páginas
  // (con una pequeña espera, «debounce», para no hacerlo 50 veces seguidas).
  window.addEventListener('resize', () => {
    if (view.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutPages, 250);
  });
  // Atajos de teclado del visor (se ignoran si se está escribiendo en un campo):
  //   F = modo presentación · C = alto contraste · Esc = salir / volver
  //   Alt + → / AvPág = siguiente canción del repertorio · Alt + ← / RePág = anterior
  document.addEventListener('keydown', (e) => {
    if (view.hidden || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape' && isFocus() && !fsElement()) setFocus(false);
    else if (e.key === 'Escape' && !isFocus()) ctx.back(`#/c/${song.numero}`);
    else if (key === 'f' && !e.ctrlKey && !e.metaKey) setFocus(!isFocus());
    else if (key === 'c' && !e.ctrlKey && !e.metaKey) toggleContrast();
    else if ((e.key === 'ArrowRight' || e.key === 'PageDown') && e.altKey) ftNext.click();
    else if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && e.altKey) ftPrev.click();
  });

  return {
    element: view,
    get isOpen() { return !view.hidden; },
    open(nextSong, nextFmt) {
      const changed = nextSong !== song || nextFmt !== fmt;
      song = nextSong;
      fmt = nextFmt;
      metro.loadSong(song);
      title.textContent = `#${song.numero} · ${song.titulo}`;
      subtitle.textContent = [formatInfo(fmt).label, song.tono && `Tono ${song.tono}`, song.bpm && `${song.bpm} BPM`, song.compas].filter(Boolean).join(' · ');
      renderTabs();
      if (view.hidden) {
        view.hidden = false;
        document.body.classList.add('no-scroll');
        zoom = 1;
        zoomLabel.textContent = '100%';
        showMetronome(metro.state.playing); // si ya sonaba, se muestra
      }
      if (changed) load();
      if (isFocus()) wakeTools();
    },
    close() {
      if (view.hidden) return;
      if (isFocus()) setFocus(false);
      renderToken++;
      observer?.disconnect();
      view.hidden = true;
      document.body.classList.remove('no-scroll');
      pages.replaceChildren();
      pdf?.destroy();
      pdf = null;
        song = null;
      fmt = null;
    },
  };
}
