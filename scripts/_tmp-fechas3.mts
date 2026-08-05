import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, listarParrafos, unificarRunsDeMarcadores } = await import('@/app/lib/anexos-docx');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const ids = [22042, 22045]; // anexo 9 y anexo 6

for (const id of ids) {
  const [rows]: any = await pool.query(`SELECT id, licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache WHERE id=?`, [id]);
  const d = rows[0];
  const res = await fetch(d.documento_url_local);
  let buffer = Buffer.from(await res.arrayBuffer());
  const { xml } = await abrirDocx(buffer);
  const xmlU = unificarRunsDeMarcadores(xml);
  const parrafos = listarParrafos(xmlU);
  console.log(`\n===== [${id}] ${d.licitacion_codigo} — ${d.documento_nombre} (${parrafos.length} párrafos) =====`);
  for (const p of parrafos) {
    console.log(`  #${p.indice}: ${JSON.stringify(p.texto.slice(0, 160))}`);
  }
}
await pool.end();
