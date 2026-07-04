import { readFileSync } from 'fs';
for (const line of readFileSync('D:/licitapyme-clone/.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const mysql = (await import('mysql2/promise')).default;
const p = mysql.createPool({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 1 });
const [r] = await p.query('SELECT id, email, LEFT(password_hash,7) pref, CHAR_LENGTH(password_hash) largo, rol FROM usuarios ORDER BY id');
for (const u of r) {
  const bcryptOk = /^\$2[aby]\$\d\d\$/.test(u.pref) && u.largo === 60;
  const email = String(u.email).replace(/(.{2}).*(@.*)/, '$1***$2');
  console.log(`  #${u.id} ${email} [${u.rol}] → ${bcryptOk ? '✅ bcrypt' : '🔴 NO bcrypt'} (prefijo="${u.pref}" largo=${u.largo})`);
}
await p.end();
