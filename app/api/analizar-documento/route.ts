import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// ======================================================
// TIPOS - DEFINICIONES COMPLETAS Y FLEXIBLES
// ======================================================

interface LicitacionAnalisis {
  // Metadatos del análisis
  metadata: {
    documentoNombre: string;
    fechaAnalisis: string;
    paginas: number;
    tamanioBytes: number;
    confianza: 'alta' | 'media' | 'baja';
  };
  
  // Información general
  informacionGeneral: {
    objetoContrato?: string;
    tipoLicitacion?: string;
    modalidadContrato?: string;
    codigoLicitacion?: string;
    organismoComprador?: string;
    region?: string;
    comuna?: string;
  };
  
  // Aspectos económicos
  aspectosEconomicos: {
    presupuestoDisponible?: {
      monto: number;
      moneda: string;
      fuente?: string;
    };
    montoEstimado?: number;
    tipoMoneda?: string;
    sistemaPrecios?: string;
    reajuste?: boolean;
  };
  
  // Plazos y fechas
  plazos: {
    publicacion?: string;
    cierreOfertas?: string;
    aperturaTecnica?: string;
    aperturaEconomica?: string;
    adjudicacionEstimada?: string;
    plazoEjecucionDias?: number;
    otrosPlazos?: Array<{ nombre: string; fecha?: string; plazoDias?: number }>;
  };
  
  // Requisitos de participación
  requisitos: {
    administrativos: string[];
    tecnicos: string[];
    economicos: string[];
    habilitantes: string[];
    prohibiciones: string[];
  };
  
  // Criterios de evaluación (dinámicos)
  criteriosEvaluacion: Array<{
    nombre: string;
    ponderacion: number;
    tipo: 'tecnico' | 'economico' | 'experiencia' | 'otros';
    subcriterios?: Array<{
      nombre: string;
      descripcion: string;
      puntajeMaximo?: number;
      condiciones?: Array<{
        condicion: string;
        puntaje: number;
      }>;
    }>;
    formula?: string;
  }>;
  
  // Garantías
  garantias: Array<{
    tipo: string;
    porcentaje?: number;
    montoFijo?: number;
    momento: string;
    devolucion?: string;
    caracteristicas?: string;
  }>;
  
  // Multas y sanciones
  multas: Array<{
    concepto: string;
    valor: string;
    unidad: 'UTM' | 'UF' | 'pesos' | 'porcentaje';
    limiteMaximo?: string;
  }>;
  
  // Documentos requeridos
  documentosRequeridos: Array<{
    nombre: string;
    formato?: string;
    obligatorio: boolean;
  }>;
  
  // Subcontratación
  subcontratacion: {
    permitida: boolean;
    porcentajeMaximo?: number;
    requisitos?: string;
  };
  
  // Causales de rechazo
  causalesRechazo: string[];
  
  // Puntos críticos y recomendaciones
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
// FUNCIONES PRINCIPALES
// ======================================================

function getDeepSeek() {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? 'not-configured',
    baseURL: 'https://api.deepseek.com',
  });
}

async function extractTextFromDocument(buffer: Buffer, ext: string): Promise<{ texto: string; numPages: number }> {
  try {
    if (ext === 'docx' || ext === 'doc') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { texto: result.value || '', numPages: 1 };
    } else if (ext === 'xlsx' || ext === 'xls') {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let textoCompleto = '';
      workbook.SheetNames.forEach((sheetName: string) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        textoCompleto += `\n--- Hoja: ${sheetName} ---\n${csv}\n`;
      });
      return { texto: textoCompleto, numPages: workbook.SheetNames.length };
    } else {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      return { texto: pdfData.text, numPages: pdfData.numpages };
    }
  } catch (error) {
    console.error('Error en extractTextFromDocument:', error);
    throw error;
  }
}

async function analizarConDeepSeekExperto(
  texto: string,
  documentoNombre: string,
  tipoAnalisis: 'completo' | 'pregunta' | 'resumen',
  pregunta?: string
): Promise<any> {
  
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
5. Adaptas tu análisis a CADA TIPO DE LICITACIÓN (obras, servicios, consultorías, suministros, etc.)
6. Reconoces que los criterios de evaluación varían: algunos usan puntajes, otros usan "Aprobado/Rechazado", otros usan fórmulas complejas
7. Para tablas de puntajes, las extraes con precisión aunque tengan muchas filas
8. Detectas automáticamente la estructura del documento (no asumes nada predefinido)

Formato de respuesta: 
- Usa lenguaje claro, profesional y en español
- Estructura la información con títulos, subtítulos y viñetas
- Los datos importantes (fechas, montos, porcentajes) destácalos con **negritas**
- Para análisis completo, devuelve UNICAMENTE un objeto JSON válido`;

  let userPrompt = '';

  if (tipoAnalisis === 'completo') {
    userPrompt = `Analiza PROFUNDAMENTE este documento de licitación y extrae TODA la información relevante.

DOCUMENTO: ${documentoNombre}
CONTENIDO (primeros 18000 caracteres):
${texto.substring(0, 18000)}

Tu tarea es generar un análisis COMPLETO y ESTRUCTURADO que sirva a un proveedor para decidir si participar y cómo hacerlo.

Debes devolver EXCLUSIVAMENTE un objeto JSON con esta estructura (todos los campos son opcionales, incluye SOLO lo que encuentres en el documento):

{
  "metadata": {
    "documentoNombre": "string",
    "fechaAnalisis": "ISO date",
    "paginas": number,
    "tamanioBytes": number,
    "confianza": "alta" | "media" | "baja"
  },
  "informacionGeneral": {
    "objetoContrato": "string",
    "tipoLicitacion": "string",
    "modalidadContrato": "string",
    "codigoLicitacion": "string",
    "organismoComprador": "string",
    "region": "string",
    "comuna": "string"
  },
  "aspectosEconomicos": {
    "presupuestoDisponible": { "monto": number, "moneda": "string", "fuente": "string" },
    "montoEstimado": number,
    "tipoMoneda": "string",
    "sistemaPrecios": "string",
    "reajuste": boolean
  },
  "plazos": {
    "publicacion": "YYYY-MM-DD",
    "cierreOfertas": "YYYY-MM-DD",
    "aperturaTecnica": "YYYY-MM-DD",
    "aperturaEconomica": "YYYY-MM-DD",
    "adjudicacionEstimada": "YYYY-MM-DD",
    "plazoEjecucionDias": number,
    "otrosPlazos": [{ "nombre": "string", "fecha": "YYYY-MM-DD", "plazoDias": number }]
  },
  "requisitos": {
    "administrativos": ["string"],
    "tecnicos": ["string"],
    "economicos": ["string"],
    "habilitantes": ["string"],
    "prohibiciones": ["string"]
  },
  "criteriosEvaluacion": [
    {
      "nombre": "string",
      "ponderacion": number,
      "tipo": "tecnico" | "economico" | "experiencia" | "otros",
      "subcriterios": [
        {
          "nombre": "string",
          "descripcion": "string",
          "puntajeMaximo": number,
          "condiciones": [
            { "condicion": "string", "puntaje": number }
          ]
        }
      ],
      "formula": "string (si aplica)"
    }
  ],
  "garantias": [
    {
      "tipo": "string",
      "porcentaje": number,
      "montoFijo": number,
      "momento": "string",
      "devolucion": "string",
      "caracteristicas": "string"
    }
  ],
  "multas": [
    {
      "concepto": "string",
      "valor": "string",
      "unidad": "UTM" | "UF" | "pesos" | "porcentaje",
      "limiteMaximo": "string"
    }
  ],
  "documentosRequeridos": [
    { "nombre": "string", "formato": "string", "obligatorio": true }
  ],
  "subcontratacion": {
    "permitida": boolean,
    "porcentajeMaximo": number,
    "requisitos": "string"
  },
  "causalesRechazo": ["string"],
  "analisisExperto": {
    "puntosCriticos": ["string"],
    "oportunidades": ["string"],
    "riesgosDetectados": ["string"],
    "recomendaciones": ["string"],
    "complejidad": "baja" | "media" | "alta",
    "atractivo": "bajo" | "medio" | "alto"
  }
}

IMPORTANTE:
- Si un campo no existe en el documento, OMÍTELO (no pongas null)
- Las ponderaciones pueden ser números enteros o decimales
- Para tablas grandes de puntajes, incluye todas las filas relevantes en "condiciones"
- Sé meticuloso, extrae hasta el detalle más pequeño
- Si encuentras fórmulas (ej: "PE = (Vmin/Vi) * 100"), guárdalas exactamente`;
  }

  else if (tipoAnalisis === 'pregunta') {
    userPrompt = `DOCUMENTO: ${documentoNombre}
CONTENIDO:
${texto.substring(0, 15000)}

PREGUNTA DEL USUARIO: ${pregunta}

Instrucciones:
1. Responde SOLO basándote en el contenido del documento
2. Si la respuesta no está en el documento, di "No se encuentra información en este documento sobre [tema]"
3. Si la pregunta requiere datos numéricos o fechas, extráelos con precisión
4. Si es relevante, cita la sección o página aproximada del documento donde encontraste la información
5. Da consejos prácticos para el proveedor basados en la información disponible
6. Si la pregunta es sobre criterios de evaluación, desglosa cada criterio con su ponderación y condiciones de puntaje`;
  }

  else if (tipoAnalisis === 'resumen') {
    userPrompt = `DOCUMENTO: ${documentoNombre}
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

Formato: Usa **negritas** para los títulos y datos importantes. Extensión: 500-800 palabras. Sé directo y útil.`;
  }

  const completion = await getDeepSeek().chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: tipoAnalisis === 'completo' ? 0.1 : 0.3,
    max_tokens: tipoAnalisis === 'completo' ? 6000 : 2500,
  });

  const respuesta = completion.choices[0]?.message?.content || '';
  
  if (tipoAnalisis === 'completo') {
    try {
      let cleanResponse = respuesta;
      const jsonMatch = respuesta.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[1];
      }
      return JSON.parse(cleanResponse);
    } catch (e) {
      console.error('Error parseando JSON completo:', e);
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
// ENDPOINT PRINCIPAL - VERSIÓN ULTRA ROBUSTA
// ======================================================

export async function POST(request: NextRequest) {
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

    // ========== EXTRACCIÓN DE TEXTO ==========
    let textoExtraido = '';
    let numPages = 0;
    
    try {
      const result = await extractTextFromDocument(buffer, extension);
      textoExtraido = result.texto;
      numPages = result.numPages;
    } catch (parseError) {
      console.error('Error extrayendo texto:', parseError);
      return NextResponse.json(
        { error: `No se pudo extraer texto del archivo ${extension.toUpperCase()}. ¿Es un PDF escaneado?` },
        { status: 500 }
      );
    }

    if (!textoExtraido || textoExtraido.trim().length < 100) {
      return NextResponse.json({ 
        error: 'Texto insuficiente extraído',
        sugerencia: 'El documento podría ser una imagen escaneada. Prueba con un PDF con texto seleccionable.'
      }, { status: 500 });
    }

    // Limpieza de texto
    textoExtraido = textoExtraido
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // ========== ANÁLISIS SEGÚN TIPO ==========
    let respuesta;

    if (tipoAnalisis === 'pregunta') {
      if (!pregunta) {
        return NextResponse.json({ error: 'Se requiere una pregunta para este tipo de análisis' }, { status: 400 });
      }
      respuesta = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'pregunta', pregunta);
    } 
    else if (tipoAnalisis === 'resumen') {
      respuesta = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'resumen');
    }
    else {
      // ANÁLISIS COMPLETO - El más robusto
      const analisisCompleto = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'completo');
      
      // Si el análisis completo falló, hacer un resumen como fallback
      if (analisisCompleto.error) {
        const resumenFallback = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'resumen');
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

    // ========== RESPUESTA FINAL ==========
    return NextResponse.json({
      success: true,
      tipoAnalisis,
      documento: documentoNombre,
      metadatos: {
        paginas: numPages,
        extension,
        tamaño_bytes: buffer.length,
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