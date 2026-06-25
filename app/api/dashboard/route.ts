// app/api/dashboard/route.ts
// Estadísticas del dashboard. Dos vistas según rol:
//  • admin  → panorama de la empresa (radar, viabilidad, pipeline, usuarios, tendencia)
//  • usuario→ sus licitaciones asignadas (etapas del pipeline, montos, próximos cierres)
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosDeUsuario } from '@/app/lib/api-auth';

function getUserFromHeaders(request: NextRequest) {
  const id = request.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  return { id: n, email: request.headers.get('x-user-email') || '', rol: request.headers.get('x-user-rol') || 'usuario' };
}

// Helper: query que no rompe el dashboard si una tabla/columna falta.
async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try { const [rows] = await pool.query(sql, params); return rows as T[]; }
  catch { return []; }
}

export async function GET(request: NextRequest) {
  const sesion = getUserFromHeaders(request);
  if (!sesion) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const esAdmin = sesion.rol === 'admin';
    // Un usuario con permiso ver_otros_negocios ve el panorama ampliado (como admin) en negocios.
    const permisos = await permisosDeUsuario(sesion.id, sesion.rol);
    const verOtros = esAdmin || !!permisos.ver_otros_negocios;

    // ── Favoritos recientes (común) ──────────────────────────────────────────────
    const favoritosRecientes = await q(
      `SELECT codigo, nombre, organismo, monto_total, fecha_cierre, estado, created_at
       FROM favoritos WHERE usuario_id = ? OR usuario_id IS NULL
       ORDER BY created_at DESC LIMIT 5`, [sesion.id]);

    // ── Vista ADMIN: panorama de la empresa ──────────────────────────────────────
    let admin: any = null;
    if (esAdmin) {
      const [tUsers] = await q(`SELECT COUNT(*) AS n FROM usuarios`);
      const [aUsers] = await q(`SELECT COUNT(*) AS n FROM usuarios WHERE activo = TRUE`);
      const [nUsers] = await q(`SELECT COUNT(*) AS n FROM usuarios WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`);
      const ultimosAccesos = await q(
        `SELECT id, email, nombre, empresa, rol, ultimo_login, created_at
         FROM usuarios ORDER BY COALESCE(ultimo_login, created_at) DESC LIMIT 6`);

      const [tLic] = await q(`SELECT COUNT(DISTINCT licitacion_codigo) AS n FROM alertas_licitaciones`);
      const [tViab] = await q(`SELECT COUNT(*) AS n FROM viabilidad_licitacion`);
      const viabilidad = await q(`SELECT semaforo, COUNT(*) AS n FROM viabilidad_licitacion WHERE semaforo IS NOT NULL GROUP BY semaforo`);
      const prefiltro  = await q(`SELECT decision, COUNT(*) AS n FROM prefiltro_licitacion WHERE decision IS NOT NULL GROUP BY decision`);
      const pipeline   = await q(`SELECT COALESCE(estado_pipeline,'1ASIGNADO') AS etapa, COUNT(*) AS n FROM negocios WHERE activo = TRUE GROUP BY etapa`);
      const [mPipe] = await q(`SELECT COALESCE(SUM(licitacion_monto),0) AS total FROM negocios WHERE activo = TRUE`);
      // Detectadas por día (últimos 14 días) para la tendencia.
      const porDia = await q(
        `SELECT DATE(created_at) AS dia, COUNT(DISTINCT licitacion_codigo) AS n
         FROM alertas_licitaciones
         WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
         GROUP BY DATE(created_at) ORDER BY dia ASC`);

      admin = {
        usuarios: { total: tUsers?.n || 0, activos: aUsers?.n || 0, nuevosSemana: nUsers?.n || 0, ultimosAccesos },
        radar: { totalLicitaciones: tLic?.n || 0, conViabilidad: tViab?.n || 0 },
        viabilidad, prefiltro, pipeline, montoPipeline: Number(mPipe?.total || 0), porDia,
      };
    }

    // ── Vista USUARIO: sus licitaciones asignadas ────────────────────────────────
    // (también se calcula para admins, por si quieren ver "lo mío")
    const filtroNeg = verOtros ? '' : 'AND n.asignado_a = ?';
    const pNeg = verOtros ? [] : [sesion.id];
    const [misCount] = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(licitacion_monto),0) AS monto FROM negocios n WHERE n.activo = TRUE ${filtroNeg}`, pNeg);
    const miPipeline = await q(`SELECT COALESCE(estado_pipeline,'1ASIGNADO') AS etapa, COUNT(*) AS n FROM negocios n WHERE n.activo = TRUE ${filtroNeg} GROUP BY etapa`, pNeg);
    const proximosCierres = await q(
      `SELECT n.licitacion_codigo AS codigo, n.licitacion_nombre AS nombre, n.licitacion_organismo AS organismo,
              n.licitacion_cierre AS cierre, n.licitacion_monto AS monto
       FROM negocios n
       WHERE n.activo = TRUE AND n.licitacion_cierre IS NOT NULL AND n.licitacion_cierre >= NOW() ${filtroNeg}
       ORDER BY n.licitacion_cierre ASC LIMIT 6`, pNeg);

    const usuario = {
      asignadas: misCount?.n || 0,
      montoAsignadas: Number(misCount?.monto || 0),
      pipeline: miPipeline,
      proximosCierres,
    };

    return NextResponse.json({ success: true, rol: sesion.rol, admin, usuario, favoritosRecientes });
  } catch (error) {
    console.error('Error en dashboard stats:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
