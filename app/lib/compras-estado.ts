// app/lib/compras-estado.ts
// Cambios del estado de la compra (ver compras-estado-core.ts). PAGADA deja el cierre «ENTREGADA» y CANCELADA el «NO_REALIZADA»
// (con el motivo ya escrito), así Cerradas/Canceladas, el dashboard y el chat siguen funcionando igual que antes.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { marcarCierreLegado } from '@/app/lib/compras';
import { listarFacturasVenta } from '@/app/lib/compras-factura-venta';
import { esSubestadoFuera } from '@/app/lib/compras-no-adjudicadas';
import {
  type EstadoCompra, ETIQUETA_ESTADO_COMPRA, MIN_MOTIVO_CANCELACION, estadoCompraEfectivo, siguienteEstadoCompra, puedeCancelarseDesde,
} from '@/app/lib/compras-estado-core';

async function leer(negocioId: number) {
  const [rows] = await pool.query(
    `SELECT ca.licitacion_codigo, ca.asignado_a, ca.precompra, ca.cierre_legado, ca.estado_compra
       FROM compras_asignacion ca WHERE ca.negocio_id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0] ?? null;
}

/** ¿Hay que pasar la licitación a «En proceso» antes de poder trabajar en ella? (la usa el candado de las rutas de Compras) */
export async function debePasarAEnProceso(negocioId: number): Promise<boolean> {
  try {
    const r = await leer(negocioId);
    if (!r || r.precompra || !r.asignado_a) return false;   // sin encargado manda el modal de asignar; pre-compra no es una compra aún
    return estadoCompraEfectivo(r.cierre_legado, r.estado_compra) === 'ABIERTA';
  } catch (e: any) {
    if (e?.code === 'ER_BAD_FIELD_ERROR') return false;     // migration-203 sin aplicar: no se bloquea nada
    throw e;
  }
}

/** Avisos (no bloquean) antes de confirmar un paso: lo que el sistema ve que aún falta. */
export async function advertenciasDeEstado(negocioId: number, nuevo: EstadoCompra): Promise<string[]> {
  const av: string[] = [];
  if (nuevo === 'ENTREGADA') {
    const [rows] = await pool.query(
      `SELECT subestado FROM compras_producto WHERE negocio_id = ? AND COALESCE(es_servicio, 0) = 0`, [negocioId]) as any;
    const pend = (rows as any[]).filter(p => !esSubestadoFuera(p.subestado) && p.subestado !== 'ENTREGADO').length;
    if (pend > 0) av.push(`${pend} producto(s) aún no figuran como «Entregado».`);
  }
  if (nuevo === 'PAGADA') {
    try { if (!(await listarFacturasVenta(negocioId)).length) av.push('No hay factura de venta al cliente registrada.'); } catch { /* sin tabla: no se avisa */ }
  }
  return av;
}

export async function cambiarEstadoCompra(
  negocioId: number, nuevo: EstadoCompra, o: { motivo?: string | null; userId: number; nombre: string | null },
): Promise<EstadoCompra> {
  const r = await leer(negocioId);
  if (!r) throw new Error('Este negocio todavía no entra a Compras.');
  if (r.precompra) throw new Error('Una pre-compra aún no tiene estado: se mueve sola cuando se adjudica.');
  const actual = estadoCompraEfectivo(r.cierre_legado, r.estado_compra);
  if (actual === 'PAGADA' || actual === 'CANCELADA') throw new Error(`Esta licitación ya está ${ETIQUETA_ESTADO_COMPRA[actual].toLowerCase()}. Para reabrirla, el dueño debe deshacerlo.`);

  if (nuevo === 'CANCELADA') {
    if (!puedeCancelarseDesde(actual)) throw new Error('No se puede cancelar desde este estado.');
    const motivo = String(o.motivo || '').trim();
    if (motivo.length < MIN_MOTIVO_CANCELACION) throw new Error(`Escribe al menos ${MIN_MOTIVO_CANCELACION} caracteres explicando por qué se cancela.`);
    await marcarCierreLegado(negocioId, 'NO_REALIZADA', motivo.slice(0, 300), o.userId, o.nombre, motivo.slice(0, 4000));
  } else if (nuevo === 'PAGADA') {
    if (actual !== 'ENTREGADA') throw new Error('Para marcarla Pagada, primero debe estar Entregada.');
    await marcarCierreLegado(negocioId, 'ENTREGADA', 'Facturada al cliente y pagada', o.userId, o.nombre);
  } else {
    if (siguienteEstadoCompra(actual) !== nuevo) throw new Error(`Desde «${ETIQUETA_ESTADO_COMPRA[actual]}» el siguiente paso es «${ETIQUETA_ESTADO_COMPRA[siguienteEstadoCompra(actual) ?? actual]}».`);
  }
  await pool.query(
    `UPDATE compras_asignacion SET estado_compra = ?, estado_compra_at = ?, estado_compra_por_nombre = ? WHERE negocio_id = ?`,
    [nuevo, ahoraChileSQL(), o.nombre, negocioId]);
  await registrarEvento({
    tipo: 'COMPRAS_ESTADO', licitacionCodigo: r.licitacion_codigo, actorId: o.userId, actorNombre: o.nombre,
    mensaje: `${r.licitacion_codigo} pasó de «${ETIQUETA_ESTADO_COMPRA[actual]}» a «${ETIQUETA_ESTADO_COMPRA[nuevo]}»${nuevo === 'CANCELADA' ? `: ${String(o.motivo).trim().slice(0, 300)}` : ''}.`,
    metadata: { negocio_id: negocioId, de: actual, a: nuevo },
  });
  publicarCambio('compras');
  return nuevo;
}
