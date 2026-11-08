/* =========================================================
   LoginModal.js — Inicio de sesión del administrador
   ========================================================= */
import config from '../../config.js';
import { el, icon, field, toast } from '../utils.js';
import { Modal } from './Modal.js';

export function openLogin(ctx, { onSuccess } = {}) {
  const m = Modal({ title: 'Acceso de administrador', eyebrow: 'Solo personal autorizado', size: 'sm' });

  // autocomplete="username" / "current-password": permiten que el gestor de
  // contraseñas del navegador rellene los datos.
  const email = el('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'correo@ejemplo.com', inputmode: 'email' });
  const pass = el('input', { type: 'password', id: 'login-pass', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const toggle = el('button', { class: 'pass-toggle', type: 'button', 'aria-label': 'Mostrar contraseña', html: icon('eye') });
  // Botón del «ojo»: alterna el tipo del campo entre password y text.
  toggle.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    toggle.innerHTML = icon(show ? 'eyeOff' : 'eye');
    toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });

  const error = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit', text: 'Entrar' });

  const demo = ctx.backend.mode === 'demo';
  const hint = demo
    ? el('div', { class: 'notice notice-warn' },
        el('span', { html: icon('info') }),
        el('div', {},
          el('strong', { text: 'Modo demo · login simulado' }),
          config.DEMO_SHOW_CREDENTIALS
            ? el('p', { html: `Correo: <code>${config.DEMO_ADMIN_EMAIL}</code><br>Contraseña: <code>${config.DEMO_ADMIN_PASSWORD}</code>` })
            : el('p', { text: 'Usa las credenciales definidas en config.js.' })))
    : null;

  const form = el('form', { class: 'form', novalidate: true },
    field('Correo electrónico', email),
    el('div', { class: 'field' },
      el('label', { for: 'login-pass', text: 'Contraseña' }),
      el('div', { class: 'pass-wrap' }, pass, toggle)),
    error, submit, hint);

  // Envío del formulario:
  // · e.preventDefault() evita que el navegador recargue la página.
  // · Se desactiva el botón mientras se espera (evita dobles envíos).
  // · ctx.backend.signIn() decide si es Firebase o demo.
  // · finally: se ejecuta siempre, haya éxito o error (reactiva el botón).
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (!email.value.trim() || !pass.value) { error.textContent = 'Escribe tu correo y contraseña.'; return; }
    submit.disabled = true;
    submit.textContent = 'Entrando…';
    try {
      await ctx.backend.signIn(email.value.trim(), pass.value);
      m.close();
      toast('Sesión iniciada. ¡Bienvenido!', 'success');
      onSuccess?.();
    } catch (err) {
      error.textContent = err.message || 'No se pudo iniciar sesión.';
      pass.select();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Entrar';
    }
  });

  m.body.append(form);
  m.open();
  email.focus();
}
