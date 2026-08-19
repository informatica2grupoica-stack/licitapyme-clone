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

/** Agrega documentos nuevos a un punto (nunca reemplaza los anteriores: se acumulan). */
export async function agregarDocumentos(
  itemId: number, negocioId: number, docs: Array<{ url: string; nombre: string }>,
  userId: number, userNombre: string,
): Promise<void> {
  if (!docs.length) return;
  for (const d of docs) {
    await pool.query(
      `INSERT INTO checklist_comercial_documentos (item_id, negocio_id, url, nombre, subido_por, subido_por_nombre, subido_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [itemId, negocioId, d.url.slice(0, 600), d.nombre.slice(0, 300), userId, userNombre, ahoraChileSQL()],
    );
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
