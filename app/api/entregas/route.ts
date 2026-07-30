// app/api/entregas/route.ts
// MÓDULO DE ENTREGA DE PROYECTOS (Frente F.1) — Fase 1.
//
// GET  → las entregas que le conciernen al usuario. `?pendientes=1` devuelve solo las que él
//        todavía no acusa (es lo que consultará la alerta bloqueante de la Fase 3).
// POST → acusar recibo de una entrega: { negocioId }.
//
// Acceso: el circuito lo definen el responsable del negocio, los admin y quienes tengan el
// permiso `entrega_proyectos` (ver involucradosEnEntrega). Acá NO se re-decide quién entra:
// se responde con lo que la tabla `entrega_acuse` dice que le toca a este usuario, así el
// permiso vive en un solo lugar.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { acusarRecibo, entregasPendientesDe } from '@/app/lib/entrega-proyecto';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const soloPendientes = request.nextUrl.searchParams.get('pendientes') === '1';
  const soloResumen    = request.nextUrl.searchParams.get('resumen') === '1';

  // ?resumen=1 → solo contadores. Lo usa el sidebar (badge) y el modal: es una consulta con
  // índice sobre entrega_acuse, sin traer el JSON del resumen de cada entrega.
  if (soloResumen) {
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS total, SUM(acusado_at IS NULL) AS pendientes
           FROM entrega_acuse WHERE usuario_id = ?`,
        [u.id],
      ) as any;
      const r = (rows as any[])[0] || {};
      return NextResponse.json({ success: true, total: Number(r.total || 0), pendientes: Number(r.pendientes || 0) });
    } catch {
      return NextResponse.json({ success: true, total: 0, pendientes: 0, migracionPendiente: true });
    }
  }

  if (soloPendientes) {
    return NextResponse.json({ success: true, entregas: await entregasPendientesDe(u.id) });
  }

  try {
    // Todas las entregas donde este usuario está en el circuito, con el estado de acuse del
    // grupo completo (cuántos faltan) para el tablero de seguimiento.
    const [rows] = await pool.query(
      `SELECT e.negocio_id, e.licitacion_codigo, e.abierta_at, e.completada_at, e.resumen,
              n.licitacion_nombre, n.licitacion_organismo,
              mio.acusado_at AS mi_acuse,
              (SELECT COUNT(*) FROM entrega_acuse t WHERE t.negocio_id = e.negocio_id) AS total_acuses,
              (SELECT COUNT(*) FROM entrega_acuse t WHERE t.negocio_id = e.negocio_id AND t.acusado_at IS NOT NULL) AS acusados
         FROM entrega_proyecto e
         JOIN negocios n ON n.id = e.negocio_id
         JOIN entrega_acuse mio ON mio.negocio_id = e.negocio_id AND mio.usuario_id = ?
        ORDER BY e.abierta_at DESC`,
      [u.id],
    ) as any;

    const entregas = (rows as any[]).map(r => ({
      negocioId: r.negocio_id,
      licitacionCodigo: r.licitacion_codigo,
      licitacionNombre: r.licitacion_nombre,
      organismo: r.licitacion_organismo,
      abiertaAt: r.abierta_at,
      completadaAt: r.completada_at,
      miAcuse: r.mi_acuse,
      acusados: Number(r.acusados),
      totalAcuses: Number(r.total_acuses),
      resumen: typeof r.resumen === 'string' ? JSON.parse(r.resumen) : r.resumen,
    }));

    return NextResponse.json({ success: true, entregas });
  } catch (e: any) {
    // Migración 58 pendiente → lista vacía PERO diciéndolo (no un "no hay nada" silencioso).
    console.error('[entregas][GET]', String(e).slice(0, 200));
    return NextResponse.json({ success: true, entregas: [], migracionPendiente: true });
  }
}

export async function POST(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { negocioId } = await request.json().catch(() => ({} as any));
  if (!negocioId) return NextResponse.json({ error: 'negocioId requerido' }, { status: 400 });

  // Solo se puede acusar recibo de algo que a UNO le toca: el UPDATE filtra por usuario_id, así
  // que nadie puede acusar por otro. Si la fila no existe, no pasa nada (ok:true, sin cambios).
  const r = await acusarRecibo(Number(negocioId), u.id);
  if (!r.ok) return NextResponse.json({ error: 'No se pudo registrar el acuse de recibo' }, { status: 500 });

  // Identificar la licitación para que la bitácora se lea: "negocio 325" no le dice nada a nadie.
  let lic: { codigo: string | null; nombre: string | null } = { codigo: null, nombre: null };
  try {
    const [rows] = await pool.query(
      `SELECT licitacion_codigo, licitacion_nombre FROM negocios WHERE id = ? LIMIT 1`, [negocioId],
    ) as any;
    const f = (rows as any[])[0];
    if (f) lic = { codigo: f.licitacion_codigo, nombre: f.licitacion_nombre };
  } catch { /* la bitácora no debe romper el acuse */ }

  // usuarioId: null A PROPÓSITO. `usuarioId` es el DESTINATARIO de la campana, y avisarle a
  // alguien lo que acaba de hacer él mismo es ruido puro (detectado probando: al acusar recibo
  // te llegaba tu propia notificación). Queda registrado en el historial para auditoría —quién
  // recibió qué y cuándo— pero sin repicar ninguna campana.
  await registrarEvento({
    tipo: 'ENTREGA_ACUSE',
    licitacionCodigo: lic.codigo, licitacionNombre: lic.nombre,
    usuarioId: null, usuarioNombre: null,
    actorId: u.id, actorNombre: u.nombre ?? null,
    mensaje: `${u.nombre || 'Un usuario'} acusó recibo del proyecto ${lic.nombre || lic.codigo || `#${negocioId}`}`,
    metadata: { negocio_id: Number(negocioId), licitacion_codigo: lic.codigo, completada: r.completada },
  });
  publicarCambio('negocio');

  return NextResponse.json({ success: true, completada: r.completada });
}
