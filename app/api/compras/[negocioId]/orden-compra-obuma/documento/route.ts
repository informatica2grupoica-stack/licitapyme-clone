// app/api/compras/[negocioId]/orden-compra-obuma/documento/route.ts
// «Ver OC»: el PDF de una OC real de Obuma de la licitación de este negocio, con la plantilla de Obuma. GET ?folio= (&descargar=1 lo baja).
// Solo se sirven folios que pertenecen a la licitación del negocio (no se acepta cualquier OC).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
import { documentoOcObuma } from '@/app/lib/compras-oc-documento';
import { generarPdfOc } from '@/app/lib/compras-oc-pdf';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  const folio = request.nextUrl.searchParams.get('folio');
  if (!Number.isFinite(id) || !folio) return NextResponse.json({ error: 'Falta la orden de compra.' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    // Solo lectura: cualquiera que pueda ver Compras (incluye administración, bodega, compras_ver y Auditor) abre la OC.
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [id]) as any;
    const codigo = (rows as any[])[0]?.licitacion_codigo;
    const oc = codigo ? await documentoOcObuma(codigo, folio) : null;
    if (!oc) return NextResponse.json({ error: 'Esa orden de compra no está en Obuma para esta licitación.' }, { status: 404 });
    const pdf = await generarPdfOc(oc);
    const descargar = request.nextUrl.searchParams.get('descargar') === '1';
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="orden-de-compra-${oc.folio.replace(/[^\w-]/g, '')}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo abrir la orden de compra.') }, { status: 500 });
  }
}
