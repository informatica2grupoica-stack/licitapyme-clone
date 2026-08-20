// app/lib/carga-perfiles.ts
// CARGA DE TRABAJO VIGENTE POR PERFIL — una sola definición para toda la app.
//
// POR QUÉ (20-ago-2026): "cuántas licitaciones tiene encima Juan" lo mostraba /api/negocios con
// una regla escrita a mano dentro de la ruta. El Puente del Radar reparte NIVELANDO justamente
// ese número, y si las dos partes contaran distinto el reparto "equitativo" quedaría torcido sin
// que nadie se diera cuenta. La regla vive acá y ambos la llaman.
//
// REGLA: vigente = la que de verdad se está trabajando.
//   · su cierre NO ha pasado, y
//   · no está en un estado resuelto (postulada / descartada / adjudicada / posible adj. / perdida).
// Un perfil con 50 licitaciones históricas cerradas tiene carga 0: no le quita capacidad hoy.

import pool from '@/app/lib/db';

/** Estados que sacan una licitación de la carga vigente (ya se resolvió). */
export const RESUELTOS_CARGA = new Set(['POSTULADA', 'DESCARTADA', 'ADJUDICADA', 'POSIBLE_ADJ', 'PERDIDA']);

/** Fila cruda: una por negocio activo (lo que devuelve el query de más abajo). */
export interface FilaCarga {
  usuario_id: number;
  nombre: string | null;
  email: string;
  codigo?: string;
  licitacion_cierre: string | Date | null;
  estado_pipeline: string | null;
}

export interface CargaPerfil {
  usuario_id: number;
  nombre: string | null;
  email: string;
  /** VIGENTES: la cifra que se usa para nivelar el reparto. */
  total: number;
  descartadas: number;
  vencidas: number;
  resueltas: number;
  porEstado: Record<string, number>;
}

/** Agrupa filas de negocios activos en la carga por perfil. Puro (testeable). */
export function resumirCarga(filas: FilaCarga[], ahora: number = Date.now()): CargaPerfil[] {
  const mapa = new Map<number, CargaPerfil>();
  for (const r of filas) {
    let e = mapa.get(r.usuario_id);
    if (!e) {
      e = { usuario_id: r.usuario_id, nombre: r.nombre, email: r.email, total: 0, descartadas: 0, vencidas: 0, resueltas: 0, porEstado: {} };
      mapa.set(r.usuario_id, e);
    }
    const estado = r.estado_pipeline || 'ASIGNADO';
    if (estado === 'DESCARTADA') { e.descartadas++; continue; }
    // Resuelta (postulada/adjudicada/...) → no cuenta como carga vigente.
    if (RESUELTOS_CARGA.has(estado)) { e.resueltas++; continue; }
    // Vencida (cierre ya pasó) → tampoco (se resuelve por el modal de vencidas).
    const cierreMs = r.licitacion_cierre ? new Date(r.licitacion_cierre).getTime() : NaN;
    if (!Number.isNaN(cierreMs) && cierreMs < ahora) { e.vencidas++; continue; }
    e.total++;
    e.porEstado[estado] = (e.porEstado[estado] || 0) + 1;
  }
  return Array.from(mapa.values()).sort((a, b) => b.total - a.total);
}

/**
 * Lee la carga vigente de TODO el equipo. Tolerante: si la tabla aún no existe (migración
 * pendiente) devuelve lista vacía en vez de romper la pantalla que la pide.
 */
export async function cargaDeEquipo(): Promise<CargaPerfil[]> {
  try {
    const [rows] = await pool.query(
      `SELECT n.asignado_a AS usuario_id, u.nombre, u.email, n.licitacion_codigo AS codigo,
              n.licitacion_cierre,
              COALESCE(n.estado_pipeline, 'ASIGNADO') AS estado_pipeline
       FROM negocios n JOIN usuarios u ON u.id = n.asignado_a
       WHERE n.activo = TRUE`);
    return resumirCarga(rows as FilaCarga[]);
  } catch {
    return [];
  }
}
