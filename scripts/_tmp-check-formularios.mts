import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores } = await import('@/app/lib/anexos-docx');
const { detectarFormularios, dividirPorFormularios } = await import('@/app/lib/anexos-dividir');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const ids = process.argv.slice(2).map(Number);
for (const id of ids) {
  const [rows]: any = await pool.query(`SELECT licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache WHERE id=?`, [id]);
  const d = rows[0];
  if (!d) { console.log(`[${id}] no encontrado`); continue; }
  const res = await fetch(d.documento_url_local);
  const buffer = Buffer.from(await res.arrayBuffer());
  const { xml } = await abrirDocx(buffer);
  const { xml: conIds } = normalizarParaIds(xml);
  const xmlU = unificarRunsDeMarcadores(conIds);
  const formularios = detectarFormularios(xmlU);
  console.log(`\n[${id}] ${d.licitacion_codigo} — ${d.documento_nombre}: ${formularios.length} formularios`);
  for (const f of formularios) console.log(`  ${f.titulo}  (parrafos ${f.indiceInicio}-${f.indiceFin})`);
}
await pool.end();
