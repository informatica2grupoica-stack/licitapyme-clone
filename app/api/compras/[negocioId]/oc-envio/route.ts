// app/api/compras/[negocioId]/oc-envio/route.ts
// «Enviar al proveedor»: la OC (de Obuma por ?folio=, o propia de Comercial MP por ?ocPropia=) por correo con el PDF adjunto.
// GET = borrador (para, cc, asunto, mensaje) + envíos anteriores. POST JSON {folio | ocPropiaId, para, cc, asunto, mensaje} = enviar.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import { borradorEnvioOc, enviarOc, type FuenteOc } from '@/app/lib/compras-oc-envio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'No tienes permiso para enviar órdenes de compra de este negocio.' }, { status: 403 }) };
  return { id, actor: { id: userId, nombre: request.headers.get('x-user-nombre'), email: request.headers.get('x-user-email') } };
}

function fuente(folio: unknown, ocPropia: unknown): FuenteOc | null {
  const id = parseInt(String(ocPropia ?? ''));
  if (id > 0) return { ocPropiaId: id };
  const f = String(folio ?? '').trim();
  return f ? { folio: f } : null;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const sp = request.nextUrl.searchParams;
    const f = fuente(sp.get('folio'), sp.get('ocPropia'));
    if (!f) return NextResponse.json({ error: 'Falta la orden de compra.' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await borradorEnvioOc(a.id, f, { nombre: a.actor.nombre, email: a.actor.email })) });
  } catch (error: any) {
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo preparar el correo.') }, { status: 400 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const body = await request.json();
    const f = fuente(body.folio, body.ocPropiaId);
    if (!f) return NextResponse.json({ error: 'Falta la orden de compra.' }, { status: 400 });
    const envios = await enviarOc(a.id, f, { para: body.para, cc: body.cc, asunto: body.asunto, mensaje: body.mensaje }, a.actor);
    return NextResponse.json({ success: true, envios });
  } catch (error: any) {
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo enviar la orden de compra.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
