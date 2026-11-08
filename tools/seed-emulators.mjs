/* =========================================================
   seed-emulators.mjs — Datos de ejemplo en los EMULADORES (Auth + Firestore)
   ---------------------------------------------------------
   Requisitos: emuladores en marcha (npm run emulators, en otra consola).
   Uso:        npm run seed
   Crea:
     · Usuario administrador  zimratapp@gmail.com / admin123  (solo en el emulador)
     · Canciones de songs.json con el esquema de Firestore de Zimrat
       (pdfLinks apunta a los PDFs de ejemplo de la carpeta pdfs/)
   Nunca toca tu proyecto real: usa el proyecto ficticio «demo-zimrat».
   ========================================================= */
// Este script se ejecuta con Node.js en tu PC (no en el navegador).
// Usa «firebase-admin», la librería de servidor de Firebase, que se salta
// las reglas de seguridad: por eso solo debe apuntar a los EMULADORES.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Estas variables de entorno indican a firebase-admin que hable con los
// emuladores locales en lugar de con la nube.
const HOST = process.env.EMULATOR_HOST || '127.0.0.1';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `${HOST}:9099`;
process.env.FIRESTORE_EMULATOR_HOST ||= `${HOST}:8080`;

const { initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

const ADMIN = { email: 'zimratapp@gmail.com', password: 'admin123' };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_NAMES = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
// Convierte «D» → «Re Mayor», «Bm» → «Si menor» (igual que utils.js).
const keyName = (code) => {
  if (!code) return '';
  const minor = code.endsWith('m');
  const root = minor ? code.slice(0, -1) : code;
  return `${KEY_NAMES[root[0]]}${root.slice(1)} ${minor ? 'menor' : 'Mayor'}`;
};

initializeApp({ projectId: 'demo-zimrat' });
const auth = getAuth();
const db = getFirestore();

try {
  // 1) Crea el usuario administrador si no existe.
  // 2) Después escribe cada canción de songs.json con el esquema de Firestore.
  try { await auth.getUserByEmail(ADMIN.email); } catch { await auth.createUser({ ...ADMIN, emailVerified: true }); }
  console.log(`✔ Administrador (emulador): ${ADMIN.email} / ${ADMIN.password}`);

  const existing = await db.collection('songs').limit(1).get();
  if (!existing.empty) {
    console.log('• Ya hay canciones en el emulador: no se duplican.');
  } else {
    const songs = JSON.parse(await readFile(path.join(ROOT, 'songs.json'), 'utf8'));
    for (const s of songs) {
      await db.collection('songs').add({
        number: s.numero,
        title: s.titulo,
        artist: s.autor || '',
        key: keyName(s.tono),
        category: s.categoria || '',
        tags: s.tags || [],
        lyricsText: s.letraTexto || '',
        pdfLinks: { lyrics: s.letra || '', chords: s.acordes || '', score: s.partitura || '' },
        audioUrl: s.audioUrl || '',
        bpm: s.bpm ?? null,
        timeSignature: s.compas || '',
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`✔ #${s.numero} ${s.titulo}`);
    }
  }
  console.log('\nListo. En config.js: BACKEND: \'firebase\' y FIREBASE_EMULATORS.enabled: true');
  process.exit(0);
} catch (err) {
  console.error('\n✖ No se pudieron cargar los datos. ¿Están los emuladores en marcha? (npm run emulators)\n', err.message);
  process.exit(1);
}
