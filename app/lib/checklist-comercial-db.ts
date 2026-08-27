// app/lib/checklist-comercial-db.ts
// Escrituras de apoyo del checklist (documentos adjuntos + bitácora), extraídas de
// app/api/negocios/[id]/comercial/route.ts para que también las pueda usar código de lib.
//
// POR QUÉ SE MOVIERON (19-ago-2026): el motor de comparación masiva
// (app/lib/auditor-comparacion-masiva.ts) las necesita, y el route ya importa ESE motor — dejarlas
// en el route habría creado un ciclo de imports. El route las re-exporta, así que los consumidores
// que ya las traían desde ahí (la ruta .../[itemId]/caracteristicas, /api/aprobaciones) siguen igual.

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
