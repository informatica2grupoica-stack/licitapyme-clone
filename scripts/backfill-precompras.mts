// Abre la PRE-COMPRA de los negocios que YA estaban en POSIBLE ADJ cuando se creó el módulo
// (la apertura automática solo ocurre al ENTRAR a ese estado). Idempotente: salta los que ya tienen Compras.
// Uso: npx tsx scripts/backfill-precompras.mts
import { cargarEnv } from './regresion/_env.js';
cargarEnv();
const pool = (await import('../app/lib/db.js')).default;
const { abrirComprasSiCorresponde } = await import('../app/lib/compras.js');
const { idsEquivalentes } = await import('../app/lib/pipeline.js');

const estados = idsEquivalentes('POSIBLE_ADJ');
const [rows] = await pool.query(
  `SELECT n.id, n.licitacion_codigo, n.asignado_a FROM negocios n
    WHERE n.estado_pipeline IN (${estados.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM compras_asignacion ca WHERE ca.negocio_id = n.id)`,
  estados,
) as any;
console.log(`${(rows as any[]).length} negocio(s) en POSIBLE ADJ sin Compras.`);
for (const n of rows as any[]) {
  const abierta = await abrirComprasSiCorresponde(n.id, n.licitacion_codigo, n.asignado_a, { precompra: true });
  console.log(`  ${n.licitacion_codigo} (negocio ${n.id}): ${abierta ? 'pre-compra abierta' : 'NO abierta'}`);
}
await pool.end();
