// src/app/api/licitacion-completa/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { puedeVerLicitacion } from '@/app/lib/api-auth';

// IMPORTANTE: En Next.js App Router, los parámetros vienen en el segundo argumento
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  // Esperar a que params esté disponible (Next.js 15+ requiere await)
  const { codigo } = await params;

  if (!codigo) {
    return NextResponse.json({ error: 'Código de licitación no proporcionado' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, decodeURIComponent(codigo))))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    // 1. Construir la URL de la ficha en Mercado Público
    const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${codigo}`;
    console.log(`🔍 Scrapeando ficha: ${fichaUrl}`);

    // 2. Obtener el HTML de la ficha
    const response = await fetch(fichaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Error al obtener la ficha: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 3. Extraer los enlaces de los documentos adjuntos
    const documentos: { nombre: string; url: string }[] = [];
    
    // Buscar todos los enlaces que contengan 'ViewAttachmentLC.aspx'
    $('a[href*="ViewAttachmentLC.aspx"]').each((i, element) => {
      let href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (href && href.includes('enc=')) {
        // Asegurar que la URL sea completa
        if (!href.startsWith('http')) {
          href = `https://www.mercadopublico.cl${href.startsWith('/') ? '' : '/'}${href}`;
        }
        documentos.push({
          nombre: text || `Documento_${i+1}.pdf`,
          url: href,
        });
      }
    });

    // También buscar enlaces que puedan ser botones de descarga
    $('a[href*="DownloadAttachment"]').each((i, element) => {
      let href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (href) {
        if (!href.startsWith('http')) {
          href = `https://www.mercadopublico.cl${href.startsWith('/') ? '' : '/'}${href}`;
        }
        documentos.push({
          nombre: text || `Anexo_${i+1}.pdf`,
          url: href,
        });
      }
    });

    console.log(`✅ Encontrados ${documentos.length} documentos adjuntos.`);

    // 4. Extraer información de las tablas de la ficha
    const objeto = $('#ctl00_phBase_phBase_lblObjeto').text().trim() || 
                   $('td:contains("Objeto")').next().text().trim() ||
                   $('div:contains("Objeto de la licitación")').next().text().trim();
    
    const descripcion = $('#ctl00_phBase_phBase_lblDescripcion').text().trim() ||
                        $('td:contains("Descripción")').next().text().trim();
    
    const organismo = $('#ctl00_phBase_phBase_lblOrganismo').text().trim() ||
                      $('td:contains("Organismo")').next().text().trim() ||
                      $('td:contains("Razón social")').next().text().trim();
    
    const rut = $('#ctl00_phBase_phBase_lblRut').text().trim() ||
                $('td:contains("R.U.T.")').next().text().trim();
    
    const direccion = $('#ctl00_phBase_phBase_lblDireccion').text().trim() ||
                      $('td:contains("Dirección")').next().text().trim();
    
    const comuna = $('#ctl00_phBase_phBase_lblComuna').text().trim() ||
                   $('td:contains("Comuna")').next().text().trim();
    
    const region = $('#ctl00_phBase_phBase_lblRegion').text().trim() ||
                   $('td:contains("Región")').next().text().trim();
    
    // Extraer fechas
    let fechaCierre = '';
    let fechaPublicacion = '';
    
    $('tr').each((i, row) => {
      const text = $(row).text();
      if (text.includes('Fecha de cierre')) {
        fechaCierre = $(row).find('td').last().text().trim();
      }
      if (text.includes('Fecha de Publicación')) {
        fechaPublicacion = $(row).find('td').last().text().trim();
      }
    });

    // 5. Combinar la información
    const resultado = {
      success: true,
      codigo,
      objeto,
      descripcion,
      organismo,
      rut,
      direccion,
      comuna,
      region,
      fecha_cierre: fechaCierre,
      fecha_publicacion: fechaPublicacion,
      documentos,
      total_documentos: documentos.length,
    };

    return NextResponse.json(resultado);
    
  } catch (error) {
    console.error(`❌ Error en scraping de licitación ${codigo}:`, error);
    return NextResponse.json({ 
      error: 'Error al obtener los datos completos de la licitación',
      details: String(error)
    }, { status: 500 });
  }
}