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
import { createHash } from 'node:crypto';

// Generar el PDF es lo lento: se guarda por contenido de la OC (si la OC cambia en Obuma, el hash cambia y se regenera).
const g = globalThis as any;
const PDF_CACHE: Map<string, Buffer> = g.__ocPdfCache || (g.__ocPdfCache = new Map());
const PDF_CACHE_MAX = 80;

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
    const hash = createHash('sha1').update(JSON.stringify(oc)).digest('hex').slice(0, 20);
    const etag = `"oc-${hash}"`;
    const descargar = request.nextUrl.searchParams.get('descargar') === '1';
    if (!descargar && request.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, max-age=60' } });
    let buf = PDF_CACHE.get(hash);
    if (!buf) {
      buf = Buffer.from(await generarPdfOc(oc));
      PDF_CACHE.set(hash, buf);
      if (PDF_CACHE.size > PDF_CACHE_MAX) PDF_CACHE.delete(PDF_CACHE.keys().next().value as string);
    }
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="orden-de-compra-${oc.folio.replace(/[^\w-]/g, '')}.pdf"`,
        ETag: etag,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo abrir la orden de compra.') }, { status: 500 });
  }
}
