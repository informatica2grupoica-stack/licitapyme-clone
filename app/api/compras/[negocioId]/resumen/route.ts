// app/api/compras/[negocioId]/resumen/route.ts
// MÓDULO DE COMPRAS §4 — vuelve a armar el Resumen Ejecutivo de un negocio ya abierto en Compras.
//
// El resumen es CONGELADO por diseño (§4.1: foto del momento de ganar, de solo lectura). Esto no lo
// cambia: no hay regeneración automática ni cron. Es la salida manual para cuando la foto salió mal
// —el paquete de traspaso se congeló antes de que existiera el costeo, o MP estaba caído y no dio
// los contactos del cliente— y la alternativa era editar la base a mano. Ver regenerarResumen.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion, regenerarResumen } from '@/app/lib/compras';
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

    const resumen = await regenerarResumen(id);
    return NextResponse.json({ success: true, faltantes: resumen.faltantes });
  } catch (error: any) {
    console.error('[compras/[negocioId]/resumen][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo actualizar el resumen ejecutivo.' }, { status: 500 });
  }
}
