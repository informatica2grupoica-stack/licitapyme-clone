// scripts/marcar-leidas-asignadas.mjs
// Corrección histórica: las licitaciones YA ASIGNADAS a un perfil deben contar como
// revisadas en el radar (leida = TRUE en alertas_licitaciones). Desde jul-2026 el POST
// /api/negocios lo hace al asignar; esto arregla las asignadas ANTES de ese cambio.
//
// Los códigos se traen a Node y se actualizan con IN (...) por lotes — sin JOIN en SQL —
// para esquivar los choques de collation entre tablas (unicode_ci vs general_ci).
//
// Uso:
//   node scripts/marcar-leidas-asignadas.mjs        → dry-run (muestra cuántas cambiaría)
//   node scripts/marcar-leidas-asignadas.mjs --run  → escribe
import { readFileSync } from 'fs';
for (const line of readFileSync('D:/licitapyme-clone/.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const mysql = (await import('mysql2/promise')).default;
const ESCRIBIR = process.argv.includes('--run');

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 2,
});

try {
  // 1) Todos los códigos con asignación activa.
  const [neg] = await pool.query(
    `SELECT DISTINCT licitacion_codigo FROM negocios WHERE activo = TRUE AND asignado_a IS NOT NULL`);
  const codigos = neg.map(r => r.licitacion_codigo).filter(Boolean);
  console.log(`Licitaciones asignadas (activas): ${codigos.length}`);
  if (codigos.length === 0) process.exit(0);

  // 2) Cuántas alertas de esas siguen como no leídas.
  let pendientes = 0;
  const LOTE = 500;
  for (let i = 0; i < codigos.length; i += LOTE) {
    const lote = codigos.slice(i, i + LOTE);
    const [r] = await pool.query(
      `SELECT COUNT(*) AS n FROM alertas_licitaciones WHERE leida = FALSE AND licitacion_codigo IN (?)`, [lote]);
    pendientes += r[0].n;
  }
  console.log(`Alertas no leídas de licitaciones ya asignadas: ${pendientes}`);

  if (!ESCRIBIR) {
    console.log('\nDRY-RUN: no se escribió nada. Corre con --run para marcarlas como leídas.');
    process.exit(0);
  }

  // 3) Marcarlas leídas por lotes.
  let cambiadas = 0;
  for (let i = 0; i < codigos.length; i += LOTE) {
    const lote = codigos.slice(i, i + LOTE);
    const [r] = await pool.query(
      `UPDATE alertas_licitaciones SET leida = TRUE WHERE leida = FALSE AND licitacion_codigo IN (?)`, [lote]);
    cambiadas += r.affectedRows;
  }
  console.log(`Listo: ${cambiadas} alertas marcadas como leídas.`);
} finally {
  await pool.end();
}
