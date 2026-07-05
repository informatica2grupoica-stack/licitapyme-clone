// app/lib/analisis-exhaustivo.ts
// Genera y guarda el análisis exhaustivo IA (tabla analisis_ia_licitacion) a partir
// de los documentos ya descargados en documentos_cache. Centraliza la lógica que antes
// estaba duplicada en auto-descargar y en licitacion-ia/[codigo].

import pool from '@/app/lib/db';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { analizarLicitacionConGemini, analizarClasificarJuzgar, truncarTextoDocumentos, ViabilidadJuicioIA } from '@/app/lib/gemini';
import { persistirClasificacionFusionada } from '@/app/lib/clasificacion';

// Documentos cuyo OCR no aporta al análisis (planos, croquis, imágenes): se omite
// OCR para no saturar la cuota de Gemini Vision y reservarla para las bases.
function noRequiereOCR(nombre: string): boolean {
  const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /plano|croquis|lamina|lámina|elevacion|planta|isometric|render|imagen|fotograf/.test(n)
    || /\.(jpg|jpeg|png|gif|bmp|tiff|webp|dwg)$/.test(n);
}

// Ejecuta fn sobre items con un límite de concurrencia (evita ráfagas de OCR → 429).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = e as R; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export interface ResultadoAnalisis {
  ok: boolean;
  error?: string;
  documentosAnalizados?: string[];
}

// ¿Ya existe análisis exhaustivo para esta licitación?
export async function tieneAnalisisExhaustivo(codigo: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1 FROM analisis_ia_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
    [codigo],
  );
  return (rows as any[]).length > 0;
}

// ─── Preparación compartida: extrae texto de los documentos (reusando caché) ───
// Común a la ruta clásica y a la fusionada: descarga/OCR con concurrencia limitada,
// reusa texto_extraido, arma `partes` (para el LLM), `itemsExcel`, `documentosDetalle`
// y `docsInfo` (señales de clasificación: páginas/formato/escaneado/tiene_texto).
interface PrepAnalisis {
  partes: Array<{ nombre: string; texto: string; categoria?: string | null }>;
  nombres: string[];
  nombresTodos: string[];
  itemsExcel: Array<{ item: string; descripcion: string; cantidad: number | null; unidad: string | null; requisitosMinimos: string | null }>;
  documentosDetalle: Array<{ nombre: string; analizado: boolean; motivo: string; metodo: string | null; chars: number }>;
  docsInfo: Array<{ nombre: string; n_paginas: number | null; formato: string; escaneado: boolean; tiene_texto: boolean }>;
}

function formatoDesde(metodo: string | null, ext: string): { formato: string; escaneado: boolean } {
  const m = (metodo || '').toLowerCase();
  const escaneado = /ocr|vision|glm|fileapi|escane|primera-pagina/.test(m);
  if (escaneado) return { formato: 'pdf_escaneado', escaneado: true };
  if (ext === 'pdf') return { formato: 'pdf_texto', escaneado: false };
  if (ext === 'xlsx' || ext === 'xls') return { formato: 'xlsx', escaneado: false };
  if (ext === 'docx') return { formato: 'docx', escaneado: false };
  if (ext === 'doc') return { formato: 'doc', escaneado: false };
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'].includes(ext)) return { formato: 'imagen', escaneado: true };
  return { formato: ext || 'otro', escaneado: false };
}

async function prepararAnalisis(
  codigo: string,
  documentos?: Array<{ url: string; nombre: string; categoria?: string | null }>,
): Promise<PrepAnalisis | { error: string }> {
  let docs: Array<{ url: string; nombre: string; categoria?: string | null; textoCache?: string | null; metodoCache?: string | null }> = documentos ?? [];
  if (!docs || docs.length === 0) {
    // Traemos también el texto YA extraído en la descarga: así evitamos re-descargar y
    // re-OCR-ear (lo caro). Ver Fix de rendimiento: la viabilidad reusa el caché.
    const [dbDocs] = await pool.query(
      `SELECT documento_nombre, documento_url_local, categoria, texto_extraido, metodo_extraccion
       FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
      [codigo],
    );
    docs = (dbDocs as any[]).map(d => ({
      url: d.documento_url_local as string,
      nombre: d.documento_nombre as string,
      categoria: (d.categoria as string) || null,
      textoCache: (d.texto_extraido as string) || null,
      metodoCache: (d.metodo_extraccion as string) || null,
    }));
  }

  if (!docs || docs.length === 0) {
    return { error: 'No hay documentos descargados para esta licitación. Descárgalos primero.' };
  }

  // Extracción con concurrencia limitada (2) — evita ráfagas de OCR que disparan 429.
  // OPTIMIZACIÓN: si el documento ya tiene texto extraído en caché (de la descarga), lo
  // reusamos y NO re-descargamos ni re-OCR-eamos (el re-OCR de un PDF escaneado costaba minutos).
  // Excepción: planillas Excel → re-extraer para recuperar los ítems estructurados.
  const resultados = await mapLimit(docs, 2, async (d) => {
    const ext = (d.nombre.split('.').pop() || '').toLowerCase();
    const esPlanilla = ext === 'xlsx' || ext === 'xls';
    const cache = (d.textoCache || '').trim();
    if (!esPlanilla && cache.length >= 50) {
      return { texto: cache, numPages: 0, metodo: d.metodoCache || 'cache', confianza: 'alta' as const };
    }
    const r = await descargarYExtraerTexto(d.url, d.nombre, { omitirOCR: noRequiereOCR(d.nombre) }).catch(() => null);
    // Persistir el texto recién extraído/OCR-eado en documentos_cache: así la próxima
    // viabilidad lo reusa y NO se vuelve a OCR-ear (cierra el ciclo del Fix A).
    if (r && r.texto && r.texto.trim().length >= 50) {
      // texto_extraido_at = NOW(): marca el refresco para que el CHATBOT invalide su contexto
      // cacheado (licitacion_contexto_chat usa MAX(texto_extraido_at)). Sin esto, el chat
      // seguiría respondiendo con el texto viejo tras un re-OCR.
      pool.query(
        `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ?, texto_extraido_at = NOW()
         WHERE licitacion_codigo = ? AND documento_nombre = ?`,
        [r.texto, r.metodo ?? 'extraido', codigo, d.nombre],
      ).catch(() => { /* best-effort: no bloquear el análisis por el cacheo */ });
    }
    return r;
  });

  const partes: PrepAnalisis['partes'] = [];
  const nombres: string[] = [];
  const nombresTodos: string[] = docs.map(d => d.nombre);
  const itemsExcel: PrepAnalisis['itemsExcel'] = [];
  const documentosDetalle: PrepAnalisis['documentosDetalle'] = [];
  const docsInfo: PrepAnalisis['docsInfo'] = [];
  docs.forEach((doc, i) => {
    const r = resultados[i];
    const ext = (doc.nombre.split('.').pop() || '').toLowerCase();
    let n_paginas: number | null = null;
    let metodo: string | null = null;
    let tieneTexto = false;
    if (r != null && !(r instanceof Error)) {
      metodo = r.metodo ?? null;
      n_paginas = (r as any).numPages || null;
      // Ítems estructurados del Excel (lista itemizada) — fiables, no dependen de la IA ni del OCR.
      if (Array.isArray((r as any).items) && (r as any).items.length > 0) {
        for (const it of (r as any).items) {
          itemsExcel.push({ item: it.item, descripcion: it.descripcion, cantidad: it.cantidad ?? null, unidad: it.unidad ?? null, requisitosMinimos: null });
        }
      }
      const chars = r.texto ? r.texto.trim().length : 0;
      if (chars >= 50) {
        tieneTexto = true;
        const t = r.texto.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
        partes.push({ nombre: doc.nombre, texto: t, categoria: (doc as any).categoria ?? null });
        nombres.push(doc.nombre);
        documentosDetalle.push({ nombre: doc.nombre, analizado: true, motivo: 'Analizado', metodo: r.metodo ?? null, chars });
      } else {
        const motivo = noRequiereOCR(doc.nombre)
          ? 'Plano/imagen — no se analiza (no aporta al texto)'
          : 'Escaneado ilegible — OCR no devolvió texto suficiente';
        documentosDetalle.push({ nombre: doc.nombre, analizado: false, motivo, metodo: r.metodo ?? null, chars });
      }
    } else {
      const motivo = ['rar', 'zip', '7z'].includes(ext)
        ? 'Comprimido (.' + ext + ') — no se puede leer automáticamente'
        : ['pdf', 'docx', 'doc', 'xlsx', 'xls'].includes(ext)
          ? 'Error al descargar o extraer el documento'
          : 'Formato no soportado (.' + ext + ')';
      documentosDetalle.push({ nombre: doc.nombre, analizado: false, motivo, metodo: null, chars: 0 });
    }
    const fmt = formatoDesde(metodo, ext);
    docsInfo.push({ nombre: doc.nombre, n_paginas, formato: fmt.formato, escaneado: fmt.escaneado, tiene_texto: tieneTexto });
  });

  if (partes.length === 0) {
    return { error: 'No se pudo extraer texto de ningún documento.' };
  }

  return { partes, nombres, nombresTodos, itemsExcel, documentosDetalle, docsInfo };
}

// Post-proceso común: completa ítems desde Excel y presupuesto por fallback determinista.
function postprocesarAnalisis(analisis: any, prep: PrepAnalisis): void {
  // Ítems del Excel (anexo económico/itemizado): si la IA extrajo menos ítems que el Excel,
  // usamos la lista del Excel (más completa y fiable, no depende del OCR ni del modelo).
  if (prep.itemsExcel.length > (analisis.especificacionesTecnicas?.length || 0)) {
    console.log(`[analisis] Usando ${prep.itemsExcel.length} ítems del Excel (IA extrajo ${analisis.especificacionesTecnicas?.length || 0}).`);
    analisis.especificacionesTecnicas = prep.itemsExcel;
  }
  // Fallback de presupuesto: si la IA no extrajo monto, buscar un TOTAL en el texto
  // (típico en presupuestos de obras en .xlsx donde el gran total no se etiqueta como "presupuesto disponible").
  if (analisis.presupuesto?.monto == null || analisis.presupuesto.monto === 0) {
    const monto = extraerPresupuestoFallback(prep.partes);
    if (monto) {
      analisis.presupuesto = { monto, moneda: 'CLP' };
      console.log(`[analisis] Presupuesto recuperado por fallback: ${monto}`);
    }
  }
}

// Genera el análisis exhaustivo desde los documentos en caché y lo guarda.
// documentos opcional: si no se pasa, se leen de documentos_cache.
export async function generarAnalisisExhaustivo(
  codigo: string,
  documentos?: Array<{ url: string; nombre: string; categoria?: string | null }>,
): Promise<ResultadoAnalisis> {
  const prep = await prepararAnalisis(codigo, documentos);
  if ('error' in prep) return { ok: false, error: prep.error };

  const textoFinal = truncarTextoDocumentos(prep.partes);
  const nombreResumen = prep.nombres.length === 1 ? prep.nombres[0] : `${prep.nombres.length} documentos`;

  const analisis = await analizarLicitacionConGemini(
    textoFinal, nombreResumen,
    { metodo: 'multi-documento', confianza: 'alta', paginas: prep.nombres.length },
  );

  if (analisis.error) return { ok: false, error: analisis.error };

  postprocesarAnalisis(analisis, prep);
  await guardarAnalisis(codigo, analisis, nombreResumen, prep.documentosDetalle);

  return { ok: true, documentosAnalizados: prep.nombres };
}

// ─── Ruta FUSIONADA: análisis + clasificación + juicio en UNA sola llamada ─────
// Misma extracción y mismo texto que la ruta clásica (misma calidad), pero UNA llamada al
// LLM produce el análisis, la clasificación documental y el juicio cualitativo de viabilidad.
// Persiste el análisis y las categorías; devuelve el juicio para que la viabilidad NO tenga
// que volver a llamar al LLM (el scoring sigue siendo determinista en viabilidad.ts).
// Si la clasificación o el juicio vienen incompletos, degrada con seguridad.
export async function generarAnalisisExhaustivoFusionado(
  codigo: string,
  documentos?: Array<{ url: string; nombre: string; categoria?: string | null }>,
): Promise<ResultadoAnalisis & { juicio?: ViabilidadJuicioIA | null }> {
  const prep = await prepararAnalisis(codigo, documentos);
  if ('error' in prep) return { ok: false, error: prep.error };

  const textoFinal = truncarTextoDocumentos(prep.partes);
  const nombreResumen = prep.nombres.length === 1 ? prep.nombres[0] : `${prep.nombres.length} documentos`;

  // Contexto de portada para clasificación/juicio (objeto, entidad, monto).
  let objeto = '', entidad = '', monto: number | null = null;
  try {
    const [lRows] = await pool.query(
      `SELECT licitacion_nombre, licitacion_organismo, licitacion_monto FROM alertas_licitaciones
       WHERE licitacion_codigo = ? ORDER BY created_at DESC LIMIT 1`,
      [codigo],
    );
    const l = (lRows as any[])[0];
    if (l) { objeto = l.licitacion_nombre || ''; entidad = l.licitacion_organismo || ''; monto = l.licitacion_monto ?? null; }
  } catch { /* tabla puede no existir en pruebas */ }

  const analisis = await analizarClasificarJuzgar(
    textoFinal, nombreResumen,
    { metodo: 'multi-documento', confianza: 'alta', paginas: prep.nombres.length },
    prep.docsInfo,
    { objeto, entidad, monto },
  );

  if (analisis.error) return { ok: false, error: analisis.error };

  postprocesarAnalisis(analisis, prep);
  await guardarAnalisis(codigo, analisis, nombreResumen, prep.documentosDetalle);

  // Persistir categorías (rellena por heurística los docs no clasificados por la IA).
  try {
    await persistirClasificacionFusionada(codigo, analisis.clasificacion || [], prep.nombresTodos);
  } catch (e) {
    console.warn('[analisis-fusionado] Persistencia de clasificación falló:', String(e).slice(0, 150));
  }

  // Juicio de viabilidad: validación mínima; si viene vacío, null → viabilidad lo recomputa.
  const vj = analisis.viabilidad;
  const juicio: ViabilidadJuicioIA | null = vj && vj.tipo_producto
    ? {
        area_negocio: ['FERRETERIA', 'EQUIPAMIENTO', 'MIXTO'].includes(vj.area_negocio as string) ? vj.area_negocio : 'MIXTO',
        tipo_producto: {
          categoria: vj.tipo_producto.categoria || 'no_identificable',
          descripcion: vj.tipo_producto.descripcion || '',
          es_importable: vj.tipo_producto.es_importable ?? true,
          especificacion_dirigida: vj.tipo_producto.especificacion_dirigida ?? (vj.tipo_producto.categoria === 'dirigida'),
        },
        descripcion_producto_para_busqueda: vj.descripcion_producto_para_busqueda || '',
        informe: {
          resumen: vj.informe?.resumen || '',
          ventaja_competitiva: vj.informe?.ventaja_competitiva || '',
          riesgos: Array.isArray(vj.informe?.riesgos) ? vj.informe.riesgos : [],
          alertas: Array.isArray(vj.informe?.alertas) ? vj.informe.alertas : [],
          recomendacion: vj.informe?.recomendacion || '',
        },
      }
    : null;

  return { ok: true, documentosAnalizados: prep.nombres, juicio };
}

// ─── Guardado resiliente del análisis ─────────────────────────────────────────
// Guarda el análisis en analisis_ia_licitacion. La columna `documentos_detalle`
// (migración 15) es opcional: si no existe en la BD, reintenta sin ella en vez de
// romper toda la cadena de análisis → viabilidad.
async function guardarAnalisis(
  codigo: string,
  analisis: any,
  nombreResumen: string,
  documentosDetalle: unknown,
  conDetalle = true,
): Promise<void> {
  const cols = [
    'licitacion_codigo',
    'presupuesto_monto', 'presupuesto_moneda', 'plazo_ejecucion_dias', 'plazo_entrega_dias',
    'modalidad_adjudicacion', 'tipo_contrato', 'lugar_entrega',
    'criterios_evaluacion', 'requisitos', 'garantias', 'multas',
    'contacto', 'especificaciones_tecnicas', 'documentos_a_presentar',
    'resumen_bases_admin', 'resumen_bases_tecnicas',
    'analisis_experto', 'documento_analizado',
    ...(conDetalle ? ['documentos_detalle'] : []),
    'modelo',
  ];
  const vals = [
    codigo,
    analisis.presupuesto?.monto        ?? null,
    analisis.presupuesto?.moneda       ?? null,
    analisis.plazoEjecucionDias        ?? null,
    analisis.plazoEntregaDias          ?? null,
    analisis.modalidadAdjudicacion     ?? null,
    analisis.tipoContrato              ?? null,
    analisis.lugarEntrega              ?? null,
    JSON.stringify(analisis.criteriosEvaluacion    || []),
    JSON.stringify(analisis.requisitos             || null),
    JSON.stringify(analisis.garantias              || []),
    JSON.stringify(analisis.multas                 || []),
    JSON.stringify(analisis.contacto               ?? null),
    JSON.stringify(analisis.especificacionesTecnicas || []),
    JSON.stringify(analisis.documentosAPresenter   || []),
    JSON.stringify(analisis.resumenBasesAdmin      ?? null),
    JSON.stringify(analisis.resumenBasesTecnicas   ?? null),
    JSON.stringify(analisis.analisisExperto        || null),
    nombreResumen,
    ...(conDetalle ? [JSON.stringify(documentosDetalle)] : []),
    'gemini-2.5-flash',
  ];
  // Columnas que se actualizan en ON DUPLICATE KEY (todas menos la PK licitacion_codigo).
  const updates = cols.slice(1).map(c => `${c} = VALUES(${c})`).join(',\n       ');
  const placeholders = cols.map(() => '?').join(', ');

  try {
    await pool.query(
      `INSERT INTO analisis_ia_licitacion (${cols.join(', ')})
       VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE
       ${updates}`,
      vals,
    );
  } catch (e: any) {
    // Si la columna documentos_detalle no existe (migración 15 pendiente), reintentar sin ella.
    if (conDetalle && e?.code === 'ER_BAD_FIELD_ERROR' && /documentos_detalle/.test(String(e?.message))) {
      console.warn('[analisis] Columna documentos_detalle ausente (falta migración 15); guardando sin el detalle por documento.');
      await guardarAnalisis(codigo, analisis, nombreResumen, documentosDetalle, false);
      return;
    }
    throw e;
  }
}

// ─── Fallback determinista de presupuesto ─────────────────────────────────────
// CONSERVADOR: solo acepta montos que aparezcan inmediatamente después de una
// etiqueta FUERTE de presupuesto (p.ej. "presupuesto disponible: $X"). No usa
// máximos globales para evitar falsos positivos (folios, RUTs, plantillas vacías).
const ETIQUETAS_PRESUPUESTO = [
  'presupuesto disponible', 'presupuesto estimado', 'presupuesto referencial',
  'presupuesto maximo', 'presupuesto total', 'presupuesto del proyecto',
  'monto disponible', 'monto maximo', 'monto estimado', 'monto referencial',
  'financiamiento', 'recursos disponibles', 'valor referencial',
];

function parseMontoCLP(s: string): number | null {
  const limpio = s.replace(/[^\d.,]/g, '');
  if (!limpio) return null;
  let n = limpio;
  if (/,\d{1,2}$/.test(n)) n = n.replace(/,\d{1,2}$/, '');
  n = n.replace(/[.,]/g, '');
  const val = parseInt(n, 10);
  return isNaN(val) ? null : val;
}

export function extraerPresupuestoFallback(partes: Array<{ nombre: string; texto: string }>): number | null {
  const MONTO_MIN = 1_000_000;
  const MONTO_MAX = 100_000_000_000;
  // Etiqueta fuerte seguida (en ≤40 chars) de un monto con separadores de miles.
  const candidatos: number[] = [];

  for (const p of partes) {
    const low = p.texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const etq of ETIQUETAS_PRESUPUESTO) {
      let from = 0;
      let idx: number;
      while ((idx = low.indexOf(etq, from)) !== -1) {
        from = idx + etq.length;
        const ventana = p.texto.slice(idx + etq.length, idx + etq.length + 40);
        const m = ventana.match(/\$?\s*\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?/);
        if (m) {
          const val = parseMontoCLP(m[0]);
          if (val != null && val >= MONTO_MIN && val <= MONTO_MAX) candidatos.push(val);
        }
      }
    }
  }

  // El mayor entre los etiquetados (suele ser el total, no un subítem).
  return candidatos.length > 0 ? Math.max(...candidatos) : null;
}
