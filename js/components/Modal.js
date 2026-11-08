/* =========================================================
   Modal.js — Ventana modal reutilizable (basada en <dialog>)
   // ---------------------------------------------------------
   // PATRÓN DE LOS COMPONENTES DE ZIMRAT
   // Cada componente es una FUNCIÓN que crea elementos del DOM con el()
   // y los devuelve (o, como aquí, devuelve un objeto con métodos). No hay
   // framework (React, Vue…): es JavaScript «vanilla», ligero y sin compilar.
   //
   // <dialog> es el elemento nativo de HTML para ventanas modales:
   // showModal() lo abre por encima de todo, atrapa el foco del teclado
   // dentro de la ventana y la tecla Esc lo cierra (evento «cancel»).
   // =========================================================
   ========================================================= */
import { el, icon, uid } from '../utils.js';

/**
 * const m = Modal({ title, eyebrow, size: 'sm'|'md'|'lg', dismissable, onClose });
 * m.body.append(...); m.open(); m.close();
 */
export function Modal({ title = '', eyebrow = '', size = 'md', dismissable = true, onClose } = {}) {
  // aria-labelledby enlaza la ventana con su título: los lectores de
  // pantalla anuncian «Acceso de administrador, diálogo».
  const titleId = uid('mt-');
  const closeBtn = el('button', { class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Cerrar', html: icon('close') });
  const body = el('div', { class: 'modal-body' });
  const dialog = el('dialog', { class: `modal modal-${size}`, 'aria-labelledby': titleId },
    el('div', { class: 'modal-inner' },
      el('div', { class: 'modal-head' },
        el('div', { class: 'modal-titles' },
          eyebrow ? el('p', { class: 'modal-eyebrow', text: eyebrow }) : null,
          el('h2', { id: titleId, text: title })),
        closeBtn),
      body));

  const close = () => { if (dialog.open) dialog.close(); };
  closeBtn.addEventListener('click', close);
  // Clic fuera de la ventana (sobre el fondo oscuro) = cerrar. En los
  // formularios (dismissable: false) se desactiva para no perder lo escrito,
  // y mientras se guarda (busy) tampoco se puede cerrar con Esc.
  if (dismissable) dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  else dialog.addEventListener('cancel', (e) => { if (dialog.dataset.busy) e.preventDefault(); });
  // Al cerrarse, se elimina del DOM (no se acumulan ventanas ocultas).
  dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); });

  return {
    dialog,
    body,
    open() { document.body.append(dialog); dialog.showModal(); },
    close,
    setBusy(busy) { closeBtn.disabled = busy; if (busy) dialog.dataset.busy = '1'; else delete dialog.dataset.busy; },
  };
}
