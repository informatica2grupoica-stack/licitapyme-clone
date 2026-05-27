// app/api/analizar-documento/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// ======================================================
// TIPOS - DEFINICIONES COMPLETAS Y FLEXIBLES
// ======================================================

interface LicitacionAnalisis {
  metadata: {
    documentoNombre: string;
    fechaAnalisis: string;
    paginas: number;
    tamanioBytes: number;
    confianza: 'alta' | 'media' | 'baja';
    metodoExtraccion: string;
  };
  informacionGeneral: {
    objetoContrato?: string;
    tipoLicitacion?: string;
    modalidadContrato?: string;
    codigoLicitacion?: string;
    organismoComprador?: string;
    region?: string;
    comuna?: string;
  };
  aspectosEconomicos: {
    presupuestoDisponible?: { monto: number; moneda: string; fuente?: string };
    montoEstimado?: number;
    tipoMoneda?: string;
    sistemaPrecios?: string;
    reajuste?: boolean;
  };
  plazos: {
    publicacion?: string;
    cierreOfertas?: string;
    aperturaTecnica?: string;
    aperturaEconomica?: string;
    adjudicacionEstimada?: string;
    plazoEjecucionDias?: number;
    otrosPlazos?: Array<{ nombre: string; fecha?: string; plazoDias?: number }>;
  };
  requisitos: {
    administrativos: string[];
    tecnicos: string[];
    economicos: string[];
    habilitantes: string[];
    prohibiciones: string[];
  };
  criteriosEvaluacion: Array<{
    nombre: string;
    ponderacion: number;
    tipo: 'tecnico' | 'economico' | 'experiencia' | 'otros';
    subcriterios?: Array<{
      nombre: string;
      descripcion: string;
      puntajeMaximo?: number;
      condiciones?: Array<{ condicion: string; puntaje: number }>;
    }>;
    formula?: string;
  }>;
  garantias: Array<{
    tipo: string;
    porcentaje?: number;
    montoFijo?: number;
    momento: string;
    devolucion?: string;
    caracteristicas?: string;
  }>;
  multas: Array<{
    concepto: string;
    valor: string;
    unidad: 'UTM' | 'UF' | 'pesos' | 'porcentaje';
    limiteMaximo?: string;
  }>;
  documentosRequeridos: Array<{ nombre: string; formato?: string; obligatorio: boolean }>;
  subcontratacion: { permitida: boolean; porcentajeMaximo?: number; requisitos?: string };
  causalesRechazo: string[];
  analisisExperto: {
    puntosCriticos: string[];
    oportunidades: string[];
    riesgosDetectados: string[];
    recomendaciones: string[];
    complejidad: 'baja' | 'media' | 'alta';
    atractivo: 'bajo' | 'medio' | 'alto';
  };
}

// ======================================================
// CONFIGURACIÓN
// ======================================================

function getDeepSeek() {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? 'not-configured',
    baseURL: 'https://api.deepseek.com',
  });
}

// ======================================================
// OCR CON OCR.SPACE (GRATUITO - 500 REQUESTS/MES)
// ======================================================

async function extraerConOCRSpace(buffer: Buffer, fileName: string): Promise<{ texto: string; confianza: string }> {
  console.log('🔄 Enviando a OCR.space para reconocimiento...');
  
  const base64 = buffer.toString('base64');
  
  const formData = new FormData();
  formData.append('base64Image', `data:application/pdf;base64,${base64}`);
  formData.append('language', 'spa');
  formData.append('OCREngine', '2');
  formData.append('isCreateSearchablePdf', 'false');
  formData.append('isSearchablePdfHideTextLayer', 'true');
  
  try {
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'apikey': 'helloworld', // API key gratuita pública
      },
      body: formData,
    });
    
    const data = await response.json();
    
    if (data.IsErroredOnProcessing) {
      console.error('Error OCR.space:', data.ErrorMessage);
      throw new Error(data.ErrorMessage?.[0] || 'Error en OCR');
    }
    
    const texto = data.ParsedResults?.[0]?.ParsedText || '';
    const confianza = data.ParsedResults?.[0]?.FileParseExitCode === 1 ? 'alta' : 'media';
    
    console.log(`✅ OCR completado: ${texto.length} caracteres, confianza: ${confianza}`);
    return { texto, confianza };
    
  } catch (error) {
    console.error('Error en OCR.space:', error);
    throw new Error(`OCR falló: ${error instanceof Error ? error.message : 'desconocido'}`);
  }
}

// ======================================================
// EXTRACCIÓN DE TEXTO CON DETECCIÓN INTELIGENTE
// ======================================================

async function extractTextFromDocument(buffer: Buffer, extension: string, fileName: string): Promise<{ texto: string; numPages: number; metodo: string; confianza: string }> {
  
  // WORD (DOCX/DOC)
  if (extension === 'docx' || extension === 'doc') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      const texto = result.value || '';
      console.log(`✅ Word: ${texto.length} caracteres extraídos`);
      return { texto, numPages: 1, metodo: 'word', confianza: 'alta' };
    } catch (error) {
      console.error('Error en Word:', error);
      return { texto: '', numPages: 1, metodo: 'word-error', confianza: 'baja' };
    }
  }
  
  // EXCEL (XLSX/XLS)
  if (extension === 'xlsx' || extension === 'xls') {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let textoCompleto = '';
      workbook.SheetNames.forEach((sheetName: string) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        textoCompleto += `\n--- Hoja: ${sheetName} ---\n${csv}\n`;
      });
      console.log(`✅ Excel: ${textoCompleto.length} caracteres de ${workbook.SheetNames.length} hojas`);
      return { texto: textoCompleto, numPages: workbook.SheetNames.length, metodo: 'excel', confianza: 'alta' };
    } catch (error) {
      console.error('Error en Excel:', error);
      return { texto: '', numPages: 1, metodo: 'excel-error', confianza: 'baja' };
    }
  }
  
  // PDF
  if (extension === 'pdf') {
    try {
      // Paso 1: Intentar extraer texto normal
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      
      // Si tiene suficiente texto (más de 300 caracteres)
      if (pdfData.text && pdfData.text.trim().length > 300) {
        console.log(`✅ PDF con texto: ${pdfData.text.length} caracteres, ${pdfData.numpages} páginas`);
        return { 
          texto: pdfData.text, 
          numPages: pdfData.numpages, 
          metodo: 'pdf-text', 
          confianza: 'alta' 
        };
      }
      
      // Paso 2: Si tiene poco texto, intentar OCR
      console.log(`⚠️ PDF con poco texto (${pdfData.text?.length || 0} caracteres). Usando OCR...`);
      const { texto: textoOCR, confianza } = await extraerConOCRSpace(buffer, fileName);
      
      if (textoOCR && textoOCR.trim().length > 50) {
        return { 
          texto: textoOCR, 
          numPages: pdfData.numpages, 
          metodo: 'pdf-ocr', 
          confianza 
        };
      }
      
      // Paso 3: Si todo falla, devolver lo que hay
      return { 
        texto: pdfData.text || '', 
        numPages: pdfData.numpages, 
        metodo: 'pdf-sin-texto', 
        confianza: 'baja' 
      };
      
    } catch (error) {
      console.error('Error en PDF:', error);
      return { texto: '', numPages: 0, metodo: 'pdf-error', confianza: 'baja' };
    }
  }
  
  return { texto: '', numPages: 0, metodo: 'unsupported', confianza: 'baja' };
}

// ======================================================
// ANÁLISIS CON DEEPSEEK (VERSIÓN MEJORADA)
// ======================================================

async function analizarConDeepSeekExperto(
  texto: string,
  documentoNombre: string,
  tipoAnalisis: 'completo' | 'pregunta' | 'resumen',
  metadatos: { metodo: string; confianza: string; paginas: number },
  pregunta?: string
): Promise<any> {
  
  const advertenciaOCR = metadatos.metodo === 'pdf-ocr' 
    ? '\n\nNOTA: Este texto fue extraído mediante OCR de un PDF escaneado. Puede contener errores de reconocimiento. Haz el mejor esfuerzo para interpretar la información.'
    : '';
  
  const systemPrompt = `Eres un EXPERTO EN LICITACIONES PÚBLICAS DE CHILE con más de 15 años de experiencia en análisis de bases de licitación, evaluación de propuestas y asesoría a proveedores del mercado público (ChileCompra).

Tu conocimiento incluye:
- Ley 19.886 de Compras Públicas y su reglamento
- Tipos de licitación (pública, privada, trato directo, convenio marco)
- Modalidades de pago (alzada, unitario, mixto)
- Criterios de evaluación técnico-económicos
- Garantías (seriedad de oferta, fiel cumplimiento, correcta ejecución)
- Causales de rechazo y término anticipado de contrato
- Normas técnicas chilenas (NCh, SEC, etc.)
- UTM, UF, IVA y demás indicadores económicos

Características de tu análisis:
1. Te BASAS EXCLUSIVAMENTE en el contenido del documento, nunca inventas
2. Si falta información, la señalas claramente
3. Identificas RIESGOS y OPORTUNIDADES para el proveedor
4. Eres PRÁCTICO y ACCIONABLE, no solo descriptivo
5. Adaptas tu análisis a CADA TIPO DE LICITACIÓN
6. Reconoces que los criterios de evaluación varían
7. Para tablas de puntajes, las extraes con precisión
8. Detectas automáticamente la estructura del documento
9. Si el texto viene de OCR, eres TOLERANTE con errores tipográficos${advertenciaOCR}

Formato de respuesta: 
- Usa lenguaje claro, profesional y en español
- Estructura la información con títulos, subtítulos y viñetas
- Los datos importantes (fechas, montos, porcentajes) destácalos con **negritas**
- Para análisis completo, devuelve UNICAMENTE un objeto JSON válido`;

  let userPrompt = '';

  if (tipoAnalisis === 'completo') {
    userPrompt = `Analiza PROFUNDAMENTE este documento de licitación y extrae TODA la información relevante.

DOCUMENTO: ${documentoNombre}
MÉTODO DE EXTRACCIÓN: ${metadatos.metodo}
CONFIANZA: ${metadatos.confianza}
PÁGINAS: ${metadatos.paginas}

CONTENIDO (primeros 20000 caracteres):
${texto.substring(0, 20000)}

Tu tarea es generar un análisis COMPLETO y ESTRUCTURADO que sirva a un proveedor para decidir si participar y cómo hacerlo.

IMPORTANTE: Si el texto tiene errores de OCR, intenta inferir la información correcta por contexto.

Devuelve EXCLUSIVAMENTE un objeto JSON con esta estructura (solo campos que encuentres):

{
  "metadata": {
    "documentoNombre": "string",
    "fechaAnalisis": "ISO date",
    "paginas": number,
    "confianza": "alta|media|baja"
  },
  "informacionGeneral": {
    "objetoContrato": "string",
    "tipoLicitacion": "string",
    "codigoLicitacion": "string",
    "organismoComprador": "string",
    "region": "string"
  },
  "aspectosEconomicos": {
    "presupuestoDisponible": { "monto": 0, "moneda": "CLP" },
    "montoEstimado": 0
  },
  "plazos": {
    "cierreOfertas": "YYYY-MM-DD",
    "plazoEjecucionDias": 0
  },
  "requisitos": {
    "administrativos": [],
    "tecnicos": [],
    "economicos": []
  },
  "criteriosEvaluacion": [
    {
      "nombre": "string",
      "ponderacion": 0,
      "tipo": "tecnico|economico",
      "subcriterios": []
    }
  ],
  "analisisExperto": {
    "puntosCriticos": [],
    "oportunidades": [],
    "recomendaciones": [],
    "complejidad": "baja|media|alta",
    "atractivo": "bajo|medio|alto"
  }
}`;
  }

  else if (tipoAnalisis === 'pregunta') {
    userPrompt = `DOCUMENTO: ${documentoNombre}
MÉTODO: ${metadatos.metodo}
CONTENIDO:
${texto.substring(0, 15000)}

PREGUNTA DEL USUARIO: ${pregunta}

Instrucciones:
1. Responde SOLO basándote en el contenido del documento
2. Si la respuesta no está en el documento, di "No se encuentra información en este documento sobre [tema]"
3. Si el texto tiene errores de OCR, intenta inferir la respuesta correcta
4. Si la pregunta requiere datos numéricos o fechas, extráelos con precisión
5. Da consejos prácticos para el proveedor`;
  }

  else if (tipoAnalisis === 'resumen') {
    userPrompt = `DOCUMENTO: ${documentoNombre}
MÉTODO: ${metadatos.metodo}
CONTENIDO:
${texto.substring(0, 15000)}

Genera un RESUMEN EJECUTIVO para un proveedor que evalúa participar en esta licitación. Incluye:

1. **¿DE QUÉ SE TRATA?** - Objeto del contrato en 1-2 líneas
2. **MONTO Y PLAZOS CLAVE** - Presupuesto, fechas de cierre y ejecución
3. **REQUISITOS CRÍTICOS** - Lo mínimo indispensable para no quedar fuera
4. **CÓMO SE GANA** - Criterios de evaluación (qué ponderan más)
5. **RIESGOS PRINCIPALES** - Lo que podría salir mal
6. **OPORTUNIDADES** - Por qué podría convenir participar
7. **RECOMENDACIÓN FINAL** - ¿Vale la pena? ¿Qué hay que cuidar?

Si el texto tiene errores de OCR, indícalo y haz el mejor esfuerzo.

Formato: Usa **negritas** para los títulos y datos importantes. Extensión: 500-800 palabras.`;
  }

  const completion = await getDeepSeek().chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: tipoAnalisis === 'completo' ? 0.1 : 0.3,
    max_tokens: tipoAnalisis === 'completo' ? 8000 : 4000,
  });

  const respuesta = completion.choices[0]?.message?.content || '';
  
  if (tipoAnalisis === 'completo') {
    try {
      let cleanResponse = respuesta;
      const jsonMatch = respuesta.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[1];
      }
      const parsed = JSON.parse(cleanResponse);
      // Agregar metadatos del OCR al resultado
      parsed.metadata = {
        ...parsed.metadata,
        metodoExtraccion: metadatos.metodo,
        confianzaOCR: metadatos.confianza
      };
      return parsed;
    } catch (e) {
      console.error('Error parseando JSON:', e);
      return { 
        error: 'No se pudo estructurar el análisis automáticamente', 
        raw: respuesta,
        sugerencia: 'El documento puede tener un formato no estándar. Intenta con el modo "resumen" o "pregunta"'
      };
    }
  }
  
  return respuesta;
}

// ======================================================
// ENDPOINT PRINCIPAL - VERSIÓN COMPLETA CON OCR
// ======================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { 
      pdfUrl, 
      pregunta, 
      documentoNombre, 
      tipoAnalisis = 'completo'  // 'completo', 'pregunta', 'resumen'
    } = body;

    // ========== VALIDACIONES ==========
    if (!pdfUrl) {
      return NextResponse.json({ error: 'Se requiere la URL del documento' }, { status: 400 });
    }

    // Detectar extensión
    const urlSinQuery = pdfUrl.split('?')[0];
    const extension = (urlSinQuery.split('.').pop() || '').toLowerCase();
    const formatosPermitidos = ['pdf', 'docx', 'doc', 'xlsx', 'xls'];
    
    if (!formatosPermitidos.includes(extension)) {
      return NextResponse.json(
        { error: `Formato no soportado: ${extension}. Permitidos: ${formatosPermitidos.join(', ')}` },
        { status: 400 }
      );
    }

    // ========== DESCARGA DEL DOCUMENTO ==========
    let fetchUrl: string;
    const esUrlPropia = pdfUrl.includes('.r2.dev') || pdfUrl.includes(process.env.R2_ACCOUNT_ID || '__no__');
    
    if (esUrlPropia) {
      fetchUrl = pdfUrl;
    } else {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      fetchUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(pdfUrl)}`;
    }

    console.log(`📥 Descargando documento: ${documentoNombre}`);
    const pdfResponse = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicitapymeBot/1.0)' }
    });

    if (!pdfResponse.ok) {
      return NextResponse.json(
        { error: `Error HTTP ${pdfResponse.status} al descargar el archivo` },
        { status: 500 }
      );
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    const buffer = Buffer.from(pdfBuffer);
    
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'El archivo está vacío' }, { status: 500 });
    }

    console.log(`📄 Archivo descargado: ${buffer.length} bytes`);

    // ========== EXTRACCIÓN DE TEXTO CON DETECCIÓN INTELIGENTE ==========
    let textoExtraido = '';
    let numPages = 0;
    let metodo = '';
    let confianza = '';
    
    try {
      const result = await extractTextFromDocument(buffer, extension, documentoNombre);
      textoExtraido = result.texto;
      numPages = result.numPages;
      metodo = result.metodo;
      confianza = result.confianza;
      
      console.log(`✅ Extracción completada: método=${metodo}, páginas=${numPages}, caracteres=${textoExtraido.length}`);
    } catch (parseError) {
      console.error('Error extrayendo texto:', parseError);
      return NextResponse.json(
        { error: `No se pudo extraer texto del archivo ${extension.toUpperCase()}. ${parseError instanceof Error ? parseError.message : ''}` },
        { status: 500 }
      );
    }

    // Verificar texto mínimo (umbral más bajo para OCR)
    const umbralMinimo = metodo === 'pdf-ocr' ? 50 : 100;
    if (!textoExtraido || textoExtraido.trim().length < umbralMinimo) {
      return NextResponse.json({ 
        error: 'Texto insuficiente extraído',
        sugerencia: metodo === 'pdf-ocr' 
          ? 'El documento es una imagen de baja calidad. OCR.space no pudo leerlo correctamente.'
          : 'El documento podría estar vacío o ser una imagen sin texto.',
        metodo,
        caracteres: textoExtraido?.length || 0
      }, { status: 500 });
    }

    // Limpieza de texto
    textoExtraido = textoExtraido
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // ========== ANÁLISIS SEGÚN TIPO ==========
    const metadatos = { metodo, confianza, paginas: numPages };
    let respuesta;

    if (tipoAnalisis === 'pregunta') {
      if (!pregunta) {
        return NextResponse.json({ error: 'Se requiere una pregunta para este tipo de análisis' }, { status: 400 });
      }
      respuesta = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'pregunta', metadatos, pregunta);
    } 
    else if (tipoAnalisis === 'resumen') {
      respuesta = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'resumen', metadatos);
    }
    else {
      const analisisCompleto = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'completo', metadatos);
      
      if (analisisCompleto.error) {
        const resumenFallback = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'resumen', metadatos);
        respuesta = {
          errorEstructuracion: true,
          mensaje: 'No se pudo estructurar completamente el análisis, pero aquí hay un resumen detallado',
          resumen: resumenFallback,
          rawData: analisisCompleto
        };
      } else {
        respuesta = analisisCompleto;
      }
    }

    const duracion = Date.now() - startTime;
    console.log(`🎉 Análisis completado en ${duracion}ms`);

    // ========== RESPUESTA FINAL ==========
    return NextResponse.json({
      success: true,
      tipoAnalisis,
      documento: documentoNombre,
      metadatos: {
        paginas: numPages,
        extension,
        tamaño_bytes: buffer.length,
        metodoExtraccion: metodo,
        confianzaOCR: confianza,
        tiempo_ms: duracion,
        fechaAnalisis: new Date().toISOString()
      },
      ...(tipoAnalisis === 'pregunta' && { pregunta, respuesta }),
      ...(tipoAnalisis === 'resumen' && { resumen: respuesta }),
      ...(tipoAnalisis === 'completo' && { analisis: respuesta })
    });

  } catch (error) {
    console.error('Error fatal en analizar-documento:', error);
    return NextResponse.json({ 
      error: 'Error interno del servidor',
      detalle: String(error),
      sugerencia: 'Intenta con un documento más pequeño o en formato PDF estándar'
    }, { status: 500 });
  }
}