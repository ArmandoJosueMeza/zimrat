/* =========================================================
   ConfirmDialog.js — Confirmación (devuelve una promesa true/false)
   ========================================================= */
import { el } from '../utils.js';
import { Modal } from './Modal.js';

// Sustituye a window.confirm() (feo y bloqueante) por una ventana propia.
// Devuelve una Promise, así se usa con await:
//   if (await confirmDialog({ title: '¿Eliminar?', … })) { … }
// La promesa se resuelve al cerrarse la ventana (onClose) con true solo si
// se pulsó el botón de confirmar.
export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let accepted = false;
    const m = Modal({ title, size: 'sm', onClose: () => resolve(accepted) });
    const ok = el('button', {
      class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: confirmText,
      onclick: () => { accepted = true; m.close(); },
    });
    m.body.append(
      el('p', { class: 'confirm-msg', text: message }),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => m.close() }),
        ok));
    m.open();
    ok.focus();
  });
}
