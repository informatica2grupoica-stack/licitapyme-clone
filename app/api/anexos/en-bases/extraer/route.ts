// app/api/anexos/en-bases/extraer/route.ts
// POST /api/anexos/en-bases/extraer { codigo, pagina }
// Convierte UN anexo impreso dentro del PDF de bases (ver anexos-en-bases.ts) a un .docx editable
// (ver anexos-pdf-a-docx.ts) y lo registra con categoría propia ANEXO_RECONSTRUIDO —NO
// DOCUMENTOS_PROPIOS: esa caja es "Documentos para MP" (el anexo YA relleno, listo para
// presentar) y este archivo es apenas el insumo intermedio, todavía con blancos— devolviendo
// { id, nombre, url } con la misma forma que cualquier Word real. Así el resto del Anexo Creator
// (analizar/generar, AnexoRellenoModal) lo usa sin saber que no vino de Mercado Público:
// cargarDocumentoYEmpresa (anexos-datos.ts) busca por id sin filtrar por categoría.
//
// Se re-detecta todo desde cero (mismo cálculo que el GET de esta carpeta) en vez de confiar en lo
// que el cliente mandó: la única entrada de verdad es la página, y con ella se reconstruye el
// mismo rango que vio el usuario en el selector.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { detectarAnexosEnBases } from '@/app/lib/anexos-en-bases';
import { rangosDeAnexos, contarPaginasPdf, extraerAnexoDeBases } from '@/app/lib/anexos-pdf-a-docx';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo: string | undefined = body?.codigo;
  const pagina: number | undefined = body?.pagina;
  if (!codigo || !pagina) return NextResponse.json({ error: 'Faltan parámetros: codigo, pagina' }, { status: 400 });

  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  // Mismo alcance que el resto del Anexo Creator (admin-only por ahora, pedido explícito jul-2026).
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT documento_url_local, texto_extraido
         FROM documentos_cache
        WHERE licitacion_codigo = ? AND categoria IN ('BASES_ADMINISTRATIVAS', 'BASES_TECNICAS')
          AND texto_extraido IS NOT NULL AND LENGTH(texto_extraido) > 3000`,
      [codigo],
    ) as any;

    // Mismo criterio que el GET: si más de un documento trae anexos adentro, gana el que más trae.
    let mejor: any = null;
    for (const doc of rows as any[]) {
      const deteccion = detectarAnexosEnBases(doc.texto_extraido);
      if (deteccion.hay && (!mejor || deteccion.anexos.length > mejor.deteccion.anexos.length)) {
        mejor = { doc, deteccion };
      }
    }
    if (!mejor) return NextResponse.json({ error: 'Esta licitación no tiene anexos impresos dentro de sus bases' }, { status: 404 });

    const bufferPdf = Buffer.from(await (await fetch(mejor.doc.documento_url_local)).arrayBuffer());
    const total = await contarPaginasPdf(bufferPdf);
    const rangos = rangosDeAnexos(mejor.deteccion.anexos, total);
    const rango = rangos.find(r => r.desde === pagina);
    if (!rango) return NextResponse.json({ error: `No se encontró ningún anexo que empiece en la página ${pagina}` }, { status: 404 });

    const { docx } = await extraerAnexoDeBases(bufferPdf, rango);
    const nombreArchivo = `ANEXO_RECONSTRUIDO_${rango.titulo}.docx`
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 200);

    const url = await subirDocumentoR2(codigo, nombreArchivo, docx, CONTENT_TYPE_DOCX);
    const [resultado]: any = await pool.query(
      `INSERT INTO documentos_cache
         (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, usuario_id)
       VALUES (?, ?, ?, ?, ?, 'ANEXO_RECONSTRUIDO', ?)
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes          = VALUES(size_bytes),
         updated_at          = CURRENT_TIMESTAMP,
         id                  = LAST_INSERT_ID(id)`,
      [codigo, nombreArchivo, url, docx.length, CONTENT_TYPE_DOCX, usuario.id],
    );

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_reconstruido',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Reconstruyó "${rango.titulo}" a Word desde el PDF de bases (p.${rango.desde}-${rango.hasta})`,
      metadata: { licitacion_codigo: codigo, documento: nombreArchivo, paginas: `${rango.desde}-${rango.hasta}` },
    });

    return NextResponse.json({
      success: true,
      documento: { id: resultado.insertId, nombre: nombreArchivo, url },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
