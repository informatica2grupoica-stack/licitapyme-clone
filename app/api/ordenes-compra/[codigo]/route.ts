// app/api/ordenes-compra/[codigo]/route.ts
// PATCH — vincula (o desvincula) manualmente UNA orden de compra a una licitación. Existe porque
// el cruce automático (por el NOMBRE de la orden, ver mencionaCodigo en app/lib/ordenes-compra.ts)
// no siempre encuentra la licitación de origen (tratos directos, nombres truncados, etc.) — desde
// la vista de gestión (/ordenes-compra) un admin puede corregirlo a mano.
import { NextRequest, NextResponse } from 'next/server';
import { vincularOrdenALicitacion } from '@/app/lib/ordenes-compra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') return NextResponse.json({ error: 'Solo administradores.' }, { status: 403 });

  const { codigo } = await params;
  const codigoOC = decodeURIComponent(codigo || '').trim();
  if (!codigoOC) return NextResponse.json({ error: 'Código de orden requerido' }, { status: 400 });

  try {
    const body = await request.json().catch(() => ({}));
    const licitacionCodigo = body?.licitacion_codigo ? String(body.licitacion_codigo).trim() : null;
    await vincularOrdenALicitacion(codigoOC, licitacionCodigo);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/ordenes-compra/[codigo]][PATCH]', String(error));
    return NextResponse.json({ error: 'No se pudo vincular la orden de compra.' }, { status: 500 });
  }
}
