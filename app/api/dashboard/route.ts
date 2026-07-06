// app/api/dashboard/route.ts
// Estadísticas del dashboard. Dos vistas según rol:
//  • admin  → panorama de la empresa (radar, viabilidad, pipeline, usuarios, tendencia)
//  • usuario→ sus licitaciones asignadas (etapas del pipeline, montos, próximos cierres)
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';

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

      // "Licitaciones en radar" = SOLO las activas (Publicada), tipo LE/LP/LR/LS y que
      // NO estén ya asignadas a un perfil (las que faltan por trabajar). El tipo sale del
      // sufijo del código (…-LE26, …-LP26…). Excluye compra ágil (CO), L1, adjudicadas, etc.
      const [tLic] = await q(
        `SELECT COUNT(DISTINCT al.licitacion_codigo) AS n
         FROM alertas_licitaciones al
         WHERE al.licitacion_estado = 'Publicada'
           AND al.licitacion_codigo REGEXP '-(LE|LP|LR|LS)[0-9]+$'
           AND NOT EXISTS (
             SELECT 1 FROM negocios n
             WHERE n.licitacion_codigo = al.licitacion_codigo AND n.activo = TRUE)`);
      // Viabilidad y prefiltro reflejan el estado REAL: solo licitaciones que siguen
      // activas (Publicada) en el radar, no el acumulado histórico de la tabla.
      const [tViab] = await q(
        `SELECT COUNT(DISTINCT v.licitacion_codigo) AS n FROM viabilidad_licitacion v
         WHERE EXISTS (SELECT 1 FROM alertas_licitaciones al
           WHERE al.licitacion_codigo = v.licitacion_codigo AND al.licitacion_estado = 'Publicada')`);
      const viabilidad = await q(
        `SELECT v.semaforo, COUNT(DISTINCT v.licitacion_codigo) AS n FROM viabilidad_licitacion v
         WHERE v.semaforo IS NOT NULL
           AND EXISTS (SELECT 1 FROM alertas_licitaciones al
             WHERE al.licitacion_codigo = v.licitacion_codigo AND al.licitacion_estado = 'Publicada')
         GROUP BY v.semaforo`);
      const prefiltro  = await q(
        `SELECT p.decision, COUNT(DISTINCT p.licitacion_codigo) AS n FROM prefiltro_licitacion p
         WHERE p.decision IS NOT NULL
           AND EXISTS (SELECT 1 FROM alertas_licitaciones al
             WHERE al.licitacion_codigo = p.licitacion_codigo AND al.licitacion_estado = 'Publicada')
         GROUP BY p.decision`);
      // Pipeline = negocios EN TRABAJO (excluye las DESCARTADA: ya no se trabajan).
      const pipeline   = await q(`SELECT COALESCE(estado_pipeline,'1ASIGNADO') AS etapa, COUNT(*) AS n
         FROM negocios WHERE activo = TRUE AND COALESCE(estado_pipeline,'1ASIGNADO') <> 'DESCARTADA'
         GROUP BY etapa`);
      const [mPipe] = await q(`SELECT COALESCE(SUM(licitacion_monto),0) AS total
         FROM negocios WHERE activo = TRUE AND COALESCE(estado_pipeline,'1ASIGNADO') <> 'DESCARTADA'`);
      // Detectadas por día (últimos 14 días) para la tendencia.
      const porDia = await q(
        `SELECT DATE(created_at) AS dia, COUNT(DISTINCT licitacion_codigo) AS n
         FROM alertas_licitaciones
         WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
         GROUP BY DATE(created_at) ORDER BY dia ASC`);

      // Desglose POR PERFIL: seguimiento de cada usuario (asignadas, monto, descartadas y
      // distribución por etapa del pipeline). Una sola query agrupada usuario × etapa; el
      // resto se arma en JS.
      const perfilRows = await q<{ uid: number; nombre: string | null; email: string; etapa: string; n: number; monto: number }>(
        `SELECT n.asignado_a AS uid, u.nombre, u.email,
                COALESCE(n.estado_pipeline,'1ASIGNADO') AS etapa,
                COUNT(*) AS n, COALESCE(SUM(n.licitacion_monto),0) AS monto
         FROM negocios n JOIN usuarios u ON u.id = n.asignado_a
         WHERE n.activo = TRUE
         GROUP BY n.asignado_a, u.nombre, u.email, etapa`);
      const perfilMap = new Map<number, { id: number; nombre: string | null; email: string; total: number; monto: number; descartadas: number; pipeline: { etapa: string; n: number }[] }>();
      for (const r of perfilRows) {
        if (!perfilMap.has(r.uid)) perfilMap.set(r.uid, { id: r.uid, nombre: r.nombre, email: r.email, total: 0, monto: 0, descartadas: 0, pipeline: [] });
        const p = perfilMap.get(r.uid)!;
        // Las DESCARTADA se cuentan aparte y NO entran en total/monto/flujo (en trabajo).
        if (r.etapa === 'DESCARTADA') { p.descartadas += Number(r.n); continue; }
        p.total += Number(r.n); p.monto += Number(r.monto);
        p.pipeline.push({ etapa: r.etapa, n: Number(r.n) });
      }
      const porPerfil = [...perfilMap.values()].sort((a, b) => b.total - a.total);

      admin = {
        usuarios: { total: tUsers?.n || 0, activos: aUsers?.n || 0, nuevosSemana: nUsers?.n || 0, ultimosAccesos },
        radar: { totalLicitaciones: tLic?.n || 0, conViabilidad: tViab?.n || 0 },
        viabilidad, prefiltro, pipeline, montoPipeline: Number(mPipe?.total || 0), porDia, porPerfil,
      };
    }

    // ── Vista USUARIO: sus licitaciones asignadas ────────────────────────────────
    // (también se calcula para admins, por si quieren ver "lo mío")
    // Las DESCARTADA no cuentan como "en trabajo": fuera de conteos, montos y cierres.
    const sinDescartadas = `AND COALESCE(n.estado_pipeline,'1ASIGNADO') <> 'DESCARTADA'`;
    const filtroNeg = verOtros ? '' : 'AND n.asignado_a = ?';
    const pNeg = verOtros ? [] : [sesion.id];
    const [misCount] = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(licitacion_monto),0) AS monto FROM negocios n WHERE n.activo = TRUE ${sinDescartadas} ${filtroNeg}`, pNeg);
    const miPipeline = await q(`SELECT COALESCE(estado_pipeline,'1ASIGNADO') AS etapa, COUNT(*) AS n FROM negocios n WHERE n.activo = TRUE ${sinDescartadas} ${filtroNeg} GROUP BY etapa`, pNeg);
    // "Próximos" = cierre (hora de pared de Chile) aún no ha pasado. Se compara contra la
    // hora de Chile, NO contra NOW() (el servidor MySQL corre en otra zona, UTC-6).
    const proximosCierres = await q(
      `SELECT n.licitacion_codigo AS codigo, n.licitacion_nombre AS nombre, n.licitacion_organismo AS organismo,
              n.licitacion_cierre AS cierre, n.licitacion_monto AS monto
       FROM negocios n
       WHERE n.activo = TRUE AND n.licitacion_cierre IS NOT NULL AND n.licitacion_cierre >= ? ${sinDescartadas} ${filtroNeg}
       ORDER BY n.licitacion_cierre ASC LIMIT 6`, [ahoraChileSQL(), ...pNeg]);

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
