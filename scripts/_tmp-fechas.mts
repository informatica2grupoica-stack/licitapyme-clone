import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, listarParrafos, unificarRunsDeMarcadores } = await import('@/app/lib/anexos-docx');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const ids = [22014, 22039, 22040, 22041, 22042, 22043, 22044, 22045, 22046, 22047, 22048, 22049, 22050,
             21202, 21813, 21814, 21815];

for (const id of ids) {
  const [rows]: any = await pool.query(`SELECT id, licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache WHERE id=?`, [id]);
  const d = rows[0];
  if (!d) { console.log(`[${id}] no encontrado`); continue; }
  try {
    const res = await fetch(d.documento_url_local);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let buffer = Buffer.from(await res.arrayBuffer());
    if (/\.doc$/i.test(d.documento_nombre)) buffer = Buffer.from(await convertirDocADocx(buffer));
    const { xml } = await abrirDocx(buffer);
    const xmlU = unificarRunsDeMarcadores(xml);
    const parrafos = listarParrafos(xmlU);
    console.log(`\n===== [${id}] ${d.licitacion_codigo} — ${d.documento_nombre} (${parrafos.length} párrafos) =====`);
    for (const p of parrafos) {
      if (/fecha/i.test(p.texto)) {
        console.log(`  #${p.indice}: ${JSON.stringify(p.texto.slice(0, 200))}`);
      }
    }
  } catch (e: any) {
    console.log(`[${id}] ERROR: ${e?.message || e}`);
  }
}
await pool.end();
