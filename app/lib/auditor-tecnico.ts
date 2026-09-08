// app/lib/auditor-tecnico.ts
// AGENTE TÉCNICO del Auditor Técnico (Fase 1) — compara las especificaciones de las bases contra
// lo ofertado, línea por línea, con veredictos citables. Extiende checklist-comercial.ts (bloque
// TECNICO, tipo 'linea_tecnica'): este módulo solo clasifica/compara, no toca la máquina de
// estados del checklist (eso sigue centralizado en checklist-comercial.ts).
//
// DOS CAMINOS, ambos alimentan la misma tabla checklist_comercial_caracteristicas:
//   A) Interrogatorio: clasificarCaracteristicasLinea() separa el texto libre de bases en
//      PISO/TECHO/EXACTO/RANGO; el asistente responde cada una; evaluarCaracteristicaDeterminista()
//      resuelve por conversión de unidades sin IA, y solo si no puede cae a evaluarCaracteristicaConIA().
//   B) Ficha del proveedor: compararFichaProveedor() compara TODAS las características ya
//      clasificadas contra el texto de una ficha técnica, en una sola llamada.
//
// REGLA DE VERACIDAD (igual que buscar-equipamiento.ts): nunca declarar CUMPLE si el dato no
// está confirmado — ante duda, pendiente_confirmacion_proveedor=true y sin veredicto.
//
// Este módulo importa crearChatIA (gemini.ts → node:async_hooks, solo Node): NO importar desde
// Client Components. El código sin IA vive en auditor-tecnico-core.ts (seguro para el navegador)
// y se re-exporta aquí para no romper a los consumidores existentes de este archivo.
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { extraerProductoOfertado, type ProductoOfertado } from '@/app/lib/producto-ofertado';
import {
  normalizarConfianza,
  resumenLinea,
  type TipoRequisitoTecnico,
  type VeredictoTecnico,
  type LineaTecnica,
  type CaracteristicaClasificada,
  type VeredictoCaracteristica,
  type ResumenLinea,
  corregirTipoDeTolerancia,
} from '@/app/lib/auditor-tecnico-core';

export type {
  TipoRequisitoTecnico, VeredictoTecnico, OrigenCaracteristica, LineaTecnica,
  CaracteristicaClasificada, VeredictoCaracteristica, ResumenLinea,
} from '@/app/lib/auditor-tecnico-core';
export {
  lineasTecnicasDelInforme, productosCrudosDeLinea, evaluarCaracteristicaDeterminista, resumenLinea, slugCaracteristica,
} from '@/app/lib/auditor-tecnico-core';

// ─── Agente 1: clasificación de características (interrogatorio y ficha comparten esta base) ──
const SYS_AGENTE1 = `Eres un auditor técnico de licitaciones públicas chilenas. Te doy el nombre de una línea/producto y su lista de "características" tal cual aparecen en las bases técnicas (texto libre, mezclando exigencias verificables con condiciones administrativas).

TIPOS DE REQUISITO:
- PISO: un mínimo exigido (cumple si el valor ofertado es igual o mayor). Ej: "capacidad mínima 500 litros".
- TECHO: un máximo permitido (cumple si el valor ofertado es igual o menor). Ej: "peso máximo 500 kg", "nivel de ruido máximo 70 dB".
- EXACTO: un valor único admisible, sin margen. Ej: "voltaje 220V", "certificación ISO 9001".
- RANGO: el valor ofertado debe caer entre dos límites. Ej: "altura regulable entre 0.7 y 1.1 m".

REGLA DE PARTICIÓN: puedes DIVIDIR una característica que mezcle dos exigencias verificables por separado en dos filas (ej. "Ancho 1.2 m y altura regulable 0.7-1.1 m" → una fila EXACTO + una RANGO), pero NUNCA inventes una característica que no esté en el texto de entrada, ni fusiones dos características distintas en una sola. Clasifica cada característica de entrada exactamente una vez (o dos, si la dividiste).

Si el valor es numérico, extrae el número y su unidad tal como aparece en las bases (mm, cm, m, kg, litros, kw, etc.) en unidad_requerida. Si el requisito es categórico/no numérico (una certificación, un material, un documento), deja los campos numéricos en null y usa solo valor_requerido_texto.

confianza: un ENTERO entre 0 y 100 (nunca una fracción entre 0 y 1 — si tu confianza es "alta", escribe 95, no 0.95).

Devuelve SOLO JSON, sin markdown ni texto adicional:
{"caracteristicas":[{"descripcion":"","tipo":"PISO|TECHO|EXACTO|RANGO","valor_requerido_texto":"","valor_requerido_numero":null,"valor_requerido_numero_max":null,"unidad_requerida":"","fundamento_cita":"","confianza":0}]}`;

/** Agente 1 — clasifica las características libres de una línea. Modelo preferido: glm-5.2. */
export async function clasificarCaracteristicasLinea(
  linea: LineaTecnica,
  contexto: { licitacionCodigo: string },
): Promise<CaracteristicaClasificada[]> {
  if (!linea.caracteristicas.length) return [];
  const user = `LICITACIÓN: ${contexto.licitacionCodigo}
LÍNEA ${linea.linea}: ${linea.nombre}${linea.marcaModeloReferencia ? ` (referencia: ${linea.marcaModeloReferencia})` : ''}

CARACTERÍSTICAS SEGÚN LAS BASES (texto literal, una por línea):
${linea.caracteristicas.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS_AGENTE1 }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: 4_000,
    response_format: { type: 'json_object' },
  }, { timeoutMs: 90_000, modeloPreferido: 'glm-5.2' });

  const txt = String(completion.choices?.[0]?.message?.content ?? '');
  const parsed: any = parseJsonIA(txt) || {};
  const arr = Array.isArray(parsed.caracteristicas) ? parsed.caracteristicas : [];
  const out: CaracteristicaClasificada[] = [];
  for (const c of arr) {
    const n = normalizarClasificada(c);
    if (n) out.push(n);
  }
  return out;
}

function normalizarClasificada(c: any): CaracteristicaClasificada | null {
  const descripcion = String(c?.descripcion || '').trim();
  if (!descripcion) return null;
  const tipoRaw = String(c?.tipo || '').toUpperCase();
  const tipoIA: TipoRequisitoTecnico = (['PISO', 'TECHO', 'EXACTO', 'RANGO'].includes(tipoRaw) ? tipoRaw : 'EXACTO') as TipoRequisitoTecnico;
  // Guardarraíl determinista sobre lo que dijo la IA: una tolerancia ("Precisión: al menos ±2,5%")
  // es un TECHO, y clasificarla como PISO invierte el veredicto. Ver corregirTipoDeTolerancia.
  const tipo = corregirTipoDeTolerancia(
    descripcion, tipoIA, c?.valor_requerido_texto ? String(c.valor_requerido_texto) : null);
  return {
    descripcion: descripcion.slice(0, 500),
    tipo,
    valorRequeridoTexto: c?.valor_requerido_texto ? String(c.valor_requerido_texto).slice(0, 300) : null,
    // c?.valor_requerido_numero != null primero: Number(null) da 0, así que sin este chequeo un
    // requisito categórico (sin número) quedaba guardado como 0 en vez de null — ver la guardia en
    // evaluarCaracteristicaDeterminista().
    valorRequeridoNumero: c?.valor_requerido_numero != null && Number.isFinite(Number(c.valor_requerido_numero)) ? Number(c.valor_requerido_numero) : null,
    valorRequeridoNumeroMax: c?.valor_requerido_numero_max != null && Number.isFinite(Number(c.valor_requerido_numero_max)) ? Number(c.valor_requerido_numero_max) : null,
    unidadRequerida: c?.unidad_requerida ? String(c.unidad_requerida).slice(0, 40) : null,
    fundamentoCita: c?.fundamento_cita ? String(c.fundamento_cita).slice(0, 500) : null,
    confianza: normalizarConfianza(c?.confianza),
  };
}

// Tope de características por llamada del Agente 2. Ver el comentario dentro de la función:
// por sobre esto la salida JSON no cabe en max_tokens y se pierden veredictos en silencio.
const MAX_CARACT_POR_LLAMADA = 25;

// ─── Agente 2 (camino B): comparación contra ficha técnica del proveedor ────────────────────────
const SYS_AGENTE2 = `Eres un auditor técnico de licitaciones públicas chilenas. Te doy una lista de características técnicas YA clasificadas (con lo exigido) y el texto de una ficha técnica de un proveedor. Para CADA característica (identificada por su "id"), busca en la ficha el dato correspondiente y compara.

REGLA DURA (veracidad): NUNCA declares CUMPLE si el dato no aparece claramente en la ficha. Si la ficha no menciona esa característica o el dato es ambiguo, deja veredicto en null y marca pendiente_confirmacion_proveedor=true — es preferible pedir confirmación al proveedor que alucinar un cumplimiento.

Para cada id, extrae también el valor ofertado tal como aparece en la ficha (texto y, si es numérico, número + unidad original, exactamente como la escribió el fabricante).

confianza: un ENTERO entre 0 y 100 (nunca una fracción entre 0 y 1 — si tu confianza es "alta", escribe 95, no 0.95).

Devuelve SOLO JSON, sin markdown ni texto adicional:
{"veredictos":[{"id":0,"valor_ofertado_texto":"","valor_ofertado_numero":null,"unidad_ofertada_original":"","veredicto":"CUMPLE|NO_CUMPLE|CUMPLE_CON_COMPLEMENTO|null","pendiente_confirmacion_proveedor":false,"fundamento_cita":"","confianza":0}]}`;

// ─── Motor de IA de una llamada de comparación ──────────────────────────────────────────────────
// Parametriza compararFichaProveedor() para que la reuse también compararFichasMultiModelo() (más
// abajo, camino "100% IA" con Kimi K3) sin duplicar la llamada, el prompt ni el parseo — solo
// cambia QUÉ modelo de IA responde y cuánto presupuesto de tokens se le da.
interface MotorComparacion {
  proveedorPreferido?: string;   // 'kimi' → Moonshot K3 (ver PROVEEDORES_TEXTO en gemini.ts)
  modeloPreferido?: string;      // GLM específico dentro de la cuenta Z.AI (comportamiento de siempre)
  timeoutMs: number;
  maxTokens: number;
  loteMax: number;               // tope de características por llamada — ver la nota de abajo
}
const MOTOR_GLM: MotorComparacion = { modeloPreferido: 'glm-5.2', timeoutMs: 90_000, maxTokens: 6_000, loteMax: MAX_CARACT_POR_LLAMADA };
// Kimi K3 razona SIEMPRE — no se puede apagar, solo graduar (ver reasoningEffort en gemini.ts) — y
// ese razonamiento se cobra y ocupa el MISMO presupuesto de max_tokens que el JSON final. Sin más
// margen que GLM se repetiría el bug de "JSON cortado a la mitad" que ya obligó a lotear (ver
// MAX_CARACT_POR_LLAMADA): por eso maxTokens es casi 3x y el lote es más chico. timeoutMs más
// largo por la misma razón — pensar de más tarda más.
const MOTOR_KIMI: MotorComparacion = { proveedorPreferido: 'kimi', timeoutMs: 180_000, maxTokens: 16_000, loteMax: 15 };

/** Agente 2 (camino B) — dada la ficha técnica del proveedor (texto ya extraído), compara CADA
 *  característica ya clasificada y emite veredicto. Motor por defecto: GLM-5.2 (comportamiento de
 *  siempre). `opciones.motor` permite correr la MISMA comparación con Kimi K3 (ver MOTOR_KIMI) y
 *  `opciones.modeloObjetivo` acota la ficha a UN modelo cuando el documento describe varios (ver
 *  compararFichasMultiModelo) — con un solo modelo se omite y el comportamiento es idéntico al de
 *  siempre. */
export async function compararFichaProveedor(
  caracteristicas: Array<Pick<CaracteristicaClasificada, 'descripcion' | 'tipo' | 'valorRequeridoNumero' | 'valorRequeridoNumeroMax' | 'unidadRequerida' | 'valorRequeridoTexto'> & { id: number }>,
  fichaTexto: string,
  fichaNombre: string,
  opciones: { motor?: MotorComparacion; modeloObjetivo?: string | null } = {},
): Promise<Map<number, VeredictoCaracteristica>> {
  const { motor = MOTOR_GLM, modeloObjetivo = null } = opciones;
  const resultado = new Map<number, VeredictoCaracteristica>();
  if (!caracteristicas.length) return resultado;

  // POR LOTES (19-ago-2026): la respuesta trae un objeto por característica, con valor ofertado
  // (hasta 300 chars) y cita (hasta 500). Medido en 3489-29-LP26 hay líneas de 49 características
  // — a ~150 tokens cada una son ~7.400, por encima del max_tokens de 6.000: el JSON se cortaba y
  // las características del final se quedaban SIN veredicto para siempre. Falla en silencio,
  // porque quedar "sin evaluar" es exactamente lo que se ve cuando la ficha no dice nada.
  if (caracteristicas.length > motor.loteMax) {
    for (let i = 0; i < caracteristicas.length; i += motor.loteMax) {
      const lote = caracteristicas.slice(i, i + motor.loteMax);
      const parcial = await compararFichaProveedor(lote, fichaTexto, fichaNombre, opciones);
      for (const [k, v] of parcial) resultado.set(k, v);
    }
    return resultado;
  }

  const lista = caracteristicas.map(c =>
    `id=${c.id} · ${c.descripcion} (${c.tipo}${c.valorRequeridoTexto ? `, exigido: ${c.valorRequeridoTexto}` : ''}${c.unidadRequerida ? ` ${c.unidadRequerida}` : ''})`,
  ).join('\n');
  // modeloObjetivo (camino "100% IA" con varios modelos en la misma ficha, ej. un catálogo con
  // varios tractores): sin esto la IA puede mezclar datos de dos modelos distintos porque están en
  // el mismo texto. Con un solo modelo en la ficha se omite — no hay nada que desambiguar.
  const alcance = modeloObjetivo
    ? `ATENCIÓN: esta ficha técnica describe VARIOS modelos/equipos distintos. Evalúa ÚNICAMENTE los datos del modelo "${modeloObjetivo}" — ignora por completo los datos de cualquier otro modelo que aparezca en el mismo texto, aunque esté en la misma tabla o página.\n\n`
    : '';
  const user = `${alcance}CARACTERÍSTICAS A VERIFICAR:
${lista}

FICHA TÉCNICA DEL PROVEEDOR ("${fichaNombre}"):
${fichaTexto.slice(0, 40_000)}`;

  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS_AGENTE2 }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: motor.maxTokens,
    response_format: { type: 'json_object' },
  }, { timeoutMs: motor.timeoutMs, modeloPreferido: motor.modeloPreferido, proveedorPreferido: motor.proveedorPreferido });

  const txt = String(completion.choices?.[0]?.message?.content ?? '');
  const parsed: any = parseJsonIA(txt) || {};
  const arr = Array.isArray(parsed.veredictos) ? parsed.veredictos : [];
  for (const v of arr) {
    const id = Number(v?.id);
    if (!Number.isFinite(id)) continue;
    const veredictoRaw = String(v?.veredicto || '').toUpperCase();
    const veredictoValido = veredictoRaw === 'CUMPLE' || veredictoRaw === 'NO_CUMPLE' || veredictoRaw === 'CUMPLE_CON_COMPLEMENTO';
    resultado.set(id, {
      valorOfertadoTexto: v?.valor_ofertado_texto ? String(v.valor_ofertado_texto).slice(0, 300) : null,
      // Mismo cuidado que en normalizarClasificada(): v?.valor_ofertado_numero != null antes de
      // Number(), para no convertir "la ficha no trae número" en un 0 real.
      valorOfertadoNumero: v?.valor_ofertado_numero != null && Number.isFinite(Number(v.valor_ofertado_numero)) ? Number(v.valor_ofertado_numero) : null,
      unidadOfertadaOriginal: v?.unidad_ofertada_original ? String(v.unidad_ofertada_original).slice(0, 40) : null,
      valorConvertidoNumero: null,   // el caller la completa con evaluarCaracteristicaDeterminista si corresponde
      veredicto: veredictoValido ? (veredictoRaw as VeredictoTecnico) : null,
      pendienteConfirmacionProveedor: !!v?.pendiente_confirmacion_proveedor || !veredictoValido,
      fundamentoDocumento: fichaNombre.slice(0, 300),
      fundamentoCita: v?.fundamento_cita ? String(v.fundamento_cita).slice(0, 500) : null,
      confianza: normalizarConfianza(v?.confianza),
    });
  }
  return resultado;
}

// ─── Camino "100% IA" (Kimi K3): ficha con VARIOS modelos candidatos ────────────────────────────
//
// PEDIDO DEL USUARIO (07-sep-2026): la ficha técnica de un proveedor a veces no describe UN equipo,
// sino un CATÁLOGO — varios modelos de la misma familia en el mismo documento (folleto de línea
// completa, cotización con 3+ alternativas: "si en la ficha técnica tengo más de 3 tractores...").
// compararFichaProveedor() de arriba asume UN SOLO producto: con varios modelos mezclados en el
// mismo texto, la IA puede tomar datos de cualquiera de ellos indistintamente y el veredicto sale
// sin sentido (compara la exigencia contra un batido de specs de modelos distintos). Esta función
// identifica CADA modelo por separado y evalúa las características exigidas contra cada uno, para
// poder responder "el Modelo X es el único que cumple todo" con fundamento.
//
// DOS LLAMADAS, no una (mismo patrón Agente1/Agente2 del resto del archivo): identificar los
// modelos es una tarea corta y barata; comparar cada uno reusa compararFichaProveedor() con
// `modeloObjetivo` para acotar el texto — así cada llamada de comparación es tan fiable como la de
// siempre (mismo prompt, mismo parseo, mismo lote) y solo cambia el motor (Kimi K3, MOTOR_KIMI).
//
// PROMPT ROBUSTO: distingue "modelo distinto" de "el mismo modelo escrito distinto" (evita que un
// catálogo con "Tractor JD 5075E" y "JD5075E" cuente como dos), y exige fundamento_cita para poder
// auditar de dónde salió cada modelo — misma regla de veracidad que el resto del auditor.
const SYS_IDENTIFICAR_MODELOS = `Eres un auditor técnico de licitaciones públicas chilenas, experto en maquinaria y equipamiento industrial. Te doy el texto completo de una ficha técnica o catálogo de un proveedor, que puede describir UN SOLO equipo o VARIOS modelos distintos de la misma familia (ej. un catálogo con 3 tractores, 5 bombas, 4 generadores, distintas variantes de potencia/capacidad de la misma línea).

TU TAREA: identificar cada modelo/equipo DISTINTO que aparece como una opción concreta y verificable (con sus propias especificaciones técnicas propias), no menciones genéricas, accesorios ni opcionales.

REGLAS:
- Si la ficha describe UN SOLO equipo, devuelve un único modelo (no fuerces una lista de varios).
- NO inventes modelos que no estén en el texto.
- NO dupliques el mismo modelo con variantes de escritura (ej. "JD 5075E" y "JD5075E" son el MISMO modelo — unifícalos usando el nombre tal como aparece la primera vez).
- Dos modelos son DISTINTOS solo si tienen especificaciones técnicas propias y diferenciables (potencia, capacidad, dimensiones, código de modelo, etc.) — no cuentes como modelo aparte una simple mención de marca sin datos propios.
- "resumen_specs": 2-3 datos que lo distinguen de los OTROS modelos de esta misma ficha (ej. "180 HP, 4x4, cabina cerrada"), máximo 200 caracteres — solo para que una persona lo identifique de un vistazo, no repitas la ficha completa.
- "fundamento_cita": la frase o dato textual de la ficha que prueba que este modelo existe como opción propia (máximo 300 caracteres).

Devuelve SOLO JSON, sin markdown ni texto adicional:
{"modelos":[{"nombre_modelo":"","resumen_specs":"","fundamento_cita":""}]}`;

export interface ModeloCandidato {
  nombreModelo: string;
  resumenSpecs: string | null;
  fundamentoCita: string | null;
}

/** Identifica los modelos/equipos DISTINTOS descritos en una ficha (catálogo con varias opciones).
 *  Llamada corta y barata frente a la de comparación — por defecto corre en el motor pasado (Kimi
 *  K3, MOTOR_KIMI), pero acepta cualquier motor para poder probarla también en GLM si hiciera falta. */
export async function identificarModelosFicha(
  fichaTexto: string, fichaNombre: string, motor: MotorComparacion = MOTOR_KIMI,
): Promise<ModeloCandidato[]> {
  const user = `FICHA TÉCNICA ("${fichaNombre}"):
${fichaTexto.slice(0, 60_000)}`;

  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS_IDENTIFICAR_MODELOS }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: 2_000,
    response_format: { type: 'json_object' },
  }, { timeoutMs: motor.timeoutMs, modeloPreferido: motor.modeloPreferido, proveedorPreferido: motor.proveedorPreferido });

  const txt = String(completion.choices?.[0]?.message?.content ?? '');
  const parsed: any = parseJsonIA(txt) || {};
  const arr = Array.isArray(parsed.modelos) ? parsed.modelos : [];
  const out: ModeloCandidato[] = [];
  for (const m of arr) {
    const nombreModelo = String(m?.nombre_modelo || '').trim();
    if (!nombreModelo) continue;
    out.push({
      nombreModelo: nombreModelo.slice(0, 200),
      resumenSpecs: m?.resumen_specs ? String(m.resumen_specs).slice(0, 200) : null,
      fundamentoCita: m?.fundamento_cita ? String(m.fundamento_cita).slice(0, 300) : null,
    });
  }
  return out;
}

export interface ResultadoModeloComparado {
  nombreModelo: string;
  resumenSpecs: string | null;
  /** clave = id de la característica (mismo id que entra a compararFichasMultiModelo). */
  veredictos: Map<number, VeredictoCaracteristica>;
  resumen: ResumenLinea;
  /** true solo si TODAS las características dieron CUMPLE — ni un NO_CUMPLE, ni un pendiente, ni
   *  un CUMPLE_CON_COMPLEMENTO (ese es "cumple con condiciones", no cumplimiento pleno). */
  cumpleTodo: boolean;
  /** Marca/modelo/fabricante leídos (determinista, sin IA) DEL DOCUMENTO de este candidato
   *  específico — para que el caller pueda ofrecer "usar este modelo" y confirmar el producto
   *  ofertado con estos datos, en vez de dejar que la próxima ficha de OTRO ítem de un mismo
   *  paquete pise el producto con datos que no le corresponden (ver el bug real de 08-sep-2026:
   *  la ficha de los implementos TECNOMAQ sobrescribía la marca ya leída del tractor). */
  producto: ProductoOfertado;
}

export interface ResultadoComparacionMultiModelo {
  /** false si la ficha resultó describir UN solo modelo — `modelos` trae un único elemento y el
   *  resultado es equivalente a llamar compararFichaProveedor() directamente. */
  multiplesModelos: boolean;
  modelos: ResultadoModeloComparado[];
  /** Modelo(s) que cumplen el 100% de las características verificables. Vacío si NINGUNO cumple
   *  todo — en ese caso el caller debe mostrar el que más se acerca (mayor resumen.cumplen) y sus
   *  brechas, nunca elegir uno como si cumpliera cuando no cumple. */
  recomendados: string[];
}

export interface FichaEntrada { texto: string; nombre: string }

/**
 * Camino "100% IA" (Kimi K3, pedido del usuario 07-sep-2026): identifica y compara TODOS los
 * modelos/equipos candidatos que aparezcan en una o VARIAS fichas a la vez (ej. más de 3
 * tractores) — cada modelo por separado, para poder decir cuál cumple. Cubre los dos casos reales
 * sin que el caller tenga que distinguirlos:
 *   · UN documento que es un catálogo con varios modelos mezclados (identificarModelosFicha
 *     encuentra 2+ dentro de esa misma ficha → se escopa con `modeloObjetivo`).
 *   · VARIOS documentos, cada uno la ficha de UN solo modelo (pedido explícito del usuario,
 *     07-sep-2026: poder cargar/arrastrar varias fichas a la vez) — cada documento aporta sus
 *     propios candidatos, sin necesidad de escopar (el documento completo ES ese modelo).
 * Ambos casos se aplanan en una sola lista de candidatos antes de comparar, así que una mezcla de
 * los dos (2 catálogos con 2 modelos cada uno) también funciona sin código especial.
 *
 * La decisión final ("qué modelo cumple todo") es DETERMINISTA — la IA solo extrae y compara dato
 * por dato; contar quién cumplió todo es aritmética simple (resumenLinea), no una opinión de la
 * IA, siguiendo la misma regla de veracidad del resto del auditor: nunca declarar cumplimiento por
 * interpretación, solo por dato verificado.
 *
 * Con una sola ficha que resulta describir UN SOLO modelo, se comporta igual que
 * compararFichaProveedor() (un elemento en `modelos`, multiplesModelos=false).
 */
export async function compararFichasMultiModelo(
  caracteristicas: Array<Pick<CaracteristicaClasificada, 'descripcion' | 'tipo' | 'valorRequeridoNumero' | 'valorRequeridoNumeroMax' | 'unidadRequerida' | 'valorRequeridoTexto'> & { id: number }>,
  fichas: FichaEntrada[],
  motor: MotorComparacion = MOTOR_KIMI,
): Promise<ResultadoComparacionMultiModelo> {
  if (!fichas.length) return { multiplesModelos: false, modelos: [], recomendados: [] };

  // Identifica los modelos DE CADA documento por separado — un documento puede traer un solo
  // modelo (el caso normal cuando cada archivo es la ficha de UN equipo) o varios (un catálogo).
  const porFicha = await Promise.all(fichas.map(async (ficha) => ({
    ficha, identificados: await identificarModelosFicha(ficha.texto, ficha.nombre, motor),
  })));

  interface Candidato { nombreModelo: string; resumenSpecs: string | null; ficha: FichaEntrada; requiereAlcance: boolean }
  const candidatos: Candidato[] = [];
  for (const { ficha, identificados } of porFicha) {
    // Sin modelos identificables en ESTE documento (ficha rara, texto insuficiente) → se toma
    // como un solo modelo sin nombre propio (el nombre del archivo), igual que
    // compararFichaProveedor() de siempre — evita perder el documento entero por un fallo puntual
    // del Agente de identificación cuando la comparación en sí sí podría funcionar.
    const propios = identificados.length ? identificados : [{ nombreModelo: ficha.nombre, resumenSpecs: null, fundamentoCita: null }];
    // requiereAlcance: solo hace falta acotar con `modeloObjetivo` cuando ESTE documento trae
    // varios modelos mezclados en el mismo texto. Si el documento es dedicado a un solo modelo
    // (el caso normal de "una ficha por archivo"), acotar no aporta nada — el texto completo YA es
    // ese modelo — y evita una instrucción de más en el prompt.
    for (const m of propios) candidatos.push({ nombreModelo: m.nombreModelo, resumenSpecs: m.resumenSpecs, ficha, requiereAlcance: propios.length > 1 });
  }

  const multiplesModelos = candidatos.length > 1;

  const modelos: ResultadoModeloComparado[] = await Promise.all(candidatos.map(async (c) => {
    const veredictos = await compararFichaProveedor(
      caracteristicas, c.ficha.texto, c.ficha.nombre,
      { motor, modeloObjetivo: c.requiereAlcance ? c.nombreModelo : null },
    );
    const filas = caracteristicas.map(car => {
      const v = veredictos.get(car.id);
      return { veredicto: v?.veredicto ?? null, pendiente_confirmacion_proveedor: v?.pendienteConfirmacionProveedor ?? true };
    });
    const resumen = resumenLinea(filas);
    return {
      nombreModelo: c.nombreModelo, resumenSpecs: c.resumenSpecs, veredictos, resumen,
      cumpleTodo: resumen.total > 0 && resumen.cumplen === resumen.total,
      // Determinista, sin IA (mismo lector que usa "Subir ficha" normal) — leído DEL DOCUMENTO
      // propio de este candidato, nunca del texto de otro modelo mezclado en la misma llamada.
      producto: extraerProductoOfertado(c.ficha.texto, c.ficha.nombre),
    };
  }));

  return { multiplesModelos, modelos, recomendados: modelos.filter(m => m.cumpleTodo).map(m => m.nombreModelo) };
}

// ─── Camino "auditar de una" (pedido del usuario, 08-sep-2026): UN botón, N fichas, sin que la
// persona tenga que decidir de antemano si son PARTES del mismo equipo (camión + grúa + canastillo,
// cada parte en su propio documento) o MODELOS ALTERNATIVOS compitiendo por la misma línea (varios
// tractores). "Como un auditor real": evalúa cada ficha contra el pliego completo, y decide sola
// cuál de los dos casos es, según cómo se comportan las respuestas:
//   · Si lo que cada ficha responde NO SE PISA con lo que responden las demás (cada una cubre su
//     propia parte) → modo COMPLEMENTARIA: se unen todas las respuestas.
//   · Si varias fichas responden LA MISMA característica con datos distintos la mayoría de las
//     veces → modo COMPETENCIA: son alternativas completas, se rankea cada una y se recomienda la
//     que más cumple (o la única que cumple TODO).
// La decisión es aritmética (contar coincidencias/discrepancias), no una opinión de la IA — misma
// regla de veracidad del resto del archivo.
export interface RespuestaFicha { fichaNombre: string; valorTexto: string | null; veredicto: VeredictoTecnico | null }
export interface ConflictoCaracteristica { caracteristicaId: number; descripcion: string; respuestas: RespuestaFicha[] }
export interface CandidatoAuditoria { fichaNombre: string; resumen: ResumenLinea; cumpleTodo: boolean }
export interface ResultadoAuditoriaMultiple {
  modo: 'unica' | 'complementaria' | 'competencia';
  /** clave = id de la característica. Ya trae de qué ficha salió cada dato (`fichaNombre`). */
  veredictosFinales: Map<number, VeredictoCaracteristica & { fichaNombre: string }>;
  /** ids de características que NINGUNA ficha subida logró responder — hay que pedir otro documento. */
  faltantes: number[];
  /** Discrepancias puntuales entre fichas (aunque el modo general sea "complementaria") — nunca se
   *  ocultan, aunque no cambien la decisión de modo. */
  conflictos: ConflictoCaracteristica[];
  /** Solo cuando modo === 'competencia': un candidato por ficha, para poder decir cuál conviene. */
  candidatos?: CandidatoAuditoria[];
  /** Nombre de la ficha recomendada cuando hay competencia (ganador único, o el que más se acerca
   *  si ninguno cumple el 100% — nunca se elige uno como si cumpliera cuando no cumple). */
  recomendado?: string | null;
}

/** "Auditar con IA" — reemplaza tener que elegir a mano entre "Subir ficha" (una parte a la vez) y
 *  "Varios modelos" (alternativas compitiendo): acá se suben TODAS las fichas juntas y el sistema
 *  decide el modo. Motor por defecto GLM (no hace falta el razonamiento de Kimi para esto — cada
 *  ficha se compara contra el pliego completo con el mismo Agente 2 de siempre). */
export async function auditarFichasMultiples(
  caracteristicas: Array<Pick<CaracteristicaClasificada, 'descripcion' | 'tipo' | 'valorRequeridoNumero' | 'valorRequeridoNumeroMax' | 'unidadRequerida' | 'valorRequeridoTexto'> & { id: number }>,
  fichas: FichaEntrada[],
  motor: MotorComparacion = MOTOR_GLM,
): Promise<ResultadoAuditoriaMultiple> {
  if (!fichas.length) return { modo: 'unica', veredictosFinales: new Map(), faltantes: caracteristicas.map(c => c.id), conflictos: [] };

  const porFicha = await Promise.all(fichas.map(async ficha => ({
    ficha, veredictos: await compararFichaProveedor(caracteristicas, ficha.texto, ficha.nombre, { motor }),
  })));

  if (fichas.length === 1) {
    const { ficha, veredictos } = porFicha[0];
    const veredictosFinales = new Map(Array.from(veredictos.entries()).map(([id, v]) => [id, { ...v, fichaNombre: ficha.nombre }]));
    const faltantes = caracteristicas.filter(c => !veredictos.get(c.id)?.veredicto).map(c => c.id);
    return { modo: 'unica', veredictosFinales, faltantes, conflictos: [] };
  }

  // Por característica, quién respondió y qué dijo — la base para distinguir complementaria vs
  // competencia sin que nadie tenga que elegir el botón correcto de antemano.
  const respuestasPorCaract = new Map<number, Array<{ ficha: FichaEntrada; v: VeredictoCaracteristica }>>();
  for (const { ficha, veredictos } of porFicha) {
    for (const c of caracteristicas) {
      const v = veredictos.get(c.id);
      if (!v?.veredicto) continue;
      if (!respuestasPorCaract.has(c.id)) respuestasPorCaract.set(c.id, []);
      respuestasPorCaract.get(c.id)!.push({ ficha, v });
    }
  }

  let overlap = 0, conflictoCount = 0;
  const conflictos: ConflictoCaracteristica[] = [];
  for (const [id, respuestas] of respuestasPorCaract) {
    if (respuestas.length < 2) continue;
    overlap++;
    const primero = respuestas[0].v;
    const discrepan = respuestas.some(r =>
      r.v.veredicto !== primero.veredicto ||
      (r.v.valorOfertadoTexto && primero.valorOfertadoTexto && r.v.valorOfertadoTexto !== primero.valorOfertadoTexto));
    if (discrepan) {
      conflictoCount++;
      const c = caracteristicas.find(x => x.id === id)!;
      conflictos.push({
        caracteristicaId: id, descripcion: c.descripcion,
        respuestas: respuestas.map(r => ({ fichaNombre: r.ficha.nombre, valorTexto: r.v.valorOfertadoTexto, veredicto: r.v.veredicto })),
      });
    }
  }

  // Umbral: si la mayoría de lo que se solapa entre fichas discrepa, son alternativas completas
  // compitiendo por la línea. Si el solape es bajo o mayormente coincide (o no hay solape porque
  // cada ficha cubre su propia parte, como camión/grúa/canastillo), son documentos COMPLEMENTARIOS.
  const modo: 'complementaria' | 'competencia' = overlap > 0 && conflictoCount / overlap >= 0.5 ? 'competencia' : 'complementaria';

  if (modo === 'competencia') {
    const candidatos = porFicha.map(({ ficha, veredictos }) => {
      const filas = caracteristicas.map(c => {
        const v = veredictos.get(c.id);
        return { veredicto: v?.veredicto ?? null, pendiente_confirmacion_proveedor: v?.pendienteConfirmacionProveedor ?? true };
      });
      const resumen = resumenLinea(filas);
      return { ficha, veredictos, resumen, cumpleTodo: resumen.total > 0 && resumen.cumplen === resumen.total };
    });
    const ganadores = candidatos.filter(c => c.cumpleTodo);
    // Ganador sin ambigüedad si hay exactamente uno; si no, el de más aciertos (aritmética, no una
    // opinión de la IA) — pero solo se marca `recomendado` de verdad cuando cumple TODO.
    const elegido = ganadores.length === 1 ? ganadores[0] : candidatos.reduce((a, b) => (b.resumen.cumplen > a.resumen.cumplen ? b : a));
    const veredictosFinales = new Map(Array.from(elegido.veredictos.entries()).map(([id, v]) => [id, { ...v, fichaNombre: elegido.ficha.nombre }]));
    const faltantes = caracteristicas.filter(c => !elegido.veredictos.get(c.id)?.veredicto).map(c => c.id);
    return {
      modo, veredictosFinales, faltantes, conflictos,
      candidatos: candidatos.map(c => ({ fichaNombre: c.ficha.nombre, resumen: c.resumen, cumpleTodo: c.cumpleTodo })),
      recomendado: ganadores.length === 1 ? elegido.ficha.nombre : null,
    };
  }

  // Complementaria: unión de respuestas — cada característica la resuelve la PRIMERA ficha (en el
  // orden que se subieron) que trajo un dato para ella. Las discrepancias puntuales quedan en
  // `conflictos` para que una persona decida, pero nunca bloquean ni se ocultan.
  const veredictosFinales = new Map<number, VeredictoCaracteristica & { fichaNombre: string }>();
  for (const { ficha, veredictos } of porFicha) {
    for (const [id, v] of veredictos) {
      if (!v.veredicto || veredictosFinales.has(id)) continue;
      veredictosFinales.set(id, { ...v, fichaNombre: ficha.nombre });
    }
  }
  const faltantes = caracteristicas.filter(c => !veredictosFinales.get(c.id)?.veredicto).map(c => c.id);
  return { modo, veredictosFinales, faltantes, conflictos };
}

/** Camino A, paso 2 (fallback): UNA característica, modelo barato (cadena por defecto, sin
 *  modeloPreferido) — solo se llama cuando el paso determinista no pudo resolver. */
export async function evaluarCaracteristicaConIA(args: {
  descripcion: string; tipo: TipoRequisitoTecnico;
  valorRequeridoTexto: string | null; valorOfertadoTexto: string | null;
}): Promise<{ veredicto: VeredictoTecnico; confianza: number }> {
  const sys = `Eres un auditor técnico de licitaciones públicas chilenas. Te doy UNA característica técnica, lo exigido por las bases y lo que el asistente comercial declaró que se oferta. Compara y determina si CUMPLE, NO_CUMPLE, o CUMPLE_CON_COMPLEMENTO (cumple parcialmente y necesita un documento/compromiso adicional).
Responde SOLO JSON, sin markdown: {"veredicto":"CUMPLE|NO_CUMPLE|CUMPLE_CON_COMPLEMENTO","confianza":0-100} — confianza es un ENTERO entre 0 y 100, nunca una fracción entre 0 y 1.`;
  const user = `Característica: ${args.descripcion}
Tipo de requisito: ${args.tipo}
Exigido: ${args.valorRequeridoTexto || '(sin dato)'}
Ofertado: ${args.valorOfertadoTexto || '(sin dato)'}`;

  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: 300,
    response_format: { type: 'json_object' },
  }, { timeoutMs: 30_000 });

  const txt = String(completion.choices?.[0]?.message?.content ?? '');
  const parsed: any = parseJsonIA(txt) || {};
  const veredictoRaw = String(parsed?.veredicto || '').toUpperCase();
  const veredicto: VeredictoTecnico =
    veredictoRaw === 'CUMPLE' || veredictoRaw === 'NO_CUMPLE' || veredictoRaw === 'CUMPLE_CON_COMPLEMENTO'
      ? (veredictoRaw as VeredictoTecnico) : 'NO_CUMPLE';
  return { veredicto, confianza: normalizarConfianza(parsed?.confianza) };
}
