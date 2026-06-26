// src/app/api/proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { mimeDeNombre } from '@/app/lib/r2';

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
  const host = parsed.hostname.toLowerCase();
  const r2AccountId = (process.env.R2_ACCOUNT_ID || '').toLowerCase();
  const esUrlPermitida =
    host === 'mercadopublico.cl' || host.endsWith('.mercadopublico.cl') ||
    host.endsWith('.r2.dev') ||
    host.endsWith('.r2.cloudflarestorage.com') ||
    (!!r2AccountId && host.includes(r2AccountId));

  if (!esUrlPermitida) {
    return NextResponse.json({ error: 'URL no permitida' }, { status: 403 });
  }

  try {
    console.log(`📡 Proxy descargando: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/pdf,application/octet-stream,*/*',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Referer': 'https://www.mercadopublico.cl/'
      }
    });

    if (!response.ok) {
      console.error(`❌ Error al descargar: ${response.status}`);
      return NextResponse.json(
        { error: `Error al descargar el archivo: ${response.statusText}` },
        { status: response.status }
      );
    }

    const buffer = await response.arrayBuffer();

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

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('❌ Error en proxy:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}