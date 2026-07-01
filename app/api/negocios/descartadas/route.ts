// app/api/negocios/descartadas/route.ts
// Apartado "Descartadas" (SOLO ADMIN): lista los negocios con estado_pipeline = 'DESCARTADA'
// con quién los descartó, el motivo, la fecha y los datos de la licitación.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (usuario.rol !== 'admin') return NextResponse.json({ error: 'Solo el admin puede ver las descartadas' }, { status: 403 });

  try {
    const [rows, usuariosRes] = await Promise.all([
      pool.query(
        `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
                n.licitacion_monto, n.licitacion_cierre, n.licitacion_tipo, n.licitacion_estado,
                n.asignado_a, n.descarte_motivo, n.descarte_at,
                u.nombre AS asignado_nombre, u.email AS asignado_email,
                d.nombre AS descarte_por_nombre, d.email AS descarte_por_email
           FROM negocios n
           JOIN usuarios u ON u.id = n.asignado_a
      LEFT JOIN usuarios d ON d.id = n.descarte_por
          WHERE n.activo = TRUE AND n.estado_pipeline = 'DESCARTADA'
          ORDER BY COALESCE(n.descarte_at, n.updated_at) DESC`,
      ),
      pool.query(`SELECT id, nombre, email FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC`),
    ]);
    return NextResponse.json({
      success: true,
      descartadas: (rows as any)[0],
      usuarios: (usuariosRes as any)[0],
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
