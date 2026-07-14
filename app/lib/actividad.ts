// app/lib/actividad.ts
// Registro del historial de actividad de usuarios (Plan A).
// registrarActividad() es BEST-EFFORT: nunca lanza error ni rompe la acción principal
// (si falta la tabla —migración 18 pendiente— solo lo loguea y sigue).

import pool from '@/app/lib/db';

export type AccionActividad =
  | 'login'
  | 'ver_licitacion'
  | 'comentario_licitacion'
  | 'comentario_negocio'
  | 'cambio_etiqueta'
  | 'cambio_pipeline'
  | 'asignacion'
  | 'radar_nuevas'
  | 'favorito'
  | 'viabilidad'      // corrió el análisis de viabilidad IA
  | 'costeo'          // generó/regeneró el costeo (con o sin precios de mercado)
  | 'documento'       // subió o borró un documento propio
  | 'ver_documento'   // abrió/descargó un documento
  | 'estado_mp';      // Mercado Público cambió el estado (Cerrada/Revocada/Desierta/…)

export interface EventoActividad {
  usuarioId: number | null;
  accion: AccionActividad;
  entidadTipo?: 'licitacion' | 'negocio' | 'radar' | null;
  entidadId?: string | null;
  descripcion?: string | null;
  metadata?: unknown;
}

let tablaAusente = false; // evita reintentar/loguear en bucle si la tabla no existe

export async function registrarActividad(ev: EventoActividad): Promise<void> {
  if (tablaAusente) return;
  try {
    await pool.query(
      `INSERT INTO actividad_usuario (usuario_id, accion, entidad_tipo, entidad_id, descripcion, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ev.usuarioId ?? null,
        ev.accion,
        ev.entidadTipo ?? null,
        ev.entidadId ?? null,
        ev.descripcion ?? null,
        ev.metadata != null ? JSON.stringify(ev.metadata) : null,
      ],
    );
  } catch (e: any) {
    if (e?.code === 'ER_NO_SUCH_TABLE') {
      tablaAusente = true;
      console.warn('[actividad] tabla actividad_usuario ausente (falta migración 18); no se registrará historial.');
      return;
    }
    // Cualquier otro error: no romper la acción principal.
    console.warn('[actividad] no se pudo registrar:', String(e?.message || e).slice(0, 120));
  }
}

// Lee el id de usuario desde los headers que inyecta el middleware (proxy.ts).
export function userIdFromHeaders(headers: Headers): number | null {
  const id = headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}
