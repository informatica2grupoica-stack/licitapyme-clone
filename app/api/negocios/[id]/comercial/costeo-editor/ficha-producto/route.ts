// app/api/negocios/[id]/comercial/costeo-editor/ficha-producto/route.ts
// POST { detalle: string, link: string } → intenta sacar la ficha técnica del producto desde el
// link que el asistente pegó en el costeo (link1/link2/link3), y si encuentra algo aprovechable
// la sube como PDF a Documentos Propios. Motor: app/lib/costeo-ficha-producto.ts.
//
// El body manda detalle+link YA elegidos por el frontend (el primer link no vacío de la fila) —
// no relee negocio_costeo_editor acá: evita depender de que la fila ya esté guardada.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { extraerFichaDeUrl, generarFichaProductoPdf, slugArchivo } from '@/app/lib/costeo-ficha-producto';
import { cargarNegocio } from '../../route';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Mismo gate que el resto de comercial/costeo-editor: admin-only por ahora.
function soloAdmin(rol: string | null) {
  return rol === 'admin'
    ? null
    : NextResponse.json({ error: 'El costeo del sistema está habilitado solo para administradores.' }, { status: 403 });
}

const CONTENT_TYPE_PDF = 'application/pdf';

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const noAdmin = soloAdmin(rol);
  if (noAdmin) return noAdmin;
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const detalle = String(body?.detalle || '').trim();
    const link = String(body?.link || '').trim();
    if (!detalle || !link) return NextResponse.json({ error: 'Falta el detalle del producto o el link' }, { status: 400 });
    let urlValida: URL;
    try { urlValida = new URL(link); } catch { return NextResponse.json({ error: 'El link no es una URL válida' }, { status: 400 }); }
    if (urlValida.protocol !== 'http:' && urlValida.protocol !== 'https:') {
      return NextResponse.json({ error: 'El link debe ser http o https' }, { status: 400 });
    }

    const ficha = await extraerFichaDeUrl(link);
    if (!ficha) {
      return NextResponse.json(
        { error: 'No se encontraron datos técnicos en esa página — prueba con otro link o complétalo a mano.' },
        { status: 400 },
      );
    }

    const pdf = await generarFichaProductoPdf(detalle, ficha);
    const nombre = `FICHA_TECNICA_${slugArchivo(detalle)}.pdf`;
    const url = await subirDocumentoR2(negocio.licitacion_codigo, nombre, pdf, CONTENT_TYPE_PDF);

    // subcategoria = 'Ficha Técnica' — misma columna que ya usa "Documentos Propios" para agrupar
    // en cajas libres (migración 45, arrastrar-y-soltar en DocumentosSection.tsx): sin esto,
    // caía junto con el costeo/anexos rellenados en la caja "Sin clasificar". El texto tiene que
    // ser SIEMPRE idéntico para que todas las fichas caigan en la MISMA caja.
    const SUBCATEGORIA_FICHA_TECNICA = 'Ficha Técnica';
    await pool.query(
      `INSERT INTO documentos_cache
         (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, subcategoria, usuario_id)
       VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', ?, ?)
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes          = VALUES(size_bytes),
         subcategoria        = VALUES(subcategoria),
         updated_at          = CURRENT_TIMESTAMP`,
      [negocio.licitacion_codigo, nombre, url, pdf.length, CONTENT_TYPE_PDF, SUBCATEGORIA_FICHA_TECNICA, userId],
    );

    return NextResponse.json({
      success: true, nombre, url,
      especificaciones: ficha.especificaciones.length,
      fuente: ficha.fuente,
      tieneDescripcionLibre: !ficha.especificaciones.length && !!ficha.descripcion,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
