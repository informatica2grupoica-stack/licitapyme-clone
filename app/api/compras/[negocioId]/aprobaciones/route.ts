// app/api/compras/[negocioId]/aprobaciones/route.ts
// Compuertas de aprobación (spec §10): Compuerta 1 (compra) y Compuerta 2 (margen), separadas e
// independientes. GET lee el estado de ambas + el margen calculado en vivo. POST propone una
// (encargado). PATCH resuelve una (solo jefe de ventas — §10.2/§10.3: "la aprueba el jefe de ventas").
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import {
  obtenerAprobaciones, calcularMargenPrevisto, calcularPresupuestoCompra, obtenerEscenarioElegido,
  proponerAprobacionCompra, proponerAprobacionMargen,
  resolverAprobacion, type TipoAprobacion, type DecisionAprobacion,
} from '@/app/lib/compras-aprobaciones';
import { puedeOperarCompras, puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

// "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026 — ver el comentario largo en
// app/api/compras/[negocioId]/route.ts): se lee con `permisosCrudosDeUsuario` para que
// `aprobar_comercial` no se auto-otorgue por ser admin. `compras_todo` también resuelve compuertas.
async function esJefeDeVentas(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.aprobar_comercial);
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    // GET amplio: RepartoAdminCard (administración) necesita saber si la Compuerta 1 ya se aprobó
    // para decidir si se muestra — proponer/resolver una compuerta sigue siendo del encargado.
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [aprobaciones, margen, presupuesto, escenarioElegido] = await Promise.all([
      obtenerAprobaciones(id), calcularMargenPrevisto(id), calcularPresupuestoCompra(id), obtenerEscenarioElegido(id),
    ]);
    // Pedido explícito del usuario (11-sep-2026): la Compuerta 1 "Pendiente" mostraba el snapshot
    // CONGELADO al proponerse (spec §10.2), que puede haber quedado viejo si después se eligió otro
    // escenario (§10.5 invalida el estado, pero nunca reescribe ese snapshot). Se manda el escenario
    // elegido EN VIVO aparte para que la pantalla pueda avisar "esto está desactualizado" en vez de
    // mostrar el número viejo como si fuera el vigente.
    return NextResponse.json({
      success: true, ...aprobaciones, margenActual: margen, presupuestoActual: presupuesto,
      escenarioElegidoActual: escenarioElegido ? { tipo: escenarioElegido.tipo, costoTotal: Number(escenarioElegido.costo_total) } : null,
      esJefeDeVentas: await esJefeDeVentas(userId),
    });
  } catch (error) {
    console.error('[compras/aprobaciones][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar las aprobaciones.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
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
    const tipo = body.tipo as TipoAprobacion;
    if (tipo === 'COMPRA') await proponerAprobacionCompra(id, userId, nombre, body.motivo || null);
    else if (tipo === 'MARGEN') await proponerAprobacionMargen(id, body.motivo || null, userId, nombre);
    else return NextResponse.json({ error: 'Tipo de compuerta inválido.' }, { status: 400 });

    const aprobaciones = await obtenerAprobaciones(id);
    return NextResponse.json({ success: true, ...aprobaciones });
  } catch (error: any) {
    console.error('[compras/aprobaciones][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo proponer la aprobación.' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    if (!(await esJefeDeVentas(userId)))
      return NextResponse.json({ error: 'Solo el jefe de ventas resuelve las compuertas de aprobación (spec §10.2/§10.3).' }, { status: 403 });

    const body = await request.json();
    await resolverAprobacion(id, body.tipo as TipoAprobacion, body.decision as DecisionAprobacion, body.comentario || null, userId, nombre);

    const aprobaciones = await obtenerAprobaciones(id);
    return NextResponse.json({ success: true, ...aprobaciones });
  } catch (error: any) {
    console.error('[compras/aprobaciones][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo resolver la compuerta.' }, { status: 400 });
  }
}
