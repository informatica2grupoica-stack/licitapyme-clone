import { readFileSync } from 'fs';
for (const f of ['D:/licitapyme-clone/.env.local']) {
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({
  host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, connectionLimit: 2,
});
const db = process.env.DB_NAME;
const [tablas] = await pool.query(
  `SELECT TABLE_NAME t, TABLE_ROWS r FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME`, [db]);
console.log(`BD: ${db} · ${tablas.length} tablas\n`);
for (const { t } of tablas) {
  const [cnt] = await pool.query(`SELECT COUNT(*) c FROM \`${t}\``);
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME n, COLUMN_TYPE ty, IS_NULLABLE nu, COLUMN_KEY k
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [db, t]);
  console.log(`\n### ${t}  (${cnt[0].c} filas)`);
  for (const c of cols) {
    const flags = [c.k === 'PRI' ? 'PK' : c.k === 'MUL' ? 'idx' : c.k === 'UNI' ? 'uniq' : '', c.nu === 'NO' ? 'NOT NULL' : ''].filter(Boolean).join(' ');
    console.log(`   ${c.n} : ${c.ty}${flags ? '  [' + flags + ']' : ''}`);
  }
}
await pool.end();
