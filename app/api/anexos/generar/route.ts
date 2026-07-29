// app/api/anexos/generar/route.ts
// POST /api/anexos/generar { codigo, documentoId, empresaId, respuestas }
// Genera el .docx final (auto-relleno del diccionario + respuestas manuales del formulario).
// Si el documento trae varios formularios pegados (patrón "FORMULARIO N°X" — ver
// anexos-dividir.ts), sube UNO por formulario; si no, sube un solo archivo como antes. Todos
// quedan en R2 + documentos_cache como DOCUMENTOS_PROPIOS — aparecen en "Documentos para MP"
// con el mismo Ver/Descargar que cualquier otro documento propio.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoYEmpresa } from '@/app/lib/anexos-datos';
import { generarAnexoFinal } from '@/app/lib/anexos-rellenar';
import { abrirDocx } from '@/app/lib/anexos-docx';
import { dividirPorFormularios } from '@/app/lib/anexos-dividir';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function subirYRegistrar(codigo: string, nombre: string, buffer: Buffer, usuarioId: number) {
  const url = await subirDocumentoR2(codigo, nombre, buffer, CONTENT_TYPE_DOCX);
  await pool.query(
    `INSERT INTO documentos_cache
       (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, usuario_id)
     VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', ?)
     ON DUPLICATE KEY UPDATE
       documento_url_local = VALUES(documento_url_local),
       size_bytes          = VALUES(size_bytes),
       updated_at          = CURRENT_TIMESTAMP`,
    [codigo, nombre, url, buffer.length, CONTENT_TYPE_DOCX, usuarioId],
  );
  return url;
}

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

    const { xml: xmlFinal } = await abrirDocx(resultado.buffer);
    const formularios = await dividirPorFormularios(resultado.buffer, xmlFinal);

    let archivos: { nombre: string; url: string }[];
    if (formularios.length >= 2) {
      archivos = [];
      for (const f of formularios) {
        const nombre = `ANEXO_${f.nombreSufijo}_${nombreOriginal}`;
        const url = await subirYRegistrar(codigo, nombre, f.buffer, usuario.id);
        archivos.push({ nombre, url });
      }
    } else {
      const nombre = `ANEXO_${nombreOriginal}`;
      const url = await subirYRegistrar(codigo, nombre, resultado.buffer, usuario.id);
      archivos = [{ nombre, url }];
    }

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_relleno',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Rellenó el anexo "${nombreOriginal}" (${resultado.completados} automáticos, ${resultado.respondidos} manuales)`
        + (archivos.length > 1 ? ` — dividido en ${archivos.length} formularios` : ''),
      metadata: {
        licitacion_codigo: codigo, documento: nombreOriginal,
        completados: resultado.completados, respondidos: resultado.respondidos,
        archivos: archivos.map(a => a.nombre),
      },
    });

    return NextResponse.json({
      success: true, archivos, dividido: archivos.length > 1,
      completados: resultado.completados, respondidos: resultado.respondidos,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
