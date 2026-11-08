/* =========================================================
   FeedbackModal.js — Buzón público de sugerencias y reportes
   ---------------------------------------------------------
   · Cualquier visitante (sin login) puede enviar una sugerencia,
     reportar un error en una canción o dejar un comentario.
   · Se guarda en Firestore («feedback»); solo el admin lo lee
     (Panel → Sugerencias).
   · Anti-spam: campo trampa oculto (honeypot) + espera de
     config.FEEDBACK_COOLDOWN_SECONDS entre envíos.
   ========================================================= */
import config from '../../config.js';
import { store } from '../store.js';
import { el, icon, field, toast } from '../utils.js';
import { Modal } from './Modal.js';

const LAST_KEY = 'zimrat-feedback-last';
const TYPES = [
  { value: 'sugerencia', label: 'Sugerencia' },
  { value: 'error', label: 'Error en una canción o en la app' },
  { value: 'comentario', label: 'Comentario' },
];

// Espera entre envíos: se guarda en localStorage la hora del último envío
// y se calcula cuántos segundos faltan. (El límite real lo pondrían las
// reglas; esto evita envíos repetidos por error o por impaciencia.)
const lastSent = () => { try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; } };
const waitSeconds = () => Math.max(0, Math.ceil((lastSent() + config.FEEDBACK_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000));

/** Abre el formulario. `song` (opcional) rellena la canción relacionada. */
export function openFeedback(ctx, { song = null, type = 'sugerencia' } = {}) {
  const m = Modal({ title: 'Sugerencias y reportes', eyebrow: 'Buzón de Zimrat', size: 'md' });

  const tipo = el('select', {}, ...TYPES.map((t) => el('option', { value: t.value, text: t.label })));
  tipo.value = type;
  const songs = [...store.get().songs].sort((a, b) => a.numero - b.numero);
  const cancion = el('select', {},
    el('option', { value: '', text: '— Ninguna en particular —' }),
    ...songs.map((s) => el('option', { value: `#${s.numero} ${s.titulo}`, text: `#${s.numero} · ${s.titulo}` })));
  if (song) cancion.value = `#${song.numero} ${song.titulo}`;
  const mensaje = el('textarea', { rows: '5', maxlength: '2000', required: true, placeholder: 'Ej. En «Amanecer» falta la partitura · Sería útil poder…' });
  const counter = el('span', { class: 'field-hint', text: '0 / 2000' });
  mensaje.addEventListener('input', () => { counter.textContent = `${mensaje.value.length} / 2000`; });
  const nombre = el('input', { type: 'text', maxlength: '80', autocomplete: 'name', placeholder: 'Opcional' });
  const contacto = el('input', { type: 'text', maxlength: '120', autocomplete: 'email', placeholder: 'Correo o teléfono (opcional)' });
  // Campo trampa: invisible para personas, los robots suelen rellenarlo
  // HONEYPOT («tarro de miel»): un campo oculto con CSS. Las personas no lo
  // ven ni lo rellenan; muchos robots de spam rellenan todos los campos. Si
  // viene relleno, se finge el envío y se descarta en silencio.
  const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
  const trapWrap = el('div', { class: 'hp-field', 'aria-hidden': 'true' }, el('label', { text: 'No rellenar' }), trap);

  const error = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', html: `${icon('send')}<span>Enviar</span>` });
  const form = el('form', { class: 'form', novalidate: true },
    el('p', { class: 'muted', text: 'Tu mensaje llega directamente al administrador del cancionero. No hace falta iniciar sesión.' }),
    el('div', { class: 'form-row form-row-2' }, field('Tipo', tipo), field('Canción relacionada', cancion)),
    field('Mensaje', mensaje, counter),
    el('div', { class: 'form-row form-row-2' }, field('Tu nombre', nombre), field('Contacto', contacto)),
    trapWrap,
    error,
    el('div', { class: 'modal-actions form-actions' },
      el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => m.close() }), submit));

  // Validaciones antes de enviar: robot, longitud mínima, espera y conexión.
  // Después ctx.backend.sendFeedback() crea el documento en la colección
  // «feedback»; firestore.rules vuelve a validar tipo y longitudes.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const text = mensaje.value.trim();
    if (trap.value) { m.close(); toast('¡Gracias! Mensaje enviado.', 'success'); return; } // robot: se descarta en silencio
    if (text.length < 5) { error.textContent = 'Escribe un mensaje de al menos 5 caracteres.'; mensaje.focus(); return; }
    const wait = waitSeconds();
    if (wait) { error.textContent = `Espera ${wait} s antes de enviar otro mensaje.`; return; }
    if (!navigator.onLine) { error.textContent = 'Sin conexión: el mensaje no se puede enviar ahora. Inténtalo cuando vuelva internet.'; return; }

    submit.disabled = true;
    submit.innerHTML = '<span class="spinner spinner-sm"></span><span>Enviando…</span>';
    try {
      await ctx.backend.sendFeedback({
        type: tipo.value,
        message: text.slice(0, 2000),
        songTitle: cancion.value.slice(0, 200),
        name: nombre.value.trim().slice(0, 80),
        contact: contacto.value.trim().slice(0, 120),
        page: (location.pathname + location.hash).slice(0, 200),
        userAgent: navigator.userAgent.slice(0, 300),
      });
      try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* sin almacenamiento */ }
      m.close();
      toast('¡Gracias! Tu mensaje se envió al administrador.', 'success');
      ctx.refreshFeedbackCount?.();
    } catch (err) {
      error.textContent = err.message || 'No se pudo enviar. Inténtalo de nuevo.';
      submit.disabled = false;
      submit.innerHTML = `${icon('send')}<span>Enviar</span>`;
    }
  });

  m.body.append(form);
  m.open();
  mensaje.focus();
}

/** Botón flotante «Sugerencias» visible en toda la app (salvo en el visor). */
// Botón flotante visible en toda la app (se oculta en el visor con CSS).
// Si estás en la ficha de una canción, el formulario ya la trae seleccionada.
export function FeedbackButton(ctx) {
  const btn = el('button', {
    class: 'fab-feedback', type: 'button', 'aria-label': 'Enviar una sugerencia o reportar un error',
    html: `${icon('message')}<span>Sugerencias</span>`,
  });
  btn.addEventListener('click', () => {
    const { route, songs } = store.get();
    const m = location.hash.match(/^#\/c\/(\d+)/);
    const song = route === 'detail' && m ? songs.find((s) => s.numero === Number(m[1])) : null;
    openFeedback(ctx, { song });
  });
  return btn;
}
