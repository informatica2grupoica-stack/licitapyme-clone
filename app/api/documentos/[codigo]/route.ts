// app/api/documentos/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import pool from '@/app/lib/db';

interface DocumentoExtraido {
  nombre: string;
  url: string;
  tipo?: string;
  descripcion?: string;
  size?: number;
  fecha?: string;
  ya_descargado?: boolean;
  url_local?: string;
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9',
};

function parseSizeStr(sizeStr?: string): number | undefined {
  if (!sizeStr) return undefined;
  const match = sizeStr.trim().match(/^([\d.,]+)\s*(KB|MB|B)?$/i);
  if (!match) return undefined;
  const n = parseFloat(match[1].replace(',', '.'));
  const unit = (match[2] || 'B').toUpperCase();
  if (unit === 'MB') return Math.round(n * 1024 * 1024);
  if (unit === 'KB') return Math.round(n * 1024);
  return Math.round(n);
}

// Resuelve URLs relativas de Mercado Público
function resolveUrl(raw: string): string {
  if (raw.startsWith('http')) return raw;
  // El contexto de la página es /Procurement/Modules/RFB/
  // ../Attachment/X → /Procurement/Modules/Attachment/X
  if (raw.startsWith('../')) {
    return `https://www.mercadopublico.cl/Procurement/Modules/${raw.slice(3)}`;
  }
  if (raw.startsWith('/')) {
    return `https://www.mercadopublico.cl${raw}`;
  }
  return `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${raw}`;
}

// Scrape página de lista completa (ViewAttachmentLC.aspx)
async function scrapearListaDocumentos(
  url: string,
  documentosCacheados: any[]
): Promise<DocumentoExtraido[]> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const docs: DocumentoExtraido[] = [];

  // Tabla de anexos: puede tener 2–7+ columnas según la licitación
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    // Detectar nombre adaptivamente: priorizar celda con extensión de archivo
    let nombre = '';
    let sizeStr = '';

    cells.each((_, cell) => {
      const text = $(cell).text().trim();
      if (/\.(pdf|doc|docx|xlsx|xls|zip|rar|txt|jpg|png|ppt|pptx|xml|csv|odt)/i.test(text) && !nombre) {
        nombre = text;
      }
      if (/^\d[\d.,]*\s*(KB|MB|B)\b/i.test(text)) sizeStr = text;
    });

    // Fallback: celda con texto más largo >= 3 chars y no puramente numérica
    if (!nombre) {
      let maxLen = 0;
      cells.each((_, cell) => {
        const text = $(cell).text().trim();
        if (text.length > maxLen && text.length >= 3 && !/^\d+$/.test(text)) {
          maxLen = text.length;
          nombre = text;
        }
      });
    }

    if (!nombre || nombre.length < 3) return;

    // Extraer tipo / descripción / fecha de columnas opcionales
    const tipo  = cells.length >= 3 ? $(cells[2]).text().trim() : '';
    const desc  = cells.length >= 4 ? $(cells[3]).text().trim() : '';
    const fecha = cells.length >= 6 ? $(cells[5]).text().trim() : '';

    // Buscar URL de descarga en la fila
    let downloadUrl = '';
    $(row).find('a').each((_, a) => {
      if (downloadUrl) return;
      const href = $(a).attr('href') || '';
      if (href && !href.startsWith('javascript') &&
          (href.includes('Download') || href.includes('download') || href.includes('Attachment'))) {
        downloadUrl = href.startsWith('http') ? href
          : href.startsWith('/') ? `https://www.mercadopublico.cl${href}`
          : `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${href}`;
      }
    });
    if (!downloadUrl) {
      $(row).find('[onclick]').each((_, el) => {
        if (downloadUrl) return;
        const m = ($(el).attr('onclick') || '').match(/['"]([^'"]*(?:[Dd]ownload|[Aa]ttachment)[^'"]*)['"]/);
        if (m?.[1]) downloadUrl = m[1].startsWith('http') ? m[1]
          : `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${m[1]}`;
      });
    }

    const cached = documentosCacheados.find(d => d.documento_nombre === nombre);
    docs.push({
      nombre,
      url: downloadUrl || url,
      tipo:        tipo  || undefined,
      descripcion: desc  || undefined,
      size:        parseSizeStr(sizeStr),
      fecha:       fecha || undefined,
      ya_descargado: !!cached,
      url_local:   cached?.documento_url_local,
    });
  });

  // Fallback global: si tabla no dio nada, buscar todos los <a> con href de descarga
  if (docs.length === 0) {
    $('a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (!href || href.startsWith('javascript')) return;
      if (href.includes('Download') || href.includes('DownloadAttachment') || href.includes('GetAttachment')) {
        const text = $(a).text().trim() || `Documento_${docs.length + 1}`;
        const resolvedHref = href.startsWith('http') ? href
          : href.startsWith('/') ? `https://www.mercadopublico.cl${href}`
          : `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${href}`;
        docs.push({ nombre: text, url: resolvedHref });
      }
    });
  }

  return docs;
}

// Scrape ViewAttachment.aspx — puede ser individual o contener link/tabla de lista
async function scrapearViewAttachment(
  url: string,
  documentosCacheados: any[]
): Promise<DocumentoExtraido[]> {
  let html = '';
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn('⚠️ Error fetching ViewAttachment:', err);
    return [];
  }

  const $ = cheerio.load(html);

  // 1. Buscar si contiene un link a ViewAttachmentLC (lista completa)
  let listUrl: string | null = null;
  $('[href*="ViewAttachmentLC"], [onclick*="ViewAttachmentLC"]').each((_, el) => {
    if (listUrl) return;
    const href = $(el).attr('href') || '';
    const onclick = $(el).attr('onclick') || '';
    const src = href || onclick;
    const m = src.match(/ViewAttachmentLC\.aspx[^'")\s]*/i);
    if (m) listUrl = resolveUrl(m[0]);
  });

  if (listUrl) {
    console.log(`🔄 ViewAttachment → ViewAttachmentLC: ${listUrl}`);
    return scrapearListaDocumentos(listUrl, documentosCacheados);
  }

  // 2. Buscar tabla de documentos directamente en la página (misma estructura que LC)
  const docsEnTabla: DocumentoExtraido[] = [];
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    // Detectar nombre adaptivamente
    let nombre = '';
    let sizeStr = '';
    cells.each((_, cell) => {
      const text = $(cell).text().trim();
      if (/\.(pdf|doc|docx|xlsx|xls|zip|rar|txt|jpg|png|ppt|pptx|xml|csv|odt)/i.test(text) && !nombre) {
        nombre = text;
      }
      if (/^\d[\d.,]*\s*(KB|MB|B)\b/i.test(text)) sizeStr = text;
    });
    if (!nombre) {
      let maxLen = 0;
      cells.each((_, cell) => {
        const text = $(cell).text().trim();
        if (text.length > maxLen && text.length >= 3 && !/^\d+$/.test(text)) {
          maxLen = text.length; nombre = text;
        }
      });
    }
    if (!nombre || nombre.length < 3) return;

    const tipo  = cells.length >= 3 ? $(cells[2]).text().trim() : '';
    const desc  = cells.length >= 4 ? $(cells[3]).text().trim() : '';
    const fecha = cells.length >= 6 ? $(cells[5]).text().trim() : '';

    // Buscar link de descarga real en la fila
    let downloadUrl = '';
    $(row).find('a').each((_, a) => {
      if (downloadUrl) return;
      const href = $(a).attr('href') || '';
      if (href && !href.startsWith('javascript') &&
          (href.includes('Download') || href.includes('download') || href.includes('Attachment'))) {
        downloadUrl = href.startsWith('http') ? href
          : href.startsWith('/') ? `https://www.mercadopublico.cl${href}`
          : `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${href}`;
      }
    });

    const cached = documentosCacheados.find(d => d.documento_nombre === nombre);
    docsEnTabla.push({
      nombre,
      url: downloadUrl || url,
      tipo: tipo || undefined,
      descripcion: desc || undefined,
      size: parseSizeStr(sizeStr),
      fecha: fecha || undefined,
      ya_descargado: !!cached,
      url_local: cached?.documento_url_local,
    });
  });

  if (docsEnTabla.length > 0) {
    console.log(`📋 Tabla encontrada en ViewAttachment: ${docsEnTabla.length} docs`);
    return docsEnTabla;
  }

  // 3. Documento individual — extraer nombre del archivo de la página
  let nombre = 'Documento adjunto';
  let size: number | undefined;

  const candidatos = [
    $('span[id*="FileName"], span[id*="fileName"]').first().text().trim(),
    $('input[id*="FileName"], input[name*="FileName"]').first().val() as string || '',
    // Buscar cualquier texto que parezca un nombre de archivo
    ...($('td, span, label').toArray()
      .map(el => $(el).text().trim())
      .filter(t => /\.(pdf|docx?|xlsx?|zip|rar|dwg)$/i.test(t) && t.length < 300)),
  ].filter(t => t && t.length > 3);

  if (candidatos.length > 0) nombre = candidatos[0];

  const sizeMatch = html.match(/([\d.,]+)\s*KB/i);
  if (sizeMatch) size = parseSizeStr(`${sizeMatch[1]} KB`);

  const cached = documentosCacheados.find(d => d.documento_nombre === nombre);
  return [{
    nombre,
    url,
    tipo: 'Documento de licitación',
    size,
    ya_descargado: !!cached,
    url_local: cached?.documento_url_local,
  }];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  if (!codigo) {
    return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  }

  // 1. Documentos ya en caché
  let documentosCacheados: any[] = [];
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, size_bytes
       FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
      [codigo]
    );
    documentosCacheados = rows as any[];
    console.log(`📦 Encontrados ${documentosCacheados.length} documentos en caché`);
  } catch (dbError) {
    console.warn('⚠️ Error consultando caché:', dbError);
  }

  // 2. Paso 1: Scrape DetailsAcquisition.aspx → buscar link de adjuntos
  const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
  console.log(`🔍 Paso 1 - Ficha: ${fichaUrl}`);

  let adjuntoUrl: string | null = null;

  try {
    const res1 = await fetch(fichaUrl, { headers: HEADERS });
    if (res1.ok) {
      const html1 = await res1.text();
      const $1 = cheerio.load(html1);

      // Buscar primero ViewAttachmentLC (lista) y luego ViewAttachment (individual)
      const patterns = [
        /ViewAttachmentLC\.aspx[^'")\s]*/i,
        /ViewAttachment\.aspx[^'")\s]*/i,
      ];

      for (const pattern of patterns) {
        if (adjuntoUrl) break;

        // En atributos href
        $1('[href]').each((_, el) => {
          if (adjuntoUrl) return;
          const href = $1(el).attr('href') || '';
          const m = href.match(pattern);
          if (m) adjuntoUrl = resolveUrl(m[0]);
        });

        // En atributos onclick
        $1('[onclick]').each((_, el) => {
          if (adjuntoUrl) return;
          const onclick = $1(el).attr('onclick') || '';
          // Extraer URL del open('...') o window.open('...')
          const mOpen = onclick.match(/open\(\s*['"]([^'"]+)['"]/i);
          if (mOpen) {
            const m = mOpen[1].match(pattern);
            if (m) adjuntoUrl = resolveUrl(mOpen[1]);
          }
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ Error en paso 1:', err);
  }

  if (!adjuntoUrl) {
    console.warn(`⚠️ No se encontró link de adjuntos para ${codigo}`);
    // Devolver solo los cacheados si los hay
    return NextResponse.json({
      success: true,
      codigo,
      documentos: documentosCacheados.map(d => ({
        nombre: d.documento_nombre,
        url: d.documento_url_local,
        ya_descargado: true,
        url_local: d.documento_url_local,
        size: d.size_bytes,
      })),
      total: documentosCacheados.length,
      descargados_local: documentosCacheados.length,
    });
  }

  console.log(`🔗 Paso 2 - Adjuntos: ${adjuntoUrl}`);

  // 3. Paso 2: Scrape la página de adjuntos
  let documentosEncontrados: DocumentoExtraido[] = [];

  try {
    if ((adjuntoUrl as string).includes('ViewAttachmentLC')) {
      documentosEncontrados = await scrapearListaDocumentos(adjuntoUrl, documentosCacheados);
      console.log(`✅ ViewAttachmentLC: ${documentosEncontrados.length} documentos`);
    } else {
      // ViewAttachment.aspx embebe la URL real de ViewAttachmentLC en su JavaScript:
      //   window.location.href = 'ViewAttachmentLC.aspx?enc=...'
      // La extraemos con regex — no necesitamos resolver el reCAPTCHA Enterprise.
      try {
        const resVA = await fetch(adjuntoUrl, { headers: HEADERS });
        if (resVA.ok) {
          const htmlVA = await resVA.text();
          const lcMatch = htmlVA.match(/window\.location\.href\s*=\s*'(ViewAttachmentLC\.aspx[^']+)'/);
          if (lcMatch) {
            const lcUrl = `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${lcMatch[1]}`;
            console.log(`🔗 ViewAttachmentLC desde JS: ${lcUrl.slice(0, 80)}...`);
            const lcDocs = await scrapearListaDocumentos(lcUrl, documentosCacheados);
            if (lcDocs.length > 0) {
              documentosEncontrados = lcDocs;
              // Devolver la URL de ViewAttachmentLC (ya tiene el enc correcto)
              adjuntoUrl = lcUrl;
              console.log(`✅ ViewAttachmentLC (desde JS): ${lcDocs.length} documentos`);
            }
          }
        }
      } catch (err) {
        console.warn('⚠️ Error extrayendo ViewAttachmentLC del JS:', err);
      }

      // Fallback si no se encontró nada aún
      if (documentosEncontrados.length === 0) {
        documentosEncontrados = await scrapearViewAttachment(adjuntoUrl, documentosCacheados);
        console.log(`✅ ViewAttachment fallback: ${documentosEncontrados.length} documento(s)`);
      }
    }
  } catch (err) {
    console.warn('⚠️ Error en paso 2:', err);
  }

  // Fallback: si no se encontraron docs nuevos, devolver cacheados
  if (documentosEncontrados.length === 0 && documentosCacheados.length > 0) {
    return NextResponse.json({
      success: true,
      codigo,
      documentos: documentosCacheados.map(d => ({
        nombre: d.documento_nombre,
        url: d.documento_url_local,
        ya_descargado: true,
        url_local: d.documento_url_local,
        size: d.size_bytes,
      })),
      total: documentosCacheados.length,
      descargados_local: documentosCacheados.length,
    });
  }

  return NextResponse.json({
    success: true,
    codigo,
    documentos: documentosEncontrados,
    total: documentosEncontrados.length,
    descargados_local: documentosEncontrados.filter(d => d.ya_descargado).length,
    url_adjuntos_mp: adjuntoUrl,   // URL del popup de MP (para abrir directamente en el browser)
  });
}
