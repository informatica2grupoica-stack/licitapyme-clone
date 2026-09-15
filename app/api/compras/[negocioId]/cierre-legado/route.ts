// app/api/compras/[negocioId]/cierre-legado/route.ts
// MÓDULO DE COMPRAS — marca rápida de "entregada" / "no realizada" para el backlog histórico
// (migration-107, 11-sep-2026). Deliberadamente aparte de /entrega y /fracaso: esos son el flujo
// EN VIVO (verificación, acta, firma / dictamen del jefe de ventas), este es solo housekeeping
// para negocios ADJUDICADA cerrados antes de que existiera Compras. Mismo criterio de permiso que
// /asignar: es una decisión de jefatura, no del encargado de cada negocio en particular.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { marcarCierreLegado, quitarCierreLegado, obtenerAsignacion, type CierreLegado } from '@/app/lib/compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

async function esJefeDeVentas(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.aprobar_comercial);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esJefeDeVentas(userId))) {
    return NextResponse.json({ error: 'Solo el jefe de ventas puede cerrar backlog histórico.' }, { status: 403 });
  }
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const estado = body.estado as CierreLegado;
  if (estado !== 'ENTREGADA' && estado !== 'NO_REALIZADA') {
    return NextResponse.json({ error: 'estado debe ser ENTREGADA o NO_REALIZADA' }, { status: 400 });
  }

  try {
    const existe = await obtenerAsignacion(id);
    if (!existe) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras.' }, { status: 404 });

    await marcarCierreLegado(id, estado, body.nota || null, userId, nombre);
    const actualizado = await obtenerAsignacion(id);
    return NextResponse.json({ success: true, asignacion: actualizado });
  } catch (error: any) {
    console.error('[compras/[negocioId]/cierre-legado][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo marcar.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esJefeDeVentas(userId))) {
    return NextResponse.json({ error: 'Solo el jefe de ventas puede deshacer esta marca.' }, { status: 403 });
  }
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    await quitarCierreLegado(id);
    const actualizado = await obtenerAsignacion(id);
    return NextResponse.json({ success: true, asignacion: actualizado });
  } catch (error: any) {
    console.error('[compras/[negocioId]/cierre-legado][DELETE]', String(error));
    return NextResponse.json({ error: 'No se pudo deshacer.' }, { status: 500 });
  }
}
