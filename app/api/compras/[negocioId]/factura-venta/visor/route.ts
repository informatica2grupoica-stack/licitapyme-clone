// app/api/compras/[negocioId]/factura-venta/visor/route.ts
// Vista tipo factura de una factura de venta traída desde Obuma, dibujada con el XML que Licitank guardó. GET ?id=<id de la factura>.
// El XML sale de la fila de ESTE negocio (no se acepta una URL del cliente).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { listarFacturasVenta } from '@/app/lib/compras-factura-venta';
import { parsearFacturaXml } from '@/app/lib/factura-xml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  const facturaId = parseInt(request.nextUrl.searchParams.get('id') || '');
  if (!Number.isFinite(id) || !Number.isFinite(facturaId)) return NextResponse.json({ error: 'Falta la factura.' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const fac = (await listarFacturasVenta(id)).find(f => f.id === facturaId);
    if (!fac?.xmlUrl) return NextResponse.json({ error: 'Esa factura no tiene XML guardado.' }, { status: 404 });
    const r = await fetch(fac.xmlUrl, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return NextResponse.json({ error: `No se pudo leer el XML (${r.status}).` }, { status: 502 });
    const factura = parsearFacturaXml(await r.text());
    if (!factura) return NextResponse.json({ error: 'El XML no tiene el formato de una factura.' }, { status: 422 });
    return NextResponse.json({ success: true, factura, xmlUrl: fac.xmlUrl });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, 'Error al leer la factura.') }, { status: 500 });
  }
}
