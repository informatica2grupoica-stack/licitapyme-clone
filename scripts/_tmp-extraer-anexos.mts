import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const SCRATCH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad/anexos1114';
mkdirSync(SCRATCH, { recursive: true });
const { default: pool } = await import('@/app/lib/db');
const { detectarAnexosEnBases } = await import('@/app/lib/anexos-en-bases');
const { rangosDeAnexos, contarPaginasPdf, extraerAnexoDeBases } = await import('@/app/lib/anexos-pdf-a-docx');
const { verificarXmlBienFormado, abrirDocx } = await import('@/app/lib/anexos-docx');

const [r]: any = await pool.query(`SELECT documento_url_local, texto_extraido FROM documentos_cache WHERE id = 21289`);
const buf = Buffer.from(await (await fetch(r[0].documento_url_local)).arrayBuffer());
const det = detectarAnexosEnBases(r[0].texto_extraido);
const total = await contarPaginasPdf(buf);
const rangos = rangosDeAnexos(det.anexos, total);
console.log(`PDF de ${total} páginas | ${det.anexos.length} anexos -> ${rangos.length} recortes`);
for (const rg of rangos) {
  const { pdf, docx } = await extraerAnexoDeBases(buf, rg);
  const nombre = rg.titulo.replace(/[^\w\dºª°+ -]/g, '').replace(/\s+/g, '_').slice(0, 40);
  writeFileSync(`${SCRATCH}/${nombre}.pdf`, pdf);
  writeFileSync(`${SCRATCH}/${nombre}.docx`, docx);
  const chk = verificarXmlBienFormado((await abrirDocx(docx)).xml);
  console.log(`  p.${rg.desde}-${rg.hasta}  ${rg.titulo.padEnd(32)} pdf ${String(Math.round(pdf.length / 1024)).padStart(4)}kB  docx ${String(Math.round(docx.length / 1024)).padStart(3)}kB  xml=${chk.valido}`);
}
await pool.end();
