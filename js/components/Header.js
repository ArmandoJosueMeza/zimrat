/* =========================================================
   Header.js — Barra superior: marca, tema claro/oscuro, acceso admin
   ========================================================= */
import config from '../../config.js';
import { store } from '../store.js';
import { el, icon, toast } from '../utils.js';
import { currentTheme, toggleTheme } from '../services/theme.js';
import { openLogin } from './LoginModal.js';
import { confirmDialog } from './ConfirmDialog.js';

// Barra superior fija (position: sticky en el CSS). Contiene: logo, chip
// «Sin conexión», chip de estado de Firebase (solo admin), botón de tema y
// acciones de sesión (Admin / Panel / Cerrar sesión).
export function Header(ctx) {
  const themeBtn = el('button', { class: 'btn btn-icon btn-ghost theme-btn', type: 'button' });
  const syncTheme = () => {
    const dark = currentTheme() === 'dark';
    const label = dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  };
  // Al pulsar: cambia el tema (theme.js) y actualiza el icono sol/luna.
  themeBtn.addEventListener('click', () => { toggleTheme(); syncTheme(); });
  syncTheme();

  const actions = el('div', { class: 'header-actions' });
  const offlineChip = el('span', { class: 'offline-chip', role: 'status', hidden: true, html: `${icon('offline')}<span>Sin conexión</span>` });
  const connChip = el('button', { class: 'conn-chip', type: 'button', hidden: true, onclick: () => ctx.go('#/admin') });
  const header = el('header', { class: 'topbar' },
    el('a', { class: 'brand', href: '#/', 'aria-label': `${config.APP_NAME}, inicio`, onclick: (e) => { e.preventDefault(); ctx.go('#/'); } },
      el('img', { class: 'brand-logo', src: 'icons/icon.svg', alt: '', width: '36', height: '36' }),
      el('span', { class: 'brand-text' },
        el('span', { class: 'brand-name', text: config.APP_NAME }),
        el('span', { class: 'brand-tagline', text: config.APP_TAGLINE }))),
    el('div', { class: 'header-right' }, offlineChip, connChip, themeBtn, actions));

  async function logout() {
    const ok = await confirmDialog({ title: '¿Cerrar sesión?', message: 'Volverás a la vista pública de Zimrat.', confirmText: 'Cerrar sesión' });
    if (!ok) return;
    await ctx.backend.signOut();
    toast('Sesión cerrada');
  }

  // Chip de conexión: se redibuja con cada cambio del store. data-state
  // (ok / error / checking) decide el color en el CSS.
  store.subscribe(({ session, connection, online }) => {
    connChip.hidden = !session;
    if (!session) return;
    const state = !online ? 'error' : connection?.state || 'checking';
    connChip.dataset.state = state;
    const text = state === 'ok' ? 'Conectado' : state === 'error' ? 'Error de conexión' : 'Comprobando…';
    connChip.innerHTML = `<span class="conn-dot" aria-hidden="true"></span><span class="hide-sm">${text}</span>`;
    connChip.setAttribute('aria-label', `Firebase: ${text}`);
    connChip.title = state === 'ok' && connection?.ms != null ? `Conectado a Firebase (${connection.ms} ms)` : (connection?.message || text);
  });

  let last = '';
  // Acciones según la sesión. «key» resume lo que importa: si no cambió,
  // no se redibuja (evita trabajo innecesario en cada cambio del store).
  function render({ session, route, feedbackUnread }) {
    const key = `${session?.email}|${route}|${feedbackUnread}`;
    if (key === last) return;
    last = key;
    actions.replaceChildren();

    if (!session) {
      actions.append(el('button', {
        class: 'btn btn-ghost', type: 'button', 'aria-label': 'Acceso de administrador',
        html: `${icon('lock')}<span class="hide-sm">Admin</span>`,
        onclick: () => openLogin(ctx, { onSuccess: () => ctx.go('#/admin') }),
      }));
      return;
    }
    const onAdmin = route === 'admin';
    actions.append(
      el('button', {
        class: `btn ${onAdmin ? '' : 'btn-soft'}`, type: 'button',
        'aria-label': onAdmin ? 'Ver canciones' : 'Panel de administración',
        html: `${icon(onAdmin ? 'list' : 'settings')}<span class="hide-sm">${onAdmin ? 'Ver canciones' : 'Panel'}</span>${!onAdmin && feedbackUnread ? `<span class="btn-badge" title="Sugerencias sin leer">${feedbackUnread > 99 ? '99+' : feedbackUnread}</span>` : ''}`,
        onclick: () => ctx.go(onAdmin ? '#/' : '#/admin'),
      }),
      el('button', {
        class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Cerrar sesión', title: `Cerrar sesión (${session.email})`,
        html: icon('logout'), onclick: logout,
      }));
  }

  // Chip «Sin conexión»: visible si no hay red o si los datos vienen de la copia guardada.
  store.subscribe(({ online, fromCache }) => {
    offlineChip.hidden = online && !fromCache;
    offlineChip.title = online ? 'Mostrando la última copia guardada' : 'Sin conexión: usando los datos y PDFs guardados en este dispositivo';
  });
  store.subscribe(render);
  render(store.get());
  return header;
}
