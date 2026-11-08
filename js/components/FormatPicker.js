/* =========================================================
   FormatPicker.js — Botones para abrir Letra / Acordes / Partitura
   ========================================================= */
import { el, icon, FORMATS } from '../utils.js';

// Tres botones (Letra, Acordes, Partitura). Si la canción no tiene ese
// PDF, el botón aparece desactivado con «No disponible».
// onPick(formato) lo decide quien usa el componente (normalmente navegar
// al visor): así el componente no depende de las rutas.
export function FormatButtons(song, onPick) {
  return el('div', { class: 'format-grid' }, ...FORMATS.map((f) => {
    const available = Boolean(song[f.key]);
    return el('button', {
      class: `format-btn format-${f.key}`, type: 'button', disabled: !available,
      onclick: () => onPick(f.key),
    },
      el('span', { class: 'format-ico', html: icon(f.icon) }),
      el('span', { class: 'format-text' },
        el('span', { class: 'format-label', text: f.label }),
        el('span', { class: 'format-sub', text: available ? f.long : 'No disponible' })));
  }));
}
