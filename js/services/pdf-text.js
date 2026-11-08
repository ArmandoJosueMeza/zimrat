/* =========================================================
   pdf-text.js — Extrae el texto de un PDF (para la búsqueda por letra)
   Funciona con PDFs generados por Word, MuseScore, etc.
   Los PDFs escaneados (imágenes) no tienen texto: escribe la letra a mano.
   ========================================================= */
// PDF.js se cargó en index.html como script clásico y dejó la variable
// global window.pdfjsLib; aquí la recogemos para usarla en este módulo.
const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];

// 1) getDocument({ data }) abre el PDF a partir de sus bytes (ArrayBuffer).
// 2) Para cada página, getTextContent() devuelve los trozos de texto
//    (items) con su posición; hasEOL indica fin de línea.
// 3) Se unen los trozos respetando saltos de línea y espacios.
// 4) finally { pdf.destroy() } libera la memoria aunque haya error.
// 5) Al final se limpian espacios dobles y líneas vacías repetidas.
// El texto resultante se guarda en «lyricsText» para buscar por frases.
export async function extractPdfText(blob) {
  const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let text = '';
      for (const item of content.items) {
        text += item.str;
        text += item.hasEOL ? '\n' : (item.str && !item.str.endsWith(' ') ? ' ' : '');
      }
      pages.push(text);
    }
  } finally {
    pdf.destroy();
  }
  return pages.join('\n\n')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
