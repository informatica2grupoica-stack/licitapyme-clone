// Aplica migration-78: unifica el charset de la base a utf8mb4_general_ci.
//
// POR QUÉ (26-ago-2026, auditoría técnica). La base entera nació en `utf8` (3 bytes/carácter,
// legacy) en vez de `utf8mb4`: no son columnas sueltas, es el charset por defecto de la base
// completa. 11 tablas — entre ellas documentos_cache y licitaciones_cache, las dos más pesadas —
// quedaron con TODAS sus columnas de texto en utf8_unicode_ci mientras el resto del sistema usa
// utf8mb4_general_ci. Cruzar una tabla en cada charset obliga a MySQL a convertir sobre la marcha
// y el índice deja de servir: medido en producción, el mismo JOIN pasó de 185ms a 7.156ms — 39
// veces más lento — y es la causa raíz de los JOIN que devuelven vacío sin error visible.
//
// RIESGO VERIFICADO ANTES DE ESCRIBIR ESTA MIGRACIÓN (no se asume, se midió):
//   · MySQL 5.7.23, innodb_large_prefix=ON, row_format=dynamic → límite de índice 3072 bytes.
//     Un VARCHAR(255) en utf8mb4 (255×4=1020 bytes) queda muy por debajo: ningún ALTER TABLE
//     fallará por "Specified key was too long".
//   · Los datos reales son cortos (documento_nombre: máximo 91 caracteres, no 255) — no hay
//     riesgo de truncar contenido real.
//   · utf8 (3 bytes) es subconjunto estricto de utf8mb4 (4 bytes): CONVERT TO reinterpreta los
//     bytes correctamente, no hay pérdida de datos para el texto que ya había.
//
// TAMAÑOS (por qué se divide en dos fases). 9 de las 11 tablas pesan menos de 5MB — su ALTER es
// prácticamente instantáneo. Las otras dos son las que importan: licitaciones_cache (86.6MB,
// 26.806 filas) y documentos_cache (293.8MB, 21.869 filas). MySQL 5.7 no tiene ALTER instantáneo
// para cambio de charset (eso llegó en 8.0): es ALGORITHM=COPY, reconstruye la tabla entera y
// bloquea escrituras mientras dura. Para las 9 chicas el bloqueo es imperceptible; para las 2
// grandes conviene correr con el scheduler en pausa (NEXT_PUBLIC_AUTOMATIZACION_PAUSADA=true) y
// en horario de poco tráfico.
//
// Uso:
//   node scripts/aplicar-migration-78.mjs                    → solo las 9 tablas chicas (seguro siempre)
//   node scripts/aplicar-migration-78.mjs --incluir-grandes  → además licitaciones_cache y documentos_cache
//   node scripts/aplicar-migration-78.mjs --solo-medir       → no altera nada, solo diagnostica
//
// Idempotente: se comprueba el collation actual de cada tabla antes de tocarla — correrlo dos
// veces no hace daño, la segunda vez no encuentra nada que convertir.
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = {};
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}
const INCLUIR_GRANDES = process.argv.includes('--incluir-grandes');
const SOLO_MEDIR = process.argv.includes('--solo-medir');

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 30000, connectionLimit: 2,
});

// Orden: chicas primero (rápido, de bajo riesgo, sirve de smoke test), grandes al final.
const TABLAS_CHICAS = [
  'search_alerts', 'documentos_licitacion', 'search_history', 'documentos_scraping_log',
  'viabilidad_feedback', 'anexos_feedback', 'favoritos', 'licitaciones_descartadas', 'prefiltro_licitacion',
];
const TABLAS_GRANDES = ['licitaciones_cache', 'documentos_cache'];
// Estas ya son utf8mb4 pero con collation distinta (utf8mb4_unicode_ci) — solo alinear, sin
// riesgo de charset, todas pesan <3MB.
const TABLAS_SOLO_COLLATION = [
  'adjudicacion_cache', 'chat_licitacion', 'experiencia_caso',
  'licitacion_apertura', 'licitacion_contexto_chat', 'preguntas_respuestas_cache',
];

async function collationDe(tabla) {
  const [[r]] = await pool.query(
    `SELECT TABLE_COLLATION c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [env.DB_NAME, tabla]);
  return r?.c || null;
}

async function convertir(tabla) {
  const actual = await collationDe(tabla);
  if (actual === 'utf8mb4_general_ci') { console.log(`  = ${tabla}: ya está en utf8mb4_general_ci — nada que hacer.`); return; }
  if (!actual) { console.log(`  ? ${tabla}: no existe en esta base — se salta.`); return; }
  console.log(`  → ${tabla}: convirtiendo de ${actual} a utf8mb4_general_ci...`);
  if (SOLO_MEDIR) { console.log(`    (--solo-medir: no se ejecuta)`); return; }
  const t0 = Date.now();
  await pool.query(`ALTER TABLE \`${tabla}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
  console.log(`    OK en ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

try {
  console.log(`\nmodo: ${SOLO_MEDIR ? 'MEDICIÓN (no altera nada)' : 'APLICAR'}`);

  // 1) Charset por defecto de la BASE — para que toda tabla NUEVA nazca ya en utf8mb4.
  const [[db]] = await pool.query(
    `SELECT DEFAULT_COLLATION_NAME c FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?`, [env.DB_NAME]);
  if (db.c === 'utf8mb4_general_ci') {
    console.log('\n  = la base ya tiene utf8mb4_general_ci por defecto.');
  } else {
    console.log(`\n  → base de datos: ${db.c} → utf8mb4_general_ci`);
    if (!SOLO_MEDIR) await pool.query(`ALTER DATABASE \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
  }

  console.log('\n-- Fase 1: tablas chicas (<5MB, riesgo mínimo) --');
  for (const t of TABLAS_CHICAS) await convertir(t);

  console.log('\n-- Fase 2: alinear collation en tablas ya-utf8mb4 --');
  for (const t of TABLAS_SOLO_COLLATION) await convertir(t);

  if (INCLUIR_GRANDES) {
    console.log('\n-- Fase 3: tablas grandes (licitaciones_cache 86.6MB, documentos_cache 293.8MB) --');
    console.log('   Recomendado: scheduler en pausa (NEXT_PUBLIC_AUTOMATIZACION_PAUSADA=true) y horario de poco tráfico.');
    for (const t of TABLAS_GRANDES) await convertir(t);
  } else {
    console.log('\n-- Fase 3 (tablas grandes) NO ejecutada — correr con --incluir-grandes cuando el scheduler esté en pausa.');
  }

  console.log('\n  Listo.\n');
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
