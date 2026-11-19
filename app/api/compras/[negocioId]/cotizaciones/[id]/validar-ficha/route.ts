// app/api/compras/[negocioId]/cotizaciones/[id]/validar-ficha/route.ts
// Respuesta a «¿este documento es una ficha técnica?»: deja anotado que ya se contestó (sí o no) para que el aviso no vuelva a salir.
// No mueve nada: pasar la ficha a Fichas técnicas es otra ruta (/fichas) que llama la pantalla cuando la respuesta es «sí».
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { notasTrasValidarFicha } from '@/app/lib/compras-cotizacion-specs-core';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

async function __POST(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id } = await params;
  const negId = parseInt(negocioId), cotId = parseInt(id);
  if (!Number.isFinite(negId) || !Number.isFinite(cotId)) return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 });
  try {
    const body = await request.json().catch(() => ({}));
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const [rows]: any = await pool.query(`SELECT notas FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`, [cotId, negId]);
    if (!(rows as any[])[0]) return NextResponse.json({ error: 'Cotización no encontrada.' }, { status: 404 });
    await pool.query(`UPDATE compras_cotizacion SET notas = ? WHERE id = ? AND negocio_id = ?`, [notasTrasValidarFicha((rows as any[])[0].notas, body?.esFicha === true) || null, cotId, negId]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/cotizaciones/validar-ficha][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo guardar la respuesta.') }, { status: 500 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
