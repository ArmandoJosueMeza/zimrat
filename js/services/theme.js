/* =========================================================
   theme.js — Tema claro / oscuro
   Se guarda la preferencia; si no hay, se usa la del sistema.
   ========================================================= */
import { storageGet, storageSet } from '../utils.js';

const KEY = 'zimrat-theme';
// Color de la barra del navegador móvil para cada tema.
const COLORS = { light: '#ffffff', dark: '#151827' };

export const currentTheme = () => document.documentElement.dataset.theme || 'light';

// El tema se aplica con un atributo: <html data-theme="dark">. En styles.css,
// [data-theme="dark"] redefine las variables de color (--bg, --text…),
// así TODO el diseño cambia sin tocar cada componente.
function apply(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme]);
}

// matchMedia('(prefers-color-scheme: dark)') consulta el tema del sistema
// operativo; se usa solo si el usuario nunca eligió uno.
export function initTheme() {
  const saved = storageGet(KEY);
  const system = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  apply(saved === 'dark' || saved === 'light' ? saved : system);
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  apply(next);
  storageSet(KEY, next);
  return next;
}
