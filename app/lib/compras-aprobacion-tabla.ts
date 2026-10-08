// app/lib/compras-aprobacion-tabla.ts
// LO QUE SE APRUEBA, LÍNEA POR LÍNEA. Las dos compuertas (compra y margen) solo mostraban dos totales; el jefe de ventas aprobaba
// sin ver qué se compra, a quién, a qué precio frente a lo costeado, ni si la ficha técnica cumple. Esto junta, por cada producto
// que se ganó: lo que paga el cliente, lo que se costeó, lo que se va a comprar (escenario elegido), la ficha técnica de ese modelo y
// un veredicto con el motivo. Solo LEE: no modifica aprobaciones, escenarios ni fichas.
import pool from '@/app/lib/db';
import { listarProductosCompra } from '@/app/lib/compras';
import { costeadoPorProducto } from '@/app/lib/compras-auditoria-cotizacion';
import { obtenerEscenarioElegido, MARGEN_MINIMO_PCT } from '@/app/lib/compras-aprobaciones';
import { panelFichas, type PanelFichasDTO } from '@/app/lib/compras-fichas';

export type EstadoLinea = 'PASA' | 'REVISAR' | 'NO_PASA';
export type EstadoTecnico = 'CUMPLE' | 'NO_CUMPLE' | 'FALTA_DATO' | 'SIN_COMPARAR' | 'SIN_FICHA' | 'SIN_COMPRA';

export interface LineaAprobacion {
  productoId: number; linea: number | null; descripcion: string; cantidad: number | null;
  ventaUnit: number | null; ventaTotal: number | null;
  costeadoUnit: number | null; costeadoTotal: number | null;
  proveedor: string | null; compraUnit: number | null; compraTotal: number | null; plazoDias: number | null;
  difUnit: number | null; difPct: number | null; difTotal: number | null;
  margenLineaPct: number | null;
  tecnico: { estado: EstadoTecnico; cumple: number; total: number; modelo: string | null };
  estado: EstadoLinea; motivos: string[];
}

export interface Verificacion { ok: boolean | null; titulo: string; detalle: string }

export interface TablaAprobacion {
  lineas: LineaAprobacion[];
  totales: {
    venta: number; costeado: number; compra: number; flete: number; fleteSinConfirmar: boolean;
    /** Margen con lo que ya tiene proveedor; las líneas sin compra NO suman costo, por eso puede salir inflado. */
    margenConLoCotizadoPct: number | null;
    /** Margen completo: las líneas sin compra se toman al costo costeado (estimado). */
    margenCompletoPct: number | null;
    lineasSinCompra: number; lineasTotal: number;
  };
  verificaciones: Verificacion[];
  escenario: { tipo: string; costoTotal: number } | null;
}

const normP = (x: string | null | undefined) => (x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const pct = (n: number) => Math.round(n * 10) / 10;

function tecnicoDe(panel: PanelFichasDTO | null, productoId: number, proveedor: string | null): LineaAprobacion['tecnico'] {
  if (!proveedor) return { estado: 'SIN_COMPRA', cumple: 0, total: 0, modelo: null };
  const p = panel?.productos.find(x => x.productoId === productoId);
  const ops = (p?.opciones || []).filter(o => normP(o.proveedor) === normP(proveedor) && o.fichas.length > 0);
  if (ops.length === 0) return { estado: 'SIN_FICHA', cumple: 0, total: 0, modelo: null };
  const orden: Record<string, number> = { NO_CUMPLE: 0, CON_PENDIENTES: 1, NO_CORRIDO: 2, SIN_EVALUAR: 2, CUMPLE: 3 };
  const o = [...ops].sort((a, b) => (orden[a.tecnico.estado] ?? 2) - (orden[b.tecnico.estado] ?? 2))[0];
  const modelo = [o.marca, o.modelo].filter(Boolean).join(' ') || null;
  const base = { cumple: o.tecnico.resumen?.cumple ?? 0, total: o.tecnico.resumen?.total ?? 0, modelo };
  if (o.tecnico.estado === 'CUMPLE') return { estado: 'CUMPLE', ...base };
  if (o.tecnico.estado === 'NO_CUMPLE') return { estado: 'NO_CUMPLE', ...base };
  if (o.tecnico.estado === 'CON_PENDIENTES') return { estado: 'FALTA_DATO', ...base };
  return { estado: 'SIN_COMPARAR', ...base };
}

export async function tablaAprobacion(negocioId: number): Promise<TablaAprobacion> {
  const [[neg]] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  const [productos, costeado, escenario] = await Promise.all([
    listarProductosCompra(negocioId), costeadoPorProducto(negocioId).catch(() => ({} as Record<number, number | null>)), obtenerEscenarioElegido(negocioId),
  ]);
  const panel = await panelFichas(negocioId, neg?.licitacion_codigo ?? '').catch(() => null);

  let detalle: any = null;
  try { detalle = escenario ? (typeof escenario.detalle_json === 'string' ? JSON.parse(escenario.detalle_json) : escenario.detalle_json) : null; } catch { /* escenario ilegible: se trata como sin compra */ }
  const compraDe = new Map<number, any>((detalle?.porProducto || []).map((x: any) => [x.productoId, x]));

  const vigentes = productos.filter(p => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado));
  const lineas: LineaAprobacion[] = vigentes.map(p => {
    const c = compraDe.get(p.id);
    const cant = p.cantidad ?? null;
    const costUnit = costeado[p.id] ?? null;
    const compraUnit: number | null = c?.precioUnitario ?? null;
    const proveedor: string | null = compraUnit != null ? (c?.proveedor ?? null) : null;
    const compraTotal = compraUnit != null ? (c?.subtotal ?? (cant != null ? compraUnit * cant : null)) : null;
    const ventaTotal = p.montoUnitario != null && cant != null ? p.montoUnitario * cant : null;
    const difUnit = compraUnit != null && costUnit != null ? compraUnit - costUnit : null;
    const difPct = difUnit != null && costUnit ? pct((difUnit / costUnit) * 100) : null;
    const margenLineaPct = compraUnit != null && p.montoUnitario ? pct(((p.montoUnitario - compraUnit) / p.montoUnitario) * 100) : null;
    const tecnico = tecnicoDe(panel, p.id, proveedor);

    const motivos: string[] = [];
    let estado: EstadoLinea = 'PASA';
    const sube = (e: EstadoLinea) => { if (e === 'NO_PASA' || estado === 'PASA') estado = e; };
    if (compraUnit == null) { sube('NO_PASA'); motivos.push('Todavía no tiene proveedor elegido en el escenario de compra'); }
    if (tecnico.estado === 'NO_CUMPLE') { sube('NO_PASA'); motivos.push('La ficha técnica no cumple lo que piden las bases'); }
    if (compraUnit != null && p.montoUnitario != null && compraUnit >= p.montoUnitario) { sube('NO_PASA'); motivos.push('Se compra a un precio igual o mayor al que paga el cliente (pérdida)'); }
    if (difPct != null && difPct > 0) { sube('REVISAR'); motivos.push(`Cuesta ${difPct}% más que lo costeado`); }
    if (margenLineaPct != null && margenLineaPct < MARGEN_MINIMO_PCT && margenLineaPct > 0) { sube('REVISAR'); motivos.push(`Margen de la línea ${margenLineaPct}% (mínimo ${MARGEN_MINIMO_PCT}%)`); }
    if (tecnico.estado === 'FALTA_DATO') { sube('REVISAR'); motivos.push('Faltan datos técnicos en la ficha'); }
    if (tecnico.estado === 'SIN_COMPARAR') { sube('REVISAR'); motivos.push('La ficha está cargada pero no se comparó con las bases'); }
    if (tecnico.estado === 'SIN_FICHA') { sube('REVISAR'); motivos.push('Sin ficha técnica de este modelo: lo técnico no está verificado'); }

    return {
      productoId: p.id, linea: p.correlativo, descripcion: p.descripcion, cantidad: cant,
      ventaUnit: p.montoUnitario, ventaTotal,
      costeadoUnit: costUnit, costeadoTotal: costUnit != null && cant != null ? costUnit * cant : null,
      proveedor, compraUnit, compraTotal, plazoDias: c?.plazoEntregaDias ?? null,
      difUnit, difPct, difTotal: difUnit != null && cant != null ? difUnit * cant : null,
      margenLineaPct, tecnico, estado, motivos,
    };
  });

  const sum = (f: (l: LineaAprobacion) => number | null) => lineas.reduce((s, l) => s + (f(l) || 0), 0);
  const venta = sum(l => l.ventaTotal);
  const compra = sum(l => l.compraTotal);
  const costeadoTodo = sum(l => l.costeadoTotal);
  const costoTotalEsc = escenario ? Number(escenario.costo_total) : null;
  const flete = costoTotalEsc != null ? Math.max(0, costoTotalEsc - compra) : 0;
  const sinCompra = lineas.filter(l => l.compraUnit == null);
  const costoEstimadoFaltante = sinCompra.reduce((s, l) => s + (l.costeadoTotal || 0), 0);
  const margenCon = venta > 0 && escenario ? pct(((venta - (compra + flete)) / venta) * 100) : null;
  const margenCompleto = venta > 0 && escenario ? pct(((venta - (compra + flete + costoEstimadoFaltante)) / venta) * 100) : null;

  const noCumple = lineas.filter(l => l.tecnico.estado === 'NO_CUMPLE');
  const sinFicha = lineas.filter(l => l.compraUnit != null && ['SIN_FICHA', 'SIN_COMPARAR', 'FALTA_DATO'].includes(l.tecnico.estado));
  const masCaras = lineas.filter(l => (l.difPct ?? 0) > 0);
  const verificaciones: Verificacion[] = [
    { ok: escenario != null, titulo: 'Hay un escenario de compra elegido', detalle: escenario ? `Escenario ${escenario.tipo}` : 'Elige un escenario en «Costeo y auditoría» antes de proponer.' },
    { ok: sinCompra.length === 0, titulo: 'Todas las líneas tienen proveedor', detalle: sinCompra.length === 0 ? `${lineas.length} de ${lineas.length} con proveedor` : `Faltan ${sinCompra.length} de ${lineas.length}: ${sinCompra.map(l => l.descripcion.split(' - ')[0]).join(', ')}` },
    { ok: noCumple.length === 0, titulo: 'Ninguna ficha técnica incumple', detalle: noCumple.length === 0 ? 'Sin incumplimientos' : `No cumple: ${noCumple.map(l => l.descripcion.split(' - ')[0]).join(', ')}` },
    { ok: sinFicha.length === 0, titulo: 'Lo técnico está verificado en todas las compras', detalle: sinFicha.length === 0 ? 'Todas con ficha cumplida' : `${sinFicha.length} compra(s) sin verificar a fondo (sin ficha, sin comparar o con datos faltantes)` },
    { ok: masCaras.length === 0, titulo: 'Ninguna línea cuesta más de lo costeado', detalle: masCaras.length === 0 ? 'Todas iguales o más baratas' : `Más caras que lo costeado: ${masCaras.map(l => `${l.descripcion.split(' - ')[0]} (+${l.difPct}%)`).join(', ')}` },
    { ok: margenCompleto == null ? null : margenCompleto >= MARGEN_MINIMO_PCT, titulo: `Margen total sobre el ${MARGEN_MINIMO_PCT}%`, detalle: margenCompleto == null ? 'Sin datos para calcularlo' : `${margenCompleto}% considerando todas las líneas${sinCompra.length ? ' (las sin compra, al costo costeado)' : ''}` },
    { ok: escenario ? flete > 0 : null, titulo: 'Flete confirmado', detalle: flete > 0 ? 'El flete está incluido en el costo del escenario' : 'El flete está en $0: confirma si no hay flete o si todavía no se sabe' },
  ];

  return {
    lineas,
    totales: {
      venta, costeado: costeadoTodo, compra, flete, fleteSinConfirmar: flete === 0,
      margenConLoCotizadoPct: margenCon, margenCompletoPct: margenCompleto,
      lineasSinCompra: sinCompra.length, lineasTotal: lineas.length,
    },
    verificaciones,
    escenario: escenario ? { tipo: escenario.tipo, costoTotal: Number(escenario.costo_total) } : null,
  };
}
