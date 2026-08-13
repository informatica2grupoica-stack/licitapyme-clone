// app/api/anexos/generar/route.ts
// POST /api/anexos/generar { codigo, documentoId, empresaId, respuestas }
// Genera el .docx final (auto-relleno del diccionario + respuestas manuales del formulario).
// Si el documento trae varios formularios pegados (patrón "FORMULARIO N°X" — ver
// anexos-dividir.ts), sube UNO por formulario; si no, sube un solo archivo como antes. Todos
// quedan en R2 + documentos_cache como DOCUMENTOS_PROPIOS — aparecen en "Documentos para MP"
// con el mismo Ver/Descargar que cualquier otro documento propio.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoYEmpresa, obtenerItemsCosteoParaAnexo, obtenerTextoBasesParaAnexo } from '@/app/lib/anexos-datos';
import { generarAnexoFinal } from '@/app/lib/anexos-rellenar';
import { abrirDocx, verificarXmlBienFormado } from '@/app/lib/anexos-docx';
import { dividirPorFormularios } from '@/app/lib/anexos-dividir';
import { registrarActividad } from '@/app/lib/actividad';
import { yaCongelado } from '@/app/lib/congelamiento';

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
  // El creador de anexos queda restringido a admin por ahora (pedido explícito, jul-2026)
  // mientras se decide quiénes más lo van a usar — reforzado acá, no solo ocultando el botón.
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  // Guardarraíl real (antes era solo el botón de la UI, no una regla del backend — auditoría
  // ago-2026): una vez que el negocio se postuló, el Auditor Técnico queda congelado y el anexo ya
  // se presentó — no tiene sentido seguir generando/reemplazando anexos para él. Fail-closed: si no
  // se puede determinar el negocio o su estado, no se genera.
  try {
    const [rows] = await pool.query(
      `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
      [codigo],
    ) as any;
    const negocio = (rows as any[])[0];
    if (negocio && (await yaCongelado(negocio.id))) {
      return NextResponse.json(
        { error: 'Este negocio ya se postuló y su Auditor Técnico quedó congelado — ya no se pueden generar más anexos.' },
        { status: 409 },
      );
    }
  } catch (e) {
    return NextResponse.json({ error: 'No se pudo verificar el estado del negocio, inténtalo de nuevo.' }, { status: 503 });
  }

  try {
    const [{ bufferOriginal, nombreOriginal, empresa }, itemsCosteo, basesTexto] = await Promise.all([
      cargarDocumentoYEmpresa(codigo, documentoId, empresaId),
      obtenerItemsCosteoParaAnexo(codigo),
      obtenerTextoBasesParaAnexo(codigo),
    ]);

    // Se guarda el veredicto del documento DE ENTRADA (ya convertido a .docx si venía .doc) para no
    // atribuirle al relleno un XML que ya venía inválido de origen: el chequeo de abajo detecta
    // ahora también prefijos de namespace sin declarar, y hay anexos —incluidos los que generó este
    // mismo endpoint antes del fix del 29-jul-2026— que ya llegan así. Sin esta distinción el
    // mensaje mandaría a buscar un bug nuestro donde no lo hay.
    const entradaValida = verificarXmlBienFormado((await abrirDocx(bufferOriginal)).xml).valido;

    const resultado = await generarAnexoFinal(bufferOriginal, empresa, respuestas, itemsCosteo, basesTexto);

    if (!resultado.integridad.parrafosIguales) {
      return NextResponse.json(
        { error: 'Verificación de integridad falló: el documento generado no calza con el original. No se subió.' },
        { status: 500 },
      );
    }

    const { xml: xmlFinal } = await abrirDocx(resultado.buffer);
    const formularios = await dividirPorFormularios(resultado.buffer, xmlFinal);

    const candidatos = formularios.length >= 2
      ? formularios.map(f => ({ nombre: `${f.nombreArchivo}.docx`, buffer: f.buffer }))
      : [{ nombre: `ANEXO_${nombreOriginal}`, buffer: resultado.buffer }];

    // Antes de subir NADA: cada .docx candidato debe tener un XML bien formado — ver
    // verificarXmlBienFormado (anexos-docx.ts). verificarParrafos (arriba) solo compara la
    // cantidad de párrafos del documento COMBINADO antes de dividir; no alcanza a detectar que
    // un FRAGMENTO ya dividido quedó corrupto, que es justo donde se encontró un bug real (Word
    // se negaba a abrir el archivo). Se valida TODO antes de subir el primero para no dejar una
    // subida a medias si un formulario sale mal y otro no.
    for (const c of candidatos) {
      const { xml } = await abrirDocx(c.buffer);
      const chequeo = verificarXmlBienFormado(xml);
      if (!chequeo.valido) {
        return NextResponse.json(
          {
            error: entradaValida
              ? `El documento "${c.nombre}" quedó mal formado (${chequeo.error}). No se subió nada.`
              : `El anexo original "${nombreOriginal}" ya venía con un XML inválido (${chequeo.error}), `
                + 'así que el resultado tampoco es válido. No se subió nada — hay que conseguir una copia sana del anexo.',
          },
          { status: 500 },
        );
      }
    }

    const archivos: { nombre: string; url: string }[] = [];
    for (const c of candidatos) {
      const url = await subirYRegistrar(codigo, c.nombre, c.buffer, usuario.id);
      archivos.push({ nombre: c.nombre, url });
    }

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_relleno',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Rellenó el anexo "${nombreOriginal}" (${resultado.completados} automáticos, ${resultado.respondidos} manuales)`
        + (archivos.length > 1 ? ` — dividido en ${archivos.length} formularios` : '')
        + (resultado.avisos.length > 0 ? ` — AVISO: ${resultado.avisos.join(' ')}` : ''),
      metadata: {
        licitacion_codigo: codigo, documento: nombreOriginal,
        completados: resultado.completados, respondidos: resultado.respondidos,
        archivos: archivos.map(a => a.nombre), avisos: resultado.avisos,
      },
    });

    return NextResponse.json({
      success: true, archivos, dividido: archivos.length > 1,
      completados: resultado.completados, respondidos: resultado.respondidos,
      avisos: resultado.avisos,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
