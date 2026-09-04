// app/api/compras/[negocioId]/orden-compra/route.ts
// MÓDULO DE COMPRAS §3.6 — registra la ORDEN DE COMPRA DEL CLIENTE (la que el organismo emite a
// nuestro favor en Mercado Público) y su fecha de aceptación. No confundir con las OC que nosotros
// emitimos a proveedores: esas las emite OBUMA (§11.1) y el módulo solo controla su estado.
//
// Anotar la fecha de aceptación da por cumplida la tarea "Aceptación de la orden de compra" del
// catálogo — ver registrarOrdenCompraCliente.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion, registrarOrdenCompraCliente } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) {
      return NextResponse.json({ error: 'Sin acceso a Compras de este negocio.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const montoCrudo = body.monto == null || body.monto === '' ? null : Number(body.monto);
    if (montoCrudo != null && !Number.isFinite(montoCrudo)) {
      return NextResponse.json({ error: 'El monto de la orden de compra no es un número.' }, { status: 400 });
    }

    const nombreActor = request.headers.get('x-user-nombre')
      || ((await pool.query('SELECT nombre FROM usuarios WHERE id = ? LIMIT 1', [userId]) as any)[0] as any[])[0]?.nombre
      || null;

    const { tareaAceptacionCerrada } = await registrarOrdenCompraCliente(id, {
      numero: body.numero ? String(body.numero).slice(0, 64) : null,
      emitidaAt: body.emitidaAt ? String(body.emitidaAt) : null,
      aceptadaAt: body.aceptadaAt ? String(body.aceptadaAt) : null,
      monto: montoCrudo,
      difiere: !!body.difiere,
      observacion: body.observacion ? String(body.observacion).slice(0, 4000) : null,
    }, { id: userId, nombre: nombreActor });

    return NextResponse.json({ success: true, tareaAceptacionCerrada });
  } catch (error: any) {
    console.error('[compras/[negocioId]/orden-compra][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo registrar la orden de compra.' }, { status: 500 });
  }
}
