/* =========================================================
   MediaPlayer.js — Audio/video de referencia
   - YouTube: miniatura ligera; el reproductor se carga al pulsar
     (más rápido y sin cookies: youtube-nocookie.com)
   - Otras plataformas (Spotify, SoundCloud…): botón que abre el enlace
   ========================================================= */
import { el, icon, parseMediaUrl } from '../utils.js';

export function MediaPlayer(url, title) {
  const media = parseMediaUrl(url);
  if (!media) return null;

  if (media.type === 'link') {
    return el('section', { class: 'card media', 'aria-label': 'Audio de referencia' },
      el('div', { class: 'card-head' }, el('h2', { html: `${icon('music')}<span>Escuchar</span>` })),
      el('a', { class: 'btn btn-block', href: media.url, target: '_blank', rel: 'noopener noreferrer' },
        el('span', { class: 'btn-ico', html: icon('external') }),
        el('span', { text: `Escuchar en ${media.host}` })));
  }

  // Técnica «fachada»: primero se muestra solo la miniatura (una imagen de
  // pocos KB). El reproductor de YouTube (cientos de KB y cookies) se carga
  // únicamente si se pulsa reproducir. Ahorra datos en el móvil.
  const frame = el('div', { class: 'yt-frame' });
  const poster = el('button', { class: 'yt-poster', type: 'button', 'aria-label': `Reproducir video de ${title}` },
    el('img', { src: `https://i.ytimg.com/vi/${media.id}/hqdefault.jpg`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
    el('span', { class: 'yt-play', html: icon('play') }));
  poster.addEventListener('click', () => {
    frame.replaceChildren(el('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${media.id}?autoplay=1&rel=0&playsinline=1`,
      title: `Video: ${title}`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
    }));
  });
  frame.append(poster);

  return el('section', { class: 'card media', 'aria-label': 'Video de referencia' },
    el('div', { class: 'card-head' },
      el('h2', { html: `${icon('play')}<span>Escuchar original</span>` }),
      el('a', { class: 'btn btn-sm btn-ghost', href: media.url, target: '_blank', rel: 'noopener noreferrer', html: `${icon('external')}<span>YouTube</span>` })),
    frame);
}

