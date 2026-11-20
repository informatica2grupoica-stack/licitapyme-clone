// EMPAREJAR A MANO — lógica PURA (sin BD) del panel «Emparejar a mano» de Compara y elige: para UN producto que no cuadra, lista las líneas de TODAS las
// cotizaciones del negocio, de la más probable a la menos, y a cada una le dice qué revisar (medida, presión, familia, cantidad, ya usada en otro producto)
// con las MISMAS reglas del pareo automático. Quien decide es la persona; esto solo evita que se equivoque sin darse cuenta.
import { lineasDelNegocio, conEquivalenciaNominal, choqueDeFamilia, type CotizacionPareo, type EquivalenciaFamilia, type LineaPareo } from '@/app/lib/compras-pareo-global-core';
import { conflictosMedibles, puntajeLineaProducto } from '@/app/lib/compras-cotizacion-emparejar';

export type Tono = 'ok' | 'dudoso' | 'malo';
export interface AvisoLinea { tono: Tono; texto: string }
export interface CotizacionParaEmparejar extends CotizacionPareo {
  archivoUrl?: string | null; archivoNombre?: string | null;
  /** lo que ya tiene asignado cada producto en esta cotización (precio base) */
  items: Array<{ productoId: number; precioBase?: number | null }>;
}
export interface ProductoParaMano { id: number; descripcion: string; cantidad?: number | string | null; unidad?: string | null }
export interface CandidataMano {
  cotizacionId: number; proveedor: string; codigo: string;
  descripcion: string; cantidad: number | null; unidad: string | null;
  /** precio unitario NETO en CLP (sin IVA, con descuento, × tipo de cambio) */
  precioNeto: number | null;
  puntaje: number;
  avisos: AvisoLinea[];
  /** el peor de los avisos */
  tono: Tono;
  /** si esta línea ya es la oferta guardada de ESTE producto en esa cotización */
  esActual: boolean;
  /** otro producto que ya usa esta línea en esa cotización */
  yaEnProducto: string | null;
  /** factor «rollo/caja» que dice el producto (R/100 → 100) para la ayuda de precio */
  envaseDelProducto: number | null;
}

const RANGO: Record<Tono, number> = { ok: 0, dudoso: 1, malo: 2 };
const cantidadDe = (v: unknown): number | null => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const fmt = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 });

/** «R/100», «unidades de 100 m», «(50 m)»: el envase que el propio producto declara; null si no dice ninguno (o dice varios). */
export function envaseDeclarado(descripcion: string): number | null {
  const n = new Set([...String(descripcion).matchAll(/\br\s*\/\s*(\d+)|(\d+)\s*m(?![a-z0-9²³])/gi)].map(m => Number(m[1] ?? m[2])).filter(x => x > 1));
  return n.size === 1 ? [...n][0] : null;
}

function avisosDe(p: ProductoParaMano, l: LineaPareo, equivalencias: EquivalenciaFamilia[]): AvisoLinea[] {
  const out: AvisoLinea[] = [];
  const conf = conflictosMedibles(conEquivalenciaNominal(p.descripcion), conEquivalenciaNominal(l.descripcion));
  for (const c of conf) {
    if (c.grave) out.push({ tono: 'malo', texto: `Otra medida: ${c.texto}` });
    else if (c.superior) out.push({ tono: 'ok', texto: `Trae más de lo pedido: ${c.texto.replace(/ \(más de lo pedido\)$/, '')}` });
    else out.push({ tono: 'dudoso', texto: c.clase === 'modelo' ? `Otro modelo: ${c.texto}` : `Revisa: ${c.texto}` });
  }
  const fam = choqueDeFamilia(p.descripcion, l.descripcion, equivalencias);
  if (fam) out.push({ tono: 'malo', texto: `Otra familia: ${fam}` });
  const pedida = cantidadDe(p.cantidad);
  if (l.cantidad != null && pedida != null) {
    if (l.cantidad + 1e-9 < pedida) out.push({ tono: 'dudoso', texto: `Cotiza ${fmt(l.cantidad)} y piden ${fmt(pedida)}` });
    else out.push({ tono: 'ok', texto: `Cubre las ${fmt(pedida)}` });
  }
  // El parser de medidas solo ve números con unidad («110 mm»); una línea «HDPE COPLA E.F.090» frente a un producto de 110 mm pasaba por buena.
  const nump = numerosDeTamano(p.descripcion), numl = numerosDeTamano(l.descripcion);
  const habla = nump.size > 0 && numl.size > 0;
  const otroTamano = habla && ![...nump].some(n => numl.has(n));
  if (otroTamano) out.push({ tono: 'dudoso', texto: `La línea habla de ${[...numl].join(' / ')} y piden ${[...nump].join(' / ')}` });
  if (!conf.length && !fam && !otroTamano) out.push({ tono: 'ok', texto: 'El texto no muestra diferencia de medida ni de familia (míralo en la cotización)' });
  return out;
}

/** Números de tamaño que dice un texto (110, 90, 063 → 63), sin presión PN ni PE/SDR y sin números chicos: sirve para ver si la línea habla de la MISMA medida
 *  aunque no escriba «mm». */
export function numerosDeTamano(texto: string): Set<number> {
  const limpio = String(texto).replace(/\bPN\s*-?\d+/gi, ' ').replace(/\b(?:PE|SDR)\s*-?\d+/gi, ' ');
  return new Set([...limpio.matchAll(/(?<!\d[.,])(?<!\d)(\d{2,4})(?!\d)(?![.,]\d)/g)].map(m => Number(m[1])).filter(n => n >= 20));
}

/** ¿La línea trae alguno de los números de tamaño del producto? Sube su lugar en la lista. */
const mismoTamanoQue = (p: string, l: string) => { const a = numerosDeTamano(p), b = numerosDeTamano(l); return a.size > 0 && [...a].some(n => b.has(n)); };

/** Líneas candidatas para un producto, de la más probable a la menos. Las que chocan en medida o familia van al final (no se esconden: a veces el equipo sabe más). */
export function candidatasParaProducto(p: ProductoParaMano, productos: ProductoParaMano[], cotizaciones: CotizacionParaEmparejar[], equivalencias: EquivalenciaFamilia[] = []): CandidataMano[] {
  const lineas = lineasDelNegocio(cotizaciones).filter(l => !l.esFlete && l.precioNeto != null && l.precioNeto > 0);
  const cot = new Map(cotizaciones.map(c => [c.id, c]));
  const nombre = (id: number) => productos.find(x => x.id === id)?.descripcion ?? null;
  const envase = envaseDeclarado(p.descripcion);
  const cerca = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
  const filas = lineas.map((l): CandidataMano => {
    const c = cot.get(l.cotizacionId)!;
    const avisos = avisosDe(p, l, equivalencias);
    const propio = c.items.find(i => i.productoId === p.id);
    const otro = c.items.find(i => i.productoId !== p.id && i.precioBase != null && cerca(i.precioBase, l.precioNeto!));
    if (otro) avisos.push({ tono: 'dudoso', texto: `Ya la usa «${(nombre(otro.productoId) ?? 'otro producto').slice(0, 48)}»` });
    const puntaje = puntajeLineaProducto(l.linea, { id: p.id, descripcion: p.descripcion, cantidad: cantidadDe(p.cantidad) }, undefined, { penalizar: false }).puntaje;
    const tono = avisos.reduce<Tono>((t, a) => (RANGO[a.tono] > RANGO[t] ? a.tono : t), 'ok');
    return {
      cotizacionId: l.cotizacionId, proveedor: l.proveedor, codigo: l.codigo, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad,
      precioNeto: l.precioNeto, puntaje, avisos, tono,
      esActual: propio?.precioBase != null && cerca(propio.precioBase, l.precioNeto!),
      yaEnProducto: otro ? nombre(otro.productoId) : null, envaseDelProducto: envase,
    };
  });
  // Primero las que no chocan (de más a menos parecidas, a igual parecido la más barata); al final las que chocan.
  const mismo = new Map(filas.map(f => [f, mismoTamanoQue(p.descripcion, f.descripcion)] as const));
  return filas.sort((a, b) => Number(a.tono === 'malo') - Number(b.tono === 'malo') || Number(mismo.get(b)) - Number(mismo.get(a)) || b.puntaje - a.puntaje || (a.precioNeto ?? Infinity) - (b.precioNeto ?? Infinity));
}

/** Qué quedaría al asignar: precio por unidad del producto, total, cobertura y diferencia contra lo costeado. */
export function resumenAsignacion(p: ProductoParaMano, precio: number, costeado: number | null) {
  const cant = cantidadDe(p.cantidad) ?? 1;
  const total = precio * cant;
  const difPct = costeado != null && costeado > 0 ? Math.round(((precio - costeado) / costeado) * 1000) / 10 : null;
  return { cantidad: cant, total, costeadoTotal: costeado != null ? costeado * cant : null, difPct };
}
