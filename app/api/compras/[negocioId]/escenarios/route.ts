// app/api/compras/[negocioId]/escenarios/route.ts
// Cuadro comparativo + espacio de negociación + los 4 escenarios de compra (spec §8.7-§8.10).
// GET calcula y devuelve todo (recalcula los escenarios cada vez: son baratos, aritmética pura).
// PATCH elige uno (§8.10.4 — justificación obligatoria si no es "Más rápido").
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { cuadroComparativo, detectarEspacioNegociacion, calcularEscenarios, elegirEscenario, escenarioElegidoTipo, type TipoEscenario } from '@/app/lib/compras-auditor';
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

    const [cuadro, negociacion, escenarios, elegidoTipo] = await Promise.all([
      cuadroComparativo(id), detectarEspacioNegociacion(id), calcularEscenarios(id), escenarioElegidoTipo(id),
    ]);
    return NextResponse.json({ success: true, cuadro, negociacion, escenarios, elegidoTipo });
  } catch (error) {
    console.error('[compras/escenarios][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron calcular los escenarios.' }, { status: 500 });
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
    await elegirEscenario(id, body.tipo as TipoEscenario, body.justificacion || null, userId, nombre);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/escenarios][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo elegir el escenario.' }, { status: 400 });
  }
}
