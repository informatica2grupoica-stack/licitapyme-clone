// Bandeja del EM en el AUDITOR (26-oct-2026): opciones en aprobación y requisitos complementados de todos los negocios, con acciones en lote.
// Lógica: app/lib/auditor-bandeja-em.ts. Solo EM: admin, `aprobar_comercial` o `auditor_aprobar` (el mismo criterio de contextoAuditor).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { publicarCambio } from '@/app/lib/sse-bus';
import { construirBandejaEM, resolverOpcionesEnLote, aceptarRequisitosEnLote } from '@/app/lib/auditor-bandeja-em';

async function contextoEM(request: NextRequest): Promise<{ id: number; nombre: string } | NextResponse> {
  const idH = request.headers.get('x-user-id'), rol = request.headers.get('x-user-rol');
  const userId = idH ? parseInt(idH) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') {
    const p = await permisosCrudosDeUsuario(userId);
    if (!(p.aprobar_comercial || p.auditor_aprobar)) return NextResponse.json({ error: 'La bandeja del Auditor es del Encargado de Mercado Público (EM).' }, { status: 403 });
  }
  let nombre = request.headers.get('x-user-nombre');
  if (!nombre) {
    const [rows] = await pool.query('SELECT nombre FROM usuarios WHERE id = ? LIMIT 1', [userId]) as any;
    nombre = (rows as any[])[0]?.nombre || 'Usuario';
  }
  return { id: userId, nombre: nombre as string };
}

export async function GET(request: NextRequest) {
  const actor = await contextoEM(request);
  if (actor instanceof NextResponse) return actor;
  try {
    return NextResponse.json({ success: true, negocios: await construirBandejaEM() });
  } catch (e) {
    console.error('[aprobaciones/auditor][GET]', String(e));
    return NextResponse.json({ error: 'No se pudo armar la bandeja del Auditor' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const actor = await contextoEM(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => ({}));
  const accion = String(body.accion || '');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ error: 'No elegiste nada.' }, { status: 400 });
  if (items.length > 200) return NextResponse.json({ error: 'Demasiados a la vez (máximo 200).' }, { status: 400 });
  try {
    let r;
    if (accion === 'aprobar' || accion === 'rechazar') {
      const comentario = body.comentario ? String(body.comentario).trim() : null;
      if (accion === 'rechazar' && !comentario) return NextResponse.json({ error: 'El rechazo requiere un comentario.' }, { status: 400 });
      r = await resolverOpcionesEnLote(items.map((i: any) => ({ negocioId: Number(i.negocioId), opcionId: Number(i.opcionId) })), accion, comentario, actor);
    } else if (accion === 'aceptar_requisitos') {
      r = await aceptarRequisitosEnLote(items.map((i: any) => ({ negocioId: Number(i.negocioId), opcionId: Number(i.opcionId), n: Number(i.n) })), String(body.motivo || ''), actor);
    } else return NextResponse.json({ error: `Acción desconocida: ${accion}` }, { status: 400 });
    publicarCambio('checklist_comercial');
    return NextResponse.json({ success: true, ...r, negocios: await construirBandejaEM() });
  } catch (e) {
    console.error('[aprobaciones/auditor][POST]', String(e));
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
