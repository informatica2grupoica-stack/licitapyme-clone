// migration-175: permisos costeo_agregar_fila / costeo_agregar_gasto / costeo_agregar_adicional (botones del Costeo digital).
// Otorga los tres a quien ya los tenía de hecho (costeo_editor, compras, compras_todo) para no quitarles lo que usaban.
// Uso:  node scripts/aplicar-migration-175.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-175.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
// Idempotente: no pisa un permiso que ya esté definido (true o false).
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const produccion = process.argv.includes('--produccion');
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const conf = produccion
  ? { host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306') }
  : { host: '127.0.0.1', user: 'licitank', password: 'licitank_local', database: 'licitank_dev', port: 3308 };
const pool = mysql.createPool({ ...conf, connectTimeout: 20000 });
const NUEVOS = ['costeo_agregar_fila', 'costeo_agregar_gasto', 'costeo_agregar_adicional'];

try {
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'}`);
  const [rows] = await pool.query(`SELECT id, email, permisos FROM usuarios WHERE rol <> 'admin' AND permisos IS NOT NULL`);
  let n = 0;
  for (const u of rows) {
    let p;
    try { p = typeof u.permisos === 'string' ? JSON.parse(u.permisos) : u.permisos; } catch { continue; }
    if (!p || typeof p !== 'object') continue;
    if (!(p.costeo_editor || p.compras || p.compras_todo)) continue;
    const faltan = NUEVOS.filter(k => p[k] === undefined);
    if (!faltan.length) continue;
    for (const k of faltan) p[k] = true;
    await pool.query('UPDATE usuarios SET permisos = ? WHERE id = ?', [JSON.stringify(p), u.id]);
    n++; console.log(`    + ${u.email}: ${faltan.join(', ')}`);
  }
  console.log(`  Listo: ${n} usuario(s) actualizados.\n`);
} finally {
  await pool.end();
}
