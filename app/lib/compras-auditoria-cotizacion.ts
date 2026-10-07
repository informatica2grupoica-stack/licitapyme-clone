// app/lib/compras-auditoria-cotizacion.ts
// AUDITOR REAL DE COTIZACIONES — pedido explícito del usuario (21-sep-2026): "si subo una cotización
// y el producto que estoy subiendo no es el que corresponde debe ser capaz de decirme que no, y por
// qué; no solo ponerle 'pasa'". Hasta acá el `cumple` de cada cotización × producto lo elegía la
// persona (por defecto "Cumple") o lo adivinaba una IA que solo leía el texto libre: nadie comparaba
// la cotización contra lo que el producto DEBE cumplir, y ningún "pasa" traía su motivo.
//
// CÓMO DECIDE (dos capas, por diseño):
//   1. Reglas por CÓDIGO, sin IA: plazo del proveedor vs. reloj de entrega, compra a pérdida,
//      cotización vencida, RUT inválido, precio sin cargar. Son hechos, no opiniones.
//   2. Revisión por IA contra lo exigido (Auditor Técnico + línea de la licitación + Bases Técnicas):
//      ¿es el producto?, ¿cumple cada especificación?, garantía, cantidad, condiciones.
//
// REGLA DE ORO (el "por qué" nunca es opinión): la IA NO puede dar "cumple" sin una cita LITERAL
// de la cotización que lo respalde, y esa cita la verifica el CÓDIGO (substring-match contra el
// texto real del documento), no otra IA. Si el documento no dice nada sobre un requisito, el
// resultado es "no verificable" — nunca "cumple por omisión". Mismo criterio de citas verificadas
// que ya usa compras-agente-documentos.ts, y de "nunca inventar datos" del resto del módulo.
//
// NO EXCLUYE (spec §8.8.1): el dictamen se traduce al `cumple` de siempre (CUMPLE / INFERIOR_* /
// NO_ES_EL_PRODUCTO) para que cuadro comparativo y escenarios sigan funcionando igual; una
// cotización no verificable se ordena detrás de las verificadas, pero no se descarta.
//
// OVERRIDE: una persona puede decidir distinto al auditor, pero con motivo obligatorio y a su
// nombre — queda en el historial y en la pantalla, junto al dictamen original.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { listarProductosCompra, invalidarAprobacionesCompras, type ProductoCompra } from '@/app/lib/compras';
import { obtenerEstadoReloj } from '@/app/lib/compras-reloj';
import { filasDeCotizacion, programarAuditoria, cargarEstadoCosteo } from '@/app/lib/auditor-compras';
import { lineasDelCosteo } from '@/app/lib/auditor-compras-core';
import { compararPrecioConCosteo, textoComparacionPrecio } from '@/app/lib/compras-precio-vs-costeo';

export type CumpleAuditado = 'CUMPLE' | 'MEJORA' | 'INFERIOR_NEGOCIABLE' | 'INFERIOR_INSALVABLE' | 'NO_ES_EL_PRODUCTO';
// Nuevos (06-oct-2026): lo que audita Compras es el PRECIO contra lo costeado. Los cuatro primeros quedan solo
// para leer auditorías técnicas guardadas antes de este cambio.
export type Dictamen = 'PRECIO_MEJOR' | 'PRECIO_IGUAL' | 'PRECIO_PEOR' | 'SIN_COMPARAR' | 'APTA' | 'CON_OBSERVACIONES' | 'NO_APTA' | 'NO_ES_EL_PRODUCTO' | 'NO_VERIFICABLE';
export type ResultadoRevision = 'CUMPLE' | 'NO_CUMPLE' | 'NO_VERIFICABLE';
export type AreaRevision = 'producto' | 'especificacion' | 'garantia' | 'cantidad' | 'condiciones' | 'precio' | 'plazo' | 'vigencia' | 'proveedor' | 'documento';

export interface Revision {
  area: AreaRevision;
  criterio: string;
  requerido: string | null;
  cotizado: string | null;
  resultado: ResultadoRevision;
  gravedad: 'critico' | 'aviso' | 'info';
  explicacion: string;
  origen: 'codigo' | 'ia';
  // Evidencia: cita literal de la cotización y de lo exigido; `*Verificada` la calcula el código.
  citaCotizacion: string | null; citaCotizacionVerificada: boolean;
  citaRequisito: string | null; citaRequisitoVerificada: boolean;
}

export interface AuditoriaFila {
  cotizacionId: number; productoId: number; dictamen: Dictamen; resumen: string | null;
  revisiones: Revision[]; modelo: string | null; generadoAt: string; generadoPorNombre: string | null;
  cumpleAplicado: CumpleAuditado | null;
  override: { cumple: CumpleAuditado; motivo: string; porNombre: string | null; at: string } | null;
}

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/** Traduce el dictamen al `cumple` que ya consumen el cuadro comparativo y los escenarios. Una
 *  cotización NO VERIFICABLE cae en INFERIOR_NEGOCIABLE: no se excluye (§8.8.1) pero tampoco pasa
 *  por "cumple" sin evidencia — los escenarios prefieren siempre a las verificadas. */
export function cumpleDeDictamen(d: Dictamen): CumpleAuditado {
  switch (d) {
    case 'APTA': case 'PRECIO_MEJOR': case 'PRECIO_IGUAL': case 'PRECIO_PEOR': return 'CUMPLE';   // el precio no dice nada del cumplimiento técnico
    case 'CON_OBSERVACIONES': return 'INFERIOR_NEGOCIABLE';
    case 'NO_APTA': return 'INFERIOR_INSALVABLE';
    case 'NO_ES_EL_PRODUCTO': return 'NO_ES_EL_PRODUCTO';
    default: return 'INFERIOR_NEGOCIABLE';   // SIN_COMPARAR / NO_VERIFICABLE
  }
}

const TIER: Record<CumpleAuditado, number> = { CUMPLE: 0, MEJORA: 0, INFERIOR_NEGOCIABLE: 1, INFERIOR_INSALVABLE: 2, NO_ES_EL_PRODUCTO: 3 };

/** Dígito verificador del RUT chileno (módulo 11). */
export function rutValido(rut: string): boolean {
  const limpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1); const dv = limpio.slice(-1);
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado;
}

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

// ── Reglas por código ──────────────────────────────────────────────────────────────────────────
function revisionesPorCodigo(
  cot: any, producto: ProductoCompra, precioCosto: number | null,
  reloj: { fechaLimiteVigente: string | null; diasRestantes: number | null } | null,
): Revision[] {
  const out: Revision[] = [];
  const base = { origen: 'codigo' as const, citaCotizacion: null, citaCotizacionVerificada: false, citaRequisito: null, citaRequisitoVerificada: false };

  // Precio: sin precio no hay nada que comparar ni que comprar.
  if (precioCosto == null) {
    out.push({ ...base, area: 'precio', criterio: 'Precio unitario cargado', requerido: 'Un precio en pesos para este producto', cotizado: null,
      resultado: 'NO_VERIFICABLE', gravedad: 'critico',
      explicacion: 'Esta cotización no tiene un precio unitario en pesos asignado a este producto (o está en moneda extranjera sin tipo de cambio), así que no entra a las cuentas.' });
  } else if (producto.montoUnitario != null && producto.montoUnitario > 0) {
    const venta = producto.montoUnitario;
    if (precioCosto >= venta) {
      out.push({ ...base, area: 'precio', criterio: 'Costo vs. precio de venta al cliente', requerido: `Costo menor a ${fmtCLP(venta)} (lo que se le vendió al cliente)`, cotizado: fmtCLP(precioCosto),
        resultado: 'NO_CUMPLE', gravedad: 'critico',
        explicacion: `Comprar a ${fmtCLP(precioCosto)} c/u cuando se vendió a ${fmtCLP(venta)} c/u deja pérdida (asumiendo que el precio de la cotización es neto).` });
    } else {
      const margen = Math.round((1 - precioCosto / venta) * 1000) / 10;
      out.push({ ...base, area: 'precio', criterio: 'Costo vs. precio de venta al cliente', requerido: `Costo menor a ${fmtCLP(venta)}`, cotizado: fmtCLP(precioCosto),
        resultado: 'CUMPLE', gravedad: 'info', explicacion: `Margen bruto unitario de ${margen}% (asumiendo que el precio de la cotización es neto).` });
    }
  }

  // Vigencia.
  if (cot.vigencia_at) {
    const vig = String(cot.vigencia_at).slice(0, 10);
    const hoy = ahoraChileSQL().slice(0, 10);
    if (vig < hoy) {
      out.push({ ...base, area: 'vigencia', criterio: 'Cotización vigente', requerido: `Vigente a hoy (${hoy})`, cotizado: `Vigente hasta ${vig}`,
        resultado: 'NO_CUMPLE', gravedad: 'aviso', explicacion: 'La cotización ya venció: hay que pedirle al proveedor que la confirme o la renueve antes de comprar sobre ese precio.' });
    }
  }

  // Plazo del proveedor vs. lo que queda para entregarle al cliente.
  const texto = String(cot.plazo_entrega_texto || '');
  const dias = cot.plazo_entrega_dias != null ? Number(cot.plazo_entrega_dias) : null;
  if (dias != null && reloj?.diasRestantes != null) {
    // Si el proveedor habla de días hábiles, en corridos son ~1,4 veces más.
    const diasCorridos = /h[aá]bil/i.test(texto) ? Math.ceil(dias * 1.4) : dias;
    if (diasCorridos > reloj.diasRestantes) {
      out.push({ ...base, area: 'plazo', criterio: 'Plazo del proveedor vs. reloj de entrega', requerido: `Menos de ${reloj.diasRestantes} día(s) (hasta el ${reloj.fechaLimiteVigente})`, cotizado: texto || `${dias} días`,
        resultado: 'NO_CUMPLE', gravedad: 'critico',
        explicacion: `El proveedor tarda ~${diasCorridos} día(s) corridos y al cliente hay que entregarle en ${reloj.diasRestantes}: no alcanza.`, citaCotizacion: texto || null, citaCotizacionVerificada: true });
    } else {
      out.push({ ...base, area: 'plazo', criterio: 'Plazo del proveedor vs. reloj de entrega', requerido: `Menos de ${reloj.diasRestantes} día(s)`, cotizado: texto || `${dias} días`,
        resultado: 'CUMPLE', gravedad: 'info', explicacion: `~${diasCorridos} día(s) del proveedor caben en los ${reloj.diasRestantes} que quedan.`, citaCotizacion: texto || null, citaCotizacionVerificada: true });
    }
  } else if (dias == null && texto) {
    const inmediata = /inmediat|en stock|stock/i.test(texto);
    out.push({ ...base, area: 'plazo', criterio: 'Plazo del proveedor', requerido: reloj?.fechaLimiteVigente ? `Antes del ${reloj.fechaLimiteVigente}` : 'Un plazo verificable', cotizado: texto,
      resultado: inmediata ? 'CUMPLE' : 'NO_VERIFICABLE', gravedad: inmediata ? 'info' : 'aviso',
      explicacion: inmediata
        ? 'El proveedor declara entrega inmediata / en stock (ojo: suele venir "salvo venta previa"; confírmalo antes de comprar).'
        : 'El plazo está escrito sin un número de días, no se puede comparar con el reloj de entrega.',
      citaCotizacion: texto, citaCotizacionVerificada: true });
  }

  // RUT del proveedor.
  if (cot.proveedor_rut && !rutValido(String(cot.proveedor_rut))) {
    out.push({ ...base, area: 'proveedor', criterio: 'RUT del proveedor', requerido: 'RUT con dígito verificador correcto', cotizado: String(cot.proveedor_rut),
      resultado: 'NO_CUMPLE', gravedad: 'aviso', explicacion: 'El dígito verificador del RUT no calza: revisa que esté bien copiado (o que la cotización sea del proveedor correcto).' });
  }
  return out;
}

// ── Dictamen ───────────────────────────────────────────────────────────────────────────────────
export function dictamenDePrecio(veredicto: 'MEJOR' | 'IGUAL' | 'PEOR' | 'SIN_COMPARAR'): Dictamen {
  return veredicto === 'MEJOR' ? 'PRECIO_MEJOR' : veredicto === 'IGUAL' ? 'PRECIO_IGUAL' : veredicto === 'PEOR' ? 'PRECIO_PEOR' : 'SIN_COMPARAR';
}

/** Primero la frase del precio (lo que importa); después, solo lo que además falló por código (plazo, vigencia, pérdida…). */
function resumenDePrecio(frasePrecio: string, revs: Revision[]): string {
  const otros = revs.filter(r => r.area !== 'precio' || r.criterio !== 'Precio vs. lo costeado').filter(r => r.resultado === 'NO_CUMPLE').map(r => r.criterio);
  return [frasePrecio, otros.length ? `Ojo además: ${otros.slice(0, 4).join('; ')}.` : ''].filter(Boolean).join(' ').slice(0, 1200);
}

// ── Lo costeado de cada producto ───────────────────────────────────────────────────────────────────
/** LO COSTEADO = el costo estimado por el asistente al ofertar (no el "costo real" que Compras carga después). */
function costeadoDeProducto(lineasCosteo: ReturnType<typeof lineasDelCosteo>, producto: ProductoCompra): number | null {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  const linea = lineasCosteo.find(l => producto.correlativo != null && l.lineaReal === producto.correlativo && lineasCosteo.filter(y => y.lineaReal === producto.correlativo).length === 1)
    ?? lineasCosteo.find(l => norm(l.detalle) === norm(String(producto.descripcion)));
  return linea?.costoEstimadoNeto ?? linea?.costoRegistradoNeto ?? null;
}

/** Costo neto/u costeado de cada producto del negocio (para mostrarlo junto a las cotizaciones). */
export async function costeadoPorProducto(negocioId: number): Promise<Record<number, number | null>> {
  const [productos, estado] = await Promise.all([listarProductosCompra(negocioId), cargarEstadoCosteo(negocioId).catch(() => null)]);
  const lineas = estado ? lineasDelCosteo(estado).filter(l => !l.esGastoExtra) : [];
  const out: Record<number, number | null> = {};
  for (const p of productos) out[p.id] = costeadoDeProducto(lineas, p);
  return out;
}

// ── Orquestación ───────────────────────────────────────────────────────────────────────────────
export interface ResultadoAuditoria { productoId: number; dictamen: Dictamen; cumpleEfectivo: CumpleAuditado }

/** Audita UNA cotización contra cada producto al que está asignada (o solo `productoId`). Escribe
 *  compras_auditoria_cotizacion y deja `compras_cotizacion_item.cumple` = override de una persona si
 *  lo hay, si no el que resulta del dictamen. Si el veredicto EMPEORA respecto al que había, invalida
 *  las aprobaciones de compra (§10.5): quedaron sobre una cotización que no es lo que parecía. */
export async function auditarCotizacion(
  negocioId: number, cotizacionId: number,
  opts: { productoId?: number; actor?: { id: number; nombre: string | null } } = {},
): Promise<ResultadoAuditoria[]> {
  const [cotRows] = await pool.query(`SELECT * FROM compras_cotizacion WHERE id = ? AND negocio_id = ? LIMIT 1`, [cotizacionId, negocioId]) as any;
  const cot = (cotRows as any[])[0];
  if (!cot) throw new Error('Cotización no encontrada.');

  const [itemRows] = await pool.query(`SELECT producto_id, precio_unitario, precio_base, cumple FROM compras_cotizacion_item WHERE cotizacion_id = ?`, [cotizacionId]) as any;
  let items = itemRows as any[];
  if (opts.productoId != null) items = items.filter(i => i.producto_id === opts.productoId);
  if (items.length === 0) return []; // sin producto asignado no hay contra qué auditar

  const productos = await listarProductosCompra(negocioId);
  const licitacionCodigo = await licitacionDeNegocio(negocioId);
  const [reloj, estadoCosteo] = await Promise.all([obtenerEstadoReloj(negocioId).catch(() => null), cargarEstadoCosteo(negocioId).catch(() => null)]);
  const lineasCosteo = estadoCosteo ? lineasDelCosteo(estadoCosteo).filter(l => !l.esGastoExtra) : [];
  const resultados: ResultadoAuditoria[] = [];
  let empeoro = false;

  for (const it of items) {
    const producto = productos.find(p => p.id === it.producto_id);
    if (!producto) continue;
    const precioCosto = it.precio_unitario != null ? Number(it.precio_unitario) : null;
    const porCodigo = revisionesPorCodigo(cot, producto, precioCosto, reloj);

    const costeado = costeadoDeProducto(lineasCosteo, producto);
    const cmp = compararPrecioConCosteo(precioCosto, costeado);
    const extra = it.precio_base != null && precioCosto != null ? Math.round(precioCosto - Number(it.precio_base)) : 0;
    const frase = textoComparacionPrecio(cmp, precioCosto, costeado) + (extra > 0 ? ` Incluye ${fmtCLP(extra)} de adicionales (el producto solo cuesta ${fmtCLP(Number(it.precio_base))}).` : '');
    const base = { origen: 'codigo' as const, citaCotizacion: null, citaCotizacionVerificada: false, citaRequisito: null, citaRequisitoVerificada: false };
    const revisionPrecio: Revision = {
      ...base, area: 'precio', criterio: 'Precio vs. lo costeado',
      requerido: costeado != null ? `Hasta ${fmtCLP(costeado)} neto/u (lo costeado)` : 'Un costo en el costeo de esta línea', cotizado: precioCosto != null ? `${fmtCLP(precioCosto)} neto/u` : null,
      resultado: cmp.veredicto === 'SIN_COMPARAR' ? 'NO_VERIFICABLE' : cmp.veredicto === 'PEOR' ? 'NO_CUMPLE' : 'CUMPLE',
      gravedad: cmp.veredicto === 'PEOR' ? 'aviso' : 'info', explicacion: frase,
    };
    const revisiones: Revision[] = [revisionPrecio, ...porCodigo];
    const dictamen = dictamenDePrecio(cmp.veredicto);
    const resumen = resumenDePrecio(frase, revisiones);
    const mapeado = cumpleDeDictamen(dictamen);
    const modelo: string | null = null;

    const [prev] = await pool.query(`SELECT override_cumple FROM compras_auditoria_cotizacion WHERE cotizacion_id = ? AND producto_id = ? LIMIT 1`, [cotizacionId, producto.id]) as any;
    const override = ((prev as any[])[0]?.override_cumple as CumpleAuditado | null) ?? null;
    const efectivo = override ?? mapeado;
    const ahora = ahoraChileSQL();

    await pool.query(
      `INSERT INTO compras_auditoria_cotizacion
         (negocio_id, cotizacion_id, producto_id, dictamen, resumen, revisiones_json, modelo, generado_at, generado_por, generado_por_nombre, cumple_aplicado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE dictamen = VALUES(dictamen), resumen = VALUES(resumen), revisiones_json = VALUES(revisiones_json),
         modelo = VALUES(modelo), generado_at = VALUES(generado_at), generado_por = VALUES(generado_por),
         generado_por_nombre = VALUES(generado_por_nombre), cumple_aplicado = VALUES(cumple_aplicado)`,
      [negocioId, cotizacionId, producto.id, dictamen, resumen, JSON.stringify(revisiones), modelo, ahora, opts.actor?.id ?? null, opts.actor?.nombre ?? null, mapeado],
    );
    await pool.query(
      `UPDATE compras_cotizacion_item SET cumple = ?, detalle_desviacion = ? WHERE cotizacion_id = ? AND producto_id = ?`,
      [efectivo, resumen.slice(0, 900), cotizacionId, producto.id],
    );
    if (TIER[efectivo] > TIER[it.cumple as CumpleAuditado] ) empeoro = true;
    resultados.push({ productoId: producto.id, dictamen, cumpleEfectivo: efectivo });

    await registrarEvento({
      tipo: 'COMPRAS_COTIZACION_AUDITADA', licitacionCodigo, actorId: opts.actor?.id, actorNombre: opts.actor?.nombre,
      mensaje: `El auditor dictaminó la cotización de "${cot.proveedor_nombre}" para "${producto.descripcion}": ${dictamen.replace(/_/g, ' ')}.`,
      metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, producto_id: producto.id, dictamen, override: override ?? null },
    }).catch(() => {});
  }

  if (empeoro) await invalidarAprobacionesCompras(negocioId, 'El auditor de cotizaciones dio un veredicto más exigente sobre una cotización.').catch(() => {});
  return resultados;
}

/** Corre el auditor en segundo plano sin bloquear a quien llama (mismo patrón que la homologación). */
export function auditarCotizacionEnSegundoPlano(negocioId: number, cotizacionId: number, actor?: { id: number; nombre: string | null }): void {
  // Cada vez que se sube, edita, asigna u homologa una cotización, también se vuelve a auditar el COSTEO de las líneas afectadas
  // (Auditor de Compras, PROMPT 5): las cosas cambian y el resultado tiene que seguirlas.
  filasDeCotizacion(negocioId, cotizacionId).then(fs => fs.forEach(f => programarAuditoria(negocioId, f, actor ?? null))).catch(() => {});
  auditarCotizacion(negocioId, cotizacionId, { actor }).catch(e =>
    console.error(`[auditoria-cotizacion] falló en segundo plano (cotización ${cotizacionId}):`, String(e).slice(0, 200)));
}

export async function listarAuditoriasNegocio(negocioId: number): Promise<AuditoriaFila[]> {
  const [rows] = await pool.query(
    `SELECT cotizacion_id, producto_id, dictamen, resumen, revisiones_json, modelo, cumple_aplicado, generado_por_nombre,
            DATE_FORMAT(generado_at, '%Y-%m-%d %H:%i:%s') AS generado_at,
            override_cumple, override_motivo, override_por_nombre, DATE_FORMAT(override_at, '%Y-%m-%d %H:%i:%s') AS override_at
       FROM compras_auditoria_cotizacion WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => {
    let revisiones: Revision[] = [];
    try { revisiones = JSON.parse(r.revisiones_json || '[]'); } catch { /* fila corrupta: se muestra sin detalle */ }
    return {
      cotizacionId: r.cotizacion_id, productoId: r.producto_id, dictamen: r.dictamen, resumen: r.resumen, revisiones,
      modelo: r.modelo, generadoAt: r.generado_at, generadoPorNombre: r.generado_por_nombre, cumpleAplicado: r.cumple_aplicado,
      override: r.override_cumple ? { cumple: r.override_cumple, motivo: r.override_motivo || '', porNombre: r.override_por_nombre, at: r.override_at } : null,
    };
  });
}

/** Una persona decide distinto al auditor. El motivo es obligatorio (mínimo 15 caracteres) y queda a
 *  su nombre en el historial: "el auditor dijo X, [persona] lo cambió a Y porque…". `cumple = null`
 *  quita el override y vuelve al dictamen del auditor. */
export async function registrarOverrideAuditoria(
  negocioId: number, cotizacionId: number, productoId: number,
  cumple: CumpleAuditado | null, motivo: string, actor: { id: number; nombre: string | null },
): Promise<void> {
  const [rows] = await pool.query(
    `SELECT dictamen, cumple_aplicado FROM compras_auditoria_cotizacion WHERE cotizacion_id = ? AND producto_id = ? AND negocio_id = ? LIMIT 1`,
    [cotizacionId, productoId, negocioId],
  ) as any;
  const fila = (rows as any[])[0];
  if (!fila) throw new Error('Esta cotización todavía no fue auditada para este producto: audítala primero.');
  const licitacionCodigo = await licitacionDeNegocio(negocioId);
  const ahora = ahoraChileSQL();

  if (cumple == null) {
    await pool.query(`UPDATE compras_auditoria_cotizacion SET override_cumple = NULL, override_motivo = NULL, override_por = NULL, override_por_nombre = NULL, override_at = NULL WHERE cotizacion_id = ? AND producto_id = ?`, [cotizacionId, productoId]);
    await pool.query(`UPDATE compras_cotizacion_item SET cumple = ? WHERE cotizacion_id = ? AND producto_id = ?`, [fila.cumple_aplicado, cotizacionId, productoId]);
    await registrarEvento({ tipo: 'COMPRAS_AUDITORIA_OVERRIDE_QUITADO', licitacionCodigo, actorId: actor.id, actorNombre: actor.nombre,
      mensaje: `Se quitó la decisión manual sobre la cotización #${cotizacionId}: vuelve a valer el dictamen del auditor (${String(fila.dictamen).replace(/_/g, ' ')}).`,
      metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, producto_id: productoId } }).catch(() => {});
  } else {
    if (motivo.trim().length < 15) throw new Error('Explica el motivo (mínimo 15 caracteres): queda registrado a tu nombre.');
    await pool.query(
      `UPDATE compras_auditoria_cotizacion SET override_cumple = ?, override_motivo = ?, override_por = ?, override_por_nombre = ?, override_at = ? WHERE cotizacion_id = ? AND producto_id = ?`,
      [cumple, motivo.trim().slice(0, 2000), actor.id, actor.nombre, ahora, cotizacionId, productoId],
    );
    await pool.query(`UPDATE compras_cotizacion_item SET cumple = ? WHERE cotizacion_id = ? AND producto_id = ?`, [cumple, cotizacionId, productoId]);
    await registrarEvento({ tipo: 'COMPRAS_AUDITORIA_OVERRIDE', licitacionCodigo, actorId: actor.id, actorNombre: actor.nombre,
      mensaje: `${actor.nombre || 'Un usuario'} decidió "${cumple}" sobre la cotización #${cotizacionId} aunque el auditor dictaminó ${String(fila.dictamen).replace(/_/g, ' ')}. Motivo: ${motivo.trim()}`,
      metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, producto_id: productoId, dictamen: fila.dictamen, cumple, motivo: motivo.trim() } }).catch(() => {});
  }
  await invalidarAprobacionesCompras(negocioId, 'Se cambió por decisión manual el veredicto de una cotización.').catch(() => {});
}
