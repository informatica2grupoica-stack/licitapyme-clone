// app/api/admin/reportes-error/route.ts
// GET — bandeja de reportes de error de todos los perfiles (/admin/errores). Solo admin.
// proxy.ts ya bloquea /api/admin a no-admins; se reverifica contra el JWT (defensa en profundidad).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { esAdmin } from '@/app/lib/api-auth';

export async function GET(req: NextRequest) {
  if (!(await esAdmin(req))) return NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 });
  try {
    // ?resumen=1 → solo el contador para el badge del sidebar.
    if (req.nextUrl.searchParams.get('resumen')) {
      const [[r]] = await pool.query(`SELECT COUNT(*) n FROM reportes_error WHERE estado IN ('abierto', 'en_revision')`) as any;
      return NextResponse.json({ success: true, pendientes: Number(r.n) });
    }
    const [rows] = await pool.query(
      `SELECT id, usuario_id, usuario_nombre, usuario_email, url, titulo, que_paso, que_esperaba, pasos,
              gravedad, imagen_url, contexto, estado, solucion, solucion_visible, resuelto_por_nombre, resuelto_at,
              created_at, updated_at
       FROM reportes_error
       ORDER BY FIELD(estado, 'abierto', 'en_revision', 'resuelto', 'descartado'), created_at DESC
       LIMIT 500`,
    );
    return NextResponse.json({ success: true, reportes: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
