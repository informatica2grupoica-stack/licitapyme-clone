// app/api/compras/oc-canceladas/route.ts
// Fundamento obligatorio cuando el organismo cancela la OC del cliente (migration-187, 10-nov-2026).
// GET  = cancelaciones sin fundamento que le tocan a alguien de Compras (las pide el modal de AppLayout).
// POST = { id, fundamento } guarda el fundamento. Solo gente de Compras (se revisa en el servidor).
import { NextRequest, NextResponse } from 'next/server';
import { clienteIdOrNull } from '@/app/lib/api-auth';
import { mensajeSeguro } from '@/app/lib/errores-api';
import { cancelacionesPendientesDe, fundamentarCancelacion } from '@/app/lib/compras-oc-cancelada';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const usuarioDe = (req: NextRequest) => {
  const id = parseInt(req.headers.get('x-user-id') || '');
  return { id: Number.isFinite(id) ? id : null, nombre: req.headers.get('x-user-nombre') };
};

export async function GET(request: NextRequest) {
  const { id } = usuarioDe(request);
  const clienteId = id ? await clienteIdOrNull(request) : null;
  if (!id || !clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, pendientes: await cancelacionesPendientesDe(id, clienteId) });
  } catch (e) {
    console.error('[compras/oc-canceladas][GET]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudieron leer las cancelaciones.') }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { id, nombre } = usuarioDe(request);
  const clienteId = id ? await clienteIdOrNull(request) : null;
  if (!id || !clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const cancelacionId = parseInt(body?.id);
  if (!Number.isFinite(cancelacionId)) return NextResponse.json({ error: 'Falta la cancelación.' }, { status: 400 });
  try {
    await fundamentarCancelacion(cancelacionId, id, nombre || null, clienteId, String(body?.fundamento ?? ''));
    return NextResponse.json({ success: true, pendientes: await cancelacionesPendientesDe(id, clienteId) });
  } catch (e: any) {
    // Los errores de validación de fundamentarCancelacion son mensajes para la persona.
    const msg = e instanceof Error && !(e as any).code ? e.message : mensajeSeguro(e, 'No se pudo guardar el fundamento.');
    return NextResponse.json({ error: msg }, { status: (e as any)?.code ? 500 : 400 });
  }
}
