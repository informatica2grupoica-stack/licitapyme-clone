// app/api/compras/[negocioId]/orden-compra-obuma/proveedor/route.ts
// Verificar/crear el proveedor en Obuma ANTES de emitir la orden de compra — pedido explícito del
// usuario: nunca automático. GET verifica por RUT (solo lectura). POST crea de verdad (escritura
// real, gatillada solo por el clic explícito de la persona en el modal).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { verificarProveedorEnObuma, crearProveedorEnObumaExplicito } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function autorizar(request: NextRequest, negId: number) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const asignacion = await obtenerAsignacion(negId);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { userId, rol };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  const auth = await autorizar(request, id);
  if ('error' in auth) return auth.error;

  const rut = request.nextUrl.searchParams.get('rut')?.trim();
  if (!rut) return NextResponse.json({ error: 'Falta el RUT.' }, { status: 400 });

  try {
    const ficha = await verificarProveedorEnObuma(rut);
    return NextResponse.json({ success: true, existe: !!ficha, ficha });
  } catch (error: any) {
    console.error('[orden-compra-obuma/proveedor][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo verificar el proveedor.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  const auth = await autorizar(request, id);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const rut = String(body.rut || '').trim();
    const razonSocial = String(body.razonSocial || '').trim();
    if (!rut) return NextResponse.json({ error: 'Falta el RUT.' }, { status: 400 });
    if (!razonSocial) return NextResponse.json({ error: 'Falta la razón social.' }, { status: 400 });

    const resultado = await crearProveedorEnObumaExplicito({
      rut, razonSocial, nombreFantasia: body.nombreFantasia || null,
      contacto: body.contacto || null, giro: body.giro || null,
      esSupermercado: !!body.esSupermercado, esFactoring: !!body.esFactoring,
      direccion: body.direccion || null, comuna: body.comuna || null, region: body.region || null,
      pais: body.pais || null, telefono: body.telefono || null, celular: body.celular || null,
      email: body.email || null, website: body.website || null, observacion: body.observacion || null,
      cuentaContable: body.cuentaContable || null,
    });
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[orden-compra-obuma/proveedor][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear el proveedor.' }, { status: 400 });
  }
}
