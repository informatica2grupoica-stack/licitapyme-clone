// app/api/documentos/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { borrarDocumentoR2 } from '@/app/lib/r2';
import { registrarActividad, userIdFromHeaders } from '@/app/lib/actividad';

// Categorías de archivos que GENERAMOS nosotros (nunca oficiales de Mercado Público) — todas
// borrables/renombrables por igual. Las 3 de anexos separados (ver anexos-dividir.ts
// `clasificarAnexo` + POST /api/anexos/separar) quedan en "Documentos y Bases", no en
// DOCUMENTOS_PROPIOS, pero son igual de nuestras — mismo Set espejado en DocumentosSection.tsx.
// Además de esta lista fija por categoría, un documento con origen_manual=1 (subido a mano
// directo en una caja oficial, ver POST /api/documentos/guardar) es borrable/renombrable igual,
// sea cual sea su categoría — se resuelve por fila, no aquí.
const CATS_PROPIAS = new Set(['DOCUMENTOS_PROPIOS', 'ANEXOS_ADMINISTRATIVOS', 'ANEXOS_TECNICOS', 'ANEXOS_ECONOMICOS']);

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

// DELETE — borra un documento PROPIO (ver CATS_PROPIAS) de la licitación.
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

    // Buscar el documento — SOLO si es propio (protege los oficiales de MP), o si el usuario lo
    // subió a mano directamente en una caja oficial (tabla documentos_origen_manual, migration-75,
    // ver POST /guardar).
    let doc: any;
    try {
      const [rows] = await pool.query(
        `SELECT dc.id, dc.documento_url_local, dc.categoria, (om.documento_id IS NOT NULL) AS origen_manual
           FROM documentos_cache dc
           LEFT JOIN documentos_origen_manual om ON om.documento_id = dc.id
          WHERE dc.licitacion_codigo = ?
            AND (dc.documento_url_local = ? OR dc.documento_nombre = ?)
          LIMIT 1`,
        [codigoDec, url || '', nombre || '']
      );
      doc = (rows as any[])[0];
    } catch {
      // Fallback: tabla 'documentos_origen_manual' no existe aún (migración 75 pendiente).
      const [rows] = await pool.query(
        `SELECT id, documento_url_local, categoria
           FROM documentos_cache
          WHERE licitacion_codigo = ?
            AND (documento_url_local = ? OR documento_nombre = ?)
          LIMIT 1`,
        [codigoDec, url || '', nombre || '']
      );
      doc = (rows as any[])[0];
    }
    if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    // Se pueden borrar los propios; el costeo con precios (COSTEO_ADMIN) solo el admin;
    // y cualquier documento subido a mano por el usuario (origen_manual), sea cual sea su caja.
    const cat = (doc.categoria || '').toUpperCase();
    const esAdmin = request.headers.get('x-user-rol') === 'admin';
    const borrable = CATS_PROPIAS.has(cat) || (cat === 'COSTEO_ADMIN' && esAdmin) || !!doc.origen_manual;
    if (!borrable)
      return NextResponse.json(
        { error: 'Solo se pueden eliminar documentos propios; los oficiales de Mercado Público están protegidos.' },
        { status: 403 }
      );

    // Borrar el objeto de R2 (best-effort) y luego la fila de la caché.
    try { await borrarDocumentoR2(doc.documento_url_local); }
    catch (e) { console.warn(`[documentos:DELETE] R2 ${codigoDec}:`, String(e)); }
    await pool.query(`DELETE FROM documentos_cache WHERE id = ?`, [doc.id]);
    // Limpia la marca en la tabla aparte (best-effort: si no existe la tabla, no hay nada que limpiar).
    try { await pool.query(`DELETE FROM documentos_origen_manual WHERE documento_id = ?`, [doc.id]); } catch {}

    // Bitácora: borró un documento propio de esta licitación (best-effort).
    registrarActividad({
      usuarioId: userIdFromHeaders(request.headers), accion: 'documento',
      entidadTipo: 'licitacion', entidadId: codigoDec,
      descripcion: `Borró el documento "${nombre || doc.documento_url_local}"`,
      metadata: { licitacion_codigo: codigoDec, borrado: true },
    });

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

    let doc: any;
    try {
      const [rows] = await pool.query(
        `SELECT dc.id, dc.documento_nombre, dc.categoria, (om.documento_id IS NOT NULL) AS origen_manual
           FROM documentos_cache dc
           LEFT JOIN documentos_origen_manual om ON om.documento_id = dc.id
          WHERE dc.licitacion_codigo = ? AND (dc.documento_url_local = ? OR dc.documento_nombre = ?) LIMIT 1`,
        [codigoDec, url || '', nombre || '']);
      doc = (rows as any[])[0];
    } catch {
      // Fallback: tabla 'documentos_origen_manual' no existe aún (migración 75 pendiente).
      const [rows] = await pool.query(
        `SELECT id, documento_nombre, categoria FROM documentos_cache
          WHERE licitacion_codigo = ? AND (documento_url_local = ? OR documento_nombre = ?) LIMIT 1`,
        [codigoDec, url || '', nombre || '']);
      doc = (rows as any[])[0];
    }
    if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    if (!CATS_PROPIAS.has((doc.categoria || '').toUpperCase()) && !doc.origen_manual)
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
