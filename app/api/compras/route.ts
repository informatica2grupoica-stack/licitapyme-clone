// app/api/compras/route.ts
// MÓDULO COMPRAS (Auditor Técnico, Fase 7, spec §12.2/12.3) — lista los negocios ya congelados
// (postulados) con su paquete de traspaso completo. Es deliberadamente de SOLO LECTURA: el
// paquete ya quedó fijo al congelar (app/lib/congelamiento.ts); este endpoint solo lo expone.
// Vista transversal (admin), igual patrón que /api/aprobaciones.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') return NextResponse.json({ error: 'Solo administradores.' }, { status: 403 });

  try {
    const [rows] = await pool.query(
      `SELECT c.negocio_id, c.congelado_at, c.congelado_por_nombre, c.paquete_traspaso,
              n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo, n.asignado_a,
              u.nombre AS asignado_nombre
         FROM checklist_comercial_congelamiento c
         JOIN negocios n ON n.id = c.negocio_id
         LEFT JOIN usuarios u ON u.id = n.asignado_a
        ORDER BY c.congelado_at DESC`,
    ) as any;

    const paquetes = (rows as any[]).map(r => ({
      negocioId: r.negocio_id,
      licitacionCodigo: r.licitacion_codigo,
      licitacionNombre: r.licitacion_nombre,
      licitacionOrganismo: r.licitacion_organismo,
      asignadoNombre: r.asignado_nombre,
      congeladoAt: r.congelado_at,
      congeladoPorNombre: r.congelado_por_nombre,
      paquete: typeof r.paquete_traspaso === 'string' ? JSON.parse(r.paquete_traspaso) : r.paquete_traspaso,
    }));

    return NextResponse.json({ success: true, paquetes });
  } catch (error) {
    console.error('[compras][GET]', String(error));
    // Migración 55 pendiente → lista vacía, no 500 opaco.
    return NextResponse.json({ success: true, paquetes: [], migracionPendiente: true });
  }
}
