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

  const sp = new URL(request.url).searchParams;
  const scope = sp.get('scope');
  const codigo = sp.get('codigo');
  const limit = Math.min(parseInt(sp.get('limit') || '20', 10) || 20, 100);

  try {
    let eventos: any[] = [];
    if (codigo) {
      // Mini-historial POR LICITACIÓN: bitácora de lo que hace CADA perfil sobre esta
      // licitación (asignar, cambiar líneas/estado, comentar, ver, viabilidad, costeo,
      // documentos…). Se lee de actividad_usuario (registra también las acciones propias
      // del asignado, no solo las notificaciones entre usuarios). DESC: si la licitación
      // supera el LIMIT, se recortan los eventos VIEJOS, no los recientes (el front reordena).
      // Requiere poder ver la licitación (externo → solo asignadas). Nadie puede borrar.
      const { puedeVerLicitacion } = await import('@/app/lib/api-auth');
      if (!(await puedeVerLicitacion(request, codigo))) {
        return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
      }
      try {
        const [rows] = await pool.query(
          `SELECT a.id, a.accion AS tipo, a.descripcion AS mensaje,
                  a.usuario_id AS actor_id, u.nombre AS actor_nombre, u.email AS actor_email,
                  a.created_at
           FROM actividad_usuario a
           LEFT JOIN usuarios u ON u.id = a.usuario_id
           WHERE (a.entidad_tipo = 'licitacion' AND a.entidad_id = ?)
              OR a.metadata LIKE CONCAT('%"licitacion_codigo":"', ?, '"%')
           ORDER BY a.created_at DESC
           LIMIT ?`,
          [codigo, codigo, Math.min(limit, 200)]);
        return NextResponse.json({ success: true, eventos: rows, noLeidas: 0 });
      } catch {
        // Tabla ausente (migración 18 pendiente) → sin historial, sin romper la UI.
        return NextResponse.json({ success: true, eventos: [], noLeidas: 0 });
      }
    }
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
