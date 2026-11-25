// Completa organismo, región, comuna y monto de filas de radar/puente desde licitaciones_cache.
// Las alertas nacen del listado de Mercado Público, que no trae esos datos; el detalle (cache) sí.
// Solo rellena lo que falta; si el caché o la columna `comuna` no existen, devuelve las filas como estaban.
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { guardarCache } from '@/app/lib/licitaciones-cache';

type Fila = {
  licitacion_codigo: string;
  licitacion_organismo?: string | null;
  licitacion_region?: string | null;
  licitacion_monto?: number | string | null;
  licitacion_comuna?: string | null;
};

async function leer(codigos: string[], conComuna: boolean): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < codigos.length; i += 500) {
    const chunk = codigos.slice(i, i + 500);
    const [rows] = await pool.query(
      `SELECT codigo, organismo, region, ${conComuna ? 'comuna' : 'NULL AS comuna'}, monto
       FROM licitaciones_cache WHERE codigo IN (${chunk.map(() => '?').join(',')})`, chunk) as any[];
    out.push(...(rows as any[]));
  }
  return out;
}

// `traerFaltantes`: cuántas licitaciones que no están en el caché se piden al detalle de Mercado Público
// (de a una, con tope) y se guardan. Solo para listas chicas como el puente.
export async function completarUbicacion<T extends Fila>(filas: T[], traerFaltantes = 0): Promise<T[]> {
  const codigos = Array.from(new Set(filas.map(f => f.licitacion_codigo).filter(Boolean)));
  if (codigos.length === 0) return filas;
  let datos: any[];
  try { datos = await leer(codigos, true); }
  catch {
    try { datos = await leer(codigos, false); } catch { return filas; }
  }
  const mapa = new Map(datos.map(d => [d.codigo, d]));
  if (traerFaltantes > 0) {
    const faltan = codigos.filter(c => !mapa.has(c)).slice(0, traerFaltantes);
    const cliente = getMercadoPublicoClient();
    const traidas = [];
    for (const c of faltan) {
      try { const lic = await cliente.obtenerPorCodigo(c); if (lic) traidas.push(lic); } catch { /* sigue con las demás */ }
    }
    if (traidas.length) {
      await guardarCache(traidas).catch(() => {});
      for (const l of traidas) mapa.set(l.Codigo, { codigo: l.Codigo, organismo: l.Organismo, region: l.Region, comuna: l.ComunaUnidad, monto: l.MontoEstimado ?? null });
    }
  }
  // Sin monto publicado: el presupuesto que sacó el análisis de viabilidad desde las bases (neto).
  const sinMonto = codigos.filter(c => !(Number(mapa.get(c)?.monto) > 0));
  const presupuestoBases = new Map<string, number>();
  if (sinMonto.length) {
    try {
      const [vr] = await pool.query(
        `SELECT licitacion_codigo, nivel_presupuesto_neto FROM viabilidad_licitacion
         WHERE nivel_presupuesto_neto > 0 AND licitacion_codigo IN (${sinMonto.map(() => '?').join(',')})`, sinMonto) as any[];
      for (const r of vr as any[]) presupuestoBases.set(r.licitacion_codigo, Number(r.nivel_presupuesto_neto));
    } catch { /* sin viabilidad: sin respaldo */ }
  }
  for (const f of filas) {
    const d = mapa.get(f.licitacion_codigo) ?? {};
    if (f.licitacion_monto == null && presupuestoBases.has(f.licitacion_codigo)) f.licitacion_monto = presupuestoBases.get(f.licitacion_codigo)!;
    if (!f.licitacion_organismo && d.organismo) f.licitacion_organismo = d.organismo;
    if (!f.licitacion_region && d.region) f.licitacion_region = d.region;
    if (f.licitacion_monto == null && d.monto != null && Number(d.monto) > 0) f.licitacion_monto = Number(d.monto);
    f.licitacion_comuna = d.comuna || null;
  }
  return filas;
}
