import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// DeepSeek usa la SDK de OpenAI con baseURL diferente
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export async function POST(request: NextRequest) {
  try {
    const { pdfUrl, pregunta, documentoNombre } = await request.json();

    if (!pdfUrl) {
      return NextResponse.json({ error: 'Se requiere la URL del PDF' }, { status: 400 });
    }

    // URLs de nuestro R2 se descargan directamente; otras van por el proxy
    let fetchUrl: string;
    const esUrlPropia = pdfUrl.includes('.r2.dev') || pdfUrl.includes(process.env.R2_ACCOUNT_ID || '__no__');
    if (esUrlPropia) {
      fetchUrl = pdfUrl;
    } else {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      fetchUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(pdfUrl)}`;
    }

    const pdfResponse = await fetch(fetchUrl);
    if (!pdfResponse.ok) {
      return NextResponse.json(
        { error: `Error al descargar el archivo (HTTP ${pdfResponse.status}). Verifica que el bucket R2 tenga acceso público habilitado.` },
        { status: 500 }
      );
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();

    let textoExtraido = '';
    let numPages = 0;

    const ext = (pdfUrl.split('?')[0].split('.').pop() || '').toLowerCase();
    const buffer = Buffer.from(pdfBuffer);

    try {
      if (ext === 'docx' || ext === 'doc') {
        // @ts-ignore
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        textoExtraido = result.value || '';
        numPages = 1;
      } else {
        // PDF por defecto
        // @ts-ignore
        const pdfParse = (await import('pdf-parse')).default;
        const pdfData = await pdfParse(buffer);
        textoExtraido = pdfData.text;
        numPages = pdfData.numpages;
      }
    } catch (parseError) {
      console.error('Error extrayendo texto:', parseError);
      return NextResponse.json(
        { error: `No se pudo extraer el texto del archivo ${ext.toUpperCase()}. Puede estar protegido o ser una imagen escaneada.` },
        { status: 500 }
      );
    }

    if (!textoExtraido || textoExtraido.trim().length === 0) {
      return NextResponse.json({ error: 'No se pudo extraer texto del PDF' }, { status: 500 });
    }

    if (!pregunta) {
      return NextResponse.json({
        success: true,
        texto: textoExtraido.substring(0, 5000),
        paginas: numPages,
        documento: documentoNombre,
      });
    }

    const completion = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente especializado en licitaciones públicas de Chile (Mercado Público / ChileCompra).
Analiza documentos de licitación y responde preguntas basándote EXCLUSIVAMENTE en el contenido proporcionado.
Responde en español de manera clara y útil para un proveedor que quiere participar en la licitación.
Si la información no está en el documento, indícalo explícitamente.`,
        },
        {
          role: 'user',
          content: `Documento: ${documentoNombre}\n\nContenido:\n${textoExtraido.substring(0, 10000)}\n\nPregunta: ${pregunta}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const respuesta = completion.choices[0]?.message?.content || 'No se pudo generar respuesta';

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
