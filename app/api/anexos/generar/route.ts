// app/api/anexos/generar/route.ts
// POST /api/anexos/generar { codigo, documentoId, empresaId, respuestas }
// Genera el .docx final (auto-relleno del diccionario + respuestas manuales del formulario),
// lo sube a R2 y lo registra en documentos_cache como DOCUMENTOS_PROPIOS — aparece en
// "Documentos para MP" con el mismo Ver/Descargar que cualquier otro documento propio.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoYEmpresa } from '@/app/lib/anexos-datos';
import { generarAnexoFinal } from '@/app/lib/anexos-rellenar';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo = body?.codigo;
  const documentoId = body?.documentoId;
  const empresaId = body?.empresaId;
  const respuestas: Record<string, string> = body?.respuestas || {};

  if (!codigo || !documentoId || !empresaId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId, empresaId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }

  try {
    const { bufferOriginal, nombreOriginal, empresa } = await cargarDocumentoYEmpresa(codigo, documentoId, empresaId);
    const resultado = await generarAnexoFinal(bufferOriginal, empresa, respuestas);

    if (!resultado.integridad.parrafosIguales) {
      return NextResponse.json(
        { error: 'Verificación de integridad falló: el documento generado no calza con el original. No se subió.' },
        { status: 500 },
      );
    }

    const nombreFinal = `ANEXO_${nombreOriginal}`;
    const url = await subirDocumentoR2(
      codigo, nombreFinal, resultado.buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    await pool.query(
      `INSERT INTO documentos_cache
         (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, usuario_id)
       VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', ?)
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes          = VALUES(size_bytes),
         updated_at          = CURRENT_TIMESTAMP`,
      [
        codigo, nombreFinal, url, resultado.buffer.length,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        usuario.id,
      ],
    );

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_relleno',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Rellenó el anexo "${nombreOriginal}" (${resultado.completados} automáticos, ${resultado.respondidos} manuales)`,
      metadata: { licitacion_codigo: codigo, documento: nombreOriginal, completados: resultado.completados, respondidos: resultado.respondidos },
    });

    return NextResponse.json({
      success: true, url, nombre: nombreFinal,
      completados: resultado.completados, respondidos: resultado.respondidos,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
