// app/lib/auditor-posicion.ts
// AUDITOR · POSICIÓN DE PRECIO del proyecto (Prompt 5 v2.0 Parte IX). Ubica el costo verificado frente al precio de mercado público, el de mercado privado y
// el presupuesto del organismo, para que el precio de venta se fije con fundamento. TODO lo calcula el código (reutiliza `calcularPosicionPrecio` del Auditor de
// Compras, que es la misma regla); el modelo solo redacta la lectura en lenguaje simple (L3) y no recomienda un precio. Server-only.
// Fuente de cada nivel: costo = opción definitiva (o la más avanzada, marcada provisoria) + costos asociados estimados · mercado privado = mediana de las
// referencias del MISMO producto (V10) · mercado público = OC históricas (S5) · presupuesto = costeo / resumen ejecutivo. Guarda cada cálculo (historial).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { PARAMS, calcularPosicionPrecio, type PosicionPrecio, type LineaGuardada } from '@/app/lib/auditor-compras-core';
import { presupuestoNeto } from '@/app/lib/auditor-compras';
import { armarPanelAuditor, cargarEstadoCosteo, lineasAuditables, type OpcionDTO, type LineaAuditorDTO } from '@/app/lib/auditor-opciones';
import * as P from '@/app/lib/auditor-costo-v2-prompts';

export interface PosicionGuardadaDTO { id: number; creadoAt: string; posicion: PosicionPrecio; provisorias: number }

const ORDEN_ESTADO: Record<string, number> = { aprobada: 6, en_aprobacion: 5, definitiva: 4, verificada: 3, formalizada: 2, tanteo: 1 };

/** La opción cuyo costo representa a la línea: la firmada; si no hay, la más avanzada con costo (y a igual estado, la más barata) — marcada provisoria. */
export function opcionRepresentante(l: Pick<LineaAuditorDTO, 'opciones'>): { opcion: OpcionDTO; provisoria: boolean } | null {
  const conCosto = l.opciones.filter(o => o.estado !== 'descartada' && o.verificacion?.costoNetoUnitario != null);
  if (conCosto.length === 0) return null;
  const firmada = conCosto.find(o => ['definitiva', 'en_aprobacion', 'aprobada'].includes(o.estado));
  if (firmada) return { opcion: firmada, provisoria: false };
  const orden = [...conCosto].sort((a, b) => (ORDEN_ESTADO[b.estado] - ORDEN_ESTADO[a.estado]) || ((a.verificacion!.costoNetoUnitario as number) - (b.verificacion!.costoNetoUnitario as number)));
  return { opcion: orden[0], provisoria: true };
}

/** Puro: arma lo que `calcularPosicionPrecio` espera a partir del panel del Auditor. */
export function auditadasDesdePanel(lineas: LineaAuditorDTO[]): { auditadas: Record<string, LineaGuardada>; provisorias: number } {
  const auditadas: Record<string, LineaGuardada> = {};
  let provisorias = 0;
  for (const l of lineas) {
    if (l.noOfertada) continue;
    const rep = opcionRepresentante(l);
    if (!rep) continue;
    if (rep.provisoria) provisorias++;
    const m = rep.opcion.mercado;
    auditadas[l.filaId] = {
      sistema: {
        verificadoNeto: rep.opcion.verificacion!.costoNetoUnitario,
        refMediana: m?.medianaReferencias ?? null,
        // calcularPosicionPrecio solo cuenta cuántas referencias hay (origen 'auditor' con costo puesto en bodega).
        comparador: (m?.referencias || []).map(r => ({ origen: 'auditor', costo_bodega: r.precioNeto })),
        precioMercadoPublico: m?.mercadoPublico ?? null,
      },
    } as unknown as LineaGuardada;
  }
  return { auditadas, provisorias };
}

export async function calcularPosicionAuditor(negocioId: number, licitacionCodigo: string): Promise<{ posicion: PosicionPrecio; provisorias: number } | null> {
  const [panel, estado] = await Promise.all([armarPanelAuditor(negocioId, licitacionCodigo), cargarEstadoCosteo(negocioId)]);
  if (!estado) return null;
  const noOfertadas = new Set(panel.lineas.filter(l => l.noOfertada).map(l => l.filaId));
  const lineas = lineasAuditables(estado).filter(l => !noOfertadas.has(l.id));
  const { auditadas, provisorias } = auditadasDesdePanel(panel.lineas);
  const pres = await presupuestoNeto(negocioId, estado);
  return { posicion: calcularPosicionPrecio(lineas, auditadas, pres, panel.totalCostosAsociados), provisorias };
}

async function redactarLectura(posicion: PosicionPrecio, provisorias: number): Promise<string> {
  const { lectura: _l, ...datos } = posicion; void _l;
  const sys = `${P.PARTE_I}\n\n${P.PARTE_IX}\n\nTu tarea ahora es SOLO la lectura L3: redacta en lenguaje simple (máximo 8 líneas) la lectura de este resumen ya calculado por el sistema. Declara la solidez de cada nivel (cuántos datos, de qué fechas, si es el mismo producto o comparable), marca los comparables como "dato débil", no calcules ni recomiendes un precio exacto. Responde SOLO JSON: {"lectura":"..."}`;
  const user = `RESUMEN CALCULADO POR EL SISTEMA (JSON):\n${JSON.stringify(datos)}\nParámetros: margen mínimo ${PARAMS.margenMinimo}%, mínimo de OC para dato sólido ${PARAMS.minDatosMercadoPublico}.
OJO: costo_verificado.lineas_pendientes es la cantidad de líneas cuyo costo NO está verificado; el monto usa el costo costeado para esas líneas. Si hay pendientes, di que el costo NO está verificado del todo (no digas que lo está).
${provisorias > 0 ? `${provisorias} línea(s) todavía no tienen opción firmada: su costo es el de la opción más avanzada (PROVISORIO). Dilo.` : 'Todas las líneas tienen opción firmada.'}
Los costos asociados (compromisos de las bases) ya están sumados al costo.`;
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    temperature: 0, stream: false, max_tokens: 2_500, response_format: { type: 'json_object' },
  }, { timeoutMs: 120_000, modeloPreferido: 'glm-4.7', soloGlm: true });
  const out = parseJsonIA<{ lectura?: string }>(String(completion.choices?.[0]?.message?.content ?? '')) || {};
  return String(out.lectura || '').trim().slice(0, 2_000);
}

/** Calcula, redacta la lectura y GUARDA (una fila por cálculo). Si la IA falla, igual queda el cálculo (la lectura es solo ayuda). */
export async function generarPosicionAuditor(negocioId: number, licitacionCodigo: string, actor: { id: number }): Promise<PosicionGuardadaDTO> {
  const r = await calcularPosicionAuditor(negocioId, licitacionCodigo);
  if (!r) throw new Error('Este negocio todavía no tiene un Costeo guardado: la posición de precio se calcula sobre sus líneas.');
  let lectura = '';
  try { lectura = await redactarLectura(r.posicion, r.provisorias); } catch (e) { console.warn('[auditor-posicion] lectura L3 falló:', String(e).slice(0, 160)); }
  r.posicion.lectura = lectura;
  const ahora = ahoraChileSQL();
  const [ins] = await pool.query(
    `INSERT INTO auditor_posicion_precio (negocio_id, resultado_json, lectura, creado_por, creado_at) VALUES (?, ?, ?, ?, ?)`,
    [negocioId, JSON.stringify({ posicion: r.posicion, provisorias: r.provisorias }), lectura || null, actor.id, ahora]) as any;
  return { id: ins.insertId, creadoAt: ahora, posicion: r.posicion, provisorias: r.provisorias };
}

export async function ultimaPosicion(negocioId: number): Promise<PosicionGuardadaDTO | null> {
  const [rows] = await pool.query(`SELECT id, resultado_json, creado_at FROM auditor_posicion_precio WHERE negocio_id = ? ORDER BY id DESC LIMIT 1`, [negocioId]) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  try {
    const j = JSON.parse(r.resultado_json);
    return { id: r.id, creadoAt: r.creado_at instanceof Date ? r.creado_at.toISOString() : String(r.creado_at), posicion: j.posicion, provisorias: Number(j.provisorias) || 0 };
  } catch { return null; }
}
