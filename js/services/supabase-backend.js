/* =========================================================
   supabase-backend.js — MODO NUBE (login real)
   - Base de datos: tabla public.songs
   - Archivos: bucket de Storage (lectura pública)
   - Login: Supabase Auth (correo + contraseña)
   - Seguridad: las reglas RLS de supabase/schema.sql impiden que
     alguien que no esté en la tabla public.admins cree, edite o borre,
     aunque modifique el código del navegador.
   ========================================================= */
import { FORMAT_KEYS, uid, normalizeSong, normalizeSetlist } from '../utils.js';

// Campo en la app → columna en la base de datos
const COLUMNS = {
  numero: 'numero', titulo: 'titulo', autor: 'autor', tono: 'tono', categoria: 'categoria',
  tags: 'tags', letraTexto: 'letra_texto', audioUrl: 'audio_url', bpm: 'bpm', compas: 'compas',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.append(s);
  });
}

const AUTH_ERRORS = {
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Debes confirmar el correo antes de entrar.',
};

export async function createBackend(config) {
  if (!window.supabase) await loadScript('lib/supabase.js');
  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const bucket = config.SUPABASE_BUCKET || 'pdfs';
  const storage = () => client.storage.from(bucket);
  const col = (key) => `${key}_path`;

  const listeners = new Set();
  let session = null;
  const setSession = (s) => { session = s; listeners.forEach((fn) => fn(s)); };

  async function isAdmin() {
    const { data, error } = await client.rpc('is_admin');
    return !error && data === true;
  }

  // Restaura la sesión guardada (si sigue siendo admin)
  const { data: initial } = await client.auth.getSession();
  if (initial.session && (await isAdmin())) session = { email: initial.session.user.email };

  // Si el token caduca o se cierra sesión en otra pestaña
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && session) setTimeout(() => setSession(null), 0);
  });

  const publicUrl = (path) => (path ? storage().getPublicUrl(path).data.publicUrl : null);

  async function getRow(id) {
    const { data, error } = await client.from('songs').select('*').eq('id', id).single();
    if (error) throw new Error('No se encontró la canción.');
    return data;
  }

  return {
    mode: 'supabase',

    async listSongs() {
      const { data, error } = await client.from('songs').select('*');
      if (error) throw new Error(`No se pudieron cargar las canciones: ${error.message}`);
      return data.map((r) => {
        const song = { id: r.id };
        for (const [field, column] of Object.entries(COLUMNS)) song[field] = r[column];
        for (const key of FORMAT_KEYS) song[key] = publicUrl(r[col(key)]);
        return normalizeSong(song);
      });
    },

    async getPdfBlob(ref) {
      const res = await fetch(ref);
      if (!res.ok) throw new Error(`No se pudo descargar el PDF (${res.status}).`);
      return res.blob();
    },

    getSession: () => session,
    onAuthChange: (fn) => listeners.add(fn),

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(AUTH_ERRORS[error.message] || error.message);
      if (!(await isAdmin())) {
        await client.auth.signOut();
        throw new Error('Esta cuenta no tiene permisos de administrador.');
      }
      setSession({ email });
      return session;
    },

    async signOut() {
      await client.auth.signOut();
      setSession(null);
    },

    async saveSong(data, { files = {}, remove = {} } = {}) {
      if (!session) throw new Error('Debes iniciar sesión como administrador.');
      const id = data.id || uid();
      const existing = data.id ? await getRow(data.id) : null;
      const row = {};
      for (const [field, column] of Object.entries(COLUMNS)) row[column] = data[field] === '' ? null : data[field];
      const uploaded = [];
      const toDelete = [];

      try {
        for (const key of FORMAT_KEYS) {
          const oldPath = existing?.[col(key)];
          if (files[key]) {
            // Ruta nueva en cada subida → evita PDFs viejos en caché
            const path = `${id}/${key}-${Date.now()}.pdf`;
            const { error } = await storage().upload(path, files[key], { contentType: 'application/pdf', upsert: false });
            if (error) throw new Error(`Error al subir ${key}: ${error.message}`);
            uploaded.push(path);
            row[col(key)] = path;
            if (oldPath) toDelete.push(oldPath);
          } else if (remove[key]) {
            row[col(key)] = null;
            if (oldPath) toDelete.push(oldPath);
          }
        }

        const query = existing
          ? client.from('songs').update(row).eq('id', id)
          : client.from('songs').insert({ id, ...row });
        const { error } = await query;
        if (error) {
          if (error.code === '23505') throw new Error(`El número ${data.numero} ya está en uso.`);
          throw new Error(error.message);
        }
      } catch (err) {
        if (uploaded.length) await storage().remove(uploaded); // deshace subidas
        throw err;
      }

      if (toDelete.length) await storage().remove(toDelete);
    },

    async deleteSong(song) {
      if (!session) throw new Error('Debes iniciar sesión como administrador.');
      const row = await getRow(song.id);
      const { error } = await client.from('songs').delete().eq('id', song.id);
      if (error) throw new Error(error.message);
      const paths = FORMAT_KEYS.map((k) => row[col(k)]).filter(Boolean);
      if (paths.length) await storage().remove(paths);
      // (un trigger de schema.sql la quita también de los repertorios)
    },

    /* ----- Repertorios (tabla public.setlists) ----- */
    async listSetlists() {
      const { data, error } = await client.from('setlists').select('*').order('fecha', { ascending: true, nullsFirst: false });
      if (error) throw new Error(`No se pudieron cargar los repertorios: ${error.message}`);
      return data.map((r) => normalizeSetlist({ id: r.id, nombre: r.nombre, fecha: r.fecha, notas: r.notas, songIds: r.song_ids }));
    },

    async saveSetlist(data) {
      if (!session) throw new Error('Debes iniciar sesión como administrador.');
      const list = normalizeSetlist({ ...data, id: data.id || uid() });
      const row = { id: list.id, nombre: list.nombre, fecha: list.fecha || null, notas: list.notas || null, song_ids: list.songIds };
      const { error } = await client.from('setlists').upsert(row);
      if (error) throw new Error(error.message);
      return list;
    },

    async deleteSetlist(id) {
      if (!session) throw new Error('Debes iniciar sesión como administrador.');
      const { error } = await client.from('setlists').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  };
}
