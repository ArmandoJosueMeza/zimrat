/* =========================================================
   metronome.js — Motor del metrónomo (Web Audio API)
   ---------------------------------------------------------
   Técnica "lookahead scheduling": un temporizador revisa cada 25 ms
   qué clics caen en los próximos 120 ms y los programa en el reloj
   de audio, que es exacto al milisegundo. Así el tempo no se
   desvía aunque la pantalla esté ocupada dibujando el PDF.

   - Tiempo 1 del compás: clic agudo (1760 Hz).  Resto: clic grave (880 Hz).
   - El temporizador vive en un Web Worker para que no se frene
     cuando el navegador baja el ritmo de la pestaña.
   - Una sola instancia compartida: el metrónomo de la ficha y el
     mini metrónomo del visor controlan el mismo sonido.

   API: start(), stop(), toggle(), setBpm(n), setSignature('3/4'),
        tap(), loadSong(song), resetToSong(), subscribe(fn), state
   // ---------------------------------------------------------
   // ¿POR QUÉ NO BASTA CON setInterval(click, 60000 / bpm)?
   // setInterval no es exacto: si el navegador está ocupado (dibujando un
   // PDF, haciendo scroll) el clic se retrasa unos milisegundos y el oído
   // lo nota. El reloj de Web Audio (audio.currentTime) es independiente y
   // preciso; programando cada clic «para dentro de X segundos» el sonido
   // sale exactamente a tiempo aunque JavaScript vaya con retraso.
   //
   // CÓMO SE CONECTAN LAS PIEZAS
   //   Worker (cada 25 ms) ──► schedule() ──► click(tiempo exacto) ──► altavoz
   //                                    └──► queue (cola de pulsos)
   //   requestAnimationFrame ──► draw() ──► saca de la cola los pulsos que ya
   //                                        sonaron ──► emit('beat') ──► la
   //                                        interfaz ilumina el punto del compás
   // =========================================================
   ========================================================= */
import { SIGNATURES, DEFAULT_BPM, BPM_MIN, BPM_MAX } from '../utils.js';

// LOOKAHEAD_MS: cada cuánto se revisa la agenda (milisegundos).
// SCHEDULE_AHEAD_S: cuánto tiempo hacia delante se programan clics (segundos).
// Con 120 ms de margen, aunque un ciclo se retrase, el audio ya está programado.
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

// Estado público del metrónomo. Los componentes lo leen y se suscriben con
// subscribe(fn) para redibujar (botón play/stop, BPM, punto que parpadea).
// songBpm/songSignature: valores guardados en la canción, para «Restablecer».
export const state = {
  playing: false,
  bpm: DEFAULT_BPM,
  signature: '4/4',
  beats: 4,
  beat: -1,          // tiempo que suena ahora (0 = tiempo 1), -1 detenido
  songId: null,
  songBpm: DEFAULT_BPM,
  songSignature: '4/4',
};

const listeners = new Set();
const emit = (type = 'change') => listeners.forEach((fn) => fn(state, type));
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Variables internas del motor:
// · audio: el AudioContext (se crea al primer «play», ver start()).
// · nextTime: instante (en segundos del reloj de audio) del próximo clic.
// · nextBeat: qué tiempo del compás será (0 = tiempo 1, acentuado).
let audio = null;
let nextTime = 0;
let nextBeat = 0;
let queue = [];         // [{ beat, time }] clics programados aún no mostrados
let rafId = 0;
let ticker = null;      // Worker o setInterval

/* ---------- Temporizador (Worker con respaldo) ---------- */
// El temporizador vive en un Web Worker (un hilo aparte). Los navegadores
// ralentizan los setInterval de la página cuando está ocupada o en segundo
// plano, pero mucho menos los de un Worker. El Worker se crea desde un texto
// (Blob + URL.createObjectURL), así no hace falta otro archivo.
// Si el navegador no permite Workers, se usa setInterval normal (respaldo).
function startTicker() {
  try {
    const code = `let t; onmessage = (e) => { clearInterval(t); if (e.data === 'start') t = setInterval(() => postMessage(0), ${LOOKAHEAD_MS}); };`;
    const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    worker.onmessage = schedule;
    worker.postMessage('start');
    ticker = { stop: () => worker.terminate() };
  } catch {
    const id = setInterval(schedule, LOOKAHEAD_MS);
    ticker = { stop: () => clearInterval(id) };
  }
}

/* ---------- Sonido sintético ---------- */
// Sonido sintético (no hay archivos de audio):
// · OscillatorNode genera un tono (onda triangular, suave).
// · GainNode controla el volumen con una «envolvente»: sube en 2 ms y cae
//   enseguida → un clic corto y nítido.
// · Tiempo 1: 1760 Hz y más fuerte; resto: 880 Hz (una octava más grave).
// · osc.start(time) programa el sonido en el reloj de audio, no «ya».
// Cadena de audio: oscilador → ganancia → destination (altavoces).
function click(time, accent) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(accent ? 1760 : 880, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 1 : 0.65, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + (accent ? 0.07 : 0.05));
  osc.connect(gain).connect(audio.destination);
  osc.start(time);
  osc.stop(time + 0.08);
}

// Programa todos los clics que caen dentro de la ventana de anticipación.
// Como lee state.bpm en cada vuelta, cambiar el BPM afecta al siguiente
// clic sin tener que reiniciar el metrónomo.
// El operador % (módulo) hace que el contador vuelva a 0 al terminar el compás.
function schedule() {
  while (nextTime < audio.currentTime + SCHEDULE_AHEAD_S) {
    click(nextTime, nextBeat === 0);
    queue.push({ beat: nextBeat, time: nextTime });
    nextTime += 60 / state.bpm;           // lee el BPM actual → cambios en tiempo real
    nextBeat = (nextBeat + 1) % state.beats;
  }
}

/* ---------- Pulso visual sincronizado con el audio ---------- */
// requestAnimationFrame ejecuta draw() en cada cuadro de pantalla (~60 veces
// por segundo). Solo avisa a la interfaz cuando un clic programado YA sonó,
// así el punto visual coincide con el sonido.
function draw() {
  const now = audio.currentTime;
  let changed = false;
  while (queue.length && queue[0].time <= now) {
    state.beat = queue.shift().beat;
    changed = true;
  }
  if (changed) emit('beat');
  rafId = requestAnimationFrame(draw);
}

/* ---------- Controles ---------- */
// Los navegadores exigen que el audio empiece tras un gesto del usuario
// (toque o clic). Por eso el AudioContext se crea aquí, al pulsar «play»,
// y si está «suspended» se reanuda con resume().
// ??= crea el contexto solo la primera vez (se reutiliza después).
export async function start() {
  if (state.playing) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('Este navegador no soporta Web Audio.');
  audio ??= new Ctx();
  if (audio.state === 'suspended') await audio.resume(); // necesario en iPhone/Chrome tras un toque
  nextBeat = 0;
  nextTime = audio.currentTime + 0.06;
  queue = [];
  state.playing = true;
  startTicker();
  schedule();
  rafId = requestAnimationFrame(draw);
  emit();
}

// Detener: para el Worker, la animación y vacía la cola de pulsos.
export function stop() {
  if (!state.playing) return;
  ticker?.stop();
  ticker = null;
  cancelAnimationFrame(rafId);
  queue = [];
  state.playing = false;
  state.beat = -1;
  emit();
}

export const toggle = () => (state.playing ? stop() : start());

// Limita el BPM al rango permitido (Math.min/Math.max) y redondea.
export function setBpm(value) {
  const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(Number(value) || DEFAULT_BPM)));
  if (bpm === state.bpm) return;
  state.bpm = bpm;
  emit();
}

export function setSignature(sig) {
  if (!SIGNATURES.includes(sig)) sig = '4/4';
  state.signature = sig;
  state.beats = Number(sig.split('/')[0]);
  nextBeat = 0; // el siguiente clic vuelve a ser el tiempo 1
  emit();
}

/** Tap tempo: toca al ritmo y calcula el BPM (media de los últimos toques). */
// Tap tempo: se guardan los instantes de los últimos toques (performance.now()
// da milisegundos precisos). Si pasan más de 2 s sin tocar, se empieza de cero.
// BPM = 60000 ms / intervalo medio entre toques.
let taps = [];
export function tap() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  taps = taps.slice(-6);
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(60000 / avg);
  }
  return taps.length;
}

/** Carga los valores guardados de una canción (si es otra, detiene el metrónomo). */
// Al abrir una canción se cargan su BPM y compás guardados. Si es la misma
// canción (p. ej. al pasar de la ficha al visor), no se interrumpe el sonido.
export function loadSong(song) {
  if (state.songId === song.id) {
    // Misma canción: solo actualiza los valores guardados (por si se editaron)
    state.songBpm = song.bpm || DEFAULT_BPM;
    state.songSignature = song.compas || '4/4';
    emit();
    return;
  }
  stop();
  state.songId = song.id;
  state.songBpm = song.bpm || DEFAULT_BPM;
  state.songSignature = song.compas || '4/4';
  state.bpm = state.songBpm;
  setSignature(state.songSignature);
}

export function resetToSong() {
  state.bpm = state.songBpm;
  setSignature(state.songSignature);
}

export const isModified = () => state.bpm !== state.songBpm || state.signature !== state.songSignature;
