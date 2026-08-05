import { readFileSync } from 'node:fs';
const SCRATCH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad';
const mupdf: any = await import('mupdf');
const doc = mupdf.Document.openDocument(readFileSync(`${SCRATCH}/bases_1114.pdf`), 'application/pdf');
const json = JSON.parse(doc.loadPage(33).toStructuredText('preserve-whitespace').asJSON());
const b = json.blocks[0];
console.log('block keys:', Object.keys(b), '| type:', b.type, '| bbox:', JSON.stringify(b.bbox));
console.log('line keys:', Object.keys(b.lines[0]));
const linea = (l: any) => l.text ?? '';
console.log('\n--- primeras 25 líneas de la página 34 (ANEXO Nº 1) ---');
let n = 0;
for (const blk of json.blocks) {
  for (const l of blk.lines ?? []) {
    const t = linea(l);
    const f = l.font ?? {};
    console.log(`[${String(Math.round(l.bbox.x)).padStart(4)},${String(Math.round(l.bbox.y)).padStart(4)} w=${Math.round(l.bbox.w)}] ${f.weight ?? '?'}/${f.size ?? '?'} :: ${JSON.stringify(t.slice(0, 80))}`);
    if (++n >= 30) break;
  }
  if (n >= 30) break;
}
