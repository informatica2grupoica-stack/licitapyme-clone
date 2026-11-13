// app/lib/compras-guia-despacho-obuma.ts
// Guía de despacho (DTE 52) en Obuma, armada con las líneas de una OC de Obuma (ya traen el SKU/producto del proveedor).
// En Obuma las guías son «ventas» tipo 52 (ventas.list.json trae venta_tipo_dcto = 52, venta_guia_* chofer/patente/traslado).
// ESTADO (13-nov-2026): solo SIMULACIÓN. No está confirmado que la API permita crearlas (ventas.create.json) ni sus campos:
// hay que confirmarlo con el soporte de Obuma. Hasta entonces, sin OBUMA_SIMULAR=1 NO se envía nada.
import pool from '@/app/lib/db';
import { listarComprasOcItems } from '@/app/lib/obuma';

export interface LineaGuia { productoIdObuma: string; sku: string | null; nombre: string; cantidad: number; precioNeto: number; subtotalNeto: number }
export interface GuiaDespachoBorrador { folioOc: string; lineas: LineaGuia[]; totalNeto: number }

/** Líneas de la guía = ítems de la OC de Obuma (mismos productos, SKU y cantidades). */
export async function armarGuiaDesdeOcObuma(folioOc: string): Promise<GuiaDespachoBorrador> {
  const folio = String(folioOc || '').trim();
  if (!folio) throw new Error('Falta el folio de la orden de compra.');
  const r = await listarComprasOcItems({ folio_dcto: folio, limit: 500 });
  // folio_dcto podría no filtrar en esta cuenta (patrón ya visto en otros endpoints): se vuelve a filtrar acá.
  const items = (r.data || []).filter(i => String(i.compra_oc_folio) === folio);
  if (!items.length) throw new Error(`Obuma no devolvió ítems para la OC ${folio}.`);
  const lineas = items.map(i => {
    const cantidad = Number(i.cantidad) || 0;
    const precioNeto = Math.round(Number(i.precio) || 0);
    return {
      productoIdObuma: String(i.producto_id),
      sku: i.codigo_comercial ? String(i.codigo_comercial) : null,   // en Obuma el SKU es `codigo_comercial` (OC 4054: 6027000230)
      nombre: String(i.producto_nombre || '').trim(),
      cantidad, precioNeto, subtotalNeto: Math.round(cantidad * precioNeto),
    };
  });
  return { folioOc: folio, lineas, totalNeto: lineas.reduce((s, l) => s + l.subtotalNeto, 0) };
}

/** Envía la guía a Obuma. Solo simulación hasta confirmar el endpoint real. */
export async function crearGuiaDespachoObuma(g: GuiaDespachoBorrador): Promise<{ simulada: true; folio: string }> {
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
