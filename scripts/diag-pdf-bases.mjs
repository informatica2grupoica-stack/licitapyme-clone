import { readFileSync } from 'node:fs';
const pdfParse = (await import('pdf-parse')).default;
const ruta = 'C:/Users/droku/Downloads/1782134188308_Decreto_TC_N_246_Aprueba_Bases.pdf';
const buf = readFileSync(ruta);
console.log(`\n  Archivo: ${(buf.length/1024/1024).toFixed(1)} MB`);
const data = await pdfParse(buf);
console.log(`  Páginas: ${data.numpages}`);
console.log(`  Texto total extraído por pdf-parse: ${data.text.length} chars (${(data.text.length/data.numpages).toFixed(0)} chars/pág promedio)`);
const t = data.text.toLowerCase();
for (const kw of ['criterio','evaluación','evaluacion','ponderación','ponderacion','puntaje','multa','factor']) {
  const n = (t.match(new RegExp(kw,'g'))||[]).length;
  console.log(`    "${kw}": ${n} ocurrencias`);
}
console.log(`\n  Muestra (primeros 600 chars):\n  ${JSON.stringify(data.text.slice(0,600))}`);
