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
import { crearChatIAChatbot, MOTOR_CHAT } from './chat-ia';
import { jsonHoraChile, type MensajeHistorial } from './chat-licitacion';
import { SECCIONES, seccionPorId, type SeccionChat } from './chat-secciones';

export const ETIQUETA_MOTOR_SQL = `${MOTOR_CHAT}+sql`;
const MAX_FILAS = 200;
const MAX_CHARS_FILAS = 30_000;
const MAX_TURNOS = 6;

// Solo estas tablas pueden aparecer en la consulta del chat GENERAL (Dashboard). Nada de contraseñas ni tokens.
// Los chats de cada menú traen sus propias tablas (chat-secciones.ts).
const TABLAS_PERMITIDAS = [
  'licitaciones_cache', 'negocios', 'oferta_competencia', 'adjudicacion_cache',
  'viabilidad_licitacion', 'compras_producto', 'compras_historial_oc', 'compras_historial_oc_item',
  'precios_mercado', 'documentos_cache', 'checklist_comercial', 'auditor_opcion', 'preguntas_respuestas_cache',
];

// ─── Separación por empresa-cliente (multiempresa) ───────────────────────────────
// Datos de Mercado Público que son iguales para todas las empresas: se leen sin filtro.
const TABLAS_COMPARTIDAS = new Set(['licitaciones_cache', 'adjudicacion_cache', 'oferta_competencia', 'preguntas_respuestas_cache', 'precios_mercado', 'licitacion_apertura', 'licitacion_unidad_cache']);
// Análisis de mercado de Grupo ICA (viabilidad v4, prefiltro): sin dueño por empresa; los ve todo perfil de ICA, ninguna empresa-cliente.
const TABLAS_MERCADO_ICA = new Set(['viabilidad_licitacion', 'prefiltro_licitacion', 'analisis_ia_licitacion']);
// Columnas que jamás llegan al modelo aunque la tabla esté permitida.
const COLUMNA_SENSIBLE = /pass|token|secret|clave|api_?key|hash|cookie|credencial|certificado|pfx|salt/i;
// Tablas que se exponen por una vista reducida (sin datos privados).
const VISTAS_REDUCIDAS: Record<string, (clienteId: number) => string> = {
  usuarios: c => `SELECT id, nombre, cargo, area, rol, activo FROM usuarios WHERE cliente_id = ${c}`,
};

interface ColumnaInfo { nombre: string; tipo: string; comentario: string }
let columnasBD: Map<string, ColumnaInfo[]> | null = null;
async function columnasPorTabla(): Promise<Map<string, ColumnaInfo[]>> {
  if (columnasBD) return columnasBD;
  const [rows] = await pool.query(
    `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, COLUMN_COMMENT k FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const m = new Map<string, ColumnaInfo[]>();
  for (const r of rows as any[]) {
    const t = String(r.t).toLowerCase();
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push({ nombre: String(r.c), tipo: String(r.d), comentario: String(r.k || '') });
  }
  columnasBD = m;
  return m;
}

/** Filtros por tabla: reemplazan `FROM tabla` por una subconsulta que solo deja ver lo de esta empresa (y, para perfiles
 *  normales, solo lo asignado a ellos). Una tabla que no se puede separar por empresa no se entrega a ninguna empresa-cliente. */
interface Alcance { clienteId: number; restringidoUserId?: number | null }
async function filtrosDeAcceso(tablas: string[], a: Alcance): Promise<{ filtros: Record<string, string>; accesibles: string[] }> {
  const cols = await columnasPorTabla();
  const c = a.clienteId;
  const u = a.restringidoUserId ?? null;
  const misNegocios = `SELECT id FROM negocios WHERE COALESCE(cliente_id, 1) = ${c}${u ? ` AND asignado_a = ${u}` : ''}`;
  const filtros: Record<string, string> = {};
  const accesibles: string[] = [];
  for (const t of tablas) {
    const nombres = new Set((cols.get(t) || []).map(x => x.nombre));
    if (!nombres.size) continue; // la tabla no existe en esta base
    if (VISTAS_REDUCIDAS[t]) { filtros[t] = VISTAS_REDUCIDAS[t](c); accesibles.push(t); continue; }
    if (t === 'negocios') {
      filtros[t] = `SELECT * FROM negocios WHERE COALESCE(cliente_id, 1) = ${c}${u ? ` AND asignado_a = ${u} AND activo = 1` : ''}`;
    } else if (t === 'documentos_cache') {
      // oficiales (cliente_id 0, compartidos) + los de esta empresa; el perfil normal no ve los documentos propios de otros.
      filtros[t] = `SELECT * FROM documentos_cache WHERE cliente_id IN (0, ${c})${u ? ` AND (categoria IS NULL OR categoria <> 'DOCUMENTOS_PROPIOS' OR licitacion_codigo IN (SELECT licitacion_codigo FROM negocios WHERE asignado_a = ${u}))` : ''}`;
    } else if (t === 'oferta_competencia' && c !== 1) {
      // es_nuestra se grabó con las razones sociales de Grupo ICA: a otra empresa se le recalcula con SUS RUT.
      const rn = (x: string) => `REPLACE(REPLACE(LOWER(CONVERT(${x} USING utf8mb4)), '.', ''), ' ', '') COLLATE utf8mb4_unicode_ci`;
      const resto = (cols.get(t) || []).map(x => x.nombre).filter(n => n !== 'es_nuestra').join(', ');
      filtros[t] = `SELECT ${resto}, (${rn('proveedor_rut')} IN (SELECT ${rn('rut')} FROM empresas WHERE cliente_id = ${c} AND rut IS NOT NULL AND rut <> '')) AS es_nuestra FROM oferta_competencia`;
    } else if (t === 'ordenes_compra') {
      // OC que los organismos envían (migration-197): las «nuestras» llevan la empresa dueña; las de terceros quedan sin dueño y se
      // leen como de Grupo ICA (igual que antes). Un perfil restringido de ICA sigue sin verlas; el de otra empresa, solo las de sus negocios.
      if (c === 1 && u) continue;
      filtros[t] = `SELECT * FROM ordenes_compra WHERE COALESCE(cliente_id, 1) = ${c}${u ? ` AND licitacion_codigo IN (SELECT licitacion_codigo FROM negocios WHERE COALESCE(cliente_id, 1) = ${c} AND asignado_a = ${u})` : ''}`;
    } else if (TABLAS_COMPARTIDAS.has(t)) {
      // sin filtro
    } else if (nombres.has('cliente_id')) {
      filtros[t] = `SELECT * FROM ${t} WHERE COALESCE(cliente_id, 1) = ${c}`;
    } else if (nombres.has('negocio_id')) {
      filtros[t] = `SELECT * FROM ${t} WHERE negocio_id IN (${misNegocios})`;
    } else if (c === 1 && (!u || TABLAS_MERCADO_ICA.has(t))) {
      // tabla global de Grupo ICA: solo el cliente 1. Compras/Obuma, además, solo perfiles con acceso total; los análisis de mercado los ven todos los perfiles de ICA
    } else {
      continue; // no se puede separar por empresa → no se entrega
    }
    accesibles.push(t);
  }
  return { filtros, accesibles };
}

/** Esquema de las tablas de un menú, armado desde la base real (columnas exactas) + notas de la sección. */
async function esquemaAutomatico(tablas: string[], notas: Record<string, string> = {}): Promise<string> {
  const cols = await columnasPorTabla();
  return tablas.map(t => {
    const lista = (cols.get(t) || []).filter(x => !COLUMNA_SENSIBLE.test(x.nombre) && !(VISTAS_REDUCIDAS[t] && !/^(id|nombre|cargo|area|rol|activo)$/.test(x.nombre)));
    const largos = lista.filter(x => /text|json|blob/.test(x.tipo)).map(x => x.nombre);
    const detalle = lista.map(x => `${x.nombre}${x.comentario ? ` (${x.comentario.slice(0, 60)})` : ''}`).join(', ');
    return `${t}: ${detalle}${largos.length ? `\n  campos de texto largo (no los selecciones enteros; usa SUBSTRING): ${largos.join(', ')}` : ''}${notas[t] ? `\n  ${notas[t]}` : ''}`;
  }).join('\n');
}

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
- Fechas relativas: usa CURDATE() y DATE_SUB.
- Órdenes de compra: compras_historial_oc (folio, fecha, total; historial de Obuma) NO tiene negocio_id ni licitacion_codigo: NUNCA la unas a negocios. Las OC de un negocio están en compras_orden_compra_obuma (negocio_id) y las del cliente en ordenes_compra (licitacion_codigo = licitaciones_cache.codigo). «OC sin pagar» = compras_orden_compra_obuma LEFT JOIN compras_oc_pago por oc_folio = obuma_folio, WHERE pago IS NULL.
- Todo JOIN une por una columna clave de AMBAS tablas (negocio_id = negocios.id, licitacion_codigo = codigo…); jamás por una condición constante, IS NOT NULL o una subconsulta que repite la misma tabla: multiplica filas.
- Carga de trabajo («cuántos negocios tiene cada persona», «en qué etapa están»): cuenta solo los VIGENTES (ASIGNADO, EN_PROCESO, ANEXOS, VISADO, POSTULADA, POSIBLE_ADJ) y dilo en la respuesta; cuenta todos solo si piden «todos», «históricos» o «descartados». NO aplica a Compras. Muestra siempre el NOMBRE de la persona (JOIN usuarios u ON u.id = n.asignado_a), nunca el id; arma UNA fila por persona con una columna por etapa (SUM(CASE ...)) y una columna total, para que los totales los sume la base.
- Compras abiertas/pendientes: compras_asignacion con cierre_legado IS NULL AND precompra = 0 (cerrada = 'ENTREGADA'; cancelada = 'OC_CANCELADA' o 'NO_REALIZADA').
- Para «sin X», «que no tienen X» o «pendientes de X»: LEFT JOIN a X y WHERE X.id IS NULL (o NOT EXISTS). NUNCA un INNER JOIN con IS NULL: devuelve 0 filas siempre.`;

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

const SYS_RESPUESTA = `Eres ankIA, del equipo de LICITANK. Hablas como una persona que conoce bien el negocio y conversa con un colega: español chileno natural, en primera persona, tuteando, con «tú» (quieres, necesitas, puedes): nunca voseo ("querés") ni vosotros ("necesitáis"), sin fórmulas de robot. Parte por la respuesta en una o dos frases y después da el detalle. Prosa corrida por defecto; lista o tabla solo si hay 4 o más elementos. Sin emojis, sin encabezados con # y sin cerrar con "Pregunta de seguimiento"; si sugieres algo, hazlo en una frase natural. Las fechas y horas que vienen en los bloques [[ANÁLISIS]] y en los datos de la base ya están en HORA DE CHILE: léelas tal cual. NUNCA las conviertas de zona horaria ni les sumes o restes horas (18:43 es 18:43, no 21:43). No comentes esta regla ni digas que te la dieron: da la hora sin más. No menciones "la consulta", "las filas" ni la SQL: di "revisé la base" y cuenta el hallazgo.
Respondes con los DATOS que se te entregan: son el resultado real de una consulta a nuestra base.
- Usa SOLO esas cifras; no inventes ni estimes. No saques conclusiones ni valoraciones que los datos no sostengan ("vamos bien", "tasa de éxito") salvo que la pregunta lo pida y haya con qué calcularlo. Si las filas están vacías, di que no hay datos guardados para eso.
- Si el resultado llegó al tope de filas o hay un posible sesgo (la base solo contiene lo que el sistema ha visto/descargado, no todo Mercado Público), mencionalo en una línea.
- Los rankings largos van en lista numerada; resalta los números y deja claro en una frase qué se contó (ej. "licitaciones que mencionan 'retroexcavadora'").
- Si la respuesta depende de datos que la COBERTURA muestra incompletos (documentos sin texto leído, pocas ofertas de competidores, pocas adjudicaciones guardadas), añade una línea "Lo que no tenemos:" con la cifra concreta de lo que falta. No lo digas si no afecta a esta respuesta.
- Si se buscó por contenido, cita siempre licitación y documento de cada hallazgo y reproduce el fragmento relevante entre comillas, sin completar lo que el fragmento no dice.
- No hagas preguntas de aclaración cuando puedes responder con una suposición razonable: responde, di en una frase qué supusiste y ofrece la otra opción. Nunca muestres nombres de columnas, tablas ni códigos internos (como es_nuestra): habla de «las OC que nos envían los organismos (clientes)» para la tabla ordenes_compra, y de «las que emitimos a proveedores» solo para compras_orden_compra_obuma; nunca digas que ordenes_compra son OC emitidas por nosotros. Siempre tuteo chileno («te refieres», «quieres»), nunca voseo («te referís»).
- Respuesta corta: si hay más de 10 filas, muestra solo las 10 más relevantes, di el total y ofrece el resto («¿quieres el listado completo?»). Máximo unas 150 palabras, salvo que pidan el listado completo. Si muestras una tabla, no repitas sus cifras en prosa: una frase de resumen antes y listo. Nunca hables de «registros», «filas» ni «combinaciones» del resultado: di qué son (negocios, licitaciones, OC) y cuenta esas.
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

const PALABRAS_NO_ALIAS = new Set(['on', 'where', 'join', 'left', 'right', 'inner', 'cross', 'group', 'order', 'limit', 'using', 'natural', 'having', 'union', 'straight_join']);

/** Cada tabla con filtro (empresa / perfil) se reemplaza por una subconsulta filtrada y se exige que aparezca solo tras
 *  FROM/JOIN (así una coma-join no la esquiva). */
function aplicarFiltros(sql: string, sinLiterales: string, filtros: Record<string, string>): string {
  const bajo = sinLiterales.toLowerCase();
  for (const t of Object.keys(filtros)) {
    for (const m of bajo.matchAll(new RegExp(`\\b${t}\\b`, 'g'))) {
      if (!/(from|join)\s+`?$/.test(bajo.slice(0, m.index))) throw new Error(`La tabla ${t} solo puede usarse tras FROM o JOIN.`);
    }
    sql = sql.replace(new RegExp('\\b(from|join)\\s+`?' + t + '(?![a-z0-9_])`?(?:\\s+(?:as\\s+)?([a-z_][a-z0-9_]*))?', 'gi'), (_m, kw: string, alias?: string) => {
      const esAlias = !!alias && !PALABRAS_NO_ALIAS.has(alias.toLowerCase());
      return `${kw} (${filtros[t]}) AS ${esAlias ? alias : t}${alias && !esAlias ? ' ' + alias : ''}`;
    });
  }
  return sql;
}

/** Devuelve la SQL lista para ejecutar, o lanza Error con el motivo del rechazo.
 *  `tablas`: las que este chat puede leer. `alcance`: empresa de quien pregunta y, para perfiles normales, su id
 *  (solo ven lo asignado a ellos). */
export async function validarSqlSoloLectura(sqlCruda: string, tablas: string[], alcance: Alcance): Promise<string> {
  let sql = String(sqlCruda || '').trim().replace(/;+\s*$/, '');
  if (!/^select\b/i.test(sql)) throw new Error('La consulta debe empezar con SELECT.');
  if (/;|--|\/\*|\*\/|#/.test(sql)) throw new Error('Consulta con caracteres no permitidos (; -- /* #).');
  // Se quitan los literales entre comillas antes de buscar palabras prohibidas/tablas: un LIKE '%set%' es legítimo.
  const sinLiterales = sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const mala = sinLiterales.match(PALABRAS_PROHIBIDAS);
  if (mala) throw new Error(`Palabra no permitida en la consulta: ${mala[1]}.`);
  const { filtros, accesibles } = await filtrosDeAcceso(tablas, alcance);
  const permitidas = new Set(accesibles);
  const ajenas = [...(await todasLasTablas())].filter(t => !permitidas.has(t));
  const tokens = sinLiterales.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [];
  const usada = tokens.find(t => ajenas.includes(t));
  if (usada) throw new Error(`Tabla no permitida: ${usada}.`);
  sql = aplicarFiltros(sql, sinLiterales, filtros);
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
  // Kimi económico primero, GLM de respaldo (chat-ia.ts). Kimi ignora la temperatura (fija 0.6).
  const c: any = await crearChatIAChatbot(
    { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, stream: false, max_tokens: maxTokens },
    { timeoutMs: 60_000 },
  );
  const txt = String(c.choices[0]?.message?.content ?? '').trim();
  // glm-4.7 (el respaldo) a temperatura 0 llegó a entrar en bucle ("c!c!c!…" hasta el tope de tokens): se corta
  // en el primer tramo de 1-4 caracteres repetido 15+ veces.
  const bucle = txt.match(/([\s\S]{1,4})\1{14,}/);
  return bucle?.index !== undefined ? txt.slice(0, bucle.index).trim() : txt;
}

// Kimi vosea aunque el prompt pida «tú» (visto en licitank.cl: «Tenés», «querés»). Se corrigen las formas que aparecen en la práctica.
const VOSEO: Record<string, string> = {
  tenés: 'tienes', querés: 'quieres', podés: 'puedes', necesitás: 'necesitas', sabés: 'sabes', hacés: 'haces', decís: 'dices',
  preferís: 'prefieres', buscás: 'buscas', mirás: 'miras', revisás: 'revisas', pensás: 'piensas', vos: 'tú',
  referís: 'refieres', entendés: 'entiendes', ponés: 'pones', sos: 'eres', avisás: 'avisas', cruzás: 'cruzas', filtrás: 'filtras',
};
function tutear(t: string): string {
  // Kimi escapa el signo peso («\$1.488 millones») y la burbuja lo mostraba con la barra.
  return t.replace(/\\\$/g, '$').replace(/(?<!\p{L})(tenés|querés|podés|necesitás|sabés|hacés|decís|preferís|buscás|mirás|revisás|pensás|vos|referís|entendés|ponés|sos|avisás|cruzás|filtrás)(?!\p{L})/giu, m => {
    const r = VOSEO[m.toLowerCase()] || m;
    return m[0] === m[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
  });
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
    const neg = await q(`SELECT estado_pipeline e, COUNT(*) c FROM negocios WHERE activo=1 AND COALESCE(cliente_id,1)=1 GROUP BY estado_pipeline ORDER BY c DESC`);
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

const NOTA_RESTRINGIDO = `\n\nACCESO LIMITADO DE ESTE USUARIO: en negocios y en todo lo que cuelga de un negocio (checklist, opciones, productos, comentarios, entregas…) solo existen SUS negocios; de los demás, solo documentos que no son propios. Las tablas globales de Compras (proveedores, historial de órdenes de compra, Obuma) NO están disponibles. Si preguntan por negocios, comentarios, costeos o compras de otros perfiles, responde que tu acceso solo cubre sus propias licitaciones y el mercado general.`;

const PISTAS_SECCION = `PISTAS:
- negocios: una fila por licitación que tomamos; usa activo = 1. estado_pipeline: 'ASIGNADO','EN_PROCESO','ANEXOS','VISADO','POSTULADA','POSIBLE_ADJ','ADJUDICADA' (= GANADA),'PERDIDA','DESIERTA','REVOCADA','DESCARTADA'. negocios.licitacion_codigo = licitaciones_cache.codigo.
- Las tablas con negocio_id se unen con negocios.id. Las que traen licitacion_codigo se unen con licitaciones_cache.codigo.
- Fechas relativas: CURDATE() y DATE_SUB. Para totales usa SUM/COUNT; los números los pone la base, no tú.
- Órdenes de compra: compras_historial_oc (folio, fecha, total; historial de Obuma) NO tiene negocio_id ni licitacion_codigo: NUNCA la unas a negocios. Las OC de un negocio están en compras_orden_compra_obuma (negocio_id) y las del cliente en ordenes_compra (licitacion_codigo = licitaciones_cache.codigo). «OC sin pagar» = compras_orden_compra_obuma LEFT JOIN compras_oc_pago por oc_folio = obuma_folio, WHERE pago IS NULL.
- Todo JOIN une por una columna clave de AMBAS tablas (negocio_id = negocios.id, licitacion_codigo = codigo…); jamás por una condición constante, IS NOT NULL o una subconsulta que repite la misma tabla: multiplica filas.
- Carga de trabajo del pipeline de licitaciones («cuántos negocios tiene cada persona», «en qué etapa están»): cuenta solo los VIGENTES (ASIGNADO, EN_PROCESO, ANEXOS, VISADO, POSTULADA, POSIBLE_ADJ) y dilo en la respuesta; cuenta todos solo si piden «todos», «históricos» o «descartados». NO aplica a Compras. Muestra siempre el NOMBRE de la persona (JOIN usuarios u ON u.id = n.asignado_a), nunca el id; arma UNA fila por persona con una columna por etapa (SUM(CASE ...)) y una columna total, para que los totales los sume la base.
- Compras (proyectos de compra, compras pendientes/abiertas): una compra = una fila de compras_asignacion. Abierta = cierre_legado IS NULL AND precompra = 0 (pre-compra = precompra = 1 AND cierre_legado IS NULL); cerrada = cierre_legado = 'ENTREGADA'; cancelada = cierre_legado IN ('OC_CANCELADA','NO_REALIZADA'). Atrasadas = con tareas de compras_tarea con estado <> 'HECHA' AND plazo_at < NOW(). La fecha de entrega vencida se calcula en la pantalla y no está guardada: si la piden, responde con las tareas atrasadas y dilo.
- Para «sin X», «que no tienen X» o «pendientes de X»: LEFT JOIN a X y WHERE X.id IS NULL (o NOT EXISTS). NUNCA un INNER JOIN con IS NULL: devuelve 0 filas siempre.
- Los textos largos se recortan con SUBSTRING; nunca los selecciones enteros.`;

function sysSqlSeccion(s: SeccionChat, esquema: string): string {
  return `Eres el analista de datos de LICITANK. Conviertes la pregunta del usuario en UNA consulta SQL de solo lectura sobre el esquema dado.
El usuario está en el menú «${s.nombre}» (${s.que}). Prioriza esos datos, pero puedes cruzar con cualquiera de las tablas listadas.

BASE DE DATOS (MySQL 5.7, solo lectura). Tablas y columnas disponibles:
${esquema}

${PISTAS_SECCION}

REGLAS:
- Responde SOLO con un JSON: {"sql":"SELECT ..."} para preguntas que se resuelven con datos, o {"respuesta":"texto"} si es un saludo, una aclaración, o no se puede responder con estas tablas (dilo: "eso no lo tengo guardado en este menú").
- Una sola sentencia SELECT, sin punto y coma, sin comentarios. Solo las tablas listadas. Sin CTE (WITH), sin JSON_TABLE (MySQL 5.7).
- Usa nombres de columna EXACTOS del esquema. Pon alias legibles en español.
- Agrega siempre ORDER BY y LIMIT (máximo ${MAX_FILAS}).
- Si la pregunta es ambigua en un punto clave, igual intenta la interpretación más razonable y deja que la respuesta lo aclare.`;
}

// ─── Chat GENERAL = toda la aplicación ───────────────────────────────────────────
// El Dashboard no manda el esquema de toda la base en cada pregunta (cientos de columnas: caro y confunde al modelo). Una llamada corta
// elige los MENÚS que toca la pregunta y se suman las tablas de esos menús a las 13 base del chat general. Todo sigue pasando por los
// mismos filtros de empresa y de perfil (filtrosDeAcceso).
const MENUS_ENRUTABLES = SECCIONES.filter(s => s.id !== 'dashboard');

async function elegirMenus(pregunta: string, historialTxt: string): Promise<SeccionChat[]> {
  const lista = MENUS_ENRUTABLES.map(s => `- ${s.id}: ${s.que}`).join('\n');
  try {
    const txt = await llamar(
      'Eres el enrutador de un chat sobre una aplicación de licitaciones. Dada la pregunta, elige los menús cuyos datos hacen falta para responderla (máximo 4). Si basta con licitaciones, negocios, competencia, adjudicaciones, viabilidad, documentos y precios de mercado, devuelve una lista vacía. Responde SOLO un JSON: {"menus":["id1","id2"]}.\n\nMENÚS:\n' + lista,
      `${historialTxt}PREGUNTA: ${pregunta}`, 120);
    const ids: unknown = extraerJson(txt) && (JSON.parse(txt.match(/\{[\s\S]*\}/)![0]) as { menus?: unknown }).menus;
    if (!Array.isArray(ids)) return [];
    return ids.map(i => MENUS_ENRUTABLES.find(s => s.id === String(i))).filter((s): s is SeccionChat => !!s).slice(0, 4);
  } catch { return []; }
}

/** Tras un error por columna inexistente: las columnas REALES de las tablas que usó la consulta (el modelo suele inventar una, p. ej. proveedor_nombre). */
async function columnasDeLasTablas(sql: string, accesibles: string[]): Promise<string> {
  try {
    const cols = await columnasPorTabla();
    const usadas = accesibles.filter(t => new RegExp('\\b' + t + '\\b', 'i').test(sql));
    if (!usadas.length) return '';
    return '\nColumnas REALES de las tablas que usaste:\n' + usadas.map(t => `${t}: ${(cols.get(t) || []).map(c => c.nombre).filter(n => !COLUMNA_SENSIBLE.test(n)).join(', ')}`).join('\n');
  } catch { return ''; }
}

export interface OpcionesChat {
  /** Sección del chat (por defecto el general del Dashboard). */
  seccion?: string;
  /** Empresa-cliente de quien pregunta (sale de la sesión, nunca del navegador). */
  clienteId: number;
  /** Perfil normal: solo ve lo asignado a él. */
  restringidoUserId?: number | null;
}

export async function responderGlobal(pregunta: string, historial: MensajeHistorial[], opts: OpcionesChat): Promise<{ respuesta: string; sql?: string; filas?: number }> {
  const sec = opts.seccion && opts.seccion !== 'dashboard' ? seccionPorId(opts.seccion) : null;
  const alcance: Alcance = { clienteId: opts.clienteId, restringidoUserId: opts.restringidoUserId ?? null };
  // Las respuestas viejas pueden estar equivocadas (visto en licitank.cl: repetía «162 compras» de una respuesta anterior a un arreglo).
  // El historial sirve para entender a qué se refiere la pregunta; las cifras salen siempre de la consulta nueva.
  const contexto = historial.length ? `CONVERSACIÓN PREVIA (solo para entender la pregunta; sus cifras pueden estar equivocadas: NO las copies, vuelve a calcular todo con la base):\n${resumenHistorial(historial)}\n\n` : '';
  // Chat general: base de 13 tablas + las de los menús que toca la pregunta.
  const menus = sec ? [] : await elegirMenus(pregunta, contexto);
  const extras = [...new Set(menus.flatMap(m => m.tablas))].filter(t => !TABLAS_PERMITIDAS.includes(t));
  const tablas = sec ? sec.tablas : [...TABLAS_PERMITIDAS, ...extras];
  const { accesibles } = await filtrosDeAcceso(tablas, alcance);
  if (!accesibles.length) return { respuesta: 'En este menú no tengo datos a los que tu perfil pueda acceder, así que no te puedo ayudar con eso por aquí.' };
  const extrasAccesibles = extras.filter(t => accesibles.includes(t));
  const notasMenus = Object.assign({}, ...menus.map(m => m.notas || {}));
  const adicional = extrasAccesibles.length
    ? `\n\nTABLAS ADICIONALES (de los menús ${menus.map(m => m.nombre).join(', ')}; columnas exactas):\n${await esquemaAutomatico(extrasAccesibles, notasMenus)}\nUna a ellas con negocios por negocio_id = negocios.id y con licitaciones_cache por licitacion_codigo = codigo.`
    : '';

  const sistemaSql = (sec ? sysSqlSeccion(sec, await esquemaAutomatico(accesibles, sec.notas)) : SYS_SQL + adicional) + (alcance.restringidoUserId ? NOTA_RESTRINGIDO : '');
  const persona = sec ? `${SYS_RESPUESTA}\nEstás en el menú «${sec.nombre}» (${sec.que}); contesta desde ahí.` : SYS_RESPUESTA;
  let pedido = `${contexto}PREGUNTA: ${pregunta}`;
  let sqlFinal: string | undefined;
  let filas: any[] | null = null;
  let ultimoError = '';
  let vacio: { sql: string; filas: any[] } | null = null;

  for (let intento = 0; intento < 3 && !filas; intento++) {
    const salida = extraerJson(await llamar(sistemaSql, pedido, 3000));
    if (!salida) { ultimoError = 'El modelo no devolvió JSON.'; pedido += `\n\nTu respuesta anterior no era un JSON válido. Responde solo con {"sql":"..."} o {"respuesta":"..."}.`; continue; }
    if (salida.inventario && !sec) {
      const cob = opts.clienteId === 1 ? await textoCobertura() : 'Solo puedo ver los datos de tu empresa y los públicos de Mercado Público; el inventario completo de la base no está disponible para tu cuenta.';
      const resp = await llamar(
        persona,
        `${contexto}PREGUNTA: ${pregunta}\n\nEl usuario pregunta qué datos tenemos y cuáles faltan. Responde con este INVENTARIO REAL de la base (cifras exactas), ordenado en: "Lo que sí tenemos", "Lo que nos falta o está incompleto" y "Cómo completarlo" (p. ej. leer los documentos sin texto, guardar más resultados de adjudicación y ofertas de la competencia).\n\nINVENTARIO:\n${cob}`,
        2000,
        0.3,
      );
      return { respuesta: tutear(resp) || cob };
    }
    if (!salida.sql) return { respuesta: tutear(String(salida.respuesta || 'No tengo ese dato guardado.')) };
    try {
      sqlFinal = await validarSqlSoloLectura(salida.sql, tablas, alcance);
      filas = await ejecutarSolo(sqlFinal);
      // 0 filas: casi siempre es un JOIN que anula el resultado o un filtro inexistente. Una segunda mirada antes de decir «no hay».
      // Resultado que repite la misma fila (JOIN que multiplica: p. ej. una OC cruzada con todos los negocios): también se revisa una vez.
      const repetida = filas.length >= 50 && /\bjoin\b/i.test(sqlFinal) && new Set(filas.map(f => JSON.stringify(Object.values(f).slice(0, 2)))).size <= filas.length * 0.1;
      if ((filas.length === 0 || repetida) && !vacio) {
        const motivo = filas.length === 0
          ? 'devolvió 0 filas. Revisa que ningún INNER JOIN anule el resultado (para «sin X» usa LEFT JOIN + IS NULL) y que los valores de los filtros existan'
          : 'devolvió filas casi idénticas entre sí: un JOIN está multiplicando el resultado. Une cada tabla por su columna clave real (revisa las PISTAS de relaciones) y no unas tablas que no se relacionan';
        vacio = { sql: sqlFinal, filas };
        filas = null;
        pedido += `\n\nTu consulta ${motivo}. Consulta: ${salida.sql}\nSi la consulta era correcta, repítela igual; si no, corrígela.${await columnasDeLasTablas(salida.sql, accesibles)}`;
      }
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
      pedido += `\n\nTu consulta anterior falló: ${ultimoError}\nConsulta: ${salida.sql}\nCorrígela usando solo las tablas y columnas del esquema.${await columnasDeLasTablas(salida.sql, accesibles)}`;
    }
  }
  if (!filas && vacio) { filas = vacio.filas; sqlFinal = vacio.sql; }
  if (!filas) return { respuesta: `No pude armar una consulta válida para esa pregunta (${ultimoError}). Intenta reformularla con más detalle.` };

  let datos = jsonHoraChile(recortarCampos(filas));
  if (datos.length > MAX_CHARS_FILAS) datos = `${datos.slice(0, MAX_CHARS_FILAS)} …[recortado]`;
  const tope = filas.length >= MAX_FILAS ? `\nOJO: el resultado llegó al tope de ${MAX_FILAS} filas (puede haber más).` : '';
  // La cobertura del mercado (cifras globales) solo aplica al chat general y a empresas con acceso total.
  const cob = !sec && opts.clienteId === 1 && /documentos_cache|adjudicacion_cache|oferta_competencia|licitaciones_cache/i.test(sqlFinal || '') ? await textoCobertura().catch(() => '') : '';
  // La tabla ordenes_compra son las OC que los organismos NOS envían; el modelo las llamaba «emitidas a proveedores».
  const aclaraOC = /\bordenes_compra\b/i.test(sqlFinal || '') && !/compras_orden_compra_obuma/i.test(sqlFinal || '')
    ? '\n\nACLARACIÓN: estas órdenes de compra son las que los organismos (clientes) nos envían por Mercado Público. NO son órdenes que nosotros emitimos a proveedores; no lo digas así.'
    : '';
  const respuesta = await llamar(
    persona,
    `${contexto}PREGUNTA: ${pregunta}\n\nCONSULTA EJECUTADA:\n${sqlFinal}${aclaraOC}\n\nFILAS (${filas.length}):\n${datos}${tope}${cob ? `\n\nCOBERTURA DE LA BASE (para decir hasta dónde llegan los datos):\n${cob}` : ''}`,
    2000,
    0.3,
  );
  return { respuesta: tutear(respuesta) || 'La consulta no devolvió información para responder.', sql: sqlFinal, filas: filas.length };
}

/** Perfil normal (no admin ni Compras): el chat solo le muestra lo asignado a él. Devuelve su id, o null si tiene acceso completo. */
export async function restringidoPara(u: { id: number; rol?: string | null }): Promise<number | null> {
  if (u.rol === 'admin') return null;
  const { permisosDeUsuario } = await import('@/app/lib/api-auth');
  const p = await permisosDeUsuario(u.id, u.rol);
  return p.compras || p.compras_todo || p.aprobar_comercial ? null : u.id;
}
