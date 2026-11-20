// app/api/compras/[negocioId]/combustible/route.ts
// Cargas de combustible del negocio (litros, tipo, neto, impuesto específico, patente) para mostrarlas en «Gastos extra».
// Solo lectura: las cargas se crean junto con su servicio (PATCH /productos, accion 'agregar_servicio', tipo 'COMBUSTIBLE').
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { cargasDeNegocio } from '@/app/lib/compras-combustible';
import { calcularCarga } from '@/app/lib/compras-combustible-core';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const cargas = (await cargasDeNegocio(id)).map(c => ({ ...c, calculo: calcularCarga(c) }));
    return NextResponse.json({ success: true, cargas });
  } catch (error: any) {
    console.error('[compras/combustible][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudieron cargar las cargas de combustible.') }, { status: 500 });
  }
}
