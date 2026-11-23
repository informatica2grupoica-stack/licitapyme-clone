// app/lib/compras-costeo-ganadas.ts
// «Monto costeado» de Compras = solo el costo de las líneas que ADJUDICARON a nosotros.
// Caso real (2378-117-LP26, negocio 1385): el costeo tenía las líneas 1 y 5 postuladas ($66,7M) y el acta
// de MP solo nos dio la 5 ($36,4M): el Resumen comparaba el costo de 2 líneas con la venta de 1 y daba un
// margen de -83 %. Acá se le resta al total del costeo el costo de las líneas ofertadas que el acta dio a
// otro proveedor (misma regla que `aplicarAdjudicacionPorLinea`: línea con correlativo, no nuestra, con RUT).
// Lo que no se puede identificar NO se inventa: el total queda como estaba y se avisa.
import { lineasDelCosteo, type LineaCosteo } from '@/app/lib/auditor-compras-core';

export interface LineaActa { correlativo?: number | null; esNuestra?: boolean; rutProveedor?: string | null }

export interface CosteoPorGanadas {
  /** Costo neto de lo que SÍ ganamos (= total si no se perdió ninguna línea). */
  costo: number;
  /** Líneas (números de la licitación) que postulamos según el costeo. */
  postuladas: number[];
  /** Las que el acta nos adjudicó. */
  ganadas: number[];
  /** Las postuladas que se llevó otro proveedor. */
  perdidas: number[];
  /** Hay filas postuladas sin número de línea: no se puede asegurar a qué línea pertenecen. */
  filasSinLinea: boolean;
  /** Se restó algo del total del costeo. */
  parcial: boolean;
}

const costoFila = (l: LineaCosteo) => (l.cantidad ?? 0) * (l.costoRegistradoNeto ?? l.costoEstimadoNeto ?? 0);

/** Pura (sin base de datos): sirve para probarla con casos fijos. */
export function costeoSoloGanadas(totalCosteo: number, lineas: LineaCosteo[], acta: LineaActa[]): CosteoPorGanadas {
  const ofertadas = lineas.filter(l => l.ofertamos && !l.esGastoExtra);
  const postuladas = [...new Set(ofertadas.map(l => l.lineaReal).filter((n): n is number => n != null))].sort((a, b) => a - b);
  const filasSinLinea = ofertadas.some(l => l.lineaReal == null);
  const perdidasActa = new Set(acta
    .filter(a => a.correlativo != null && !a.esNuestra && String(a.rutProveedor || '').trim())
    .map(a => Number(a.correlativo)));
  const perdidas = postuladas.filter(n => perdidasActa.has(n));
  const ganadas = postuladas.filter(n => !perdidasActa.has(n));
  const restar = ofertadas.filter(l => l.lineaReal != null && perdidasActa.has(l.lineaReal)).reduce((s, l) => s + costoFila(l), 0);
  const costo = Math.max(0, Math.round((totalCosteo - restar) * 100) / 100);
  return { costo, postuladas, ganadas, perdidas, filasSinLinea, parcial: perdidas.length > 0 && restar > 0 };
}

/** Lee el costeo y el acta (solo caché, sin llamar a MP) y devuelve el costo de lo ganado. null = no se pudo / no aplica. */
export async function costeoGanadoDelNegocio(negocioId: number, totalCosteo: number): Promise<CosteoPorGanadas | null> {
  try {
    const { default: pool } = await import('@/app/lib/db');
    const { cargarEstadoCosteo } = await import('@/app/lib/auditor-compras');
    const { obtenerAdjudicacion } = await import('@/app/lib/adjudicacion');
    const [[neg], estado] = await Promise.all([
      pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]).then(([r]: any) => r as any[]),
      cargarEstadoCosteo(negocioId),
    ]);
    if (!neg?.licitacion_codigo || !estado) return null;
    const acta = await obtenerAdjudicacion(neg.licitacion_codigo, { sinRed: true, clienteId: 1 });
    if (!acta || !acta.esAdjudicada) return null;
    return costeoSoloGanadas(totalCosteo, lineasDelCosteo(estado), (acta.lineasAdjudicadas || []) as LineaActa[]);
  } catch (e) {
    console.error('[compras] costo de las líneas ganadas no calculable:', String(e).slice(0, 150));
    return null;
  }
}
