// app/lib/chat-licitacion.ts
// Backend del chatbot por licitación.
//
// Idea central: NO re-descargar ni re-OCR-ear en cada pregunta. El texto de cada
// documento ya está en documentos_cache.texto_extraido (lo llena la viabilidad IA).
// Aquí solo se CONCATENA/CACHEA ese texto y se responde con un LLM:
//   - Corpus completo de la licitación → construirContextoChat (cacheado en
//     licitacion_contexto_chat, se invalida cuando cambian/re-extraen documentos).
//   - Un solo documento (chat rápido por fila) → construirContextoDocumento (una fila
//     de documentos_cache, sin cache propio: es poco texto).
//
// Historial persistido en chat_licitacion por sesion_id ("corpus" para el panel
// completo; "doc:<nombre>" para el chat rápido de un documento).
//
// Modelo principal: GLM de Z.AI, fijado a glm-4.7 (MODELO_CHAT_PRINCIPAL más abajo) — NO el
// glm-4.7-flashx por defecto del resto del sistema, ver el comentario junto a esa constante.
// Respaldo automático (cfgTextoRespaldos en gemini.ts): otro modelo GLM más liviano, luego
// DeepSeek. Gemini está RETIRADO (dormido salvo GEMINI_HABILITADO=1 + key).

import pool from './db';
import { geminiHabilitado } from './gemini';
import { crearChatIAChatbot, MOTOR_CHAT } from './chat-ia';
import { ocrTieneHuecos } from './zai-ocr';
import { filtroDocsVisibles, codigoAlmacenDocs, CLIENTE_ICA } from './tenant';

// AUDITORÍA ago-2026 (alucinaciones reportadas por el dueño): medido en BD, 27.6% de las
// licitaciones (291/1053) tenían un corpus > 180_000 chars y se truncaban — perdiendo bases
// técnicas/anexos completos sin que el modelo lo supiera con claridad. La viabilidad (mismo
// modelo GLM, mismo proveedor) ya usa 350_000 chars (~95k tokens, ver MAX_CHARS_DOCS_ANALISIS en
// viabilidad-ia.ts) porque glm-4.7 aguanta ese contexto de sobra — se alinea el chat al mismo
// tope en vez de quedarse más corto sin motivo. Con 350k, p95 de corpus real (355_501) casi
// entra completo: solo ~5% de licitaciones (las más grandes) siguen truncando.
export const MAX_CHARS_CONTEXTO = Math.max(60_000, Number(process.env.CHAT_MAX_CHARS_CONTEXTO) || 350_000);

// Precedencia documental para el corpus del chat: si hay que truncar, se conserva lo
// soberano (aclaraciones/bases) y se sacrifican anexos/planos. Menor nº = va primero.
// Mismo criterio que la viabilidad (prioridadDoc), para que el chat "vea" lo mismo.
function prioridadChat(nombre: string, categoria: string | null): number {
  if (esPropio(categoria)) return 7; // lo nuestro va después de lo oficial, antes solo de los planos
  const n = `${nombre} ${categoria || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/aclarac|respuesta|consulta|foro/.test(n)) return 0;
  if (/especial/.test(n)) return 1;
  if (/administrativ|bases_admin/.test(n)) return 2;
  if (/tecnic/.test(n)) return 3;
  if (/anexo|formulario|declarac/.test(n)) return 5;
  if (/plano|croquis|lamina|elevacion|planta|isometric|render|imagen|fotograf/.test(n)) return 9;
  return 4;
}

// Los Excel de costeo que genera la app (COSTEO_<código>_<fecha>.xlsx) son ruido que infla el
// contexto; el costeo ya entra por construirContextoProyecto. Se excluyen del corpus.
// Los DOCUMENTOS_PROPIOS (anexos rellenados, órdenes de compra, lo que sube Compras) SÍ entran:
// son nuestra oferta y nuestro avance. Van al final (prioridadChat) para que, si hay que
// truncar, nunca desplacen a las bases, y se rotulan como nuestros en el marcador.
const FILTRO_NO_PROPIOS = `AND documento_nombre NOT LIKE 'COSTEO\\_%'`;
const esPropio = (categoria: string | null) => (categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS';
// Turnos recientes que se envían al modelo como memoria de la conversación.
const MAX_TURNOS = 6;

const MODELO_GEMINI = 'gemini-2.5-flash';

// Cada documento se envuelve con este marcador para que el modelo pueda citar de qué
// documento salió cada dato. Mismo formato en el corpus y en el doc individual. Si el método de
// extracción fue de menor confianza (OCR incompleto o de respaldo), se agrega una ADVERTENCIA
// visible en el propio marcador — así el modelo la ve pegada al texto que debe tratar con cautela,
// en vez de asumir que todo el corpus tiene la misma fiabilidad.
const marcador = (nombre: string, advertencia?: string) =>
  `[[DOCUMENTO: ${nombre}${advertencia ? ` — ADVERTENCIA: ${advertencia}` : ''}]]`;

// Métodos de extracción que NO son de máxima confianza (ver document-extraction.ts). El chat no
// tenía forma de saberlo: aunque el texto ya venía marcado con el hueco literal OCR_NO_DISPONIBLE
// cuando la extracción quedó incompleta, el prompt nunca le explicaba al modelo qué significa esa
// marca ni que un documento entero podía ser de menor fiabilidad — sin ese aviso, el modelo trataba
// ese texto igual que el resto y podía "leer" con seguridad algo que en realidad es un hueco.
function advertenciaExtraccion(metodo: string | null, texto: string): string | undefined {
  if (ocrTieneHuecos(texto)) return 'este documento tiene páginas que aún no se pudieron leer por OCR (marcadas como OCR_NO_DISPONIBLE en el texto) — no asumas que esas páginas no dicen nada, simplemente no se pudieron leer todavía';
  if (metodo === 'pdf-tesseract-local' || metodo === 'pdf-glm-ocr+tesseract-relleno') return 'texto leído por OCR de respaldo (menor precisión que el OCR principal), puede tener errores de reconocimiento en cifras o nombres';
  if (metodo === 'pdf-sin-ocr' || metodo === 'pdf-sin-texto' || metodo === 'pdf-error' || metodo === 'word-error' || metodo === 'excel-error') return 'extracción de baja confianza, puede tener texto incompleto o mal reconocido';
  return undefined;
}

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente';
  mensaje: string;
}

// ─── Contexto: corpus completo de la licitación (cacheado) ──────────────────────
export async function construirContextoChat(
  codigo: string,
  clienteId: number = CLIENTE_ICA,
): Promise<{ texto: string; encontrado: boolean; numDocumentos: number; actualizadoEn: Date | null }> {
  // Firma barata de las fuentes: cuántos documentos tienen texto y cuándo se extrajo
  // el más nuevo. Sirve para invalidar el cache sin leer todos los LONGTEXT, y también
  // para saber desde cuándo el historial de chat deja de ser confiable (ver `actualizadoEn`).
  // Multiempresa: los documentos oficiales son de todos; los que subió una empresa solo los ve ella (tenant.ts).
  const docs0 = filtroDocsVisibles(clienteId, codigo);
  const claveCache = codigoAlmacenDocs(clienteId, codigo);
  const [srcRows] = await pool.query(
    `SELECT COUNT(*) AS n, MAX(texto_extraido_at) AS max_dt, COALESCE(MAX(UNIX_TIMESTAMP(texto_extraido_at)), 0) AS maxts
       FROM documentos_cache
      WHERE ${docs0.sql} AND texto_extraido IS NOT NULL AND texto_extraido <> ''
        ${FILTRO_NO_PROPIOS}`,
    docs0.params,
  );
  const src = (srcRows as any[])[0];
  const nDocs = Number(src?.n || 0);
  const actualizadoEn: Date | null = src?.max_dt ?? null;
  if (nDocs === 0) return { texto: '', encontrado: false, numDocumentos: 0, actualizadoEn };

  // ¿Cache vigente? Válido si mismo nº de documentos y ninguno se re-extrajo después.
  const [cacheRows] = await pool.query(
    `SELECT contexto_texto, num_documentos, UNIX_TIMESTAMP(actualizado_en) AS act
       FROM licitacion_contexto_chat WHERE licitacion_codigo = ? LIMIT 1`,
    [claveCache],
  );
  const cache = (cacheRows as any[])[0];
  if (
    cache &&
    cache.contexto_texto &&
    Number(cache.num_documentos) === nDocs &&
    Number(src.maxts) <= Number(cache.act)
  ) {
    return { texto: cache.contexto_texto, encontrado: true, numDocumentos: nDocs, actualizadoEn };
  }

  // Reconstruir el corpus desde el texto ya extraído (excluyendo documentos propios).
  // metodo_extraccion viaja también: sirve para marcar en el propio corpus los documentos de
  // menor confianza (OCR de respaldo, extracción incompleta) — ver advertenciaExtraccion().
  const [docRows] = await pool.query(
    `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto, metodo_extraccion AS metodo
       FROM documentos_cache
      WHERE ${docs0.sql} AND texto_extraido IS NOT NULL AND texto_extraido <> ''
        ${FILTRO_NO_PROPIOS}
      ORDER BY id ASC`,
    docs0.params,
  );
  // Orden por PRECEDENCIA (aclaraciones/bases primero) para que un eventual truncado
  // sacrifique lo de menor jerarquía (anexos/planos) y nunca las bases con el presupuesto.
  const docs = (docRows as Array<{ nombre: string; categoria: string | null; texto: string; metodo: string | null }>)
    .sort((a, b) => prioridadChat(a.nombre, a.categoria) - prioridadChat(b.nombre, b.categoria));
  let texto = docs
    .map(d => {
      const t = (d.texto || '').trim();
      const nombre = esPropio(d.categoria) ? `${d.nombre} (DOCUMENTO PROPIO: lo subimos nosotros, no es de la licitación)` : d.nombre;
      return `${marcador(nombre, advertenciaExtraccion(d.metodo, t))}\n${t}`;
    })
    .join('\n\n');
  if (texto.length > MAX_CHARS_CONTEXTO) {
    texto = texto.slice(0, MAX_CHARS_CONTEXTO) +
      '\n\n[[CONTEXTO TRUNCADO: por límite de tamaño se omitió el resto — quedaron afuera documentos ' +
      'de MENOR jerarquía (anexos/planos/formularios); las bases y aclaraciones, si entran en el ' +
      'presupuesto de caracteres, van primero y completas. Si la pregunta trata algo que razonablemente ' +
      'estaría en un documento que no ves arriba, NO respondas como si ese documento no existiera o no ' +
      'dijera nada: dilo explícitamente ("no tengo ese documento cargado en este momento; puedes abrirlo ' +
      'y preguntar directamente sobre él") en vez de inventar o asumir su contenido.]]';
  }

  await pool.query(
    `INSERT INTO licitacion_contexto_chat (licitacion_codigo, contexto_texto, num_chars, num_documentos)
       VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       contexto_texto = VALUES(contexto_texto),
       num_chars      = VALUES(num_chars),
       num_documentos = VALUES(num_documentos),
       actualizado_en = CURRENT_TIMESTAMP`,
    [claveCache, texto, texto.length, docs.length],
  );

  return { texto, encontrado: true, numDocumentos: docs.length, actualizadoEn };
}

// ─── Contexto del PROYECTO: lo que hemos analizado además de los documentos ─────
// Burbuja flotante: la licitación entera es una unidad. Además del corpus de documentos se
// agrega el estado del negocio, el informe de viabilidad y el costeo guardado. Se arma en cada
// pregunta (consultas baratas, sin cache) porque cambia con cada análisis/edición. Cada bloque es
// best-effort: una tabla ausente o un JSON roto no debe tumbar el chat.
const MAX_CHARS_BLOQUE = 40_000;

// JSON.stringify convierte las fechas a UTC con «Z» (cierre 18:43 en Chile salía «21:43Z» y el chat respondía 21:43: 3 h de más, caso real
// 1410-37-LE26). Las fechas de la base están en hora de Chile: aquí se escriben tal cual, «AAAA-MM-DD HH:mm:ss».
const FECHA_CHILE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function jsonHoraChile(v: unknown): string {
  return JSON.stringify(v, function (this: any, k: string, val: unknown) {
    const orig = this[k];
    return orig instanceof Date && !Number.isNaN(orig.getTime()) ? FECHA_CHILE.format(orig) : val;
  });
}

const recortar = (s: string) =>
  s.length > MAX_CHARS_BLOQUE ? `${s.slice(0, MAX_CHARS_BLOQUE)}\n[[BLOQUE RECORTADO por tamaño]]` : s;

export async function construirContextoProyecto(codigo: string, clienteId: number = CLIENTE_ICA): Promise<string> {
  const bloques: string[] = [];
  // Multiempresa: el negocio, el costeo y el historial son los de ESTA empresa; la viabilidad v4 y las reglas son solo de Grupo ICA.
  const MI = `COALESCE(cliente_id, 1) = ${Number(clienteId)}`;

  try {
    const [rows] = await pool.query(
      `SELECT licitacion_nombre, licitacion_organismo, licitacion_monto, licitacion_cierre,
              licitacion_estado, monto_ofertado
         FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE AND ${MI} ORDER BY id ASC LIMIT 1`,
      [codigo],
    );
    const n = (rows as any[])[0];
    if (n) bloques.push(`[[ANÁLISIS: FICHA DEL NEGOCIO]]\n${recortar(jsonHoraChile(n))}`);
  } catch { /* sin negocio */ }

  if (clienteId === CLIENTE_ICA) try {
    const [rows] = await pool.query(
      `SELECT score_total, semaforo, informe_ejecutivo, notas_analista, updated_at
         FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
      [codigo],
    );
    const v = (rows as any[])[0];
    if (v) {
      let informe: unknown = v.informe_ejecutivo;
      if (typeof informe === 'string') { try { informe = JSON.parse(informe); } catch { /* texto crudo */ } }
      const ia = (informe as any)?._informe_ia ?? informe;
      bloques.push(`[[ANÁLISIS: VIABILIDAD (generada ${v.updated_at ? new Date(v.updated_at).toISOString().slice(0, 10) : 's/f'})]]\n${recortar(JSON.stringify(ia ?? {}))}`);
    }
  } catch { /* sin viabilidad */ }

  // Viabilidad PROPIA de otra empresa (cliente_viabilidad / _v4): la última de esa licitación, solo la suya.
  if (clienteId !== CLIENTE_ICA) {
    try {
      const [rows] = await pool.query(
        `SELECT veredicto, puntaje, dictamen, created_at FROM cliente_viabilidad WHERE cliente_id = ? AND licitacion_codigo = ? ORDER BY id DESC LIMIT 1`, [clienteId, codigo]);
      const v = (rows as any[])[0];
      if (v) bloques.push(`[[ANÁLISIS: VIABILIDAD (generada ${v.created_at ? new Date(v.created_at).toISOString().slice(0, 10) : 's/f'}; veredicto ${v.veredicto ?? 's/d'}, puntaje ${v.puntaje ?? 's/d'})]]\n${recortar(typeof v.dictamen === 'string' ? v.dictamen : JSON.stringify(v.dictamen ?? {}))}`);
    } catch { /* sin viabilidad propia */ }
    try {
      const [rows] = await pool.query(
        `SELECT informe, nivel_atractivo, created_at FROM cliente_viabilidad_v4 WHERE cliente_id = ? AND licitacion_codigo = ? ORDER BY id DESC LIMIT 1`, [clienteId, codigo]);
      const v = (rows as any[])[0];
      if (v?.informe) bloques.push(`[[ANÁLISIS: VIABILIDAD V4 (generada ${v.created_at ? new Date(v.created_at).toISOString().slice(0, 10) : 's/f'}; atractivo ${v.nivel_atractivo ?? 's/d'})]]\n${recortar(String(v.informe))}`);
    } catch { /* sin viabilidad v4 propia */ }
  }

  try {
    const [rows] = await pool.query(
      `SELECT c.modalidad, c.datos_json, c.actualizado_at
         FROM negocio_costeo_editor c JOIN negocios n ON n.id = c.negocio_id
        WHERE n.licitacion_codigo = ? AND n.activo = TRUE AND COALESCE(n.cliente_id, 1) = ${Number(clienteId)} ORDER BY c.actualizado_at DESC LIMIT 1`,
      [codigo],
    );
    const c = (rows as any[])[0];
    if (c?.datos_json) bloques.push(`[[ANÁLISIS: COSTEO GUARDADO (modalidad ${c.modalidad})]]\n${recortar(String(c.datos_json))}`);
  } catch { /* sin costeo */ }

  // ── Resto del menú del negocio: Líneas, Resultado, Preguntas, Auditor, Postulación ──
  // Columnas verificadas contra la BD (INFORMATION_SCHEMA). Cada bloque es independiente.
  const filas = async (titulo: string, sql: string, params: unknown[]) => {
    try {
      const [rows] = await pool.query(sql, params);
      if ((rows as any[]).length) bloques.push(`[[ANÁLISIS: ${titulo}]]\n${recortar(jsonHoraChile(rows))}`);
    } catch { /* tabla o columna ausente */ }
  };
  const NEG = `(SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE AND ${MI} ORDER BY id ASC LIMIT 1)`;

  await filas('LÍNEAS DE LA LICITACIÓN (¿ofertamos cada una?)',
    `SELECT linea_numero, nombre_linea, ofertamos FROM negocio_lineas_oferta WHERE negocio_id = ${NEG} ORDER BY linea_numero`, [codigo]);

  await filas('RESULTADO: ADJUDICACIÓN',
    `SELECT es_adjudicada, estado, fecha_adjudicacion, fecha_estimada_adjudicacion, tipo_adjudicacion, numero_resolucion,
            numero_oferentes, monto_adjudicado_total, lineas, readjudicada_en
       FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);

  // `oferta_competencia.es_nuestra` se grabó con las razones sociales de Grupo ICA: a otra empresa se le calcula con SUS RUT (tabla empresas).
  const rutNorm = (c: string) => `REPLACE(REPLACE(LOWER(CONVERT(${c} USING utf8mb4)), '.', ''), ' ', '') COLLATE utf8mb4_unicode_ci`;
  await filas('RESULTADO: OFERTAS DE LA COMPETENCIA (es_nuestra=1 es la nuestra)',
    clienteId === CLIENTE_ICA
      ? `SELECT proveedor_nombre, proveedor_rut, linea_numero, linea_descripcion, monto, estado, es_nuestra
           FROM oferta_competencia WHERE licitacion_codigo = ? ORDER BY linea_numero, monto`
      : `SELECT proveedor_nombre, proveedor_rut, linea_numero, linea_descripcion, monto, estado,
                (${rutNorm('proveedor_rut')} IN (SELECT ${rutNorm('rut')} FROM empresas WHERE cliente_id = ${Number(clienteId)} AND rut IS NOT NULL AND rut <> '')) AS es_nuestra
           FROM oferta_competencia WHERE licitacion_codigo = ? ORDER BY linea_numero, monto`,
    [codigo]);

  await filas('PREGUNTAS Y RESPUESTAS DEL FORO',
    `SELECT n_preguntas, respondido, fecha_publicacion_respuestas, preguntas FROM preguntas_respuestas_cache WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);

  // Auditor: lo que se exige (checklist), lo que ofertamos, lo pendiente y los costos asociados.
  await filas('AUDITOR: CHECKLIST (requisitos, estado de cada uno; estado distinto de cumplido/aprobado = pendiente)',
    `SELECT bloque, tipo, titulo, criticidad, linea_numero, ofertamos, estado, valor_texto, valor_numero, precio_manual, observacion
       FROM checklist_comercial WHERE negocio_id = ${NEG} ORDER BY bloque, linea_numero, orden`, [codigo]);

  await filas('AUDITOR: OPCIONES DE PRODUCTO/PROVEEDOR POR LÍNEA',
    `SELECT fila_id, marca, modelo, proveedor_razon_social, via, estado, motivo_descarte
       FROM auditor_opcion WHERE negocio_id = ${NEG} ORDER BY fila_id, id`, [codigo]);

  await filas('AUDITOR: VERIFICACIÓN TÉCNICA POR OPCIÓN (última pasada)',
    `SELECT v.opcion_id, v.estado_tecnico, v.pasada, v.creado_at
       FROM auditor_verificacion_tecnica v
       JOIN (SELECT opcion_id, MAX(id) mid FROM auditor_verificacion_tecnica WHERE negocio_id = ${NEG} GROUP BY opcion_id) u ON u.mid = v.id`, [codigo]);

  await filas('AUDITOR: COSTOS ASOCIADOS QUE EXIGEN LAS BASES',
    `SELECT materia, exige_base_literal, fuente_bases, cuantificacion, criticidad, monto_estimado
       FROM auditor_costo_asociado WHERE negocio_id = ${NEG} AND (anulado IS NULL OR anulado = 0)`, [codigo]);

  // Postulación: compromisos y exigencias confirmadas antes de postular.
  await filas('POSTULACIÓN: COMPROMISOS DE LAS BASES (confirmado=0 y no_aplica=0 → falta revisarlo)',
    `SELECT fila_id, materia, exige_base_literal, fuente_bases, se_compromete, cuantificacion, criticidad, confirmado, no_aplica, nota
       FROM auditor_prepost_item WHERE negocio_id = ${NEG} ORDER BY fila_id, id`, [codigo]);

  // Conversación del equipo, recorrido del negocio y módulo de Compras.
  await filas('COMENTARIOS DEL EQUIPO (más recientes primero)',
    `SELECT u.nombre AS autor, c.pipeline_estado AS etapa, c.comentario, c.created_at
       FROM comentarios_negocio c LEFT JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.negocio_id = ${NEG} ORDER BY c.created_at DESC LIMIT 80`, [codigo]);

  await filas('RECORRIDO DEL NEGOCIO (eventos, más recientes primero)',
    `SELECT tipo, mensaje, actor_nombre, created_at FROM historial_eventos
      WHERE licitacion_codigo = ? AND ${MI} ORDER BY created_at DESC LIMIT 60`, [codigo]);

  await filas('COMPRAS: PRODUCTOS A COMPRAR',
    `SELECT id, correlativo, descripcion, cantidad, unidad, monto_unitario, subestado, renuncia_motivo
       FROM compras_producto WHERE negocio_id = ${NEG} ORDER BY correlativo`, [codigo]);

  await filas('COMPRAS: APROBACIONES POR PRODUCTO',
    `SELECT producto_id, estado, comentario, resuelto_por_nombre, resuelto_at
       FROM compras_aprobacion_linea WHERE negocio_id = ${NEG}`, [codigo]);

  await filas('COMPRAS: COTIZACIONES DE PROVEEDORES',
    `SELECT proveedor_nombre, descripcion_libre, precio_unitario_clp, precio_total_clp, plazo_entrega_dias, incluye_flete, notas, created_at
       FROM compras_cotizacion WHERE negocio_id = ${NEG} ORDER BY id`, [codigo]);

  await filas('COMPRAS: TAREAS (estado, responsable, plazo)',
    `SELECT categoria, titulo, estado, responsable_nombre, plazo_at, cerrado_at, nota_cierre, hallazgo
       FROM compras_tarea WHERE negocio_id = ${NEG} ORDER BY orden`, [codigo]);

  await filas('COMPRAS: AUDITORÍA DEL NEGOCIO',
    `SELECT resumen, alertas_json, plazo_entrega_json FROM compras_agente_auditoria_negocio WHERE negocio_id = ${NEG} LIMIT 1`, [codigo]);

  return bloques.join('\n\n');
}

// ─── Contexto: un solo documento (chat rápido por fila) ─────────────────────────
// Sin cache propio: es una sola fila, mucho menos texto → respuesta más rápida.
export async function construirContextoDocumento(
  codigo: string,
  documentoNombre: string,
  clienteId: number = CLIENTE_ICA,
): Promise<{ texto: string; encontrado: boolean; actualizadoEn: Date | null }> {
  const dv = filtroDocsVisibles(clienteId, codigo);
  const [rows] = await pool.query(
    `SELECT texto_extraido AS texto, texto_extraido_at AS actualizadoEn, metodo_extraccion AS metodo
       FROM documentos_cache
      WHERE ${dv.sql} AND documento_nombre = ? LIMIT 1`,
    [...dv.params, documentoNombre],
  );
  const fila = (rows as any[])[0];
  const raw = (fila?.texto || '').trim();
  const actualizadoEn: Date | null = fila?.actualizadoEn ?? null;
  if (!raw) return { texto: '', encontrado: false, actualizadoEn };

  let texto = `${marcador(documentoNombre, advertenciaExtraccion(fila?.metodo ?? null, raw))}\n${raw}`;
  if (texto.length > MAX_CHARS_CONTEXTO) {
    texto = texto.slice(0, MAX_CHARS_CONTEXTO) +
      '\n\n[[DOCUMENTO TRUNCADO: por límite de tamaño no se incluyó el resto de este documento. Si la ' +
      'pregunta apunta a una parte que no ves arriba, dilo explícitamente en vez de asumir su contenido.]]';
  }
  return { texto, encontrado: true, actualizadoEn };
}

// ─── Historial ──────────────────────────────────────────────────────────────────
// `soloDesde`: si viene, descarta turnos ANTERIORES a esa fecha. Se usa para que el modelo no
// "recuerde" respuestas dadas sobre un documento que después se reprocesó (ej. un re-OCR que
// completó páginas que antes venían con huecos): sin este corte, el LLM tiende a repetir su
// propia respuesta vieja de la conversación en vez de releer el contexto fresco que se le mandó
// en el mismo turno — vimos exactamente este caso en 3310-35-LE26 (respondía "página 26 no
// disponible" 18 minutos DESPUÉS de que el re-OCR ya la había completado). El historial completo
// (para mostrarlo en la UI) sigue viniendo de una llamada sin este filtro.
export async function obtenerHistorial(
  codigo: string,
  sesionId: string,
  soloDesde: Date | null = null,
): Promise<MensajeHistorial[]> {
  const [rows] = await pool.query(
    `SELECT rol, mensaje FROM chat_licitacion
      WHERE licitacion_codigo = ? AND sesion_id = ? ${soloDesde ? 'AND creado_en > ?' : ''}
      ORDER BY creado_en ASC, id ASC`,
    soloDesde ? [codigo, sesionId, soloDesde] : [codigo, sesionId],
  );
  return (rows as any[]).map(r => ({ rol: r.rol as 'usuario' | 'asistente', mensaje: r.mensaje }));
}

/** Borra los turnos DE ESE USUARIO en esa conversación (la de la licitación es compartida: no se borra lo que escribieron otros). */
export async function borrarHistorial(codigo: string, sesionId: string, usuarioId: number): Promise<number> {
  const [r] = await pool.query(
    `DELETE FROM chat_licitacion WHERE licitacion_codigo = ? AND sesion_id = ? AND usuario_id = ?`, [codigo, sesionId, usuarioId]);
  return Number((r as { affectedRows?: number }).affectedRows || 0);
}

export async function guardarTurno(
  codigo: string,
  sesionId: string,
  pregunta: string,
  respuesta: string,
  modelo: string,
  usuarioId: number | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_licitacion (licitacion_codigo, sesion_id, rol, mensaje, modelo, usuario_id)
     VALUES (?, ?, 'usuario', ?, NULL, ?), (?, ?, 'asistente', ?, ?, ?)`,
    [codigo, sesionId, pregunta, usuarioId, codigo, sesionId, respuesta, modelo, usuarioId],
  );
}

// ─── Respuesta del modelo ────────────────────────────────────────────────────────
// AUDITORÍA ANTI-ALUCINACIÓN (ago-2026): la versión anterior de este prompt solo decía "no
// inventes" al pasar, sin darle al modelo un PROCEDIMIENTO concreto ni explicarle las señales que
// el propio sistema ya le manda en el contexto (marca de hueco de OCR, aviso de truncado,
// documentos de menor confianza) — el modelo no tenía cómo distinguir "el dato no está" de "el
// dato está en la parte que no llegué a leer". Reescrito con la misma técnica de "regla de oro
// anti-alucinación" + procedimiento explícito que ya usa anexos-ia-motor.ts (SYS_CAMPOS) para el
// relleno de anexos, adaptada a respuesta libre en vez de JSON estructurado.
const REGLAS = `Eres ankIA, el asistente de lectura de documentos de LICITANK, experto en licitaciones públicas de Chile (Ley 19.886, DS 250, portal Mercado Público).
Respondes preguntas sobre UNA licitación usando EXCLUSIVAMENTE el contenido de los documentos entregados abajo. Tu conocimiento de licitaciones chilenas es solo para ENTENDER ese texto (jerga, siglas, estructura típica de unas bases) — NUNCA para rellenar con lo "típico" o "esperable" un dato que el texto no trae.

PROCEDIMIENTO OBLIGATORIO (síguelo en orden antes de responder):
1. Busca el dato TEXTUALMENTE en los documentos entregados. Si no aparece tal cual (como cifra, fecha, plazo o requisito exacto), NO existe para ti — no lo estimes, no lo completes por analogía con licitaciones típicas, no "redondees".
2. Todo dato duro (monto, plazo, fecha, porcentaje, requisito, garantía, multa, criterio de evaluación) debe quedar asociado al documento del que salió, citando su marcador tal como aparece en el contexto (cada documento viene envuelto en [[DOCUMENTO: nombre]]). Si no puedes señalar de qué documento sale un dato, no lo afirmes como hecho: dilo como "no encontrado" en vez de arriesgarlo.
3. Si el dato NO aparece en ningún documento, dilo con honestidad y así de explícito: "No aparece en los documentos disponibles." NUNCA inventes cifras, plazos ni requisitos para no dejar la respuesta incompleta — una respuesta incompleta pero honesta es correcta; una completa pero inventada es el peor resultado posible.
4. Si dentro del texto de un documento ves la marca "OCR_NO_DISPONIBLE", esa parte específica todavía no se pudo leer por OCR — es un HUECO, no evidencia de que el documento no menciona el dato. Si la pregunta cae ahí, dilo explícitamente ("esa parte del documento aún no se pudo leer por OCR, no puedo confirmarlo") en vez de responder como si esa sección no existiera o no dijera nada.
5. Si un documento trae "ADVERTENCIA" en su marcador (extracción incompleta o de menor confianza), trata sus datos con más cautela y avísale al usuario en la respuesta en vez de darlos con total seguridad.
6. Si ves un bloque "[[CONTEXTO TRUNCADO...]]" o "[[DOCUMENTO TRUNCADO...]]", parte de los documentos no llegó a tu contexto por tamaño. Si la pregunta apunta a algo que razonablemente estaría en lo que falta y no lo ves en lo que sí tienes, dilo ("no tengo ese documento cargado en este momento") — nunca lo interpretes como que ese documento no existe o no trata el tema.
7. El HISTORIAL de la conversación es solo para seguir el hilo de la charla, JAMÁS una fuente de datos: si respondiste algo antes y el contexto de documentos (que se te reenvía completo en cada turno) lo contradice, corrígelo — prevalece siempre lo que dicen los documentos AHORA, no lo que dijiste antes.

8. Si además de los documentos ves bloques "[[ANÁLISIS: ...]]" (ficha del negocio, viabilidad, costeo), son análisis NUESTROS ya hechos sobre esta licitación: úsalos para responder sobre el estado, el costo o la viabilidad, y distingue siempre qué viene de un documento oficial y qué de un análisis interno. Si un análisis contradice un documento, prevalece el documento y avísalo.

9. Los documentos rotulados "DOCUMENTO PROPIO" los subimos NOSOTROS (anexos ya rellenados, órdenes de compra, planillas): muestran qué ofertamos o qué hemos avanzado, NO lo que exige la licitación. Nunca los uses para decir qué pide la licitación; sí para decir qué hicimos o qué falta respecto de lo que ella pide.

9b. Las fechas y horas que vienen en los bloques [[ANÁLISIS]] y en los datos de la base ya están en HORA DE CHILE: léelas tal cual. NUNCA las conviertas de zona horaria ni les sumes o restes horas (18:43 es 18:43, no 21:43). No comentes esta regla ni digas que te la dieron: da la hora sin más.

Estilo de respuesta:
- Cita el documento en paréntesis y sin los corchetes del marcador: (Nombre del documento, pág. N). Nunca copies "[[DOCUMENTO: …]]" tal cual.
- Habla como una persona del equipo que ya leyó todo el expediente y conversa con un colega: español chileno natural, en primera persona ("revisé", "no encuentro"), tuteando, con «tú» (quieres, necesitas, puedes): nunca voseo ("querés") ni vosotros ("necesitáis"), sin fórmulas de robot ("Según los documentos proporcionados…", "Espero que esto ayude").
- Parte por la respuesta, en una o dos frases, y después da el detalle si hace falta. Prosa corrida por defecto; viñetas o tabla solo cuando haya 4 o más elementos que de verdad se leen mejor en lista.
- Sin emojis, sin encabezados con # y sin "Sugerencia:" al final. Negrita solo para cifras, plazos y fechas clave.
- Si no entendiste la pregunta o falta un dato para responder, pregunta de vuelta con naturalidad en vez de adivinar.
- Sé conciso en preguntas puntuales: ve al punto, sin relleno — pero nunca sacrifiques una advertencia de dato faltante o incierto por ir más rápido.

LISTADOS EXHAUSTIVOS (prevalece sobre "sé conciso"): si piden "todos", "cada", "el listado completo", "sin omitir" o una tabla de requisitos/características, la prioridad es la COMPLETITUD, no la brevedad. Una fila por cada requisito (nunca varios requisitos fundidos en una celda ni resumidos), en el orden del documento, recorriendo TODOS los apartados del equipo o ítem: generales, motor, transmisión, seguridad, carrocería, equipamiento, certificaciones y documentación, garantía, mantención y capacitación. Está prohibido abreviar con "etc.", "entre otros" o "ver bases". Si hay varios equipos, repite el recorrido completo con cada uno y no los recortes para ganar espacio: la respuesta puede ser tan larga como haga falta. Antes de cerrar, revisa que cada apartado de la sección del documento quedó cubierto.`;

function historialParaModelo(historial: MensajeHistorial[]): MensajeHistorial[] {
  // Solo los últimos MAX_TURNOS pares (usuario+asistente) para no inflar el prompt.
  return historial.slice(-MAX_TURNOS * 2);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Gemini 2.5-flash vía REST (texto). Alterna al alias estable ante 429/503.
async function responderConGemini(contexto: string, historial: MensajeHistorial[], pregunta: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const contents = [
    { role: 'user', parts: [{ text: `DOCUMENTOS DE LA LICITACIÓN:\n\n${contexto}` }] },
    { role: 'model', parts: [{ text: 'Entendido. Tengo el contenido de los documentos de esta licitación. ¿Qué necesitas saber?' }] },
    ...historialParaModelo(historial).map(h => ({
      role: h.rol === 'usuario' ? 'user' : 'model',
      parts: [{ text: h.mensaje }],
    })),
    { role: 'user', parts: [{ text: pregunta }] },
  ];

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: REGLAS }] },
    contents,
    // thinkingBudget:0 → sin tokens de "thinking" (un chat sobre contexto dado no lo necesita):
    // ahorra tokens y evita que el thinking se coma el presupuesto y devuelva texto vacío.
    generationConfig: { temperature: 0.1, maxOutputTokens: 8_000, thinkingConfig: { thinkingBudget: 0 } },
  });

  const MODELOS = [MODELO_GEMINI, 'gemini-flash-latest'];
  const ESPERAS = [0, 5_000];
  let ultimoErr = '';
  for (let i = 0; i < MODELOS.length; i++) {
    if (i > 0) await sleep(ESPERAS[i]);
    const modelo = MODELOS[i];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) },
    );
    if (res.ok) {
      const data = await res.json();
      const texto = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
      if (texto) return texto;
      ultimoErr = `${modelo}: respuesta vacía (finishReason=${data.candidates?.[0]?.finishReason})`;
      continue;
    }
    ultimoErr = `${modelo} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`;
    if (res.status !== 429 && res.status !== 503) break;
  }
  throw new Error(`Gemini no respondió: ${ultimoErr}`);
}

// AUDITORÍA ago-2026: el chat usaba el proveedor de texto ACTIVO sin fijar modelo, es decir
// GLM_TEXT_MODEL por defecto (glm-4.7-flashx) — el rung más barato/rápido de la cadena, el mismo
// que el propio .env.local documenta como causante de "manifiestos de ítems vacíos/errados" en la
// viabilidad, y que anexos-ia-motor.ts/auditor-tecnico.ts evitan a propósito con modeloPreferido
// (glm-4.7 / glm-5.2) para sus pasos más sensibles a errores. El chat responde directo al usuario
// sin ningún validador/guardarraíl posterior (a diferencia de viabilidad y anexos, que sí tienen
// uno) — es exactamente el caso donde MENOS conviene el modelo más barato. Se fija glm-4.7 (el
// mismo que anexos-ia-motor.ts eligió tras medir que flashx confundía datos): más cuidadoso,
// sigue siendo GLM (mismo costo de cuenta), y NO se activa soloGlm para no perder el respaldo
// DeepSeek — el dueño lo quiere reservado justo para el chat (ver cfgTextoRespaldos en gemini.ts).
// Trade-off asumido: ~5-8x más caro por token que flashx (glm-4.7 $0.60/$2.20 vs flashx
// $0.07/$0.4 por M) — aceptable porque el chat es interactivo (una llamada por pregunta de un
// humano), no una corrida batch sobre miles de licitaciones como la viabilidad.
// DECISIÓN 2026-11-17: el motor de los chatbots es Kimi económico (K2.6) y el respaldo GLM (chat-ia.ts). Esta etiqueta solo se usa si la
// respuesta no trae el nombre del modelo.
const MODELO_CHAT_PRINCIPAL = MOTOR_CHAT;

// Respaldo con el proveedor de texto activo (GLM de Z.AI por defecto; DeepSeek si se revierte).
async function responderConIA(contexto: string, historial: MensajeHistorial[], pregunta: string): Promise<{ texto: string; modelo: string }> {
  const messages = [
    { role: 'system' as const, content: `${REGLAS}\n\nDOCUMENTOS DE LA LICITACIÓN:\n\n${contexto}` },
    ...historialParaModelo(historial).map(h => ({
      role: (h.rol === 'usuario' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: h.mensaje,
    })),
    { role: 'user' as const, content: pregunta },
  ];
  // Una respuesta larga (p. ej. "todas las características de cada equipo") se cortaba a mitad de tabla por el tope de salida. Si el modelo
  // termina por largo (finish_reason=length), se le pide que continúe exactamente donde quedó y se unen los tramos.
  let texto = '';
  let modeloUsado = MODELO_CHAT_PRINCIPAL;
  for (let ronda = 0; ronda < 5; ronda++) {
    const completion: any = await crearChatIAChatbot(
      { messages: ronda === 0 ? messages : [...messages, { role: 'assistant' as const, content: texto }, { role: 'user' as const, content: 'Continúa EXACTAMENTE donde quedaste, sin repetir lo ya escrito ni saludar. Si estabas dentro de una tabla, sigue con la siguiente fila.' }],
        temperature: 0.1, stream: false, max_tokens: 8_000 },
      { timeoutMs: 120_000 },
    );
    modeloUsado = String(completion.model || MODELO_CHAT_PRINCIPAL);
    const tramo = (completion.choices[0]?.message?.content ?? '').trim();
    if (!tramo && ronda === 0) throw new Error(`${MODELO_CHAT_PRINCIPAL}: respuesta vacía`);
    texto = ronda === 0 ? tramo : `${texto}
${tramo}`;
    if (!tramo || completion.choices[0]?.finish_reason !== 'length') break;
  }
  return { texto, modelo: modeloUsado };
}

export async function responderChat(opts: {
  contexto: string;
  historial: MensajeHistorial[];
  pregunta: string;
}): Promise<{ respuesta: string; modelo: string }> {
  const { contexto, historial, pregunta } = opts;
  // Principal: GLM de Z.AI (crearChatIA ya trae respaldo DeepSeek automático). Gemini está
  // RETIRADO: su respaldo solo corre si se reactiva a propósito (GEMINI_HABILITADO=1 + key).
  try {
    const { texto: respuesta, modelo } = await responderConIA(contexto, historial, pregunta);
    return { respuesta, modelo };
  } catch (e) {
    if (!geminiHabilitado()) throw e;
    console.warn('[chat-licitacion] GLM falló, uso Gemini de respaldo:', e instanceof Error ? e.message : e);
    const respuesta = await responderConGemini(contexto, historial, pregunta);
    return { respuesta, modelo: MODELO_GEMINI };
  }
}

/** Multiempresa: la conversación de una empresa-cliente nunca se mezcla con la de otra aunque hablen de la misma licitación
 *  (Grupo ICA conserva sus ids de siempre). Cabe en el varchar(64) de `sesion_id`. */
export function sesionDeEmpresa(clienteId: number, sesionId: string): string {
  return clienteId === CLIENTE_ICA ? sesionId.slice(0, 64) : `c${clienteId}:${sesionId}`.slice(0, 64);
}
