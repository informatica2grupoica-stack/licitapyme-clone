// Sanea duplicados de asignación: una licitación debe estar activa en UN SOLO perfil.
// El bug histórico (clave única compuesta + reasignar por INSERT) dejó códigos con varias
// filas activas (una por perfil). Aquí, por cada código con >1 fila activa, conservamos la
// MÁS RECIENTE (MAX(id) = la última reasignación) y DESACTIVAMOS las demás (activo=FALSE).
// NO borra filas → no se pierden comentarios/etiquetas; solo desaparecen de las vistas activas.
//
// Uso:  node scripts/dedup-negocios-asignacion.mjs           (aplica)
//       node scripts/dedup-negocios-asignacion.mjs --dry     (solo reporta, no cambia nada)
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');

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
  // Códigos con más de una fila ACTIVA = duplicados.
  const [dups] = await pool.query(
    `SELECT licitacion_codigo, COUNT(*) AS n
     FROM negocios WHERE activo = TRUE
     GROUP BY licitacion_codigo HAVING n > 1
     ORDER BY n DESC`);

  if (dups.length === 0) {
    console.log('\n  No hay duplicados: cada licitación ya está en un solo perfil.\n');
    process.exit(0);
  }

  console.log(`\n  ${dups.length} licitación(es) asignada(s) a más de un perfil:`);
  const planes = [];   // { codigo, keepId, quitar:[ids] }
  const saltados = [];  // códigos sin ninguna fila con usuario válido (revisar a mano)
  let totalDesactivar = 0;

  for (const d of dups) {
    // TODAS las filas activas (LEFT JOIN → las huérfanas salen con nombre/email NULL).
    const [filas] = await pool.query(
      `SELECT n.id, n.asignado_a, u.id AS uid, u.nombre, u.email, n.estado_pipeline, n.updated_at
       FROM negocios n LEFT JOIN usuarios u ON u.id = n.asignado_a
       WHERE n.licitacion_codigo = ? AND n.activo = TRUE`, [d.licitacion_codigo]);

    // Candidatas a CONSERVAR = solo las que tienen usuario válido (uid no nulo). Nunca una huérfana.
    const validas = filas.filter(f => f.uid != null);
    if (validas.length === 0) {
      saltados.push({ codigo: d.licitacion_codigo, filas });
      continue;
    }
    // Ganadora = la más reciente con usuario válido (updated_at desc, desempate id desc).
    validas.sort((a, b) =>
      (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()) || (b.id - a.id));
    const keep = validas[0];
    const quitar = filas.filter(f => f.id !== keep.id);
    totalDesactivar += quitar.length;
    planes.push({ codigo: d.licitacion_codigo, keepId: keep.id, quitar: quitar.map(q => q.id) });

    console.log(`\n  · ${d.licitacion_codigo} (${filas.length} filas activas)`);
    console.log(`      CONSERVA → ${keep.nombre || keep.email} (id ${keep.id}, ${keep.estado_pipeline || 'ASIGNADO'})`);
    for (const q of quitar) {
      const quien = q.uid != null ? (q.nombre || q.email) : `«sin usuario» (asignado_a=${q.asignado_a})`;
      console.log(`      desactiva  ${quien} (id ${q.id}, ${q.estado_pipeline || 'ASIGNADO'})`);
    }
  }

  if (saltados.length) {
    console.log(`\n  ${saltados.length} código(s) SALTADO(s) (ninguna fila tiene usuario válido → revisar a mano):`);
    for (const s of saltados) console.log(`      · ${s.codigo} (ids: ${s.filas.map(f => f.id).join(', ')})`);
  }

  if (DRY) {
    console.log(`\n  [DRY] Se desactivarían ${totalDesactivar} fila(s) en ${planes.length} código(s). Sin cambios. Ejecuta sin --dry para aplicar.\n`);
    process.exit(0);
  }

  // Aplicar: por cada código con plan, desactivar todas las filas activas menos la ganadora.
  let desactivadas = 0;
  for (const p of planes) {
    const [r] = await pool.query(
      `UPDATE negocios SET activo = FALSE
       WHERE licitacion_codigo = ? AND activo = TRUE AND id <> ?`,
      [p.codigo, p.keepId]);
    desactivadas += r.affectedRows || 0;
  }
  console.log(`\n  Listo: ${desactivadas} fila(s) desactivada(s) en ${planes.length} código(s). Cada licitación queda en un solo perfil.`);
  if (saltados.length) console.log(`  (${saltados.length} código(s) sin usuario válido quedaron intactos — revísalos a mano.)`);
  console.log('');
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
