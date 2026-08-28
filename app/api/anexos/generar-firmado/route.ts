// app/api/anexos/generar-firmado/route.ts
// POST /api/anexos/generar-firmado { codigo, documentoId, empresaId, pdfBase64, estampas }
// QUEMA cada estampa en su posición exacta (ver anexos-pdf-firma.ts) sobre el PDF que manda el
// cliente — el resultado es el PDF FIRMADO que se sube a R2 como archivo final, en vez del .docx
// que sube /api/anexos/generar. Solo se usa cuando el documento tiene al menos un lugar de firma/
// timbre (`analisis.firma.lugares.length > 0`); un anexo sin firma sigue el camino de siempre.
//
// BUG REAL (29-ago-2026, reportado con video: la firma quedaba en un lugar totalmente distinto al
// que el usuario había arrastrado — "no tiene coherencia"). La primera versión de esta ruta
// REGENERABA el .docx→PDF desde cero (mismo camino que /vista-previa-pdf) en vez de reusar el PDF
// que el usuario tenía delante al posicionar. Dos llamadas INDEPENDIENTES a generarAnexoFinal +
// convertirDocxAPdf no garantizan el mismo resultado byte a byte: cualquier variación entre medio
// (una consulta a Mercado Público que responde distinto, un timing distinto en la conversión de
// LibreOffice) puede correr la paginación — el mismo `yPct` termina apuntando a un lugar distinto
// de la página. La única forma de garantizar "donde lo soltaste, ahí queda" es estampar sobre el
// PDF EXACTO que el usuario vio — nunca sobre una copia regenerada, por más idéntica que debiera
// ser en teoría. `pdfBase64` es ese mismo PDF, tal cual lo devolvió /vista-previa-pdf.
//
// `estampas: { tipo: 'firma'|'timbre', pagina: number, xPct: number, yPct: number, anchoPct: number }[]`
// — puede venir vacío (el usuario no arrastró nada): el PDF sale igual, sin ninguna imagen, que es
// el mismo comportamiento por defecto que ya tiene el .docx (nunca se estampa sola).
//
// NO verifica el total económico contra el costeo (guardarraíl que sí tiene /api/anexos/generar):
// ese chequeo necesita re-parsear el .docx recién generado, y este camino a propósito no regenera
// nada. En la práctica los documentos que llegan acá (declaraciones/formularios con firma) no
// traen casillas de total — si algún día un anexo económico también necesita firma libre sobre
// PDF, ese guardarraíl hay que traerlo de vuelta con cuidado de no reintroducir este mismo bug.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoYEmpresa } from '@/app/lib/anexos-datos';
import { descargarFirma } from '@/app/lib/anexos-rellenar';
import { estamparPdf, type EstampaPdf } from '@/app/lib/anexos-pdf-firma';
import { registrarActividad } from '@/app/lib/actividad';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_PDF = 'application/pdf';
const ES_PDF = (b: Buffer) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';

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
  const pdfBase64: string | undefined = body?.pdfBase64;
  const estampas = validarEstampas(body?.estampas);

  if (!codigo || !documentoId || !empresaId || !pdfBase64) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId, empresaId, pdfBase64' }, { status: 400 });
  }
  let pdfSinFirma: Buffer;
  try {
    pdfSinFirma = Buffer.from(pdfBase64, 'base64');
  } catch {
    return NextResponse.json({ error: 'El PDF recibido no se pudo decodificar' }, { status: 400 });
  }
  if (!ES_PDF(pdfSinFirma)) {
    return NextResponse.json({ error: 'El PDF recibido no es válido — vuelve al paso anterior e inténtalo de nuevo.' }, { status: 400 });
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
    // Solo para el nombre de archivo y las URLs de firma/timbre — el documento en sí (con el texto
    // ya puesto) es `pdfSinFirma`, no se vuelve a generar nada a partir de bufferOriginal.
    const { nombreOriginal, empresa } = await cargarDocumentoYEmpresa(codigo, documentoId, empresaId);

    const usaFirma = estampas.some(e => e.tipo === 'firma');
    const usaTimbre = estampas.some(e => e.tipo === 'timbre');
    const avisos: string[] = [];
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
      descripcion: `Rellenó y firmó el anexo "${nombreOriginal}" (${estampas.length} imagen(es) colocada(s))`
        + (avisos.length > 0 ? ` — AVISO: ${avisos.join(' ')}` : ''),
      metadata: { licitacion_codigo: codigo, documento: nombreOriginal, archivo: nombreArchivo, estampas: estampas.length, avisos },
    });

    return NextResponse.json({ success: true, archivos: [{ nombre: nombreArchivo, url }], dividido: false, avisos });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
