// app/api/alertas/route.ts
// Listar y marcar como leídas las alertas de licitaciones encontradas
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// GET — lista alertas del usuario (paginadas), opcionalmente solo no-leídas
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const soloNoLeidas = searchParams.get('noLeidas') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

  try {
    const whereExtra = soloNoLeidas ? ' AND leida = FALSE' : '';
    const [rows] = await pool.query(
      `SELECT id, keyword_texto, licitacion_codigo, licitacion_nombre,
              licitacion_organismo, licitacion_monto, licitacion_cierre,
              licitacion_estado, licitacion_region, leida, created_at
       FROM alertas_licitaciones
       WHERE usuario_id = ?${whereExtra}
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM alertas_licitaciones WHERE usuario_id = ? AND leida = FALSE`,
      [userId]
    );
    const noLeidas = (countRows as any[])[0]?.total || 0;

    return NextResponse.json({ success: true, alertas: rows, noLeidas });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — marcar como leída(s)
// Body: { ids: number[] } o { all: true } para marcar todas
export async function PATCH(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { ids, all } = await request.json();

    if (all) {
      await pool.query(
        `UPDATE alertas_licitaciones SET leida = TRUE WHERE usuario_id = ?`,
        [userId]
      );
    } else if (ids?.length) {
      const placeholders = ids.map(() => '?').join(',');
      await pool.query(
        `UPDATE alertas_licitaciones SET leida = TRUE WHERE id IN (${placeholders}) AND usuario_id = ?`,
        [...ids, userId]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar alerta
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  try {
    await pool.query(
      `DELETE FROM alertas_licitaciones WHERE id = ? AND usuario_id = ?`,
      [id, userId]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
