import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const COD = '1063534-4-LE26';
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const [rows] = await pool.query(
  `SELECT documento_nombre AS nombre, texto_extraido AS texto FROM documentos_cache WHERE licitacion_codigo = ? AND documento_nombre IN ('Formularios_word.docx','Bases_1063534-4-LE26.pdf')`,
  [COD],
) as any[];
for (const d of rows as any[]) {
  console.log(`\n\n========== ${d.nombre} (${d.texto.length} chars) ==========`);
  const re = /[^.]{0,100}l[ií]nea[^.]{0,150}\./gi;
  let m; let n = 0;
  while ((m = re.exec(d.texto)) !== null && n < 30) { console.log('  · ' + m[0].replace(/\s+/g,' ').trim()); n++; }
  console.log(`  (${n} coincidencias de "línea")`);
}
await pool.end();
