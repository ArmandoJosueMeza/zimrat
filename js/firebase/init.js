/* =========================================================
   firebase/init.js — Inicialización de Firebase (SDK modular desde gstatic)
   ---------------------------------------------------------
   IMPORTANTE: todos los módulos de Firebase deben usar la MISMA versión
   (aquí 11.0.1). Mezclar versiones (p. ej. app 11.0.1 + auth 10.8.0)
   provoca errores como «Component auth has not been registered yet».
   ========================================================= */
// SDK MODULAR de Firebase: en vez de una librería gigante, se importa solo
// lo necesario desde la CDN oficial (gstatic). Cada import es una URL.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import config from '../../config.js';

const emu = config.FIREBASE_EMULATORS || {};

// Con emuladores se usa un proyecto ficticio «demo-zimrat» (no toca la nube)
// Con emuladores se usa un proyecto ficticio para no mezclar datos de
// prueba con los reales. El operador ternario (cond ? a : b) elige uno.
const firebaseConfig = emu.enabled
  ? { apiKey: 'demo-key', authDomain: 'demo-zimrat.firebaseapp.com', projectId: 'demo-zimrat', appId: 'demo-app' }
  : config.FIREBASE;

// initializeApp crea la conexión base. Auth y Firestore se «cuelgan» de
// esta app (getAuth(app), initializeFirestore(app, …)).
export const app = initializeApp(firebaseConfig);
export const usingEmulators = Boolean(emu.enabled);

/**
 * Google Analytics. Es opcional: si un bloqueador de anuncios lo impide, o el
 * navegador no lo soporta, la app sigue funcionando sin él.
 */
// import() dinámico: Analytics solo se descarga si se va a usar.
// isSupported() comprueba que el navegador lo permita (cookies, etc.).
export async function startAnalytics() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!config.ANALYTICS || usingEmulators || local || !firebaseConfig.measurementId) return null;
  try {
    const { getAnalytics, isSupported } = await import('https://www.gstatic.com/firebasejs/11.0.1/firebase-analytics.js');
    return (await isSupported()) ? getAnalytics(app) : null;
  } catch {
    return null;
  }
}
