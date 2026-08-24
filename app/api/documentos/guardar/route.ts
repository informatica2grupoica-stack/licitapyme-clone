// app/api/documentos/guardar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { registrarActividad } from '@/app/lib/actividad';
import { r2Client, contentDispositionInline } from '@/app/lib/r2';

// Fija el nombre de descarga correcto sobre el objeto que el navegador ACABA de subir directo a
// R2 vía /api/documentos/presign (ese PUT no lleva Content-Disposition — ver la nota en esa
// ruta). Un CopyObject sobre la MISMA key con MetadataDirective:REPLACE solo reescribe metadata,
// no vuelve a subir el archivo. Best-effort: si falla, el documento queda igual guardado, solo
// se descargaría con el nombre "sucio" (timestamp al frente) hasta que se reemplace.
async function fijarNombreDescarga(publicUrl: string, nombreReal: string): Promise<void> {
  let key = '';
  try { key = decodeURIComponent(new URL(publicUrl).pathname.replace(/^\/+/, '')); } catch { return; }
  if (!key || !process.env.R2_BUCKET_NAME) return;
  try {
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      CopySource: `${process.env.R2_BUCKET_NAME}/${encodeURIComponent(key)}`,
      MetadataDirective: 'REPLACE',
      ContentDisposition: contentDispositionInline(nombreReal),
    }));
  } catch (e) {
    console.error('[documentos/guardar] fijar nombre de descarga falló (no crítico):', String(e).slice(0, 200));
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    const { licitacionCodigo, documentoNombre, url, size, categoria, subcategoria, origenManual } = await request.json();

    if (!licitacionCodigo || !documentoNombre || !url) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }
    // El externo solo puede subir documentos a SUS licitaciones asignadas.
    if (!(await puedeVerLicitacion(request, String(licitacionCodigo))))
      return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

    // origenManual=true (subida directa a una caja de la licitación, botón "Subir documento(s)
    // a esta caja") marca categoria_manual=1 para que una re-clasificación IA nunca reasigne
    // este documento (mismo guard que protege el drag&drop entre cajas, ver PATCH
    // /api/documentos/clasificar y clasificacion.ts). Además, más abajo, marca la fila en la
    // tabla aparte documentos_origen_manual (migration-75) para que quede borrable/renombrable
    // aunque su caja sea "oficial" (ver DELETE/PATCH en /api/documentos/[codigo] y
    // CATS_BORRABLES en DocumentosSection.tsx) — a diferencia de un documento real descargado de
    // Mercado Público que cae en la misma caja. Es una TABLA aparte y no una columna más en
    // documentos_cache porque esa tabla ya tiene ~24k filas / ~300MB: en MySQL 5.7 un ALTER TABLE
    // ADD COLUMN la reescribe entera, y ese rewrite supera el límite de ~150s que Bluehost le
    // impone a las conexiones en este plan compartido (confirmado en vivo, ver migration-75.sql).
    const esManual = !!origenManual;

    try {
      // Con categoría + subcategoría + categoria_manual (migraciones 45/47).
      await pool.query(
        `INSERT INTO documentos_cache (usuario_id, licitacion_codigo, documento_nombre, documento_url_local, size_bytes, categoria, subcategoria, categoria_manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           documento_url_local = VALUES(documento_url_local),
           size_bytes = VALUES(size_bytes),
           categoria = COALESCE(VALUES(categoria), categoria),
           subcategoria = COALESCE(VALUES(subcategoria), subcategoria),
           categoria_manual = GREATEST(categoria_manual, VALUES(categoria_manual)),
           usuario_id = COALESCE(usuario_id, VALUES(usuario_id))`,
        [userId ? parseInt(userId) : null, licitacionCodigo, documentoNombre, url, size || 0, categoria || null, subcategoria || null, esManual ? 1 : 0]
      );
    } catch {
      try {
        // Fallback: columna 'subcategoria' (y por ende 'categoria_manual') no existe aún.
        await pool.query(
          `INSERT INTO documentos_cache (usuario_id, licitacion_codigo, documento_nombre, documento_url_local, size_bytes, categoria)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             documento_url_local = VALUES(documento_url_local),
             size_bytes = VALUES(size_bytes),
             categoria = COALESCE(VALUES(categoria), categoria),
             usuario_id = COALESCE(usuario_id, VALUES(usuario_id))`,
          [userId ? parseInt(userId) : null, licitacionCodigo, documentoNombre, url, size || 0, categoria || null]
        );
      } catch {
        // Fallback: columna 'categoria' tampoco existe.
        await pool.query(
          `INSERT INTO documentos_cache (usuario_id, licitacion_codigo, documento_nombre, documento_url_local, size_bytes)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             documento_url_local = VALUES(documento_url_local),
             size_bytes = VALUES(size_bytes),
             usuario_id = COALESCE(usuario_id, VALUES(usuario_id))`,
          [userId ? parseInt(userId) : null, licitacionCodigo, documentoNombre, url, size || 0]
        );
      }
    }

    // Marca la fila como de origen manual en la tabla aparte (best-effort: si la tabla no
    // existe aún, o la lectura del id falla, la subida ya quedó guardada de todos modos — solo
    // no podrá borrarse/renombrarse más tarde por esta vía en particular).
    if (esManual) {
      try {
        const [idRows] = await pool.query(
          `SELECT id FROM documentos_cache WHERE licitacion_codigo = ? AND documento_nombre = ? LIMIT 1`,
          [licitacionCodigo, documentoNombre],
        );
        const docId = (idRows as any[])[0]?.id;
        if (docId) {
          await pool.query(`INSERT IGNORE INTO documentos_origen_manual (documento_id) VALUES (?)`, [docId]);
        }
      } catch (e) {
        console.error('[documentos/guardar] marcar origen_manual falló (no crítico):', String(e).slice(0, 200));
      }
    }

    // Best-effort: el PUT directo a R2 (ver /api/documentos/presign) no fija el nombre de
    // descarga — se hace acá, ahora que el objeto ya existe en R2.
    await fijarNombreDescarga(url, documentoNombre);

    // Bitácora: subió un documento propio a esta licitación (best-effort).
    registrarActividad({
      usuarioId: userId ? parseInt(userId) : null, accion: 'documento',
      entidadTipo: 'licitacion', entidadId: String(licitacionCodigo),
      descripcion: `Subió el documento "${documentoNombre}"`,
      metadata: { licitacion_codigo: licitacionCodigo, documento: documentoNombre, categoria: categoria || null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error guardando documento:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
