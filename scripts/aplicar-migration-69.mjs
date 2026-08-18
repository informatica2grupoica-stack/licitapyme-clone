// Aplica migration-69: columna `representante_profesion` en `empresas`.
//
// POR QUÉ (18-ago-2026, pedido del usuario sobre el FORMULARIO N°1 de 1063538-204-LE26): los anexos
// piden a veces la PROFESIÓN u OFICIO del representante, que NO es lo mismo que su CARGO en la
// empresa. Hoy los dos usos comparten `representante_cargo`, y eso ya produjo datos mezclados:
// Comercial MP SpA tenía "Representante" (un cargo genérico) donde el cargo real es "Gerente", e
// Inversiones Claro ARZ SPA tiene "Ingeniero Constructor", que es una PROFESIÓN, no un cargo.
// Separarlos deja que cada anexo reciba el dato que de verdad pide.
//
// Idempotente: si la columna ya existe, no hace nada.
// Uso: node scripts/aplicar-migration-69.mjs
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

try {
  const [[ya]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresas' AND COLUMN_NAME='representante_profesion'`,
    [env.DB_NAME]);

  if (ya.n > 0) {
    console.log('\n  Ya aplicada (empresas.representante_profesion existe). Nada que hacer.\n');
  } else {
    await pool.query(
      `ALTER TABLE empresas
         ADD COLUMN representante_profesion VARCHAR(120) NULL AFTER representante_cargo`);
    console.log('\n  ✔ Columna empresas.representante_profesion creada.');
    console.log('    Cárgala desde /empresas: es la PROFESIÓN u OFICIO del representante');
    console.log('    ("Empresaria", "Ingeniero Constructor"), distinta de su CARGO ("Gerente").\n');
  }
} catch (e) {
  console.error('\n  ✖ Error:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
