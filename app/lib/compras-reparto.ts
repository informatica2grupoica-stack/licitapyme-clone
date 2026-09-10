// app/lib/compras-reparto.ts
// PROCESO ADMINISTRATIVO POST-APROBACIÓN (spec §11) — §11.1 es explícito: "Lo que hace OBUMA, no
// el módulo" para emisión de OC, pago, anticipos, facturas de compra, carpeta de proyecto, nota de
// venta/guía y factura de venta. "El Módulo de Compras controla y registra el estado de estos
// hitos, no los ejecuta." Este archivo es exactamente eso: una fila por negocio, un hito por campo,
// nunca una llamada a la API de OBUMA para ejecutar nada.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

/** §11.2 — "política de pago según antigüedad: proveedor nuevo → se exige factura antes del pago;
 *  proveedor antiguo → se puede provisionar el pago." BUG REAL (10-sep-2026, auditoría estática):
 *  esta regla estaba descrita en el comentario de la migración pero nunca se aplicaba —
 *  `marcarHitoReparto` dejaba provisionar fondos a cualquiera, proveedor nuevo o no. Mira los
 *  proveedores del escenario elegido (compras_escenario) y si alguno quedó marcado "nuevo" al
 *  registrar su cotización (`compras_cotizacion.proveedor_nuevo`, vía OBUMA — §8.5), exige que la
 *  factura de compra ya esté registrada. Sin escenario elegido o sin ningún proveedor "nuevo"
 *  conocido, no bloquea — es una regla que solo puede aplicar cuando hay con qué verificarla. */
async function proveedorNuevoSinFactura(negocioId: number): Promise<boolean> {
  try {
    const [[esc]] = await pool.query(
      `SELECT detalle_json FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`,
      [negocioId],
    ) as any;
    if (!esc?.detalle_json) return false;
    const detalle = typeof esc.detalle_json === 'string' ? JSON.parse(esc.detalle_json) : esc.detalle_json;
    const proveedores: string[] = detalle?.proveedoresInvolucrados || [];
    if (proveedores.length === 0) return false;

    const [nuevos] = await pool.query(
      `SELECT DISTINCT proveedor_nombre FROM compras_cotizacion WHERE negocio_id = ? AND proveedor_nuevo = 1`,
      [negocioId],
    ) as any;
    const nombresNuevos = new Set((nuevos as any[]).map(r => r.proveedor_nombre));
    if (!proveedores.some(p => nombresNuevos.has(p))) return false;

    const [[fila]] = await pool.query(
      `SELECT factura_compra_registrada_at FROM compras_reparto_administrativo WHERE negocio_id = ?`,
      [negocioId],
    ) as any;
    return !fila?.factura_compra_registrada_at;
  } catch (e) {
    console.error(`[compras-reparto] chequeo proveedor nuevo/factura de ${negocioId}:`, String(e).slice(0, 150));
    return false; // no se pudo verificar: no bloquea por un error de lectura
  }
}

export interface RepartoAdministrativo {
  ocEmitidaAt: string | null; ocNumero: string | null;
  pagoRegistradoAt: string | null;
  anticipoPagadoAt: string | null; anticipoMonto: number | null;
  facturaCompraRegistradaAt: string | null;
  carpetaProyectoCreadaAt: string | null; carpetaProyectoId: string | null;
  provisionFondosAt: string | null; provisionFondosMonto: number | null; cuentaOrigen: string | null;
  notas: string | null; actualizadoPorNombre: string | null; updatedAt: string | null;
}

const FILA_VACIA: RepartoAdministrativo = {
  ocEmitidaAt: null, ocNumero: null, pagoRegistradoAt: null, anticipoPagadoAt: null, anticipoMonto: null,
  facturaCompraRegistradaAt: null, carpetaProyectoCreadaAt: null, carpetaProyectoId: null,
  provisionFondosAt: null, provisionFondosMonto: null, cuentaOrigen: null,
  notas: null, actualizadoPorNombre: null, updatedAt: null,
};

export async function obtenerReparto(negocioId: number): Promise<RepartoAdministrativo> {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(oc_emitida_at, '%Y-%m-%d %H:%i:%s') AS oc_emitida_at, oc_numero,
            DATE_FORMAT(pago_registrado_at, '%Y-%m-%d %H:%i:%s') AS pago_registrado_at,
            DATE_FORMAT(anticipo_pagado_at, '%Y-%m-%d %H:%i:%s') AS anticipo_pagado_at, anticipo_monto,
            DATE_FORMAT(factura_compra_registrada_at, '%Y-%m-%d %H:%i:%s') AS factura_compra_registrada_at,
            DATE_FORMAT(carpeta_proyecto_creada_at, '%Y-%m-%d %H:%i:%s') AS carpeta_proyecto_creada_at, carpeta_proyecto_id,
            DATE_FORMAT(provision_fondos_at, '%Y-%m-%d %H:%i:%s') AS provision_fondos_at, provision_fondos_monto, cuenta_origen,
            notas, actualizado_por_nombre, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM compras_reparto_administrativo WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return { ...FILA_VACIA };
  return {
    ocEmitidaAt: r.oc_emitida_at, ocNumero: r.oc_numero,
    pagoRegistradoAt: r.pago_registrado_at,
    anticipoPagadoAt: r.anticipo_pagado_at, anticipoMonto: r.anticipo_monto == null ? null : Number(r.anticipo_monto),
    facturaCompraRegistradaAt: r.factura_compra_registrada_at,
    carpetaProyectoCreadaAt: r.carpeta_proyecto_creada_at, carpetaProyectoId: r.carpeta_proyecto_id,
    provisionFondosAt: r.provision_fondos_at, provisionFondosMonto: r.provision_fondos_monto == null ? null : Number(r.provision_fondos_monto),
    cuentaOrigen: r.cuenta_origen,
    notas: r.notas, actualizadoPorNombre: r.actualizado_por_nombre, updatedAt: r.updated_at,
  };
}

export type HitoReparto =
  | 'ocEmitida' | 'pagoRegistrado' | 'anticipoPagado' | 'facturaCompraRegistrada'
  | 'carpetaProyectoCreada' | 'provisionFondos';

const CAMPO_AT: Record<HitoReparto, string> = {
  ocEmitida: 'oc_emitida_at', pagoRegistrado: 'pago_registrado_at', anticipoPagado: 'anticipo_pagado_at',
  facturaCompraRegistrada: 'factura_compra_registrada_at', carpetaProyectoCreada: 'carpeta_proyecto_creada_at',
  provisionFondos: 'provision_fondos_at',
};
const LABEL: Record<HitoReparto, string> = {
  ocEmitida: 'Orden de compra emitida (OBUMA)', pagoRegistrado: 'Pago registrado (OBUMA)',
  anticipoPagado: 'Anticipo pagado (OBUMA)', facturaCompraRegistrada: 'Factura de compra registrada (OBUMA)',
  carpetaProyectoCreada: 'Carpeta de proyecto creada (OBUMA)', provisionFondos: 'Provisión de fondos',
};

export interface MarcarHitoDatos {
  activo: boolean; // false = desmarcar (por si se marcó por error)
  ocNumero?: string | null; anticipoMonto?: number | null;
  carpetaProyectoId?: string | null; provisionFondosMonto?: number | null; cuentaOrigen?: string | null;
}

/** Marca (o desmarca) UN hito administrativo (§11.1/§11.2) — nunca ejecuta nada en OBUMA, solo dice
 *  "esto ya pasó, quedó registrado acá". Crea la fila del negocio si es la primera vez. */
export async function marcarHitoReparto(
  negocioId: number, hito: HitoReparto, datos: MarcarHitoDatos, actorId: number, actorNombre: string | null,
): Promise<void> {
  if (hito === 'provisionFondos' && datos.activo && await proveedorNuevoSinFactura(negocioId)) {
    throw new Error('El escenario elegido incluye un proveedor nuevo — se exige la factura de compra registrada antes de provisionar fondos (spec §11.2).');
  }
  const ahora = ahoraChileSQL();
  const campoAt = CAMPO_AT[hito];

  await pool.query(
    `INSERT IGNORE INTO compras_reparto_administrativo (negocio_id, updated_at) VALUES (?, ?)`,
    [negocioId, ahora],
  );
  // No pisa la fecha del hito si ya estaba marcado (solo se está editando un dato adjunto, como el
  // número de OC) — la fecha registrada es "cuándo pasó de verdad", no "cuándo se tocó el campo".
  const [rows] = await pool.query(`SELECT ${campoAt} AS actual FROM compras_reparto_administrativo WHERE negocio_id = ?`, [negocioId]) as any;
  const yaActivo = (rows as any[])[0]?.actual != null;

  const set: string[] = ['actualizado_por = ?', 'actualizado_por_nombre = ?', 'updated_at = ?'];
  const vals: any[] = [actorId, actorNombre, ahora];
  if (!datos.activo) {
    // Desmarcar (§11: "por si se marcó por error") limpia también el dato adjunto — un simple
    // toggle para reactivar no debe resucitar un número de OC, monto o cuenta viejos sin que
    // alguien los haya vuelto a verificar (BUG REAL, 10-sep-2026: antes solo se limpiaba la
    // fecha, el dato adjunto quedaba pegado y reaparecía como vigente al reactivar el hito).
    set.push(`${campoAt} = NULL`);
    if (hito === 'ocEmitida') set.push('oc_numero = NULL');
    if (hito === 'anticipoPagado') set.push('anticipo_monto = NULL');
    if (hito === 'carpetaProyectoCreada') set.push('carpeta_proyecto_id = NULL');
    if (hito === 'provisionFondos') set.push('provision_fondos_monto = NULL, cuenta_origen = NULL');
  }
  else if (!yaActivo) { set.push(`${campoAt} = ?`); vals.push(ahora); }
  // Los datos adjuntos solo se tocan cuando se está MARCANDO (activo=true) — al desmarcar ya se
  // limpiaron arriba, tocarlos de nuevo acá abajo con lo que haya llegado en `datos` (que la UI hoy
  // nunca manda al desmarcar, pero un futuro caller sí podría) pisaría esa limpieza en el mismo
  // UPDATE, porque MySQL aplica el último `col = valor` de la lista SET.
  if (datos.activo) {
    if (hito === 'ocEmitida' && datos.ocNumero !== undefined) { set.push('oc_numero = ?'); vals.push(datos.ocNumero || null); }
    if (hito === 'anticipoPagado' && datos.anticipoMonto !== undefined) { set.push('anticipo_monto = ?'); vals.push(datos.anticipoMonto ?? null); }
    if (hito === 'carpetaProyectoCreada' && datos.carpetaProyectoId !== undefined) { set.push('carpeta_proyecto_id = ?'); vals.push(datos.carpetaProyectoId || null); }
    if (hito === 'provisionFondos') {
      if (datos.provisionFondosMonto !== undefined) { set.push('provision_fondos_monto = ?'); vals.push(datos.provisionFondosMonto ?? null); }
      if (datos.cuentaOrigen !== undefined) { set.push('cuenta_origen = ?'); vals.push(datos.cuentaOrigen || null); }
    }
  }
  await pool.query(`UPDATE compras_reparto_administrativo SET ${set.join(', ')} WHERE negocio_id = ?`, [...vals, negocioId]);

  await registrarEvento({
    tipo: 'COMPRAS_REPARTO_HITO', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `${datos.activo ? 'Se marcó' : 'Se desmarcó'} el hito "${LABEL[hito]}" (spec §11).`,
    metadata: { negocio_id: negocioId, hito, activo: datos.activo },
  });
}
