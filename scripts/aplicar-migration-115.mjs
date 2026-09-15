// Aplica migration-115: tabla compras_agente_uso_diario — tope diario de uso del agente de
// documentos de Compras (pedido explícito del usuario, 14-sep-2026).
// Uso: node scripts/aplicar-migration-115.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const tablaExiste = async (tabla) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [env.DB_NAME, tabla]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-115 (compras_agente_uso_diario)...');
  if (await tablaExiste('compras_agente_uso_diario')) {
    console.log('    compras_agente_uso_diario ya existe — se salta.');
  } else {
    await pool.query(`
      CREATE TABLE compras_agente_uso_diario (
        fecha          DATE     NOT NULL PRIMARY KEY,
        llamadas       INT      NOT NULL DEFAULT 0,
        actualizado_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    console.log('    CREATE TABLE compras_agente_uso_diario OK');
  }
  const ok = await tablaExiste('compras_agente_uso_diario');
  console.log(`  Verificación: compras_agente_uso_diario existe = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
