// app/lib/compras-obuma-cierre.ts
// Datos de Obuma de las licitaciones cerradas/canceladas (11-nov-2026): para que su fila en Compras no salga vacía.
// Solo lectura y sin llamar a Obuma: usa el snapshot de proyectos (obuma_proyectos_snapshot) y las OC ya sincronizadas (obuma_compras).
import pool from '@/app/lib/db';
import { listarProyectosObuma } from '@/app/lib/compras-proyectos-obuma';

export interface FacturaDeOc { tipo: string; folio: string; total: number | null; fecha: string | null; proveedor: string | null; xml: string | null }

export interface ObumaDeCerrada {
  proyecto: {
    folio: number | null; estado: string | null; nombre: string | null; cliente: string | null; fechaIngreso: string | null;
    presupuesto: number | null; costo: number | null; precioNeto: number | null; facturadoMonto: number | null;
    totalGastado: number; cantidadOc: number; totalFacturado: number; cantidadFacturas: number;
  } | null;
  ocs: { folio: string | null; fecha: string | null; estado: string | null; proveedor: string | null; total: number; facturas: FacturaDeOc[] }[];
  totalOc: number;
  /** Documentos contabilizados en el centro de costo del proyecto (facturas de compra, notas de crédito, gastos propios). */
  documentos: { folio: string; tipo: string; proveedor: string | null; total: number; fecha: string | null; observacion: string | null }[];
}

const num = (v: any): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function facturasDe(json: string | null): FacturaDeOc[] {
  if (!json) return [];
  try {
    const j = JSON.parse(json);
    return Array.isArray(j) ? j.map((f: any) => ({
      tipo: String(f.tipoDcto ?? ''), folio: String(f.folioDte ?? ''), total: num(f.total), fecha: f.fecha ? String(f.fecha).slice(0, 10) : null,
      proveedor: f.proveedorRazonSocial ?? null, xml: f.s3Link ?? null,
    })) : [];
  } catch { return []; }
}

export async function obumaDeCerradas(items: { negocioId: number; licitacionCodigo: string }[]): Promise<Record<number, ObumaDeCerrada>> {
  const out: Record<number, ObumaDeCerrada> = {};
  if (!items.length) return out;
  let proyectos: Awaited<ReturnType<typeof listarProyectosObuma>>['proyectos'] = [];
  try { proyectos = (await listarProyectosObuma(false)).proyectos.filter(p => p.tieneProyectoReal); } catch (e) { console.warn('[compras-obuma-cierre] sin snapshot de proyectos:', String(e).slice(0, 150)); }
  const [oc] = await pool.query(
    `SELECT licitacion_codigo, folio, DATE_FORMAT(fecha_ingreso, '%Y-%m-%d') AS fecha, estado, proveedor_razon_social, total, facturas_json
       FROM obuma_compras WHERE licitacion_codigo IN (?) ORDER BY fecha_ingreso DESC`, [items.map(i => i.licitacionCodigo)]) as any;
  for (const it of items) {
    const k = it.licitacionCodigo.match(/^(\d+-\d+)/)?.[1];
    const re = k ? new RegExp(`(^|\\D)${k}-`) : null;
    const p = proyectos.find(x => x.negociosCoincidentes?.some(c => c.negocioId === it.negocioId) || (re && re.test(`${x.referencia ?? ''} ${x.nombre ?? ''}`)));
    const ocs = (oc as any[]).filter(o => o.licitacion_codigo === it.licitacionCodigo).map(o => ({
      folio: o.folio ?? null, fecha: o.fecha ?? null, estado: o.estado ?? null, proveedor: o.proveedor_razon_social ?? null,
      total: Number(o.total ?? 0), facturas: facturasDe(o.facturas_json),
    }));
    out[it.negocioId] = {
      proyecto: p ? {
        folio: p.folio, estado: p.estado, nombre: p.nombre, cliente: p.cliente, fechaIngreso: p.fechaIngreso?.slice(0, 10) ?? null,
        presupuesto: num(p.presupuesto), costo: num(p.costo), precioNeto: num(p.precioNeto), facturadoMonto: num(p.facturadoMonto),
        totalGastado: p.totalGastado, cantidadOc: p.cantidadOc, totalFacturado: p.totalFacturado, cantidadFacturas: p.cantidadFacturas,
      } : null,
      ocs, totalOc: ocs.reduce((s, o) => s + o.total, 0),
      documentos: (p?.documentos ?? []).map(d => ({ folio: d.folio, tipo: d.tipo, proveedor: d.proveedorNombre, total: d.total, fecha: d.fecha?.slice(0, 10) ?? null, observacion: d.observacion })),
    };
  }
  return out;
}
