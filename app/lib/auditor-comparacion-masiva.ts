// app/lib/auditor-comparacion-masiva.ts
// MOTOR de "Comparar contra un documento" del Auditor Técnico: toma UNA ficha/catálogo del
// proveedor y la contrasta contra TODAS las líneas técnicas del negocio.
//
// ── POR QUÉ SE REESCRIBIÓ (19-ago-2026, caso real 3489-29-LP26 reportado por el usuario) ───────
// La versión anterior (inline en app/api/negocios/[id]/comercial/route.ts) comparaba 3 de 88
// líneas y dejaba 85 "sin validar". Tres causas, las tres arregladas acá:
//
//   1. QUÉ LÍNEAS SE AUDITAN. Iteraba `lineasTecnicasDelInforme(informe)`, o sea
//      informe.productos.items. Ese arreglo lo escribe un LLM y TRUNCA las listas largas: en
//      3489-29-LP26 traía 3 productos cuando el propio informe declaraba total_items=76 y el
//      checklist ya tenía 88 líneas materializadas de un análisis anterior. Ahora la fuente de
//      verdad es el CHECKLIST (tabla checklist_comercial): lo que el usuario ve en pantalla es
//      exactamente lo que se compara.
//
//   2. DE DÓNDE SALEN LAS ESPECIFICACIONES EXIGIDAS. Si el informe no trae caracteristicas[] para
//      una línea, se reconstruyen desde las BASES TÉCNICAS cacheadas (documentos_cache), que sí
//      están completas. El auditor deja de depender de que el LLM de viabilidad no trunque.
//
//   3. CONTRA QUÉ TEXTO SE COMPARA. Mandaba la ficha ENTERA (36.000 caracteres, 88 productos) en
//      cada una de las llamadas, una por línea: impreciso (el modelo se contamina con el producto
//      vecino) y carísimo (~3 millones de tokens de entrada). Ahora la ficha se segmenta por ítem
//      (auditor-segmentacion.ts) y cada línea se compara solo contra SU bloque.
//
// Corre como trabajo de FONDO (tabla auditor_tecnico_jobs, migración 70): 88 líneas no caben en
// una petición HTTP, y el túnel corta a los ~100s. El front hace polling y muestra el avance.

import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { agregarDocumentos, bitacora } from '@/app/lib/checklist-comercial-db';
import {
  clasificarCaracteristicasLinea, compararFichaProveedor, evaluarCaracteristicaDeterminista,
  slugCaracteristica, lineasTecnicasDelInforme, type LineaTecnica,
} from '@/app/lib/auditor-tecnico';
import {
  segmentarPorItems, mapearBloquesALineas, caracteristicasDeBloque, type BloqueDocumento,
} from '@/app/lib/auditor-segmentacion';

const COLS_CARACT = `id, item_id, negocio_id, clave_caracteristica, orden, descripcion, tipo,
  valor_requerido_texto, valor_requerido_numero, valor_requerido_numero_max, unidad_requerida,
  valor_ofertado_texto, valor_ofertado_numero, unidad_ofertada_original, valor_convertido_numero,
  veredicto, pendiente_confirmacion_proveedor, fundamento_documento, fundamento_cita, confianza, origen`;

/** Cuántas líneas se procesan a la vez. La cadena GLM aguanta bien este paralelismo y baja el
 *  tiempo total de ~40 min (secuencial, 88 líneas) a pocos minutos, sin gatillar 429. */
const CONCURRENCIA = 4;

/** Tope de texto por llamada cuando NO se pudo segmentar y hay que mandar el documento completo
 *  (comportamiento antiguo, ahora solo como último recurso). */
const TOPE_TEXTO_COMPLETO = 40_000;

export interface ResultadoLinea {
  lineaNumero: number;
  itemId: number;
  titulo: string;
  total: number;
  cumplen: number;
  noCumplen: number;
  /** De dónde salieron las especificaciones exigidas que se usaron para juzgar esta línea. */
  fuenteRequisitos: 'ya_clasificadas' | 'informe' | 'bases_tecnicas' | null;
  /** true si la ficha se pudo segmentar y esta línea se comparó contra su propio bloque. */
  segmentada: boolean;
  error?: string;
}

export interface ResumenComparacion {
  documento: string;
  lineasTotales: number;
  lineasComparadas: number;
  bloquesFicha: number;
  resultados: ResultadoLinea[];
}

// ═══ Job persistido ══════════════════════════════════════════════════════════════════════════
// Mismo patrón que viabilidad_jobs (migración 68): sobrevive a un reinicio del contenedor, y el
// GET detecta huérfanos por `actualizado_at` en vez de fingir que no hay nada corriendo.

export interface JobComparacion {
  negocio_id: number; run_id: string; estado: 'procesando' | 'error' | 'listo';
  fase: string | null; documento_nombre: string | null;
  total: number; procesadas: number; error: string | null;
  resumen_json: string | null; edad_seg: number; elapsed_seg: number;
}

/** Sin señales de vida por este tiempo ⇒ el job murió con el proceso. Holgado: una línea puede
 *  tardar hasta 90s (timeout de la IA) y hay CONCURRENCIA líneas en vuelo. */
export const JOB_HUERFANO_SEG = 420;

export async function leerJobComparacion(negocioId: number): Promise<JobComparacion | null> {
  const [rows] = await pool.query(
    `SELECT *,
            TIMESTAMPDIFF(SECOND, actualizado_at, UTC_TIMESTAMP()) AS edad_seg,
            TIMESTAMPDIFF(SECOND, iniciado_at,    UTC_TIMESTAMP()) AS elapsed_seg
       FROM auditor_tecnico_jobs WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  return (rows as any[])[0] ?? null;
}

async function marcarProcesando(negocioId: number, runId: string, doc: string, total: number, fase: string) {
  await pool.query(
    `INSERT INTO auditor_tecnico_jobs
       (negocio_id, run_id, estado, fase, documento_nombre, total, procesadas, error, resumen_json, iniciado_at, actualizado_at)
     VALUES (?, ?, 'procesando', ?, ?, ?, 0, NULL, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE run_id = VALUES(run_id), estado = 'procesando', fase = VALUES(fase),
       documento_nombre = VALUES(documento_nombre), total = VALUES(total), procesadas = 0,
       error = NULL, resumen_json = NULL, iniciado_at = UTC_TIMESTAMP(), actualizado_at = UTC_TIMESTAMP()`,
    [negocioId, runId, fase.slice(0, 60), doc.slice(0, 300), total],
  );
}

/** Latido + avance. Best-effort y acotado por run_id: una corrida vieja nunca pisa a una nueva. */
async function avanzar(negocioId: number, runId: string, fase?: string) {
  try {
    await pool.query(
      `UPDATE auditor_tecnico_jobs
          SET procesadas = procesadas + 1, fase = COALESCE(?, fase), actualizado_at = UTC_TIMESTAMP()
        WHERE negocio_id = ? AND run_id = ? AND estado = 'procesando'`,
      [fase?.slice(0, 60) ?? null, negocioId, runId],
    );
  } catch (e) { console.error('[auditor-masivo] avanzar falló:', String(e).slice(0, 200)); }
}

async function marcarFase(negocioId: number, runId: string, fase: string, total?: number) {
  try {
    await pool.query(
      `UPDATE auditor_tecnico_jobs SET fase = ?, total = COALESCE(?, total), actualizado_at = UTC_TIMESTAMP()
        WHERE negocio_id = ? AND run_id = ? AND estado = 'procesando'`,
      [fase.slice(0, 60), total ?? null, negocioId, runId],
    );
  } catch (e) { console.error('[auditor-masivo] marcarFase falló:', String(e).slice(0, 200)); }
}

export async function marcarJobError(negocioId: number, runId: string, mensaje: string) {
  await pool.query(
    `UPDATE auditor_tecnico_jobs SET estado = 'error', error = ?, actualizado_at = UTC_TIMESTAMP()
      WHERE negocio_id = ? AND run_id = ?`,
    [mensaje.slice(0, 500), negocioId, runId],
  );
}

async function marcarJobListo(negocioId: number, runId: string, resumen: ResumenComparacion) {
  await pool.query(
    `UPDATE auditor_tecnico_jobs SET estado = 'listo', fase = NULL, resumen_json = ?, actualizado_at = UTC_TIMESTAMP()
      WHERE negocio_id = ? AND run_id = ?`,
    [JSON.stringify(resumen).slice(0, 60_000), negocioId, runId],
  );
}

// ═══ Fuentes de las especificaciones exigidas ════════════════════════════════════════════════

/**
 * Bloques de las BASES TÉCNICAS de la licitación, uno por ítem, sacados del texto ya cacheado
 * (documentos_cache). Se juntan TODOS los documentos técnicos: en 3489-29-LP26 las
 * especificaciones vienen repartidas en dos PDF ("Equipos" y "Equipamiento"), cada uno numerado
 * desde ÍTEM 1 — por eso el mapeo posterior va por nombre y no por número.
 */
async function bloquesDeBasesTecnicas(licitacionCodigo: string): Promise<BloqueDocumento[]> {
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, texto_extraido
         FROM documentos_cache
        WHERE licitacion_codigo = ?
          AND categoria IN ('BASES_TECNICAS', 'ANEXOS_TECNICOS')
          AND texto_extraido IS NOT NULL AND CHAR_LENGTH(texto_extraido) > 200`,
      [licitacionCodigo],
    ) as any;
    const out: BloqueDocumento[] = [];
    for (const r of rows as any[]) out.push(...segmentarPorItems(String(r.texto_extraido)));
    return out;
  } catch (e) {
    console.error('[auditor-masivo] no se pudieron leer las bases técnicas:', String(e).slice(0, 200));
    return [];
  }
}

// ═══ Motor ═══════════════════════════════════════════════════════════════════════════════════

interface Contexto {
  negocioId: number;
  licitacionCodigo: string;
  userId: number;
  nombreActor: string;
  documentoUrl: string;
  documentoNombre: string;
}

/**
 * Arranca la comparación en segundo plano y devuelve el runId de inmediato. La promesa sigue viva
 * tras responder (el server es persistente); el avance se sigue por leerJobComparacion().
 */
export async function iniciarComparacionMasiva(
  ctx: Contexto, informe: any, onFin?: () => void,
): Promise<{ runId: string } | { error: string }> {
  const [itemRows] = await pool.query(
    `SELECT id, linea_numero, titulo, estado FROM checklist_comercial
      WHERE negocio_id = ? AND tipo = 'linea_tecnica' ORDER BY linea_numero`,
    [ctx.negocioId],
  ) as any;
  const items = itemRows as any[];
  if (!items.length) return { error: 'Este negocio no tiene líneas técnicas que auditar.' };

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await marcarProcesando(ctx.negocioId, runId, ctx.documentoNombre, items.length, 'leyendo documento');

  correr(ctx, runId, items, informe)
    .then(resumen => marcarJobListo(ctx.negocioId, runId, resumen))
    .catch(e => {
      console.error('[auditor-masivo] job falló:', e);
      return marcarJobError(ctx.negocioId, runId, mensajeDeError(e));
    })
    .finally(() => { try { onFin?.(); } catch { /* el aviso al front no debe tumbar el job */ } });

  return { runId };
}

function mensajeDeError(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  if (msg.includes('429') || /quota/i.test(msg)) return 'El servicio de IA quedó sin cuota (429). Reintenta más tarde.';
  if (msg.includes('503') || /saturad/i.test(msg)) return 'El servicio de IA está saturado. Reintenta en unos minutos.';
  return `No se pudo completar la comparación. (${msg.slice(0, 160)})`;
}

async function correr(ctx: Contexto, runId: string, items: any[], informe: any): Promise<ResumenComparacion> {
  // ── 1) Leer la ficha y partirla por producto ──────────────────────────────────────────────
  const extraido = await descargarYExtraerTexto(ctx.documentoUrl, ctx.documentoNombre);
  const textoFicha = extraido?.texto?.trim() || '';
  if (textoFicha.length < 30) throw new Error('No se pudo leer texto del documento. Si es un escaneo, vuelve a subirlo con OCR.');

  const lineas = items.map(i => ({ linea: i.linea_numero as number, nombre: nombreDeItem(i.titulo) }));
  const bloquesFicha = segmentarPorItems(textoFicha);
  const mapaFicha = mapearBloquesALineas(lineas, bloquesFicha);

  // ── 2) Especificaciones exigidas: informe si las trae, si no, bases técnicas ───────────────
  await marcarFase(ctx.negocioId, runId, 'ubicando especificaciones', items.length);
  const delInforme = new Map<number, LineaTecnica>();
  for (const l of lineasTecnicasDelInforme(informe)) if (l.caracteristicas.length) delInforme.set(l.linea, l);

  // Solo se paga la lectura de las bases si alguna línea de verdad la necesita.
  const faltantes = lineas.filter(l => !delInforme.has(l.linea));
  const mapaBases = faltantes.length
    ? mapearBloquesALineas(faltantes, await bloquesDeBasesTecnicas(ctx.licitacionCodigo))
    : { porLinea: new Map<number, BloqueDocumento>(), sobrantes: [] };

  // ── 3) Una línea a la vez por worker, CONCURRENCIA workers en paralelo ────────────────────
  await marcarFase(ctx.negocioId, runId, 'comparando');
  const resultados: ResultadoLinea[] = new Array(items.length);
  let siguiente = 0;
  const worker = async () => {
    for (;;) {
      const idx = siguiente++;
      if (idx >= items.length) return;
      const item = items[idx];
      try {
        resultados[idx] = await procesarLinea(ctx, item, {
          bloqueFicha: mapaFicha.porLinea.get(item.linea_numero) || null,
          textoCompleto: textoFicha,
          lineaInforme: delInforme.get(item.linea_numero) || null,
          bloqueBases: mapaBases.porLinea.get(item.linea_numero) || null,
        });
      } catch (e) {
        // Una línea que revienta no puede llevarse el lote completo: se anota y se sigue.
        console.error(`[auditor-masivo] línea ${item.linea_numero} falló:`, String(e).slice(0, 300));
        resultados[idx] = {
          lineaNumero: item.linea_numero, itemId: item.id, titulo: nombreDeItem(item.titulo),
          total: 0, cumplen: 0, noCumplen: 0, fuenteRequisitos: null, segmentada: false,
          error: String((e as any)?.message ?? e).slice(0, 200),
        };
      }
      await avanzar(ctx.negocioId, runId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, items.length) }, worker));

  const finales = resultados.filter(Boolean);
  return {
    documento: ctx.documentoNombre,
    lineasTotales: items.length,
    lineasComparadas: finales.filter(r => r.total > 0).length,
    bloquesFicha: bloquesFicha.length,
    resultados: finales,
  };
}

/** "Línea 12 — SILLA DE RUEDAS" → "SILLA DE RUEDAS". El prefijo lo pone el checklist. */
function nombreDeItem(titulo: string): string {
  return String(titulo || '').replace(/^L[íi]nea\s+\d+\s*[—–-]\s*/i, '').trim();
}

async function procesarLinea(
  ctx: Contexto, item: any,
  fuentes: {
    bloqueFicha: BloqueDocumento | null; textoCompleto: string;
    lineaInforme: LineaTecnica | null; bloqueBases: BloqueDocumento | null;
  },
): Promise<ResultadoLinea> {
  const base: ResultadoLinea = {
    lineaNumero: item.linea_numero, itemId: item.id, titulo: nombreDeItem(item.titulo),
    total: 0, cumplen: 0, noCumplen: 0, fuenteRequisitos: null, segmentada: !!fuentes.bloqueFicha,
  };

  // ── a) Características ya clasificadas en BD ───────────────────────────────────────────────
  let existentes = await leerCaracteristicas(item.id);
  let fuente: ResultadoLinea['fuenteRequisitos'] = existentes.length ? 'ya_clasificadas' : null;

  // ── b) Si no hay, clasificarlas: informe primero, bases técnicas si el informe no las trae ─
  if (!existentes.length) {
    let textos: string[] = [];
    if (fuentes.lineaInforme?.caracteristicas.length) {
      textos = fuentes.lineaInforme.caracteristicas;
      fuente = 'informe';
    } else if (fuentes.bloqueBases) {
      textos = caracteristicasDeBloque(fuentes.bloqueBases);
      fuente = 'bases_tecnicas';
    }
    if (!textos.length) {
      return { ...base, error: 'No se encontraron especificaciones exigidas para esta línea (ni en el informe ni en las bases técnicas).' };
    }
    const linea: LineaTecnica = {
      linea: item.linea_numero, nombre: base.titulo,
      clasificacion: fuentes.lineaInforme?.clasificacion ?? null,
      marcaModeloReferencia: fuentes.lineaInforme?.marcaModeloReferencia ?? null,
      admiteEquivalente: fuentes.lineaInforme?.admiteEquivalente ?? null,
      caracteristicas: textos,
      cantidad: fuentes.lineaInforme?.cantidad ?? null,
      unidadMedida: fuentes.lineaInforme?.unidadMedida ?? null,
    };
    await guardarClasificadas(item, ctx.negocioId, linea, ctx.licitacionCodigo,
      fuente === 'bases_tecnicas' ? 'Bases técnicas' : 'Informe de viabilidad');
    existentes = await leerCaracteristicas(item.id);
  }

  if (!existentes.length) return { ...base, fuenteRequisitos: fuente, error: 'Sin características clasificables' };

  // ── c) Comparar contra el bloque de la ficha (o el documento entero si no se pudo segmentar) ─
  const textoAComparar = fuentes.bloqueFicha
    ? fuentes.bloqueFicha.texto
    : fuentes.textoCompleto.slice(0, TOPE_TEXTO_COMPLETO);
  const nombreCitado = fuentes.bloqueFicha
    ? `${ctx.documentoNombre} · ${fuentes.bloqueFicha.titulo}`
    : ctx.documentoNombre;

  const veredictos = await compararFichaProveedor(
    existentes.map(c => ({
      id: c.id, descripcion: c.descripcion, tipo: c.tipo,
      valorRequeridoNumero: c.valor_requerido_numero != null ? Number(c.valor_requerido_numero) : null,
      valorRequeridoNumeroMax: c.valor_requerido_numero_max != null ? Number(c.valor_requerido_numero_max) : null,
      unidadRequerida: c.unidad_requerida, valorRequeridoTexto: c.valor_requerido_texto,
    })),
    textoAComparar, nombreCitado,
  );

  let cumplen = 0, noCumplen = 0;
  for (const c of existentes) {
    const v = veredictos.get(c.id);
    if (!v) continue;
    let convertido: number | null = null;
    let veredictoFinal = v.veredicto;
    const valorReqNum = c.valor_requerido_numero != null ? Number(c.valor_requerido_numero) : null;
    // El paso determinista MANDA sobre el juicio de la IA cuando ambos valores son numéricos:
    // convertir unidades y comparar es aritmética, no criterio.
    if (v.valorOfertadoNumero != null && valorReqNum != null) {
      const det = evaluarCaracteristicaDeterminista({
        tipo: c.tipo, valorRequeridoNumero: valorReqNum,
        valorRequeridoNumeroMax: c.valor_requerido_numero_max != null ? Number(c.valor_requerido_numero_max) : null,
        unidadRequerida: c.unidad_requerida, valorOfertadoNumero: v.valorOfertadoNumero,
        unidadOfertadaOriginal: v.unidadOfertadaOriginal,
      });
      if (det) { convertido = det.valorConvertidoNumero; veredictoFinal = det.veredicto; }
    }
    await pool.query(
      `UPDATE checklist_comercial_caracteristicas
          SET valor_ofertado_texto = ?, valor_ofertado_numero = ?, unidad_ofertada_original = ?,
              valor_convertido_numero = ?, veredicto = ?, pendiente_confirmacion_proveedor = ?,
              fundamento_documento = ?, fundamento_cita = COALESCE(?, fundamento_cita), confianza = ?, origen = 'ficha'
        WHERE id = ?`,
      [
        v.valorOfertadoTexto, v.valorOfertadoNumero, v.unidadOfertadaOriginal, convertido,
        veredictoFinal, (v.pendienteConfirmacionProveedor || !veredictoFinal) ? 1 : 0,
        v.fundamentoDocumento, v.fundamentoCita, v.confianza, c.id,
      ],
    );
    if (veredictoFinal === 'CUMPLE') cumplen++;
    else if (veredictoFinal === 'NO_CUMPLE') noCumplen++;
  }

  // La ficha queda adjunta como evidencia de la línea (mismo "Ver documento" del resto del
  // checklist), para no depender solo del nombre citado en cada fila.
  await agregarDocumentos(item.id, ctx.negocioId, [{ url: ctx.documentoUrl, nombre: ctx.documentoNombre }], ctx.userId, ctx.nombreActor);

  await autoTransicionar(ctx, item, fuentes.bloqueFicha?.titulo || null);

  return { ...base, total: existentes.length, cumplen, noCumplen, fuenteRequisitos: fuente };
}

async function leerCaracteristicas(itemId: number): Promise<any[]> {
  const [rows] = await pool.query(
    `SELECT ${COLS_CARACT} FROM checklist_comercial_caracteristicas WHERE item_id = ? ORDER BY orden, id`,
    [itemId],
  ) as any;
  return rows as any[];
}

async function guardarClasificadas(
  item: any, negocioId: number, linea: LineaTecnica, licitacionCodigo: string, fuenteDoc: string,
): Promise<void> {
  const clasificadas = await clasificarCaracteristicasLinea(linea, { licitacionCodigo });
  let orden = 0;
  for (const c of clasificadas) {
    await pool.query(
      `INSERT IGNORE INTO checklist_comercial_caracteristicas
         (item_id, negocio_id, clave_caracteristica, orden, descripcion, tipo,
          valor_requerido_texto, valor_requerido_numero, valor_requerido_numero_max, unidad_requerida,
          fundamento_documento, fundamento_cita, confianza, origen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'interrogatorio')`,
      [item.id, negocioId, slugCaracteristica(c.descripcion), orden++, c.descripcion, c.tipo,
       c.valorRequeridoTexto, c.valorRequeridoNumero, c.valorRequeridoNumeroMax, c.unidadRequerida,
       fuenteDoc, c.fundamentoCita, c.confianza],
    );
  }
  // El checklist mostraba el conteo del informe viejo ("1 característica(s)") aunque ahora haya
  // 13 reales: se refresca para que la fila diga la verdad.
  await pool.query(
    `UPDATE checklist_comercial SET descripcion = ? WHERE id = ?`,
    [`${clasificadas.length} característica(s) técnica(s) a verificar.`, item.id],
  );
}

/**
 * Mismo criterio que .../[itemId]/caracteristicas: si la línea quedó completamente resuelta y sin
 * excepciones, se aprueba sola (no hay nada que decidir); si quedó algún incumplimiento o algo
 * pendiente de confirmar, pasa a CARGADO para que el asesor lo mire.
 */
async function autoTransicionar(ctx: Contexto, item: any, bloqueTitulo: string | null): Promise<void> {
  const [chkRows] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(veredicto IS NULL) AS sin_evaluar,
            SUM(pendiente_confirmacion_proveedor = 1) AS pendientes,
            SUM(veredicto = 'NO_CUMPLE') AS no_cumplen,
            SUM(veredicto = 'CUMPLE_CON_COMPLEMENTO') AS con_complemento
       FROM checklist_comercial_caracteristicas WHERE item_id = ?`,
    [item.id],
  ) as any;
  const chk = (chkRows as any[])[0];
  if (!chk || Number(chk.total) === 0) return;

  const ahora = ahoraChileSQL();
  const detalle = `Comparado en lote contra "${ctx.documentoNombre}"${bloqueTitulo ? ` (bloque "${bloqueTitulo}")` : ''}`;
  const resuelta = Number(chk.sin_evaluar) === 0 && Number(chk.pendientes) === 0;

  if (resuelta && Number(chk.no_cumplen) === 0 && Number(chk.con_complemento) === 0) {
    await pool.query(
      `UPDATE checklist_comercial
          SET estado = 'APROBADO', cargado_por = ?, cargado_por_nombre = ?, cargado_at = ?,
              aprobado_por = NULL, aprobado_por_nombre = ?, aprobado_at = ?
        WHERE id = ?`,
      [ctx.userId, ctx.nombreActor, ahora, `Auto-aprobado (${Number(chk.total)}/${Number(chk.total)} cumple)`, ahora, item.id],
    );
    await bitacora(item.id, ctx.negocioId, 'AUTO_APROBAR', item.estado, 'APROBADO',
      `${detalle} — ${Number(chk.total)}/${Number(chk.total)} cumplen, sin excepciones`, ctx.userId, ctx.nombreActor);
    return;
  }

  if (item.estado === 'PENDIENTE') {
    await pool.query(
      `UPDATE checklist_comercial SET estado = 'CARGADO', cargado_por = ?, cargado_por_nombre = ?, cargado_at = ? WHERE id = ?`,
      [ctx.userId, ctx.nombreActor, ahora, item.id],
    );
    await bitacora(item.id, ctx.negocioId, 'CARGAR', item.estado, 'CARGADO',
      `${detalle} — ${Number(chk.no_cumplen)} no cumple(n), ${Number(chk.sin_evaluar)} sin dato en la ficha`,
      ctx.userId, ctx.nombreActor);
  }
}
