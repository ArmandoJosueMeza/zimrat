# Zimrat — Cancionero para músicos y directores de alabanza

**Zimrat** (del hebreo *zimrat*, «canto, alabanza») es una aplicación web progresiva (PWA) para PC, tableta y teléfono.

**Para todo el público, sin login:**
- búsqueda instantánea por número, título, autor o **frases de la letra**;
- **3 PDFs por canción** (Letra, Acordes y Partitura) mostrados con **PDF.js**, con **modo presentación** y **alto contraste**;
- **metrónomo** con Web Audio;
- **repertorios personales** guardados en el propio navegador;
- historial de canciones vistas y tema claro/oscuro;
- funciona **sin conexión**.

- **buzón de sugerencias y reportes** (botón «💬 Sugerencias»).

**Para el administrador** (`zimratapp@gmail.com`):
- crear, editar y borrar canciones en Firestore, con los **PDFs subidos desde el dispositivo a Cloudinary**;
- **monitor de conexión** con Firebase en tiempo real;
- **registro de errores** del sistema;
- lectura del buzón de sugerencias.

Versión actual: **v7.2**. Se muestra al pie de la página y en el panel.

---

## 1. Ponerla en marcha

1. Abre una consola **dentro de la carpeta** y ejecuta solo esta línea:
   ```
   python -m http.server 8000
   ```
2. Abre **http://localhost:8000**. Si ves una versión anterior: **Ctrl + Shift + R**.

`config.js` ya trae la configuración de tu proyecto Firebase «zimrat» (`BACKEND: 'firebase'`). Para que funcione, completa **una sola vez** los pasos del apartado 3.

Para probar sin Firebase, pon `BACKEND: 'demo'`: todo se simula en el navegador, con canciones de ejemplo y el admin `admin@zimrat.app` / `admin123`.

---

## 2. Estructura

```
zimrat/
├── index.html · styles.css · app.js     Contenedor, diseño (claro/oscuro, responsive) y rutas
├── config.js                            ⚙️ Firebase, Cloudinary, ADMIN_EMAIL, demo/firebase
├── manifest.json · sw.js                PWA (instalación y modo sin conexión)
├── firestore.rules                      🔒 Seguridad de la base de datos
├── firebase.json · .firebaserc          Proyecto «zimrat» (reglas, hosting, emuladores)
├── package.json · tools/seed-emulators.mjs   Emuladores locales y datos de prueba
├── lib/                                 PDF.js 3.11 (visor)
├── icons/ · pdfs/ · songs.json · setlists.json   Logo y datos de ejemplo
└── js/
    ├── firebase/
    │   ├── init.js          initializeApp + Analytics (SDK 11.0.1 desde gstatic)
    │   └── auth.js          loginAdmin · logoutAdmin · listenAuthState
    ├── services/
    │   ├── firebase-backend.js   Firestore «songs» (tu esquema) ↔ modelo de la app
    │   ├── demo-backend.js       Simulación local (IndexedDB)
    │   ├── backend.js            Elige uno de los dos + copia sin conexión
    │   ├── cloudinary.js         Validación estricta de PDF + subida a Cloudinary
    │   ├── logger.js             Registro de errores (Firestore «errorLogs», cola sin conexión)
    │   ├── setlists.js           Repertorios LOCALES (localStorage) + exportar/importar
    │   ├── metronome.js          Motor del metrónomo (Web Audio API)
    │   ├── offline.js · recent.js · pdf-text.js · theme.js
    ├── components/          Interfaz: SongList, SongDetail, PdfViewer, Metronome,
    │                        SetlistView/Form/Nav, AdminPanel, SongForm, LoginModal,
    │                        FeedbackModal (buzón de sugerencias)…
    ├── store.js · utils.js
```

**Sobre los estilos:** el CSS está escrito a mano, con variables para el tema claro/oscuro y sin paso de compilación. Con Tailwind habría que compilarlo para producción (el CDN de Tailwind no se recomienda en producción y no funciona sin conexión), y esto mantiene la app ligera y 100 % offline.

---

## 3. Configurar Firebase (una sola vez)

En https://console.firebase.google.com → proyecto **zimrat**:

1. **Authentication → Método de acceso → Correo electrónico/contraseña → Habilitar.**
   Después, en *Usuarios → Agregar usuario*, crea `zimratapp@gmail.com` con una contraseña segura. Esa es la que usarás en la app.
2. **Firestore Database → Crear base de datos** en *modo producción*. Elige una región cercana (p. ej. `us-east1`). Las canciones se crean desde el panel de la app, así que la colección `songs` puede estar vacía.
3. **Publica las reglas de seguridad** (`firestore.rules`). Elige una de estas dos formas:
   - **Desde la consola:** *Firestore → Reglas*, pega el contenido de `firestore.rules` y pulsa **Publicar**.
   - **Con la CLI** (requiere Node.js 22+):
     ```
     npx firebase-tools login
     npx firebase-tools deploy --only firestore:rules
     ```
4. **Recomendado:** *Authentication → Configuración → Acciones del usuario* → desactiva **Habilitar creación (registro)**, para que nadie pueda crearse cuentas.
5. **Recomendado:** en *Google Cloud Console → APIs y servicios → Credenciales*, restringe la clave `apiKey` a tus dominios (localhost, tu-sitio.web.app…).

**¿Por qué el admin es solo `zimratapp@gmail.com`?** El ejemplo original usaba `isAdmin = !!user`, que daría permisos a **cualquier** cuenta que lograra iniciar sesión. Ahora hay dos controles:
- **En la app:** `auth.js` solo considera administrador a `config.ADMIN_EMAIL`.
- **En el servidor:** `firestore.rules` solo deja escribir a ese correo. Esto protege aunque alguien modifique el código del navegador.

**Sobre la clave `apiKey`:** es pública por diseño (siempre va en el navegador). No da acceso a nada por sí sola; la protección real son las reglas.

**SDK:** todos los módulos (app, auth, firestore con `onSnapshot`, analytics) se cargan desde `https://www.gstatic.com/firebasejs/11.0.1/…`.
- No se mezclan versiones: mezclar, por ejemplo, app 11.0.1 con auth 10.8.0 rompe Firebase («Component auth has not been registered yet»).

> ⚠️ **Si actualizas desde la v6, vuelve a publicar `firestore.rules`.** Las reglas nuevas añaden las colecciones `feedback` y `errorLogs`. Con las reglas antiguas, el buzón y el registro de errores reciben «permiso denegado».

**Analytics:** se activa en tu sitio publicado y se omite en `localhost`. Si un bloqueador de anuncios lo impide, la app sigue funcionando.

---

## 4. PDFs en Cloudinary

Google Drive se eliminó por completo. Los PDFs se eligen **desde el dispositivo** (PC, tableta o teléfono) y se suben directamente a **Cloudinary** desde el navegador, sin servidor propio. En Firestore se guarda la URL segura `https://res.cloudinary.com/…`.

**Configuración** (`config.js`):
```js
CLOUDINARY: { cloudName: 'rszi2qgm', uploadPreset: 'zimrat_preset' },
```
- **Cloud name:** `rszi2qgm`, con **q**, tal como aparece en tu panel de Cloudinary. En el mensaje se escribió `rszi2ggm`, que daría error 404. Si tu panel muestra otro nombre, cámbialo aquí.
- **Endpoint:** se usa `https://api.cloudinary.com/v1_1/rszi2qgm/auto/upload`. Con `/auto/upload`, Cloudinary detecta que es un PDF y permite verlo con PDF.js. También funcionaría `/image/upload`; **no** uses `/raw/upload`.

**Preset `zimrat_preset`** (*Settings → Upload → Upload presets*):
1. **Signing mode: Unsigned** (ya lo tienes).
2. **Recomendado:**
   - *Allowed formats* = `pdf`, para que el servidor también rechace lo que no sea PDF;
   - *Folder* = `zimrat`;
   - *Max file size* = 10 MB.

**Entrega de PDFs:** en *Settings → Security*, activa **«Allow delivery of PDF and ZIP files»** (ya lo hiciste). Sin esa opción, Cloudinary responde **401** y el visor lo indica.

**Validación estricta antes de subir.** Un archivo solo se acepta si cumple las tres condiciones:
1. tipo MIME exactamente `application/pdf`;
2. extensión `.pdf`;
3. el contenido empieza por `%PDF-`, la firma real de un PDF. Esto detecta, por ejemplo, un `.docx` renombrado a `.pdf`.

También debe pesar **10 MB como máximo** (límite del plan gratuito).

Si no cumple, la casilla se pone **en rojo** y muestra el motivo. Además, aparece un aviso, el archivo se rechaza y se conserva el PDF anterior. Al guardar se valida otra vez, y se ve una **barra de progreso** por cada PDF que se sube.

**Canciones antiguas con enlaces de Drive:** el visor avisa de que el enlace es antiguo. Edita la canción y sube el PDF de nuevo.

> El preset sin firma permite que cualquiera que lea el código suba archivos a tu cuenta. Por eso se recomienda limitar el preset a `pdf` y a 10 MB.

**Qué pasa con los PDFs al eliminar o reemplazar**

Con un preset *unsigned*, el navegador puede **subir** archivos, pero no **borrarlos**. Borrar exige una petición firmada con el *API Secret*, y ese secreto nunca debe estar en el código de una web pública: quien lo leyera podría borrar toda tu cuenta. Por eso Zimrat hace esto:

| Situación | Qué hace la app |
|---|---|
| Eliminas una canción | Borra el documento de Firestore (desaparece al instante en todos los dispositivos) y apunta sus PDFs en la colección `cloudinaryTrash`. |
| Reemplazas o quitas un PDF | Guarda la canción con el PDF nuevo y apunta el anterior en `cloudinaryTrash`. |
| La subida funciona pero falla el guardado en Firestore | Deshace la subida con el `delete_token`, si el preset tiene **Return delete token** activado (válido 10 min). Si no lo tiene, la apunta en la lista. |

En **Panel → Archivos Cloudinary** ves esa lista, con el ID de cada archivo.
1. Abre la *Media Library* y busca el ID (botón «Copiar ID»).
2. Elimina el archivo.
3. Pulsa **Ya lo borré**.

Así la cuenta gratuita no se llena de archivos sin uso.

- **Recomendado:** en el preset `zimrat_preset`, activa **Return delete token**.
- **Si algún día activas el plan Blaze de Firebase:** una Cloud Function con el *API Secret* podría vaciar `cloudinaryTrash` automáticamente.

---

## 4b. Monitor de conexión, registro de errores y sugerencias

**Monitor de conexión** (Panel, arriba, y un indicador en la barra superior):
- **🟢 «Conectado a Firebase»**, con la latencia en ms;
- **🔴 «Error de conexión»**, con el motivo: sin internet, reglas que niegan la lectura, tiempo agotado…

La comprobación consulta el **servidor** de Firestore, no la caché. Se repite cada `CONNECTION_CHECK_SECONDS` (30 s), al recuperar la conexión y al volver a la pestaña. También puedes pulsar **Verificar ahora**.

**Registro de errores** (Panel → *Registro de errores*, solo admin):
- **Qué se registra:** fallos de red, de Cloudinary (subidas), de Firestore, de PDFs, del login y errores de JavaScript, ocurridos en **cualquier** dispositivo.
- **Dónde se guarda:** en la colección `errorLogs`.
- **Sin conexión:** los errores esperan en el dispositivo y se envían al volver internet.
- **Límites:** máximo 25 por visita y sin duplicados.
- **En el panel:** puedes filtrar por origen, ver detalles, borrar uno, vaciar los filtrados o vaciar todo.
- **Borrado real:** se borra en Firestore con `deleteDoc(doc(db, 'errorLogs', id))`, o con un lote si son varios. Funciona igual que en el buzón: sin confirmación del servidor, no desaparece de la lista.

**Buzón de sugerencias** (botón flotante **💬 Sugerencias**, para todos y sin login):
- **Tipos:** sugerencia, error o comentario, con la canción relacionada opcional.
- **Dónde se guarda:** en la colección `feedback`.
- **Lectura:** el admin lo ve en Panel → *Sugerencias*, puede marcarlo como leído o borrarlo, y el botón «Panel» muestra cuántos mensajes hay sin leer.
- **Borrado real:** al eliminar un mensaje (o «Eliminar leídas»), se borra el documento en Firestore con `deleteDoc(doc(db, 'feedback', id))`, o con un lote si son varios. El mensaje solo desaparece de la lista cuando el servidor confirma el borrado. Si falla (sin conexión o sin permiso), sigue en la lista y aparece un aviso.
- **Anti-spam:** un campo trampa invisible y 60 s de espera entre envíos. Las reglas validan tipos y longitudes.

---

## 5. Repertorios locales (para todos, sin login)

- Cualquier usuario crea, edita, reordena y borra sus repertorios desde el inicio, en **Mis repertorios → Nuevo repertorio**.
- Se guardan en `localStorage` (clave `zimrat-repertorios`): son **privados de ese navegador** y no tocan Firestore ni a otros usuarios.
- **Exportar / Importar:** en la página del repertorio, **Exportar** descarga un archivo `.zimrat.json`. En otro dispositivo, usa **Inicio → Mis repertorios → Importar**. Sirve para copias de seguridad o para que el director comparta el repertorio con el equipo.
- Si el administrador borra una canción, desaparece de los repertorios.
- Al recorrer un repertorio (**Empezar**), puedes pasar de una canción a otra con ◀ ▶, también desde el visor y en modo presentación.

---

## 6. Visor, metrónomo y PWA

- **PDF.js:** dibuja cada página en un `<canvas>` solo cuando se acerca a la pantalla, con nitidez retina. La impresión sale a unos 180 ppp y siempre en colores normales.
- **Modo presentación** (botón o tecla `F`): oculta todo menos la partitura. Los controles flotantes se ocultan solos y vuelven al tocar la pantalla.
- **Alto contraste** (botón ◐ o tecla `C`): fondo negro puro y texto blanco.
- **Metrónomo:**
  - Programación anticipada sobre el reloj de audio: clic agudo de 1760 Hz en el tiempo 1 y grave de 880 Hz en el resto.
  - BPM entre 30 y 300, con +/−, deslizador o Tap. Compases 2/4, 3/4, 4/4, 5/4, 6/8 y 12/8.
  - Pulso visual sincronizado con el sonido.
  - En iPhone no suena con el interruptor de silencio activado.
- **Sin conexión:**

  | Qué | Dónde se guarda |
  |---|---|
  | Código de la app | Caché `zimrat-v6` |
  | SDK de Firebase | Caché `zimrat-sdk` |
  | Canciones | Caché propia de Firestore + copia `zimrat-data` |
  | PDFs abiertos | Caché de recientes (últimos 30) |
  | PDFs de un repertorio | **Guardar sin conexión**, en su página |

  En el teléfono requiere **https** (publicar). Guardar cambios requiere conexión.

---

## 7. Esquema en Firestore (colección `songs`)

```json
{
  "number": 1, "title": "Santo, Santo, Santo", "artist": "Ministerio de Alabanza",
  "key": "Re Mayor", "category": "Adoración", "tags": ["solemne", "comunión"],
  "lyricsText": "Santo, santo, santo…",
  "pdfLinks": { "lyrics": "https://res.cloudinary.com/rszi2qgm/image/upload/v1730000000/zimrat/abc.pdf", "chords": "…", "score": "" },
  "bpm": 72, "timeSignature": "4/4",
  "audioUrl": "https://www.youtube.com/watch?v=…",
  "updatedAt": "<fecha del servidor>"
}
```
- **`key`** se guarda en español («Re Mayor», «Si menor», «Fa# menor») y la app lo interpreta para mostrar «D», «Bm» o «F♯m». Si escribes un tono a mano en la consola, la app lo lee igual.
- **`audioUrl`** es opcional: un enlace de YouTube que se muestra integrado en la ficha.
- **El número de orden no se puede repetir.** La app lo comprueba antes de guardar.

---

## 8. Probar Firebase en tu PC (emuladores, opcional)

Requisitos: **Node.js 22+** y **Java 21**.
```
npm install                 # 1ª vez
npm run emulators           # consola 1: Auth :9099 · Firestore :8080 · UI :4000
npm run seed                # consola 2: admin zimratapp@gmail.com / admin123 (solo emulador) + canciones
python -m http.server 8000  # consola 3
```
En `config.js`, pon `FIREBASE_EMULATORS.enabled: true`. Los emuladores usan el proyecto ficticio `demo-zimrat` y nunca tocan tus datos reales.

## 9. Publicar
- **Firebase Hosting** (gratis): `npx firebase-tools deploy --only hosting,firestore:rules` → `https://zimrat.web.app`
- O arrastra la carpeta a Netlify o Vercel.

Añade el dominio publicado a las restricciones de tus claves de API. Al publicar cambios de código, sube `VERSION` en `sw.js` y `APP_VERSION` en `config.js`.

## 10. Historial de versiones
- **v7.2:** borrado real en Firestore de sugerencias y registros de errores (uno, «Eliminar leídas», «Vaciar filtrados» o «Vaciar todo»), con confirmación del servidor, aviso si falla y listas leídas del servidor.
- **v7.1:**
  - el formulario de canción ya no se desborda ni se recorta al elegir PDFs (nombres largos, alertas);
  - nunca se muestra «null» en la ficha ni en las listas;
  - gestión del ciclo de vida de los PDFs en Cloudinary (lista de archivos huérfanos y deshacer subidas fallidas).
- **v7.0:**
  - PDFs en **Cloudinary** con validación estricta y barra de progreso (Google Drive eliminado);
  - SDK de Firebase **11.0.1** con tiempo real (`onSnapshot`);
  - monitor de conexión, registro de errores y buzón de sugerencias;
  - número de versión visible.
- **v6.0:** proyecto Firebase real, esquema `songs` con `pdfLinks`, repertorios locales para todos y PDFs enlazados desde Drive.
- **v5.0:** marca Zimrat, Firebase (Auth/Firestore/Storage) y emuladores.
