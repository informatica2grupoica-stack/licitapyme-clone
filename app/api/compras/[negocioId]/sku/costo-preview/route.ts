// app/api/compras/[negocioId]/sku/costo-preview/route.ts
// Pedido explícito del usuario (10-sep-2026): "debo de verificarlo antes que lo mandes por si tiene
// modificaciones... la idea es que me muestres que es lo que esta mandando a obuma". Este endpoint
// devuelve EXACTAMENTE el mismo costo que usaría crearSku (misma función,
// costoEscenarioParaProducto en compras-aprobaciones.ts) para que la UI lo muestre antes de crear,
// y compras-aprobaciones.ts vuelve a comprobarlo al momento de crear — si el escenario cambió
// entremedio, rechaza en vez de mandar un número viejo.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { costoEscenarioParaProducto } from '@/app/lib/compras-aprobaciones';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  const productoId = Number(request.nextUrl.searchParams.get('productoId'));
  if (!Number.isFinite(productoId)) return NextResponse.json({ error: 'Falta productoId' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const costo = await costoEscenarioParaProducto(id, productoId);
    if (!costo) return NextResponse.json({ success: true, costo: null });
    return NextResponse.json({ success: true, costo: costo.costoUnitario, escenarioTipo: costo.escenarioTipo });
  } catch (error: any) {
    console.error('[compras/sku/costo-preview][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar el costo.' }, { status: 500 });
  }
}
