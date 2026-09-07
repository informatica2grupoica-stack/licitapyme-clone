// app/lib/checklist-comercial-db.ts
// Escrituras de apoyo del checklist (documentos adjuntos + bitácora), extraídas de
// app/api/negocios/[id]/comercial/route.ts para que también las pueda usar código de lib.
//
// El route las re-exporta, así que los consumidores que ya las traían desde ahí (la ruta
// .../[itemId]/caracteristicas, /api/aprobaciones) siguen igual.

import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

/**
 * Agrega documentos nuevos a un punto (nunca reemplaza los anteriores: se acumulan).
 *
 * DEDUPLICA por (item_id, url): la MISMA url ya adjunta no se vuelve a insertar. Sin esto, volver
 * a comparar la misma ficha (re-validar, un job de comparación masiva reintentado, o simplemente
 * probar de nuevo) apilaba una fila idéntica cada vez — detectado 27-ago-2026 en un caso real
 * donde una ficha se comparó varias veces seguidas y la lista de "Documentos" de la línea quedó
 * con 6 copias del mismo archivo. Documentos DISTINTOS (otra url) siguen acumulándose igual que
 * siempre — esto no es un historial de intentos, es evidencia adjunta de la línea.
 */
export async function agregarDocumentos(
  itemId: number, negocioId: number, docs: Array<{ url: string; nombre: string }>,
  userId: number, userNombre: string,
): Promise<void> {
  if (!docs.length) return;

  const [existentes] = await pool.query(
    `SELECT url FROM checklist_comercial_documentos WHERE item_id = ?`, [itemId],
  ) as any;
  const urlsExistentes = new Set((existentes as any[]).map(r => r.url));

  for (const d of docs) {
    const url = d.url.slice(0, 600);
    if (urlsExistentes.has(url)) continue;
    await pool.query(
      `INSERT INTO checklist_comercial_documentos (item_id, negocio_id, url, nombre, subido_por, subido_por_nombre, subido_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [itemId, negocioId, url, d.nombre.slice(0, 300), userId, userNombre, ahoraChileSQL()],
    );
    urlsExistentes.add(url);   // por si docs[] trae la misma url dos veces en la misma llamada
  }
}

/**
 * Limpia del checklist cualquier referencia a un documento que se borró en OTRO lugar — hoy el
 * único llamador es el DELETE de "Documentos y Bases" (`/api/documentos/[codigo]`).
 *
 * BUG REAL (07-sep-2026): ese DELETE solo tocaba `documentos_cache`. Si el documento ya se había
 * "enviado al Auditor" (checklist_comercial_documentos apuntando a esa misma url), el punto se
 * quedaba en CARGADO/APROBADO ("Por aprobar") con una URL que ya no existe en ninguna parte —
 * mismo síntoma que el bug de ELIMINAR_DOCUMENTO (ver el PATCH de comercial/route.ts), pero por
 * la otra puerta: acá no hay un `itemId` de partida, hay que encontrarlo por la URL borrada.
 *
 * Misma regla que ELIMINAR_DOCUMENTO: si esa era la ÚLTIMA evidencia del punto, vuelve a
 * PENDIENTE (como si nunca se hubiera cargado nada); si quedan otras, solo demota
 * APROBADO→CARGADO. Devuelve los `negocioId` afectados para que el llamador decida si avisa por SSE.
 */
export async function quitarDocumentoDelChecklistPorUrl(
  url: string, docNombre: string, userId: number | null, userNombre: string,
): Promise<number[]> {
  const [afectados] = await pool.query(
    `SELECT DISTINCT item_id, negocio_id FROM checklist_comercial_documentos WHERE url = ?`, [url],
  ) as any;
  const items = afectados as Array<{ item_id: number; negocio_id: number }>;
  if (!items.length) return [];

  for (const { item_id: itemId, negocio_id: negocioId } of items) {
    await pool.query(`DELETE FROM checklist_comercial_documentos WHERE item_id = ? AND url = ?`, [itemId, url]);

    const [[{ quedan }]] = await pool.query(
      `SELECT COUNT(*) AS quedan FROM checklist_comercial_documentos WHERE item_id = ?`, [itemId],
    ) as any;
    const [itemRows] = await pool.query(`SELECT estado FROM checklist_comercial WHERE id = ?`, [itemId]) as any;
    const estadoActual = (itemRows as any[])[0]?.estado;
    if (!estadoActual) continue;   // el punto ya no existe (negocio borrado, etc.)

    let nuevoEstado = estadoActual;
    if (quedan > 0) {
      if (estadoActual === 'APROBADO') {
        nuevoEstado = 'CARGADO';
        await pool.query(
          `UPDATE checklist_comercial SET estado = 'CARGADO', aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL WHERE id = ?`,
          [itemId],
        );
      }
    } else if (estadoActual !== 'PENDIENTE') {
      nuevoEstado = 'PENDIENTE';
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'PENDIENTE', observacion = NULL,
                cargado_por = NULL, cargado_por_nombre = NULL, cargado_at = NULL,
                aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [itemId],
      );
    }
    if (nuevoEstado !== estadoActual)
      await bitacora(itemId, negocioId, 'ELIMINAR_DOCUMENTO', estadoActual, nuevoEstado, `Se borró "${docNombre}" desde Documentos`, userId, userNombre);
  }

  return Array.from(new Set(items.map(i => i.negocio_id)));
}

export async function bitacora(
  itemId: number, negocioId: number, accion: string,
  anterior: string | null, nuevo: string, comentario: string | null,
  userId: number | null, userNombre: string,
) {
  try {
    await pool.query(
      `INSERT INTO checklist_comercial_bitacora
         (item_id, negocio_id, accion, estado_anterior, estado_nuevo, comentario, usuario_id, usuario_nombre, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemId, negocioId, accion, anterior, nuevo, comentario, userId, userNombre, ahoraChileSQL()],
    );
  } catch (e) {
    console.error('[comercial] bitácora falló:', String(e));  // nunca bloquear la acción principal
  }
}
