// Aviso cuando alguien cambia la CANTIDAD de un ítem del costeo digital (pedido del dueño, 25-nov-2026):
//   · campana (y solo campana) para los admin de LA MISMA empresa que el negocio, menos quien hizo el cambio;
//   · una marca aparte (tipo COSTEO_CANTIDAD_MARCA, sin destinatario, así no sale en ninguna campana) que el costeo lee para
//     mostrar arriba la señal roja con quién, día y hora. La marca vive en historial_eventos y no en datos_json del costeo
//     porque hay varios procesos que reescriben datos_json (Compras, re-análisis, OC propia) y la habrían borrado.
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';

export const TIPO_MARCA_CANTIDAD = 'COSTEO_CANTIDAD_MARCA';
export const TIPO_AVISO_CANTIDAD = 'COSTEO_CANTIDAD_MODIFICADA';

export interface AlertaCantidad { quien: string; fecha: string; cambios: string[] }

export async function avisarCambioDeCantidad(
  negocio: { id: number; licitacion_codigo: string; cliente_id: number },
  actor: { id: number; nombre: string },
  cambios: string[],
): Promise<void> {
  if (!cambios.length) return;
  const resumen = cambios.slice(0, 3).join('; ') + (cambios.length > 3 ? `; y ${cambios.length - 3} más` : '');
  await registrarEvento({
    tipo: TIPO_MARCA_CANTIDAD, licitacionCodigo: negocio.licitacion_codigo, actorId: actor.id, actorNombre: actor.nombre,
    mensaje: `${actor.nombre} modificó la cantidad en el costeo: ${resumen}`.slice(0, 500),
    metadata: { negocio_id: negocio.id, cambios },
  });
  const [admins] = await pool.query(
    `SELECT id, nombre FROM usuarios WHERE rol = 'admin' AND activo = TRUE AND cliente_id = ? AND id <> ?`,
    [negocio.cliente_id, actor.id]) as any;
  for (const a of admins as Array<{ id: number; nombre: string }>) {
    await registrarEvento({
      tipo: TIPO_AVISO_CANTIDAD, licitacionCodigo: negocio.licitacion_codigo, usuarioId: Number(a.id), usuarioNombre: a.nombre,
      actorId: actor.id, actorNombre: actor.nombre,
      mensaje: `${actor.nombre} modificó la cantidad de ítems en el costeo de ${negocio.licitacion_codigo}: ${resumen}`.slice(0, 500),
      metadata: { negocio_id: negocio.id, cambios },
    });
  }
}

/** La última modificación de cantidad de ESTE negocio (null si nunca pasó). Fecha en hora de Chile, 'YYYY-MM-DD HH:mm:ss'. */
export async function ultimaAlertaCantidad(negocio: { id: number; licitacion_codigo: string; cliente_id: number }): Promise<AlertaCantidad | null> {
  try {
    const [rows] = await pool.query(
      `SELECT actor_nombre, metadata, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS fecha
         FROM historial_eventos WHERE tipo = ? AND licitacion_codigo = ? AND cliente_id = ?
        ORDER BY created_at DESC, id DESC LIMIT 20`,
      [TIPO_MARCA_CANTIDAD, negocio.licitacion_codigo, negocio.cliente_id]) as any;
    for (const r of rows as any[]) {
      let m: any = {};
      try { m = (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) || {}; } catch { /* metadata ilegible: se salta */ }
      if (Number(m.negocio_id) !== Number(negocio.id)) continue;
      return { quien: r.actor_nombre || 'Un usuario', fecha: String(r.fecha), cambios: Array.isArray(m.cambios) ? m.cambios.map(String) : [] };
    }
  } catch (e) { console.error('[costeo-aviso-cantidad] no se pudo leer la última alerta:', String(e).slice(0, 150)); }
  return null;
}
