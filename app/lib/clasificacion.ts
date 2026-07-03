// app/lib/clasificacion.ts
// Fase 1 — Clasificador Documental v2.0 (PROMPT 1).
// Lógica central reutilizable: extrae texto de los documentos del caché,
// los clasifica con DeepSeek (texto) o Gemini Vision (escaneados, primera página)
// y persiste la categoría en documentos_cache.
//
// RUTEO DE MODELOS:
//   • Texto extraíble (pdf-parse, Word, Excel) → DeepSeek (barato).
//   • PDF escaneado / imagen → Gemini Vision sobre la PRIMERA PÁGINA para clasificar.
//     La lectura completa del escaneado queda para Fase 2 (viabilidad).
//
// Cambios v2.0 vs v1.3:
//   • Elimina caja CRITERIOS_EVALUACION (los criterios van en BASES_ADMINISTRATIVAS
//     con bandera contiene_criterios_evaluacion=true).
//   • Agrega caja DOCUMENTOS_PROPIOS (documentos que creamos nosotros).
//   • Agrega campo criterios_ubicados al resumen.
//   • Preview aumentado a 2000 chars. Sin omitirOCR.

import pool from '@/app/lib/db';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { crearChatIA } from '@/app/lib/gemini';

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type TipoDocumento =
  | 'BASES_ADMINISTRATIVAS'
  | 'BASES_TECNICAS'
  | 'ANEXOS_OFERENTE'
  | 'DOCUMENTOS_PROCESO'
  | 'DOCUMENTOS_PROPIOS'
  | 'OTROS';

export interface DocClasificado {
  archivo: string;
  caja: TipoDocumento;
  subtipo: string | null;
  n_paginas: number | null;
  formato: string;
  escaneado: boolean;
  contiene_tecnicas_integradas: boolean;
  contiene_anexos_integrados: boolean;
  contiene_criterios_evaluacion: boolean;
  confianza: number;
  notas: string;
}

export interface ResumenLicitacion {
  estado: 'completo' | 'incompleto';
  falta: string[];
  cajas_presentes: string[];
  criterios_ubicados: boolean;
  total_documentos: number;
}

export interface ClasificacionCompleta {
  licitacion_id: string;
  objeto: string;
  resumen_licitacion: ResumenLicitacion;
  documentos: DocClasificado[];
}

export interface ResultadoClasificacion {
  success: boolean;
  codigo: string;
  licitacion_nombre?: string;
  total: number;
  resumen_licitacion: ResumenLicitacion;
  documentos: DocClasificado[];
  cajas: Record<TipoDocumento, DocClasificado[]>;
  error?: string;
}

// ─── PROMPT 1 v2.0 — Clasificador Documental ──────────────────────────────────
const SYSTEM_PROMPT_CLASIFICADOR = `ROL Y MISIÓN
Eres un clasificador documental experto en licitaciones públicas de Chile (MercadoPúblico).
Recibes el conjunto COMPLETO de archivos de UNA sola licitación y los metadatos de su portada.
Tu única tarea es identificar qué es cada archivo y ordenarlo en una "caja".
No descartas nada: todo documento recibe una caja, aunque sea "OTROS".

PRINCIPIOS RECTORES
1. Combina TRES señales: número de páginas, NOMBRE del archivo y CONTENIDO. El nombre por sí solo
   no basta (a veces es solo números, viene truncado o con errores de tipeo), así que nunca
   clasifiques SOLO por el nombre. PERO cuando el nombre SÍ contiene un término de tipo reconocible
   es una señal FUERTE que se suma a las otras dos (ver Diccionario de términos del nombre).
   REGLA DURA: nombre con cualquier derivación de "bases" (Bases, BBAA, BBGG, BAE, BAG, Bases
   Administrativas / Especiales / Generales) + n_paginas >= 10 = son las bases, con certeza.
2. No descartas: agrupas y rotulas. El "ruido" administrativo es una caja válida
   (DOCUMENTOS_PROCESO), no es basura.
3. Ante duda entre dos cajas, aplica las reglas de prioridad y BAJA la confianza. No inventes.
4. Usa los metadatos de la portada (ID, objeto, presupuesto) como ancla de coherencia.
5. El NÚMERO DE PÁGINAS es una señal primaria, más fiable que el nombre. Úsalo como prior fuerte.

SEÑAL PRIMARIA: NÚMERO DE PÁGINAS
- n_paginas >= 10 → casi siempre BASES (Administrativas o Técnicas).
  · Contenido articulado/legal → BASES_ADMINISTRATIVAS.
  · Contenido = listado de productos/características/cantidades → BASES_TECNICAS.
  · CASO CRÍTICO: nombre "Resolución"/"Decreto"/"REX" PERO >= 10 páginas → contiene bases dentro
    → clasifícalo como BASES_ADMINISTRATIVAS, NO como DOCUMENTOS_PROCESO.
  · EXCEPCIÓN 1 (anexos apilados): paquete de varios anexos (bloques repetidos "ANEXO N°x" +
    "FIRMA OFERENTE") → ANEXOS_OFERENTE, aunque sea largo.
  · EXCEPCIÓN 2 (referencia general): directiva/ley/reglamento NO propio de esta licitación
    → DOCUMENTOS_PROCESO.
- n_paginas 4–9 → zona mixta. Desempata por estructura y contenido.
- n_paginas 1–3 → prior = DOCUMENTOS_PROCESO o ANEXOS_OFERENTE.
  · ¿Promulga/aprueba/designa? → DOCUMENTOS_PROCESO.
  · ¿Campos a rellenar + "firma oferente"? → ANEXOS_OFERENTE.
  · OJO: BASES_TECNICAS cortas (TDR de pocos productos) también viven aquí. Si lista
    características/cantidades/requisitos → BASES_TECNICAS, aunque sea corto.

DICCIONARIO DE TÉRMINOS EN EL NOMBRE (señal de apoyo)
- bases / BBAA / BA / B.ADM / BAG / BG / BAE / BBGG / administrativas / especiales / generales
    → BASES_ADMINISTRATIVAS
- técnicas / BT / BBTT / EETT / TDR / especificaciones / requerimiento técnico / nota de pedido /
  pedido / términos de referencia → BASES_TECNICAS
- criterios / evaluación / metodología / pauta de evaluación
    → BASES_ADMINISTRATIVAS + bandera contiene_criterios_evaluacion=true
    (los criterios son parte de las reglas del proceso; NO tienen caja propia)
- anexo / formato / formulario / editable / declaración / oferta económica / oferta técnica /
  programa de integridad → ANEXOS_OFERENTE
- resolución / REX / decreto / acta / certificado / memo / directiva / estudio de mercado
    → DOCUMENTOS_PROCESO (salvo n_paginas >= 10 → contiene las bases → BASES_ADMINISTRATIVAS)
- ficha técnica PROPIA / cotización propia / certificado del oferente / tabla de completud
    → DOCUMENTOS_PROPIOS (solo si es documento NUESTRO, no un formato del organismo)

Desambiguación "técnico/económico/administrativo" en el nombre: apunta a ANEXOS_OFERENTE
(formato a rellenar), SALVO "requerimiento técnico", "nota de pedido", "EETT", "TDR" o
"bases técnicas", que son BASES_TECNICAS. Pista casi segura de ANEXOS_OFERENTE: la palabra
"editable" en el nombre, o que el documento contenga LÍNEAS PARA FIRMAR.

LAS 6 CAJAS

1) BASES_ADMINISTRATIVAS
   - Marco legal y reglas del proceso (participación, presupuesto, modalidad de adjudicación,
     plazos, garantías, multas, y LOS CRITERIOS DE EVALUACIÓN, que casi siempre van aquí dentro).
   - Alias: BBAA, BA, B.ADM; Especiales (BAE/BE) y Generales (BAG/BG).
   - CRITERIOS DE EVALUACIÓN: si el documento contiene la tabla/metodología de criterios (aunque
     sea una "Pauta de Evaluación" suelta), va en esta caja con bandera
     contiene_criterios_evaluacion=true. NO existe caja propia para criterios.
   - Puede traer anexos impresos dentro → contiene_anexos_integrados=true.

2) BASES_TECNICAS
   - Especificación del producto o servicio (características, cantidades, requisitos técnicos).
   - Alias: BT, BBTT, EETT, TDR, "Especificaciones", "Requerimiento Técnico", "Nota de Pedido".
   - Con frecuencia vienen escaneadas o en Excel.

3) ANEXOS_OFERENTE  (subtipo: Administrativo | Técnico | Económico)
   - Formatos EN BLANCO emitidos por el ORGANISMO que el oferente debe rellenar y subir.
   - Señales: palabra "EDITABLE" en el nombre; líneas para firmar ("FIRMA OFERENTE /
     REPRESENTANTE LEGAL"); "ANEXO N°x", "FORMATO N°x", celdas vacías.
   - DISTINCIÓN vs DOCUMENTOS_PROPIOS: lo emite el organismo → ANEXOS_OFERENTE;
     lo creamos nosotros → DOCUMENTOS_PROPIOS.

4) DOCUMENTOS_PROCESO
   - Actos administrativos del proceso; no se usan para construir la oferta.
   - Resoluciones/Decretos exentos CORTOS (1–3 págs), Actas, Certificados de Reserva,
     Memorandos, Estudios de Mercado, Respuestas a Foro, Planos.

5) DOCUMENTOS_PROPIOS  (subtipo: entregable | interno)
   - Documentos CREADOS POR NOSOTROS (Tecnomaq), en formato propio, NO emitidos por el organismo.
   - Hoy llega vacía al descargar del portal (los documentos propios aún no existen en el
     expediente). Su valor es existir como caja destino para la re-ingesta futura.
   - Señales cuando aplique: membrete Tecnomaq, "cotización", "ficha técnica [nuestra]",
     "tabla de costeo", "tabla de completud".

6) OTROS
   - Lo que no encaja con confianza en ninguna caja. Siempre con confianza baja y nota.

BANDERAS POR DOCUMENTO
- contiene_tecnicas_integradas: true SOLO en BASES_ADMINISTRATIVAS que incluyen especificaciones técnicas.
- contiene_anexos_integrados: true en BASES_ADMINISTRATIVAS que traen anexos impresos dentro.
- contiene_criterios_evaluacion: true cuando el documento contiene tabla/metodología de criterios.
  Señal de UBICACIÓN para que Fase 2 sepa dónde extraerlos.
- escaneado: true si el archivo no tiene capa de texto (clasificado desde imagen).
- confianza: número 0.0–1.0.

REGLAS DE DESEMPATE
- Resolución/Decreto LARGO (>= 10 págs): contiene las bases → BASES_ADMINISTRATIVAS.
  Solo las resoluciones CORTAS (1–3 págs) van a DOCUMENTOS_PROCESO.
- Criterios de evaluación, integrados o como "Pauta" aparte: BASES_ADMINISTRATIVAS +
  contiene_criterios_evaluacion=true. NO crees caja propia.
- Excel con contenido técnico: si describe lo que el COMPRADOR exige → BASES_TECNICAS;
  si es formato que el OFERENTE rellena → ANEXOS_OFERENTE (subtipo Técnico).
- Documento escaneado sin texto: clasifica por imagen de la primera página + objeto de portada.
  Si aun así no es claro → OTROS con confianza baja.

CHEQUEO DE COMPLETITUD
- completo: existe BASES_ADMINISTRATIVAS Y (BASES_TECNICAS O contiene_tecnicas_integradas=true).
- criterios_ubicados: true si alguna BASES_ADMINISTRATIVAS tiene contiene_criterios_evaluacion=true.
  Si no se detectan en ningún documento → false (Fase 2 deberá buscarlos en la API o alertar).
- Si falta alguna caja crítica → estado="incompleto" y lista en "falta" qué falta.

EJEMPLOS DE REFERENCIA (casos trampa reales)
- "4-TDR_Fiesta_del_Chancho.pdf", escaneado, especificaciones de materiales:
  caja=BASES_TECNICAS, escaneado=true.
- "2-BAE_Materiales_Electricos.pdf", estructura numerada de reglas:
  caja=BASES_ADMINISTRATIVAS.
- "Pauta_de_Evaluacion.pdf", 3 páginas, tabla de criterios con ponderaciones:
  caja=BASES_ADMINISTRATIVAS, contiene_criterios_evaluacion=true.
- "RES.EX.N4134.pdf", 50 páginas: pese al nombre, su largo indica bases dentro
  → caja=BASES_ADMINISTRATIVAS.
- "RESOLUCION_EXENTA_N°124_AUTORIZA_BASES.pdf", 2 páginas:
  caja=DOCUMENTOS_PROCESO (resolución corta).
- "ANEXOS_1_al_5_subir.pdf", 25 páginas, bloques "ANEXO N°x" + firma:
  caja=ANEXOS_OFERENTE (paquete apilado, no son bases pese al largo).

FORMATO DE SALIDA
Devuelve ÚNICAMENTE un objeto JSON válido. Sin texto antes ni después. Sin \`\`\` ni comentarios.

{
  "licitacion_id": "string",
  "objeto": "string",
  "resumen_licitacion": {
    "estado": "completo | incompleto",
    "falta": [],
    "cajas_presentes": [],
    "criterios_ubicados": false,
    "total_documentos": 0
  },
  "documentos": [
    {
      "archivo": "nombre original del archivo",
      "caja": "BASES_ADMINISTRATIVAS | BASES_TECNICAS | ANEXOS_OFERENTE | DOCUMENTOS_PROCESO | DOCUMENTOS_PROPIOS | OTROS",
      "subtipo": "Administrativo | Técnico | Económico | entregable | interno | null",
      "n_paginas": 0,
      "formato": "pdf_texto | pdf_escaneado | docx | doc | rtf | xlsx | imagen | otro",
      "escaneado": false,
      "contiene_tecnicas_integradas": false,
      "contiene_anexos_integrados": false,
      "contiene_criterios_evaluacion": false,
      "confianza": 0.0,
      "notas": "razón breve de la clasificación o de la duda"
    }
  ]
}

IMPORTANTE: el array "documentos" debe tener EXACTAMENTE el mismo número de elementos que archivos
recibidos, en el mismo orden.`;

// ─── Helpers de formato ───────────────────────────────────────────────────────
function mapFormato(metodo: string, ext: string): string {
  if (metodo === 'pdf-text') return 'pdf_texto';
  if (metodo === 'pdf-ocr' || metodo === 'pdf-gemini-vision' || metodo === 'pdf-gemini-fileapi'
    || metodo === 'pdf-gemini-vision-bloques' || metodo === 'pdf-primera-pagina-gemini') return 'pdf_escaneado';
  if (metodo === 'word' || metodo === 'word-doc') return ext === 'doc' ? 'doc' : 'docx';
  if (metodo === 'excel') return 'xlsx';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'].includes(ext)) return 'imagen';
  if (ext === 'rtf') return 'rtf';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return 'otro';
}

// ─── Gemini Vision primera página (para escaneados en clasificación) ───────────
// Solo lee la primera página para identificar el tipo de documento. El OCR completo
// se hace en Fase 2 (viabilidad), no aquí.
async function extraerPrimeraPaginaEscaneada(buffer: Buffer): Promise<string> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const sub = await PDFDocument.create();
    const [pag] = await sub.copyPages(src, [0]);
    sub.addPage(pag);
    const subBuf = Buffer.from(await sub.save());

    const { extraerTextoConGeminiVision } = await import('@/app/lib/gemini');
    const texto = await extraerTextoConGeminiVision(subBuf);
    return texto?.trim() ?? '';
  } catch (e) {
    console.warn('[clasificacion] Gemini Vision primera página falló:', e instanceof Error ? e.message : e);
    return '';
  }
}

// ─── Extracción de contenido por documento ────────────────────────────────────
// Para texto extraíble: preview de 2000 chars (suficiente para clasificar sin gastar tokens).
// Para escaneados: Gemini Vision sobre la primera página → texto de clasificación.
interface DocExtraido {
  nombre: string;
  extension: string;
  n_paginas: number | null;
  metodo: string;
  texto_preview: string;
  escaneado: boolean;
}

async function extraerParaClasificar(
  url: string,
  nombre: string,
): Promise<DocExtraido> {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();

  // Intento 1: extracción de texto (sin OCR). Barato y rápido.
  const extraccion = await descargarYExtraerTexto(url, nombre, { omitirOCR: true }).catch(() => null);
  const tieneTexto = (extraccion?.texto?.trim().length ?? 0) > 100;

  if (tieneTexto) {
    return {
      nombre,
      extension: ext,
      n_paginas: extraccion!.numPages ?? null,
      metodo: extraccion!.metodo,
      texto_preview: extraccion!.texto.slice(0, 2000),
      escaneado: false,
    };
  }

  // Intento 2: escaneado o sin texto → Gemini Vision primera página.
  // Solo aplica a PDFs; Word/Excel sin texto se dejan con preview vacío.
  const esPdf = ext === 'pdf';
  let textoPrimeraPagina = '';
  let metodoFinal = extraccion?.metodo ?? 'unknown';

  if (esPdf && process.env.GEMINI_API_KEY) {
    // Descargar el buffer para extraer la primera página.
    try {
      const fetchUrl = url.includes('.r2.dev') || url.includes(process.env.R2_ACCOUNT_ID || '__no__')
        ? url
        : `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/proxy?url=${encodeURIComponent(url)}`;
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        textoPrimeraPagina = await extraerPrimeraPaginaEscaneada(buf);
        if (textoPrimeraPagina) metodoFinal = 'pdf-primera-pagina-gemini';
      }
    } catch (e) {
      console.warn('[clasificacion] No se pudo obtener primera página:', nombre, e instanceof Error ? e.message : e);
    }
  }

  return {
    nombre,
    extension: ext,
    n_paginas: extraccion?.numPages ?? null,
    metodo: metodoFinal,
    texto_preview: textoPrimeraPagina.slice(0, 2000),
    escaneado: esPdf && !tieneTexto,
  };
}

// ─── Clasificación con DeepSeek ────────────────────────────────────────────────
async function clasificarConDeepSeek(
  licitacion: { codigo: string; nombre: string; monto: number | null },
  docs: DocExtraido[],
): Promise<ClasificacionCompleta> {
  const montoStr = licitacion.monto
    ? `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(licitacion.monto)} CLP`
    : 'No especificado';

  const portada = `PORTADA:\n  id: "${licitacion.codigo}"\n  objeto: "${licitacion.nombre || 'No disponible'}"\n  presupuesto_estimado: "${montoStr}"`;

  const docsTexto = docs.map((d, i) => {
    const formato = mapFormato(d.metodo, d.extension);
    const previewLabel = d.escaneado && d.texto_preview
      ? 'texto_primera_pagina_gemini'
      : d.escaneado
        ? '(escaneado — sin texto extraíble)'
        : 'texto_preview';
    return [
      `--- ARCHIVO ${i + 1} ---`,
      `archivo: ${d.nombre}`,
      `extension: .${d.extension}`,
      `formato_detectado: ${formato}`,
      `n_paginas: ${d.n_paginas ?? 'null'}`,
      `escaneado: ${d.escaneado}`,
      `${previewLabel}: ${d.texto_preview || '(sin texto — clasificar por nombre, extensión y páginas)'}`,
    ].join('\n');
  }).join('\n\n');

  const userContent = `${portada}\n\nClasifica los siguientes ${docs.length} archivo${docs.length !== 1 ? 's' : ''} de la licitación.\n\n${docsTexto}\n\nDevuelve ÚNICAMENTE el objeto JSON según el esquema indicado.`;

  const completion = await crearChatIA({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CLASIFICADOR },
      { role: 'user', content: userContent },
    ],
    temperature: 0.05,
    stream: false,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; }

  if (Array.isArray(parsed)) {
    return {
      licitacion_id: licitacion.codigo,
      objeto: licitacion.nombre || '',
      resumen_licitacion: {
        estado: 'incompleto', falta: [], cajas_presentes: [],
        criterios_ubicados: false, total_documentos: docs.length,
      },
      documentos: parsed,
    };
  }
  return parsed as ClasificacionCompleta;
}

// ─── Función central: clasifica y persiste categoría ──────────────────────────
export async function clasificarLicitacion(codigo: string): Promise<ResultadoClasificacion> {
  // 1. Metadata de la licitación
  let licitacionNombre = '';
  let licitacionMonto: number | null = null;
  try {
    const [licitRows] = await pool.query(
      `SELECT licitacion_nombre, licitacion_monto FROM alertas_licitaciones
       WHERE licitacion_codigo = ? ORDER BY created_at DESC LIMIT 1`,
      [codigo],
    ) as any[];
    if ((licitRows as any[]).length > 0) {
      licitacionNombre = licitRows[0].licitacion_nombre || '';
      licitacionMonto = licitRows[0].licitacion_monto ?? null;
    }
  } catch { /* tabla puede no existir */ }

  // 2. Documentos del caché
  const [rows] = await pool.query(
    `SELECT documento_nombre, documento_url_local, size_bytes
     FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
    [codigo],
  );
  const dbDocs = rows as { documento_nombre: string; documento_url_local: string; size_bytes: number }[];

  const cajasVacias = (): Record<TipoDocumento, DocClasificado[]> => ({
    BASES_ADMINISTRATIVAS: [], BASES_TECNICAS: [],
    ANEXOS_OFERENTE: [], DOCUMENTOS_PROCESO: [], DOCUMENTOS_PROPIOS: [], OTROS: [],
  });

  if (!dbDocs.length) {
    return {
      success: false, codigo, total: 0,
      resumen_licitacion: {
        estado: 'incompleto', falta: [], cajas_presentes: [],
        criterios_ubicados: false, total_documentos: 0,
      },
      documentos: [], cajas: cajasVacias(), error: 'Sin documentos descargados.',
    };
  }

  // 3. Extraer contenido (concurrencia 3).
  //    Texto extraíble → preview 2000 chars (DeepSeek).
  //    Escaneado → primera página vía Gemini Vision → texto de clasificación.
  const CONCURRENCY = 3;
  const extracciones: DocExtraido[] = [];
  for (let i = 0; i < dbDocs.length; i += CONCURRENCY) {
    const batch = dbDocs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(doc => extraerParaClasificar(doc.documento_url_local, doc.documento_nombre)),
    );
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        extracciones.push(r.value);
      } else {
        const doc = batch[j];
        const ext = (doc.documento_url_local.split('?')[0].split('.').pop() || '').toLowerCase();
        extracciones.push({ nombre: doc.documento_nombre, extension: ext, n_paginas: null, metodo: 'error', texto_preview: '', escaneado: false });
      }
    });
  }

  // 4. Clasificar con DeepSeek (usa texto de todos los docs, incluidos los escaneados
  //    cuya primera página fue leída por Gemini Vision).
  const clasificacion = await clasificarConDeepSeek(
    { codigo, nombre: licitacionNombre, monto: licitacionMonto },
    extracciones,
  );

  // 5. Normalizar resultado
  const CAJAS_VALIDAS = new Set<TipoDocumento>([
    'BASES_ADMINISTRATIVAS', 'BASES_TECNICAS', 'ANEXOS_OFERENTE',
    'DOCUMENTOS_PROCESO', 'DOCUMENTOS_PROPIOS', 'OTROS',
  ]);

  const documentos: DocClasificado[] = (clasificacion.documentos || []).map((c: any, i: number) => {
    // Retrocompatibilidad: CRITERIOS_EVALUACION (v1) → BASES_ADMINISTRATIVAS + bandera
    let caja: TipoDocumento = c.caja ?? 'OTROS';
    let criteriosFlag = c.contiene_criterios_evaluacion ?? false;
    if ((caja as string) === 'CRITERIOS_EVALUACION') {
      caja = 'BASES_ADMINISTRATIVAS';
      criteriosFlag = true;
    }
    if (!CAJAS_VALIDAS.has(caja)) caja = 'OTROS';

    return {
      archivo: c.archivo ?? extracciones[i]?.nombre ?? '',
      caja,
      subtipo: c.subtipo ?? null,
      n_paginas: c.n_paginas ?? extracciones[i]?.n_paginas ?? null,
      formato: c.formato ?? mapFormato(extracciones[i]?.metodo ?? '', extracciones[i]?.extension ?? ''),
      escaneado: c.escaneado ?? extracciones[i]?.escaneado ?? false,
      contiene_tecnicas_integradas: c.contiene_tecnicas_integradas ?? false,
      contiene_anexos_integrados: c.contiene_anexos_integrados ?? false,
      contiene_criterios_evaluacion: criteriosFlag,
      confianza: typeof c.confianza === 'number' ? c.confianza : 0.5,
      notas: c.notas ?? '',
    };
  });

  // 6. Persistir categoría en documentos_cache
  try {
    for (const doc of documentos) {
      await pool.query(
        `UPDATE documentos_cache SET categoria = ? WHERE licitacion_codigo = ? AND documento_nombre = ?`,
        [doc.caja, codigo, doc.archivo],
      );
    }
  } catch { /* columna categoria puede no existir aún */ }

  // 7. Agrupar por caja
  const cajas = cajasVacias();
  documentos.forEach(d => cajas[d.caja]?.push(d));

  // 8. Resumen (con criterios_ubicados)
  const criteriosUbicados = documentos.some(d => d.contiene_criterios_evaluacion);
  const resumenRaw = clasificacion.resumen_licitacion;
  const resumen: ResumenLicitacion = {
    estado: resumenRaw?.estado ?? 'incompleto',
    falta: resumenRaw?.falta ?? [],
    cajas_presentes: resumenRaw?.cajas_presentes ?? [],
    criterios_ubicados: resumenRaw?.criterios_ubicados ?? criteriosUbicados,
    total_documentos: documentos.length,
  };

  return {
    success: true, codigo, licitacion_nombre: licitacionNombre,
    total: documentos.length, resumen_licitacion: resumen, documentos, cajas,
  };
}
