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
  // ocMonto (15-sep-2026, pedido explícito): el checklist solo pedía el N° de OC, nunca el monto —
  // una OC registrada a mano (no creada vía la integración real con Obuma) quedaba sin costo en
  // ningún lado, y el agente de auditoría la marcaba como "inconsistencia grave" por tener $0
  // cuando en realidad nadie le había pedido ese dato a la persona.
  ocEmitidaAt: string | null; ocNumero: string | null; ocMonto: number | null;
  pagoRegistradoAt: string | null;
  anticipoPagadoAt: string | null; anticipoMonto: number | null;
  facturaCompraRegistradaAt: string | null;
  carpetaProyectoCreadaAt: string | null; carpetaProyectoId: string | null;
  provisionFondosAt: string | null; provisionFondosMonto: number | null; cuentaOrigen: string | null;
  notas: string | null; actualizadoPorNombre: string | null; updatedAt: string | null;
}

const FILA_VACIA: RepartoAdministrativo = {
  ocEmitidaAt: null, ocNumero: null, ocMonto: null, pagoRegistradoAt: null, anticipoPagadoAt: null, anticipoMonto: null,
  facturaCompraRegistradaAt: null, carpetaProyectoCreadaAt: null, carpetaProyectoId: null,
  provisionFondosAt: null, provisionFondosMonto: null, cuentaOrigen: null,
  notas: null, actualizadoPorNombre: null, updatedAt: null,
};

export async function obtenerReparto(negocioId: number): Promise<RepartoAdministrativo> {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(oc_emitida_at, '%Y-%m-%d %H:%i:%s') AS oc_emitida_at, oc_numero, oc_monto,
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
    ocEmitidaAt: r.oc_emitida_at, ocNumero: r.oc_numero, ocMonto: r.oc_monto == null ? null : Number(r.oc_monto),
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
  ocNumero?: string | null; ocMonto?: number | null; anticipoMonto?: number | null;
  carpetaProyectoId?: string | null; provisionFondosMonto?: number | null; cuentaOrigen?: string | null;
  // Respaldo (pedido explícito del usuario, 14-sep-2026): archivo opcional + nota OBLIGATORIA al
  // marcar el hito como hecho — "esos deben poder tener un respaldo". Se exige acá, no solo en la
  // UI, para que no haya forma de marcar un hito sin dejar por qué.
  nota?: string; archivoUrl?: string | null; archivoNombre?: string | null;
}

export interface RespaldoHito {
  hito: HitoReparto; estado: 'HECHO' | 'NO_APLICA'; nota: string; archivoUrl: string | null; archivoNombre: string | null;
  actualizadoPorNombre: string | null; updatedAt: string;
}

export async function listarRespaldosHito(negocioId: number): Promise<RespaldoHito[]> {
  const [rows] = await pool.query(
    `SELECT hito, estado, nota, archivo_url, archivo_nombre, actualizado_por_nombre,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM compras_reparto_respaldo WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => ({
    hito: r.hito, estado: r.estado, nota: r.nota, archivoUrl: r.archivo_url, archivoNombre: r.archivo_nombre,
    actualizadoPorNombre: r.actualizado_por_nombre, updatedAt: r.updated_at,
  }));
}

/** Pedido explícito del usuario (14-sep-2026): "qué pasa con las que no se realizan, ya que a veces
 *  no hacemos anticipo, pagamos todo" — un hito puede NO corresponder nunca para este negocio
 *  puntual (ej. "Anticipo pagado" cuando se paga de contado). Marcarlo "no aplica" (con motivo
 *  obligatorio, mismo criterio que el respaldo normal) lo saca del pendiente SIN decir que pasó —
 *  nunca se toca `<hito>_at` (no se inventa una fecha para algo que no ocurrió). */
export async function marcarHitoNoAplica(
  negocioId: number, hito: HitoReparto, motivo: string, actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!motivo?.trim()) throw new Error('Falta el motivo de por qué este hito no aplica.');
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO compras_reparto_respaldo (negocio_id, hito, estado, nota, archivo_url, archivo_nombre, actualizado_por, actualizado_por_nombre, updated_at)
     VALUES (?,?,?,?,NULL,NULL,?,?,?)
     ON DUPLICATE KEY UPDATE estado=VALUES(estado), nota=VALUES(nota), archivo_url=NULL, archivo_nombre=NULL,
       actualizado_por=VALUES(actualizado_por), actualizado_por_nombre=VALUES(actualizado_por_nombre), updated_at=VALUES(updated_at)`,
    [negocioId, hito, 'NO_APLICA', motivo.trim(), actorId, actorNombre, ahora],
  );
  await registrarEvento({
    tipo: 'COMPRAS_REPARTO_HITO', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `Se marcó el hito "${LABEL[hito]}" como no aplica: ${motivo.trim()} (spec §11).`,
    metadata: { negocio_id: negocioId, hito, estado: 'NO_APLICA' },
  });
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

  // Respaldo obligatorio (pedido explícito, 14-sep-2026): no se puede marcar un hito como hecho por
  // primera vez sin dejar una nota — el archivo es opcional, la nota nunca. Solo se exige al pasar
  // de pendiente a hecho (`!yaActivo`); editar un dato adjunto de un hito YA marcado (ej. corregir
  // el número de OC en el blur del input) no debe pedir la nota de nuevo cada vez.
  if (datos.activo && !yaActivo && !datos.nota?.trim()) {
    throw new Error('Este hito necesita una nota de respaldo antes de marcarse como hecho (spec §11: "controla y registra", no solo tilda).');
  }

  const set: string[] = ['actualizado_por = ?', 'actualizado_por_nombre = ?', 'updated_at = ?'];
  const vals: any[] = [actorId, actorNombre, ahora];
  if (!datos.activo) {
    // Desmarcar (§11: "por si se marcó por error") limpia también el dato adjunto — un simple
    // toggle para reactivar no debe resucitar un número de OC, monto o cuenta viejos sin que
    // alguien los haya vuelto a verificar (BUG REAL, 10-sep-2026: antes solo se limpiaba la
    // fecha, el dato adjunto quedaba pegado y reaparecía como vigente al reactivar el hito).
    set.push(`${campoAt} = NULL`);
    if (hito === 'ocEmitida') set.push('oc_numero = NULL, oc_monto = NULL');
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
    if (hito === 'ocEmitida' && datos.ocMonto !== undefined) { set.push('oc_monto = ?'); vals.push(datos.ocMonto ?? null); }
    if (hito === 'anticipoPagado' && datos.anticipoMonto !== undefined) { set.push('anticipo_monto = ?'); vals.push(datos.anticipoMonto ?? null); }
    if (hito === 'carpetaProyectoCreada' && datos.carpetaProyectoId !== undefined) { set.push('carpeta_proyecto_id = ?'); vals.push(datos.carpetaProyectoId || null); }
    if (hito === 'provisionFondos') {
      if (datos.provisionFondosMonto !== undefined) { set.push('provision_fondos_monto = ?'); vals.push(datos.provisionFondosMonto ?? null); }
      if (datos.cuentaOrigen !== undefined) { set.push('cuenta_origen = ?'); vals.push(datos.cuentaOrigen || null); }
    }
  }
  await pool.query(`UPDATE compras_reparto_administrativo SET ${set.join(', ')} WHERE negocio_id = ?`, [...vals, negocioId]);

  // Respaldo: se guarda al marcar por primera vez, se borra al desmarcar — mismo criterio que el
  // resto de los datos adjuntos de este hito (no debe quedar un respaldo viejo dando vueltas si el
  // hito se desmarcó porque se marcó por error). Si `datos.activo` viene true pero es solo una
  // edición de un campo de un hito YA marcado (sin `nota` — el blur de "N° de OC", por ejemplo), no
  // se toca el respaldo existente.
  if (datos.activo && datos.nota?.trim()) {
    await pool.query(
      `INSERT INTO compras_reparto_respaldo (negocio_id, hito, estado, nota, archivo_url, archivo_nombre, actualizado_por, actualizado_por_nombre, updated_at)
       VALUES (?,?,'HECHO',?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE estado='HECHO', nota=VALUES(nota), archivo_url=VALUES(archivo_url), archivo_nombre=VALUES(archivo_nombre),
         actualizado_por=VALUES(actualizado_por), actualizado_por_nombre=VALUES(actualizado_por_nombre), updated_at=VALUES(updated_at)`,
      [negocioId, hito, datos.nota.trim(), datos.archivoUrl || null, datos.archivoNombre || null, actorId, actorNombre, ahora],
    );
  } else if (!datos.activo) {
    await pool.query(`DELETE FROM compras_reparto_respaldo WHERE negocio_id = ? AND hito = ?`, [negocioId, hito]);
  }

  await registrarEvento({
    tipo: 'COMPRAS_REPARTO_HITO', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `${datos.activo ? 'Se marcó' : 'Se desmarcó'} el hito "${LABEL[hito]}" (spec §11).`,
    metadata: { negocio_id: negocioId, hito, activo: datos.activo },
  });
}
