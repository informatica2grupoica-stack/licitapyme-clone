// BANDEJA DE APROBACIÓN · parte de COMPRAS: todo lo que Compras mandó a aprobar y espera la decisión del jefe de ventas, de todos los negocios,
// para mostrarlo en /aprobaciones junto a lo del Auditor. Cada ítem trae el link EXACTO de donde se decide (negocio + paso + producto).
// Solo lectura: lo que se decide sigue siendo lo mismo de siempre (compuertas, aprobación por producto, compra rápida).
import pool from '@/app/lib/db';

export type TipoItemCompras = 'COMPRA_RAPIDA' | 'COMPRA' | 'MARGEN' | 'PRODUCTO_CORREGIDO' | 'RENUNCIA';

export interface ItemBandejaCompras {
  id: string;
  tipo: TipoItemCompras;
  negocioId: number; licitacionCodigo: string | null; licitacionNombre: string | null;
  productoId: number | null; productoNombre: string | null;
  titulo: string; detalle: string;
  /** Los datos clave ya separados (etiqueta/valor) para mostrarlos ordenados en la tarjeta. */
  hechos: { etiqueta: string; valor: string }[];
  solicitadoPorNombre: string | null; solicitadoAt: string | null;
  /** Compra rápida ya hecha en tienda (se ratifica). */
  yaComprada?: boolean;
  /** Dónde se decide: abre Compras directo en el paso (y producto) correcto. */
  ruta: string;
  /** Se puede aprobar/rechazar desde la propia bandeja (hoy solo la compra rápida; el resto se revisa en Compras con su tabla). */
  accionRapida: boolean;
}

const sinTabla = (e: any) => e?.code === 'ER_NO_SUCH_TABLE' || e?.code === 'ER_BAD_FIELD_ERROR';
const corto = (d: string | null) => (d || '').split(' - ')[0].slice(0, 90);
const clp = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const ruta = (negocioId: number, fase: string, productoId?: number | null) => `/compras/${negocioId}?fase=${fase}${productoId ? `&producto=${productoId}` : ''}`;

async function consulta(sql: string): Promise<any[]> {
  try { const [rows] = await pool.query(sql) as any; return rows as any[]; }
  catch (e: any) { if (sinTabla(e)) return []; throw e; }   // una tabla que falta (migración sin aplicar) no debe tumbar la bandeja
}

export async function construirBandejaCompras(): Promise<ItemBandejaCompras[]> {
  const items: ItemBandejaCompras[] = [];

  // 1. Compras rápidas pendientes (por producto).
  for (const r of await consulta(
    `SELECT r.negocio_id, r.producto_id, r.proveedor_nombre, r.proveedor_rut, r.precio_unitario, r.ya_comprada, r.solicitado_por_nombre,
            DATE_FORMAT(r.solicitado_at, '%Y-%m-%d %H:%i:%s') AS solicitado_at, p.descripcion, p.cantidad, n.licitacion_codigo, n.licitacion_nombre
       FROM compras_compra_rapida r JOIN compras_producto p ON p.id = r.producto_id JOIN negocios n ON n.id = r.negocio_id
      WHERE r.estado = 'PENDIENTE' AND n.activo = TRUE ORDER BY r.solicitado_at`)) {
    const ya = !!r.ya_comprada;
    items.push({
      id: `rapida:${r.negocio_id}:${r.producto_id}`, tipo: 'COMPRA_RAPIDA', negocioId: r.negocio_id,
      licitacionCodigo: r.licitacion_codigo, licitacionNombre: r.licitacion_nombre, productoId: r.producto_id, productoNombre: corto(r.descripcion),
      titulo: `${ya ? 'Compra rápida ya hecha' : 'Compra rápida por aprobar'}: ${corto(r.descripcion)}`,
      detalle: `${r.proveedor_nombre} · RUT ${r.proveedor_rut} · ${clp(Number(r.precio_unitario))} neto c/u${r.cantidad ? ` · ${Number(r.cantidad)} un.` : ''}${ya ? ' · se ratifica' : ' · aprobar ANTES de comprar'}`,
      hechos: [{ etiqueta: 'Tienda', valor: String(r.proveedor_nombre) }, { etiqueta: 'RUT', valor: String(r.proveedor_rut) }, { etiqueta: 'Precio neto c/u', valor: clp(Number(r.precio_unitario)) },
        ...(r.cantidad ? [{ etiqueta: 'Cantidad', valor: `${Number(r.cantidad)} un.` }] : []), { etiqueta: 'Compra', valor: ya ? 'Ya hecha (se ratifica)' : 'Por hacer (aprobar antes)' }],
      solicitadoPorNombre: r.solicitado_por_nombre, solicitadoAt: r.solicitado_at, yaComprada: ya,
      ruta: ruta(r.negocio_id, 'aprobacion', r.producto_id), accionRapida: true,
    });
  }

  // 2. Compuertas propuestas: la compra elegida (cuadro comparativo) y el margen.
  for (const r of await consulta(
    `SELECT a.negocio_id, a.tipo, a.detalle_json, a.motivo, a.propuesto_por_nombre, DATE_FORMAT(a.propuesto_at, '%Y-%m-%d %H:%i:%s') AS propuesto_at,
            n.licitacion_codigo, n.licitacion_nombre
       FROM compras_aprobacion a JOIN negocios n ON n.id = a.negocio_id
      WHERE a.estado = 'PENDIENTE' AND a.propuesto_at IS NOT NULL AND n.activo = TRUE ORDER BY a.propuesto_at`)) {
    let d: any = null;
    try { d = r.detalle_json ? JSON.parse(r.detalle_json) : null; } catch { /* snapshot ilegible: se muestra sin cifras */ }
    const esCompra = r.tipo === 'COMPRA';
    items.push({
      id: `${esCompra ? 'compra' : 'margen'}:${r.negocio_id}`, tipo: esCompra ? 'COMPRA' : 'MARGEN', negocioId: r.negocio_id,
      licitacionCodigo: r.licitacion_codigo, licitacionNombre: r.licitacion_nombre, productoId: null, productoNombre: null,
      titulo: esCompra ? 'Compra completa por aprobar (cuadro comparativo)' : 'Margen por aprobar',
      detalle: esCompra
        ? `${d?.costoTotal != null ? `Costo total ${clp(Number(d.costoTotal))}` : 'Compra elegida'}${d?.escenarioTipo ? ` · escenario ${String(d.escenarioTipo).toLowerCase()}` : ''}${r.motivo ? ` · «${String(r.motivo).slice(0, 80)}»` : ''}`
        : `${d?.margenPct != null ? `Margen previsto ${d.margenPct}%` : 'Margen previsto'}${d?.ventaNeta != null ? ` · venta ${clp(Number(d.ventaNeta))}` : ''}${r.motivo ? ` · «${String(r.motivo).slice(0, 80)}»` : ''}`,
      hechos: esCompra
        ? [...(d?.costoTotal != null ? [{ etiqueta: 'Costo total', valor: clp(Number(d.costoTotal)) }] : []), ...(d?.escenarioTipo ? [{ etiqueta: 'Escenario', valor: String(d.escenarioTipo).toLowerCase().replace(/_/g, ' ') }] : []),
           ...(d?.excedePresupuestoPct ? [{ etiqueta: 'Sobre el presupuesto', valor: `${d.excedePresupuestoPct}%` }] : []), ...(r.motivo ? [{ etiqueta: 'Motivo', valor: String(r.motivo).slice(0, 120) }] : [])]
        : [...(d?.margenPct != null ? [{ etiqueta: 'Margen previsto', valor: `${d.margenPct}%` }] : []), ...(d?.ventaNeta != null ? [{ etiqueta: 'Venta neta', valor: clp(Number(d.ventaNeta)) }] : []),
           ...(d?.costoNeto != null ? [{ etiqueta: 'Costo neto', valor: clp(Number(d.costoNeto)) }] : []), ...(r.motivo ? [{ etiqueta: 'Motivo', valor: String(r.motivo).slice(0, 120) }] : [])],
      solicitadoPorNombre: r.propuesto_por_nombre, solicitadoAt: r.propuesto_at,
      ruta: ruta(r.negocio_id, 'aprobacion'), accionRapida: false,
    });
  }

  // 3. Productos que el encargado corrigió tras un rechazo y esperan una nueva revisión.
  for (const r of await consulta(
    `SELECT l.negocio_id, l.producto_id, l.corregido_por_nombre, l.nota_correccion, DATE_FORMAT(l.corregido_at, '%Y-%m-%d %H:%i:%s') AS corregido_at,
            p.descripcion, n.licitacion_codigo, n.licitacion_nombre
       FROM compras_aprobacion_linea l JOIN compras_producto p ON p.id = l.producto_id JOIN negocios n ON n.id = l.negocio_id
      WHERE l.estado = 'CORREGIDA' AND n.activo = TRUE ORDER BY l.corregido_at`)) {
    items.push({
      id: `corregido:${r.negocio_id}:${r.producto_id}`, tipo: 'PRODUCTO_CORREGIDO', negocioId: r.negocio_id,
      licitacionCodigo: r.licitacion_codigo, licitacionNombre: r.licitacion_nombre, productoId: r.producto_id, productoNombre: corto(r.descripcion),
      titulo: `Producto corregido, por revisar de nuevo: ${corto(r.descripcion)}`,
      detalle: r.nota_correccion ? `Lo que hizo: ${String(r.nota_correccion).slice(0, 140)}` : 'El encargado dice que ya lo corrigió.',
      hechos: r.nota_correccion ? [{ etiqueta: 'Lo que corrigió', valor: String(r.nota_correccion).slice(0, 160) }] : [],
      solicitadoPorNombre: r.corregido_por_nombre, solicitadoAt: r.corregido_at,
      ruta: ruta(r.negocio_id, 'aprobacion', r.producto_id), accionRapida: false,
    });
  }

  // 4. Renuncias a una línea propuestas por el encargado.
  for (const r of await consulta(
    `SELECT p.negocio_id, p.id AS producto_id, p.descripcion, p.renuncia_motivo, p.renuncia_propuesta_por_nombre,
            DATE_FORMAT(p.renuncia_propuesta_at, '%Y-%m-%d %H:%i:%s') AS propuesta_at, n.licitacion_codigo, n.licitacion_nombre
       FROM compras_producto p JOIN negocios n ON n.id = p.negocio_id
      WHERE p.renuncia_motivo IS NOT NULL AND p.renuncia_aprobada_at IS NULL AND p.subestado NOT IN ('RENUNCIADO', 'NO_ADJUDICADA') AND n.activo = TRUE
      ORDER BY p.renuncia_propuesta_at`)) {
    items.push({
      id: `renuncia:${r.negocio_id}:${r.producto_id}`, tipo: 'RENUNCIA', negocioId: r.negocio_id,
      licitacionCodigo: r.licitacion_codigo, licitacionNombre: r.licitacion_nombre, productoId: r.producto_id, productoNombre: corto(r.descripcion),
      titulo: `Renuncia a una línea por aprobar: ${corto(r.descripcion)}`,
      detalle: `Motivo: ${String(r.renuncia_motivo).slice(0, 140)}`,
      hechos: [{ etiqueta: 'Motivo de la renuncia', valor: String(r.renuncia_motivo).slice(0, 160) }],
      solicitadoPorNombre: r.renuncia_propuesta_por_nombre, solicitadoAt: r.propuesta_at,
      ruta: ruta(r.negocio_id, 'costeo', r.producto_id) + '&pestana=productos', accionRapida: false,
    });
  }

  return items.sort((a, b) => String(a.solicitadoAt || '').localeCompare(String(b.solicitadoAt || '')));
}
