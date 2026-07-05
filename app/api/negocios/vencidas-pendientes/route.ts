// app/api/negocios/vencidas-pendientes/route.ts
// Negocios cuya fecha de cierre YA venció y que siguen en un estado intermedio
// del pipeline (ni postulados ni descartados). Alimenta el modal bloqueante que
// obliga a cerrar el ciclo al entrar a la plataforma.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

// Estados que "cierran el ciclo": ya no se exige resolución.
const ESTADOS_RESUELTOS = [
  '7POSTULADO_JV', 'DESCARTADA',
  'ADJ_JV', '8POSIBLE_ADJ', '9PERDIDA',
];

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    // Si la tabla aún no existe, no bloquear la app.
    try { await pool.query('SELECT 1 FROM negocios LIMIT 1'); }
    catch { return NextResponse.json({ success: true, pendientes: [] }); }

    const ph = ESTADOS_RESUELTOS.map(() => '?').join(',');
    // Admin ve (y debe resolver) todas; usuario normal solo las suyas.
    const filtroUsuario = rol === 'admin' ? '' : 'AND n.asignado_a = ?';
    const params: any[] = [...ESTADOS_RESUELTOS];
    if (rol !== 'admin') params.push(userId);

    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
              n.licitacion_cierre, COALESCE(n.estado_pipeline, '1ASIGNADO') AS estado_pipeline,
              u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a
       WHERE n.activo = TRUE
         AND n.licitacion_cierre IS NOT NULL
         AND n.licitacion_cierre < NOW()
         AND COALESCE(n.estado_pipeline, '1ASIGNADO') NOT IN (${ph})
         ${filtroUsuario}
       ORDER BY n.licitacion_cierre ASC`,
      params,
    ) as any;

    return NextResponse.json({ success: true, pendientes: rows as any[] });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
