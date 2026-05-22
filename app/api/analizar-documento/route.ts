// src/app/api/analizar-documento/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { pdfUrl, pregunta, documentoNombre } = await request.json();

    if (!pdfUrl) {
      return NextResponse.json({ error: 'Se requiere la URL del PDF' }, { status: 400 });
    }

    // Paso 1: Descargar el PDF a través del proxy
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(pdfUrl)}`;
    const pdfResponse = await fetch(proxyUrl);
    
    if (!pdfResponse.ok) {
      return NextResponse.json({ error: 'Error al descargar el PDF' }, { status: 500 });
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    
    // Paso 2: Extraer el texto del PDF (importación dinámica sin tipos)
    let textoExtraido = "";
    let numPages = 0;
    
    try {
      // @ts-ignore - Ignorar error de tipos de pdf-parse
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(Buffer.from(pdfBuffer));
      textoExtraido = pdfData.text;
      numPages = pdfData.numpages;
    } catch (parseError) {
      console.error("Error al parsear PDF:", parseError);
      return NextResponse.json({ 
        error: 'No se pudo extraer el texto del PDF. El archivo podría estar protegido o ser una imagen escaneada.' 
      }, { status: 500 });
    }
    
    if (!textoExtraido || textoExtraido.trim().length === 0) {
      return NextResponse.json({ error: 'No se pudo extraer texto del PDF' }, { status: 500 });
    }

    // Paso 3: Si no hay pregunta específica, devolver el texto extraído
    if (!pregunta) {
      return NextResponse.json({
        success: true,
        texto: textoExtraido.substring(0, 5000),
        paginas: numPages,
        documento: documentoNombre,
      });
    }

    // Paso 4: Analizar con IA si hay una pregunta
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente especializado en analizar documentos de licitaciones públicas de Chile. 
          Tu tarea es responder preguntas basándote EXCLUSIVAMENTE en el contenido del documento que se te proporciona.
          Responde de manera clara, precisa y útil para un proveedor que quiere participar en la licitación.
          Si la información no está en el documento, di claramente que no se encuentra en el documento.`,
        },
        {
          role: 'user',
          content: `Documento: ${documentoNombre}\n\nContenido del documento:\n${textoExtraido.substring(0, 8000)}\n\nPregunta: ${pregunta}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const respuesta = completion.choices[0]?.message?.content || 'No se pudo generar una respuesta';

    return NextResponse.json({
      success: true,
      pregunta,
      respuesta,
      documento: documentoNombre,
      paginas: numPages,
    });
  } catch (error) {
    console.error('Error al analizar documento:', error);
    return NextResponse.json({ error: 'Error al procesar el documento: ' + String(error) }, { status: 500 });
  }
}