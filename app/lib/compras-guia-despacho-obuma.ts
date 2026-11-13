// app/lib/compras-guia-despacho-obuma.ts
// Guía de despacho (DTE 52) en Obuma, armada con las líneas de una OC de Obuma (ya traen el SKU/producto del proveedor).
// En Obuma las guías son «ventas» tipo 52 (ventas.list.json trae venta_tipo_dcto = 52, venta_guia_* chofer/patente/traslado).
// ESTADO (13-nov-2026): solo SIMULACIÓN. No está confirmado que la API permita crearlas (ventas.create.json) ni sus campos:
// hay que confirmarlo con el soporte de Obuma. Hasta entonces, sin OBUMA_SIMULAR=1 NO se envía nada.
import pool from '@/app/lib/db';
import { listarComprasOcItems } from '@/app/lib/obuma';

// Precio de cada línea = precio de VENTA neto del costeo/acta (compras_producto.monto_unitario, el mismo que se manda al crear el SKU),
// NO el precio de compra de la OC (dueño, 13-nov-2026). Vínculo OC→producto del negocio: compras_sku.obuma_producto_id / código comercial.
export interface LineaGuia {
  productoIdObuma: string; sku: string | null; nombre: string; cantidad: number;
  precioCompraNeto: number;                    // referencia: lo que se paga al proveedor en la OC
  precioNeto: number | null;                   // precio de venta neto (costeo o escrito a mano); null = falta
  origenPrecio: 'costeo' | 'manual' | null;
  subtotalNeto: number;
}
export interface GuiaDespachoBorrador { folioOc: string; lineas: LineaGuia[]; totalNeto: number; faltanPrecios: number }

/** Precio de venta neto por producto de Obuma, sacado del costeo del negocio. */
async function preciosVentaDelNegocio(negocioId: number): Promise<{ porId: Map<string, number>; porCodigo: Map<string, number> }> {
  const [rows] = await pool.query(
    `SELECT s.obuma_producto_id, s.obuma_codigo_comercial, p.monto_unitario
       FROM compras_sku s JOIN compras_producto p ON p.id = s.producto_id AND p.negocio_id = s.negocio_id
      WHERE s.negocio_id = ? AND p.monto_unitario > 0`,
    [negocioId],
  ) as any;
  const porId = new Map<string, number>(), porCodigo = new Map<string, number>();
  for (const r of rows as any[]) {
    const v = Math.round(Number(r.monto_unitario));
    if (r.obuma_producto_id) porId.set(String(r.obuma_producto_id), v);
    if (r.obuma_codigo_comercial) porCodigo.set(String(r.obuma_codigo_comercial), v);
  }
  return { porId, porCodigo };
}

/** Borrador de la guía: productos, SKU y cantidades de la OC de Obuma; precios de venta del costeo.
 *  `preciosManual` (por productoIdObuma) solo rellena las líneas que el costeo no trae: nunca pisa el precio del costeo. */
export async function armarGuiaDesdeOcObuma(negocioId: number, folioOc: string, preciosManual: Record<string, unknown> = {}): Promise<GuiaDespachoBorrador> {
  const folio = String(folioOc || '').trim();
  if (!folio) throw new Error('Falta el folio de la orden de compra.');
  const [r, ventas] = await Promise.all([listarComprasOcItems({ folio_dcto: folio, limit: 500 }), preciosVentaDelNegocio(negocioId)]);
  // folio_dcto podría no filtrar en esta cuenta (patrón ya visto en otros endpoints): se vuelve a filtrar acá.
  const items = (r.data || []).filter(i => String(i.compra_oc_folio) === folio);
  if (!items.length) throw new Error(`Obuma no devolvió ítems para la OC ${folio}.`);
  const lineas: LineaGuia[] = items.map(i => {
    const cantidad = Number(i.cantidad) || 0;
    const productoIdObuma = String(i.producto_id);
    const sku = i.codigo_comercial ? String(i.codigo_comercial) : null;   // en Obuma el SKU es `codigo_comercial` (OC 4054: 6027000230)
    const delCosteo = ventas.porId.get(productoIdObuma) ?? (sku ? ventas.porCodigo.get(sku) : undefined) ?? null;
    const manual = Math.round(Number(preciosManual[productoIdObuma]));
    const precioNeto = delCosteo ?? (manual > 0 ? manual : null);
    return {
      productoIdObuma, sku, nombre: String(i.producto_nombre || '').trim(), cantidad,
      precioCompraNeto: Math.round(Number(i.precio) || 0),
      precioNeto, origenPrecio: delCosteo != null ? 'costeo' : precioNeto != null ? 'manual' : null,
      subtotalNeto: precioNeto != null ? Math.round(cantidad * precioNeto) : 0,
    };
  });
  return {
    folioOc: folio, lineas,
    totalNeto: lineas.reduce((s, l) => s + l.subtotalNeto, 0),
    faltanPrecios: lineas.filter(l => l.precioNeto == null).length,
  };
}

/** Envía la guía a Obuma. Solo simulación hasta confirmar el endpoint real. */
export async function crearGuiaDespachoObuma(g: GuiaDespachoBorrador): Promise<{ simulada: true; folio: string }> {
  if (g.faltanPrecios > 0) throw new Error(`Faltan ${g.faltanPrecios} precio(s) de venta: complétalos en el borrador o en el costeo.`);
  if (process.env.OBUMA_SIMULAR !== '1')
    throw new Error('La creación de guías en Obuma aún no está habilitada (falta confirmar con Obuma que la API de ventas acepte guías tipo 52).');
  console.warn('[obuma][SIMULADO] ventas.create guía 52', JSON.stringify(g).slice(0, 800));
  return { simulada: true, folio: `SIM-GUIA-${Date.now() % 100000}` };
}

// Obuma de Grupo ICA funciona solo con Inversiones Claro (dueño, 13-nov-2026): las guías se ofrecen únicamente en sus negocios.
const RUT_CLARO = '769026592';
export async function negocioEsDeClaro(negocioId: number): Promise<boolean> {
  const [rows] = await pool.query(`SELECT e.rut FROM negocios n JOIN empresas e ON e.id = n.empresa_id WHERE n.id = ? LIMIT 1`, [negocioId]) as any;
  return String((rows as any[])[0]?.rut || '').replace(/[^0-9kK]/g, '').toUpperCase() === RUT_CLARO;
}

/** OC del negocio con folio de Obuma (las que sirven de base para una guía). */
export async function ocsParaGuia(negocioId: number): Promise<{ folio: string; proveedor: string; total: number; lineas: number }[]> {
  const { ordenesCompraParaVista } = await import('@/app/lib/compras-oc-obuma');   // dinámico: evita ciclos de importación
  const ocs = await ordenesCompraParaVista(negocioId);
  return ocs.filter(o => o.folio).map(o => ({ folio: String(o.folio), proveedor: o.proveedorNombre, total: o.total, lineas: o.items.length }));
}
