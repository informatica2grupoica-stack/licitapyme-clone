// app/api/compras/[negocioId]/agente-documentos/negocio/route.ts
// Auditoría de punta a punta de UN negocio (las 5 pestañas de Compras) contra los documentos del
// proyecto — pedido explícito del usuario (15-sep-2026): "tiene que leer todos estos documentos
// la IA para poder ver todo el área de compras desde tareas a entrega y cierre".
// Ver auditarNegocioCompleto en app/lib/compras-agente-documentos.ts.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { auditarNegocioCompleto, agenteDocumentosDisponible, ultimaAuditoriaNegocio } from '@/app/lib/compras-agente-documentos';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Última auditoría guardada (pedido explícito, 15-sep-2026) — se carga sola al abrir la pantalla,
// SIN gastar una revisión nueva de Gemini. El botón sigue sirviendo para pedir una fresca.
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

    const ultima = await ultimaAuditoriaNegocio(id);
    return NextResponse.json({ success: true, ultima });
  } catch (error: any) {
    console.error('[compras/agente-documentos/negocio][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar la última auditoría.' }, { status: 500 });
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

    const resultado = await auditarNegocioCompleto(id);
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/agente-documentos/negocio][POST]', String(error));
    const tope = String(error?.message || '').includes('tope de revisiones');
    return NextResponse.json({ error: error.message || 'El agente no pudo auditar el negocio.' }, { status: tope ? 429 : 500 });
  }
}
