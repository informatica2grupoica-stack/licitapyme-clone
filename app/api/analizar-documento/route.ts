import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// ======================================================
// TIPOS
// ======================================================

interface AnalisisEstructurado {
  criteriosEvaluacion?: CriterioEvaluacion[];
  plazos?: Plazo[];
  requisitos?: string[];
  garantias?: Garantia[];
  multas?: Multa[];
  formulaPuntajeFinal?: string;
  modalidadContrato?: string;
  presupuestoDisponible?: number;
  moneda?: string;
  fechasClave?: Record<string, string>;
  documentosRequeridos?: string[];
  causalesRechazo?: string[];
  puntajesEvaluacion?: Record<string, number>;
}

interface CriterioEvaluacion {
  nombre: string;
  ponderacion: number;
  subcriterios?: Subcriterio[];
  formula?: string;
}

interface Subcriterio {
  nombre: string;
  condiciones?: CondicionPuntaje[];
  puntajeMaximo?: number;
}

interface CondicionPuntaje {
  condicion: string;
  puntaje: number;
}

interface Plazo {
  etapa: string;
  plazoDias?: number;
  fechaReferencia?: string;
  fechaExacta?: string;
}

interface Garantia {
  tipo: string;
  porcentaje?: number;
  montoMaximo?: number;
  momento: string;
}

interface Multa {
  concepto: string;
  valor: string;
  limiteMaximo?: string;
}

// ======================================================
// FUNCIONES AUXILIARES
// ======================================================

function getDeepSeek() {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? 'not-configured',
    baseURL: 'https://api.deepseek.com',
  });
}

async function extractTextFromDocument(pdfUrl: string, buffer: Buffer, ext: string): Promise<{ texto: string; numPages: number }> {
  try {
    if (ext === 'docx' || ext === 'doc') {
      // @ts-ignore
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { texto: result.value || '', numPages: 1 };
    } else if (ext === 'xlsx' || ext === 'xls') {
      // @ts-ignore
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let textoCompleto = '';
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        textoCompleto += `\n--- Hoja: ${sheetName} ---\n${csv}\n`;
      });
      return { texto: textoCompleto, numPages: workbook.SheetNames.length };
    } else {
      // PDF por defecto
      // @ts-ignore
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      return { texto: pdfData.text, numPages: pdfData.numpages };
    }
  } catch (error) {
    console.error('Error en extractTextFromDocument:', error);
    throw error;
  }
}

async function analizarConDeepSeek(
  texto: string,
  documentoNombre: string,
  modo: 'pregunta' | 'extraer_estructura' | 'comparar' | 'resumen_ejecutivo',
  pregunta?: string
): Promise<any> {
  const systemPrompt = `Eres un asistente experto en licitaciones públicas de Chile (Mercado Público / ChileCompra).
Tu especialidad es analizar documentos de licitación y extraer información precisa, estructurada y útil para proveedores.
Características:
- Te basas EXCLUSIVAMENTE en el contenido proporcionado, NUNCA inventas información.
- Si algo no está en el documento, lo indicas explícitamente.
- Respondes en español, de manera clara, profesional y accionable.
- Cuando entregas listas, usas formato estructurado (viñetas, tablas, JSON según corresponda).
- Para datos numéricos (fechas, montos, porcentajes), los extraes con precisión.
- Si el documento tiene ambigüedades, las señalas y ofreces interpretaciones posibles.`;

  let userPrompt = '';
  let temperature = 0.3;
  let maxTokens = 2000;

  switch (modo) {
    case 'pregunta':
      userPrompt = `Documento: ${documentoNombre}\n\nContenido:\n${texto.substring(0, 12000)}\n\nPregunta del usuario: ${pregunta}\n\nResponde de manera clara, directa y útil. Si la pregunta requiere datos estructurados (tablas, listas), entrégalos así.`;
      break;

    case 'resumen_ejecutivo':
      userPrompt = `Documento: ${documentoNombre}\n\nContenido:\n${texto.substring(0, 15000)}\n\nGenera un RESUMEN EJECUTIVO de este documento de licitación que incluya:
1. **Objeto del contrato** (qué se quiere comprar/contratar)
2. **Presupuesto disponible** (monto total y moneda)
3. **Fechas clave** (publicación, cierre, adjudicación estimada)
4. **Requisitos principales** para participar
5. **Criterios de evaluación** (qué ponderan)
6. **Plazo de ejecución** del contrato
7. **Garantías requeridas** (tipos y montos)
8. **Riesgos o puntos críticos** que el proveedor debe considerar

Formato: Usa negritas para los títulos, viñetas para listas, y un lenguaje claro y profesional.`;
      maxTokens = 2500;
      break;

    case 'extraer_estructura':
      userPrompt = `Documento: ${documentoNombre}\n\nContenido:\n${texto.substring(0, 15000)}\n\nExtrae TODA la información estructurada de esta licitación y devuélvela EXCLUSIVAMENTE como un objeto JSON válido, sin texto adicional fuera del JSON.

El JSON debe tener esta estructura EXACTA (todos los campos son opcionales, solo incluye los que encuentres):

{
  "criteriosEvaluacion": [
    {
      "nombre": "Propuesta técnica",
      "ponderacion": 40,
      "subcriterios": [
        {
          "nombre": "Mejora técnica",
          "condiciones": [
            { "condicion": "Banco ≥ 9.6 kWh", "puntaje": 100 },
            { "condicion": "Banco ≥ 7.2 kWh", "puntaje": 60 }
          ]
        }
      ]
    }
  ],
  "plazos": [
    { "etapa": "Cierre de ofertas", "plazoDias": 30, "fechaReferencia": "desde publicación" }
  ],
  "requisitos": ["Registro en mercadopublico.cl", "Declaración jurada"],
  "garantias": [
    { "tipo": "Fiel cumplimiento", "porcentaje": 5, "momento": "antes de la firma" }
  ],
  "multas": [
    { "concepto": "Atraso en hitos", "valor": "2 UTM/día", "limiteMaximo": "3% del contrato" }
  ],
  "formulaPuntajeFinal": "0.4 * PT + 0.35 * EX + 0.2 * PE + 0.03 * PF + 0.02 * PI",
  "modalidadContrato": "Suma alzada",
  "presupuestoDisponible": 302509780,
  "moneda": "CLP",
  "fechasClave": {
    "publicacion": "2024-01-15",
    "cierreOfertas": "2024-02-15"
  },
  "documentosRequeridos": ["Anexo 1", "Anexo 2", "Propuesta económica"],
  "causalesRechazo": ["No cumplir requisitos mínimos", "Oferta temeraria"],
  "puntajesEvaluacion": {
    "puntajeMaximoTotal": 100,
    "puntajeMinimoAprobatorio": 60
  }
}

REGLAS IMPORTANTES:
- Las ponderaciones deben ser números (ej: 40, no "40%")
- Las fechas en formato ISO (YYYY-MM-DD) si están explícitas
- Los montos como números sin puntos ni comas
- Si no encuentras un campo, omítelo del JSON
- Para condiciones complejas, copia el texto exacto relevante
- Si hay fórmulas matemáticas, extráelas como texto exacto`;
      temperature = 0.1;
      maxTokens = 4000;
      break;

    case 'comparar':
      userPrompt = `Documento: ${documentoNombre}\n\nContenido:\n${texto.substring(0, 12000)}\n\nAnaliza este documento y compáralo con una licitación típica del mismo rubro. Identifica:\n1. **Cláusulas inusuales o riesgosas** que no son estándar\n2. **Requisitos particularmente exigentes**\n3. **Plazos muy ajustados** (menos de lo normal)\n4. **Ponderaciones desbalanceadas** (ej: mucha ponderación en precio vs técnica)\n5. **Recomendaciones específicas** para el proveedor\n\nSé crítico y útil. Si todo es estándar, indícalo.`;
      maxTokens = 2500;
      break;
  }

  const completion = await getDeepSeek().chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature,
    max_tokens: maxTokens,
  });

  const respuesta = completion.choices[0]?.message?.content || 'No se pudo generar respuesta';
  
  // Si es modo estructura, intentar parsear JSON
  if (modo === 'extraer_estructura') {
    try {
      // Limpiar markdown code blocks si los hubiera
      let cleanResponse = respuesta;
      const jsonMatch = respuesta.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[1];
      }
      return JSON.parse(cleanResponse);
    } catch (e) {
      console.error('Error parseando JSON:', e);
      return { error: 'No se pudo parsear la respuesta estructurada', raw: respuesta };
    }
  }
  
  return respuesta;
}

// ======================================================
// ENDPOINT PRINCIPAL
// ======================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      pdfUrl, 
      pregunta, 
      documentoNombre, 
      modo = 'pregunta',
      extraerTodo = false 
    } = body;

    // Validaciones iniciales
    if (!pdfUrl) {
      return NextResponse.json({ error: 'Se requiere la URL del PDF' }, { status: 400 });
    }

    // Detectar tipo de archivo por extensión
    const urlSinQuery = pdfUrl.split('?')[0];
    const extension = (urlSinQuery.split('.').pop() || '').toLowerCase();
    const formatosPermitidos = ['pdf', 'docx', 'doc', 'xlsx', 'xls'];
    
    if (!formatosPermitidos.includes(extension)) {
      return NextResponse.json(
        { error: `Formato no soportado: ${extension}. Formatos permitidos: ${formatosPermitidos.join(', ')}` },
        { status: 400 }
      );
    }

    // Descargar el documento
    let fetchUrl: string;
    const esUrlPropia = pdfUrl.includes('.r2.dev') || pdfUrl.includes(process.env.R2_ACCOUNT_ID || '__no__');
    
    if (esUrlPropia) {
      fetchUrl = pdfUrl;
    } else {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      fetchUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(pdfUrl)}`;
    }

    const pdfResponse = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LicitapymeBot/1.0)'
      }
    });

    if (!pdfResponse.ok) {
      return NextResponse.json(
        { error: `Error al descargar el archivo (HTTP ${pdfResponse.status}). Verifica que el archivo sea accesible públicamente.` },
        { status: 500 }
      );
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    const buffer = Buffer.from(pdfBuffer);
    
    // Validar que el archivo no esté vacío
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'El archivo está vacío o no se pudo descargar correctamente' }, { status: 500 });
    }

    // Extraer texto según el tipo de archivo
    let textoExtraido = '';
    let numPages = 0;
    
    try {
      const result = await extractTextFromDocument(pdfUrl, buffer, extension);
      textoExtraido = result.texto;
      numPages = result.numPages;
    } catch (parseError) {
      console.error('Error extrayendo texto:', parseError);
      return NextResponse.json(
        { error: `No se pudo extraer el texto del archivo ${extension.toUpperCase()}. Puede estar protegido, ser una imagen escaneada o estar corrupto.` },
        { status: 500 }
      );
    }

    // Validar que se extrajo texto
    if (!textoExtraido || textoExtraido.trim().length === 0) {
      return NextResponse.json({ 
        error: 'No se pudo extraer texto del documento. El archivo podría ser una imagen escaneada o estar protegido contra copia.',
        sugerencia: 'Si es un PDF escaneado, deberás usar un servicio de OCR antes de analizarlo.'
      }, { status: 500 });
    }

    // Limpiar y normalizar el texto (remover múltiples espacios, saltos de línea excesivos)
    textoExtraido = textoExtraido
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // Si no hay pregunta y no es modo especial, devolver el texto extraído
    if (!pregunta && modo === 'pregunta') {
      return NextResponse.json({
        success: true,
        texto: textoExtraido.substring(0, 5000),
        paginas: numPages,
        documento: documentoNombre,
        extension,
        tamaño_bytes: buffer.length,
      });
    }

    // ======================================================
    // ANÁLISIS CON IA SEGÚN EL MODO
    // ======================================================
    
    let respuesta;

    // Si extraerTodo es true, hacer múltiples análisis en paralelo
    if (extraerTodo) {
      const [resumen, estructura, riesgos] = await Promise.all([
        analizarConDeepSeek(textoExtraido, documentoNombre, 'resumen_ejecutivo'),
        analizarConDeepSeek(textoExtraido, documentoNombre, 'extraer_estructura'),
        analizarConDeepSeek(textoExtraido, documentoNombre, 'comparar')
      ]);
      
      respuesta = {
        resumenEjecutivo: resumen,
        datosEstructurados: estructura,
        analisisRiesgos: riesgos
      };
    } else {
      // Análisis simple según el modo
      switch (modo) {
        case 'resumen_ejecutivo':
          respuesta = await analizarConDeepSeek(textoExtraido, documentoNombre, 'resumen_ejecutivo');
          break;
        case 'extraer_estructura':
          respuesta = await analizarConDeepSeek(textoExtraido, documentoNombre, 'extraer_estructura');
          break;
        case 'comparar':
          respuesta = await analizarConDeepSeek(textoExtraido, documentoNombre, 'comparar');
          break;
        case 'pregunta':
        default:
          if (!pregunta) {
            return NextResponse.json({ error: 'Se requiere una pregunta para el modo análisis' }, { status: 400 });
          }
          respuesta = await analizarConDeepSeek(textoExtraido, documentoNombre, 'pregunta', pregunta);
          break;
      }
    }

    // Respuesta exitosa
    return NextResponse.json({
      success: true,
      modo,
      documento: documentoNombre,
      paginas: numPages,
      extension,
      tamaño_bytes: buffer.length,
      ...(modo === 'pregunta' && { pregunta, respuesta }),
      ...(modo === 'extraer_estructura' && { datos: respuesta }),
      ...(modo === 'resumen_ejecutivo' && { resumen: respuesta }),
      ...(modo === 'comparar' && { analisis: respuesta }),
      ...(extraerTodo && { analisisCompleto: respuesta })
    });

  } catch (error) {
    console.error('Error al analizar documento:', error);
    return NextResponse.json({ 
      error: 'Error al procesar el documento: ' + String(error),
      sugerencia: 'Verifica que el archivo sea válido y accesible.'
    }, { status: 500 });
  }
}