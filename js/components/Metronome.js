/* =========================================================
   Metronome.js — Interfaz del metrónomo
   - Metronome()      → tarjeta completa (pantalla de detalle)
   - MetronomeMini()  → píldora flotante (visor de PDF)
   Ambas controlan el mismo motor (services/metronome.js).
   ========================================================= */
import { el, icon, SIGNATURES, BPM_MIN, BPM_MAX, toast } from '../utils.js';
import * as metro from '../services/metronome.js';

// Atajo al estado del motor (services/metronome.js). Separar MOTOR (sonido y
// tiempo) de INTERFAZ (botones) permite tener dos interfaces —la tarjeta y
// la píldora del visor— controlando el mismo sonido.
const s = metro.state;

// try/catch: si el navegador no tiene Web Audio, se avisa en vez de fallar.
async function togglePlay() {
  try { await metro.toggle(); } catch (err) { toast(err.message, 'error'); }
}

/** Botón +/- que repite al mantenerlo pulsado. */
// Botones − / +: un toque cambia 1 BPM; mantener pulsado repite cada vez
// más rápido (pointerdown inicia, pointerup/leave detiene). Los eventos
// «pointer» funcionan igual con ratón, dedo o lápiz.
function stepButton(delta, label) {
  const btn = el('button', { class: 'btn btn-icon metro-step', type: 'button', 'aria-label': label, html: icon(delta > 0 ? 'plus' : 'minus') });
  let hold, repeat;
  const stopHold = () => { clearTimeout(hold); clearInterval(repeat); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    metro.setBpm(s.bpm + delta);
    hold = setTimeout(() => { repeat = setInterval(() => metro.setBpm(s.bpm + delta * 2), 70); }, 400);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stopHold));
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); metro.setBpm(s.bpm + delta); } });
  return btn;
}

// Un punto por tiempo del compás; el que suena se ilumina (el 1 en otro color).
function beatDots() {
  const wrap = el('div', { class: 'beat-dots', 'aria-hidden': 'true' });
  const render = () => {
    if (wrap.childElementCount !== s.beats) {
      wrap.replaceChildren(...Array.from({ length: s.beats }, (_, i) => el('span', { class: `dot ${i === 0 ? 'dot-accent' : ''}` })));
    }
    [...wrap.children].forEach((d, i) => d.classList.toggle('on', i === s.beat));
  };
  return { wrap, render };
}

/** Destello breve en cada tiempo (funciona también con "reducir movimiento"). */
// Destello visual: se quita la clase, void node.offsetWidth fuerza al
// navegador a «recalcular» (reinicia la animación CSS) y se vuelve a poner.
function flash(node, accent) {
  node.classList.remove('flash', 'flash-accent');
  void node.offsetWidth;
  node.classList.add(accent ? 'flash-accent' : 'flash');
  clearTimeout(node._flashT);
  node._flashT = setTimeout(() => node.classList.remove('flash', 'flash-accent'), Math.min(140, 30000 / s.bpm));
}

// Tarjeta completa: pulso grande, puntos del compás, BPM con deslizador y
// − / +, selector de compás, Iniciar/Detener, Tap tempo y Restablecer.
export function Metronome() {
  const pulse = el('div', { class: 'metro-pulse', 'aria-hidden': 'true' }, el('span', { class: 'metro-beatnum', text: '–' }));
  const beatNum = pulse.firstChild;
  const dots = beatDots();
  const bpmValue = el('span', { class: 'metro-bpm-num', text: s.bpm });
  const slider = el('input', { type: 'range', min: String(BPM_MIN), max: String(BPM_MAX), step: '1', value: String(s.bpm), class: 'metro-slider', 'aria-label': 'Tempo en BPM' });
  slider.addEventListener('input', () => metro.setBpm(slider.value));
  const sig = el('select', { class: 'metro-select', 'aria-label': 'Compás' }, ...SIGNATURES.map((x) => el('option', { value: x, text: x })));
  sig.addEventListener('change', () => metro.setSignature(sig.value));
  const play = el('button', { class: 'btn btn-primary btn-lg metro-play', type: 'button' });
  play.addEventListener('click', togglePlay);
  const tapBtn = el('button', { class: 'btn metro-tap', type: 'button', html: `${icon('hand')}<span>Tap</span>`, title: 'Toca varias veces al ritmo para calcular el tempo' });
  tapBtn.addEventListener('click', () => { const n = metro.tap(); if (n === 1) toast('Sigue tocando al ritmo…'); });
  const reset = el('button', { class: 'btn btn-sm btn-ghost metro-reset', type: 'button', html: `${icon('undo')}<span>Valores de la canción</span>` });
  reset.addEventListener('click', () => metro.resetToSong());
  const status = el('span', { class: 'sr-only', 'aria-live': 'polite' });

  const card = el('section', { class: 'card metro', 'aria-label': 'Metrónomo' },
    el('div', { class: 'card-head' },
      el('h2', { html: `${icon('metronome')}<span>Metrónomo</span>` }),
      reset),
    el('div', { class: 'metro-body' },
      pulse,
      el('div', { class: 'metro-main' },
        el('div', { class: 'metro-bpm' }, stepButton(-1, 'Bajar 1 BPM'), el('div', { class: 'metro-bpm-display' }, bpmValue, el('span', { class: 'metro-bpm-unit', text: 'BPM' })), stepButton(1, 'Subir 1 BPM')),
        slider,
        dots.wrap)),
    el('div', { class: 'metro-controls' },
      el('label', { class: 'metro-sig' }, el('span', { text: 'Compás' }), sig),
      tapBtn,
      play),
    status);

  function render(st, type) {
    dots.render();
    if (type === 'beat') {
      beatNum.textContent = st.beat + 1;
      flash(pulse, st.beat === 0);
      return;
    }
    // render recibe el tipo de aviso: 'beat' (arriba: solo parpadeo, muy
    // frecuente → trabajo mínimo) o 'change' (aquí: BPM, compás, play/stop →
    // redibujo completo). --fill es una variable CSS que colorea el deslizador
    // hasta el valor actual. status (sr-only, invisible) informa a los
    // lectores de pantalla.
    bpmValue.textContent = st.bpm;
    if (Number(slider.value) !== st.bpm) slider.value = String(st.bpm);
    slider.style.setProperty('--fill', `${((st.bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100}%`);
    sig.value = st.signature;
    beatNum.textContent = st.playing ? (st.beat >= 0 ? st.beat + 1 : '1') : '–';
    play.innerHTML = st.playing ? `${icon('stop')}<span>Detener</span>` : `${icon('play')}<span>Iniciar</span>`;
    play.setAttribute('aria-pressed', String(st.playing));
    card.classList.toggle('is-playing', st.playing);
    reset.hidden = !metro.isModified();
    status.textContent = st.playing ? `Metrónomo sonando a ${st.bpm} BPM, compás ${st.signature}` : 'Metrónomo detenido';
  }

  metro.subscribe(render);
  render(s, 'change');
  return card;
}

// Versión compacta para el visor de PDF (no tapa la partitura).
export function MetronomeMini({ onClose } = {}) {
  const play = el('button', { class: 'btn btn-icon btn-primary', type: 'button' });
  play.addEventListener('click', togglePlay);
  const bpm = el('span', { class: 'mini-bpm' });
  const sig = el('span', { class: 'mini-sig' });
  const dots = beatDots();
  const pill = el('div', { class: 'metro-mini', role: 'group', 'aria-label': 'Metrónomo' },
    play,
    el('span', { class: 'mini-led', 'aria-hidden': 'true' }),
    stepButton(-1, 'Bajar 1 BPM'),
    el('div', { class: 'mini-read' }, bpm, sig),
    stepButton(1, 'Subir 1 BPM'),
    dots.wrap,
    el('button', { class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Ocultar metrónomo', html: icon('close'), onclick: () => onClose?.() }));
  const led = pill.querySelector('.mini-led');

  function render(st, type) {
    dots.render();
    if (type === 'beat') { flash(led, st.beat === 0); return; }
    play.innerHTML = icon(st.playing ? 'stop' : 'play');
    play.setAttribute('aria-label', st.playing ? 'Detener metrónomo' : 'Iniciar metrónomo');
    bpm.textContent = `${st.bpm} BPM`;
    sig.textContent = st.signature;
    pill.classList.toggle('is-playing', st.playing);
  }
  metro.subscribe(render);
  render(s, 'change');
  return pill;
}
