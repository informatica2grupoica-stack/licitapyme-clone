// app/lib/auditor-costo-ia.ts
// AUDITOR · VERIFICADOR DE COSTO con IA (Prompt 5 v2.0, llamada L1-C) — datos y llamada al modelo. Server-only.
// Corre POR OPCIÓN sobre el texto completo de sus respaldos de costo (cotización, link, informal…). El modelo aporta lo que las reglas de código no ven
// (costos ocultos V5, unidad/empaque V2, producto distinto V1, plazo V8) y la AYUDA de cinco campos; pasa por `evaluarCostoIA`, que exige cita literal y
// nunca le deja decidir un bloqueo. Cada corrida queda guardada (historial) en auditor_verificacion_costo, con `tipo_ia` para distinguirla de la búsqueda de mercado.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { extraccionPorId } from '@/app/lib/auditor-lector';
import { evaluarCostoIA, type ResultadoCostoIA, type SalidaCostoIA } from '@/app/lib/auditor-costo-ia-core';
import * as P from '@/app/lib/auditor-costo-v2-prompts';
import type { Alerta } from '@/app/lib/auditor-compras-core';

const TOPE_POR_DOC = 14_000, TOPE_TOTAL = 34_000;

const CONTRATO = `{
  "verificaciones": {
    "V1_identidad": { "estado": "OK | NO_COINCIDE | NO_VERIFICABLE", "marca_respaldo": "", "modelo_respaldo": "", "cita": "frase LITERAL del documento" },
    "V2_unidad": { "estado": "OK | ERROR | NO_DECLARADO", "detalle": "qué está mal (caja vs unidad, kit vs pieza, cantidad, mínimo de compra…)", "cita": "frase LITERAL" },
    "V5_costos_ocultos": [ { "tipo": "despacho | precio_desde | oferta_temporal | precio_tarjeta | volumen_minimo | accesorio | cargo_adicional", "detalle": "", "monto": "", "cita": "frase LITERAL" } ],
    "V8_plazo": { "plazo_proveedor": "", "tipo_dias": "habiles | corridos | no_declarado", "cita": "frase LITERAL" }
  },
  "ayuda": { "diagnostico": "", "causa_probable": "", "pregunta_proveedor": "", "accion_concreta": "", "datos_para_impacto": "" },
  "eventos": [ { "tipo": "producto_cambiado", "detalle": "" } ],
  "no_pude_leer": [ { "respaldo": "", "que": "", "donde": "" } ]
}`;

export function sistemaCostoIA(): string {
  return `${P.PARTE_I}

EN ESTA LLAMADA haces SOLO cuatro verificaciones: V1 (identidad), V2 (unidad y cantidad), V5 (costos ocultos) y V8 (plazo). El SISTEMA ya hizo por código V3 (IVA y moneda), V4 (precio y margen), V6, V7, V9, V10 y V11, y te entrega abajo lo que detectó: no lo repitas, complétalo. NO calcules ni decidas bloqueos ni veredicto.

VERIFICACIONES (PARTE IV del prompt):
${P.PARTE_IV}

SALIDA DE AYUDA (PARTE VII del prompt) — solo si el sistema dice que la opción NO quedó verificada; si quedó verificada deja "ayuda" con textos vacíos:
${P.PARTE_VII}

REGLAS DE ESTA IMPLEMENTACIÓN:
- Cada hallazgo lleva una "cita": una frase LITERAL copiada del documento (mínimo 2 palabras, tal cual está escrita). Si no puedes citarla textualmente, NO la reportes: el sistema descarta lo que no tiene cita verificable.
- En V5 reporta SOLO lo que el documento cobra aparte o condiciona (despacho no incluido, precio "desde", oferta con término, precio con tarjeta, mínimo de compra, accesorio obligatorio no cotizado, instalación/armado/seguro). No inventes.
- Si no hay nada que reportar en una verificación, devuélvela con estado "OK" o lista vacía.
- La "pregunta_proveedor" debe entenderse sola: nombra el producto (marca y modelo) y el dato. En español.

FORMATO DE SALIDA — responde SOLO con un objeto JSON válido con esta forma:
${CONTRATO}

AUTOCHEQUEO ANTES DE ENTREGAR (PARTE XII del prompt; lo que no aplique a esta llamada, ignóralo):
${P.PARTE_XII}`;
}

/** Texto completo de los respaldos de COSTO de la opción (las fichas técnicas no llevan precio: no cuentan aquí). */
async function respaldosDeCosto(opcionId: number): Promise<Array<{ etiqueta: string; tipo: string; nombre: string; texto: string }>> {
  const [rs] = await pool.query(
    `SELECT id, tipo, extraccion_id, documento_nombre, sostiene_costo FROM auditor_respaldo WHERE opcion_id = ? AND vigente = 1 AND tipo <> 'ficha_tecnica' AND extraccion_id IS NOT NULL ORDER BY sostiene_costo DESC, id DESC`, [opcionId]) as any;
  const out: Array<{ etiqueta: string; tipo: string; nombre: string; texto: string }> = [];
  const vistos = new Set<number>();
  for (const r of rs as any[]) {
    if (vistos.has(r.extraccion_id)) continue;
    vistos.add(r.extraccion_id);
    const ex = await extraccionPorId(r.extraccion_id);
    if (!ex?.data?.texto) continue;
    out.push({ etiqueta: `R${out.length + 1}`, tipo: r.tipo, nombre: r.documento_nombre || ex.documentoNombre || 'documento', texto: ex.data.texto });
  }
  return out;
}

export interface CorridaCostoIA { creadoAt: string; resultado: ResultadoCostoIA | null; error: string | null }

export async function verificarCostoIAOpcion(params: {
  negocioId: number; opcionId: number; actor: { id: number };
  linea: { detalle: string; unidad: string; cantidad: number | null; costeadoNeto: number | null };
  opcion: { marca: string | null; modelo: string | null; proveedor: string | null; veredicto: string };
  alertasCodigo: Alerta[]; bloqueosCodigo: Array<{ codigo: string; mensaje: string }>;
}): Promise<CorridaCostoIA> {
  const { negocioId, opcionId, actor, linea, opcion } = params;
  const ahora = ahoraChileSQL();
  const guardar = async (resultado: ResultadoCostoIA | null, error: string | null, salida?: SalidaCostoIA) => {
    await pool.query(`INSERT INTO auditor_verificacion_costo (negocio_id, opcion_id, resultado_json, error, creado_por, creado_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [negocioId, opcionId, JSON.stringify({ tipo_ia: true, resultado, salida: salida ?? null, error }), error, actor.id, ahora]);
    return { creadoAt: ahora, resultado, error } as CorridaCostoIA;
  };

  const docs = await respaldosDeCosto(opcionId);
  if (docs.length === 0) return guardar(null, 'La opción no tiene un respaldo de costo leído (cotización, link o documento): no hay nada que verificar.');
  const porDoc = Math.min(TOPE_POR_DOC, Math.floor(TOPE_TOTAL / docs.length));
  const bloque = docs.map(d => `[${d.etiqueta}] ${d.tipo.replace(/_/g, ' ')} · "${d.nombre}"\nTEXTO COMPLETO:\n${d.texto.slice(0, porDoc)}`).join('\n\n');
  const textoParaCitas = docs.map(d => d.texto.slice(0, porDoc)).join('\n');
  const yaDetectado = [...params.bloqueosCodigo.map(b => `BLOQUEA ${b.codigo}: ${b.mensaje}`), ...params.alertasCodigo.filter(a => a.nivel !== 'info').map(a => `ALERTA ${a.codigo}: ${a.mensaje}`)];
  const hayProblema = opcion.veredicto !== 'VERIFICADO';

  const user = `LÍNEA DE LA LICITACIÓN: ${linea.detalle} · unidad ${linea.unidad} · cantidad ${linea.cantidad ?? '?'} · costeado (neto por unidad): ${linea.costeadoNeto != null ? '$' + Math.round(linea.costeadoNeto).toLocaleString('es-CL') : 'sin costear'}
OPCIÓN: marca ${opcion.marca || '(sin identificar)'} · modelo ${opcion.modelo || '(sin identificar)'} · proveedor ${opcion.proveedor || '-'}
VEREDICTO QUE YA CALCULÓ EL SISTEMA: ${opcion.veredicto}${hayProblema ? ' (la opción NO quedó verificada: entrega la ayuda de cinco campos)' : ' (verificada: deja la ayuda vacía)'}
LO QUE EL SISTEMA YA DETECTÓ POR CÓDIGO (no lo repitas):
${yaDetectado.length ? yaDetectado.map(x => '- ' + x).join('\n') : '- (nada)'}

RESPALDOS DE COSTO DE LA OPCIÓN:
${bloque}`;

  let salida: SalidaCostoIA;
  try {
    let parsed: SalidaCostoIA | null = null;
    for (let intento = 1; intento <= 2 && !parsed; intento++) {
      const completion: any = await crearChatIA({
        messages: [{ role: 'system', content: sistemaCostoIA() }, { role: 'user', content: user }],
        temperature: 0, stream: false, max_tokens: 6_000, response_format: { type: 'json_object' },
      }, { timeoutMs: 180_000, modeloPreferido: 'glm-4.7', soloGlm: true });
      const p = parseJsonIA<SalidaCostoIA>(String(completion.choices?.[0]?.message?.content ?? ''));
      if (p && typeof p === 'object' && Object.keys(p).length > 0) parsed = p;
    }
    if (!parsed) throw new Error('el modelo no devolvió una respuesta interpretable');
    salida = parsed;
  } catch (e) {
    return guardar(null, `No se pudo consultar a la IA: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
  const resultado = evaluarCostoIA(salida, textoParaCitas, params.alertasCodigo, hayProblema);
  if (resultado.productoCambiado) {
    await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, 'producto_cambiado', 'verificador_costo', ?, ?)`,
      [negocioId, opcionId, `El respaldo de costo parece ser de ${[resultado.productoCambiado.marca, resultado.productoCambiado.modelo].filter(Boolean).join(' ')}`, ahora]).catch(() => { /* el evento es informativo */ });
  }
  return guardar(resultado, null, salida);
}

/** Última corrida de la IA de costo por opción (una consulta para todo el negocio). */
export async function ultimasCostoIA(negocioId: number): Promise<Map<number, CorridaCostoIA>> {
  const [rows] = await pool.query(`SELECT opcion_id, resultado_json, creado_at FROM auditor_verificacion_costo WHERE negocio_id = ? ORDER BY id`, [negocioId]) as any;
  const out = new Map<number, CorridaCostoIA>();
  for (const r of rows as any[]) {
    try {
      const j = JSON.parse(r.resultado_json);
      if (!j?.tipo_ia) continue;
      out.set(r.opcion_id, { creadoAt: r.creado_at instanceof Date ? r.creado_at.toISOString() : String(r.creado_at), resultado: j.resultado ?? null, error: j.error ?? null });
    } catch { /* fila ilegible */ }
  }
  return out;
}
