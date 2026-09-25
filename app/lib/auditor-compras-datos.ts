// app/lib/auditor-compras-datos.ts
// Los pasos del PROMPT 5 que son del SISTEMA y no del modelo (0.3): S2 dólar, S3 historial del
// proveedor en MercadoPública, S4 búsqueda de referencias del mismo producto, S5 precios de mercado
// público. Todos devuelven "no hay datos" en vez de inventar cuando la fuente no responde.
import pool from '@/app/lib/db';
import { obtenerTipoCambio } from '@/app/lib/tipo-cambio';
import { buscarPrecioProducto } from '@/app/lib/buscador-precios';
import { mismoProductoPorTokens, type PrecioMercadoPublico } from '@/app/lib/auditor-compras-core';

const normRut = (v: unknown) => String(v || '').replace(/[^0-9kK]/g, '').toUpperCase();
function variantesRut(rut: string): string[] {
  const n = normRut(rut);
  if (n.length < 7) return [];
  const cuerpo = n.slice(0, -1), dv = n.slice(-1);
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return [...new Set([`${conPuntos}-${dv}`, `${cuerpo}-${dv}`, `${conPuntos}-${dv.toLowerCase()}`, `${cuerpo}-${dv.toLowerCase()}`])];
}

// ── RUT de NUESTRAS empresas ──────────────────────────────────────────────────────────────────────
// En las proformas y cotizaciones el RUT del COMPRADOR (nosotros) aparece junto al del proveedor; si el lector
// se equivoca, el "proveedor" queda con nuestro propio RUT (caso real PanTai en #994) y se le ve como competidor.
let cacheRutsPropios: { at: number; ruts: Set<string> } | null = null;
export async function rutsPropios(): Promise<Set<string>> {
  if (cacheRutsPropios && Date.now() - cacheRutsPropios.at < 5 * 60_000) return cacheRutsPropios.ruts;
  const ruts = new Set<string>();
  try {
    const [rows] = await pool.query(`SELECT rut FROM empresas WHERE rut IS NOT NULL AND rut <> ''`) as any;
    for (const r of rows as any[]) ruts.add(normRut(r.rut));
  } catch { /* sin tabla de empresas: no se filtra nada */ }
  cacheRutsPropios = { at: Date.now(), ruts };
  return ruts;
}
export async function esRutPropio(rut: string | null | undefined): Promise<boolean> {
  return !!rut && (await rutsPropios()).has(normRut(rut));
}

// ── S2 · Dólar ────────────────────────────────────────────────────────────────────────────────────
/** Dólar observado (Banco Central, vía mindicador.cl) del día + $10 — la regla del prompt (V5/Ruta B). */
export async function dolarDelDia(): Promise<{ observado: number | null; usado: number | null; fecha: string | null; fuente: string | null }> {
  const tc = await obtenerTipoCambio('USD').catch(() => null);
  if (!tc) return { observado: null, usado: null, fecha: null, fuente: null };
  return { observado: tc.valor, usado: Math.round((tc.valor + 10) * 100) / 100, fecha: tc.fecha, fuente: `${tc.fuente} (dólar observado BCCh) + $10` };
}

// ── S3 · Historial del proveedor en MercadoPública ────────────────────────────────────────────────
export interface HistorialProveedorMP {
  rut: string; venteAlEstado: boolean; nLicitaciones: number; nOrdenesCompra: number;
  rubros: string[]; ejemplos: Array<{ licitacion: string; producto: string; monto: number | null; fecha: string | null }>;
  fuente: string; limitacion: string;
}

/** ¿Este RUT vende al Estado? Se responde con la base propia: las actas de adjudicación cacheadas (toda
 *  licitación que el sistema ha mirado) y las órdenes de compra de MercadoPública que guarda el sistema.
 *  Es una muestra, no el universo de MercadoPública: la limitación se declara en el resultado. */
export async function historialProveedorMP(rut: string): Promise<HistorialProveedorMP | null> {
  const variantes = variantesRut(rut);
  if (variantes.length === 0) return null;
  const licitaciones = new Set<string>(); const rubros = new Map<string, number>();
  const ejemplos: HistorialProveedorMP['ejemplos'] = [];
  try {
    const cond = variantes.map(() => 'lineas LIKE ?').join(' OR ');
    const [rows] = await pool.query(
      `SELECT licitacion_codigo, lineas, DATE_FORMAT(fecha_adjudicacion, '%Y-%m-%d') AS fecha
         FROM adjudicacion_cache WHERE es_adjudicada = 1 AND (${cond}) ORDER BY fecha_adjudicacion DESC LIMIT 80`,
      variantes.map(v => `%${v}%`),
    ) as any;
    for (const r of rows as any[]) {
      let lineas: any[] = []; try { lineas = JSON.parse(r.lineas || '[]'); } catch { continue; }
      for (const l of lineas) {
        if (normRut(l.rutProveedor) !== normRut(rut)) continue;
        licitaciones.add(r.licitacion_codigo);
        const prod = String(l.producto || l.descripcion || '').slice(0, 120);
        if (prod) rubros.set(prod.split(/\s+/).slice(0, 3).join(' ').toLowerCase(), (rubros.get(prod.split(/\s+/).slice(0, 3).join(' ').toLowerCase()) || 0) + 1);
        if (ejemplos.length < 6) ejemplos.push({ licitacion: r.licitacion_codigo, producto: prod, monto: l.montoUnitario ?? null, fecha: r.fecha });
      }
    }
  } catch (e) { console.warn('[auditor-compras] S3 adjudicacion_cache:', String(e).slice(0, 150)); }
  let nOC = 0;
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) n FROM ordenes_compra WHERE REPLACE(REPLACE(REPLACE(UPPER(proveedor_rut),'.',''),'-',''),' ','') = ?`, [normRut(rut)]) as any;
    nOC = Number((rows as any[])[0]?.n || 0);
  } catch { /* sin tabla de OC: solo cuenta la adjudicación */ }
  return {
    rut, venteAlEstado: licitaciones.size > 0 || nOC > 0, nLicitaciones: licitaciones.size, nOrdenesCompra: nOC,
    rubros: [...rubros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k), ejemplos,
    fuente: 'Actas de adjudicación y órdenes de compra de MercadoPública que ya están en la base de Licitank',
    limitacion: 'Es una muestra (las licitaciones que el sistema ha mirado), no todo MercadoPública: que salga vacío NO prueba que el proveedor no venda al Estado.',
  };
}

// ── S4 · Referencias de mercado del MISMO producto ────────────────────────────────────────────────
export interface CandidataBusqueda { url: string; nombre: string; precio: number | null; precioNeto: number | null; tienda: string; canal: string }

/** Ejecuta la búsqueda web (Serper) con marca + modelo + SKU y devuelve las páginas candidatas. Que sean
 *  el mismo producto lo decide después el modelo Y el código (tokens de modelo/SKU en el título). */
export async function buscarReferencias(consulta: string): Promise<{ candidatas: CandidataBusqueda[]; consulta: string; error?: string }> {
  const q = consulta.trim().slice(0, 200);
  if (!q) return { candidatas: [], consulta: q };
  try {
    const r = await buscarPrecioProducto(q, { minimo: 5 });
    if (r.error) return { candidatas: [], consulta: q, error: r.error };
    return {
      consulta: q,
      candidatas: r.resultados.filter(x => x.link).map(x => ({ url: x.link, nombre: x.nombre, precio: x.precio_valor ?? null, precioNeto: x.precio_neto ?? null, tienda: x.tienda, canal: x.canal })),
    };
  } catch (e) { return { candidatas: [], consulta: q, error: String((e as Error).message || e).slice(0, 160) }; }
}

// ── S5 · Precios de mercado público (histórico de adjudicaciones y órdenes de compra) ─────────────
/** Precios netos a los que el Estado compró este MISMO producto (mismo modelo/SKU). Solo cuenta lo que
 *  calza por token de modelo; los "comparables" no se inventan: sin token, sin datos. */
export async function preciosMercadoPublico(tokens: string[]): Promise<PrecioMercadoPublico> {
  const vacio: PrecioMercadoPublico = { neto: null, n: 0, desde: null, hasta: null, calidad: 'sin_datos', ocs: [] };
  const claves = tokens.filter(t => t.length >= 4).slice(0, 3);
  if (claves.length === 0) return vacio;
  const ocs: PrecioMercadoPublico['ocs'] = [];
  const vistos = new Set<string>();
  try {
    const cond = claves.map(() => 'lineas LIKE ?').join(' OR ');
    const [rows] = await pool.query(
      `SELECT licitacion_codigo, lineas, DATE_FORMAT(fecha_adjudicacion, '%Y-%m-%d') AS fecha
         FROM adjudicacion_cache WHERE es_adjudicada = 1 AND (${cond}) ORDER BY fecha_adjudicacion DESC LIMIT 120`,
      claves.map(k => `%${k}%`),
    ) as any;
    for (const r of rows as any[]) {
      let lineas: any[] = []; try { lineas = JSON.parse(r.lineas || '[]'); } catch { continue; }
      for (const l of lineas) {
        const texto = `${l.producto || ''} ${l.descripcion || ''}`;
        if (!l.montoUnitario || !mismoProductoPorTokens(texto, claves)) continue;
        const k = `${r.licitacion_codigo}#${l.correlativo ?? ''}`; if (vistos.has(k)) continue; vistos.add(k);
        ocs.push({ precio: Number(l.montoUnitario), fecha: r.fecha, organismo: null, oc: r.licitacion_codigo, proveedor: l.proveedor ?? null });
      }
    }
  } catch (e) { console.warn('[auditor-compras] S5 adjudicacion_cache:', String(e).slice(0, 150)); }
  try {
    const cond = claves.map(() => 'items_json LIKE ?').join(' OR ');
    const [rows] = await pool.query(
      `SELECT codigo, comprador_organismo, proveedor_nombre, items_json, DATE_FORMAT(COALESCE(fecha_envio, fecha_creacion), '%Y-%m-%d') AS fecha
         FROM ordenes_compra WHERE (${cond}) ORDER BY fecha_envio DESC LIMIT 120`,
      claves.map(k => `%${k}%`),
    ) as any;
    for (const r of rows as any[]) {
      let items: any[] = []; try { items = JSON.parse(r.items_json || '[]'); } catch { continue; }
      for (const it of items) {
        const texto = `${it.EspecificacionComprador || ''} ${it.EspecificacionProveedor || ''} ${it.Producto || ''}`;
        const precio = Number(it.PrecioNeto ?? it.precioNeto);
        if (!Number.isFinite(precio) || precio <= 0 || !mismoProductoPorTokens(texto, claves)) continue;
        const k = `${r.codigo}#${it.Correlativo ?? ''}`; if (vistos.has(k)) continue; vistos.add(k);
        ocs.push({ precio, fecha: r.fecha, organismo: r.comprador_organismo, oc: r.codigo, proveedor: r.proveedor_nombre });
      }
    }
  } catch (e) { console.warn('[auditor-compras] S5 ordenes_compra:', String(e).slice(0, 150)); }
  if (ocs.length === 0) return vacio;
  const precios = ocs.map(o => o.precio).sort((a, b) => a - b);
  const m = Math.floor(precios.length / 2);
  const neto = precios.length % 2 ? precios[m] : (precios[m - 1] + precios[m]) / 2;
  const fechas = ocs.map(o => o.fecha).filter(Boolean).sort() as string[];
  return { neto: Math.round(neto), n: ocs.length, desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null, calidad: 'mismo_producto', ocs: ocs.slice(0, 12) };
}
