import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const SCRATCH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad';
const { default: pool } = await import('@/app/lib/db');
const [r]: any = await pool.query(`SELECT documento_url_local FROM documentos_cache WHERE id = 21289`);
const buf = Buffer.from(await (await fetch(r[0].documento_url_local)).arrayBuffer());
writeFileSync(`${SCRATCH}/bases_1114.pdf`, buf);
await pool.end();

const mupdf: any = await import('mupdf');
console.log('exports mupdf:', Object.keys(mupdf).slice(0, 40).join(', '));
const doc = mupdf.Document.openDocument(buf, 'application/pdf');
console.log('páginas:', doc.countPages());
const page = doc.loadPage(33); // 0-based -> página 34, el ANEXO Nº 1
const st = page.toStructuredText('preserve-whitespace,preserve-spans');
const json = JSON.parse(st.asJSON());
console.log('claves de la página:', Object.keys(json));
console.log(JSON.stringify(json.blocks?.slice(0, 3), null, 1).slice(0, 2500));
