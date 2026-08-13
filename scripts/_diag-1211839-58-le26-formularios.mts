import fs from 'node:fs';
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios, detectarFormularios } = await import('@/app/lib/anexos-dividir');

const buffer = fs.readFileSync('D:/licitapyme-clone/scratch-formularios-1211839.docx');
const { xml } = await abrirDocx(buffer);
const formularios = detectarFormularios(xml);
console.log(`Detectados ${formularios.length} formularios:\n`);
for (const f of formularios) console.log(`  · "${f.titulo}"`);

if (formularios.length < 2) {
  console.log('\n--- menos de 2, no se divide. Buscando patrones "FORMULARIO"/"ANEXO" en el texto crudo ---');
  const texto = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?>/g)]
    .map(m => (m[1] !== undefined ? m[1] : '\n')).join('');
  const re = /(FORMULARIO|ANEXO)[^\n]{0,60}/gi;
  let m; let n = 0;
  while ((m = re.exec(texto)) !== null && n < 40) { console.log('  ·', m[0].replace(/\s+/g,' ').trim()); n++; }
}
