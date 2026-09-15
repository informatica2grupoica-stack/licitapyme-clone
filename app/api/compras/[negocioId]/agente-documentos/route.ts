// app/api/compras/[negocioId]/agente-documentos/route.ts
// Agente que lee los documentos del proyecto (bases, anexos propios, acta) y audita/guía el
// borrador de una cotización antes de guardarla — pedido explícito del usuario (14-sep-2026).
// Ver app/lib/compras-agente-documentos.ts.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { auditarBorradorConAgente, agenteDocumentosDisponible, usoDiarioAgente, type BorradorCotizacion } from '@/app/lib/compras-agente-documentos';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Contador visible (pedido explícito, 14-sep-2026) — barato, sin llamar a Gemini: solo lee cuántas
// revisiones se hicieron hoy, para que la UI muestre "12/25 hoy" antes de que alguien apriete el
// botón y gaste una de verdad.
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

    const usoHoy = await usoDiarioAgente();
    return NextResponse.json({ success: true, disponible: agenteDocumentosDisponible(), usoHoy });
  } catch (error: any) {
    console.error('[compras/agente-documentos][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar el uso del agente.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  if (!agenteDocumentosDisponible())
    return NextResponse.json({ error: 'El agente de documentos no está configurado (falta GEMINI_API_KEY).' }, { status: 503 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const borrador: BorradorCotizacion = {
      productoDescripcion: body.productoDescripcion ?? null,
      descripcionLibre: body.descripcionLibre ?? null,
      cantidad: body.cantidad != null ? Number(body.cantidad) : null,
      proveedorNombre: String(body.proveedorNombre || ''),
      precioUnitario: body.precioUnitario != null ? Number(body.precioUnitario) : null,
      descuentoPct: body.descuentoPct != null ? Number(body.descuentoPct) : null,
      incluyeFlete: body.incluyeFlete == null ? null : !!body.incluyeFlete,
      fleteMonto: body.fleteMonto != null ? Number(body.fleteMonto) : null,
      plazoEntregaTexto: body.plazoEntregaTexto ?? null,
    };

    const resultado = await auditarBorradorConAgente(id, borrador);
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/agente-documentos][POST]', String(error));
    const tope = String(error?.message || '').includes('tope de revisiones');
    return NextResponse.json({ error: error.message || 'El agente no pudo revisar el borrador.' }, { status: tope ? 429 : 500 });
  }
}
