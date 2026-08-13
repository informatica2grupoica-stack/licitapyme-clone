import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync } from 'node:fs';

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const codigo = '1736-82-LE26';

const [rows]: any = await pool.query(
  `SELECT id, documento_nombre, categoria, texto_extraido, metodo_extraccion
   FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY id`,
  [codigo]
);

for (const r of rows) {
  const fname = `C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/c0a29e2d-c4a3-400e-88ba-b824862a8dc2/scratchpad/doc_${r.id}_${r.documento_nombre.replace(/[^a-zA-Z0-9._-]/g,'_')}.txt`;
  writeFileSync(fname, r.texto_extraido || '', 'utf8');
  console.log(r.id, r.documento_nombre, r.categoria, r.metodo_extraccion, '->', fname);
}

await pool.end();
