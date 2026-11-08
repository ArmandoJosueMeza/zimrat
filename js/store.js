/* =========================================================
   store.js — Estado global mínimo (patrón publicar/suscribir)
   // ---------------------------------------------------------
   // QUÉ ES: un «almacén» único con el estado de la app. En lugar de
   // que cada componente guarde su propia copia de las canciones o de
   // la sesión, todos leen de aquí.
   // CÓMO SE USA:
   //   store.get()            → lee el estado actual (objeto completo)
   //   store.set({ a: 1 })    → cambia solo esas claves y avisa a todos
   //   store.subscribe(fn)    → fn(state) se ejecuta en cada cambio
   // Este patrón se llama «publicar/suscribir» (pub/sub). Es una versión
   // mínima de lo que hacen librerías como Redux o Zustand.
   // =========================================================
   ========================================================= */
// Estado inicial. Cada clave lleva un comentario con su significado.
const state = {
  songs: [],        // canciones normalizadas y ordenadas A-Z
  setlists: [],     // repertorios (listas de canciones para eventos)
  activeSetlist: null, // repertorio que se está recorriendo (anterior/siguiente)
  recent: [],       // ids de las últimas canciones vistas (este dispositivo)
  online: navigator.onLine,
  fromCache: false, // true si los datos vienen de la copia sin conexión
  query: '',        // texto del buscador público
  category: '',     // filtro por categoría ('' = todas)
  tag: '',          // filtro por etiqueta ('' = ninguna)
  loading: true,
  error: null,
  session: null,    // { email } cuando hay un admin conectado
  mode: 'demo',     // 'demo' | 'firebase'
  route: 'list',    // vista base: 'list' | 'detail' | 'setlist' | 'admin'
  connection: null, // admin: { state: 'checking'|'ok'|'error', ms, message, at }
  feedbackUnread: 0, // admin: sugerencias sin leer
};
// Set: colección sin duplicados con las funciones suscritas.
const listeners = new Set();

export const store = {
  get: () => state,
  set(patch) {
    // Object.assign mezcla el «parche» en el estado (solo cambian esas
    // claves) y después se avisa a todos los suscriptores. Cada componente
    // decide si ese cambio le afecta (muchos comparan con el valor anterior
    // para no redibujar de más).
    Object.assign(state, patch);
    listeners.forEach((fn) => fn(state));
  },
  /** Ejecuta fn cada vez que cambia el estado. Devuelve la función para desuscribirse. */
  subscribe(fn) {
    listeners.add(fn);
    // Devuelve una función para dejar de escuchar (útil si un componente
    // desaparece).
    return () => listeners.delete(fn);
  },
};
