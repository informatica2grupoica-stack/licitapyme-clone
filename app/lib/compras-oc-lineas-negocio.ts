// app/lib/compras-oc-lineas-negocio.ts
// «Unidades para este negocio» (migration-184). Una OC de Obuma puede traer más unidades de las que se venden en la licitación
// (negocio 256: la OC 3811 trae 2 rodillos y solo se vende 1). El costo del negocio descuenta las unidades que no son suyas: quedan
// como inventario / otro negocio. Solo cambia lo que Licitank cuenta; en Obuma no se toca nada.
// Si la tabla no existe todavía (migración sin aplicar), todo se comporta como antes: ningún ajuste.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';

export interface AjusteLineaOc { cantidadTotal: number; cantidadNegocio: number; nota: string | null }

export const claveLineaOc = (compraOcId: string | number, lineaId: string | number) => `${compraOcId}#${lineaId}`;

/** Ajustes guardados para el negocio de esta licitación, por «compraOcId#lineaId». Sin tabla o sin negocio: vacío. */
export async function ajustesDeLicitacion(licitacionCodigo: string): Promise<Map<string, AjusteLineaOc>> {
  const mapa = new Map<string, AjusteLineaOc>();
  try {
    const [rows] = await pool.query(
      `SELECT l.compra_oc_id, l.linea_id, l.cantidad_total, l.cantidad_negocio, l.nota
         FROM compras_oc_linea_negocio l JOIN negocios n ON n.id = l.negocio_id WHERE n.licitacion_codigo = ?`,
      [licitacionCodigo]) as any;
    for (const r of rows as any[]) mapa.set(claveLineaOc(r.compra_oc_id, r.linea_id), { cantidadTotal: Number(r.cantidad_total), cantidadNegocio: Number(r.cantidad_negocio), nota: r.nota ?? null });
  } catch { /* tabla sin crear: sin ajustes */ }
  return mapa;
}

/** Guarda cuántas unidades de una línea de OC son de este negocio. Igual al total = quita el ajuste. Lanza Error con mensaje para mostrar. */
export async function guardarUnidadesDelNegocio(
  negocioId: number, compraOcId: string, lineaId: string, cantidadNegocio: number, nota: string | null, actorId: number, actorNombre: string | null,
): Promise<{ cantidadTotal: number; cantidadNegocio: number }> {
  if (!Number.isFinite(cantidadNegocio) || cantidadNegocio < 0) throw new Error('Las unidades de este negocio deben ser un número desde 0.');
  const [[neg]]: any = await pool.query(`SELECT licitacion_codigo, cliente_id FROM negocios WHERE id = ? LIMIT 1`, [negocioId]);
  if (!neg) throw new Error('Negocio no encontrado.');
  const [[oc]]: any = await pool.query(`SELECT folio, licitacion_codigo, items_json FROM obuma_compras WHERE compra_oc_id = ? LIMIT 1`, [compraOcId]);
  if (!oc || oc.licitacion_codigo !== neg.licitacion_codigo) throw new Error('Esa orden de compra no pertenece a este negocio.');
  let linea: any = null;
  try { linea = (JSON.parse(oc.items_json || '[]') as any[]).find(it => String(it.cod_id) === String(lineaId)); } catch { /* items_json corrupto */ }
  if (!linea) throw new Error('No encuentro esa línea en la orden de compra.');
  const total = Number(linea.cantidad);
  if (!(total > 0)) throw new Error('La línea no tiene cantidad.');
  if (cantidadNegocio > total) throw new Error(`La orden trae ${total} unidad(es): no puedes asignar ${cantidadNegocio} a este negocio.`);
  const detalle = `«${String(linea.producto_nombre || 'línea').slice(0, 60)}» de la OC ${oc.folio}`;
  if (cantidadNegocio === total) {
    await pool.query(`DELETE FROM compras_oc_linea_negocio WHERE negocio_id = ? AND compra_oc_id = ? AND linea_id = ?`, [negocioId, compraOcId, lineaId]);
  } else {
    const ahora = ahoraChileSQL();
    await pool.query(
      `INSERT INTO compras_oc_linea_negocio (cliente_id, negocio_id, compra_oc_id, linea_id, cantidad_total, cantidad_negocio, nota, actor_id, actor_nombre, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE cantidad_total = VALUES(cantidad_total), cantidad_negocio = VALUES(cantidad_negocio), nota = VALUES(nota),
                               actor_id = VALUES(actor_id), actor_nombre = VALUES(actor_nombre), updated_at = VALUES(updated_at)`,
      [Number(neg.cliente_id) || 1, negocioId, compraOcId, lineaId, total, cantidadNegocio, nota ? nota.slice(0, 300) : null, actorId, actorNombre, ahora, ahora]);
  }
  await registrarEvento({
    tipo: 'COMPRAS_OC_UNIDADES_NEGOCIO', licitacionCodigo: neg.licitacion_codigo, actorId, actorNombre,
    mensaje: cantidadNegocio === total
      ? `Todas las unidades (${total}) de ${detalle} cuentan para este negocio.`
      : `De ${total} unidades de ${detalle}, ${cantidadNegocio} son de este negocio; el resto no suma a su costo${nota ? ` (${nota})` : ''}.`,
    metadata: { negocio_id: negocioId, compra_oc_id: compraOcId, linea_id: lineaId, cantidad_total: total, cantidad_negocio: cantidadNegocio, nota },
  }).catch(() => {});
  return { cantidadTotal: total, cantidadNegocio };
}
