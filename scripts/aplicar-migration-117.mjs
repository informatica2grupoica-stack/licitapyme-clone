// Aplica migration-117: columna plazo_entrega_json en compras_agente_auditoria_negocio — guarda
// el plazo de entrega ofertado que la auditoría con IA detecta al leer los documentos reales del
// negocio (bases + anexos propios), para usarlo en el Resumen Ejecutivo mientras el Auditor
// Técnico todavía no tiene cargado el plazo comprometido con el cliente (pedido explícito del
// usuario, 15-sep-2026).
// Uso: node scripts/aplicar-migration-117.mjs
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

const columnaExiste = async (tabla, columna) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-117 (compras_agente_auditoria_negocio.plazo_entrega_json)...');
  if (await columnaExiste('compras_agente_auditoria_negocio', 'plazo_entrega_json')) {
    console.log('    plazo_entrega_json ya existe — se salta.');
  } else {
    await pool.query(
      `ALTER TABLE compras_agente_auditoria_negocio ADD COLUMN plazo_entrega_json TEXT NULL AFTER documentos_leidos_json`,
    );
    console.log('    ALTER TABLE ... ADD COLUMN plazo_entrega_json OK');
  }
  const ok = await columnaExiste('compras_agente_auditoria_negocio', 'plazo_entrega_json');
  console.log(`  Verificación: plazo_entrega_json existe = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
