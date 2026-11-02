// src/app/api/proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { mimeDeNombre } from '@/app/lib/r2';

// Tope de lo que el proxy acepta cargar en memoria (las bases y cotizaciones reales pesan bastante menos).
const MAX_BYTES = 60 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  // inline=1 → previsualizar en el navegador (visor). Sin él → descarga (attachment).
  const inline = searchParams.get('inline') === '1';

  if (!url) {
    return NextResponse.json({ error: 'Falta el parámetro url' }, { status: 400 });
  }

  // Anti-SSRF: validar el HOSTNAME real (no `includes` sobre la cadena, que dejaría
  // pasar http://evil.com/?x=mercadopublico.cl). Solo http(s) y dominios confiables.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Protocolo no permitido' }, { status: 403 });
  }
  const r2AccountId = (process.env.R2_ACCOUNT_ID || '').toLowerCase();
  const hostPermitido = (h: string) =>
    h === 'mercadopublico.cl' || h.endsWith('.mercadopublico.cl') ||
    h.endsWith('.r2.dev') ||
    h.endsWith('.r2.cloudflarestorage.com') ||
    (!!r2AccountId && h === `${r2AccountId}.r2.cloudflarestorage.com`);

  if (!hostPermitido(parsed.hostname.toLowerCase())) {
    return NextResponse.json({ error: 'URL no permitida' }, { status: 403 });
  }

  try {
    console.log(`📡 Proxy descargando: ${url}`);

    // Las redirecciones se siguen A MANO y se revalida el host en cada salto: con `redirect: 'follow'` un archivo en un
    // `*.r2.dev` ajeno (cualquiera puede abrir uno) podía redirigir a una dirección interna del servidor (SSRF).
    let destino = parsed;
    let response: Response | null = null;
    for (let salto = 0; salto <= 3; salto++) {
      response = await fetch(destino.href, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'es-CL,es;q=0.9',
          'Referer': 'https://www.mercadopublico.cl/'
        }
      });
      if (response.status < 300 || response.status >= 400) break;
      const sig = response.headers.get('location');
      let proximo: URL | null = null;
      try { proximo = sig ? new URL(sig, destino) : null; } catch { /* location inválida */ }
      if (!proximo || (proximo.protocol !== 'https:' && proximo.protocol !== 'http:') || !hostPermitido(proximo.hostname.toLowerCase())) {
        return NextResponse.json({ error: 'Redirección no permitida' }, { status: 403 });
      }
      destino = proximo;
      if (salto === 3) return NextResponse.json({ error: 'Demasiadas redirecciones' }, { status: 502 });
    }
    if (!response) return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });

    const largo = Number(response.headers.get('content-length') || 0);
    if (largo > MAX_BYTES) return NextResponse.json({ error: 'El archivo es demasiado grande para previsualizarlo' }, { status: 413 });

    if (!response.ok) {
      console.error(`❌ Error al descargar: ${response.status}`);
      return NextResponse.json(
        { error: `Error al descargar el archivo: ${response.statusText}` },
        { status: response.status }
      );
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return NextResponse.json({ error: 'El archivo es demasiado grande para previsualizarlo' }, { status: 413 });

    // Nombre del archivo: desde la URL o desde Content-Disposition de origen.
    let filename = decodeURIComponent((parsed.pathname.split('/').pop() || `documento_${Date.now()}`));
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, '');
      }
    }

    // Content-Type: derivado de la extensión (fuente de verdad). R2/MP suelen mandar
    // octet-stream o text/plain, que rompen la previsualización. Solo respetamos el
    // de origen si es un MIME real y la extensión no nos dice nada.
    const ctOrigen = response.headers.get('content-type') || '';
    const ctPorExt = mimeDeNombre(filename, '');
    const contentType = ctPorExt
      || (ctOrigen && ctOrigen !== 'application/octet-stream' && ctOrigen !== 'text/plain' ? ctOrigen : 'application/octet-stream');

    const disposition = inline
      ? `inline; filename="${encodeURIComponent(filename)}"`
      : `attachment; filename="${encodeURIComponent(filename)}"`;

    console.log(`✅ Archivo servido: ${filename} (${buffer.byteLength} bytes, ${contentType}, ${inline ? 'inline' : 'attachment'})`);

    const cabeceras: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      // Son documentos de negocios (cotizaciones, bases): nunca en un caché compartido.
      'Cache-Control': 'private, max-age=3600',
    };
    // Un SVG abierto directo desde esta URL corre sus <script> con el origen de la app: `sandbox` sin allow-scripts lo impide.
    // Solo a los tipos activos: el sandbox rompe el visor de PDF del navegador.
    if (/svg|html|xml/i.test(contentType)) cabeceras['Content-Security-Policy'] = 'sandbox';

    return new NextResponse(buffer, { headers: cabeceras });
  } catch (error) {
    console.error('❌ Error en proxy:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}