// app/lib/clasificacion.ts
// Fase 1 — Clasificador Documental v1.3 (PROMPT 1).
// Lógica central reutilizable: extrae previews de los documentos del caché,
// los clasifica con Gemini en las 6 cajas y persiste la categoría en documentos_cache.
// Usado por /api/documentos/clasificar (HTTP) y por el pipeline de descarga/análisis.

import pool from '@/app/lib/db';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { getGemini } from '@/app/lib/gemini';

export type TipoDocumento =
  | 'BASES_ADMINISTRATIVAS'
  | 'BASES_TECNICAS'
  | 'CRITERIOS_EVALUACION'
  | 'ANEXOS_OFERENTE'
  | 'DOCUMENTOS_PROCESO'
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
  confianza: number;
  notas: string;
}

export interface ResumenLicitacion {
  estado: 'completo' | 'incompleto';
  falta: string[];
  cajas_presentes: string[];
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

// ─── PROMPT 1 — Clasificador Documental v1.3 ──────────────────────────────────
const SYSTEM_PROMPT_CLASIFICADOR = `Eres el CLASIFICADOR DOCUMENTAL DE LICITACIONES (v1.3) de Grupo ICA.
Tu única función es categorizar los archivos adjuntos de una licitación pública chilena (Mercado Público / Chile Compra).
Recibes metadata de la licitación (PORTADA) y la lista de archivos con sus señales.
Devuelves UN ÚNICO objeto JSON válido. Sin texto adicional, sin markdown, sin explicaciones fuera del JSON.

## CATEGORÍAS — LAS 6 CAJAS
1. **BASES_ADMINISTRATIVAS**: reglas del proceso, plazos, cronograma, garantías, admisibilidad, causales de rechazo, tipo de contrato, forma de pago. Documentos largos (15–120 págs). Pueden contener técnicas/anexos integrados.
2. **BASES_TECNICAS**: especificaciones de lo que se compra (descripción, características, cantidades, estándares, alcance, TDR, EETT). Si van integradas en las administrativas → contiene_tecnicas_integradas = true.
3. **CRITERIOS_EVALUACION**: tabla/grilla de puntuación y ponderaciones (precio, calidad, plazo, experiencia). Documentos cortos (1–8 págs).
4. **ANEXOS_OFERENTE**: formularios que el PROVEEDOR completa (anexo económico/cotizador, declaraciones juradas, ficha empresa, experiencia, RRHH). Frecuente en .docx/.xlsx editables.
5. **DOCUMENTOS_PROCESO**: generados por el organismo durante el proceso (resoluciones de apertura, modificaciones, respuestas a preguntas, actas). Resoluciones cortas (<10 págs).
6. **OTROS**: planos de referencia, catálogos, imágenes, manuales, fichas de productos, formatos extraños.

## REGLAS DURAS
RD-1: nombre con raíz "bases" Y n_paginas >= 10 → BASES_ADMINISTRATIVAS (0.97).
RD-2: "resolucion"/"decreto"/"exenta" Y n_paginas >= 10 → BASES_ADMINISTRATIVAS.
RD-3: nombre con "editable" → ANEXOS_OFERENTE (0.93).
RD-4: .xlsx/.xls → CRITERIOS_EVALUACION o ANEXOS_OFERENTE (precio/cotización → ANEXOS subtipo Económico).
RD-5: .docx/.doc con "anexo"/"formulario"/"declarac"/"ficha"/"dj" → ANEXOS_OFERENTE.

## DICCIONARIO (resumen)
→ BASES_ADMINISTRATIVAS: bbaa, bases admin, bases generales, bbgg, bases de licitacion, bases de contratacion, resolucion aprueba bases.
→ BASES_TECNICAS: bbtt, eett, especificaciones tecnicas, tdr, terminos de referencia, requerimientos tecnicos.
→ CRITERIOS_EVALUACION: criterios, pauta evaluacion, grilla, ponderacion, factores evaluacion.
→ ANEXOS_OFERENTE: anexo, formulario, dj, declaracion jurada, ficha empresa, cotizacion, oferta economica, rrhh, editable.
→ DOCUMENTOS_PROCESO: resolucion, decreto, exenta, oficio, acta apertura, modificacion bases, aclaraciones, orden de compra.
→ OTROS: plano, croquis, mapa, catalogo, manual, imagen, foto, jpg, png, referencia.

## FLAGS
- escaneado: true si metodo = pdf_escaneado o texto_preview vacío en PDF.
- contiene_tecnicas_integradas: true si BASES_ADMINISTRATIVAS incluye especificaciones técnicas.
- contiene_anexos_integrados: true si bases incluyen formularios para el proveedor.

## COMPLETITUD
- completo: están BASES_ADMINISTRATIVAS + (BASES_TECNICAS o contiene_tecnicas_integradas=true).
- incompleto: falta alguna caja crítica. "falta" lista las cajas críticas ausentes.

## FORMATO DE SALIDA (JSON ESTRICTO)
{
  "licitacion_id": "código",
  "objeto": "nombre/objeto",
  "resumen_licitacion": { "estado": "completo|incompleto", "falta": [], "cajas_presentes": [], "total_documentos": 0 },
  "documentos": [
    { "archivo": "nombre", "caja": "BASES_ADMINISTRATIVAS|BASES_TECNICAS|CRITERIOS_EVALUACION|ANEXOS_OFERENTE|DOCUMENTOS_PROCESO|OTROS",
      "subtipo": "Administrativo|Técnico|Económico|null", "n_paginas": 0, "formato": "pdf_texto|pdf_escaneado|docx|doc|rtf|xlsx|imagen|otro",
      "escaneado": false, "contiene_tecnicas_integradas": false, "contiene_anexos_integrados": false, "confianza": 0.0, "notas": "máx 15 palabras" }
  ]
}
IMPORTANTE: el array "documentos" debe tener EXACTAMENTE el mismo número de elementos que archivos recibidos, en el mismo orden.`;

function mapFormato(metodo: string, ext: string): string {
  if (metodo === 'pdf-text') return 'pdf_texto';
  if (metodo === 'pdf-ocr' || metodo === 'pdf-gemini-vision') return 'pdf_escaneado';
  if (metodo === 'word') return ext === 'doc' ? 'doc' : 'docx';
  if (metodo === 'excel') return 'xlsx';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'].includes(ext)) return 'imagen';
  if (ext === 'rtf') return 'rtf';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return 'otro';
}

async function clasificarConGemini(
  licitacion: { codigo: string; nombre: string; monto: number | null },
  docs: { nombre: string; extension: string; n_paginas: number | null; metodo: string; texto_preview: string }[],
): Promise<ClasificacionCompleta> {
  const montoStr = licitacion.monto
    ? `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(licitacion.monto)} CLP`
    : 'No especificado';

  const portada = `PORTADA:\n  id: "${licitacion.codigo}"\n  objeto: "${licitacion.nombre || 'No disponible'}"\n  presupuesto_estimado: "${montoStr}"`;

  const docsTexto = docs.map((d, i) => {
    const formato = mapFormato(d.metodo, d.extension);
    const escaneado = d.metodo === 'pdf-ocr' || d.metodo === 'pdf-gemini-vision';
    return `--- ARCHIVO ${i + 1} ---\narchivo: ${d.nombre}\nextension: .${d.extension}\nformato_detectado: ${formato}\nn_paginas: ${d.n_paginas ?? 'null'}\nescaneado: ${escaneado}\ntexto_preview: ${d.texto_preview || '(sin texto — clasificar por nombre, extensión y páginas)'}`;
  }).join('\n\n');

  const userContent = `${portada}\n\nClasifica los siguientes ${docs.length} archivo${docs.length !== 1 ? 's' : ''} de la licitación.\n\n${docsTexto}\n\nDevuelve ÚNICAMENTE el objeto JSON según el esquema indicado.`;

  // getGemini() apunta a la API OpenAI-compatible de DeepSeek → usar 'deepseek-chat'.
  // (El modelo 'gemini-2.5-flash' aquí fallaba: no existe en ese endpoint.)
  const completion = await getGemini().chat.completions.create({
    model: 'deepseek-chat',
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
      resumen_licitacion: { estado: 'incompleto', falta: [], cajas_presentes: [], total_documentos: docs.length },
      documentos: parsed,
    };
  }
  return parsed as ClasificacionCompleta;
}

// ─── Función central: clasifica y persiste categoría ──────────────────────────
export async function clasificarLicitacion(codigo: string): Promise<ResultadoClasificacion> {
  // 1. Metadata
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
    BASES_ADMINISTRATIVAS: [], BASES_TECNICAS: [], CRITERIOS_EVALUACION: [],
    ANEXOS_OFERENTE: [], DOCUMENTOS_PROCESO: [], OTROS: [],
  });

  if (!dbDocs.length) {
    return {
      success: false, codigo, total: 0,
      resumen_licitacion: { estado: 'incompleto', falta: [], cajas_presentes: [], total_documentos: 0 },
      documentos: [], cajas: cajasVacias(), error: 'Sin documentos descargados.',
    };
  }

  // 3. Extraer previews (concurrencia 3). Para clasificar NO se necesita OCR:
  // basta el texto de pdf-parse + nombre + páginas → omitirOCR para no gastar cuota.
  const CONCURRENCY = 3;
  const extracciones: { nombre: string; extension: string; n_paginas: number | null; metodo: string; texto_preview: string }[] = [];
  for (let i = 0; i < dbDocs.length; i += CONCURRENCY) {
    const batch = dbDocs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (doc) => {
      const ext = (doc.documento_url_local.split('?')[0].split('.').pop() || '').toLowerCase();
      const extraccion = await descargarYExtraerTexto(doc.documento_url_local, doc.documento_nombre, { omitirOCR: true }).catch(() => null);
      return {
        nombre: doc.documento_nombre,
        extension: ext,
        n_paginas: extraccion?.numPages ?? null,
        metodo: extraccion?.metodo ?? 'unknown',
        texto_preview: (extraccion?.texto ?? '').slice(0, 600),
      };
    }));
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') extracciones.push(r.value);
      else {
        const doc = batch[j];
        const ext = (doc.documento_url_local.split('?')[0].split('.').pop() || '').toLowerCase();
        extracciones.push({ nombre: doc.documento_nombre, extension: ext, n_paginas: null, metodo: 'error', texto_preview: '' });
      }
    });
  }

  // 4. Clasificar con Gemini
  const clasificacion = await clasificarConGemini(
    { codigo, nombre: licitacionNombre, monto: licitacionMonto },
    extracciones,
  );

  // 5. Normalizar
  const documentos: DocClasificado[] = (clasificacion.documentos || []).map((c: any, i: number) => ({
    archivo: c.archivo ?? extracciones[i]?.nombre ?? '',
    caja: c.caja ?? 'OTROS',
    subtipo: c.subtipo ?? null,
    n_paginas: c.n_paginas ?? extracciones[i]?.n_paginas ?? null,
    formato: c.formato ?? mapFormato(extracciones[i]?.metodo ?? '', extracciones[i]?.extension ?? ''),
    escaneado: c.escaneado ?? (extracciones[i]?.metodo === 'pdf-ocr'),
    contiene_tecnicas_integradas: c.contiene_tecnicas_integradas ?? false,
    contiene_anexos_integrados: c.contiene_anexos_integrados ?? false,
    confianza: typeof c.confianza === 'number' ? c.confianza : 0.5,
    notas: c.notas ?? '',
  }));

  // 6. Persistir categoría
  try {
    for (const doc of documentos) {
      await pool.query(
        `UPDATE documentos_cache SET categoria = ? WHERE licitacion_codigo = ? AND documento_nombre = ?`,
        [doc.caja, codigo, doc.archivo],
      );
    }
  } catch { /* columna categoria puede no existir aún */ }

  // 7. Agrupar
  const cajas = cajasVacias();
  documentos.forEach(d => cajas[d.caja]?.push(d));

  const resumen: ResumenLicitacion = clasificacion.resumen_licitacion ?? {
    estado: 'incompleto', falta: [], cajas_presentes: [], total_documentos: documentos.length,
  };

  return { success: true, codigo, licitacion_nombre: licitacionNombre, total: documentos.length, resumen_licitacion: resumen, documentos, cajas };
}
