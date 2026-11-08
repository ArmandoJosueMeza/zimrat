-- =========================================================
-- schema.sql — Ejecuta TODO este archivo en Supabase:
--   Supabase → SQL Editor → New query → pegar → Run
-- Se puede ejecutar varias veces sin romper nada.
-- =========================================================

-- 1) Tabla de canciones ------------------------------------
create table if not exists public.songs (
  id              uuid primary key default gen_random_uuid(),
  numero          integer not null unique check (numero > 0),
  titulo          text    not null check (char_length(titulo) between 1 and 200),
  autor           text,
  tono            text,
  categoria       text,
  tags            text[]  not null default '{}',
  letra_texto     text,              -- letra en texto plano (para buscar por frases)
  audio_url       text check (audio_url is null or audio_url ~* '^https?://'),
  bpm             integer check (bpm is null or bpm between 30 and 300),
  compas          text    check (compas is null or compas in ('2/4','3/4','4/4','5/4','6/8','12/8')),
  letra_path      text,
  acordes_path    text,
  partitura_path  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Si ya tenías la tabla de la versión anterior, añade las columnas nuevas:
alter table public.songs add column if not exists autor       text;
alter table public.songs add column if not exists tono        text;
alter table public.songs add column if not exists categoria   text;
alter table public.songs add column if not exists tags        text[] not null default '{}';
alter table public.songs add column if not exists letra_texto text;
alter table public.songs add column if not exists audio_url   text;
alter table public.songs add column if not exists bpm         integer;
alter table public.songs add column if not exists compas      text;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists songs_updated_at on public.songs;
create trigger songs_updated_at before update on public.songs
for each row execute function public.touch_updated_at();

-- 2) Lista de administradores -------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;  -- sin políticas: nadie la lee desde la web

-- ¿El usuario conectado es administrador?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 3) Reglas de seguridad (RLS) de canciones -----------------
alter table public.songs enable row level security;

drop policy if exists "songs: lectura publica" on public.songs;
create policy "songs: lectura publica" on public.songs
  for select using (true);

drop policy if exists "songs: admin crea" on public.songs;
create policy "songs: admin crea" on public.songs
  for insert to authenticated with check (public.is_admin());

drop policy if exists "songs: admin edita" on public.songs;
create policy "songs: admin edita" on public.songs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "songs: admin borra" on public.songs;
create policy "songs: admin borra" on public.songs
  for delete to authenticated using (public.is_admin());

-- 4) Bucket de PDFs (lectura pública, máx. 50 MB, solo PDF) --
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', true, 52428800, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

drop policy if exists "pdfs: lectura publica" on storage.objects;
create policy "pdfs: lectura publica" on storage.objects
  for select using (bucket_id = 'pdfs');

drop policy if exists "pdfs: admin sube" on storage.objects;
create policy "pdfs: admin sube" on storage.objects
  for insert to authenticated with check (bucket_id = 'pdfs' and public.is_admin());

drop policy if exists "pdfs: admin modifica" on storage.objects;
create policy "pdfs: admin modifica" on storage.objects
  for update to authenticated using (bucket_id = 'pdfs' and public.is_admin());

drop policy if exists "pdfs: admin borra" on storage.objects;
create policy "pdfs: admin borra" on storage.objects
  for delete to authenticated using (bucket_id = 'pdfs' and public.is_admin());

-- 5) Repertorios (setlists) --------------------------------
create table if not exists public.setlists (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (char_length(nombre) between 1 and 120),
  fecha       date,
  notas       text,
  song_ids    uuid[] not null default '{}',   -- canciones en orden
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists setlists_updated_at on public.setlists;
create trigger setlists_updated_at before update on public.setlists
for each row execute function public.touch_updated_at();

alter table public.setlists enable row level security;

drop policy if exists "setlists: lectura publica" on public.setlists;
create policy "setlists: lectura publica" on public.setlists for select using (true);

drop policy if exists "setlists: admin crea" on public.setlists;
create policy "setlists: admin crea" on public.setlists
  for insert to authenticated with check (public.is_admin());

drop policy if exists "setlists: admin edita" on public.setlists;
create policy "setlists: admin edita" on public.setlists
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "setlists: admin borra" on public.setlists;
create policy "setlists: admin borra" on public.setlists
  for delete to authenticated using (public.is_admin());

-- Al borrar una canción, se quita de todos los repertorios
create or replace function public.remove_song_from_setlists()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.setlists set song_ids = array_remove(song_ids, old.id) where old.id = any(song_ids);
  return old;
end $$;

drop trigger if exists songs_remove_from_setlists on public.songs;
create trigger songs_remove_from_setlists after delete on public.songs
for each row execute function public.remove_song_from_setlists();

-- =========================================================
-- 6) DAR PERMISO DE ADMINISTRADOR (ejecutar después de crear el usuario
--    en Authentication → Users → Add user). Cambia el correo:
--
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'tu-correo@ejemplo.com'
-- on conflict do nothing;
-- =========================================================
