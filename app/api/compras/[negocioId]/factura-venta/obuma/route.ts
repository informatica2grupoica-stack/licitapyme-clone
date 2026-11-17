// app/api/compras/[negocioId]/factura-venta/obuma/route.ts
// Factura de venta leída desde Obuma (17-nov-2026): GET lista las facturas cuya referencia es la OC del cliente;
// POST {tipo, folio} baja el PDF y la carga como si se hubiera subido a mano (marca sola «Factura y cierre»).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { facturasObumaDeNegocio, cargarFacturaDesdeObuma, listarFacturasVenta } from '@/app/lib/compras-factura-venta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol'); const nombre = request.headers.get('x-user-nombre');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre, asignacion };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    return NextResponse.json({ success: true, ...(await facturasObumaDeNegocio(a.id)) });
  } catch (e) {
    console.error('[compras/factura-venta/obuma][GET]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo consultar Obuma.') }, { status: 502 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const b = await request.json().catch(() => ({}));
    const tipo = Number(b.tipo); const folio = String(b.folio || '').trim();
    if (![33, 34].includes(tipo) || !/^\d{1,12}$/.test(folio)) return NextResponse.json({ error: 'Factura inválida.' }, { status: 400 });
    const r = await cargarFacturaDesdeObuma(a.id, a.asignacion.licitacionCodigo, tipo, folio, a.userId, a.nombre);
    return NextResponse.json({ success: true, tareaMarcada: r.tareaMarcada, facturas: await listarFacturasVenta(a.id), obuma: await facturasObumaDeNegocio(a.id) });
  } catch (e: any) {
    console.error('[compras/factura-venta/obuma][POST]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo cargar la factura desde Obuma.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
