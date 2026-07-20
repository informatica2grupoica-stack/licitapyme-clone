// app/lib/actividad.ts
// Registro del historial de actividad de usuarios (Plan A).
// registrarActividad() es BEST-EFFORT: nunca lanza error ni rompe la acción principal
// (si falta la tabla —migración 18 pendiente— solo lo loguea y sigue).

import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

export type AccionActividad =
  | 'login'
  | 'ver_licitacion'
  | 'ver_seccion'      // entró a una pestaña del detalle (resumen/documentos/viabilidad/…)
  | 'ver_cita'         // abrió el visor de una cita de la viabilidad
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
  | 'estado_mp'       // Mercado Público cambió el estado (Cerrada/Revocada/Desierta/…)
  | 'fecha_cierre_mp' // Mercado Público cambió la fecha de cierre (extensión de plazo/aclaración)
  | 'descarte_radar'  // descartó/restauró una licitación del radar (nivel empresa)
  | 'feedback_viabilidad' // el experto corrigió/eliminó una corrección de viabilidad
  | 'chat_ia'         // consultó al chatbot IA de la licitación
  | 'informe'         // generó el informe técnico PDF
  | 'busqueda_equipamiento' // generó el prompt de búsqueda de equipamiento
  | 'radar_manual';   // disparó manualmente la actualización del radar

// Pestañas del detalle de la licitación que se registran como 'ver_seccion'.
export const SECCIONES_ACTIVIDAD = [
  'resumen', 'viabilidad', 'criterios', 'fechas', 'items', 'documentos', 'analisis', 'comentarios',
] as const;
export type SeccionActividad = (typeof SECCIONES_ACTIVIDAD)[number];

export const LABEL_SECCION: Record<SeccionActividad, string> = {
  resumen: 'Resumen', viabilidad: 'Viabilidad', criterios: 'Criterios de evaluación',
  fechas: 'Fechas', items: 'Ítems y cantidades', documentos: 'Documentos',
  analisis: 'Inteligencia', comentarios: 'Comentarios',
};

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
    // created_at EXPLÍCITO en hora de pared de Chile. El DEFAULT CURRENT_TIMESTAMP lo ponía el
    // servidor MySQL de Bluehost (UTC-6) mientras el proceso Node lee con TZ=America/Santiago
    // (UTC-4/-3) → todo el historial nacía 2 h en el pasado ("hace 2 h" recién ocurrido).
    await pool.query(
      `INSERT INTO actividad_usuario (usuario_id, accion, entidad_tipo, entidad_id, descripcion, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ev.usuarioId ?? null,
        ev.accion,
        ev.entidadTipo ?? null,
        ev.entidadId ?? null,
        ev.descripcion ?? null,
        ev.metadata != null ? JSON.stringify(ev.metadata) : null,
        ahoraChileSQL(),
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

// Registra el evento UNA SOLA VEZ POR DÍA (día chileno) para la combinación
// usuario + acción + entidad + `clave`. Pensado para lo que se dispara en cada render/fetch
// (abrir la licitación, entrar a una pestaña, mirar un documento): antes quedaban 10-20 líneas
// idénticas por día y el Historial era ilegible. Si vuelve mañana, se registra de nuevo.
// `clave` distingue el sub-evento dentro de la misma acción (p.ej. la sección o el documento).
// Best-effort, igual que registrarActividad(): nunca rompe la acción principal.
export async function registrarActividadDiaria(
  ev: EventoActividad,
  clave?: string | null,
): Promise<void> {
  if (tablaAusente) return;
  try {
    const inicioDia = ahoraChileSQL().slice(0, 10) + ' 00:00:00';
    const params: unknown[] = [ev.usuarioId ?? null, ev.accion, ev.entidadId ?? null, inicioDia];
    // La clave viaja dentro de metadata.k para no requerir una columna nueva (sin migración).
    let filtroClave = '';
    if (clave != null) { filtroClave = `AND metadata->>'$.k' = ?`; params.push(clave); }

    const [yaHay] = await pool.query(
      `SELECT id FROM actividad_usuario
       WHERE usuario_id = ? AND accion = ? AND entidad_id = ? AND created_at >= ?
       ${filtroClave}
       LIMIT 1`,
      params,
    );
    if ((yaHay as any[]).length) return;
  } catch (e: any) {
    if (e?.code === 'ER_NO_SUCH_TABLE') { tablaAusente = true; return; }
    // Si la comprobación falla, se registra igual: perder un evento es peor que duplicarlo.
  }

  const meta = (ev.metadata && typeof ev.metadata === 'object') ? { ...(ev.metadata as object) } : {};
  await registrarActividad({ ...ev, metadata: clave != null ? { ...meta, k: clave } : meta });
}

// Lee el id de usuario desde los headers que inyecta el middleware (proxy.ts).
export function userIdFromHeaders(headers: Headers): number | null {
  const id = headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}
