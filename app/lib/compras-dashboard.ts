// app/lib/compras-dashboard.ts
// DASHBOARD DE COMPRAS (spec §18.5) — "identificar cuellos de botella: qué tareas toman más
// tiempo, cuáles se ejecutan rápido, cuáles se cumplen más y cuáles menos". La spec marca este
// dashboard como "fuera de alcance" para la Fase 1 y solo pedía que el MODELO DE DATOS lo
// soportara después (§18.3: cada tarea con marca de creación/asignación/primer contacto/cierre +
// responsable) — eso ya estaba. Este archivo es la vista que faltaba sobre datos que ya existían.
//
// §18.6: "Solo para la jefatura" — el gate vive en la ruta API (mismo criterio que `aprobar_comercial`
// = "jefe de ventas" en el resto del módulo), no acá.
//
// Todo el cálculo de tiempos se hace EN JS sobre fechas ya guardadas como hora de pared de Chile
// (creado_at/cerrado_at vienen de ahoraChileSQL()) — nunca se compara contra NOW() de MySQL ni se
// usa TIMESTAMPDIFF, mismo criterio que el resto del proyecto (ver app/lib/tz.ts).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { resultadosParaDashboard } from '@/app/lib/compras-costo-real';
import { resumirResultados, type ResumenResultados } from '@/app/lib/costo-real-consolidado';

function horasEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const t1 = new Date(a.replace(' ', 'T')).getTime();
  const t2 = new Date(b.replace(' ', 'T')).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return (t2 - t1) / 3_600_000;
}

const promedio = (ns: number[]): number | null => ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;

export interface CuelloBotellaTarea {
  clave: string; titulo: string;
  total: number; hechas: number; vencidas: number;
  horasPromedioCierre: number | null; // solo entre las HECHA — cuánto demora en la práctica
}

export interface RankingEncargado {
  id: number; nombre: string;
  tareasCerradas: number; tareasVencidasAbiertas: number; horasPromedioCierre: number | null;
}

export interface GanadoPorMes { mes: string; n: number } // mes = 'YYYY-MM'

export interface DashboardCompras {
  negociosActivos: number;
  negociosUrgentes: number;
  relojesVencidos: number;
  /** Negocios activos sin reloj de entrega fijado: para ellos "relojes vencidos" no puede decir nada (auditoría 07-oct-2026). */
  relojesSinFijar: number;
  incidenciasAbiertas: number;
  sinAsignar: number;
  cierreLegado: { entregadas: number; noRealizadas: number };
  ordenesCompra: { conOc: number; sinOc: number };
  ganadosPorMes: GanadoPorMes[];
  slaAsignacion: { promedioHoras: number | null; automaticas: number; manuales: number; total: number };
  cuellosBotella: CuelloBotellaTarea[];
  ranking: RankingEncargado[];
  /** Resultado económico (margen real vs estimado, desvíos) — null si no se pudo calcular. */
  resultados: ResumenResultados | null;
  generadoAt: string;
}

export async function obtenerDashboardCompras(): Promise<DashboardCompras> {
  const ahora = ahoraChileSQL();
  const hoy = ahora.slice(0, 10);

  // Todas las lecturas son independientes: se piden a la vez (antes ~10 viajes en serie a la base, 22-oct-2026). Las que van con
  // .catch(() => null) son las que antes estaban en try/catch: si fallan, su indicador queda en 0 y el resto sigue.
  // Resultado económico: el costo real que Compras carga por fin llega a un indicador. Si falla no
  // tumba el resto del dashboard (un negocio con datos raros no debe esconder los cuellos de botella).
  const resultadosP = resultadosParaDashboard().then(resumirResultados)
    .catch(e => { console.error('[compras-dashboard] resultados:', String(e).slice(0, 200)); return null; });
  const [[[negRow]], relojRes, sinFijarRes, incRes, [[sinAsigRow]], clRes, [[ocRow]], [gpmRows], [asigRows], [tareaRows]]: any = await Promise.all([
    pool.query(`SELECT COUNT(*) total, SUM(urgente) urgentes FROM compras_asignacion`),
    // migration-95 pendiente en algún entorno viejo: no bloquea el resto del dashboard
    pool.query(
      `SELECT fecha_limite, prorroga_fecha_limite FROM compras_reloj
        WHERE fijado_por IS NOT NULL AND entrega_con_multa = 0`,
    ).catch(() => null),
    // sin reloj de entrega en entornos viejos
    pool.query(
      `SELECT COUNT(*) n FROM compras_asignacion ca
        WHERE ca.cierre_legado IS NULL
          AND NOT EXISTS (SELECT 1 FROM compras_reloj r WHERE r.negocio_id = ca.negocio_id AND r.fijado_por IS NOT NULL)`,
    ).catch(() => null),
    // migration-94 pendiente: sigue en 0
    pool.query(`SELECT COUNT(*) n FROM compras_incidencia WHERE estado = 'ABIERTA'`).catch(() => null),
    pool.query(`SELECT COUNT(*) n FROM compras_asignacion WHERE asignado_a IS NULL`),
    // Cierre legado (migration-107, backlog histórico marcado a mano) — cuántos ya se cerraron
    // "rápido" (sin pasar por el flujo completo de Entrega/Fracaso) y con qué resultado. Columna nueva: si falla, se queda en 0.
    pool.query(
      `SELECT SUM(cierre_legado = 'ENTREGADA') entregadas, SUM(cierre_legado = 'NO_REALIZADA') no_realizadas
         FROM compras_asignacion WHERE cierre_legado IS NOT NULL`,
    ).catch(() => null),
    pool.query(`SELECT SUM(oc_numero IS NOT NULL) con_oc, SUM(oc_numero IS NULL) sin_oc FROM compras_asignacion`),
    // Ganados por mes — de dónde vienen los negocios que hoy están en Compras, mes a mes real
    // (ganado_at, no cuándo entraron al sistema). Últimos 12 meses con datos.
    pool.query(
      `SELECT DATE_FORMAT(ganado_at, '%Y-%m') mes, COUNT(*) n
         FROM compras_asignacion GROUP BY mes ORDER BY mes`,
    ),
    // §3.3 — SLA de asignación (3h hábiles). Se mide cuánto tardó REALMENTE, sea manual o automática.
    pool.query(
      `SELECT DATE_FORMAT(ganado_at, '%Y-%m-%d %H:%i:%s') ganado_at,
              DATE_FORMAT(asignado_at, '%Y-%m-%d %H:%i:%s') asignado_at, asignado_por
         FROM compras_asignacion WHERE asignado_at IS NOT NULL`,
    ),
    // §18.3/§18.5 — una fila por tarea, con su tipo de catálogo y su responsable. Se agrega EN JS:
    // el catálogo es chico (una decena de tipos) y el volumen de tareas de Compras hoy es bajo — no
    // vale la pena una consulta agregada con lógica de "vencida" duplicada en SQL.
    pool.query(
      `SELECT t.catalogo_clave, c.titulo AS catalogo_titulo, t.estado,
              DATE_FORMAT(t.plazo_at, '%Y-%m-%d %H:%i:%s') plazo_at,
              DATE_FORMAT(t.creado_at, '%Y-%m-%d %H:%i:%s') creado_at,
              DATE_FORMAT(t.cerrado_at, '%Y-%m-%d %H:%i:%s') cerrado_at,
              t.responsable_id, t.responsable_nombre
         FROM compras_tarea t
         LEFT JOIN compras_tarea_catalogo c ON c.clave = t.catalogo_clave
        WHERE t.catalogo_clave IS NOT NULL`,
    ),
  ]);

  const relojesVencidos = relojRes ? (relojRes[0] as any[]).filter(r => {
    const limite = r.prorroga_fecha_limite || r.fecha_limite;
    return limite && String(limite).slice(0, 10) < hoy;
  }).length : 0;
  const relojesSinFijar = sinFijarRes ? Number(sinFijarRes[0][0]?.n || 0) : 0;
  const incidenciasAbiertas = incRes ? Number(incRes[0][0]?.n || 0) : 0;
  const sinAsignar = Number(sinAsigRow?.n || 0);
  const clRow = clRes?.[0]?.[0];
  const cierreLegado = clRes ? { entregadas: Number(clRow?.entregadas || 0), noRealizadas: Number(clRow?.no_realizadas || 0) } : { entregadas: 0, noRealizadas: 0 };
  const ordenesCompra = { conOc: Number(ocRow?.con_oc || 0), sinOc: Number(ocRow?.sin_oc || 0) };
  const ganadosPorMes: GanadoPorMes[] = (gpmRows as any[]).map(r => ({ mes: r.mes, n: Number(r.n) }));
  const horasAsignacion: number[] = [];
  let automaticas = 0, manuales = 0;
  for (const r of asigRows as any[]) {
    const h = horasEntre(r.ganado_at, r.asignado_at);
    if (h != null) horasAsignacion.push(h);
    if (r.asignado_por == null) automaticas++; else manuales++;
  }

  const vencida = (t: any) => t.estado !== 'HECHA' && t.plazo_at && t.plazo_at < ahora;

  type BucketClave = { titulo: string; total: number; hechas: number; vencidas: number; horas: number[] };
  type BucketEncargado = { nombre: string; cerradas: number; vencidasAbiertas: number; horas: number[] };
  const porClave = new Map<string, BucketClave>();
  const porEncargado = new Map<number, BucketEncargado>();

  for (const t of tareaRows as any[]) {
    const clave = t.catalogo_clave;
    const bucket: BucketClave = porClave.get(clave) || { titulo: t.catalogo_titulo || clave, total: 0, hechas: 0, vencidas: 0, horas: [] };
    bucket.total++;
    if (t.estado === 'HECHA') { bucket.hechas++; const h = horasEntre(t.creado_at, t.cerrado_at); if (h != null) bucket.horas.push(h); }
    if (vencida(t)) bucket.vencidas++;
    porClave.set(clave, bucket);

    if (t.responsable_id != null) {
      const e: BucketEncargado = porEncargado.get(t.responsable_id) || { nombre: t.responsable_nombre || `Usuario ${t.responsable_id}`, cerradas: 0, vencidasAbiertas: 0, horas: [] };
      if (t.estado === 'HECHA') { e.cerradas++; const h = horasEntre(t.creado_at, t.cerrado_at); if (h != null) e.horas.push(h); }
      if (vencida(t)) e.vencidasAbiertas++;
      porEncargado.set(t.responsable_id, e);
    }
  }

  const cuellosBotella: CuelloBotellaTarea[] = [...porClave.entries()]
    .map(([clave, b]) => ({ clave, titulo: b.titulo, total: b.total, hechas: b.hechas, vencidas: b.vencidas, horasPromedioCierre: promedio(b.horas) }))
    .sort((a, b) => (b.horasPromedioCierre ?? -1) - (a.horasPromedioCierre ?? -1));

  const ranking: RankingEncargado[] = [...porEncargado.entries()]
    .map(([id, e]) => ({ id, nombre: e.nombre, tareasCerradas: e.cerradas, tareasVencidasAbiertas: e.vencidasAbiertas, horasPromedioCierre: promedio(e.horas) }))
    .sort((a, b) => b.tareasCerradas - a.tareasCerradas);

  const resultados: ResumenResultados | null = await resultadosP;

  return {
    negociosActivos: Number(negRow?.total || 0),
    negociosUrgentes: Number(negRow?.urgentes || 0),
    relojesVencidos, relojesSinFijar,
    incidenciasAbiertas,
    sinAsignar,
    cierreLegado,
    ordenesCompra,
    ganadosPorMes,
    slaAsignacion: { promedioHoras: promedio(horasAsignacion), automaticas, manuales, total: horasAsignacion.length },
    cuellosBotella,
    ranking,
    resultados,
    generadoAt: ahora,
  };
}
