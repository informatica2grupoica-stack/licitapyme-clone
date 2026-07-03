// app/api/analizar-documento/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { extractTextFromDocument, descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { crearChatIA } from '@/app/lib/gemini';

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

// ======================================================
// ANÁLISIS CON EL PROVEEDOR DE TEXTO ACTIVO (GLM de Z.AI por defecto)
// ======================================================

async function analizarConDeepSeekExperto(
  texto: string,
  documentoNombre: string,
  tipoAnalisis: 'completo' | 'pregunta' | 'resumen',
  metadatos: { metodo: string; confianza: string; paginas: number },
  pregunta?: string,
  historial?: Array<{ pregunta: string; respuesta: string }>
): Promise<any> {

  const advertenciaOCR = metadatos.metodo === 'pdf-ocr'
    ? '\n\nNOTA: Este texto fue extraído mediante OCR de un PDF escaneado. Puede contener errores de reconocimiento. Haz el mejor esfuerzo para interpretar la información.'
    : '';

  // Modo conversacional: el usuario chatea directamente con la IA sobre el/los
  // documento(s), respuestas en lenguaje natural (NO JSON, NO informes formales).
  if (tipoAnalisis === 'pregunta') {
    const systemPromptChat = `Eres un asistente experto en licitaciones públicas de Chile (ChileCompra / Ley 19.886), conversando directamente con un proveedor que está evaluando si participar en una licitación.

Reglas de conversación:
- Responde en español natural y directo, como en un chat — NO como un informe ni en formato JSON.
- Usa párrafos cortos. Solo usa viñetas si realmente ayudan a listar varios ítems.
- Usa **negritas** únicamente para datos clave: fechas, montos, plazos, porcentajes.
- Basa tu respuesta SOLO en el contenido del/los documento(s) entregado(s). Si algo no está, dilo claramente ("no encuentro esa información en el documento") en vez de inventarlo.
- Si el texto viene de OCR, es tolerante con errores tipográficos e infiere por contexto cuando sea razonable.
- Si la pregunta da para un consejo práctico para el proveedor, agrégalo brevemente al final.
- Si el usuario hace una pregunta de seguimiento, usa el historial de la conversación para entender el contexto.${advertenciaOCR}`;

    const contexto = `DOCUMENTO(S): ${documentoNombre}\n\nCONTENIDO:\n${texto.substring(0, 18000)}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPromptChat },
      { role: 'user', content: contexto },
      { role: 'assistant', content: 'Listo, ya revisé el contenido del documento. ¿En qué te puedo ayudar?' },
    ];

    for (const turno of (historial || []).slice(-3)) {
      if (!turno?.pregunta || !turno?.respuesta) continue;
      messages.push({ role: 'user', content: turno.pregunta });
      messages.push({ role: 'assistant', content: turno.respuesta });
    }

    messages.push({ role: 'user', content: pregunta || '' });

    const completion = await crearChatIA({
      messages,
      temperature: 0.4,
      max_tokens: 2000,
    });

    return completion.choices[0]?.message?.content || '';
  }

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

  const completion = await crearChatIA({
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
      tipoAnalisis = 'completo',  // 'completo', 'pregunta', 'resumen'
      documentos,                 // modo "todos los documentos": [{ url, nombre }]
      historial,                  // últimas preguntas/respuestas del chat
    } = body;

    // ========== MODO "TODOS LOS DOCUMENTOS" ==========
    if (Array.isArray(documentos) && documentos.length > 0) {
      if (!pregunta) {
        return NextResponse.json({ error: 'Se requiere una pregunta para este tipo de análisis' }, { status: 400 });
      }

      const extraidos: Array<{ nombre: string; texto: string }> = [];
      for (const doc of documentos) {
        if (!doc?.url || !doc?.nombre) continue;
        try {
          const r = await descargarYExtraerTexto(doc.url, doc.nombre);
          const limpio = (r?.texto || '').replace(/\s+/g, ' ').trim();
          if (limpio.length > 50) extraidos.push({ nombre: doc.nombre, texto: limpio });
        } catch (e) {
          console.error(`Error extrayendo "${doc.nombre}":`, e);
        }
      }

      if (extraidos.length === 0) {
        return NextResponse.json({ error: 'No se pudo extraer texto de ningún documento' }, { status: 500 });
      }

      const CAP = 18000;
      const porDoc = Math.floor(CAP / extraidos.length);
      const combinado = extraidos
        .map(d => `--- Documento: ${d.nombre} ---\n${d.texto.substring(0, porDoc)}`)
        .join('\n\n');

      const respuesta = await analizarConDeepSeekExperto(
        combinado,
        `${extraidos.length} documento(s) de la licitación`,
        'pregunta',
        { metodo: 'multi-documento', confianza: 'media', paginas: 0 },
        pregunta,
        historial,
      );

      return NextResponse.json({
        success: true,
        tipoAnalisis: 'pregunta',
        documento: `${extraidos.length} documento(s)`,
        documentosAnalizados: extraidos.map(d => d.nombre),
        pregunta,
        respuesta,
      });
    }

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
      respuesta = await analizarConDeepSeekExperto(textoExtraido, documentoNombre, 'pregunta', metadatos, pregunta, historial);
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