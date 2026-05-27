// app/api/favorites/route.ts
// Favoritos user-scoped.
// Resiliente: intenta con 'favoritos' primero; si la tabla no existe, usa 'favorites' (legacy).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUserId(request: NextRequest): number | null {
  const id = request.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// Detecta qué tabla usar (con caché simple en memoria por proceso)
let resolvedTable: 'favoritos' | 'favorites' | null = null;
async function getTable(): Promise<'favoritos' | 'favorites'> {
  if (resolvedTable) return resolvedTable;
  try {
    await pool.query(`SELECT 1 FROM favoritos LIMIT 1`);
    resolvedTable = 'favoritos';
  } catch {
    resolvedTable = 'favorites';
  }
  return resolvedTable;
}

// GET — lista todos los favoritos del usuario
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

  try {
    const table = await getTable();
    let rows: any[];

    if (table === 'favoritos') {
      [rows] = await pool.query(
        `SELECT id, codigo, nombre, organismo, monto_total, monto_estimado, moneda,
                fecha_cierre, fecha_adjudicacion, estado, tipo_licitacion,
                region, descripcion, resumen_ia, created_at
         FROM favoritos
         WHERE usuario_id = ?
         ORDER BY created_at DESC`,
        [userId]
      ) as any;
    } else {
      // Tabla legacy: devuelve todos (sin filtro de usuario)
      [rows] = await pool.query(
        `SELECT id, codigo, nombre, organismo, monto_total, monto_estimado, moneda,
                fecha_cierre, fecha_adjudicacion, estado, tipo_licitacion,
                region, descripcion, created_at
         FROM favorites
         ORDER BY created_at DESC`
      ) as any;
    }

    return NextResponse.json({ success: true, favorites: rows });
  } catch (error) {
    console.error('Error al obtener favoritos:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener favoritos' }, { status: 500 });
  }
}

// POST — agregar favorito
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

  try {
    const body = await request.json();
    const table = await getTable();

    if (table === 'favoritos') {
      await pool.query(
        `INSERT INTO favoritos (
          usuario_id, codigo, nombre, organismo, monto_total, monto_estimado, moneda,
          fecha_cierre, fecha_adjudicacion, estado, tipo_licitacion,
          tipo_convocatoria, region, comuna, descripcion, resumen_ia,
          detail_url, search_url, semantic_score, final_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          nombre = VALUES(nombre), organismo = VALUES(organismo),
          monto_total = VALUES(monto_total), monto_estimado = VALUES(monto_estimado),
          estado = VALUES(estado), fecha_adjudicacion = VALUES(fecha_adjudicacion),
          descripcion = VALUES(descripcion), resumen_ia = VALUES(resumen_ia)`,
        [
          userId, body.codigo, body.nombre, body.organismo,
          body.monto_total || null, body.monto_estimado || null, body.moneda || 'CLP',
          body.fecha_cierre || null, body.fecha_adjudicacion || null,
          body.estado || null, body.tipo_licitacion || null,
          body.tipo_convocatoria || null, body.region || null, body.comuna || null,
          body.descripcion || null, body.resumen_ia || null,
          body.detail_url || null, body.search_url || null,
          body.semantic_score || null, body.final_score || null,
        ]
      );
    } else {
      // Tabla legacy
      await pool.query(
        `INSERT INTO favorites (
          codigo, nombre, organismo, monto_total, monto_estimado, moneda,
          fecha_cierre, fecha_adjudicacion, estado, tipo_licitacion,
          tipo_convocatoria, region, comuna, descripcion, resumen_ia,
          detail_url, search_url, semantic_score, final_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE estado = VALUES(estado)`,
        [
          body.codigo, body.nombre, body.organismo,
          body.monto_total || null, body.monto_estimado || null, body.moneda || 'CLP',
          body.fecha_cierre || null, body.fecha_adjudicacion || null,
          body.estado || null, body.tipo_licitacion || null,
          body.tipo_convocatoria || null, body.region || null, body.comuna || null,
          body.descripcion || null, body.resumen_ia || null,
          body.detail_url || null, body.search_url || null,
          body.semantic_score || null, body.final_score || null,
        ]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error al agregar favorito:', error);
    return NextResponse.json({ success: false, error: 'Error al agregar favorito' }, { status: 500 });
  }
}

// DELETE — eliminar favorito (?codigo=...)
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const codigo = searchParams.get('codigo');
  if (!codigo) return NextResponse.json({ success: false, error: 'Código requerido' }, { status: 400 });

  try {
    const table = await getTable();
    if (table === 'favoritos') {
      await pool.query(`DELETE FROM favoritos WHERE codigo = ? AND usuario_id = ?`, [codigo, userId]);
    } else {
      await pool.query(`DELETE FROM favorites WHERE codigo = ?`, [codigo]);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error al eliminar favorito:', error);
    return NextResponse.json({ success: false, error: 'Error al eliminar favorito' }, { status: 500 });
  }
}
