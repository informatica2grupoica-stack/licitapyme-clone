// app/lib/compras-cotizacion-specs.ts
// Cotización con especificaciones técnicas → también queda como FICHA del producto (Fichas técnicas de Compras).
// Reglas puras en compras-cotizacion-specs-core.ts; el ruteo (producto + proveedor + opción) lo hace procesarFicha con `desdeCotizacion`.
// Sin migración: usa las mismas tablas de fichas. No toca precios ni la cotización: solo AGREGA la ficha.
import pool from '@/app/lib/db';
import type { Actor } from '@/app/lib/auditor-opciones';
import { procesarFicha, type ResultadoRuteo } from '@/app/lib/compras-fichas';
import { pareceTenerEspecificaciones, proveedorUtilizable } from '@/app/lib/compras-cotizacion-specs-core';

export interface ResultadoFichasDeCotizacion {
  hecho: boolean;
  /** Por qué no se hizo (sin archivo, sin señales técnicas…) o resumen de lo que pasó. */
  motivo: string;
  ruteo?: ResultadoRuteo;
}

/** Revisa UNA cotización ya registrada y, si trae especificaciones técnicas, deja esos productos como fichas.
 *  `forzar` salta el filtro barato por texto (para «revisar de nuevo» a mano); el Lector igual decide qué productos traen specs. */
export async function fichasDesdeCotizacion(params: { negocioId: number; cotizacionId: number; actor: Actor; forzar?: boolean }): Promise<ResultadoFichasDeCotizacion> {
  const { negocioId, cotizacionId, actor, forzar } = params;
  const [rows] = await pool.query(
    `SELECT id, proveedor_nombre, proveedor_rut, descripcion_libre, archivo_url, archivo_nombre FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`,
    [cotizacionId, negocioId]) as any;
  const c = (rows as any[])[0];
  if (!c) return { hecho: false, motivo: 'La cotización no existe en este negocio.' };
  if (!c.archivo_url) return { hecho: false, motivo: 'La cotización no tiene archivo: no hay de dónde sacar especificaciones.' };
  if (!forzar && !pareceTenerEspecificaciones(c.descripcion_libre)) return { hecho: false, motivo: 'El texto de la cotización no muestra especificaciones técnicas (solo precio y descripción).' };
  const ruteo = await procesarFicha({
    negocioId, url: c.archivo_url, nombre: c.archivo_nombre || 'cotización', actor,
    desdeCotizacion: { proveedor: proveedorUtilizable(c.proveedor_nombre), rut: c.proveedor_rut || null },
  });
  if (ruteo.error) return { hecho: false, motivo: ruteo.error, ruteo };
  const n = (r: string) => ruteo.productos.filter(p => p.resultado === r).length;
  return { hecho: n('asignada') > 0, motivo: `${n('asignada')} producto(s) pasaron a Fichas técnicas, ${n('por_confirmar') + n('sin_producto')} quedaron por asignar, ${n('no_es_ficha')} sirven solo para el precio.`, ruteo };
}

/** Misma revisión, sin bloquear la respuesta de la subida. Un fallo nunca rompe la carga de la cotización. */
export function fichasDesdeCotizacionEnSegundoPlano(params: { negocioId: number; cotizacionId: number; actor: Actor }): void {
  fichasDesdeCotizacion(params).then(r => { if (r.hecho) console.log(`[compras-fichas] cotización ${params.cotizacionId} → fichas: ${r.motivo}`); })
    .catch(e => console.warn('[compras-fichas] no se pudo leer la cotización como ficha:', String(e).slice(0, 200)));
}
