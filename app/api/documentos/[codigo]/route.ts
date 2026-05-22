// src/app/api/documentos/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

interface DocumentoExtraido {
  nombre: string;
  url: string;
  tipo?: string;
  size?: string;
  fecha?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { codigo: string } }
) {
  const { codigo } = await params;
  
  if (!codigo) {
    return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  }

  try {
    // 1. Obtener la página de la licitación
    const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${codigo}`;
    console.log(`🔍 Buscando documentos en: ${fichaUrl}`);
    
    const response = await fetch(fichaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`Error al obtener la ficha: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const documentos: DocumentoExtraido[] = [];

    // 2. Buscar el botón de adjuntos principal (imgAdjuntos)
    $('input[type="image"]').each((i, el) => {
      const onclick = $(el).attr('onclick');
      const src = $(el).attr('src');
      const alt = $(el).attr('alt') || $(el).attr('title') || '';
      
      // Buscar el botón de adjuntos (ic-21.png)
      if (src && src.includes('ic-21.png') && onclick) {
        // Extraer la URL enc de la función open()
        const encMatch = onclick.match(/open\('([^']+)'/);
        if (encMatch && encMatch[1]) {
          let url = encMatch[1];
          // Asegurar URL completa
          if (url.startsWith('../')) {
            url = `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${url.replace('../', '')}`;
          } else if (url.startsWith('/')) {
            url = `https://www.mercadopublico.cl${url}`;
          }
          
          documentos.push({
            nombre: 'Documentos de la licitación',
            url: url,
            tipo: 'link',
          });
        }
      }
    });

    // 3. Buscar enlaces directos a ViewAttachmentLC.aspx
    $('a[href*="ViewAttachmentLC.aspx"]').each((i, el) => {
      let href = $(el).attr('href');
      const text = $(el).text().trim();
      
      if (href && href.includes('enc=')) {
        if (href.startsWith('../')) {
          href = `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${href.replace('../', '')}`;
        } else if (href.startsWith('/')) {
          href = `https://www.mercadopublico.cl${href}`;
        }
        
        documentos.push({
          nombre: text || `Documento ${documentos.length + 1}`,
          url: href,
          tipo: 'directo',
        });
      }
    });

    // 4. Buscar enlaces de descarga en la tabla de anexos
    $('a[href*="ViewAttachment.aspx"]').each((i, el) => {
      let href = $(el).attr('href');
      const text = $(el).text().trim();
      const parentRow = $(el).closest('tr');
      
      if (href && href.includes('enc=')) {
        if (href.startsWith('../')) {
          href = `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${href.replace('../', '')}`;
        } else if (href.startsWith('/')) {
          href = `https://www.mercadopublico.cl${href}`;
        }
        
        // Intentar obtener nombre del archivo de la fila
        let nombre = text;
        if (!nombre && parentRow.length) {
          const fileCell = parentRow.find('td').eq(1);
          nombre = fileCell.text().trim();
        }
        
        documentos.push({
          nombre: nombre || `Anexo ${documentos.length + 1}`,
          url: href,
          tipo: 'anexo',
        });
      }
    });

    // 5. Limpiar duplicados
    const uniqueDocs = documentos.filter((doc, index, self) => 
      index === self.findIndex(d => d.url === doc.url)
    );

    console.log(`✅ Encontrados ${uniqueDocs.length} documentos para ${codigo}`);

    return NextResponse.json({
      success: true,
      codigo,
      documentos: uniqueDocs,
      total: uniqueDocs.length,
    });

  } catch (error) {
    console.error(`❌ Error extrayendo documentos para ${codigo}:`, error);
    return NextResponse.json({ 
      error: 'Error al obtener documentos',
      detalles: String(error)
    }, { status: 500 });
  }
}