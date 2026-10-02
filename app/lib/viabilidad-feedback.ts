// app/lib/viabilidad-feedback.ts
// FEEDBACK LOOP (aprendizaje por refuerzo manual) del análisis de viabilidad.
//
// El experto corrige un veredicto de la IA con un comentario. En vez de reescribir el
// prompt maestro (frágil, no auditable), guardamos la corrección como una LECCIÓN atómica
// y la destilamos en una REGLA general y reutilizable. En cada análisis, esas reglas se
// INYECTAN en el prompt (prompt dinámico por composición). Cada regla es desactivable, así
// que un mal aprendizaje se revierte sin tocar el prompt base.

import pool from '@/app/lib/db';
import { crearChatIA, iaTextoConfigurada } from '@/app/lib/gemini';

const MAX_REGLAS_INYECTADAS = 40; // tope de reglas que entran al prompt (las más recientes)

export interface Feedback {
  id: number;
  licitacion_codigo: string;
  usuario_id: number | null;
  veredicto_ia: string | null;
  veredicto_humano: string | null;
  comentario: string;
  regla: string;
  ambito: string;
  activa: number;
  created_at: string;
}

async function ensureTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS viabilidad_feedback (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    licitacion_codigo VARCHAR(64) NOT NULL,
    usuario_id        INT NULL,
    veredicto_ia      VARCHAR(32) NULL,
    veredicto_humano  VARCHAR(16) NULL,
    comentario        TEXT NOT NULL,
    regla             TEXT NOT NULL,
    ambito            VARCHAR(40) NOT NULL DEFAULT 'global',
    activa            TINYINT NOT NULL DEFAULT 1,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_codigo (licitacion_codigo),
    INDEX idx_activa (activa)
  )`);
  // Defensivo: instancias antiguas cuya tabla se creó sin la columna 'ambito'. MySQL 5.7 no
  // soporta ADD COLUMN IF NOT EXISTS, así que se intenta y se ignora el error de "columna duplicada".
  try { await pool.query(`ALTER TABLE viabilidad_feedback ADD COLUMN ambito VARCHAR(40) NOT NULL DEFAULT 'global'`); }
  catch { /* la columna ya existe */ }
  // FIRMA estructural del documento corregido (aprendizaje por formato): permite reconocer un
  // documento PARECIDO en el futuro y aplicar la regla con prioridad. Solo se rellena en reglas
  // de 'lectura'. Defensivo igual que 'ambito'.
  try { await pool.query(`ALTER TABLE viabilidad_feedback ADD COLUMN firma TEXT NULL`); }
  catch { /* la columna ya existe */ }
}

// ─── FIRMA ESTRUCTURAL DE DOCUMENTOS (aprendizaje por formato) ───────────────────
// Cuando el experto corrige CÓMO se lee un documento, guardamos —además de la regla— una "huella"
// del FORMATO/ESTRUCTURA del documento (no de su contenido): qué encabezados de tabla trae, si lista
// "LÍNEA DE PRODUCTO N°X", si fija "monto por línea", si es catálogo "Código/Valor Unitario", etc.
// Así, cuando llega una licitación con un documento del MISMO formato, reconocemos el caso y le
// inyectamos la regla con prioridad máxima ("este documento se parece a uno que ya corregiste").
// Los marcadores describen ESTRUCTURA, no productos concretos → una firma es comparable entre
// licitaciones distintas del mismo tipo.
const MARCADORES_FIRMA: [string, RegExp][] = [
  ['linea_de_producto',       /l[ií]nea\s+de\s+producto\s+n[°º]/i],
  ['ficha_linea',             /(?:formulario|ficha)\s+l[ií]nea\s*n[°º]/i],
  ['monto_por_linea',         /(?:presupuesto|monto)\s+(?:\w+\s+){0,3}(?:por|de\s+cada|para(?:\s+la)?)\s+l[ií]nea/i],
  ['kit',                     /\bkit(?:s|es)?\b/i],
  ['tabla_item_articulo',     /[íi]tem\s+art[íi]culo/i],
  ['col_unidad_cant_detalle', /unidad[\s\S]{0,25}cantidad[\s\S]{0,25}detalle/i],
  ['catalogo_valor_unitario', /valor\s+unitario\s+neto|c[oó]digo\s+interno/i],
  ['cumple_si_no',            /cumple[\s\S]{0,25}s[ií]\s*\/?\s*no/i],
  ['caracteristicas_tecnicas',/caracter[íi]sticas?\s+t[eé]cnicas?/i],
  ['anexo_economico',         /anexo\s+econ[oó]mico|oferta\s+econ[oó]mica|propuesta\s+econ[oó]mica/i],
  ['subtotal_iva_total',      /sub\s*total[\s\S]{0,60}\biva\b[\s\S]{0,60}\btotal\b/i],
  ['tabla_desc_precio_unit',  /(?:descrip|detalle)[\s\S]{0,40}precio\s+unitario/i],
];

// Firma = lista ordenada de los marcadores de formato presentes en el texto de los documentos.
export function calcularFirmaDocumentos(docs: { texto?: string | null }[]): string {
  const blob = docs.map(d => d.texto || '').join('\n');
  if (blob.length < 40) return '';
  return MARCADORES_FIRMA.filter(([, re]) => re.test(blob)).map(([k]) => k).sort().join('|');
}

function firmaSet(f: string): Set<string> { return new Set((f || '').split('|').filter(Boolean)); }

// ¿Dos firmas describen el MISMO formato de documento? Jaccard ≥ 0.5 con al menos 2 marcadores
// compartidos (evita matches por un solo marcador genérico como "kit").
// v4.0 (P12): los marcadores que aparecen en casi toda licitación NO cuentan para decidir que dos
// documentos se parecen — con ellos, reglas de otra licitación entraban con "prioridad absoluta"
// por coincidencias genéricas.
const MARCADORES_GENERICOS = new Set(['anexo_economico', 'caracteristicas_tecnicas', 'subtotal_iva_total', 'cumple_si_no']);
export function firmasSimilares(a: string, b: string): boolean {
  const sinGenericos = (f: string) => new Set([...firmaSet(f)].filter(x => !MARCADORES_GENERICOS.has(x)));
  const A = sinGenericos(a), B = sinGenericos(b);
  if (A.size < 2 || B.size < 2) return false;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return inter >= 2 && union > 0 && inter / union >= 0.5;
}

// Firma estructural de una licitación desde sus documentos cacheados (para guardar/comparar).
export async function firmaDeLicitacion(codigo: string): Promise<string> {
  try {
    const [rows] = await pool.query(
      `SELECT texto_extraido AS texto FROM documentos_cache WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL`,
      [codigo]);
    return calcularFirmaDocumentos((rows as any[]).map(r => ({ texto: r.texto })));
  } catch { return ''; }
}

// Destila el comentario libre del experto en UNA regla breve y GENERAL (sin el nombre de la
// licitación concreta), apta para inyectarse en el prompt.
// v4.0 (P12, prompt auxiliar F.1): la regla habla de qué LEER, REPORTAR o ADVERTIR — nunca de un
// veredicto, un nivel de atractivo, un puntaje ni de cómo se adjudica (eso lo decide el sistema).
// Si la IA falla o no puede expresarla así, devuelve '' y la regla queda `sin_destilar` (no se
// inyecta hasta que CA la revise). Ya no se guarda el comentario crudo como regla.
async function destilarRegla(comentario: string, nivelIA: string | null): Promise<string> {
  const limpio = comentario.trim();
  if (!iaTextoConfigurada()) return '';
  try {
    const completion = await crearChatIA({
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Conviertes la corrección de CA (experto en licitaciones públicas chilenas) en
UNA regla breve, general y accionable para que el analista IA no repita el
error al LEER y REPORTAR los datos de las bases.
La regla debe: (1) ser CONDICIONAL cuando aplique ("Si las bases ... entonces
..."); (2) referirse a qué leer, qué reportar o qué advertir, nunca a un
veredicto, un nivel de atractivo, un puntaje ni a cómo se adjudica (eso lo
decide el sistema); (3) NO mencionar el ID ni el nombre de la licitación; (4) estar
pensada para una empresa que VENDE bienes y equipamiento con bodega en
Santiago; (5) máximo 240 caracteres.
Si la corrección no se puede expresar así, devuelve {"regla": ""}.
Devuelve SOLO JSON: {"regla": "..."}.`,
        },
        {
          role: 'user',
          content: `Nivel de atractivo que mostró el sistema: ${nivelIA || '(desconocido)'}
Explicación de CA: ${limpio}

Devuelve {"regla": "..."} con UNA sola regla general.`,
        },
      ],
    });
    const txt = completion.choices[0]?.message?.content ?? '';
    const ini = txt.indexOf('{'); const fin = txt.lastIndexOf('}');
    const obj = JSON.parse(ini !== -1 ? txt.slice(ini, fin + 1) : txt);
    const regla = String(obj?.regla || '').trim();
    return regla.length >= 8 ? regla.slice(0, 240) : '';
  } catch (e) {
    console.warn('[viabilidad-feedback] destilación falló, la regla queda sin destilar:', String(e).slice(0, 120));
    return '';
  }
}

// Ámbitos de las reglas aprendidas:
//   'global'  → reglas de VIABILIDAD/DESCARTE (afectan el veredicto de negocio). Ámbito por defecto.
//   'lectura' → reglas de LECTURA/EXTRACCIÓN de documentos (cómo se leen planillas, ítems,
//               cantidades, unidades y qué frases reportar como evidencia). Mejoran el COSTEO.
//               v4.0: ya no dicen cómo se adjudica — eso lo decide el código con las evidencias.
export type AmbitoRegla = 'global' | 'lectura';
export const AMBITOS_VALIDOS: AmbitoRegla[] = ['global', 'lectura'];

// Destila la corrección del experto sobre CÓMO SE LEE/EXTRAE un documento en UNA regla general de
// lectura. A diferencia de la regla global (veredicto de negocio), esta se enfoca en la extracción
// de datos: ítems, cantidades, unidades, columnas y la modalidad de la oferta económica.
async function destilarReglaLectura(comentario: string): Promise<string> {
  const limpio = comentario.trim();
  if (!iaTextoConfigurada()) return '';
  try {
    const completion = await crearChatIA({
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Conviertes la corrección de CA sobre CÓMO SE LEE un documento de licitación
pública chilena (planilla de cotización, anexo económico, listado de ítems,
formulario técnico) en UNA regla breve, general y accionable para que el
analista IA extraiga mejor los datos.
La regla debe: (1) referirse a la LECTURA de datos (ítems, cantidades,
unidades, columnas, marca o modelo de referencia, características, o qué
frases reportar como evidencia), nunca a conclusiones; (2) NO decir cómo se
adjudica (GLOBAL o por línea): eso lo decide el sistema con las evidencias;
(3) ser CONDICIONAL cuando aplique ("Si el documento tiene ... entonces ...");
(4) NO mencionar el ID ni el nombre de la licitación; (5) máximo 240
caracteres.
Si la corrección no se puede expresar así, devuelve {"regla": ""}.
Devuelve SOLO JSON: {"regla": "..."}.`,
        },
        {
          role: 'user',
          content: `Corrección del experto sobre cómo leer/extraer el documento:
${limpio}

Devuelve {"regla": "..."} con UNA sola regla general de lectura.`,
        },
      ],
    });
    const txt = completion.choices[0]?.message?.content ?? '';
    const ini = txt.indexOf('{'); const fin = txt.lastIndexOf('}');
    const obj = JSON.parse(ini !== -1 ? txt.slice(ini, fin + 1) : txt);
    const regla = String(obj?.regla || '').trim();
    return regla.length >= 8 ? regla.slice(0, 240) : '';
  } catch (e) {
    console.warn('[viabilidad-feedback] destilación de lectura falló, la regla queda sin destilar:', String(e).slice(0, 120));
    return '';
  }
}

export async function guardarFeedback(input: {
  codigo: string; usuarioId: number | null; comentario: string;
  veredictoHumano: string | null; veredictoIA: string | null;
  ambito?: AmbitoRegla;
}): Promise<{ regla: string; sinDestilar: boolean }> {
  await ensureTable();
  const ambito: AmbitoRegla = input.ambito === 'lectura' ? 'lectura' : 'global';
  // v4.0: `veredictoIA` guarda el NIVEL de atractivo que vio el experto (la escala GANABLE/NO VAMOS
  // desapareció). `veredictoHumano` deja de llenarse en la pantalla (se sacaron los botones).
  const regla = ambito === 'lectura'
    ? await destilarReglaLectura(input.comentario)
    : await destilarRegla(input.comentario, input.veredictoIA);
  const sinDestilar = !regla;
  const veredictoHumano = ambito === 'lectura' ? null : input.veredictoHumano;
  const veredictoIA = ambito === 'lectura' ? null : input.veredictoIA;
  // Solo las reglas de LECTURA guardan la firma del formato del documento (para reconocer casos
  // parecidos). Se calcula de los documentos cacheados de la licitación corregida.
  const firma = ambito === 'lectura' ? await firmaDeLicitacion(input.codigo) : '';
  const valores = [input.codigo, input.usuarioId, veredictoIA, veredictoHumano, input.comentario.trim(), regla, ambito, firma || null];
  try {
    await pool.query(
      `INSERT INTO viabilidad_feedback (licitacion_codigo, usuario_id, veredicto_ia, veredicto_humano, comentario, regla, ambito, firma, sin_destilar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...valores, sinDestilar ? 1 : 0]);
  } catch {
    // Antes de migration-137 la columna no existe: una regla sin destilar queda INACTIVA para que
    // igual no se inyecte el comentario crudo.
    await pool.query(
      `INSERT INTO viabilidad_feedback (licitacion_codigo, usuario_id, veredicto_ia, veredicto_humano, comentario, regla, ambito, firma, activa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...valores, sinDestilar ? 0 : 1]);
  }
  return { regla, sinDestilar };
}

export async function listarFeedback(codigo: string): Promise<Feedback[]> {
  try {
    // Solo las activas: una regla desactivada queda en el historial (pantalla de reglas), no acá.
    const [rows] = await pool.query(
      `SELECT * FROM viabilidad_feedback WHERE licitacion_codigo = ? AND activa = 1 ORDER BY created_at DESC`, [codigo]);
    return rows as Feedback[];
  } catch { return []; }
}

// v4.0 (P12, decisión de CA): BORRAR = DESACTIVAR. La regla queda en el historial con quién y
// cuándo la desactivó; nunca se hace DELETE.
export async function eliminarFeedback(id: number, usuarioId: number | null = null): Promise<void> {
  try {
    await pool.query(`UPDATE viabilidad_feedback SET activa = 0, desactivada_por = ?, desactivada_en = NOW() WHERE id = ?`, [usuarioId, id]);
  } catch {
    try { await pool.query(`UPDATE viabilidad_feedback SET activa = 0 WHERE id = ?`, [id]); } catch { /* tabla puede no existir */ }
  }
}

// Reglas activas de un ÁMBITO para inyectar en el prompt (las más recientes primero). Resiliente:
// si la tabla aún no existe, no rompe el análisis — simplemente no hay reglas aprendidas todavía.
// Las reglas guardadas antes de existir la columna 'ambito' quedan como 'global' (default de la
// tabla), así que el ámbito 'global' sigue leyendo todo lo histórico sin migración.
export async function cargarReglasAprendidas(ambito: AmbitoRegla = 'global', limite = MAX_REGLAS_INYECTADAS): Promise<string[]> {
  return (await cargarReglasAprendidasConId(ambito, limite)).map(r => r.regla);
}

// Consulta de reglas activas e inyectables. Las `sin_destilar` no entran (v4.0). Antes de
// migration-137 la columna no existe: se reintenta sin ella en vez de devolver cero reglas.
async function consultarReglas(ambito: AmbitoRegla, limite: number, conFirma: boolean): Promise<any[]> {
  const cols = `id, regla${conFirma ? ", COALESCE(firma, '') AS firma" : ''}`;
  try {
    const [rows] = await pool.query(
      `SELECT ${cols} FROM viabilidad_feedback WHERE activa = 1 AND sin_destilar = 0 AND ambito = ? ORDER BY created_at DESC LIMIT ?`, [ambito, limite + 1]);
    return rows as any[];
  } catch {
    const [rows] = await pool.query(
      `SELECT ${cols} FROM viabilidad_feedback WHERE activa = 1 AND ambito = ? ORDER BY created_at DESC LIMIT ?`, [ambito, limite + 1]);
    return rows as any[];
  }
}

// v4.0 (P11/P12): devuelve también el `id` para guardar en cada informe qué reglas actuaron
// (`_reglas_activas`). Si hay más activas que el tope, se avisa en el log: nada sale en silencio.
export async function cargarReglasAprendidasConId(ambito: AmbitoRegla = 'global', limite = MAX_REGLAS_INYECTADAS): Promise<{ id: number; regla: string }[]> {
  try {
    const rows = await consultarReglas(ambito, limite, false);
    if (rows.length > limite) console.warn(`[viabilidad-feedback] hay más de ${limite} reglas activas de ${ambito}: las más antiguas quedan fuera del prompt (revisar en la pantalla de reglas).`);
    return rows.slice(0, limite).map(r => ({ id: Number(r.id), regla: String(r.regla || '').trim() })).filter(r => r.regla);
  } catch { return []; }
}

// Atajo semántico: reglas de LECTURA/EXTRACCIÓN de documentos (mejoran el costeo).
export async function cargarReglasLectura(limite = MAX_REGLAS_INYECTADAS): Promise<string[]> {
  return cargarReglasAprendidas('lectura', limite);
}

// Reglas de lectura CON su firma de formato, para reconocer documentos parecidos al analizar.
export async function cargarReglasLecturaConFirma(limite = MAX_REGLAS_INYECTADAS): Promise<{ id: number; regla: string; firma: string }[]> {
  try {
    const rows = await consultarReglas('lectura', limite, true);
    if (rows.length > limite) console.warn(`[viabilidad-feedback] hay más de ${limite} reglas de lectura activas: las más antiguas quedan fuera del prompt.`);
    return rows.slice(0, limite)
      .map(r => ({ id: Number(r.id), regla: String(r.regla || '').trim(), firma: String(r.firma || '') }))
      .filter(r => r.regla);
  } catch { return []; }
}

// Bloque de texto listo para inyectar en el system prompt (vacío si no hay reglas).
export function bloqueReglasAprendidas(reglas: string[]): string {
  if (!reglas.length) return '';
  const lista = reglas.map((r, i) => `${i + 1}. ${r}`).join('\n');
  // v4.0 (prompt auxiliar F.3): jerarquía única — lo que decide el código manda sobre cualquier regla.
  return `REGLAS DEL EXPERTO (correcciones de CA a análisis anteriores). Aplícalas al
leer y reportar los datos de ESTE análisis. No cambian lo que decide el
sistema (adjudicación, exclusión, nivel). Si una regla choca con una
instrucción de este prompt, manda el prompt. Si aplicaste una regla,
menciónala en veredicto.advertencias, en palabras simples, sin códigos.
${lista}

`;
}

// Bloque de MÁXIMA prioridad para cuando el documento actual se parece (por firma) a uno que el
// experto ya corrigió: el formato coincide, así que la regla aprendida aplica casi con certeza.
export function bloqueReglasLecturaSimilares(reglas: string[]): string {
  if (!reglas.length) return '';
  const lista = reglas.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `
ESTE DOCUMENTO TIENE EL MISMO FORMATO QUE UNO QUE CA YA CORRIGIÓ. Aplica estas
reglas primero al extraer ítems, cantidades, unidades y evidencias. No cambian
lo que decide el sistema. Si una regla choca con una instrucción de este
prompt, manda el prompt:
${lista}
`;
}

// Bloque de reglas de LECTURA/EXTRACCIÓN, para inyectar en el prompt que lee los documentos.
export function bloqueReglasLectura(reglas: string[]): string {
  if (!reglas.length) return '';
  const lista = reglas.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `
REGLAS DE LECTURA DEL EXPERTO. Aplícalas al extraer ítems, cantidades,
unidades, marcas o modelos de referencia y evidencias de ESTE análisis. No
cambian lo que decide el sistema. Si una regla choca con una instrucción de
este prompt, manda el prompt:
${lista}
`;
}
