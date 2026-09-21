// app/api/compras/[negocioId]/cotizaciones/[id]/auditar/route.ts
// Corre el AUDITOR de cotizaciones (compras-auditoria-cotizacion.ts) sobre una cotización: dictamen
// formal por producto asignado, con requisito, lo cotizado y la evidencia de cada punto.
// Body opcional: { productoId } para auditar solo ese producto.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { auditarCotizacion } from '@/app/lib/compras-auditoria-cotizacion';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // una cotización con varios productos = varias llamadas a la IA

type Params = { params: Promise<{ negocioId: string; id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol'), nombre: req.headers.get('x-user-nombre') };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const productoId = body?.productoId != null ? Number(body.productoId) : undefined;
    const resultados = await auditarCotizacion(negId, parseInt(id), { productoId, actor: { id: userId, nombre } });
    if (resultados.length === 0)
      return NextResponse.json({ error: 'Esta cotización no está asignada a ningún producto: asígnala primero ("Asignar productos").' }, { status: 400 });
    return NextResponse.json({ success: true, resultados });
  } catch (error: any) {
    console.error('[compras/cotizaciones/auditar][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo auditar la cotización.' }, { status: 500 });
  }
}
