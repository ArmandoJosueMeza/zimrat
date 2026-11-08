# Zimrat — instrucciones para Claude

Zimrat es una PWA de cancionero digital para músicos (letras, acordes y partituras en PDF, metrónomo, repertorios). Repositorio: github.com/ArmandoJosueMeza/zimrat. Idioma de la interfaz, los comentarios y los mensajes: **español**.

## Arquitectura (no cambiarla sin pedirlo)
- **Sin frameworks ni compilación:** JavaScript «vanilla» con módulos ES que el navegador carga directamente. No añadir React, Tailwind, bundlers ni npm en el navegador.
- `index.html`: casi vacío. `app.js` arranca la app, define las rutas (`#/`, `#/c/5`, `#/c/5/acordes`, `#/r/<id>`, `#/admin`) y el contexto `ctx` que reciben los componentes.
- `js/store.js`: estado compartido (publicar/suscribir).
- `js/utils.js`: ayudantes: `el()` crea elementos, `setChildren()` evita que aparezca «null», búsqueda, iconos SVG y tonalidades.
- `js/components/`: interfaz. **Nunca** llama directamente a Firebase ni a Cloudinary; usa `ctx.backend`.
- `js/services/`: lógica. `backend.js` elige `firebase-backend.js` o `demo-backend.js` según `config.BACKEND`; los dos tienen la MISMA interfaz.
- `styles.css`: CSS a mano con variables (`:root` y `[data-theme="dark"]`), responsive hasta 360 px.
- `sw.js`: Service Worker (modo sin conexión).

## Servicios externos
- **Firebase:** SDK modular **11.0.1** desde gstatic, la misma versión en TODOS los imports. Colecciones: `songs`, `feedback`, `errorLogs`, `cloudinaryTrash`. Esquema de `songs` en inglés; `fromDoc` y `toDoc` traducen al modelo en español.
- **Administrador único:** `zimratapp@gmail.com`. Si cambia, cambiarlo en `config.js` Y en `firestore.rules`.
- **firestore.rules:** al tocar campos o colecciones, actualizar las reglas y avisar de que hay que publicarlas.
- **Cloudinary:** cloud name **`rszi2qgm`** (con «q»; «rszi2ggm» es un error de escritura habitual), preset unsigned `zimrat_preset`, endpoint `/auto/upload`. Validación estricta del PDF (`validatePdfFile`), máximo 10 MB. El navegador no puede borrar en Cloudinary: los PDFs sin uso se apuntan en `cloudinaryTrash`.

## Reglas de trabajo
- Mantener todas las funciones existentes: metrónomo (Web Audio), repertorios locales (localStorage), visor PDF.js, modo presentación, alto contraste, buzón, registro de errores, monitor de conexión, tema claro/oscuro, modo sin conexión y modo demo.
- Errores: usar `logError(origen, error, contexto)` de `js/services/logger.js`.
- Comentarios didácticos en español (el proyecto es también material de estudio).
- Al publicar cambios de código: subir `APP_VERSION` en `config.js` y `VERSION` en `sw.js`, y añadir la versión al historial del README.
- Si se añade un archivo JS nuevo, incluirlo en la lista `SHELL` de `sw.js`.
- Mensajes de commit en español con prefijo convencional: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.

## Probar en local
- `python -m http.server 8000` en la carpeta del proyecto → http://localhost:8000 (Ctrl + Shift + R si ves una versión vieja).
- Para probar sin tocar datos reales: `BACKEND: 'demo'` en `config.js` (admin demo: `admin@zimrat.app` / `admin123`). No subir ese cambio a GitHub.
- Revisar siempre en móvil (360–390 px) y en escritorio, en tema claro y oscuro.
