// app/api/documentos/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { borrarDocumentoR2 } from '@/app/lib/r2';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  if (!codigo) {
    return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, decodeURIComponent(codigo))))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, size_bytes, created_at, categoria
       FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
      [codigo]
    );
    // El costeo (con precios de mercado incluido) es visible para cualquier perfil asignado.
    const docs = rows as any[];

    return NextResponse.json({
      success: true,
      codigo,
      documentos: docs.map(d => ({
        nombre: d.documento_nombre,
        url: d.documento_url_local,
        url_local: d.documento_url_local,
        categoria: d.categoria,
        size: d.size_bytes,
        ya_descargado: true,
        fecha: d.created_at,
      })),
      total: docs.length,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — borra un documento PROPIO (categoría DOCUMENTOS_PROPIOS) de la licitación.
// Solo se permiten los propios: los oficiales descargados de Mercado Público quedan
// protegidos. Lo puede hacer cualquier perfil con acceso a la licitación (no requiere admin).
// Se identifica el documento por su URL (documento_url_local) o, en su defecto, por nombre.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  if (!codigo) return NextResponse.json({ error: 'Código requerido' }, { status: 400 });

  const codigoDec = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDec)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const url: string | undefined = body?.url || body?.documento_url_local;
    const nombre: string | undefined = body?.nombre || body?.documento_nombre;
    if (!url && !nombre)
      return NextResponse.json({ error: 'Falta la URL o el nombre del documento' }, { status: 400 });

    // Buscar el documento — SOLO si es propio (protege los oficiales de MP).
    const [rows] = await pool.query(
      `SELECT id, documento_url_local, categoria
         FROM documentos_cache
        WHERE licitacion_codigo = ?
          AND (documento_url_local = ? OR documento_nombre = ?)
        LIMIT 1`,
      [codigoDec, url || '', nombre || '']
    );
    const doc = (rows as any[])[0];
    if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    // Se pueden borrar los propios; el costeo con precios (COSTEO_ADMIN) solo el admin.
    const cat = (doc.categoria || '').toUpperCase();
    const esAdmin = request.headers.get('x-user-rol') === 'admin';
    const borrable = cat === 'DOCUMENTOS_PROPIOS' || (cat === 'COSTEO_ADMIN' && esAdmin);
    if (!borrable)
      return NextResponse.json(
        { error: 'Solo se pueden eliminar documentos propios; los oficiales de Mercado Público están protegidos.' },
        { status: 403 }
      );

    // Borrar el objeto de R2 (best-effort) y luego la fila de la caché.
    try { await borrarDocumentoR2(doc.documento_url_local); }
    catch (e) { console.warn(`[documentos:DELETE] R2 ${codigoDec}:`, String(e)); }
    await pool.query(`DELETE FROM documentos_cache WHERE id = ?`, [doc.id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error borrando documento:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — RENOMBRA un documento PROPIO (solo cambia documento_nombre; el objeto R2 y la URL no cambian).
// Protege los oficiales de MP (solo DOCUMENTOS_PROPIOS). Conserva la extensión del archivo.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  if (!codigo) return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  const codigoDec = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDec)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const url: string | undefined = body?.url || body?.documento_url_local;
    const nombre: string | undefined = body?.nombre || body?.documento_nombre;
    let nuevoNombre: string = String(body?.nuevo_nombre || '').trim();
    if ((!url && !nombre) || !nuevoNombre)
      return NextResponse.json({ error: 'Falta identificar el documento o el nuevo nombre' }, { status: 400 });

    const [rows] = await pool.query(
      `SELECT id, documento_nombre, categoria FROM documentos_cache
        WHERE licitacion_codigo = ? AND (documento_url_local = ? OR documento_nombre = ?) LIMIT 1`,
      [codigoDec, url || '', nombre || '']);
    const doc = (rows as any[])[0];
    if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    if ((doc.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS')
      return NextResponse.json({ error: 'Solo se pueden renombrar documentos propios.' }, { status: 403 });

    // Conserva la extensión original si el nuevo nombre no la trae.
    const extOrig = (doc.documento_nombre.match(/\.[a-z0-9]+$/i) || [''])[0];
    if (extOrig && !new RegExp(`${extOrig}$`, 'i').test(nuevoNombre)) nuevoNombre += extOrig;
    nuevoNombre = nuevoNombre.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200); // sanea nombre de archivo

    await pool.query(`UPDATE documentos_cache SET documento_nombre = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nuevoNombre, doc.id]);
    return NextResponse.json({ success: true, nombre: nuevoNombre });
  } catch (error) {
    console.error('Error renombrando documento:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
