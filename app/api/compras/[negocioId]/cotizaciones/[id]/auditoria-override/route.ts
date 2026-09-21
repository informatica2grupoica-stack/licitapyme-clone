// app/api/compras/[negocioId]/cotizaciones/[id]/auditoria-override/route.ts
// Una persona decide distinto al auditor: motivo obligatorio, queda a su nombre en el historial.
// Body: { productoId, cumple: CumpleItem | null, motivo } — cumple null = volver al dictamen del auditor.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { registrarOverrideAuditoria, type CumpleAuditado } from '@/app/lib/compras-auditoria-cotizacion';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

const VALIDOS: CumpleAuditado[] = ['CUMPLE', 'MEJORA', 'INFERIOR_NEGOCIABLE', 'INFERIOR_INSALVABLE', 'NO_ES_EL_PRODUCTO'];

export async function POST(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const productoId = Number(body?.productoId);
    if (!Number.isFinite(productoId)) return NextResponse.json({ error: 'Falta el producto.' }, { status: 400 });
    const cumple = body?.cumple == null ? null : String(body.cumple) as CumpleAuditado;
    if (cumple != null && !VALIDOS.includes(cumple)) return NextResponse.json({ error: 'Veredicto no válido.' }, { status: 400 });

    await registrarOverrideAuditoria(negId, parseInt(id), productoId, cumple, String(body?.motivo || ''), { id: userId, nombre });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/cotizaciones/auditoria-override][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar la decisión.' }, { status: 400 });
  }
}
