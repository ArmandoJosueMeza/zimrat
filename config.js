/* =========================================================
   config.js — CONFIGURACIÓN DE ZIMRAT (el único archivo que debes editar)
   ---------------------------------------------------------
   BACKEND: 'firebase' → proyecto Firebase «zimrat» (Auth + Firestore + Analytics).
                          Los PDFs se suben a Cloudinary.
            'demo'     → todo simulado en el navegador (sin internet ni Firebase).
   // ---------------------------------------------------------
   // Cómo se usa: los demás archivos hacen
   //     import config from './config.js';
   // y leen, por ejemplo, config.ADMIN_EMAIL. Así cada ajuste vive en un
   // solo lugar y cambiarlo no exige tocar la lógica.
   // «export default» exporta un único objeto con toda la configuración.
   ========================================================= */
export default {
  // Marca: nombre, lema y versión (la versión se ve al pie de la página y en el panel).
  APP_NAME: 'Zimrat',
  APP_TAGLINE: 'Cancionero para músicos',
  APP_VERSION: '7.2',

  // Interruptor principal: backend.js lee este valor y carga
  // firebase-backend.js (nube real) o demo-backend.js (simulación local).
  BACKEND: 'firebase', // 'firebase' | 'demo'

  // ---- Firebase (configuración web del proyecto) ----
  // Esta clave es PÚBLICA por diseño (va en el navegador). La seguridad la dan
  // las reglas de Firestore (firestore.rules). Restríngela por dominio en
  // Google Cloud Console → APIs y servicios → Credenciales.
  // apiKey/authDomain/projectId…: identifican tu proyecto ante los servidores
  // de Google. Los copia la consola de Firebase (Configuración del proyecto → Tus apps).
  // measurementId: lo usa Google Analytics.
  FIREBASE: {
    apiKey: 'AIzaSyBI_5w8sDEiHwfOIHJuyt4SqgQj2wXLoVo',
    authDomain: 'zimrat.firebaseapp.com',
    projectId: 'zimrat',
    storageBucket: 'zimrat.firebasestorage.app',
    messagingSenderId: '67531528494',
    appId: '1:67531528494:web:5b888065e0d56d008cc2bf',
    measurementId: 'G-GL5TLN8VWP',
  },
  ANALYTICS: true, // Google Analytics (se omite en localhost y con emuladores)
  // SDK: los módulos se cargan desde gstatic, versión 11.0.1 en TODOS (ver js/firebase/*.js)

  // Único administrador (debe coincidir con firestore.rules)
  // auth.js compara el correo de la sesión con este valor para mostrar el panel.
  // La protección REAL está en firestore.rules (el servidor), que repite este correo.
  ADMIN_EMAIL: 'zimratapp@gmail.com',

  // ---- Cloudinary (subida directa de PDFs, sin firma) ----
  // Cloud name tal como aparece en tu consola de Cloudinary (arriba a la izquierda
  // y en Dashboard → «Cloud name»): rszi2qgm (con «q»).
  // Cloudinary guarda los PDF. cloudName identifica tu cuenta y uploadPreset es una
  // «receta» de subida configurada en Cloudinary como «Unsigned» (sin firma):
  // permite subir desde el navegador sin exponer la clave secreta.
  CLOUDINARY: {
    cloudName: 'rszi2qgm',
    uploadPreset: 'zimrat_preset', // preset «Unsigned»
  },

  // ---- Emuladores locales (Auth + Firestore) ----
  // Emuladores: versiones locales de Auth y Firestore para practicar sin tocar la nube
  // (se arrancan con «npm run emulators»; ver README).
  FIREBASE_EMULATORS: {
    enabled: false,
    host: '127.0.0.1',
    authPort: 9099,
    firestorePort: 8080,
  },

  // ---- Modo demo (solo para pruebas; NO es seguro) ----
  // Usuario del modo demo. Se guarda en el código, por eso es solo para pruebas.
  DEMO_ADMIN_EMAIL: 'admin@zimrat.app',
  DEMO_ADMIN_PASSWORD: 'admin123',
  DEMO_SHOW_CREDENTIALS: true,

  // Categorías sugeridas en el formulario (se pueden escribir otras)
  DEFAULT_CATEGORIES: ['Adoración', 'Alabanza', 'Música Sacra', 'Comunión', 'Ofrenda', 'Navidad', 'Pop', 'Folclore', 'Rock', 'Infantil'],

  // PDFs: límite del plan gratuito de Cloudinary y recomendaciones para datos móviles
  // MAX_PDF_MB: tamaño máximo aceptado (límite del plan gratuito de Cloudinary).
  // PDF_LIGHT_MB / PDF_HEAVY_MB: umbrales de la etiqueta «Ligero / Aceptable / Pesado».
  MAX_PDF_MB: 10,
  PDF_LIGHT_MB: 1,
  PDF_HEAVY_MB: 3,

  // Cuántas canciones recientes se recuerdan en este dispositivo.
  RECENT_COUNT: 5,

  // Monitoreo de conexión con Firebase (panel de administración)
  // Cada cuántos segundos el panel comprueba la conexión real con Firestore.
  CONNECTION_CHECK_SECONDS: 30,
  FEEDBACK_COOLDOWN_SECONDS: 60, // un mensaje del buzón por minuto y dispositivo
};
