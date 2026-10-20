// app/lib/chat-global.ts
// Chat GENERAL de la burbuja (fuera de una licitación): preguntas sobre TODAS las licitaciones que
// ha visto el sistema (qué equipo se repite, tipos de licitación, competencia, resultados).
//
// No se le pasa "todo" al modelo: no cabe y para contar/rankear un LLM se equivoca. En cambio:
//   1. el modelo traduce la pregunta a UNA consulta SELECT sobre tablas de una lista blanca;
//   2. el código la valida y la ejecuta en una transacción READ ONLY con tope de filas y tiempo;
//   3. el modelo redacta la respuesta SOLO con las filas devueltas (los números los pone la BD).
// MySQL 5.7: sin JSON_TABLE ni CTE; los ítems se buscan con LIKE sobre items_json (texto).

import pool from './db';
import { crearChatIA as crearChatIABase } from './gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
import type { MensajeHistorial } from './chat-licitacion';

const crearChatIA = conModuloIA('consultas', crearChatIABase);
const MODELO = 'glm-4.7';
const MAX_FILAS = 200;
const MAX_CHARS_FILAS = 30_000;
const MAX_TURNOS = 6;

// Solo estas tablas pueden aparecer en la consulta. Nada de usuarios, contraseñas ni tokens.
const TABLAS_PERMITIDAS = [
  'licitaciones_cache', 'negocios', 'oferta_competencia', 'adjudicacion_cache',
  'viabilidad_licitacion', 'compras_producto', 'compras_historial_oc', 'compras_historial_oc_item',
  'precios_mercado', 'documentos_cache', 'checklist_comercial', 'auditor_opcion', 'preguntas_respuestas_cache',
];

const ESQUEMA = `BASE DE DATOS (MySQL 5.7, solo lectura). Tablas y columnas disponibles:

licitaciones_cache — TODAS las licitaciones que el sistema ha visto de Mercado Público (~32.000, desde 2009):
  codigo, nombre, descripcion, organismo, region, monto, estado ('Publicada','Cerrada','Adjudicada','Desierta','Revocada','Suspendida'), tipo (LE, LP, L1, etc.), fecha_cierre, fecha_publicacion,
  items_json (TEXTO JSON con los productos pedidos: "NombreProducto", "Descripcion", "Categoria", cantidades; búscalo con LIKE '%palabra%')
negocios — licitaciones que NOSOTROS tomamos (una fila por licitación asignada; usa activo=1):
  id, licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto, licitacion_cierre, licitacion_estado, licitacion_tipo, licitacion_region,
  estado_pipeline ('ASIGNADO','EN_PROCESO','ANEXOS','VISADO','POSTULADA','POSIBLE_ADJ','ADJUDICADA' = GANADA,'PERDIDA','DESIERTA','REVOCADA','DESCARTADA'), monto_ofertado, postulada_en, descarte_motivo, created_at
oferta_competencia — ofertas de los competidores en licitaciones donde miramos el resultado:
  licitacion_codigo, proveedor_rut, proveedor_nombre, linea_numero, linea_descripcion, monto, estado, es_nuestra (1 = oferta nuestra)
adjudicacion_cache — resultado de adjudicación por licitación:
  licitacion_codigo, es_adjudicada, estado, fecha_adjudicacion, tipo_adjudicacion, numero_oferentes, monto_adjudicado_total
viabilidad_licitacion — análisis de viabilidad: licitacion_codigo, score_total, semaforo, area_negocio, nivel_atractivo, nivel_presupuesto_neto
compras_producto — productos de los negocios que compramos: negocio_id, descripcion, cantidad, unidad, monto_unitario
compras_historial_oc / compras_historial_oc_item — órdenes de compra a proveedores: producto_nombre, cantidad, precio_unitario, subtotal; fecha, total, folio
precios_mercado — precios de mercado consultados: producto, region, rubro, precio_neto, tienda, created_at

documentos_cache — documentos de las licitaciones (bases, anexos, actas, y documentos propios que subimos) con su TEXTO ya extraído:
  licitacion_codigo, documento_nombre, categoria ('BASES_ADMINISTRATIVAS','BASES_TECNICAS','ANEXOS_OFERENTE','DOCUMENTOS_PROCESO','DOCUMENTOS_PROPIOS', ...), metodo_extraccion, texto_extraido (LONGTEXT; NUNCA lo selecciones entero: usa fragmentos)
  Solo ~la mitad de los documentos tiene texto (texto_extraido <> ''); las búsquedas por contenido cubren solo esos.
checklist_comercial — requisitos del auditor por negocio: negocio_id, bloque, tipo, titulo, criticidad, linea_numero, ofertamos, estado, observacion
auditor_opcion — opciones de producto/proveedor evaluadas: negocio_id, fila_id, marca, modelo, proveedor_razon_social, via, estado, motivo_descarte
preguntas_respuestas_cache — foro de preguntas y respuestas: licitacion_codigo, n_preguntas, respondido, preguntas (texto)

BÚSQUEDA POR CONTENIDO (multas, garantías, plazos, cláusulas, "en qué licitaciones dice X"): consulta documentos_cache con LIKE sobre texto_extraido y devuelve SOLO un fragmento:
  SELECT licitacion_codigo, documento_nombre, SUBSTRING(texto_extraido, GREATEST(LOCATE('palabra', texto_extraido) - 150, 1), 400) AS fragmento FROM documentos_cache WHERE texto_extraido LIKE '%palabra%' AND categoria IN ('BASES_ADMINISTRATIVAS','BASES_TECNICAS') LIMIT 30
  Para contar licitaciones distintas usa COUNT(DISTINCT licitacion_codigo). Una consulta sobre texto_extraido recorre ~28.000 documentos (~3 s): úsala una sola vez y con LIMIT. Para unir con el estado de nuestros negocios, une por licitacion_codigo con negocios.

Relaciones: negocios.licitacion_codigo = licitaciones_cache.codigo = oferta_competencia.licitacion_codigo = adjudicacion_cache.licitacion_codigo = viabilidad_licitacion.licitacion_codigo; compras_producto.negocio_id = negocios.id.

PISTAS:
- "Qué equipo/producto se repite": cuenta licitaciones_cache donde nombre, descripcion o items_json contengan la palabra (LIKE '%retroexcavadora%'); para ranking de varios, usa varias columnas con SUM(items_json LIKE '%x%') o UNION ALL de SELECT por palabra.
- "Tipos de licitación": agrupa por tipo, organismo, region o por palabras de nombre.
- "Competencia": agrupa oferta_competencia por proveedor_nombre (cuántas ofertas, cuántas veces ganó = estado de la oferta / adjudicación); excluye es_nuestra=1.
- "Ganadas/perdidas nuestras": negocios con estado_pipeline='ADJUDICADA' / 'PERDIDA', activo=1.
- Fechas relativas: usa CURDATE() y DATE_SUB.`;

const SYS_SQL = `Eres el analista de datos de LICITANK. Conviertes la pregunta del usuario en UNA consulta SQL de solo lectura sobre el esquema dado.

${ESQUEMA}

REGLAS:
- Responde SOLO con un JSON: {"sql":"SELECT ..."} para preguntas que se resuelven con datos, {"inventario":true} si preguntan qué datos tenemos / qué nos falta / qué cobertura tiene la base, o {"respuesta":"texto"} si es saludo/aclaración o no se puede responder con estas tablas (dilo: "no tenemos ese dato guardado").
- Una sola sentencia SELECT, sin punto y coma, sin comentarios. Solo las tablas listadas. Sin CTE (WITH), sin JSON_TABLE (MySQL 5.7).
- Usa nombres de columna EXACTOS del esquema. Pon alias legibles en español.
- Agrega siempre ORDER BY y LIMIT (máximo ${MAX_FILAS}).
- Si pide ranking ("más se repite", "top"), cuenta con COUNT(*) y ordena descendente.
- Al comparar palabras clave, que no se solapen: 'retroexcavadora' contiene 'excavadora', así que la categoría 'excavadora' debe excluirla (AND ... NOT LIKE '%retroexcavadora%'). Lo mismo con 'minicargador' vs 'cargador'.
- Si la pregunta es ambigua en un punto clave, igual intenta la interpretación más razonable y deja que la respuesta lo aclare.`;

const SYS_RESPUESTA = `Eres ankIA, del equipo de LICITANK. Hablas como una persona que conoce bien el negocio y conversa con un colega: español chileno natural, en primera persona, tuteando, sin fórmulas de robot. Parte por la respuesta en una o dos frases y después da el detalle. Prosa corrida por defecto; lista o tabla solo si hay 4 o más elementos. Sin emojis, sin encabezados con # y sin cerrar con "Pregunta de seguimiento"; si sugieres algo, hazlo en una frase natural. No menciones "la consulta", "las filas" ni la SQL: di "revisé la base" y cuenta el hallazgo.
Respondes con los DATOS que se te entregan: son el resultado real de una consulta a nuestra base.
- Usa SOLO esas cifras; no inventes ni estimes. No saques conclusiones ni valoraciones que los datos no sostengan ("vamos bien", "tasa de éxito") salvo que la pregunta lo pida y haya con qué calcularlo. Si las filas están vacías, di que no hay datos guardados para eso.
- Si el resultado llegó al tope de filas o hay un posible sesgo (la base solo contiene lo que el sistema ha visto/descargado, no todo Mercado Público), mencionalo en una línea.
- Los rankings largos van en lista numerada; resalta los números y deja claro en una frase qué se contó (ej. "licitaciones que mencionan 'retroexcavadora'").
- Si la respuesta depende de datos que la COBERTURA muestra incompletos (documentos sin texto leído, pocas ofertas de competidores, pocas adjudicaciones guardadas), añade una línea "Lo que no tenemos:" con la cifra concreta de lo que falta. No lo digas si no afecta a esta respuesta.
- Si se buscó por contenido, cita siempre licitación y documento de cada hallazgo y reproduce el fragmento relevante entre comillas, sin completar lo que el fragmento no dice.
- Si ayuda, cierra con una frase natural que proponga el siguiente paso útil.`;

let tablasBD: Set<string> | null = null;
async function todasLasTablas(): Promise<Set<string>> {
  if (tablasBD) return tablasBD;
  const [rows] = await pool.query(`SELECT TABLE_NAME AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
  tablasBD = new Set((rows as any[]).map(r => String(r.n).toLowerCase()));
  return tablasBD;
}

const PALABRAS_PROHIBIDAS =
  /\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|call|handler|lock|unlock|load_file|outfile|dumpfile|sleep|benchmark|information_schema|performance_schema|mysql|sys|into|prepare|execute|set|with|json_table)\b/i;

// Perfiles normales (no admin ni Compras): ven el mercado completo (licitaciones, competencia, adjudicaciones,
// viabilidad) pero de lo interno SOLO lo suyo. Cada tabla restringida se reemplaza por una subconsulta filtrada
// y se exige que aparezca solo tras FROM/JOIN (así una coma-join no la esquiva).
const TABLAS_BLOQUEADAS_RESTRINGIDO = ['compras_historial_oc', 'compras_historial_oc_item'];
const filtrosRestringido = (id: number): Record<string, string> => {
  const mis = `SELECT id FROM negocios WHERE asignado_a = ${id}`;
  return {
    negocios: `SELECT * FROM negocios WHERE asignado_a = ${id} AND activo = 1`,
    checklist_comercial: `SELECT * FROM checklist_comercial WHERE negocio_id IN (${mis})`,
    auditor_opcion: `SELECT * FROM auditor_opcion WHERE negocio_id IN (${mis})`,
    compras_producto: `SELECT * FROM compras_producto WHERE negocio_id IN (${mis})`,
    documentos_cache: `SELECT * FROM documentos_cache WHERE categoria IS NULL OR categoria <> 'DOCUMENTOS_PROPIOS' OR licitacion_codigo IN (SELECT licitacion_codigo FROM negocios WHERE asignado_a = ${id})`,
  };
};
const PALABRAS_NO_ALIAS = new Set(['on', 'where', 'join', 'left', 'right', 'inner', 'cross', 'group', 'order', 'limit', 'using', 'natural', 'having', 'union', 'straight_join']);

function restringirSql(sql: string, sinLiterales: string, userId: number): string {
  const bloqueada = TABLAS_BLOQUEADAS_RESTRINGIDO.find(t => new RegExp(`\\b${t}\\b`, 'i').test(sinLiterales));
  if (bloqueada) throw new Error(`La tabla ${bloqueada} no está disponible para tu perfil.`);
  const filtros = filtrosRestringido(userId);
  const bajo = sinLiterales.toLowerCase();
  for (const t of Object.keys(filtros)) {
    for (const m of bajo.matchAll(new RegExp(`\\b${t}\\b`, 'g'))) {
      if (!/(from|join)\s+`?$/.test(bajo.slice(0, m.index))) throw new Error(`La tabla ${t} solo puede usarse tras FROM o JOIN.`);
    }
    sql = sql.replace(new RegExp('\\b(from|join)\\s+`?' + t + '`?(?:\\s+(?:as\\s+)?([a-z_][a-z0-9_]*))?', 'gi'), (_m, kw: string, alias?: string) => {
      const esAlias = !!alias && !PALABRAS_NO_ALIAS.has(alias.toLowerCase());
      return `${kw} (${filtros[t]}) AS ${esAlias ? alias : t}${alias && !esAlias ? ' ' + alias : ''}`;
    });
  }
  return sql;
}

/** Devuelve la SQL lista para ejecutar, o lanza Error con el motivo del rechazo.
 *  `restringidoUserId`: perfil normal → solo ve lo suyo en las tablas internas (ver arriba). */
export async function validarSqlSoloLectura(sqlCruda: string, restringidoUserId?: number | null): Promise<string> {
  let sql = String(sqlCruda || '').trim().replace(/;+\s*$/, '');
  if (!/^select\b/i.test(sql)) throw new Error('La consulta debe empezar con SELECT.');
  if (/;|--|\/\*|\*\/|#/.test(sql)) throw new Error('Consulta con caracteres no permitidos (; -- /* #).');
  // Se quitan los literales entre comillas antes de buscar palabras prohibidas/tablas: un LIKE '%set%' es legítimo.
  const sinLiterales = sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const mala = sinLiterales.match(PALABRAS_PROHIBIDAS);
  if (mala) throw new Error(`Palabra no permitida en la consulta: ${mala[1]}.`);
  const permitidas = new Set(TABLAS_PERMITIDAS);
  const ajenas = [...(await todasLasTablas())].filter(t => !permitidas.has(t));
  const tokens = sinLiterales.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [];
  const usada = tokens.find(t => ajenas.includes(t));
  if (usada) throw new Error(`Tabla no permitida: ${usada}.`);
  if (restringidoUserId) sql = restringirSql(sql, sinLiterales, restringidoUserId);
  const lim = sql.match(/\blimit\s+(\d+)(?!.*\blimit\b)/i);
  if (!lim) sql += ` LIMIT ${MAX_FILAS}`;
  else if (Number(lim[1]) > MAX_FILAS) sql = sql.replace(/(\blimit\s+)\d+(?!.*\blimit\b)/i, `$1${MAX_FILAS}`);
  return sql;
}

async function ejecutarSolo(sql: string): Promise<any[]> {
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION READ ONLY');
    const [rows] = await conn.query({ sql, timeout: 25_000 });
    return rows as any[];
  } finally {
    try { await conn.query('ROLLBACK'); } catch { /* conexión ya cerrada */ }
    conn.release();
  }
}

async function llamar(system: string, user: string, maxTokens: number, temperature = 0): Promise<string> {
  const c: any = await crearChatIA(
    { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, stream: false, max_tokens: maxTokens },
    { modeloPreferido: MODELO },
  );
  const txt = String(c.choices[0]?.message?.content ?? '').trim();
  // glm-4.7 a temperatura 0 llegó a entrar en bucle ("c!c!c!…" hasta el tope de tokens): se corta
  // en el primer tramo de 1-4 caracteres repetido 15+ veces.
  const bucle = txt.match(/([\s\S]{1,4})\1{14,}/);
  return bucle?.index !== undefined ? txt.slice(0, bucle.index).trim() : txt;
}

// ─── Cobertura: qué hay y qué NO hay en la base ──────────────────────────────────
// Se calcula una vez cada 10 min. Sirve para (a) responder "¿qué nos falta?" y (b) que cada
// respuesta diga hasta dónde llegan los datos (ej. la competencia solo existe en unas pocas licitaciones).
let coberturaCache: { texto: string; en: number } | null = null;
export async function textoCobertura(): Promise<string> {
  if (coberturaCache && Date.now() - coberturaCache.en < 10 * 60_000) return coberturaCache.texto;
  const q = async (sql: string) => { const [r] = await pool.query({ sql, timeout: 25_000 }); return r as any[]; };
  const n = (v: unknown) => Number(v || 0).toLocaleString('es-CL');
  const partes: string[] = [];
  try {
    const [l] = await q(`SELECT COUNT(*) total, SUM(estado='Adjudicada') adjudicadas, SUM(items_json IS NOT NULL AND items_json<>'') con_items,
                                MIN(fecha_publicacion) desde, MAX(fecha_publicacion) hasta FROM licitaciones_cache`);
    partes.push(`Licitaciones vistas (licitaciones_cache): ${n(l.total)} (${n(l.adjudicadas)} adjudicadas, ${n(l.con_items)} con ítems), publicadas entre ${String(l.desde).slice(0, 10)} y ${String(l.hasta).slice(0, 10)}. NO es todo Mercado Público: solo lo que el sistema ha visto.`);
  } catch { /* sigue */ }
  try {
    const [d] = await q(`SELECT COUNT(*) total, SUM(texto_extraido IS NOT NULL AND texto_extraido<>'') con_texto,
                                COUNT(DISTINCT CASE WHEN texto_extraido<>'' THEN licitacion_codigo END) lics_con_texto,
                                COUNT(DISTINCT licitacion_codigo) lics FROM documentos_cache`);
    const fallos = await q(`SELECT metodo_extraccion m, COUNT(*) c FROM documentos_cache WHERE (texto_extraido IS NULL OR texto_extraido='') AND metodo_extraccion IS NOT NULL GROUP BY metodo_extraccion ORDER BY c DESC LIMIT 5`);
    partes.push(`Documentos (documentos_cache): ${n(d.total)} en ${n(d.lics)} licitaciones; solo ${n(d.con_texto)} tienen texto leído (de ${n(d.lics_con_texto)} licitaciones). Los demás NO se pueden buscar por contenido.${fallos.length ? ` Intentos de lectura que fallaron: ${fallos.map(f => `${f.m}=${n(f.c)}`).join(', ')}.` : ''}`);
  } catch { /* sigue */ }
  try {
    const [a] = await q(`SELECT COUNT(*) adj_guardadas FROM adjudicacion_cache`);
    const [c] = await q(`SELECT COUNT(DISTINCT licitacion_codigo) lics, COUNT(*) ofertas FROM oferta_competencia`);
    partes.push(`Resultados: adjudicaciones guardadas ${n(a.adj_guardadas)}; ofertas de competidores guardadas ${n(c.ofertas)} en solo ${n(c.lics)} licitaciones. Todo análisis de competencia, precios ganadores o proveedores adjudicados está limitado a esas.`);
  } catch { /* sigue */ }
  try {
    const neg = await q(`SELECT estado_pipeline e, COUNT(*) c FROM negocios WHERE activo=1 GROUP BY estado_pipeline ORDER BY c DESC`);
    partes.push(`Nuestros negocios activos por etapa: ${neg.map(x => `${x.e}=${n(x.c)}`).join(', ')}.`);
    const [v] = await q(`SELECT COUNT(*) c FROM viabilidad_licitacion`);
    const [p] = await q(`SELECT COUNT(*) c FROM precios_mercado`);
    partes.push(`Viabilidades calculadas: ${n(v.c)}. Precios de mercado guardados: ${n(p.c)}.`);
  } catch { /* sigue */ }
  const texto = partes.join('\n');
  coberturaCache = { texto, en: Date.now() };
  return texto;
}

// Cualquier campo de texto largo (p. ej. texto_extraido entero) se recorta antes de llegar al modelo.
const recortarCampos = (filas: any[]) => filas.map(f => {
  const o: any = {};
  for (const [k, v] of Object.entries(f)) o[k] = typeof v === 'string' && v.length > 1_200 ? `${v.slice(0, 1_200)}…[recortado]` : v;
  return o;
});

function extraerJson(txt: string): { sql?: string; respuesta?: string; inventario?: boolean } | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const resumenHistorial = (h: MensajeHistorial[]) =>
  h.slice(-MAX_TURNOS * 2).map(x => `${x.rol === 'usuario' ? 'Usuario' : 'Asistente'}: ${x.mensaje.slice(0, 600)}`).join('\n');

const NOTA_RESTRINGIDO = `\n\nACCESO LIMITADO DE ESTE USUARIO: en negocios, checklist_comercial, auditor_opcion, compras_producto y documentos_cache solo existen SUS negocios (y de los demás, solo documentos que no son propios). Las tablas compras_historial_oc y compras_historial_oc_item NO están disponibles. Si preguntan por negocios, comentarios, costeos o compras de otros perfiles, responde que tu acceso solo cubre sus propias licitaciones y el mercado general.`;

export async function responderGlobal(pregunta: string, historial: MensajeHistorial[], restringidoUserId?: number | null): Promise<{ respuesta: string; sql?: string; filas?: number }> {
  const contexto = historial.length ? `CONVERSACIÓN PREVIA:\n${resumenHistorial(historial)}\n\n` : '';
  let pedido = `${contexto}PREGUNTA: ${pregunta}`;
  let sqlFinal: string | undefined;
  let filas: any[] | null = null;
  let ultimoError = '';

  for (let intento = 0; intento < 2 && !filas; intento++) {
    const salida = extraerJson(await llamar(restringidoUserId ? SYS_SQL + NOTA_RESTRINGIDO : SYS_SQL, pedido, 1500));
    if (!salida) { ultimoError = 'El modelo no devolvió JSON.'; pedido += `\n\nTu respuesta anterior no era un JSON válido. Responde solo con {"sql":"..."} o {"respuesta":"..."}.`; continue; }
    if (salida.inventario) {
      const cob = await textoCobertura();
      const resp = await llamar(
        SYS_RESPUESTA,
        `${contexto}PREGUNTA: ${pregunta}\n\nEl usuario pregunta qué datos tenemos y cuáles faltan. Responde con este INVENTARIO REAL de la base (cifras exactas), ordenado en: "Lo que sí tenemos", "Lo que nos falta o está incompleto" y "Cómo completarlo" (p. ej. leer los documentos sin texto, guardar más resultados de adjudicación y ofertas de la competencia).\n\nINVENTARIO:\n${cob}`,
        2000,
        0.3,
      );
      return { respuesta: resp || cob };
    }
    if (!salida.sql) return { respuesta: String(salida.respuesta || 'No tengo ese dato guardado.') };
    try {
      sqlFinal = await validarSqlSoloLectura(salida.sql, restringidoUserId);
      filas = await ejecutarSolo(sqlFinal);
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
      pedido += `\n\nTu consulta anterior falló: ${ultimoError}\nConsulta: ${salida.sql}\nCorrígela usando solo las tablas y columnas del esquema.`;
    }
  }
  if (!filas) return { respuesta: `No pude armar una consulta válida para esa pregunta (${ultimoError}). Intenta reformularla con más detalle.` };

  let datos = JSON.stringify(recortarCampos(filas));
  if (datos.length > MAX_CHARS_FILAS) datos = `${datos.slice(0, MAX_CHARS_FILAS)} …[recortado]`;
  const tope = filas.length >= MAX_FILAS ? `\nOJO: el resultado llegó al tope de ${MAX_FILAS} filas (puede haber más).` : '';
  const cob = await textoCobertura().catch(() => '');
  const respuesta = await llamar(
    SYS_RESPUESTA,
    `${contexto}PREGUNTA: ${pregunta}\n\nCONSULTA EJECUTADA:\n${sqlFinal}\n\nFILAS (${filas.length}):\n${datos}${tope}\n\nCOBERTURA DE LA BASE (para decir hasta dónde llegan los datos):\n${cob}`,
    2000,
    0.3,
  );
  return { respuesta: respuesta || 'La consulta no devolvió información para responder.', sql: sqlFinal, filas: filas.length };
}
