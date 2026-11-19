// app/api/compras/[negocioId]/emparejar/route.ts
// «Emparejar a mano»: una persona asigna una línea de una cotización al precio de un producto (agrega o cambia solo ese producto en esa cotización).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { emparejarAMano } from '@/app/lib/compras-pareo-global';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function __POST(request: NextRequest, { params }: Params) {
  const id = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  const userId = id ? parseInt(id) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const negId = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const b = await request.json().catch(() => ({}));
    const cotizacionId = Number(b?.cotizacionId), productoId = Number(b?.productoId), precio = Number(b?.precio);
    if (!Number.isFinite(cotizacionId) || !Number.isFinite(productoId)) return NextResponse.json({ error: 'Falta la cotización o el producto.' }, { status: 400 });
    await emparejarAMano(negId, {
      cotizacionId, productoId, precio, linea: String(b?.linea || ''),
      cumple: b?.cumple === 'INFERIOR_NEGOCIABLE' ? 'INFERIOR_NEGOCIABLE' : 'CUMPLE', aviso: b?.aviso ? String(b.aviso) : null,
    }, { id: userId, nombre: request.headers.get('x-user-nombre') });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/emparejar][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo emparejar.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
