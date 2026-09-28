// app/api/negocios/[id]/comercial/[itemId]/comparador/pdf/route.ts
// Auditor Técnico — descarga en PDF de la comparación de UNA línea (botón "Descargar PDF" del
// modal). Mismos datos que ya carga el modal (armarEstado + producto/comercial/documentos): nada
// se recalcula acá, solo se pintan en un documento imprimible (auditor-linea-pdf.ts).
//
// GET ?html=1 → el mismo documento como HTML, por si el chromium del servidor no está disponible
// (mismo respaldo que usa /api/entregas/pdf).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { cargarNegocio, nombreDe } from '../../../route';
import { cargarItemLineaTecnica, productosDeItem, migracion127Aplicada } from '../../caracteristicas/route';
import { armarEstado } from '../route';
import { construirComparacionLineaHtml } from '@/app/lib/auditor-linea-pdf';
import { generarInformePdf } from '@/app/lib/generar-informe';
import type { EstadoComparador } from '@/app/lib/auditor-comparador-cliente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string; itemId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol') };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });
    if (!(await migracion127Aplicada()))
      return NextResponse.json({ error: 'Falta aplicar la migración 127 (node scripts/aplicar-migration-127.mjs).' }, { status: 409 });

    const [comparador, productos, precioPlazo, documentos] = await Promise.all([
      armarEstado(item) as unknown as Promise<EstadoComparador>,
      productosDeItem(item, negocio.licitacion_codigo),
      pool.query(
        `SELECT tipo, titulo, valor_numero, valor_texto FROM checklist_comercial
          WHERE negocio_id = ? AND bloque = 'COMERCIAL'
            AND ((tipo = 'precio' AND linea_numero = ?) OR (tipo = 'dato' AND titulo LIKE '%plazo%'))`,
        [negocio.id, item.linea_numero],
      ).then(([rows]: any) => rows as any[]),
      pool.query(`SELECT nombre FROM checklist_comercial_documentos WHERE item_id = ? ORDER BY subido_at, id`, [item.id])
        .then(([rows]: any) => rows as any[]),
    ]);

    const precio = precioPlazo.find(r => r.tipo === 'precio');
    const plazo = precioPlazo.find(r => r.tipo === 'dato');
    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || null;

    const html = construirComparacionLineaHtml({
      licitacionCodigo: negocio.licitacion_codigo,
      item: {
        titulo: item.titulo, linea_numero: item.linea_numero,
        aprobado_por_nombre: item.aprobado_por_nombre ?? null, aprobado_at: item.aprobado_at ?? null,
      },
      productos: productos.map(p => ({ nombre: p.nombre, ofertado: p.ofertado })),
      comparador,
      comercial: { precio: precio ? Number(precio.valor_numero) : null, plazo: plazo?.valor_texto || null },
      documentos,
      generadoPor: nombreActor,
    });

    const nombreArchivo = `AuditorTecnico_${String(negocio.licitacion_codigo || id).replace(/[^\w.-]/g, '_')}_Linea${item.linea_numero ?? item.id}`;

    if (request.nextUrl.searchParams.get('html') === '1') {
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="${nombreArchivo}.html"` },
      });
    }

    const pdf = await generarInformePdf(html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombreArchivo}.pdf"`,
        'Content-Length': String(pdf.length),
      },
    });
  } catch (e: any) {
    console.error('[comercial][comparador][pdf]', String(e).slice(0, 300));
    return NextResponse.json({
      error: 'No se pudo generar el PDF en el servidor. Puedes abrir la versión imprimible en HTML.',
      alternativa: `/api/negocios/${id}/comercial/${itemId}/comparador/pdf?html=1`,
    }, { status: 500 });
  }
}
