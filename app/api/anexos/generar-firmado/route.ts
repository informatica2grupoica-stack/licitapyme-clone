// app/api/anexos/generar-firmado/route.ts
// POST /api/anexos/generar-firmado { codigo, documentoId, empresaId, respuestas, estampas }
// Repite el mismo trabajo que /api/anexos/vista-previa-pdf (texto puesto, SIN firma, convertido a
// PDF) y además QUEMA cada estampa en su posición exacta (ver anexos-pdf-firma.ts) — el resultado
// es el PDF FIRMADO que se sube a R2 como archivo final, en vez del .docx que sube
// /api/anexos/generar. Solo se usa cuando el documento tiene al menos un lugar de firma/timbre
// (`analisis.firma.lugares.length > 0`); un anexo sin firma sigue el camino de siempre.
//
// `estampas: { tipo: 'firma'|'timbre', pagina: number, xPct: number, yPct: number, anchoPct: number }[]`
// — puede venir vacío (el usuario no arrastró nada): el PDF sale igual, sin ninguna imagen, que es
// el mismo comportamiento por defecto que ya tiene el .docx (nunca se estampa sola, ver
// anexos-rellenar.ts paso 3).
//
// NO reparte en varios archivos si el documento traía formularios pegados (dividirPorFormularios)
// — este camino asume el .docx YA viene separado (con "Separar anexos"), que es como se usa hoy en
// la práctica: un formulario a la vez.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoYEmpresa, obtenerItemsCosteoParaAnexo, obtenerTextoBasesParaAnexo, obtenerExperienciaOcParaAnexo, obtenerDatosAuditorParaAnexo } from '@/app/lib/anexos-datos';
import { generarAnexoFinal, descargarFirma } from '@/app/lib/anexos-rellenar';
import { abrirDocx, verificarXmlBienFormado } from '@/app/lib/anexos-docx';
import { convertirDocxAPdf } from '@/app/lib/anexos-doc-legacy';
import { estamparPdf, type EstampaPdf } from '@/app/lib/anexos-pdf-firma';
import { verificarTotalEconomico, montoDesdeTexto, type VerificacionTotal } from '@/app/lib/auditor-verificacion-total';
import { registrarActividad } from '@/app/lib/actividad';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_PDF = 'application/pdf';

async function verificarTotalContraCosteo(
  codigo: string, totalesEscritos: { etiqueta: string; valor: string }[],
): Promise<VerificacionTotal | null> {
  if (!totalesEscritos?.length) return null;
  const [rows] = await pool.query(
    `SELECT c.total_precio_neto FROM checklist_comercial_costeo c
       JOIN negocios n ON n.id = c.negocio_id
      WHERE n.licitacion_codigo = ? AND n.activo = TRUE AND c.vigente = 1
      LIMIT 1`,
    [codigo],
  ) as any;
  const totalCosteoNeto = (rows as any[])[0]?.total_precio_neto;
  if (totalCosteoNeto == null) return null;
  const neto = totalesEscritos.find(t => /neto/i.test(t.etiqueta) && !/iva/i.test(t.etiqueta));
  const totalEnAnexo = neto ? montoDesdeTexto(neto.valor) : Math.max(...totalesEscritos.map(t => montoDesdeTexto(t.valor)));
  return verificarTotalEconomico({ totalEnAnexo, totalCosteoNeto: Number(totalCosteoNeto) });
}

function validarEstampas(input: unknown): EstampaPdf[] {
  if (!Array.isArray(input)) return [];
  const out: EstampaPdf[] = [];
  for (const e of input) {
    if (!e || (e.tipo !== 'firma' && e.tipo !== 'timbre')) continue;
    const pagina = Number(e.pagina);
    const xPct = Number(e.xPct);
    const yPct = Number(e.yPct);
    const anchoPct = Number(e.anchoPct);
    if (!Number.isFinite(pagina) || !Number.isFinite(xPct) || !Number.isFinite(yPct) || !Number.isFinite(anchoPct)) continue;
    out.push({ tipo: e.tipo, pagina, xPct, yPct, anchoPct });
  }
  return out;
}

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo = body?.codigo;
  const documentoId = body?.documentoId;
  const empresaId = body?.empresaId;
  const respuestas: Record<string, string> = { ...(body?.respuestas || {}) };
  for (const k of Object.keys(respuestas)) if (k.startsWith('firma:') || k.startsWith('firmaPos:')) delete respuestas[k];
  const estampas = validarEstampas(body?.estampas);

  if (!codigo || !documentoId || !empresaId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId, empresaId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
      [codigo],
    ) as any;
    const negocio = (rows as any[])[0];
    if (negocio && (await yaCongelado(negocio.id, 'admin'))) {
      return NextResponse.json(
        { error: 'Este negocio ya se postuló y su Auditor Técnico quedó congelado — ya no se pueden generar más anexos.' },
        { status: 409 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'No se pudo verificar el estado del negocio, inténtalo de nuevo.' }, { status: 503 });
  }

  try {
    const [{ bufferOriginal, nombreOriginal, empresa }, itemsCosteo, basesTexto, datosAuditor, experienciaOcTexto] = await Promise.all([
      cargarDocumentoYEmpresa(codigo, documentoId, empresaId),
      obtenerItemsCosteoParaAnexo(codigo),
      obtenerTextoBasesParaAnexo(codigo),
      obtenerDatosAuditorParaAnexo(codigo),
      obtenerExperienciaOcParaAnexo(Number(empresaId)),
    ]);

    const resultado = await generarAnexoFinal(bufferOriginal, empresa, respuestas, itemsCosteo, basesTexto, datosAuditor, experienciaOcTexto);
    if (!resultado.integridad.parrafosIguales) {
      return NextResponse.json(
        { error: 'Verificación de integridad falló: el documento generado no calza con el original. No se subió.' },
        { status: 500 },
      );
    }

    const verificacion = await verificarTotalContraCosteo(codigo, resultado.totalesEscritos);
    if (verificacion && !verificacion.calza) {
      return NextResponse.json({ error: verificacion.mensaje, totalNoCalza: true }, { status: 409 });
    }

    const chequeo = verificarXmlBienFormado((await abrirDocx(resultado.buffer)).xml);
    if (!chequeo.valido) {
      return NextResponse.json({ error: `El documento quedó mal formado (${chequeo.error}). No se subió nada.` }, { status: 500 });
    }

    const pdfSinFirma = await convertirDocxAPdf(resultado.buffer);

    // Se bajan las imágenes SOLO si alguna estampa las pide — mismo criterio de no gastar una
    // descarga de más que ya usa generarAnexoFinal para el camino .docx.
    const usaFirma = estampas.some(e => e.tipo === 'firma');
    const usaTimbre = estampas.some(e => e.tipo === 'timbre');
    const avisos = [...resultado.avisos];
    const [firma, timbre] = await Promise.all([
      usaFirma && empresa.firma_url ? descargarFirma(empresa.firma_url) : Promise.resolve(null),
      usaTimbre && empresa.timbre_url ? descargarFirma(empresa.timbre_url) : Promise.resolve(null),
    ]);
    if (usaFirma && empresa.firma_url && !firma) avisos.push('No se pudo descargar la firma guardada — el PDF se generó SIN firma.');
    if (usaTimbre && empresa.timbre_url && !timbre) avisos.push('No se pudo descargar el timbre guardado — el PDF se generó SIN timbre.');

    const pdfFinal = await estamparPdf(pdfSinFirma, estampas, {
      ...(firma ? { firma } : {}),
      ...(timbre ? { timbre } : {}),
    });

    const nombreArchivo = `ANEXO_${nombreOriginal.replace(/\.(docx?|pdf)$/i, '')}.pdf`;
    const url = await subirDocumentoR2(codigo, nombreArchivo, pdfFinal, CONTENT_TYPE_PDF);
    await pool.query(
      `INSERT INTO documentos_cache
         (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, usuario_id)
       VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', ?)
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes          = VALUES(size_bytes),
         updated_at          = CURRENT_TIMESTAMP`,
      [codigo, nombreArchivo, url, pdfFinal.length, CONTENT_TYPE_PDF, usuario.id],
    );

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_relleno',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Rellenó y firmó el anexo "${nombreOriginal}" (${resultado.completados} automáticos, ${resultado.respondidos} manuales, ${estampas.length} imagen(es) colocada(s))`
        + (avisos.length > 0 ? ` — AVISO: ${avisos.join(' ')}` : ''),
      metadata: {
        licitacion_codigo: codigo, documento: nombreOriginal, archivo: nombreArchivo,
        completados: resultado.completados, respondidos: resultado.respondidos, estampas: estampas.length, avisos,
      },
    });

    return NextResponse.json({
      success: true, archivos: [{ nombre: nombreArchivo, url }], dividido: false,
      completados: resultado.completados, respondidos: resultado.respondidos, avisos,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
