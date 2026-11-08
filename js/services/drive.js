/* =========================================================
   drive.js — Enlaces de Google Drive para los PDFs
   ---------------------------------------------------------
   PDF.js necesita los BYTES del PDF, y un enlace «/view» o «/preview» de Drive
   es una página web, no el archivo. Por eso:
     1. Se extrae el ID del archivo del enlace que pega el administrador.
     2. Con una clave de API (config.DRIVE_API_KEY) se descarga el PDF desde la
        API de Drive, que permite lectura desde el navegador (CORS):
          https://www.googleapis.com/drive/v3/files/<ID>?alt=media&key=<CLAVE>
     3. Si no hay clave o la descarga falla, se usa el visor «/preview» de
        Drive en un iframe (se ve igual, pero sin las funciones de PDF.js).
   El archivo debe estar compartido como «Cualquier persona con el enlace».
   ========================================================= */

/** ID de un enlace de Drive (file/d/ID, open?id=ID, uc?id=ID, …) o null. */
export function driveFileId(url) {
  if (!url) return null;
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(?:file\/)?d\/([\w-]{20,})/);
  const id = m?.[1] || u.searchParams.get('id');
  return id && /^[\w-]{20,}$/.test(id) ? id : null;
}

export const isDriveUrl = (url) => Boolean(driveFileId(url));
export const drivePreviewUrl = (id) => `https://drive.google.com/file/d/${id}/preview`;
export const driveViewUrl = (id) => `https://drive.google.com/file/d/${id}/view`;
export const driveDownloadUrl = (id) => `https://drive.google.com/uc?export=download&id=${id}`;
export const driveApiUrl = (id, key) => `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${encodeURIComponent(key)}`;

/**
 * URL que PDF.js puede descargar, o null si no es posible (Drive sin clave).
 * Acepta también enlaces directos a un .pdf (https://…/archivo.pdf) o rutas locales (pdfs/…).
 */
export function resolvePdfUrl(ref, apiKey) {
  if (!ref) return null;
  const id = driveFileId(ref);
  if (id) return apiKey ? driveApiUrl(id, apiKey) : null;
  return ref;
}

/** Comprueba un enlace pegado en el formulario → { ok, kind, message } */
export function checkPdfLink(value) {
  const v = String(value || '').trim();
  if (!v) return { ok: true, kind: 'empty', message: '' };
  if (driveFileId(v)) return { ok: true, kind: 'drive', message: '✓ Enlace de Google Drive. Compártelo como «Cualquier persona con el enlace».' };
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    if (/drive\.google\.com/.test(u.hostname)) return { ok: false, kind: 'bad', message: 'No se encontró el ID del archivo en este enlace de Drive. Usa «Compartir → Copiar enlace».' };
    return { ok: true, kind: 'url', message: '✓ Enlace directo (el servidor debe permitir CORS).' };
  } catch {
    return { ok: false, kind: 'bad', message: 'Pega un enlace que empiece por https://' };
  }
}
