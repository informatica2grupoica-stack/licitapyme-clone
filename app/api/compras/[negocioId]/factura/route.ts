// app/api/compras/[negocioId]/factura/route.ts
// Vista de una factura de compra (Obuma) dibujada por Licitank a partir de su XML. GET ?dte=<dteId>.
// El XML se busca solo entre las facturas de ESTE negocio (no se acepta una URL del cliente).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { comprasObumaDeLicitacion } from '@/app/lib/obuma-compras';
import { parsearFacturaXml } from '@/app/lib/factura-xml';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  const dte = request.nextUrl.searchParams.get('dte');
  if (!dte) return NextResponse.json({ error: 'Falta la factura.' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [id]) as any;
    const codigo = (rows as any[])[0]?.licitacion_codigo;
    const cruzadas = codigo ? await comprasObumaDeLicitacion(codigo) : [];
    const fac = cruzadas.flatMap(c => c.facturas).find(f => String(f.dteId) === dte);
    if (!fac?.s3Link) return NextResponse.json({ error: 'Esa factura no tiene XML disponible.' }, { status: 404 });

    const r = await fetch(fac.s3Link, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return NextResponse.json({ error: `No se pudo descargar el XML (${r.status}).` }, { status: 502 });
    const factura = parsearFacturaXml(await r.text());
    if (!factura) return NextResponse.json({ error: 'El XML no tiene el formato de una factura.' }, { status: 422 });
    return NextResponse.json({ success: true, factura, xmlUrl: fac.s3Link });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error al leer la factura.' }, { status: 500 });
  }
}
