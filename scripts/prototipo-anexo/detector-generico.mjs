// Prototipo Frente E, paso 4 — detector GENÉRICO: a diferencia de los pasos 1-3 (donde yo
// miré el XML a mano y elegí los paraId), este script no sabe nada del documento de antemano.
// Recorre TODOS los párrafos en orden y aplica una sola regla: si un párrafo con texto viene
// seguido INMEDIATAMENTE por un párrafo vacío (sin ningún <w:r>), ese vacío es candidato a
// "campo para rellenar". Es la prueba real de si el patrón se repite solo entre organismos
// distintos, sin que un humano lo confirme documento por documento.
import JSZip from 'jszip';
import { readFileSync } from 'fs';

const RUTA = process.argv[2];
if (!RUTA) { console.error('Uso: node detector-generico.mjs <ruta.docx>'); process.exit(1); }

function textoDe(cuerpo) {
  return [...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').trim();
}

async function main() {
  const buf = readFileSync(RUTA);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');

  const parrafos = [...xml.matchAll(/<w:p [^>]*w14:paraId="([0-9A-F]+)"[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map(([, paraId, cuerpo]) => ({ paraId, texto: textoDe(cuerpo), vacio: !/<w:r[ >]/.test(cuerpo) }));

  console.log(`Total párrafos: ${parrafos.length}\n`);

  const candidatos = [];
  for (let i = 0; i < parrafos.length - 1; i++) {
    const actual = parrafos[i];
    const siguiente = parrafos[i + 1];
    // Regla: texto corto (parece etiqueta, no un párrafo de contenido largo) seguido de vacío.
    if (actual.texto && actual.texto.length <= 60 && siguiente.vacio) {
      candidatos.push({ etiqueta: actual.texto, paraIdVacio: siguiente.paraId });
    }
  }

  console.log(`Candidatos detectados: ${candidatos.length}\n`);
  candidatos.forEach(c => console.log(`  "${c.etiqueta}" → [${c.paraIdVacio}]`));
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
