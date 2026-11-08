/* =========================================================
   cloudinary.js — Validación y subida de PDFs a Cloudinary
   ---------------------------------------------------------
   · Subida directa desde el navegador con un preset «Unsigned»
     (config.CLOUDINARY). No hace falta servidor propio.
   · Validación ESTRICTA antes de subir. El archivo debe cumplir las 3 cosas:
       1) tipo MIME exactamente «application/pdf»
       2) extensión .pdf
       3) contenido que empieza por «%PDF-» (la firma real de un PDF)
     y pesar como máximo config.MAX_PDF_MB (10 MB en el plan gratuito).

   CICLO DE VIDA DE LOS ARCHIVOS (nota técnica)
   ---------------------------------------------------------
   · Borrar un archivo de Cloudinary de forma permanente exige una petición
     FIRMADA con el API Secret (Admin API / destroy). Ese secreto NUNCA debe
     estar en el navegador: cualquiera podría leerlo y borrar toda la cuenta.
     Con un preset «unsigned» la app puede SUBIR, pero no BORRAR.
   · Excepción: si el preset tiene activado «Return delete token», cada subida
     devuelve un delete_token válido 10 minutos. La app lo usa solo para
     deshacer subidas recién hechas cuando el guardado en Firestore falla
     (deleteByToken), y así no quedan archivos huérfanos.
   · En el resto de casos (eliminar una canción, reemplazar o quitar un PDF)
     la app borra la REFERENCIA en Firestore y apunta el archivo en la
     colección «cloudinaryTrash». El admin ve la lista en
     Panel → Archivos Cloudinary y los borra en la Media Library
     (o los borraría una Cloud Function con el secreto, si algún día se
     activa el plan Blaze de Firebase).
   ========================================================= */
import config from '../../config.js';
import { formatBytes } from '../utils.js';

/** → { ok: true, message } | { ok: false, message } */
// VALIDACIÓN EN 3 CAPAS (antes de gastar datos subiendo):
// 1. file.type: tipo MIME que informa el sistema operativo.
// 2. Extensión del nombre.
// 3. «Firma» del archivo: todo PDF real empieza por los bytes «%PDF-».
//    file.slice(0, 5).arrayBuffer() lee solo esos 5 bytes (rápido).
//    Así se detecta, p. ej., un .docx renombrado a .pdf.
// Y por último, el tamaño máximo.
export async function validatePdfFile(file) {
  if (!file) return { ok: false, message: 'No se seleccionó ningún archivo.' };
  if (file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name)) {
    return { ok: false, message: `«${file.name}» no es un PDF (tipo detectado: ${file.type || 'desconocido'}). Solo se aceptan archivos PDF (application/pdf).` };
  }
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') {
    return { ok: false, message: `«${file.name}» termina en .pdf, pero su contenido no es un PDF válido.` };
  }
  if (file.size > config.MAX_PDF_MB * 1048576) {
    return { ok: false, message: `«${file.name}» pesa ${formatBytes(file.size)}; el máximo es ${config.MAX_PDF_MB} MB. Comprímelo antes de subirlo.` };
  }
  return { ok: true, message: `PDF válido (${formatBytes(file.size)})` };
}

/** Sube un PDF y devuelve { url, publicId, bytes }. onProgress(0-100). */
// SUBIDA DIRECTA navegador → Cloudinary (sin servidor propio):
// · FormData: el mismo formato que un formulario HTML con archivo.
// · upload_preset: el preset «Unsigned» autoriza la subida sin la clave secreta.
// · Se usa XMLHttpRequest (y no fetch) porque permite medir el PROGRESO de
//   la subida (xhr.upload.onprogress) para la barra de porcentaje.
// · Cloudinary responde con JSON: secure_url (https) es lo que se guarda
//   en Firestore; public_id identifica el archivo dentro de la cuenta.
// · Se devuelve una Promise: resolve() si todo va bien, reject() con un
//   mensaje que explica qué revisar si falla.
export function uploadPdf(file, onProgress) {
  const { cloudName, uploadPreset } = config.CLOUDINARY;
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', uploadPreset);
    const xhr = new XMLHttpRequest();
    // «auto»: Cloudinary detecta el tipo (los PDF se guardan como recurso de imagen con páginas)
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* respuesta no JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
        if (data.format && data.format !== 'pdf') {
          return reject(Object.assign(new Error(`Cloudinary recibió un archivo «${data.format}», no un PDF.`), { code: 'formato' }));
        }
        return resolve({ url: data.secure_url, publicId: data.public_id, bytes: data.bytes, deleteToken: data.delete_token || null });
      }
      const msg = data.error?.message || `Error ${xhr.status}`;
      const hint = /preset/i.test(msg) ? ` Revisa que el preset «${uploadPreset}» exista y sea Unsigned.`
        : (/cloud.?name/i.test(msg) || xhr.status === 404) ? ` Revisa el Cloud name en config.js («${cloudName}»).`
          : /format/i.test(msg) ? ' El preset solo acepta PDF.' : '';
      reject(Object.assign(new Error(`Cloudinary: ${msg}.${hint}`), { code: String(xhr.status) }));
    };
    xhr.onerror = () => reject(Object.assign(new Error('No hay conexión con Cloudinary.'), { code: 'red' }));
    xhr.ontimeout = () => reject(Object.assign(new Error('La subida a Cloudinary tardó demasiado (más de 2 min).'), { code: 'timeout' }));
    xhr.send(form);
  });
}

/** ¿Es una URL de Cloudinary? (para mensajes de ayuda en el visor) */
export const isCloudinaryUrl = (url) => /(^|\.)res\.cloudinary\.com\//.test(String(url || '').replace(/^https?:\/\//, ''));

/**
 * Deshace una subida reciente con su delete_token (válido 10 min, solo si el
 * preset tiene «Return delete token»). Devuelve true si Cloudinary lo borró.
 * No lanza errores: si falla, el archivo queda apuntado como huérfano.
 */
export async function deleteByToken(token) {
  if (!token) return false;
  try {
    const form = new FormData();
    form.append('token', token);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${config.CLOUDINARY.cloudName}/delete_by_token`, { method: 'POST', body: form });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * public_id a partir de la URL de entrega.
 * https://res.cloudinary.com/<cloud>/image/upload/v1730000000/zimrat/abc.pdf → «zimrat/abc»
 */
export function publicIdFromUrl(url) {
  const m = String(url || '').match(/res\.cloudinary\.com\/[^/]+\/(?:image|raw|video)\/upload\/([^?#]+)/i);
  if (!m) return '';
  let rest = m[1];
  const v = rest.match(/(?:^|\/)v\d+\/(.+)$/); // lo que va tras la versión (salta transformaciones)
  if (v) rest = v[1];
  return decodeURIComponent(rest.replace(/\.[a-z0-9]+$/i, ''));
}

/** Enlace a la Media Library de la cuenta (para borrar a mano). */
export const mediaLibraryUrl = () => 'https://console.cloudinary.com/console/media_library/search?q=';
