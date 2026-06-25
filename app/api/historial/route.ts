// app/api/historial/route.ts
// GET   → notificaciones del usuario (para la campana) + conteo de no leídas.
//         ?scope=todos (solo admin) → historial completo de la empresa (auditoría).
// PATCH  → marcar como leídas { ids?: number[] } o { all: true }.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const scope = new URL(request.url).searchParams.get('scope');
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '20', 10) || 20, 100);

  try {
    let eventos: any[] = [];
    if (scope === 'todos' && usuario.rol === 'admin') {
      // Auditoría completa (para la página de Historial del admin).
      const [rows] = await pool.query(
        `SELECT id, tipo, licitacion_codigo, licitacion_nombre, usuario_id, usuario_nombre,
                actor_id, actor_nombre, mensaje, metadata, leido, created_at
         FROM historial_eventos ORDER BY created_at DESC LIMIT ?`, [limit]);
      eventos = rows as any[];
    } else {
      // Campana: solo las notificaciones dirigidas a este usuario.
      const [rows] = await pool.query(
        `SELECT id, tipo, licitacion_codigo, licitacion_nombre, actor_nombre, mensaje, leido, created_at
         FROM historial_eventos WHERE usuario_id = ? ORDER BY created_at DESC LIMIT ?`, [usuario.id, limit]);
      eventos = rows as any[];
    }

    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS n FROM historial_eventos WHERE usuario_id = ? AND leido = FALSE`, [usuario.id]);
    const noLeidas = (cnt as any[])[0]?.n || 0;

    return NextResponse.json({ success: true, eventos, noLeidas });
  } catch (e: any) {
    // Si la tabla no existe aún (migración 29 pendiente), no romper la UI.
    return NextResponse.json({ success: true, eventos: [], noLeidas: 0, _error: e.message });
  }
}

export async function PATCH(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { ids, all } = await request.json().catch(() => ({}));
    if (all) {
      await pool.query(`UPDATE historial_eventos SET leido = TRUE WHERE usuario_id = ?`, [usuario.id]);
    } else if (Array.isArray(ids) && ids.length) {
      const ph = ids.map(() => '?').join(',');
      await pool.query(`UPDATE historial_eventos SET leido = TRUE WHERE usuario_id = ? AND id IN (${ph})`, [usuario.id, ...ids]);
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
