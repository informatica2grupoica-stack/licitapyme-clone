// app/api/compras/[negocioId]/cotizaciones/[id]/homologar/route.ts
// Dispara el Auditor de Compras (IA) sobre una cotización: homologa por significado contra los
// productos ganados y dictamina cumplimiento técnico (spec §8.6-§8.8).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { homologarCotizacionIA } from '@/app/lib/compras-auditor';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id: cotizacionId } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const resultado = await homologarCotizacionIA(parseInt(cotizacionId));
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/cotizaciones/homologar][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo homologar la cotización.' }, { status: 500 });
  }
}
