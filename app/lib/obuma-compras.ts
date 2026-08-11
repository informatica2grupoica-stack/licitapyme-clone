// app/lib/obuma-compras.ts
// Cruce: compras de Obuma (nuestro ERP, lo que PAGAMOS) ↔ licitaciones que ofertamos. Es el otro
// lado de app/lib/ordenes-compra.ts (la orden de compra de Mercado Público, lo que nos PAGAN).
//
// CÓMO SE ENCUENTRAN (probado en vivo, 11-ago-2026 — ver docs/migration-66-obuma-compras.sql para
// el porqué del diseño): Obuma no tiene un módulo "Proyectos" accesible (v2.0 no está operativa,
// /proyectos.list.json da 404 incluso en v1.0), así que no hay forma de cruzar por centro_costo.
// Lo que SÍ funciona: comprasOc.list.json trae `compra_oc_referencia`, un campo de texto libre
// donde alguien en Obuma escribe a mano el código de la licitación al crear la orden de compra
// ("PR-177 ID1471-8-LE26 DGAC"). Se cruza con mencionaCodigo(), la misma función que ya resuelve
// el mismo problema del lado de Mercado Público — no hace falta un matcher nuevo.
//
// Solo se guardan las compras que SÍ mencionan una licitación nuestra: esto no es un espejo del
// ERP completo (~16.700 compras en la cuenta), es la vista cruzada que pidió el usuario.
import pool from '@/app/lib/db';
import { listarComprasOc, listarComprasOcItems, listarComprasDte, proveedorPorId, type ObumaCompraOc } from '@/app/lib/obuma';
import { mencionaCodigo, licitacionesOfertadas } from '@/app/lib/ordenes-compra';

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? n : null;
}

function fechaMySQL(v: unknown): string | null {
  const s = String(v || '').trim();
  if (!s || s.startsWith('0000-00-00')) return null;
  const d = new Date(s.replace(' ', 'T'));
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Cuántas páginas de comprasOc.list.json barrer (limit=100/página, ~3900 compras totales a
// ago-2026 → 39 páginas cubre TODO el historial). La API entrega más reciente primero, así que un
// barrido corto (ver `paginas` en sincronizarComprasObuma) alcanza para el cron diario: las compras
// nuevas siempre están arriba.
const LIMITE_POR_PAGINA = 100;
const PAUSA_MS = 300;   // Obuma no documenta un límite de tasa, pero se va con calma igual
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface FacturaObuma {
  tipoDcto: string; folioDte: string; dteId: string;
  total: number | null; fecha: string | null;
  proveedorRazonSocial: string | null; proveedorRut: string | null;
  s3Link: string | null;   // XML real de la factura, descarga directa (link público de Obuma)
}

export interface ResumenSyncObuma {
  paginasBarridas: number;
  vistas: number;
  candidatas: number;
  nuevasOActualizadas: number;
}

/**
 * Barre comprasOc.list.json (más reciente primero) buscando menciones a licitaciones que ya
 * ofertamos, y guarda/actualiza las que encuentra. Pensado para el cron diario: `paginas` chico
 * (ej. 5 = últimas 500 compras) alcanza para el día a día; un `paginas` grande sirve para el
 * backfill inicial.
 */
export async function sincronizarComprasObuma(
  { paginas = 5 }: { paginas?: number } = {},
): Promise<ResumenSyncObuma> {
  const resumen: ResumenSyncObuma = { paginasBarridas: 0, vistas: 0, candidatas: 0, nuevasOActualizadas: 0 };
  const nuestras = await licitacionesOfertadas();
  if (nuestras.size === 0) return resumen;
  const codigos = [...nuestras.keys()];

  const candidatas: ObumaCompraOc[] = [];
  for (let page = 1; page <= paginas; page++) {
    let lote: ObumaCompraOc[];
    try {
      const r = await listarComprasOc({ limit: LIMITE_POR_PAGINA, page });
      lote = r.data || [];
    } catch (err) {
      console.warn(`[obuma-compras] página ${page} falló:`, String(err).slice(0, 150));
      break;
    }
    resumen.paginasBarridas++;
    if (lote.length === 0) break;
    resumen.vistas += lote.length;
    for (const c of lote) {
      const ref = c.compra_oc_referencia || '';
      if (codigos.some(cod => mencionaCodigo(ref, cod))) candidatas.push(c);
    }
    await dormir(PAUSA_MS);
  }
  resumen.candidatas = candidatas.length;
  if (candidatas.length === 0) return resumen;

  // Proveedor: se resuelve una vez por id y se cachea en memoria para esta corrida — varias
  // compras de la misma licitación casi siempre son del mismo proveedor.
  const proveedorCache = new Map<string, { rut: string | null; razonSocial: string | null }>();
  const resolverProveedor = async (id: string) => {
    if (!id || id === '0') return { rut: null, razonSocial: null };
    if (proveedorCache.has(id)) return proveedorCache.get(id)!;
    try {
      const p = await proveedorPorId(id);
      const datos = { rut: p?.proveedor_rut || null, razonSocial: p?.proveedor_razon_social || null };
      proveedorCache.set(id, datos);
      return datos;
    } catch {
      return { rut: null, razonSocial: null };
    }
  };

  // Factura(s) real(es) — ver docs/migration-67-obuma-facturas.sql para el porqué. Solo cuando la
  // OC está facturada: `compra_oc_facturada_tipo_dcto` trae "tipo#folio" por cada documento
  // (varias, separadas por coma, si son varias facturas para la misma OC — probado en vivo).
  const resolverFacturas = async (c: ObumaCompraOc): Promise<FacturaObuma[]> => {
    const crudo = String(c.compra_oc_facturada_tipo_dcto || '').trim();
    if (!crudo) return [];
    const pares = crudo.split(',').filter(Boolean);
    const facturas: FacturaObuma[] = [];
    for (const par of pares) {
      const [tipoDcto, folioDte] = par.split('#');
      if (!tipoDcto || !folioDte) continue;
      try {
        const r = await listarComprasDte({ tipo_dcto: tipoDcto, folio_dcto: folioDte });
        const dte = r.data?.[0];
        if (dte) {
          facturas.push({
            tipoDcto, folioDte, dteId: dte.dte_id,
            total: num(dte.dte_total), fecha: dte.dte_fecha || null,
            proveedorRazonSocial: dte.dte_razonsocial_emisor || null, proveedorRut: dte.dte_rut_emisor || null,
            s3Link: dte.s3_link || null,
          });
        }
      } catch (err) {
        console.warn(`[obuma-compras] factura ${tipoDcto}#${folioDte} de OC ${c.compra_oc_folio} falló:`, String(err).slice(0, 120));
      }
      await dormir(PAUSA_MS);
    }
    return facturas;
  };

  for (const c of candidatas) {
    const referencia = c.compra_oc_referencia || '';
    const licitacionCodigo = codigos.find(cod => mencionaCodigo(referencia, cod)) || null;
    const negocio = licitacionCodigo ? nuestras.get(licitacionCodigo) : undefined;
    const proveedor = await resolverProveedor(c.rel_proveedor_id);

    let items: unknown = null;
    try {
      const r = await listarComprasOcItems({ folio_dcto: c.compra_oc_folio, limit: 200 });
      items = r.data || [];
    } catch (err) {
      console.warn(`[obuma-compras] ítems de OC ${c.compra_oc_folio} fallaron:`, String(err).slice(0, 120));
    }
    await dormir(PAUSA_MS);

    const facturas = await resolverFacturas(c);

    await pool.query(
      `INSERT INTO obuma_compras
         (compra_oc_id, folio, fecha_ingreso, referencia, licitacion_codigo, empresa_id,
          estado, centro_costo, subtotal, neto, iva, total,
          proveedor_id, proveedor_rut, proveedor_razon_social, items_json, facturas_json, raw_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         folio = VALUES(folio), fecha_ingreso = VALUES(fecha_ingreso),
         referencia = VALUES(referencia),
         licitacion_codigo = COALESCE(licitacion_codigo, VALUES(licitacion_codigo)),
         empresa_id = COALESCE(empresa_id, VALUES(empresa_id)),
         estado = VALUES(estado), centro_costo = VALUES(centro_costo),
         subtotal = VALUES(subtotal), neto = VALUES(neto), iva = VALUES(iva), total = VALUES(total),
         proveedor_id = VALUES(proveedor_id), proveedor_rut = VALUES(proveedor_rut),
         proveedor_razon_social = VALUES(proveedor_razon_social),
         items_json = VALUES(items_json), facturas_json = VALUES(facturas_json), raw_json = VALUES(raw_json)`,
      [
        c.compra_oc_id, c.compra_oc_folio || null, fechaMySQL(c.compra_oc_fecha_ingreso),
        referencia || null, licitacionCodigo, negocio?.empresa_id ?? null,
        c.compra_oc_estado || null, c.compra_oc_centro_costo || null,
        num(c.compra_oc_subtotal), num(c.compra_oc_neto), num(c.compra_oc_iva), num(c.compra_oc_total),
        c.rel_proveedor_id || null, proveedor.rut, proveedor.razonSocial,
        items ? JSON.stringify(items) : null,
        facturas.length ? JSON.stringify(facturas) : null,
        JSON.stringify(c),
      ],
    );
    resumen.nuevasOActualizadas++;
  }

  return resumen;
}

export interface ItemCompraObuma { descripcion: string; cantidad: number | null; precio: number | null; subtotal: number | null }
export interface CompraObumaFila {
  compraOcId: string;
  folio: string | null;
  fechaIngreso: string | null;
  referencia: string | null;
  estado: string | null;
  subtotal: number | null;
  neto: number | null;
  iva: number | null;
  total: number | null;
  proveedorRut: string | null;
  proveedorRazonSocial: string | null;
  items: ItemCompraObuma[];
  facturas: FacturaObuma[];
}

function itemsDesdeJson(json: string | null): ItemCompraObuma[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as any[];
    return arr.map(it => ({
      descripcion: it.producto_nombre || it.producto_descripcion || '',
      cantidad: num(it.cantidad), precio: num(it.precio), subtotal: num(it.subtotal),
    }));
  } catch { return []; }
}

function facturasDesdeJson(json: string | null): FacturaObuma[] {
  if (!json) return [];
  try { return JSON.parse(json) as FacturaObuma[]; } catch { return []; }
}

/** Compras de Obuma ya guardadas para una licitación — no llama a la API, lee de obuma_compras. */
export async function comprasObumaDeLicitacion(codigo: string): Promise<CompraObumaFila[]> {
  const [rows] = await pool.query(
    `SELECT * FROM obuma_compras WHERE licitacion_codigo = ? ORDER BY fecha_ingreso DESC`,
    [codigo],
  ) as any[];
  return (rows as any[]).map(r => ({
    compraOcId: r.compra_oc_id,
    folio: r.folio,
    fechaIngreso: r.fecha_ingreso,
    referencia: r.referencia,
    estado: r.estado,
    subtotal: r.subtotal != null ? Number(r.subtotal) : null,
    neto: r.neto != null ? Number(r.neto) : null,
    iva: r.iva != null ? Number(r.iva) : null,
    total: r.total != null ? Number(r.total) : null,
    proveedorRut: r.proveedor_rut,
    proveedorRazonSocial: r.proveedor_razon_social,
    items: itemsDesdeJson(r.items_json),
    facturas: facturasDesdeJson(r.facturas_json),
  }));
}
