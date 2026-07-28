// Prototipo Frente E — exploración de la estructura real de un anexo .docx ya descargado.
// Solo lectura: imprime, en orden, cada run de texto y su w14:paraId, para ubicar
// exactamente qué párrafo hay que rellenar (y confirmar que las celdas "en blanco"
// de verdad no tienen ningún <w:r> adentro).
import JSZip from 'jszip';
import { readFileSync } from 'fs';

const buf = readFileSync('C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/ANEXOS.docx');
const zip = await JSZip.loadAsync(buf);
const xml = await zip.file('word/document.xml').async('string');

// Cada <w:p ... w14:paraId="XXXX" ...> ... </w:p>: extraemos su paraId y el texto de sus runs.
const parrafos = [...xml.matchAll(/<w:p [^>]*w14:paraId="([0-9A-F]+)"[^>]*>([\s\S]*?)<\/w:p>/g)];
console.log('Total de párrafos:', parrafos.length);

let dentro1b = false;
let contados = 0;
for (const [, paraId, cuerpo] of parrafos) {
  const textos = [...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
  if (textos.includes('Persona jurídica')) dentro1b = true;
  if (textos.includes('Persona natural') && dentro1b === false) continue; // aún no llegamos a 1b
  if (dentro1b) {
    console.log(`[${paraId}] "${textos}"`);
    contados++;
    if (textos.includes('ANEXO') && contados > 3) break; // corta al llegar al siguiente anexo
  }
}
