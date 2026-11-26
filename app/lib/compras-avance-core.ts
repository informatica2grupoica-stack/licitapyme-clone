// app/lib/compras-avance-core.ts
// AVANCE DE LA LICITACIÓN EN COMPRAS — decisión PURA (sin red ni BD) para poder probarla.
// Las dos personas que trabajan una licitación tienen que ver, sin preguntarse, qué se hizo por producto, quién lo hizo y qué falta.
// La ruta /api/compras/[negocioId]/avance junta los datos con SQL liviano y esto los convierte en pasos hechos / por hacer.

export type ClavePaso = 'cotizar' | 'elegir' | 'aprobar' | 'sku' | 'oc';
export type EstadoPaso = 'hecho' | 'parcial' | 'falta' | 'rechazado';

export interface QuienCuando { por: string | null; at: string | null }

export interface DatosProductoAvance {
  id: number; correlativo: number | null; descripcion: string; subestado: string;
  cotizaciones: { n: number } & QuienCuando;
  /** Proveedor elegido para este producto en la compra elegida (null = sin elegir). */
  eleccion: ({ proveedor: string } & QuienCuando) | null;
  /** Aprobación de la línea por el jefe de ventas (null = sin resolver). */
  linea: ({ estado: 'APROBADA' | 'RECHAZADA' } & QuienCuando) | null;
  sku: ({ codigo: string } & QuienCuando) | null;
  /** OC emitida (nuestra, en Licitank) que lleva este producto. */
  oc: ({ numero: string | null } & QuienCuando) | null;
}

export interface DatosGlobalesAvance {
  compra: ({ estado: string } & QuienCuando) | null;
  margen: ({ estado: string } & QuienCuando) | null;
}

export interface PasoAvance { clave: ClavePaso; titulo: string; estado: EstadoPaso; texto: string; por: string | null; at: string | null }
export interface ItemAvance { id: number; correlativo: number | null; descripcion: string; pasos: PasoAvance[]; falta: string | null; completo: boolean }
export interface PasoGlobal { clave: 'compra' | 'margen'; titulo: string; estado: EstadoPaso; texto: string; por: string | null; at: string | null }
export interface Avance {
  items: ItemAvance[]; globales: PasoGlobal[];
  hechos: number; total: number; porcentaje: number;
  itemsCompletos: number;
}

/** Subestados que implican que el producto ya se compró (la OC pudo emitirse directo en Obuma y no en Licitank). */
const YA_COMPRADO = new Set(['COMPRADO', 'EN_BODEGA', 'LISTO_ENTREGA', 'ENTREGADO']);
const APROBADAS = new Set(['APROBADA', 'APROBADA_CON_MODIFICACION']);

export const TITULOS_PASO: Record<ClavePaso, string> = { cotizar: 'Cotizaciones', elegir: 'Proveedor elegido', aprobar: 'Aprobación', sku: 'SKU', oc: 'Orden de compra' };

function pasoItem(p: DatosProductoAvance, aprobacionCompra: string | null): PasoAvance[] {
  const n = p.cotizaciones.n;
  const cotizar: PasoAvance = n === 0
    ? { clave: 'cotizar', titulo: TITULOS_PASO.cotizar, estado: 'falta', texto: 'Sin cotizaciones', por: null, at: null }
    : { clave: 'cotizar', titulo: TITULOS_PASO.cotizar, estado: n >= 3 ? 'hecho' : 'parcial', texto: n >= 3 ? `${n} cotizaciones` : `${n} de 3 cotizaciones`, por: p.cotizaciones.por, at: p.cotizaciones.at };

  const elegir: PasoAvance = p.eleccion
    ? { clave: 'elegir', titulo: TITULOS_PASO.elegir, estado: 'hecho', texto: p.eleccion.proveedor, por: p.eleccion.por, at: p.eleccion.at }
    : { clave: 'elegir', titulo: TITULOS_PASO.elegir, estado: 'falta', texto: 'Sin elegir', por: null, at: null };

  let aprobar: PasoAvance;
  if (p.linea?.estado === 'RECHAZADA') aprobar = { clave: 'aprobar', titulo: TITULOS_PASO.aprobar, estado: 'rechazado', texto: 'Rechazada', por: p.linea.por, at: p.linea.at };
  else if (p.linea?.estado === 'APROBADA' || (aprobacionCompra && APROBADAS.has(aprobacionCompra))) aprobar = { clave: 'aprobar', titulo: TITULOS_PASO.aprobar, estado: 'hecho', texto: 'Aprobada', por: p.linea?.por ?? null, at: p.linea?.at ?? null };
  else aprobar = { clave: 'aprobar', titulo: TITULOS_PASO.aprobar, estado: 'falta', texto: 'Sin aprobar', por: null, at: null };

  const sku: PasoAvance = p.sku
    ? { clave: 'sku', titulo: TITULOS_PASO.sku, estado: 'hecho', texto: p.sku.codigo, por: p.sku.por, at: p.sku.at }
    : { clave: 'sku', titulo: TITULOS_PASO.sku, estado: 'falta', texto: 'Sin SKU', por: null, at: null };

  const oc: PasoAvance = p.oc
    ? { clave: 'oc', titulo: TITULOS_PASO.oc, estado: 'hecho', texto: p.oc.numero ? `OC ${p.oc.numero}` : 'OC emitida', por: p.oc.por, at: p.oc.at }
    : YA_COMPRADO.has(p.subestado)
      ? { clave: 'oc', titulo: TITULOS_PASO.oc, estado: 'hecho', texto: 'Comprado', por: null, at: null }
      : { clave: 'oc', titulo: TITULOS_PASO.oc, estado: 'falta', texto: 'Sin OC', por: null, at: null };

  return [cotizar, elegir, aprobar, sku, oc];
}

const ACCION_FALTA: Record<ClavePaso, string> = { cotizar: 'Cotizar', elegir: 'Elegir proveedor', aprobar: 'Aprobar', sku: 'Crear SKU', oc: 'Emitir OC' };

export function armarAvance(productos: DatosProductoAvance[], globales: DatosGlobalesAvance): Avance {
  const aprobacionCompra = globales.compra?.estado ?? null;
  const items: ItemAvance[] = productos.map(p => {
    const pasos = pasoItem(p, aprobacionCompra);
    // «Falta» dice lo PRIMERO que sigue; un rechazo va antes que lo demás porque bloquea.
    const rechazado = pasos.find(x => x.estado === 'rechazado');
    const primero = rechazado ?? pasos.find(x => x.estado === 'falta' || x.estado === 'parcial');
    const falta = !primero ? null : primero.estado === 'rechazado' ? 'Corregir lo que rechazó el jefe de ventas' : primero.estado === 'parcial' ? 'Completar cotizaciones (lo ideal son 3)' : ACCION_FALTA[primero.clave];
    return { id: p.id, correlativo: p.correlativo, descripcion: p.descripcion, pasos, falta, completo: pasos.every(x => x.estado === 'hecho') };
  });

  const paso = (clave: 'compra' | 'margen', titulo: string, d: ({ estado: string } & QuienCuando) | null): PasoGlobal => {
    if (d && APROBADAS.has(d.estado)) return { clave, titulo, estado: 'hecho', texto: 'Aprobada', por: d.por, at: d.at };
    if (d?.estado === 'RECHAZADA') return { clave, titulo, estado: 'rechazado', texto: 'Rechazada', por: d.por, at: d.at };
    if (d?.estado === 'PENDIENTE') return { clave, titulo, estado: 'parcial', texto: 'Esperando al jefe de ventas', por: d.por, at: d.at };
    return { clave, titulo, estado: 'falta', texto: 'Sin proponer', por: null, at: null };
  };
  const g: PasoGlobal[] = [paso('compra', 'Aprobación de la compra', globales.compra), paso('margen', 'Aprobación del margen', globales.margen)];

  const todos = [...items.flatMap(i => i.pasos), ...g];
  const hechos = todos.filter(x => x.estado === 'hecho').length;
  return { items, globales: g, hechos, total: todos.length, porcentaje: todos.length ? Math.round((hechos / todos.length) * 100) : 0, itemsCompletos: items.filter(i => i.completo).length };
}
