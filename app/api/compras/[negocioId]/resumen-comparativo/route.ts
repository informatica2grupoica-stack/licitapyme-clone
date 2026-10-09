// app/api/compras/[negocioId]/resumen-comparativo/route.ts
// ¿Coinciden costeo, plan de compra de Licitank y lo comprado en Obuma? Solo lectura (de base).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { resumenComparativoCompra } from '@/app/lib/compras-resumen-comparativo';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    return NextResponse.json({ success: true, resumen: await resumenComparativoCompra(id) });
  } catch (error: any) {
    console.error('[compras/resumen-comparativo][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo armar el resumen comparativo.' }, { status: 500 });
  }
}
