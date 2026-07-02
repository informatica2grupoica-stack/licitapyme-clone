// Vuelca el texto_extraido de los documentos de una licitación para depurar el parser.
import { readFileSync, writeFileSync } from 'fs';
import mysql from 'mysql2/promise';

for (const f of ['D:/licitapyme-clone/.env.local', 'D:/licitapyme-clone/.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ok */ }
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 1,
  });
  const [rows] = await pool.query(
    `SELECT documento_nombre, categoria, metodo_extraccion, CHAR_LENGTH(texto_extraido) AS len, texto_extraido
     FROM documentos_cache WHERE licitacion_codigo = ?`, ['1057536-77-LE26']);
  const dir = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/e215f6d1-dc54-40df-a958-0806af7e2025/scratchpad';
  for (const r of rows as any[]) {
    console.log(`${r.documento_nombre} [${r.categoria}] metodo=${r.metodo_extraccion} len=${r.len}`);
    if (r.texto_extraido) {
      const safe = r.documento_nombre.replace(/[^a-zA-Z0-9._-]/g, '_');
      writeFileSync(`${dir}/doc_${safe}.txt`, r.texto_extraido, 'utf8');
    }
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
