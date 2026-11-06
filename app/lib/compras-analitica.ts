// app/lib/compras-analitica.ts
// ANALÍTICA DE COMPRAS — foto agregada de todo el módulo para graficar: qué se ganó y cuándo, cómo van las
// entregas, quién carga con qué, de dónde vienen los negocios, tiempos del proceso OC, tareas, gastos,
// proveedores, incidencias y resultado económico. Solo lee: no escribe nada ni cambia ninguna regla.
//
// Las filas de negocios salen de `listarAsignacionesCompras` (la misma fuente de la pantalla de Compras y
// del Gantt), así que los números coinciden con lo que se ve ahí. Lo demás son consultas directas.
// Cada consulta suelta se aísla con .catch: si una tabla falla, esa tarjeta sale vacía y el resto sigue.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { listarAsignacionesCompras, type ComprasFila } from '@/app/lib/compras';
import { resultadosParaDashboard } from '@/app/lib/compras-costo-real';
import { resumirResultados, type ResumenResultados } from '@/app/lib/costo-real-consolidado';

export type ClaveEstadoEntrega = 'ENTREGADA' | 'EN_PLAZO' | 'ENTREGA_VENCIDA' | 'ESPERANDO_OC' | 'SIN_PLAZO' | 'PRECOMPRA' | 'NO_REALIZADA';

export interface AnaliticaCompras {
  generadoAt: string;
  kpis: {
    negocios: number; montoTotal: number; montoPromedio: number | null; urgentes: number; sinAsignar: number;
    entregasVencidas: number; esperandoOC: number; entregadas: number; tareasVencidas: number; tareasTotal: number; tareasHechas: number;
  };
  porMes: Array<{ mes: string; n: number; monto: number }>;
  estadoEntrega: Array<{ clave: ClaveEstadoEntrega; n: number; monto: number }>;
  porEncargado: Array<{ nombre: string; negocios: number; monto: number; tareasVencidas: number }>;
  porLugar: Array<{ lugar: string; n: number; monto: number }>;
  tiempos: { adjudicacionAOC: number | null; ocAAceptacion: number | null; conOC: number; sinOC: number };
  tareasPorCategoria: Array<{ categoria: string; hechas: number; enCurso: number; pendientes: number; vencidas: number }>;
  gastos: Array<{ categoria: string; monto: number }>;
  proveedores: Array<{ nombre: string; ordenes: number; monto: number }>;
  incidencias: Array<{ naturaleza: string; abiertas: number; cerradas: number }>;
  resultados: ResumenResultados | null;
}

// Misma regla que la pantalla: comuna si el organismo es una municipalidad; si no, la región sin el prefijo.
function lugarDe(f: Pick<ComprasFila, 'licitacionOrganismo' | 'licitacionRegion'>): string {
  const m = f.licitacionOrganismo?.match(/municipalidad\s+de\s+(.+)$/i);
  if (m) return m[1].trim().toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
  const r = f.licitacionRegion?.replace(/^regi[oó]n\s+(?:de\s+los\s+|de\s+las\s+|de\s+la\s+|del\s+|de\s+)?/i, '').trim();
  return r || 'Sin dato';
}

const dia = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = new Date(`${s.slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? t / 86_400_000 : null;
};
const promedio = (ns: number[]): number | null => (ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10 : null);

function estadoEntrega(f: ComprasFila, hoy: string): ClaveEstadoEntrega {
  if (f.cierreLegado === 'ENTREGADA') return 'ENTREGADA';
  if (f.cierreLegado === 'NO_REALIZADA') return 'NO_REALIZADA';
  if (f.precompra || f.cierreLegado === 'PRECOMPRA_SIN_ADJUDICAR') return 'PRECOMPRA';
  const p = f.hitosGantt;
  if (p?.entrega) return p.entrega.slice(0, 10) < hoy ? 'ENTREGA_VENCIDA' : 'EN_PLAZO';
  if (p && !p.ocEmitida) return 'ESPERANDO_OC';
  return 'SIN_PLAZO';
}

export async function obtenerAnaliticaCompras(): Promise<AnaliticaCompras> {
  const ahora = ahoraChileSQL();
  const hoy = ahora.slice(0, 10);
  const q = <T = any>(sql: string): Promise<T[]> => pool.query(sql).then(([r]) => r as T[]).catch((e) => { console.error('[compras-analitica]', String(e)); return []; });

  const [filas, tareas, gastos, proveedores, incidencias, resultados] = await Promise.all([
    listarAsignacionesCompras().catch(() => [] as ComprasFila[]),
    q(`SELECT t.categoria, t.estado, t.plazo_at FROM compras_tarea t JOIN compras_asignacion ca ON ca.negocio_id = t.negocio_id`),
    q(`SELECT COALESCE(c.etiqueta, g.categoria_clave) AS categoria, SUM(g.monto) AS monto FROM compras_gasto g
         LEFT JOIN compras_gasto_categoria c ON c.clave COLLATE utf8mb4_general_ci = g.categoria_clave COLLATE utf8mb4_general_ci
        GROUP BY COALESCE(c.etiqueta, g.categoria_clave) ORDER BY monto DESC LIMIT 8`),
    // Neto (total_neto guarda el total CON IVA), sin las OC anuladas en Obuma y con las OC propias de Comercial MP.
    q(`SELECT nombre, COUNT(*) AS ordenes, SUM(neto) AS monto FROM (
          SELECT o.proveedor_nombre AS nombre, COALESCE(o.subtotal_neto, ROUND(o.total_neto / 1.19)) AS neto
            FROM compras_orden_compra_obuma o LEFT JOIN obuma_compras c ON c.compra_oc_id = o.obuma_compra_oc_id
           WHERE o.proveedor_nombre IS NOT NULL AND COALESCE(c.estado, '') NOT LIKE '%ANULAD%'
          UNION ALL
          SELECT proveedor_nombre, neto FROM compras_oc_propia WHERE estado <> 'ANULADA'
        ) x GROUP BY nombre ORDER BY monto DESC LIMIT 8`),
    q(`SELECT naturaleza, estado, COUNT(*) AS n FROM compras_incidencia GROUP BY naturaleza, estado`),
    resultadosParaDashboard().then(resumirResultados).catch(() => null),
  ]);

  // Los negocios cerrados o precompras no son "carga viva", pero sí cuentan en montos y meses (es lo ganado).
  const activos = filas.filter(f => !f.precompra && f.cierreLegado !== 'PRECOMPRA_SIN_ADJUDICAR');
  const monto = (f: ComprasFila) => f.montoNuestro ?? 0;

  // Ganado por mes
  const meses = new Map<string, { n: number; monto: number }>();
  for (const f of activos) {
    const k = f.ganadoAt.slice(0, 7);
    const e = meses.get(k) ?? { n: 0, monto: 0 };
    e.n++; e.monto += monto(f); meses.set(k, e);
  }
  const porMes = [...meses.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, ...v }));

  // Estado de la entrega
  const estados = new Map<ClaveEstadoEntrega, { n: number; monto: number }>();
  for (const f of filas) {
    const k = estadoEntrega(f, hoy);
    const e = estados.get(k) ?? { n: 0, monto: 0 };
    e.n++; e.monto += monto(f); estados.set(k, e);
  }
  const estadoEntrega_ = [...estados.entries()].map(([clave, v]) => ({ clave, ...v })).sort((a, b) => b.n - a.n);

  // Por encargado
  const enc = new Map<string, { negocios: number; monto: number; tareasVencidas: number }>();
  for (const f of activos) {
    const k = f.asignadoNombre || 'Sin asignar';
    const e = enc.get(k) ?? { negocios: 0, monto: 0, tareasVencidas: 0 };
    e.negocios++; e.monto += monto(f); e.tareasVencidas += f.tareasVencidas; enc.set(k, e);
  }
  const porEncargado = [...enc.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.monto - a.monto);

  // Por lugar (top 8, el resto junto)
  const lug = new Map<string, { n: number; monto: number }>();
  for (const f of activos) {
    const k = lugarDe(f);
    const e = lug.get(k) ?? { n: 0, monto: 0 };
    e.n++; e.monto += monto(f); lug.set(k, e);
  }
  const lugOrden = [...lug.entries()].map(([lugar, v]) => ({ lugar, ...v })).sort((a, b) => b.monto - a.monto);
  const porLugar = lugOrden.slice(0, 8);
  const resto = lugOrden.slice(8);
  if (resto.length) porLugar.push({ lugar: `Otros (${resto.length})`, n: resto.reduce((a, r) => a + r.n, 0), monto: resto.reduce((a, r) => a + r.monto, 0) });

  // Tiempos del proceso OC (días de calendario)
  const adjAOc: number[] = [], ocAAcept: number[] = [];
  let conOC = 0, sinOC = 0;
  for (const f of activos) {
    const p = f.hitosGantt;
    if (!p) continue;
    if (p.ocEmitida) {
      conOC++;
      const a = dia(p.adjudicacion), b = dia(p.ocEmitida);
      if (a != null && b != null && b >= a) adjAOc.push(b - a);
      const c = dia(p.ocAceptada);
      if (b != null && c != null && c >= b) ocAAcept.push(c - b);
    } else sinOC++;
  }

  // Tareas por categoría
  const cat = new Map<string, { hechas: number; enCurso: number; pendientes: number; vencidas: number }>();
  for (const t of tareas as any[]) {
    const k = t.categoria || 'Otras';
    const e = cat.get(k) ?? { hechas: 0, enCurso: 0, pendientes: 0, vencidas: 0 };
    if (t.estado === 'HECHA') e.hechas++;
    else if (t.plazo_at && String(t.plazo_at) < ahora) e.vencidas++;
    else if (t.estado === 'EN_CURSO') e.enCurso++;
    else e.pendientes++;
    cat.set(k, e);
  }
  const tareasPorCategoria = [...cat.entries()].map(([categoria, v]) => ({ categoria, ...v }))
    .sort((a, b) => (b.hechas + b.enCurso + b.pendientes + b.vencidas) - (a.hechas + a.enCurso + a.pendientes + a.vencidas));

  // Incidencias
  const inc = new Map<string, { abiertas: number; cerradas: number }>();
  for (const r of incidencias as any[]) {
    const e = inc.get(r.naturaleza) ?? { abiertas: 0, cerradas: 0 };
    if (r.estado === 'ABIERTA') e.abiertas += Number(r.n); else e.cerradas += Number(r.n);
    inc.set(r.naturaleza, e);
  }

  const montoTotal = activos.reduce((a, f) => a + monto(f), 0);
  return {
    generadoAt: ahora,
    kpis: {
      negocios: activos.length, montoTotal, montoPromedio: activos.length ? Math.round(montoTotal / activos.length) : null,
      urgentes: activos.filter(f => f.urgente).length, sinAsignar: activos.filter(f => !f.asignadoA).length,
      entregasVencidas: estados.get('ENTREGA_VENCIDA')?.n ?? 0, esperandoOC: estados.get('ESPERANDO_OC')?.n ?? 0, entregadas: estados.get('ENTREGADA')?.n ?? 0,
      tareasVencidas: activos.reduce((a, f) => a + f.tareasVencidas, 0), tareasTotal: activos.reduce((a, f) => a + f.tareasTotal, 0), tareasHechas: activos.reduce((a, f) => a + f.tareasHechas, 0),
    },
    porMes, estadoEntrega: estadoEntrega_, porEncargado, porLugar,
    tiempos: { adjudicacionAOC: promedio(adjAOc), ocAAceptacion: promedio(ocAAcept), conOC, sinOC },
    tareasPorCategoria,
    gastos: (gastos as any[]).map(g => ({ categoria: String(g.categoria), monto: Number(g.monto) || 0 })),
    proveedores: (proveedores as any[]).map(p => ({ nombre: String(p.nombre), ordenes: Number(p.ordenes), monto: Number(p.monto) || 0 })),
    incidencias: [...inc.entries()].map(([naturaleza, v]) => ({ naturaleza, ...v })),
    resultados,
  };
}
