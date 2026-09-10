// app/lib/compras-reloj.ts
// RELOJ DE ENTREGA, MULTAS Y PRÓRROGAS (spec §15). "El plazo ofertado es perentorio, de vida o
// muerte. Nada lo suspende internamente" (§9.7) — este archivo nunca lo detiene, solo lo mide,
// avisa y deja registrada cualquier excepción (prórroga o entrega con multa) con su autorizador.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { sumarDiasHabiles, sumarDiasCorridos } from '@/app/lib/compras';
import { obtenerAsignacion } from '@/app/lib/compras';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';

export type PlazoTipo = 'HABILES' | 'CORRIDOS';
export type ColorReloj = 'VERDE' | 'AMARILLO' | 'ROJO' | 'VENCIDO';

function fechaDesdeYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function ymdDesdeFecha(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function hoyYMD(): string { return ahoraChileSQL().slice(0, 10); }

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export interface EstadoReloj {
  hitoInicio: string | null; fechaInicio: string | null; plazoDias: number | null; plazoTipo: PlazoTipo;
  fechaLimite: string | null; fijadoPorNombre: string | null; fijadoAt: string | null;
  prorroga: { fechaLimite: string | null; motivo: string | null; documentoUrl: string | null; autorizadoPorNombre: string | null; autorizadoAt: string | null } | null;
  entregaConMulta: { motivo: string | null; autorizadoPorNombre: string | null; autorizadoAt: string | null } | null;
  // Derivados — la fecha límite VIGENTE es la de la prórroga si existe, si no la original.
  fechaLimiteVigente: string | null; diasRestantes: number | null; color: ColorReloj | null;
  enVentanaProrroga: boolean; // §15.4: "pedirla entre 5 y 10 días antes del vencimiento"
}

export async function obtenerEstadoReloj(negocioId: number): Promise<EstadoReloj> {
  const [rows] = await pool.query(
    `SELECT hito_inicio, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio, plazo_dias, plazo_tipo,
            DATE_FORMAT(fecha_limite, '%Y-%m-%d') AS fecha_limite, fijado_por_nombre, DATE_FORMAT(fijado_at, '%Y-%m-%d %H:%i:%s') AS fijado_at,
            DATE_FORMAT(prorroga_fecha_limite, '%Y-%m-%d') AS prorroga_fecha_limite, prorroga_motivo, prorroga_documento_url,
            prorroga_autorizado_por_nombre, DATE_FORMAT(prorroga_autorizado_at, '%Y-%m-%d %H:%i:%s') AS prorroga_autorizado_at,
            entrega_con_multa, entrega_con_multa_motivo, entrega_con_multa_autorizado_por_nombre,
            DATE_FORMAT(entrega_con_multa_autorizado_at, '%Y-%m-%d %H:%i:%s') AS entrega_con_multa_autorizado_at
       FROM compras_reloj WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) {
    return { hitoInicio: null, fechaInicio: null, plazoDias: null, plazoTipo: 'CORRIDOS', fechaLimite: null,
      fijadoPorNombre: null, fijadoAt: null, prorroga: null, entregaConMulta: null,
      fechaLimiteVigente: null, diasRestantes: null, color: null, enVentanaProrroga: false };
  }
  const fechaLimiteVigente = r.prorroga_fecha_limite || r.fecha_limite || null;
  let diasRestantes: number | null = null; let color: ColorReloj | null = null; let enVentanaProrroga = false;
  if (fechaLimiteVigente) {
    const hoy = fechaDesdeYMD(hoyYMD());
    diasRestantes = Math.round((fechaDesdeYMD(fechaLimiteVigente).getTime() - hoy.getTime()) / 86_400_000);
    // §15.2 — "reloj visual con escalado de color: se pone rojo a medida que aumenta la urgencia."
    // La spec no fija los umbrales numéricos — se calibran acá: vencido siempre rojo/"VENCIDO",
    // ≤2 días rojo, ≤5 días amarillo, el resto verde.
    color = diasRestantes < 0 ? 'VENCIDO' : diasRestantes <= 2 ? 'ROJO' : diasRestantes <= 5 ? 'AMARILLO' : 'VERDE';
    enVentanaProrroga = diasRestantes >= 5 && diasRestantes <= 10;
  }
  return {
    hitoInicio: r.hito_inicio, fechaInicio: r.fecha_inicio, plazoDias: r.plazo_dias, plazoTipo: r.plazo_tipo,
    fechaLimite: r.fecha_limite, fijadoPorNombre: r.fijado_por_nombre, fijadoAt: r.fijado_at,
    prorroga: r.prorroga_fecha_limite ? {
      fechaLimite: r.prorroga_fecha_limite, motivo: r.prorroga_motivo, documentoUrl: r.prorroga_documento_url,
      autorizadoPorNombre: r.prorroga_autorizado_por_nombre, autorizadoAt: r.prorroga_autorizado_at,
    } : null,
    entregaConMulta: r.entrega_con_multa ? {
      motivo: r.entrega_con_multa_motivo, autorizadoPorNombre: r.entrega_con_multa_autorizado_por_nombre, autorizadoAt: r.entrega_con_multa_autorizado_at,
    } : null,
    fechaLimiteVigente, diasRestantes, color, enVentanaProrroga,
  };
}

/** §15.1 — "requiere validación manual antes de fijarse". Fijar el reloj es la validación: a partir
 *  de acá `fechaLimiteVigente` deja de ser un dato tentativo del resumen ejecutivo. */
export async function fijarReloj(
  negocioId: number, hitoInicio: string, fechaInicio: string, plazoDias: number, plazoTipo: PlazoTipo,
  actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!hitoInicio?.trim()) throw new Error('Falta el hito desde el cual corre el plazo.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) throw new Error('Fecha de inicio inválida.');
  if (!Number.isFinite(plazoDias) || plazoDias <= 0) throw new Error('Plazo inválido.');

  const inicio = fechaDesdeYMD(fechaInicio);
  const limite = plazoTipo === 'HABILES' ? sumarDiasHabiles(inicio, plazoDias) : sumarDiasCorridos(inicio, plazoDias);
  const fechaLimite = ymdDesdeFecha(limite);
  const ahora = ahoraChileSQL();

  await pool.query(
    `INSERT INTO compras_reloj (negocio_id, hito_inicio, fecha_inicio, plazo_dias, plazo_tipo, fecha_limite, fijado_por, fijado_por_nombre, fijado_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE hito_inicio=VALUES(hito_inicio), fecha_inicio=VALUES(fecha_inicio), plazo_dias=VALUES(plazo_dias),
       plazo_tipo=VALUES(plazo_tipo), fecha_limite=VALUES(fecha_limite), fijado_por=VALUES(fijado_por), fijado_por_nombre=VALUES(fijado_por_nombre),
       fijado_at=VALUES(fijado_at), updated_at=VALUES(updated_at)`,
    [negocioId, hitoInicio.trim(), fechaInicio, plazoDias, plazoTipo, fechaLimite, actorId, actorNombre, ahora, ahora, ahora],
  );
  await registrarEvento({
    tipo: 'COMPRAS_RELOJ_FIJADO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se fijó el reloj de entrega: vence ${fechaLimite} (${plazoDias} días ${plazoTipo === 'HABILES' ? 'hábiles' : 'corridos'} desde "${hitoInicio}").`,
    metadata: { negocio_id: negocioId, fecha_limite: fechaLimite },
  });

  // La tarea del catálogo "reloj_entrega" (§5.2: "Fijación y validación del reloj de entrega... §15.1")
  // es literalmente esta acción — pedirle al encargado que además la marque a mano a mano es
  // pedirle que anote el mismo hecho dos veces (mismo criterio que registrarOrdenCompraCliente,
  // que cierra 'aceptar_oc' sola). Sin esto, el Dashboard de Compras (§18) contaba esta tarea como
  // "vencida" aunque el reloj ya estuviera fijado — un cuello de botella falso.
  await pool.query(
    `UPDATE compras_tarea
        SET estado = 'HECHA', cerrado_at = ?, cerrado_por = ?, cerrado_por_nombre = ?,
            nota_cierre = COALESCE(nota_cierre, ?), primer_contacto_at = COALESCE(primer_contacto_at, ?)
      WHERE negocio_id = ? AND catalogo_clave = 'reloj_entrega' AND estado <> 'HECHA'`,
    [ahora, actorId, actorNombre, `Reloj fijado: vence ${fechaLimite}.`, ahora, negocioId],
  );
}

/** §15.4 — "la prórroga concedida se registra como nuevo plazo oficial con su documento de
 *  respaldo. La autoriza jefe de ventas o CA" (verificado en la API, no acá). */
export async function registrarProrroga(
  negocioId: number, nuevaFechaLimite: string, motivo: string, documentoUrl: string | null,
  actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaLimite)) throw new Error('Fecha de prórroga inválida.');
  if (!motivo?.trim()) throw new Error('Falta el motivo de la prórroga.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_reloj SET prorroga_fecha_limite = ?, prorroga_motivo = ?, prorroga_documento_url = ?,
        prorroga_autorizado_por = ?, prorroga_autorizado_por_nombre = ?, prorroga_autorizado_at = ?, updated_at = ?
      WHERE negocio_id = ?`,
    [nuevaFechaLimite, motivo.trim(), documentoUrl || null, actorId, actorNombre, ahora, ahora, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('El reloj todavía no está fijado — no hay nada que prorrogar.');
  await registrarEvento({
    tipo: 'COMPRAS_PRORROGA_REGISTRADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se registró una prórroga: nuevo plazo ${nuevaFechaLimite} — ${motivo.trim()}.`,
    metadata: { negocio_id: negocioId, nueva_fecha_limite: nuevaFechaLimite },
  });
}

/** §15.5/§15.7 — "no se entrega con multa. Excepcionalmente puede definirse hacerlo, por decisión
 *  expresa —nunca por silencio ni por atraso—, autorizada solo por jefe de ventas o CA." */
export async function autorizarEntregaConMulta(negocioId: number, motivo: string, actorId: number, actorNombre: string | null): Promise<void> {
  if (!motivo?.trim()) throw new Error('La entrega con multa requiere decisión expresa y motivo (spec §15.7) — nunca por silencio ni por atraso.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_reloj SET entrega_con_multa = 1, entrega_con_multa_motivo = ?, entrega_con_multa_autorizado_por = ?,
        entrega_con_multa_autorizado_por_nombre = ?, entrega_con_multa_autorizado_at = ?, updated_at = ?
      WHERE negocio_id = ?`,
    [motivo.trim(), actorId, actorNombre, ahora, ahora, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('El reloj todavía no está fijado.');
  await registrarEvento({
    tipo: 'COMPRAS_ENTREGA_CON_MULTA_AUTORIZADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se autorizó entregar con multa: ${motivo.trim()}. Anula la bonificación (spec §15.5).`,
    metadata: { negocio_id: negocioId },
  });
}

export interface EscenarioMulta { diasAtraso: number; costoEstimado: number | null; nota: string | null }

/** §15.6 — "el módulo no cursa la multa... sí calcula el costo esperado, a partir de la fórmula de
 *  cálculo de esas bases." La fórmula viene en texto libre (extraída por Viabilidad, distinta en
 *  cada licitación) — se necesita IA para aplicarla a escenarios concretos de días de atraso
 *  (Requisito de IA, §15.6: "el sistema debe poder comparar ese monto contra el costo de la
 *  alternativa"). Si la licitación no trae la fórmula estructurada, devuelve null (no se inventa). */
export async function calcularEscenariosMulta(negocioId: number, diasEscenarios: number[] = [5, 10, 15]): Promise<EscenarioMulta[] | null> {
  const asignacion = await obtenerAsignacion(negocioId);
  const multas = asignacion?.resumen?.multas as any;
  if (!multas || (!multas.costoPorDia && !multas.estructura)) return null;

  const montoAdjudicado = asignacion?.resumen?.montoNuestro ?? null;
  const prompt = `Fórmula de multa de esta licitación pública chilena (extraída de las bases):
- Fuente: ${multas.fuente || 'no especificada'}
- Estructura: ${multas.estructura || 'no especificada'}
- Costo por día: ${multas.costoPorDia || 'no especificado'}
- Costo máximo/tope: ${multas.costoMaximo || 'no especificado'}
- Umbral de término anticipado: ${multas.umbralTermino || 'no especificado'}
Monto adjudicado: ${montoAdjudicado != null ? `$${Math.round(montoAdjudicado).toLocaleString('es-CL')}` : 'no disponible'}

Para cada uno de estos escenarios de DÍAS DE ATRASO: ${diasEscenarios.join(', ')} — calcula el costo esperado de la multa en pesos chilenos, aplicando la fórmula tal como está descrita. Si el atraso supera el umbral de término anticipado, dilo en la nota. Si no hay datos suficientes para un escenario, deja costoEstimado en null y explica por qué en la nota.

Responde SOLO JSON: {"escenarios":[{"diasAtraso":<num>,"costoEstimado":<num o null>,"nota":"<texto breve>"}]}`;

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'user', content: prompt }], temperature: 0, stream: false, max_tokens: 1_500,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 45_000, modeloPreferido: 'glm-4.7', soloGlm: true });
    const parsed: any = parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
    const arr = Array.isArray(parsed.escenarios) ? parsed.escenarios : [];
    return diasEscenarios.map(dias => {
      const e = arr.find((x: any) => Number(x.diasAtraso) === dias);
      return { diasAtraso: dias, costoEstimado: e?.costoEstimado != null ? Number(e.costoEstimado) : null, nota: e?.nota || null };
    });
  } catch (e) {
    console.error('[compras-reloj] no se pudo calcular escenarios de multa:', String(e).slice(0, 200));
    return null;
  }
}
