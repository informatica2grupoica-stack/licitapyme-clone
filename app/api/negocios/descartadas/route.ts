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
    // ── Descartes hechos desde el RADAR (tabla licitaciones_descartadas) ──────────
    // Antes esta página solo mostraba los descartes de Negocios; lo descartado desde el
    // radar no se veía en NINGUNA parte fuera del corte "Descartadas" del propio radar.
    // Sin JOIN a alertas_licitaciones (collations distintas): se resuelve en dos pasos.
    let radar: any[] = [];
    try {
      const [rdRows] = await pool.query(
        `SELECT ld.licitacion_codigo, ld.motivo, ld.created_at,
                u.nombre AS descartada_por_nombre, u.email AS descartada_por_email
           FROM licitaciones_descartadas ld
      LEFT JOIN usuarios u ON u.id = ld.descartada_por
          ORDER BY ld.created_at DESC`);
      radar = rdRows as any[];
      const codigos = radar.map(r => r.licitacion_codigo);
      if (codigos.length) {
        // Datos de la licitación desde la alerta más reciente de cada código.
        const [aRows] = await pool.query(
          `SELECT a.licitacion_codigo, a.licitacion_nombre, a.licitacion_organismo,
                  a.licitacion_monto, a.licitacion_cierre, a.licitacion_tipo
             FROM alertas_licitaciones a
             JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones
                    WHERE licitacion_codigo IN (?) GROUP BY licitacion_codigo) latest ON latest.mid = a.id`,
          [codigos]);
        const porCodigo = new Map((aRows as any[]).map(r => [r.licitacion_codigo, r]));
        for (const r of radar) {
          const a = porCodigo.get(r.licitacion_codigo);
          r.licitacion_nombre    = a?.licitacion_nombre ?? null;
          r.licitacion_organismo = a?.licitacion_organismo ?? null;
          r.licitacion_monto     = a?.licitacion_monto ?? null;
          r.licitacion_cierre    = a?.licitacion_cierre ?? null;
          r.licitacion_tipo      = a?.licitacion_tipo ?? null;
        }
      }
    } catch { /* tabla ausente (nadie ha descartado desde el radar) → sección vacía */ }

    return NextResponse.json({
      success: true,
      descartadas: (rows as any)[0],
      radar,
      usuarios: (usuariosRes as any)[0],
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
