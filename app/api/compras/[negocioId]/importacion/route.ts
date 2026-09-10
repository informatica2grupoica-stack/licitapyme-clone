// app/api/compras/[negocioId]/importacion/route.ts
// Ruta de importación y costeo aterrizado (spec §12). GET trae origen + embarque + costo aterrizado
// calculado. PATCH aplica una acción: 'origen' | 'embarque'.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import {
  obtenerOrigenCompra, definirOrigenCompra, obtenerEmbarque, registrarEmbarque, calcularCostoAterrizado,
  type OrigenCompra,
} from '@/app/lib/compras-importacion';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [origen, embarque, costoAterrizado] = await Promise.all([
      obtenerOrigenCompra(id), obtenerEmbarque(id), calcularCostoAterrizado(id),
    ]);
    return NextResponse.json({ success: true, origen, embarque, costoAterrizado });
  } catch (error) {
    console.error('[compras/importacion][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la importación.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    if (body.accion === 'origen') {
      await definirOrigenCompra(id, body.origen as OrigenCompra, userId, nombre);
    } else if (body.accion === 'embarque') {
      await registrarEmbarque(id, {
        fleteInternacional: body.fleteInternacional === '' || body.fleteInternacional == null ? null : Number(body.fleteInternacional),
        costosAduana: body.costosAduana === '' || body.costosAduana == null ? null : Number(body.costosAduana),
        costoLogisticoLocal: body.costoLogisticoLocal === '' || body.costoLogisticoLocal == null ? null : Number(body.costoLogisticoLocal),
        moneda: body.moneda || 'CLP', notas: body.notas || null,
      }, userId, nombre);
    } else {
      return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
    }

    const [origen, embarque, costoAterrizado] = await Promise.all([
      obtenerOrigenCompra(id), obtenerEmbarque(id), calcularCostoAterrizado(id),
    ]);
    return NextResponse.json({ success: true, origen, embarque, costoAterrizado });
  } catch (error: any) {
    console.error('[compras/importacion][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar.' }, { status: 400 });
  }
}
