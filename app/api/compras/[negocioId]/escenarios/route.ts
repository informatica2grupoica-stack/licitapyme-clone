// app/api/compras/[negocioId]/escenarios/route.ts
// Cuadro comparativo + espacio de negociación + los 4 escenarios de compra (spec §8.7-§8.10).
// GET calcula y devuelve todo (recalcula los escenarios cada vez: son baratos, aritmética pura).
// PATCH elige uno (§8.10.4 — justificación obligatoria si no es "Más rápido").
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { cuadroComparativo, detectarEspacioNegociacion, calcularEscenarios, elegirEscenario, escenarioElegidoTipo, enumerarCombinaciones, elegirCombinacion, combinacionElegidaClave, evaluarSeleccion, elegirSeleccion, seleccionDesdeClave, type TipoEscenario } from '@/app/lib/compras-auditor';
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

    const [cuadro, negociacion, escenarios, elegido, combinaciones, claveElegida] = await Promise.all([
      cuadroComparativo(id), detectarEspacioNegociacion(id), calcularEscenarios(id), escenarioElegidoTipo(id), enumerarCombinaciones(id), combinacionElegidaClave(id),
    ]);
    // La compra elegida hoy, armada de nuevo con los precios de ahora (para mostrarla y avisar si dejó de valer).
    const elegidaEv = claveElegida ? await evaluarSeleccion(id, seleccionDesdeClave(claveElegida)).catch(() => null) : null;
    return NextResponse.json({ success: true, cuadro, negociacion, escenarios, elegidoTipo: elegido?.tipo ?? null, elegidoCostoGuardado: elegido?.costoTotal ?? null, combinaciones, combinacionElegidaClave: claveElegida,
      elegida: elegidaEv?.combinacion ?? null });
  } catch (error) {
    console.error('[compras/escenarios][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron calcular los escenarios.' }, { status: 500 });
  }
}

/** Seleccion {productoId: cotizacionId} que viaja como JSON (las llaves llegan como texto). */
function leerSeleccion(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>)) { const p = Number(k), c = Number(v); if (Number.isInteger(p) && Number.isInteger(c)) out[p] = c; }
  return out;
}

// POST {seleccion} — arma la compra que se va eligiendo en la matriz y devuelve su costo, plazo, viajes y avisos (sin guardar nada).
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const body = await request.json();
    return NextResponse.json({ success: true, ...(await evaluarSeleccion(id, leerSeleccion(body.seleccion))) });
  } catch (error) {
    console.error('[compras/escenarios][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo armar la compra.' }, { status: 500 });
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
    if (body.tipo === 'SELECCION') await elegirSeleccion(id, leerSeleccion(body.seleccion), body.justificacion || null, userId, nombre);
    else if (body.tipo === 'COMBINACION') await elegirCombinacion(id, String(body.clave || ''), body.justificacion || null, userId, nombre);
    else await elegirEscenario(id, body.tipo as TipoEscenario, body.justificacion || null, userId, nombre);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/escenarios][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo elegir el escenario.' }, { status: 400 });
  }
}
