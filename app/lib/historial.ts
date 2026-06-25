// Registro de eventos del Historial (tabla historial_eventos, migración 29).
// Cada evento queda guardado para auditoría Y se empuja en tiempo real (SSE) al
// destinatario (usuario_id) para su campana de notificaciones.
import pool from '@/app/lib/db';
import { publicar } from '@/app/lib/sse-bus';

export interface EventoHistorial {
  tipo: string;                       // ASIGNACION, REASIGNACION, DESCARTE, CAMBIO_ETAPA, ...
  licitacionCodigo?: string | null;
  licitacionNombre?: string | null;
  usuarioId?: number | null;          // destinatario (a quién le concierne / quién lo ve en su campana)
  usuarioNombre?: string | null;
  actorId?: number | null;            // quién ejecutó la acción
  actorNombre?: string | null;
  mensaje: string;
  metadata?: Record<string, unknown> | null;
}

export async function registrarEvento(e: EventoHistorial): Promise<number | null> {
  try {
    const [r] = await pool.query(
      `INSERT INTO historial_eventos
         (tipo, licitacion_codigo, licitacion_nombre, usuario_id, usuario_nombre, actor_id, actor_nombre, mensaje, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.tipo, e.licitacionCodigo ?? null, e.licitacionNombre ?? null,
        e.usuarioId ?? null, e.usuarioNombre ?? null,
        e.actorId ?? null, e.actorNombre ?? null,
        e.mensaje, e.metadata ? JSON.stringify(e.metadata) : null,
      ],
    );
    const id = (r as any).insertId || null;

    // Tiempo real: empujar al destinatario su nueva notificación.
    if (e.usuarioId) {
      publicar(e.usuarioId, {
        id, tipo: e.tipo, mensaje: e.mensaje,
        licitacion_codigo: e.licitacionCodigo ?? null,
        leido: false, created_at: new Date().toISOString(),
      });
    }
    return id;
  } catch (err) {
    console.error('[historial] registrarEvento falló:', String(err));
    return null; // nunca bloquear la acción principal por un fallo de historial
  }
}
