// Aplica migration-72: respuesta manual + adjunto por característica del Auditor Técnico.
//
// POR QUÉ (19-ago-2026): la comparación contra ficha pisaba lo que una persona había contestado
// a mano en una casilla. `respuesta_manual` la deja intocable para la IA; `adjunto_url`/
// `adjunto_nombre` guardan el respaldo de ESA casilla (certificado de capacitación, garantía).
// Ver docs/migration-72-caracteristicas-respuesta-manual.sql.
//
// Idempotente: comprueba columna por columna, así que se puede correr sobre una tabla a medio migrar.
// Uso: node scripts/aplicar-migration-72.mjs
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

const TABLA = 'checklist_comercial_caracteristicas';
const COLUMNAS = {
  respuesta_manual: 'TINYINT(1)   NOT NULL DEFAULT 0',
  adjunto_url:      'VARCHAR(500)     NULL DEFAULT NULL',
  adjunto_nombre:   'VARCHAR(300)     NULL DEFAULT NULL',
};

try {
  const [[tabla]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [env.DB_NAME, TABLA]);
  if (tabla.n === 0) {
    console.error('\n  Falta checklist_comercial_caracteristicas. Corre antes: node scripts/aplicar-migration-50.mjs\n');
    process.exitCode = 1;
  } else {
    const [existentes] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [env.DB_NAME, TABLA]);
    const ya = new Set(existentes.map(r => r.COLUMN_NAME));
    const faltan = Object.entries(COLUMNAS).filter(([c]) => !ya.has(c));

    if (!faltan.length) {
      console.log('\n  Ya aplicada (las 3 columnas existen). Nada que hacer.');
    } else {
      console.log(`\n  Aplicando migration-72 (${faltan.length} columna(s))...`);
      const t = performance.now();
      await pool.query(`ALTER TABLE ${TABLA} ${faltan.map(([c, d]) => `ADD COLUMN ${c} ${d}`).join(', ')}`);
      console.log(`    OK en ${Math.round(performance.now() - t)} ms`);

      // Backfill solo la primera vez: lo ya respondido a mano o corregido por el asesor queda
      // protegido sin esperar a que alguien lo vuelva a tocar.
      const [r] = await pool.query(
        `UPDATE ${TABLA} SET respuesta_manual = 1 WHERE origen = 'manual' OR corregido_at IS NOT NULL`);
      console.log(`    Backfill: ${r.affectedRows} fila(s) marcadas como respuesta manual`);
    }

    // La respuesta manual de un requisito de servicio (capacitación, garantía) es un párrafo,
    // no una cita corta: 300 caracteres lo truncaban en silencio.
    const [[tipo]] = await pool.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS largo FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='valor_ofertado_texto'`, [env.DB_NAME, TABLA]);
    if (Number(tipo?.largo || 0) < 1000) {
      await pool.query(`ALTER TABLE ${TABLA} MODIFY COLUMN valor_ofertado_texto VARCHAR(1000) DEFAULT NULL`);
      console.log('    valor_ofertado_texto ampliado a VARCHAR(1000)');
    } else {
      console.log('    valor_ofertado_texto .......... ya era VARCHAR(1000)+');
    }

    const [chk] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
          AND COLUMN_NAME IN ('respuesta_manual','adjunto_url','adjunto_nombre')`, [env.DB_NAME, TABLA]);
    console.log(`  Verificación: ${chk.length}/3 columnas presentes\n`);
    if (chk.length !== 3) process.exitCode = 1;
  }
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
