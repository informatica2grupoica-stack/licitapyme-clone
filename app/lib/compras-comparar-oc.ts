// app/lib/compras-comparar-oc.ts
// COMPARACIÓN VISUAL DE UNA ORDEN DE COMPRA: lo que cotizó el proveedor (plan de Licitank), lo que quedó en
// la OC de Obuma y lo que facturó, lado a lado, todo NETO. Solo lectura. Las facturas se leen del XML que
// Obuma ya guardó (mismo origen que el visor de facturas); lo mal enlazado o duplicado se marca, no se oculta.
import { listarCotizaciones } from '@/app/lib/compras-auditor';
import { listarProductosCompra } from '@/app/lib/compras';
import { resumenGastosCompra } from '@/app/lib/compras-oc-obuma';
import { emparejarPlanConObuma } from '@/app/lib/compras-sku-obuma';
import { parsearFacturaXml } from '@/app/lib/factura-xml';
import { rutNormalizado } from '@/app/lib/ordenes-compra';
import { netoDeCompra } from '@/app/lib/obuma-compras';

export interface LineaCotizacion {
  producto: string; cantidad: number | null; precioUnit: number | null; precioBase: number | null;
  adicionales: { concepto: string; cantidad: number; precio: number }[]; subtotal: number | null;
}
export interface LineaOc { producto: string; sku: string | null; cantidad: number | null; precio: number | null; subtotal: number | null }
export interface LineaFactura { descripcion: string; cantidad: number | null; precio: number | null; monto: number | null }

export interface ComparacionOc {
  oc: {
    folio: string; compraOcId: string; proveedor: string | null; rut: string | null; estado: string | null; fecha: string | null;
    referencia: string | null; neto: number; iva: number; total: number; urlObuma: string; lineas: LineaOc[];
  };
  cotizaciones: {
    id: number; proveedor: string; origen: string; fecha: string | null; archivoUrl: string | null; plazo: string | null;
    flete: string | null; fleteNeto: number | null; lineas: LineaCotizacion[]; neto: number;
  }[];
  facturas: {
    dteId: string; folio: string; emisor: string | null; fecha: string | null; xmlUrl: string | null;
    estado: 'OK' | 'DUPLICADA' | 'MAL_ENLAZADA'; motivo: string | null;
    lineas: LineaFactura[]; neto: number | null; iva: number | null; total: number | null;
  }[];
  planProveedores: string[];
  avisos: string[];
}

const corto = (s: string) => s.replace(/\s+/g, ' ').trim().split(' - ')[0].slice(0, 90);
const FLETE: Record<string, string> = { PROVEEDOR: 'despacha el proveedor', RETIRO_PROPIO: 'lo retiramos nosotros', TRANSPORTISTA: 'transportista contratado', TIENDA: 'compra en tienda' };
const COND: Record<string, string> = { INCLUIDO: 'flete incluido', SIN_COSTO: 'sin costo', APARTE: 'flete cobrado aparte', POR_CONFIRMAR: 'flete por confirmar' };

export async function compararOrdenCompra(negocioId: number, ocFolio: string): Promise<ComparacionOc | null> {
  const [emp, cotizaciones, productos, gastos] = await Promise.all([
    emparejarPlanConObuma(negocioId), listarCotizaciones(negocioId), listarProductosCompra(negocioId), resumenGastosCompra(negocioId, null),
  ]);
  const oc = emp.ocs.find(o => (o.folio || o.compraOcId) === ocFolio);
  if (!oc) return null;
  const nombreProducto = new Map(productos.map(p => [p.id, corto(p.descripcion)]));
  const cantidadProducto = new Map(productos.map(p => [p.id, p.cantidad]));
  const pares = emp.pares.filter(p => p.oc.compraOcId === oc.compraOcId);
  const productosDeEstaOc = new Set(pares.map(p => p.item.productoId));
  const planProveedores = [...new Set(pares.map(p => p.grupo.proveedorNombre))];
  const rutOc = rutNormalizado(oc.proveedorRut);

  // Cotizaciones: las del proveedor del plan que cubren los productos de esta OC (si la OC no se pudo
  // emparejar con el plan, las del mismo RUT que la OC).
  const delPlan = cotizaciones.filter(c => planProveedores.includes(c.proveedorNombre) && c.items.some(i => productosDeEstaOc.has(i.productoId)));
  const candidatas = delPlan.length ? delPlan : cotizaciones.filter(c => rutOc && rutNormalizado(c.proveedorRut) === rutOc);
  const cotizs = candidatas.map(c => {
    const relevantes = c.items.filter(i => productosDeEstaOc.size === 0 || productosDeEstaOc.has(i.productoId));
    const lineas: LineaCotizacion[] = relevantes.map(i => {
      const cant = cantidadProducto.get(i.productoId) ?? null;
      return {
        producto: nombreProducto.get(i.productoId) ?? `Producto #${i.productoId}`, cantidad: cant,
        precioUnit: i.precioUnitario, precioBase: i.precioBase,
        adicionales: i.adicionales.map(a => ({ concepto: a.concepto, cantidad: a.cantidad, precio: a.precioUnitario })),
        subtotal: i.precioUnitario != null && cant != null ? Math.round(i.precioUnitario * cant) : null,
      };
    });
    const fleteNeto = c.fleteCondicion === 'APARTE' || (c.incluyeFlete === false && (c.fleteMonto ?? 0) > 0) ? c.fleteMonto : null;
    const flete = c.despachoModalidad || c.fleteCondicion
      ? [c.despachoModalidad ? FLETE[c.despachoModalidad] : null, c.fleteCondicion ? COND[c.fleteCondicion] : null].filter(Boolean).join(' · ')
      : c.incluyeFlete === true ? 'flete incluido' : c.incluyeFlete === false ? (c.fleteMonto != null ? 'flete cobrado aparte' : 'flete por confirmar') : null;
    return {
      id: c.id, proveedor: c.proveedorNombre, origen: c.origen, fecha: c.tomadaAt?.slice(0, 10) ?? null, archivoUrl: c.archivoUrl,
      plazo: c.plazoEntregaTexto, flete, fleteNeto: fleteNeto ?? null, lineas,
      neto: Math.round(lineas.reduce((s, l) => s + (l.subtotal ?? 0), 0)),
    };
  });

  const descartadas = new Map(gastos.facturas.descartadas.map(d => [String(d.dteId), d.motivo]));
  const vistos = new Set<string>();
  const dtes = oc.facturas.filter(f => { const k = String(f.dteId || `${f.tipoDcto}#${f.folioDte}`); if (vistos.has(k)) return false; vistos.add(k); return true; });
  const facturas = await Promise.all(dtes.map(async f => {
    let lineas: LineaFactura[] = []; let neto: number | null = null; let iva: number | null = null; let total: number | null = f.total;
    if (f.s3Link) {
      try {
        const r = await fetch(f.s3Link, { signal: AbortSignal.timeout(15000) });
        const x = r.ok ? parsearFacturaXml(await r.text()) : null;
        if (x) {
          lineas = x.lineas.filter(l => (l.monto ?? 0) > 0 || l.precio != null).map(l => ({ descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, monto: l.monto }));
          neto = x.totales.neto; iva = x.totales.iva; total = x.totales.total ?? total;
        }
      } catch { /* sin XML legible: se muestra solo el total */ }
    }
    const motivo = descartadas.get(String(f.dteId)) ?? null;
    const estado: ComparacionOc['facturas'][number]['estado'] = !motivo ? 'OK' : /duplicada/i.test(motivo) ? 'DUPLICADA' : 'MAL_ENLAZADA';
    return { dteId: f.dteId, folio: f.folioDte, emisor: f.proveedorRazonSocial, fecha: f.fecha, xmlUrl: f.s3Link, estado, motivo, lineas, neto, iva, total };
  }));

  const netoOc = netoDeCompra(oc);
  const netoFactOk = facturas.filter(f => f.estado === 'OK').reduce((s, f) => s + (f.neto ?? (f.total != null ? Math.round(f.total / 1.19) : 0)), 0);
  const avisos: string[] = [];
  if (cotizs.length === 0) avisos.push('Esta OC no tiene una cotización asociada en el plan de compra (compra hecha fuera del plan o proveedor distinto).');
  if (facturas.length === 0) avisos.push('Esta OC todavía no tiene factura.');
  else if (netoFactOk && Math.abs(netoFactOk - netoOc) > 1) avisos.push(`El neto facturado (${netoFactOk.toLocaleString('es-CL')}) no coincide con el de la OC (${netoOc.toLocaleString('es-CL')}).`);
  for (const c of cotizs) if (c.neto && Math.abs(c.neto + (c.fleteNeto ?? 0) - netoOc) > Math.max(2, netoOc * 0.001)) avisos.push(`La cotización #${c.id} suma ${(c.neto + (c.fleteNeto ?? 0)).toLocaleString('es-CL')} neto y la OC ${netoOc.toLocaleString('es-CL')}: precios o cantidades distintos.`);
  if (pares.some(p => !p.exacto)) avisos.push('El proveedor de la OC no es el del plan de compra.');

  return {
    oc: {
      folio: oc.folio || oc.compraOcId, compraOcId: oc.compraOcId, proveedor: oc.proveedorRazonSocial, rut: oc.proveedorRut, estado: oc.estado,
      fecha: oc.fechaIngreso, referencia: oc.referencia, neto: netoOc, iva: Math.round(oc.iva ?? 0), total: Math.round(oc.total ?? 0),
      urlObuma: `https://app.obuma.cl/obuma2.0/mod-compras/oc/iframe-main.php?id=${oc.compraOcId}`,
      lineas: oc.items.map(i => ({ producto: i.descripcion.replace(/\s+/g, ' ').trim(), sku: i.codigoComercial ?? null, cantidad: i.cantidad, precio: i.precio, subtotal: i.subtotal })),
    },
    cotizaciones: cotizs, facturas, planProveedores, avisos,
  };
}
