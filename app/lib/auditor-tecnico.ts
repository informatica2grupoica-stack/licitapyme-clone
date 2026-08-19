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
import {
  normalizarConfianza,
  type TipoRequisitoTecnico,
  type VeredictoTecnico,
  type LineaTecnica,
  type CaracteristicaClasificada,
  type VeredictoCaracteristica,
} from '@/app/lib/auditor-tecnico-core';

export type {
  TipoRequisitoTecnico, VeredictoTecnico, OrigenCaracteristica, LineaTecnica,
  CaracteristicaClasificada, VeredictoCaracteristica, ResumenLinea,
} from '@/app/lib/auditor-tecnico-core';
export {
  lineasTecnicasDelInforme, evaluarCaracteristicaDeterminista, resumenLinea, slugCaracteristica,
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
  const tipo: TipoRequisitoTecnico = (['PISO', 'TECHO', 'EXACTO', 'RANGO'].includes(tipoRaw) ? tipoRaw : 'EXACTO') as TipoRequisitoTecnico;
  return {
    descripcion: descripcion.slice(0, 500),
    tipo,
    valorRequeridoTexto: c?.valor_requerido_texto ? String(c.valor_requerido_texto).slice(0, 300) : null,
    valorRequeridoNumero: Number.isFinite(Number(c?.valor_requerido_numero)) ? Number(c.valor_requerido_numero) : null,
    valorRequeridoNumeroMax: Number.isFinite(Number(c?.valor_requerido_numero_max)) ? Number(c.valor_requerido_numero_max) : null,
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

/** Agente 2 (camino B) — dada la ficha técnica del proveedor (texto ya extraído), compara CADA
 *  característica ya clasificada y emite veredicto. Modelo preferido: glm-5.2. */
export async function compararFichaProveedor(
  caracteristicas: Array<Pick<CaracteristicaClasificada, 'descripcion' | 'tipo' | 'valorRequeridoNumero' | 'valorRequeridoNumeroMax' | 'unidadRequerida' | 'valorRequeridoTexto'> & { id: number }>,
  fichaTexto: string,
  fichaNombre: string,
): Promise<Map<number, VeredictoCaracteristica>> {
  const resultado = new Map<number, VeredictoCaracteristica>();
  if (!caracteristicas.length) return resultado;

  // POR LOTES (19-ago-2026): la respuesta trae un objeto por característica, con valor ofertado
  // (hasta 300 chars) y cita (hasta 500). Medido en 3489-29-LP26 hay líneas de 49 características
  // — a ~150 tokens cada una son ~7.400, por encima del max_tokens de 6.000: el JSON se cortaba y
  // las características del final se quedaban SIN veredicto para siempre. Falla en silencio,
  // porque quedar "sin evaluar" es exactamente lo que se ve cuando la ficha no dice nada.
  if (caracteristicas.length > MAX_CARACT_POR_LLAMADA) {
    for (let i = 0; i < caracteristicas.length; i += MAX_CARACT_POR_LLAMADA) {
      const lote = caracteristicas.slice(i, i + MAX_CARACT_POR_LLAMADA);
      const parcial = await compararFichaProveedor(lote, fichaTexto, fichaNombre);
      for (const [k, v] of parcial) resultado.set(k, v);
    }
    return resultado;
  }

  const lista = caracteristicas.map(c =>
    `id=${c.id} · ${c.descripcion} (${c.tipo}${c.valorRequeridoTexto ? `, exigido: ${c.valorRequeridoTexto}` : ''}${c.unidadRequerida ? ` ${c.unidadRequerida}` : ''})`,
  ).join('\n');
  const user = `CARACTERÍSTICAS A VERIFICAR:
${lista}

FICHA TÉCNICA DEL PROVEEDOR ("${fichaNombre}"):
${fichaTexto.slice(0, 40_000)}`;

  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS_AGENTE2 }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: 6_000,
    response_format: { type: 'json_object' },
  }, { timeoutMs: 90_000, modeloPreferido: 'glm-5.2' });

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
      valorOfertadoNumero: Number.isFinite(Number(v?.valor_ofertado_numero)) ? Number(v.valor_ofertado_numero) : null,
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
