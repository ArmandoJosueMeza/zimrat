/* =========================================================
   firebase/auth.js — Autenticación del administrador
   ---------------------------------------------------------
   loginAdmin / logoutAdmin / listenAuthState (la API que pediste), con una
   mejora de seguridad: solo cuenta como administrador el correo de
   config.ADMIN_EMAIL (zimratapp@gmail.com). Cualquier otra cuenta que
   lograra iniciar sesión NO verá el panel, y firestore.rules le impide
   escribir aunque manipule el navegador.
   ========================================================= */
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import config from '../../config.js';
import { app, usingEmulators } from './init.js';

// getAuth(app): objeto de autenticación ligado al proyecto. Firebase
// recuerda la sesión en el navegador (IndexedDB), por eso el admin sigue
// conectado al recargar la página.
export const auth = getAuth(app);
if (usingEmulators) {
  const { host, authPort } = config.FIREBASE_EMULATORS;
  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
}

// isAdminUser: true solo si hay usuario y su correo coincide con
// config.ADMIN_EMAIL (sin distinguir mayúsculas). El «?.» evita error si
// user es null (nadie conectado).
export const isAdminUser = (user) => Boolean(user?.email) && user.email.toLowerCase() === config.ADMIN_EMAIL.toLowerCase();

// Traducción de los códigos de error de Firebase Auth a mensajes claros.
// Por seguridad, «usuario no existe» y «contraseña incorrecta» muestran el
// MISMO mensaje: así nadie puede averiguar qué correos están registrados.
const MESSAGES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'Sin conexión con Firebase. Revisa tu internet.',
  'auth/user-disabled': 'Esta cuenta está desactivada.',
  'auth/operation-not-allowed': 'El acceso con correo y contraseña no está habilitado en Firebase (Authentication → Método de acceso).',
};

/** Inicia sesión como administrador → { success, user } | { success: false, error } */
export async function loginAdmin(email, password) {
  try {
    // signInWithEmailAndPassword envía correo y contraseña a los servidores de
    // Google; si son correctos devuelve el usuario. Si no es el admin, se
    // cierra la sesión inmediatamente.
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    if (!isAdminUser(user)) {
      await signOut(auth);
      return { success: false, error: 'Esta cuenta no tiene permisos de administrador.' };
    }
    return { success: true, user };
  } catch (error) {
    return { success: false, error: MESSAGES[error.code] || error.message, code: error.code };
  }
}

/** Cierra la sesión. */
export async function logoutAdmin() {
  await signOut(auth);
}

/** Llama a callback(isAdmin, user) al iniciar y en cada cambio de sesión. Devuelve la función para dejar de escuchar. */
export function listenAuthState(callback) {
  // onAuthStateChanged se ejecuta al arrancar (con la sesión recordada o null)
  // y cada vez que alguien entra o sale.
  return onAuthStateChanged(auth, (user) => callback(isAdminUser(user), user));
}
