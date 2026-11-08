/* =========================================================
   SongList.js — Vista pública
   - Buscador inteligente: número, título, autor, etiquetas y FRASES DE LA LETRA
   - Filtros rápidos por categoría y etiqueta
   - Lista A-Z agrupada por letra, con tono visible
   - Inicio: «Vistas recientemente» y «Repertorios»
   ========================================================= */
import config from '../../config.js';
import { store } from '../store.js';
import { el, icon, norm, searchSongs, prettyKey, formatDate, FORMATS, toast, setChildren } from '../utils.js';
import { clearRecent } from '../services/recent.js';
import { openSetlistForm } from './SetlistForm.js';

// PANTALLA DE INICIO: buscador, recientes, «Mis repertorios», filtros de
// categoría/etiqueta y la lista de canciones (A-Z).
// La búsqueda es instantánea: cada tecla guarda el texto en el store
// (store.set({ query })) y render() vuelve a filtrar la lista.
export function SongList(ctx) {
  const input = el('input', {
    type: 'search', placeholder: 'Título, número o frase de la letra…', 'aria-label': 'Buscar canción',
    autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false',
  });
  const clearBtn = el('button', { class: 'search-clear', type: 'button', 'aria-label': 'Borrar búsqueda', html: icon('close'), hidden: true });
  const filters = el('div', { class: 'filters', role: 'toolbar', 'aria-label': 'Filtrar por categoría' });
  const home = el('div', { class: 'home-sections' });
  const count = el('p', { class: 'list-count', 'aria-live': 'polite' });
  const list = el('div', { class: 'song-list' });
  const empty = el('div', { class: 'empty', hidden: true });

  // Evento 'input': se dispara con cada tecla (también al pegar o dictar).
  input.addEventListener('input', () => store.set({ query: input.value }));
  clearBtn.addEventListener('click', () => { input.value = ''; store.set({ query: '' }); input.focus(); });

  const heroStats = el('p', { class: 'hero-stats' });
  const hero = el('header', { class: 'hero' },
    el('img', { class: 'hero-logo', src: 'icons/icon.svg', alt: '', width: '56', height: '56' }),
    el('div', {},
      el('h1', { class: 'hero-title', text: config.APP_NAME }),
      el('p', { class: 'hero-tagline', text: 'Letras, acordes y partituras para alabar con cada nota.' }),
      heroStats));

  const view = el('section', { class: 'view container', 'aria-label': 'Lista de canciones' },
    hero,
    el('div', { class: 'search-wrap' },
      el('div', { class: 'search' }, el('span', { class: 'search-ico', html: icon('search') }), input, clearBtn),
      filters),
    home, count, list, empty);

  /* ----- Inicio: recientes y repertorios ----- */
  // Bloques de inicio (solo sin búsqueda activa): canciones vistas hace poco
  // (recent.js) y repertorios locales (setlists.js) con «Nuevo» e «Importar».
  function renderHome({ songs, setlists, recent, query, category, tag, loading }) {
    if (loading || query || category || tag) { home.hidden = true; return; }
    const byId = new Map(songs.map((s) => [s.id, s]));
    const recents = recent.map((id) => byId.get(id)).filter(Boolean).slice(0, config.RECENT_COUNT);
    const sections = [];

    if (recents.length) {
      sections.push(el('section', { class: 'home-block', 'aria-label': 'Vistas recientemente' },
        el('div', { class: 'block-head' },
          el('h2', { html: `${icon('history')}<span>Vistas recientemente</span>` }),
          el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Borrar', onclick: () => store.set({ recent: clearRecent() }) })),
        el('div', { class: 'h-scroll' }, ...recents.map((song) => el('button', {
          class: 'mini-card', type: 'button', 'aria-label': `Canción ${song.numero}: ${song.titulo}`,
          onclick: () => ctx.go(`#/c/${song.numero}`),
        },
          el('span', { class: 'mini-num', text: `#${song.numero}` }),
          el('span', { class: 'mini-title', text: song.titulo }),
          el('span', { class: 'mini-meta', text: [song.tono && prettyKey(song.tono), song.bpm && `${song.bpm} BPM`].filter(Boolean).join(' · ') || ' ' }))))));
    }

    // Mis repertorios (locales): siempre visible, con «Nuevo» e «Importar»
    const sorted = [...setlists].sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999') || a.nombre.localeCompare(b.nombre, 'es'));
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
    // Importar repertorio: lee el archivo elegido con file.text() y lo pasa a
    // ctx.setlists.importJson (valida y reconoce las canciones).
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0];
      importInput.value = '';
      if (!file) return;
      try { toast(`${ctx.setlists.importJson(await file.text())} repertorio(s) importado(s)`, 'success'); } catch (err) { toast(err.message, 'error'); }
    });
    sections.push(el('section', { class: 'home-block', 'aria-label': 'Mis repertorios' },
      el('div', { class: 'block-head' },
        el('h2', { html: `${icon('setlist')}<span>Mis repertorios</span>` }),
        el('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Abrir un archivo .zimrat.json exportado', html: `${icon('upload')}<span>Importar</span>`, onclick: () => importInput.click() }),
        importInput),
      el('div', { class: 'h-scroll' },
        el('button', { class: 'mini-card new-setlist-card', type: 'button', onclick: () => openSetlistForm(ctx) },
          el('span', { class: 'new-plus', html: icon('plus') }),
          el('span', { class: 'mini-title', text: 'Nuevo repertorio' }),
          el('span', { class: 'mini-meta', text: 'En este dispositivo' })),
        ...sorted.map((list) => {
          const n = list.songIds.filter((id) => byId.has(id)).length;
          return el('button', { class: 'mini-card setlist-card', type: 'button', onclick: () => ctx.go(`#/r/${list.id}`) },
            el('span', { class: 'mini-title', text: list.nombre }),
            el('span', { class: 'mini-meta' }, el('span', { class: 'btn-ico', html: icon('calendar') }), el('span', { text: formatDate(list.fecha) || 'Sin fecha' })),
            el('span', { class: 'mini-count', text: `${n} ${n === 1 ? 'canción' : 'canciones'}` }));
        }))));

    setChildren(home, ...sections);
    home.hidden = !sections.length;
  }

  /* ----- Filtros de categoría / etiqueta ----- */
  // Botones de categoría generados a partir de las canciones existentes.
  function renderFilters({ songs, category, tag }) {
    const counts = new Map();
    for (const s of songs) if (s.categoria) counts.set(s.categoria, (counts.get(s.categoria) || 0) + 1);
    const cats = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    const chip = (label, active, onclick, extra = '') =>
      el('button', { class: `filter-chip ${active ? 'active' : ''} ${extra}`, type: 'button', 'aria-pressed': String(active), onclick }, label);

    const nodes = [];
    if (tag) {
      nodes.push(el('button', {
        class: 'filter-chip active tag-filter', type: 'button', 'aria-label': `Quitar filtro de etiqueta ${tag}`,
        html: `${icon('tag')}<span></span>${icon('close')}`, onclick: () => store.set({ tag: '' }),
      }));
      nodes.at(-1).querySelector('span').textContent = tag;
    }
    if (cats.length) {
      nodes.push(chip('Todas', !category, () => store.set({ category: '' })));
      for (const c of cats) nodes.push(chip(`${c} · ${counts.get(c)}`, category === c, () => store.set({ category: category === c ? '' : c })));
    }
    setChildren(filters, ...nodes);
    filters.hidden = !nodes.length;
  }

  /* ----- Tarjeta de canción ----- */
  // Tarjeta de cada resultado: número, título, autor, tono, chips de formatos
  // y, si se encontró por la letra, el fragmento con la frase resaltada (<mark>).
  function songCard({ song, snippet }) {
    const meta = [song.autor, song.categoria].filter(Boolean).join(' · ');
    const chips = el('span', { class: 'chips' }, ...FORMATS.map((f) =>
      el('span', { class: `chip chip-${f.key} ${song[f.key] ? '' : 'chip-off'}`, text: f.label, title: song[f.key] ? f.long : `${f.label}: no disponible` })));
    const snip = snippet
      ? el('span', { class: 'snippet' }, el('span', { html: icon('lyrics') }), el('span', {}, snippet.before, el('mark', { text: snippet.match }), snippet.after))
      : null;
    return el('button', {
      class: 'song', type: 'button', 'aria-label': `Canción ${song.numero}: ${song.titulo}${song.autor ? `, de ${song.autor}` : ''}${song.tono ? `, tono ${song.tono}` : ''}`,
      onclick: () => ctx.go(`#/c/${song.numero}`),
    },
      el('span', { class: 'song-num', text: song.numero }),
      el('span', { class: 'song-info' },
        el('span', { class: 'song-title', text: song.titulo }),
        meta ? el('span', { class: 'song-meta', text: meta }) : null,
        snip,
        chips),
      song.tono ? el('span', { class: 'key-badge', title: 'Tono', text: prettyKey(song.tono) }) : null,
      el('span', { class: 'song-chev', html: icon('chevron') }));
  }

  let last = {};
  // render(): se ejecuta en cada cambio del store, pero sale enseguida si nada
  // de lo que muestra esta vista cambió (comparación con «last»).
  // Mientras carga, muestra tarjetas «esqueleto» (gris animado).
  function render(state) {
    const { songs, setlists, recent, query, category, tag, loading, error, session } = state;
    if (songs === last.songs && setlists === last.setlists && recent === last.recent && query === last.query && category === last.category && tag === last.tag && loading === last.loading) return;
    last = { songs, setlists, recent, query, category, tag, loading };
    renderHome(state);
    heroStats.textContent = loading ? '' : `${songs.length} ${songs.length === 1 ? 'canción' : 'canciones'} · ${setlists.length} ${setlists.length === 1 ? 'repertorio' : 'repertorios'}`;
    if (input.value !== query) input.value = query;
    clearBtn.hidden = !query;
    renderFilters(state);

    if (loading) {
      count.textContent = 'Cargando canciones…';
      setChildren(list, ...Array.from({ length: 6 }, () => el('div', { class: 'song skeleton', 'aria-hidden': 'true' })));
      empty.hidden = true;
      return;
    }

    const results = searchSongs(songs, query, { category, tag });
    const searching = Boolean(query);
    const nodes = [];
    let lastLetter = '';
    for (const r of results) {
      if (!searching) {
        const first = norm(r.song.titulo).charAt(0).toUpperCase();
        const letter = /[A-Z]/.test(first) ? first : '#';
        if (letter !== lastLetter) { nodes.push(el('h2', { class: 'letter', text: letter })); lastLetter = letter; }
      }
      nodes.push(songCard(r));
    }
    setChildren(list, ...nodes);

    const filtered = searching || category || tag;
    count.textContent = filtered
      ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'} de ${songs.length}`
      : `Todas las canciones · ${songs.length} · A-Z`;

    empty.hidden = results.length > 0;
    if (!results.length) {
      setChildren(empty, 
        el('div', { class: 'empty-ico', html: icon(error ? 'info' : 'music') }),
        el('p', { class: 'empty-title', text: error ? 'No se pudieron cargar las canciones' : songs.length ? (query ? `Sin resultados para «${query}»` : 'Ninguna canción con ese filtro') : 'Aún no hay canciones' }),
        el('p', { class: 'muted', text: error || (songs.length ? 'Prueba con otro título, el número (ej. 5) o una frase de la letra.' : session ? 'Añade la primera desde el Panel.' : 'Vuelve pronto.') }),
        (category || tag) ? el('button', { class: 'btn', type: 'button', text: 'Quitar filtros', onclick: () => store.set({ category: '', tag: '' }) }) : null);
    }
  }

  store.subscribe(render);
  render(store.get());
  return view;
}
