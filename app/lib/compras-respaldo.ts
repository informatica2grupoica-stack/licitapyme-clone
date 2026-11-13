// ¿Este negocio tiene alguna compra de verdad registrada? (QA 13-nov-2026) Lo usan el cierre del resultado y la entrega
// (recepción y guía), que antes se podían marcar sin haber comprado nada.
import pool from '@/app/lib/db';

async function contar(sql: string, negocioId: number): Promise<number> {
  try { const [r] = await pool.query(sql, [negocioId]) as any; return Number((r as any[])[0]?.n || 0); } catch { return 0; } // tabla sin migrar = sin respaldo
}

/** OC de Obuma emitida desde Licitank, OC propia vigente, línea de una OC de Obuma asignada al negocio o compra rápida aprobada. */
export async function hayCompraRegistrada(negocioId: number): Promise<boolean> {
  const n = await Promise.all([
    contar('SELECT COUNT(*) n FROM compras_orden_compra_obuma WHERE negocio_id = ?', negocioId),
    contar("SELECT COUNT(*) n FROM compras_oc_propia WHERE negocio_id = ? AND estado <> 'ANULADA'", negocioId),
    contar('SELECT COUNT(*) n FROM compras_oc_linea_negocio WHERE negocio_id = ? AND cantidad_negocio > 0', negocioId),
    contar("SELECT COUNT(*) n FROM compras_compra_rapida WHERE negocio_id = ? AND estado = 'APROBADA'", negocioId),
  ]);
  return n.some(x => x > 0);
}

export async function hayEntregaFirmada(negocioId: number): Promise<boolean> {
  return (await contar('SELECT COUNT(*) n FROM compras_entrega WHERE negocio_id = ? AND (acta_firma_nombre IS NOT NULL OR guia_firma_nombre IS NOT NULL)', negocioId)) > 0;
}

export async function hayFacturaVenta(negocioId: number): Promise<boolean> {
  return (await contar('SELECT COUNT(*) n FROM compras_factura_venta WHERE negocio_id = ?', negocioId)) > 0;
}
