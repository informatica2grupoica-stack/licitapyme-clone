import { readFileSync } from 'fs';
for (const f of ['D:/licitapyme-clone/.env.local']) {
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, connectionLimit: 2,
});
const [existe] = await pool.query(`SHOW TABLES LIKE 'preguntas_respuestas_cache'`);
if (existe.length > 0) {
  console.log('La tabla ya existe, no se aplica de nuevo.');
} else {
  const sql = readFileSync('docs/migration-44-preguntas-respuestas-cache.sql', 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  await pool.query(sql);
  console.log('Migración 44 aplicada.');
}
const [cols] = await pool.query(`DESCRIBE preguntas_respuestas_cache`);
console.table(cols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Key: c.Key })));
await pool.end();
