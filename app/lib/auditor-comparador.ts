// app/lib/auditor-comparador.ts
// COMPARADOR DE FICHAS — llamadas de IA (PROMPT 4 v1.0). Server-only (importa gemini.ts).
//
// Tres llamadas separadas, como recomienda la nota 0.2 del prompt:
//   L1 inventariarFicha()    — PARTES I–III. Identifica y cataloga UNA ficha (en paralelo, una por archivo).
//   L2 compararRequisitos()  — PARTES I, II, IV–VII, X, XII. Una llamada por lote de requisitos de una línea.
//   L3 reverificarRojos()    — PARTES I y IX. Segunda lectura independiente de los CUMPLE críticos.
//
// Los prompts son los bloques del .md tal cual (auditor-comparador-prompts.ts, GENERADO). Lo que
// se agrega acá es solo el CONTRATO de cada llamada (qué recibe, qué devuelve) y los datos.
// Lo que la IA devuelve NO se guarda directo: pasa por procesarItemComparador() (core).
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { MOTOR_KIMI_ESTRICTO, MOTOR_GLM, type MotorComparacion } from '@/app/lib/auditor-tecnico';
import {
  PARTE_I, PARTE_II, PARTE_III, PARTE_IV, PARTE_V, PARTE_VI, PARTE_VII, PARTE_IX, PARTE_X, PARTE_XII,
} from '@/app/lib/auditor-comparador-prompts';
import type { FichaInventariada, FilaComparador, ItemCrudoIA, ReverificacionCruda } from '@/app/lib/auditor-comparador-core';

const sec = (titulo: string, cuerpo: string) => `\n\n══════ ${titulo} ══════\n${cuerpo}`;

// ─── Prompts de sistema: las PARTES que corresponden a cada llamada + su contrato ───────────────
const CONTRATO_L1 = `

══════ CONTRATO DE ESTA LLAMADA (L1 — inventario de UN archivo) ══════
Recibes UN archivo (su texto ya extraído) y el contexto de la línea de la licitación a la que una persona lo soltó. Devuelve SOLO JSON, sin markdown, con la tarjeta de identificación de la PARTE III:
{"inventario":{"tipo":"ficha_producto|catalogo_familia|cotizacion|certificado|plano|foto|respaldo_informal|irrelevante","marca":"","modelos":[""],"tipo_equipo":"","idioma_original":"","traducido":false,"emisor":"fabricante|distribuidor|revendedor|desconocido","proveedor":"nombre de la empresa que emite el documento, o vacío si no se identifica","formalidad":"formal|informal","legibilidad":"completa|parcial|nula","no_legible_detalle":"","corresponde_licitacion":true,"motivo_no_corresponde":"","candidatos":[{"modelo":"","razon":""}]},"no_pude_leer":[{"archivo":"","que":"","donde":""}]}
- "modelos": TODOS los modelos que contiene, uno por uno (si es catálogo de familia).
- "candidatos": solo si es catálogo de familia con varios modelos — los que se ajustan a la línea, ordenados por ajuste, con el motivo. NO ELIGES: la asignación la confirma una persona.
- Este archivo se evalúa contra UNA línea: si no guarda relación con ella, corresponde_licitacion=false y explica por qué.
- El texto no trae numeración de página: no inventes páginas.`;

const CONTRATO_L2 = `

══════ CONTRATO DE ESTA LLAMADA (L2 — comparación de UNA línea) ══════
- Recibes los REQUISITOS de la línea, cada uno con su identificador "n". Devuelve UN ítem por cada n recibido, con ese mismo n. No agregues ni omitas requisitos.
- La asignación ficha ↔ línea (PARTE IV) YA fue confirmada por una persona: las fichas que recibes son las de esta línea. Si un catálogo trae varios modelos, evalúa ÚNICAMENTE el "modelo asignado" indicado.
- El tipo de requisito (PISO / TECHO / EXACTO / RANGO / CUALITATIVO / NORMATIVO) y la criticidad vienen dados en la lista: respétalos (PARTE V). La criticidad NO se recalcula.
- Los requisitos técnico-administrativos (PARTE VIII), el certificado de admisibilidad, los bloqueos, los mensajes consolidados al proveedor y la marca SOBRECUMPLE los arma el sistema por código: NO los incluyas. Sí debes llenar, por cada ítem que no quede CUMPLE, los cinco campos de "ayuda" de la PARTE VII.
- El texto de las fichas no trae numeración de página: cita documento + sección/tabla/fila EXACTA tal como aparece en el texto, y NO inventes números de página.
- "ofertado_valor": el valor o la norma tal como los escribe la ficha; si es un número, SOLO el número (sin la unidad) y su unidad en "ofertado_unidad_original". Para una medida compuesta ("205 x 107 x 70") va el texto completo.
- "veredicto": CUMPLE | NO_CUMPLE | CUMPLE_CON_COMPLEMENTO | SIN_VEREDICTO.
- En "emparejamiento_propuesto" agrega "fuente_equivalencia" (organismo, documento o URL) SOLO si propones una equivalencia entre normas; sin fuente verificable no propongas.
- Si un dato de la ficha contradice a otra ficha, usa "conflicto_fuentes" con las dos versiones y sus citas; no elijas.
- Devuelve SOLO JSON, sin markdown ni texto fuera del JSON:
{"matriz_tecnica":[{"linea":0,"items":[{"n":0,"requerido_texto":"","fuente_bases":"","ofertado_valor":"","ofertado_unidad_original":"","factor_conversion":"","fuente_ficha":"","origen_dato":"FICHA|CONFIRMACION_INFORMAL|DECLARADO|CONTRADICE_FICHA|HEREDADO|NO_LEGIBLE","respaldo_adjunto":"","puntaje_en_riesgo":"","emparejamiento_literal":true,"emparejamiento_propuesto":{"parametro_bases":"","parametro_ficha":"","razon":"","fuente_equivalencia":""},"veredicto":"","complemento":{"tipo":"declarativo|accesorio","descripcion":"","cotizado":false,"respaldo":""},"ayuda":{"diagnostico":"","hipotesis_causa":[""],"pregunta_proveedor":"","veredicto_equivalencia":"","ruta":"SALVABLE|INSALVABLE","accion_concreta":""},"conflicto_fuentes":{"existe":false,"versiones":[{"documento":"","valor":"","cita":""}]}}]}],"no_pude_leer":[{"archivo":"","que":"","donde":""}]}`;

const CONTRATO_L3 = `

══════ CONTRATO DE ESTA LLAMADA (L3 — reverificación de rojos) ══════
Recibes ítems de criticidad INADMISIBLE que la primera pasada declaró CUMPLE, con la UBICACIÓN que se citó (NO el valor que se leyó: tu pasada es independiente). Para cada uno, vuelve a la ficha, relee esa ubicación y di qué valor o norma está escrito ahí.
- "valor_releido": el valor tal como está escrito (si es número, SOLO el número) y su unidad en "unidad_releida". Vacío si no lo encuentras.
- "confirmado": false si el dato no aparece donde se citó o no dice lo que se afirmaba; true si lo encontraste. El sistema compara tu lectura con la primera y con lo exigido.
- "rectificacion": si confirmado=false, explica la diferencia.
- Devuelve SOLO JSON: {"reverificacion":[{"n":0,"confirmado":true,"valor_releido":"","unidad_releida":"","cita":"","rectificacion":""}]}`;

export const SYS_L1 = PARTE_I + sec('PARTE II — ENTRADAS', PARTE_II) + sec('PARTE III — ETAPA 1 · INVENTARIO E IDENTIFICACIÓN DE FICHAS', PARTE_III) + CONTRATO_L1;
export const SYS_L2 = PARTE_I + sec('PARTE II — ENTRADAS', PARTE_II)
  + sec('PARTE IV — ETAPA 2 · ASIGNACIÓN FICHA ↔ LÍNEA', PARTE_IV)
  + sec('PARTE V — ETAPA 3 · CLASIFICACIÓN DEL REQUISITO', PARTE_V)
  + sec('PARTE VI — ETAPA 4 · COMPARACIÓN Y VEREDICTO', PARTE_VI)
  + sec('PARTE VII — ETAPA 5 · SALIDA DE AYUDA', PARTE_VII)
  + sec('PARTE X — FORMATO DE SALIDA (JSON)', PARTE_X)
  + sec('PARTE XII — AUTOCHEQUEO (cierre obligatorio del modelo)', PARTE_XII) + CONTRATO_L2;
export const SYS_L3 = PARTE_I + sec('PARTE IX — ETAPA 7 · REVERIFICACIÓN DE ROJOS Y CERTIFICADO DE ADMISIBILIDAD', PARTE_IX) + CONTRATO_L3;

// Kimi razona y ese razonamiento come del mismo presupuesto de tokens que el JSON: por eso el lote
// es corto (cada ítem con "ayuda" pesa ~250 tokens) — ver MOTOR_KIMI en auditor-tecnico.ts.
const LOTE_L2 = 10;
const TOPE_TEXTO_L2 = 60_000;
const TOPE_TEXTO_L1 = 24_000;

async function llamarJSON(system: string, user: string, motor: MotorComparacion): Promise<any> {
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: motor.maxTokens,
    response_format: { type: 'json_object' },
  }, { timeoutMs: motor.timeoutMs, modeloPreferido: motor.modeloPreferido, proveedorPreferido: motor.proveedorPreferido, sinRespaldo: motor.sinRespaldo });
  return parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
}

const s = (v: unknown, max = 300) => (v == null ? '' : String(v)).trim().slice(0, max);

// ─── L1 — inventario de UNA ficha ───────────────────────────────────────────────────────────────
export interface ContextoLinea { licitacionCodigo: string; linea: number | null; nombre: string; requisitos: string[] }

/** Tarjeta de un archivo cuyo texto no se pudo leer — sin IA, y sin inventar nada. */
function tarjetaIlegible(archivo: string, url: string, detalle: string): { ficha: FichaInventariada; noPudeLeer: Array<{ archivo: string; que: string; donde: string }> } {
  return {
    ficha: {
      archivo, url, tipo: 'irrelevante', marca: '', modelos: [], tipo_equipo: '', idioma_original: '', traducido: false,
      emisor: 'desconocido', proveedor: '', formalidad: 'informal', legibilidad: 'nula', no_legible_detalle: detalle,
      duplicado_de: null, corresponde_licitacion: false, motivo_no_corresponde: 'No se pudo leer el archivo.', candidatos: [], largo_texto: 0,
    },
    noPudeLeer: [{ archivo, que: 'Todo el archivo', donde: detalle }],
  };
}

export async function inventariarFicha(
  archivo: string, url: string, texto: string | null, ctx: ContextoLinea,
): Promise<{ ficha: FichaInventariada; noPudeLeer: Array<{ archivo: string; que: string; donde: string }> }> {
  if (!texto || texto.trim().length < 30)
    return tarjetaIlegible(archivo, url, 'No se pudo extraer texto (formato no soportado, imagen o escaneo sin texto legible).');

  const user = `LÍNEA ${ctx.linea ?? '?'} de la licitación ${ctx.licitacionCodigo}: ${ctx.nombre}
REQUISITOS DE LA LÍNEA (para juzgar si el archivo corresponde y qué modelo del catálogo se ajusta):
${ctx.requisitos.slice(0, 40).map((r, i) => `${i + 1}. ${r}`).join('\n')}

ARCHIVO: "${archivo}"
TEXTO DEL ARCHIVO:
${texto.slice(0, TOPE_TEXTO_L1)}`;

  const parsed = await llamarJSON(SYS_L1, user, MOTOR_GLM);
  const inv = parsed?.inventario;
  if (!inv || typeof inv !== 'object') throw new Error(`La IA no devolvió el inventario de "${archivo}".`);
  const leg = s(inv.legibilidad).toLowerCase();
  const modelos = (Array.isArray(inv.modelos) ? inv.modelos : []).map((m: unknown) => s(m, 120)).filter(Boolean);
  const ficha: FichaInventariada = {
    archivo, url,
    tipo: s(inv.tipo, 40) || 'ficha_producto',
    marca: s(inv.marca, 120), modelos, tipo_equipo: s(inv.tipo_equipo, 160),
    idioma_original: s(inv.idioma_original, 40), traducido: !!inv.traducido,
    emisor: s(inv.emisor, 40) || 'desconocido', proveedor: s(inv.proveedor, 160),
    formalidad: s(inv.formalidad, 20) === 'informal' ? 'informal' : 'formal',
    legibilidad: leg === 'parcial' ? 'parcial' : leg === 'nula' ? 'nula' : 'completa',
    no_legible_detalle: s(inv.no_legible_detalle, 400),
    duplicado_de: null,
    corresponde_licitacion: inv.corresponde_licitacion !== false,
    motivo_no_corresponde: s(inv.motivo_no_corresponde, 300),
    candidatos: (Array.isArray(inv.candidatos) ? inv.candidatos : [])
      .map((c: any) => ({ modelo: s(c?.modelo, 120), razon: s(c?.razon, 240) })).filter((c: { modelo: string }) => c.modelo).slice(0, 6),
    largo_texto: texto.length,
  };
  const noPudeLeer = (Array.isArray(parsed.no_pude_leer) ? parsed.no_pude_leer : [])
    .map((x: any) => ({ archivo: s(x?.archivo, 200) || archivo, que: s(x?.que, 200), donde: s(x?.donde, 200) })).filter((x: { que: string }) => x.que);
  return { ficha, noPudeLeer };
}

// ─── L2 — comparación de los requisitos de UNA línea (un producto) ──────────────────────────────
export interface FichaParaComparar { archivo: string; modelo: string; emisor: string; formalidad: string; texto: string }
export interface EntradaL2 {
  licitacionCodigo: string; lineaNumero: number | null; lineaNombre: string;
  filas: FilaComparador[]; fichas: FichaParaComparar[]; foro: string | null;
}

function textoRequisito(f: FilaComparador): string {
  const u = f.unidad_requerida ? ` ${f.unidad_requerida}` : '';
  let exigido = '';
  if (f.valor_requerido_numero != null) {
    const pref = { PISO: 'mínimo ', TECHO: 'máximo ', EXACTO: 'exactamente ', RANGO: '' }[f.tipo as 'PISO'] ?? '';
    exigido = f.tipo === 'RANGO' && f.valor_requerido_numero_max != null
      ? `entre ${f.valor_requerido_numero} y ${f.valor_requerido_numero_max}${u}` : `${pref}${f.valor_requerido_numero}${u}`;
  }
  if (f.valor_requerido_texto) exigido = exigido ? `${exigido} · ${f.valor_requerido_texto}` : f.valor_requerido_texto;
  return `n=${f.id} · ${f.tipo} · ${f.criticidad} · ${f.descripcion}${exigido ? ` · exigido: ${exigido}` : ''} · fuente en bases: ${f.analisis.fuente_bases || 'Bases técnicas'}`;
}

/** Reparte el tope de texto entre las fichas para que ninguna se coma a las demás. */
export function textoEnviadoDeFichas(fichas: FichaParaComparar[]): string[] {
  const porFicha = Math.floor(TOPE_TEXTO_L2 / Math.max(1, fichas.length));
  return fichas.map(f => f.texto.slice(0, porFicha));
}

export async function compararRequisitos(entrada: EntradaL2, motor: MotorComparacion = MOTOR_KIMI_ESTRICTO): Promise<{
  items: Map<number, ItemCrudoIA>; noPudeLeer: Array<{ archivo: string; que: string; donde: string }>; textoEnviado: string;
}> {
  const textos = textoEnviadoDeFichas(entrada.fichas);
  const bloqueFichas = entrada.fichas.map((f, i) => `[FICHA ${i + 1}] archivo: "${f.archivo}" · modelo asignado: ${f.modelo || '(único de la ficha)'} · emisor: ${f.emisor} · ${f.formalidad}
${textos[i]}`).join('\n\n');

  const items = new Map<number, ItemCrudoIA>();
  const noPudeLeer: Array<{ archivo: string; que: string; donde: string }> = [];
  const lotes: FilaComparador[][] = [];
  for (let i = 0; i < entrada.filas.length; i += LOTE_L2) lotes.push(entrada.filas.slice(i, i + LOTE_L2));

  await Promise.all(lotes.map(async lote => {
    const user = `LICITACIÓN: ${entrada.licitacionCodigo}
LÍNEA ${entrada.lineaNumero ?? '?'}: ${entrada.lineaNombre}

REQUISITOS DE ESTA LÍNEA (heredados de la fase de análisis; el n es su identificador):
${lote.map(textoRequisito).join('\n')}

FORO (preguntas y respuestas publicadas — parte integrante de las bases):
${entrada.foro || '(sin foro disponible para esta licitación)'}

FICHAS ASIGNADAS A ESTA LÍNEA (confirmadas por una persona):
${bloqueFichas}`;
    const parsed = await llamarJSON(SYS_L2, user, motor);
    const matriz = Array.isArray(parsed?.matriz_tecnica) ? parsed.matriz_tecnica : [];
    const arr: any[] = matriz.flatMap((m: any) => (Array.isArray(m?.items) ? m.items : []));
    if (!arr.length) throw new Error('La IA no devolvió la matriz de comparación (respuesta vacía o ilegible).');
    for (const it of arr) {
      const n = Number(it?.n);
      if (Number.isFinite(n) && lote.some(f => f.id === n)) items.set(n, it as ItemCrudoIA);
    }
    for (const x of Array.isArray(parsed.no_pude_leer) ? parsed.no_pude_leer : [])
      if (x?.que) noPudeLeer.push({ archivo: s(x.archivo, 200), que: s(x.que, 200), donde: s(x.donde, 200) });
  }));

  return { items, noPudeLeer, textoEnviado: textos.join('\n') };
}

// ─── L3 — reverificación de rojos ───────────────────────────────────────────────────────────────
export async function reverificarRojos(
  filas: FilaComparador[], fichas: Array<{ archivo: string; texto: string }>, motor: MotorComparacion = MOTOR_KIMI_ESTRICTO,
): Promise<{ resultados: Map<number, ReverificacionCruda>; textoEnviado: string }> {
  const resultados = new Map<number, ReverificacionCruda>();
  if (!filas.length) return { resultados, textoEnviado: '' };
  const porFicha = Math.floor(TOPE_TEXTO_L2 / Math.max(1, fichas.length));
  const textos = fichas.map(f => f.texto.slice(0, porFicha));
  const user = `ÍTEMS A REVERIFICAR (criticidad INADMISIBLE, declarados CUMPLE en la primera pasada):
${filas.map(f => `n=${f.id} · ${f.tipo} · ${f.descripcion}${f.valor_requerido_texto ? ` · exigido: ${f.valor_requerido_texto}` : ''}${f.valor_requerido_numero != null ? ` · valor exigido: ${f.valor_requerido_numero}${f.unidad_requerida ? ` ${f.unidad_requerida}` : ''}` : ''} · ubicación citada: ${f.analisis.fuente_ficha || f.fundamento_cita || '(no citada)'}`).join('\n')}

FICHAS:
${fichas.map((f, i) => `[FICHA ${i + 1}] "${f.archivo}"\n${textos[i]}`).join('\n\n')}`;
  const parsed = await llamarJSON(SYS_L3, user, motor);
  const arr: any[] = Array.isArray(parsed?.reverificacion) ? parsed.reverificacion : [];
  if (!arr.length) throw new Error('La IA no devolvió la reverificación (respuesta vacía o ilegible).');
  for (const r of arr) {
    const n = Number(r?.n);
    if (Number.isFinite(n) && filas.some(f => f.id === n)) resultados.set(n, r as ReverificacionCruda);
  }
  return { resultados, textoEnviado: textos.join('\n') };
}
