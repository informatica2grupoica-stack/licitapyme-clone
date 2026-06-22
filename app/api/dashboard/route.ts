// app/api/dashboard/route.ts
// Estadísticas personales del usuario + totales de admin
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUserFromHeaders(request: NextRequest) {
  const id = request.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  return { id: n, email: request.headers.get('x-user-email') || '', rol: request.headers.get('x-user-rol') || 'user' };
}

export async function GET(request: NextRequest) {
  const sesion = getUserFromHeaders(request);
  if (!sesion) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    // Favoritos del usuario
    let totalFavoritos = 0;
    try {
      const [fRows] = await pool.query(
        `SELECT COUNT(*) as total FROM favoritos WHERE usuario_id = ? OR usuario_id IS NULL`,
        [sesion.id]
      );
      totalFavoritos = (fRows as any[])[0]?.total || 0;
    } catch {
      // columna usuario_id puede no existir aún
      const [fRows] = await pool.query(`SELECT COUNT(*) as total FROM favoritos`);
      totalFavoritos = (fRows as any[])[0]?.total || 0;
    }

    // Documentos subidos
    let totalDocumentos = 0;
    try {
      const [dRows] = await pool.query(
        `SELECT COUNT(*) as total FROM documentos_cache WHERE usuario_id = ? OR usuario_id IS NULL`,
        [sesion.id]
      );
      totalDocumentos = (dRows as any[])[0]?.total || 0;
    } catch {
      const [dRows] = await pool.query(`SELECT COUNT(*) as total FROM documentos_cache`);
      totalDocumentos = (dRows as any[])[0]?.total || 0;
    }

    // Análisis IA realizados
    let totalAnalisis = 0;
    try {
      const [aRows] = await pool.query(
        `SELECT COUNT(*) as total FROM analisis_cache WHERE usuario_id = ?`,
        [sesion.id]
      );
      totalAnalisis = (aRows as any[])[0]?.total || 0;
    } catch { /* tabla puede no existir aún */ }

    // Favoritos recientes
    let favoritosRecientes: any[] = [];
    try {
      const [fRecRows] = await pool.query(
        `SELECT codigo, nombre, organismo, monto_total, fecha_cierre, estado, created_at
         FROM favoritos
         WHERE usuario_id = ? OR usuario_id IS NULL
         ORDER BY created_at DESC LIMIT 5`,
        [sesion.id]
      );
      favoritosRecientes = fRecRows as any[];
    } catch {
      const [fRecRows] = await pool.query(
        `SELECT codigo, nombre, organismo, monto_total, fecha_cierre, estado, created_at
         FROM favoritos ORDER BY created_at DESC LIMIT 5`
      );
      favoritosRecientes = fRecRows as any[];
    }

    // Admin: estadísticas de usuarios
    let statsAdmin = null;
    if (sesion.rol === 'admin') {
      const [totalUsers] = await pool.query(`SELECT COUNT(*) as total FROM usuarios`);
      const [activeUsers] = await pool.query(`SELECT COUNT(*) as total FROM usuarios WHERE activo = TRUE`);
      const [newUsers] = await pool.query(
        `SELECT COUNT(*) as total FROM usuarios WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
      );
      const [lastLogins] = await pool.query(
        `SELECT id, email, nombre, empresa, rol, ultimo_login, created_at
         FROM usuarios ORDER BY COALESCE(ultimo_login, created_at) DESC LIMIT 6`
      );
      statsAdmin = {
        totalUsuarios:  (totalUsers as any[])[0]?.total || 0,
        usuariosActivos: (activeUsers as any[])[0]?.total || 0,
        nuevosEstaSemana: (newUsers as any[])[0]?.total || 0,
        ultimosAccesos: lastLogins as any[],
      };
    }

    return NextResponse.json({
      success: true,
      stats: {
        favoritos:   totalFavoritos,
        documentos:  totalDocumentos,
        analisisIA:  totalAnalisis,
      },
      favoritosRecientes,
      admin: statsAdmin,
    });
  } catch (error) {
    console.error('Error en dashboard stats:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
