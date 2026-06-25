// app/api/palabras-clave/route.ts
// CRUD de palabras clave para búsqueda automática
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// Solo el admin puede crear/editar/eliminar palabras clave de búsqueda.
function esAdmin(req: NextRequest): boolean {
  return req.headers.get('x-user-rol') === 'admin';
}
const SOLO_ADMIN = NextResponse.json({ error: 'Solo el admin puede gestionar las palabras clave' }, { status: 403 });

// GET — listar palabras clave del usuario
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  // Palabras clave COMPARTIDAS entre admins: un admin ve las de TODOS (no solo las suyas),
  // así si un admin agrega una, los demás admins la ven. Un usuario normal (sin radar) solo
  // vería las propias (en la práctica no usa esta vista).
  const admin = esAdmin(request);
  const filtro = admin ? '' : 'WHERE pc.usuario_id = ?';
  const filtroSimple = admin ? '' : 'WHERE usuario_id = ?';
  const params = admin ? [] : [userId];

  try {
    const [rows] = await pool.query(
      `SELECT pc.id, pc.keyword, pc.categoria_id, pc.activo, pc.es_negativa,
              pc.ultima_busqueda, pc.resultados_nuevos, pc.total_encontradas, pc.created_at,
              e.nombre AS categoria_nombre, e.color AS categoria_color
       FROM palabras_clave pc
       LEFT JOIN etiquetas e ON e.id = pc.categoria_id
       ${filtro}
       ORDER BY pc.created_at DESC`,
      params
    );
    return NextResponse.json({ success: true, keywords: rows });
  } catch (error: any) {
    // Si falta la columna es_negativa (migración 30 pendiente), reintentar sin ella.
    if (error?.code === 'ER_BAD_FIELD_ERROR' && /es_negativa/.test(String(error?.message))) {
      try {
        const [rows] = await pool.query(
          `SELECT pc.id, pc.keyword, pc.categoria_id, pc.activo,
                  pc.ultima_busqueda, pc.resultados_nuevos, pc.total_encontradas, pc.created_at,
                  e.nombre AS categoria_nombre, e.color AS categoria_color
           FROM palabras_clave pc
           LEFT JOIN etiquetas e ON e.id = pc.categoria_id
           ${filtro}
           ORDER BY pc.created_at DESC`,
          params
        );
        return NextResponse.json({ success: true, keywords: rows });
      } catch { /* cae al siguiente fallback */ }
    }
    // Si falta la columna categoria_id (migración 16 pendiente), responder sin categorías.
    if (error?.code === 'ER_BAD_FIELD_ERROR' && /categoria_id/.test(String(error?.message))) {
      const [rows] = await pool.query(
        `SELECT id, keyword, activo, ultima_busqueda, resultados_nuevos, total_encontradas, created_at
         FROM palabras_clave ${filtroSimple} ORDER BY created_at DESC`,
        params
      );
      return NextResponse.json({ success: true, keywords: rows });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — crear palabra clave
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!esAdmin(request)) return SOLO_ADMIN;

  try {
    const { keyword, categoria_id, es_negativa } = await request.json();
    if (!keyword?.trim()) return NextResponse.json({ error: 'keyword requerido' }, { status: 400 });

    const kw = keyword.trim().toLowerCase();
    const catId = categoria_id ? parseInt(categoria_id, 10) : null;
    const negativa = es_negativa ? 1 : 0;

    // Verificar duplicado GLOBAL (compartidas entre admins): si cualquier admin ya la tiene,
    // no se duplica. Se guarda quién la creó (usuario_id) solo como referencia.
    const [exist] = await pool.query(
      `SELECT id FROM palabras_clave WHERE keyword = ?`,
      [kw]
    );
    if ((exist as any[]).length > 0) {
      return NextResponse.json({ error: 'Esa palabra clave ya existe' }, { status: 409 });
    }

    let id: number;
    try {
      const [result] = await pool.query(
        `INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, es_negativa) VALUES (?, ?, ?, ?)`,
        [userId, kw, catId, negativa]
      );
      id = (result as any).insertId;
    } catch (error: any) {
      // Si falta la columna es_negativa (migración 30 pendiente), insertar sin ella.
      if (error?.code === 'ER_BAD_FIELD_ERROR' && /es_negativa/.test(String(error?.message))) {
        try {
          const [result] = await pool.query(
            `INSERT INTO palabras_clave (usuario_id, keyword, categoria_id) VALUES (?, ?, ?)`,
            [userId, kw, catId]
          );
          id = (result as any).insertId;
        } catch (e2: any) {
          if (e2?.code === 'ER_BAD_FIELD_ERROR' && /categoria_id/.test(String(e2?.message))) {
            const [result] = await pool.query(
              `INSERT INTO palabras_clave (usuario_id, keyword) VALUES (?, ?)`,
              [userId, kw]
            );
            id = (result as any).insertId;
          } else throw e2;
        }
      } else if (error?.code === 'ER_BAD_FIELD_ERROR' && /categoria_id/.test(String(error?.message))) {
        // Falta categoria_id (migración 16 pendiente), insertar sin ella.
        const [result] = await pool.query(
          `INSERT INTO palabras_clave (usuario_id, keyword) VALUES (?, ?)`,
          [userId, kw]
        );
        id = (result as any).insertId;
      } else throw error;
    }

    return NextResponse.json({ success: true, id, keyword: kw, es_negativa: negativa });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — toggle activo o actualizar
export async function PATCH(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!esAdmin(request)) return SOLO_ADMIN;

  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    // Actualización parcial: solo los campos presentes en el body.
    const sets: string[] = [];
    const vals: any[] = [];
    if ('activo' in body)       { sets.push('activo = ?');       vals.push(body.activo ? 1 : 0); }
    if ('categoria_id' in body) { sets.push('categoria_id = ?'); vals.push(body.categoria_id ? parseInt(body.categoria_id, 10) : null); }
    if ('es_negativa' in body)  { sets.push('es_negativa = ?');  vals.push(body.es_negativa ? 1 : 0); }
    if (sets.length === 0) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });

    // Compartidas entre admins: cualquier admin puede editar (no se ata a usuario_id).
    vals.push(id);
    await pool.query(
      `UPDATE palabras_clave SET ${sets.join(', ')} WHERE id = ?`,
      vals
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar palabra clave
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!esAdmin(request)) return SOLO_ADMIN;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  try {
    // Compartidas entre admins: cualquier admin puede borrar.
    await pool.query(
      `DELETE FROM palabras_clave WHERE id = ?`,
      [id]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
