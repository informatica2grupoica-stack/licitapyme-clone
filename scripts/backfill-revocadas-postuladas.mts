// Saca de POSTULADA las licitaciones que MP ya dejó Revocada/Desierta (según adjudicacion_cache) y
// las pasa al estados aparte REVOCADA/DESIERTA. Escribe también licitacion_estado (nombre canónico) en
// negocios y radar. SIN notificaciones: es ponerse al día con hechos pasados.
//   npx tsx scripts/backfill-revocadas-postuladas.mts          (dry)
//   npx tsx scripts/backfill-revocadas-postuladas.mts --commit
import { cargarEnv } from './regresion/_env.js';
cargarEnv();
const { ahoraChileSQL } = await import('../app/lib/tz.js');
const pool = (await import('../app/lib/db.js')).default;
const COMMIT = process.argv.includes('--commit');
const [rows] = await pool.query(
  `SELECT n.id, n.licitacion_codigo, n.estado_pipeline, n.licitacion_estado, c.estado
     FROM negocios n
     JOIN adjudicacion_cache c ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
    WHERE n.activo = 1 AND n.estado_pipeline IN ('POSTULADA','POSIBLE_ADJ','7POSTULADO_JV','7POSTULADO_CG','8POSIBLE_ADJ','REVOCADA')
      AND (c.estado LIKE '%evocad%' OR c.estado LIKE '%esiert%')
    ORDER BY n.licitacion_codigo`) as any;
console.table(rows);
if (COMMIT) {
  for (const r of rows as any[]) {
    const nombre = /evocad/.test(r.estado) ? 'Revocada' : 'Desierta';
    await pool.query(`UPDATE negocios SET estado_pipeline=?, licitacion_estado=?, updated_at=NOW() WHERE id=?`, [nombre.toUpperCase(), nombre, r.id]);
    const txt = `Mercado Público marcó la licitación como ${nombre}.`;
    await pool.query(`INSERT INTO comentarios_negocio (negocio_id, usuario_id, pipeline_estado, comentario, created_at)
      SELECT ?, asignado_a, ?, ?, ? FROM negocios WHERE id=? AND NOT EXISTS (SELECT 1 FROM comentarios_negocio WHERE negocio_id=? AND comentario=?)`,
      [r.id, nombre.toUpperCase(), txt, ahoraChileSQL(), r.id, r.id, txt]).catch(e => console.error(r.licitacion_codigo, String(e).slice(0, 120)));
    await pool.query(`UPDATE alertas_licitaciones SET licitacion_estado=? WHERE licitacion_codigo=?`, [nombre, r.licitacion_codigo]);
  }
  console.log(`${(rows as any[]).length} negocios movidos a REVOCADA/DESIERTA.`);
}
process.exit(0);
