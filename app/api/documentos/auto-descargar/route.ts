// app/api/documentos/auto-descargar/route.ts
//
// ESTRATEGIA ANTI-WAF — sin proxies externos:
//
//  El WAF de Mercado Público bloquea todas las IPs que no son de ISP chileno
//  (Movistar CL, VTR, Entel, etc.). Los proxies "residenciales" de ZenRows,
//  ScrapingAnt y similares también son bloqueados porque usan IPs de data
//  centers o ISPs no registrados en Chile.
//
//  SOLUCIÓN: usar la API oficial de Mercado Público (api.mercadopublico.cl)
//  que ya funciona para las búsquedas y devuelve Documentos.Listado con
//  URLs directas de Download.aspx para cada adjunto.
//
//  PIPELINE:
//  1. Llamar api.mercadopublico.cl con MERCADO_PUBLICO_TICKET
//     → Documentos.Listado[{Nombre, Descripcion, Tipo, Url}]
//  2. Intentar descargar cada Url directamente desde Vercel
//     → Si responde binario (PDF/DOCX/etc.) → subir a R2 → guardar en DB
//     → Si responde HTML (Download.aspx también podría estar bloqueado) →
//        devolver URLs al frontend para que el usuario descargue con su browser
//  3. El usuario hace clic en "Abrir" → su browser tiene IP chilena → descarga OK

import { NextRequest, NextResponse } from 'next/server';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { guardarDocumentoEnCache } from '@/app/services/documentosService.server';

// ─── API oficial de Mercado Público ───────────────────────────────────────

async function obtenerDocsDesdeAPI(
  codigo: string,
  log: string[],
): Promise<{ nombre: string; url: string; tipo?: string; descripcion?: string }[]> {
  const ticket = process.env.MERCADO_PUBLICO_TICKET;
  if (!ticket) {
    log.push('⚠️ MERCADO_PUBLICO_TICKET no configurado en Vercel');
    return [];
  }

  const apiUrl =
    `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
    `?codigo=${encodeURIComponent(codigo)}` +
    `&ticket=${ticket}`;

  log.push(`🔌 API MP: licitaciones.json?codigo=${codigo}`);

  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      log.push(`⚠️ API MP HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();

    if (data.Codigo === 10000) {
      log.push(`⚠️ API MP error: ${data.Mensaje} (ticket inválido o expirado)`);
      return [];
    }

    const licitacion = data.Listado?.[0];
    if (!licitacion) {
      log.push('⚠️ API MP: licitación no encontrada');
      return [];
    }

    // Intentar diferentes estructuras posibles de Documentos
    const rawDocs: any[] =
      licitacion.Documentos?.Listado ??
      licitacion.Documentos ??
      licitacion.documentos?.Listado ??
      licitacion.documentos ??
      [];

    if (!Array.isArray(rawDocs) || rawDocs.length === 0) {
      log.push('📄 API MP: sin documentos en la respuesta');
      // Log qué campos tiene la licitación para diagnóstico
      const keys = Object.keys(licitacion);
      log.push(`   Campos disponibles: ${keys.join(', ')}`);
      return [];
    }

    const docs = rawDocs
      .map((d: any) => ({
        nombre:      (d.Nombre      || d.nombre      || d.Name    || 'Documento').trim(),
        url:         (d.Url         || d.URL          || d.url     || '').trim(),
        tipo:        (d.Tipo        || d.tipo         || '').trim(),
        descripcion: (d.Descripcion || d.descripcion  || '').trim(),
      }))
      .filter(d => !!d.url);

    log.push(`✅ API MP: ${docs.length} documentos (de ${rawDocs.length} en respuesta)`);
    docs.slice(0, 8).forEach((d, i) =>
      log.push(`   ${i + 1}. ${d.nombre}${d.tipo ? ` [${d.tipo}]` : ''}`)
    );
    if (docs.length > 8) log.push(`   ... y ${docs.length - 8} más`);
    return docs;

  } catch (e: any) {
    log.push(`⚠️ API MP excepción: ${e.message}`);
    return [];
  }
}

// ─── Descarga directa (puede estar bloqueada por WAF desde Vercel) ────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function descargarArchivo(
  url: string,
  nombre: string,
  log: string[],
): Promise<{ buffer: Buffer; contentType: string; filename?: string } | 'bloqueado' | 'error'> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,application/octet-stream,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Referer': 'https://www.mercadopublico.cl/',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      log.push(`  ❌ HTTP ${res.status} — ${nombre}`);
      return 'error';
    }

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      // WAF devuelve robot.png en HTML → bloqueado desde Vercel
      return 'bloqueado';
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      log.push(`  ⚠️ Respuesta muy pequeña (${buffer.length} bytes) — ${nombre}`);
      return 'bloqueado';
    }

    // Nombre del Content-Disposition si existe
    let filename: string | undefined;
    const cd = res.headers.get('content-disposition') || '';
    const mcd = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (mcd?.[1]) filename = mcd[1].replace(/['"]/g, '').trim();

    return { buffer, contentType, filename };

  } catch (e: any) {
    log.push(`  ❌ Error descargando ${nombre}: ${e.message}`);
    return 'error';
  }
}

function inferirExtension(contentType: string, nombre: string): string {
  if (/\.\w{2,5}$/.test(nombre)) return '';  // ya tiene extensión
  if (contentType.includes('pdf'))   return '.pdf';
  if (contentType.includes('word'))  return '.docx';
  if (contentType.includes('excel')) return '.xlsx';
  if (contentType.includes('zip'))   return '.zip';
  return '';
}

// ─── Pipeline principal ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { licitacionCodigo } = await request.json();

  if (!licitacionCodigo) {
    return NextResponse.json({ error: 'licitacionCodigo requerido' }, { status: 400 });
  }

  const log: string[] = [];

  // URL ficha general
  const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(licitacionCodigo)}`;

  // URL directa a la página de adjuntos (ViewAttachmentLC) — el enc es base64 del código
  // Funciona desde el browser del usuario (IP chilena) aunque esté bloqueado desde Vercel
  const encB64 = Buffer.from(licitacionCodigo).toString('base64');
  const adjuntosUrl = `https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?enc=${encB64}`;

  const apiConfigurada = !!process.env.MERCADO_PUBLICO_TICKET;

  log.push(`🔧 API MP ticket: ${apiConfigurada ? '✅ configurado' : '❌ MERCADO_PUBLICO_TICKET faltante'}`);
  log.push(`🔗 URL adjuntos: ${adjuntosUrl}`);

  // ── PASO 1: Obtener lista de documentos desde la API oficial ─────────────
  const docsAPI = await obtenerDocsDesdeAPI(licitacionCodigo, log);

  if (docsAPI.length === 0) {
    // La API oficial no incluye los adjuntos en su respuesta (limitación conocida).
    // Devolvemos la URL directa a ViewAttachmentLC para que el usuario los abra
    // desde su browser con IP chilena.
    return NextResponse.json({
      success: false,
      total: 0,
      descargados: 0,
      error: apiConfigurada
        ? 'La API de Mercado Público no incluye adjuntos. Ábrelos directamente desde el portal.'
        : 'Falta configurar MERCADO_PUBLICO_TICKET en Vercel → Settings → Environment Variables',
      adjunto_url_mp: adjuntosUrl,   // URL directa a la página de adjuntos
      ficha_url_mp: fichaUrl,
      log,
    });
  }

  // ── PASO 2: Intentar descargar cada documento desde Vercel ──────────────
  log.push(`─── PASO 2: Descargando ${docsAPI.length} documentos ───`);

  const resultados: any[] = [];
  let descargados = 0;
  let bloqueados = 0;

  for (const doc of docsAPI) {
    log.push(`⬇️ ${doc.nombre}`);
    const resultado = await descargarArchivo(doc.url, doc.nombre, log);

    if (resultado === 'bloqueado') {
      bloqueados++;
      // URL directa de Download.aspx → el usuario puede abrirla desde su browser
      resultados.push({
        nombre:      doc.nombre,
        tipo:        doc.tipo,
        descripcion: doc.descripcion,
        status:      'descarga_bloqueada',
        downloadUrl: doc.url,   // URL para mostrar en UI con botón "Abrir"
      });
      continue;
    }

    if (resultado === 'error') {
      resultados.push({ nombre: doc.nombre, status: 'error' });
      continue;
    }

    // Descarga exitosa → subir a R2
    let nombreFinal = resultado.filename || doc.nombre;
    nombreFinal += inferirExtension(resultado.contentType, nombreFinal);

    try {
      const publicUrl = await subirDocumentoR2(
        licitacionCodigo, nombreFinal, resultado.buffer, resultado.contentType
      );
      await guardarDocumentoEnCache(licitacionCodigo, nombreFinal, publicUrl, resultado.buffer.length);

      descargados++;
      log.push(`  ✅ ${nombreFinal} (${(resultado.buffer.length / 1024).toFixed(0)} KB)`);
      resultados.push({
        nombre: nombreFinal,
        status: 'ok',
        url: publicUrl,
        size: resultado.buffer.length,
      });
    } catch (e: any) {
      log.push(`  ❌ Error guardando ${nombreFinal}: ${e.message}`);
      resultados.push({ nombre: doc.nombre, status: 'error_storage', error: e.message });
    }
  }

  log.push(`─── Resumen: ${descargados} descargados, ${bloqueados} bloqueados por WAF ───`);

  // ── Construir respuesta ──────────────────────────────────────────────────

  // Documentos con URL directa de MP (para mostrar en UI aunque estén bloqueados)
  const docsBloqueados = resultados.filter(r => r.status === 'descarga_bloqueada');

  return NextResponse.json({
    success: descargados > 0,
    total: docsAPI.length,
    descargados,
    bloqueados,
    documentos: resultados,

    // Lista para el UI cuando la descarga desde Vercel está bloqueada
    // Cada item tiene nombre + downloadUrl (URL directa de Download.aspx)
    lista_documentos: docsBloqueados.length > 0 ? docsBloqueados : undefined,

    adjunto_url_mp: adjuntosUrl,  // URL directa a ViewAttachmentLC (página de adjuntos)
    ficha_url_mp: fichaUrl,
    log,
  });
}
