// app/lib/compras-compra-a-costeo.ts
// LA COMPRA ELEGIDA PASA AL COSTEO. Pedido del usuario (07-oct-2026): «si lo selecciono, ¿cómo se suben al costeo?». Hasta hoy no se subía
// nada: Compras tenía que teclear a mano, fila por fila, el «Costo unit. REAL» y su link. Ahora, con la compra elegida, un botón carga
//   · Costo unit. REAL  = precio neto por unidad del proveedor elegido (producto + adicionales; $0 si va incluido en otro producto);
//   · Link 1            = el de la fila si ya tenía; si no, el archivo de la cotización (el costeo exige un respaldo para todo costo real).
// Respeta la regla de siempre: Compras solo toca «costo real» y «links»; nada del costeo armado por los asistentes. El flete NO se carga
// aquí (va como «gasto extra»), y nada se pisa sin avisar: el plan dice qué cambia antes de hacerlo.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { listarProductosCompra, obtenerAsignacion, sincronizarProductosConCosteo } from '@/app/lib/compras';
import { listarCotizaciones } from '@/app/lib/compras-auditor';
import { cargarEstadoCosteo, auditarFilasCambiadasEnSegundoPlano } from '@/app/lib/auditor-compras';
import { lineasDelCosteo } from '@/app/lib/auditor-compras-core';
import { esLinkDeProducto } from '@/app/lib/costeo-comparativo';
import { seleccionDesdeClave } from '@/app/lib/compras-auditor';
import { publicarCambio } from '@/app/lib/sse-bus';
import type { EstadoCosteoEditor } from '@/app/lib/costeo-editor';

export type EstadoTraslado = 'CARGA' | 'IGUAL' | 'SIN_FILA' | 'SIN_LINK';

export interface LineaTraslado {
  productoId: number; descripcion: string; proveedor: string; cotizacionId: number;
  /** Costo neto por unidad que se cargaría ($0 si el producto va incluido en otro). */
  costoNeto: number; incluido: boolean;
  /** Lo que la fila del costeo tiene hoy como costo real (null = vacío). */
  anterior: number | null;
  filaId: string | null; link: string | null;
  estado: EstadoTraslado;
}

export interface PlanTraslado { hayCompraElegida: boolean; lineas: LineaTraslado[]; aviso: string | null }

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);

/** Qué cargaría al costeo la compra elegida hoy (sin tocar nada). */
export async function planTrasladoCompraAlCosteo(negocioId: number): Promise<PlanTraslado> {
  const [esc] = await pool.query(`SELECT detalle_json FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`, [negocioId]) as any;
  const fila = (esc as any[])[0];
  if (!fila) return { hayCompraElegida: false, lineas: [], aviso: 'Todavía no hay una compra elegida.' };
  let detalle: any = null;
  try { detalle = JSON.parse(fila.detalle_json); } catch { /* sin detalle legible */ }
  const porProducto: any[] = detalle?.porProducto || [];
  if (porProducto.length === 0) return { hayCompraElegida: true, lineas: [], aviso: 'La compra elegida no tiene detalle por producto.' };

  const [productos, cotizaciones, estado] = await Promise.all([listarProductosCompra(negocioId), listarCotizaciones(negocioId), cargarEstadoCosteo(negocioId)]);
  if (!estado) return { hayCompraElegida: true, lineas: [], aviso: 'Este negocio todavía no tiene un costeo guardado.' };
  const lineas = lineasDelCosteo(estado).filter(l => !l.esGastoExtra);
  const porClave = seleccionDesdeClave(detalle?.clave);

  const out: LineaTraslado[] = [];
  for (const d of porProducto) {
    const prod = productos.find(p => p.id === Number(d.productoId));
    if (!prod) continue;
    // La cotización elegida: por la clave exacta de la combinación; si es un escenario clásico (sin clave), por proveedor y precio.
    const cotId = porClave[prod.id];
    const cot = cotizaciones.find(c => (cotId != null ? c.id === cotId : c.proveedorNombre === d.proveedor && c.items.some(i => i.productoId === prod.id && i.precioUnitario === d.precioUnitario)));
    const item = cot?.items.find(i => i.productoId === prod.id);
    if (!cot || !item || item.precioUnitario == null) continue;

    const linea = lineas.find(l => prod.correlativo != null && l.lineaReal === prod.correlativo && lineas.filter(y => y.lineaReal === prod.correlativo).length === 1)
      ?? lineas.find(l => norm(l.detalle) === norm(String(prod.descripcion)));
    const link = linea?.links?.[0] ?? (esLinkDeProducto(cot.archivoUrl) ? cot.archivoUrl : null);
    const costoNeto = Math.round(item.precioUnitario);
    const incluido = item.precioBase === 0;
    const anterior = linea?.costoRealUnitario ?? null;
    out.push({
      productoId: prod.id, descripcion: prod.descripcion, proveedor: cot.proveedorNombre, cotizacionId: cot.id, costoNeto, incluido, anterior,
      filaId: linea?.id ?? null, link: link ?? null,
      estado: !linea ? 'SIN_FILA' : !link ? 'SIN_LINK' : anterior === costoNeto ? 'IGUAL' : 'CARGA',
    });
  }
  return { hayCompraElegida: true, lineas: out, aviso: null };
}

/** Carga al costeo lo que dice el plan (solo las líneas en estado CARGA). Devuelve cuántas cargó. */
export async function trasladarCompraAlCosteo(negocioId: number, actor: { id: number; nombre: string | null }): Promise<{ cargadas: number; omitidas: number }> {
  const plan = await planTrasladoCompraAlCosteo(negocioId);
  const aCargar = plan.lineas.filter(l => l.estado === 'CARGA' && l.filaId);
  if (aCargar.length === 0) return { cargadas: 0, omitidas: plan.lineas.length };

  const antes = await cargarEstadoCosteo(negocioId);
  if (!antes) throw new Error('Este negocio todavía no tiene un costeo guardado.');
  const despues: EstadoCosteoEditor = JSON.parse(JSON.stringify(antes));
  const porId = new Map(aCargar.map(l => [l.filaId as string, l]));
  for (const g of despues.grupos || []) for (const f of g.filas || []) {
    const l = porId.get(f.id);
    if (!l) continue;
    f.costoRealUnitario = l.costoNeto;
    if (!f.link1 && l.link) f.link1 = l.link;     // el costeo exige un respaldo para todo costo real
  }

  const ahora = ahoraChileSQL();
  await pool.query(
    `UPDATE negocio_costeo_editor SET datos_json = ?, actualizado_por = ?, actualizado_por_nombre = ?, actualizado_at = ? WHERE negocio_id = ?`,
    [JSON.stringify(despues), actor.id, actor.nombre, ahora, negocioId],
  );
  const [lic] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  await registrarEvento({
    tipo: 'COMPRAS_COSTEO_ACTUALIZADO', licitacionCodigo: (lic as any[])[0]?.licitacion_codigo ?? null, actorId: actor.id, actorNombre: actor.nombre,
    mensaje: `Se cargó al costeo la compra elegida: ${aCargar.map(l => `«${l.descripcion.slice(0, 40)}» $${l.costoNeto.toLocaleString('es-CL')} (${l.proveedor})`).join('; ')}.`,
    metadata: { negocio_id: negocioId, lineas: aCargar.map(l => ({ productoId: l.productoId, costoNeto: l.costoNeto, proveedor: l.proveedor, cotizacionId: l.cotizacionId })) },
  }).catch(() => {});
  // Mismo seguimiento que el guardado manual del costeo: se re-audita en segundo plano y se refresca lo derivado.
  obtenerAsignacion(negocioId).then(asig => {
    if (!asig) return;
    auditarFilasCambiadasEnSegundoPlano(negocioId, antes, despues, actor);
    return sincronizarProductosConCosteo(negocioId);
  }).catch(() => {});
  publicarCambio('compras');
  return { cargadas: aCargar.length, omitidas: plan.lineas.length - aCargar.length };
}
