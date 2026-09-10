// app/lib/compras-aprobaciones.ts
// COMPUERTAS DE APROBACIÓN (spec §10) + CREACIÓN DE SKU (spec §7).
//
// §10.1: cuando se llega acá ya se revisó el negocio del asistente, se validó técnicamente el
// producto, se validó la cotización de origen, se contactó al cliente, el área de compras consiguió
// cotizaciones con fichas y el Auditor de Compras las parametrizó y dictaminó cumplimiento técnico y
// calce de precio (todo eso son las tandas 1-2, ya construidas).
//
// DOS COMPUERTAS SEPARADAS E INDEPENDIENTES (§10.3):
//   · COMPRA  (§10.2) — el encargado propone la compra sobre el escenario ya elegido (ver
//     `elegirEscenario` en compras-auditor.ts); la aprueba el jefe de ventas.
//   · MARGEN  (§10.3) — margen mínimo tolerado 20% sobre precio de venta neto vs costo neto. Bajo
//     20% el sistema avisa, exige motivo y pide autorización expresa — NO bloquea de plano. La
//     aprueba el jefe de ventas sea cual sea el monto.
//
// Acciones disponibles en ambas (§10.4): APROBAR · APROBAR_CON_MODIFICACION · RECHAZAR (con comentario).
// Invalidación (§10.5) vive en `invalidarAprobacionesCompras` (compras.ts), para evitar un ciclo de
// imports entre este archivo y compras-auditor.ts.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { obtenerAsignacion, listarProductosCompra } from '@/app/lib/compras';
import { obtenerOrigenCompra, calcularCostoAterrizado } from '@/app/lib/compras-importacion';
import { crearProductoObuma, siguienteSkuMercadoPublico, listarProductosObuma } from '@/app/lib/obuma';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export type TipoAprobacion = 'COMPRA' | 'MARGEN';
export type EstadoAprobacion = 'PENDIENTE' | 'APROBADA' | 'APROBADA_CON_MODIFICACION' | 'RECHAZADA';
export type DecisionAprobacion = 'APROBAR' | 'APROBAR_CON_MODIFICACION' | 'RECHAZAR';

export interface Aprobacion {
  tipo: TipoAprobacion; estado: EstadoAprobacion; detalle: any; motivo: string | null;
  propuestoPorNombre: string | null; propuestoAt: string | null;
  resueltoPorNombre: string | null; resueltoAt: string | null; comentarioResolucion: string | null;
}

async function leerAprobacion(negocioId: number, tipo: TipoAprobacion): Promise<Aprobacion | null> {
  const [rows] = await pool.query(
    `SELECT estado, detalle_json, motivo, propuesto_por_nombre, DATE_FORMAT(propuesto_at, '%Y-%m-%d %H:%i:%s') AS propuesto_at,
            resuelto_por_nombre, DATE_FORMAT(resuelto_at, '%Y-%m-%d %H:%i:%s') AS resuelto_at, comentario_resolucion
       FROM compras_aprobacion WHERE negocio_id = ? AND tipo = ? LIMIT 1`,
    [negocioId, tipo],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  let detalle: any = null;
  try { detalle = r.detalle_json ? JSON.parse(r.detalle_json) : null; } catch { /* snapshot ilegible, no bloquea */ }
  return {
    tipo, estado: r.estado, detalle, motivo: r.motivo,
    propuestoPorNombre: r.propuesto_por_nombre, propuestoAt: r.propuesto_at,
    resueltoPorNombre: r.resuelto_por_nombre, resueltoAt: r.resuelto_at, comentarioResolucion: r.comentario_resolucion,
  };
}

export async function obtenerAprobaciones(negocioId: number): Promise<{ compra: Aprobacion | null; margen: Aprobacion | null }> {
  const [compra, margen] = await Promise.all([leerAprobacion(negocioId, 'COMPRA'), leerAprobacion(negocioId, 'MARGEN')]);
  return { compra, margen };
}

export async function obtenerEscenarioElegido(negocioId: number) {
  const [rows] = await pool.query(
    `SELECT tipo, costo_total, dias_estimados, viajes_estimados, elegido_justificacion, detalle_json
       FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`,
    [negocioId],
  ) as any;
  return (rows as any[])[0] || null;
}

/** §10.2 — el encargado propone la compra sobre el escenario que ya eligió (elegirEscenario). */
export async function proponerAprobacionCompra(negocioId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const escenario = await obtenerEscenarioElegido(negocioId);
  if (!escenario) throw new Error('Primero hay que elegir un escenario de compra (spec §8.10.4).');
  const ahora = ahoraChileSQL();
  const detalle = {
    escenarioTipo: escenario.tipo, costoTotal: Number(escenario.costo_total),
    diasEstimados: escenario.dias_estimados, viajesEstimados: escenario.viajes_estimados,
  };
  await pool.query(
    `INSERT INTO compras_aprobacion (negocio_id, tipo, estado, detalle_json, motivo, propuesto_por, propuesto_por_nombre, propuesto_at, created_at, updated_at)
     VALUES (?, 'COMPRA', 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE estado='PENDIENTE', detalle_json=VALUES(detalle_json), motivo=VALUES(motivo),
       propuesto_por=VALUES(propuesto_por), propuesto_por_nombre=VALUES(propuesto_por_nombre), propuesto_at=VALUES(propuesto_at),
       resuelto_por=NULL, resuelto_por_nombre=NULL, resuelto_at=NULL, comentario_resolucion=NULL, updated_at=VALUES(updated_at)`,
    [negocioId, JSON.stringify(detalle), escenario.elegido_justificacion || null, actorId, actorNombre, ahora, ahora, ahora],
  );
  await registrarEvento({
    tipo: 'COMPRAS_APROBACION_COMPRA_PROPUESTA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se propuso la Compuerta 1 (Aprobación de compra) — escenario "${escenario.tipo}", ${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(escenario.costo_total))}.`,
    metadata: { negocio_id: negocioId, escenario: escenario.tipo },
  });
}

export interface MargenCalculado { ventaNeta: number | null; costoNeto: number | null; margenPct: number | null; fuenteCosto: 'costo_aterrizado' | 'escenario_elegido' | 'costeo_estimado' | null }

/** §10.3 — margen sobre precio de venta NETO vs costo NETO. Orden de preferencia de la fuente de
 *  costo: (1) costo ATERRIZADO si el proyecto es de importación y ya tiene los datos del embarque
 *  — "la cotización FOB no es el costo del producto... o el margen se calcula sobre una cifra
 *  falsa" (§12.3/§12.5: "conecta directamente con la Compuerta 2"); (2) el costo REAL del escenario
 *  elegido (compra local); (3) el costeo estimado del asistente (§1.3.2, "presupuesto, no meta"). */
export async function calcularMargenPrevisto(negocioId: number): Promise<MargenCalculado> {
  const asignacion = await obtenerAsignacion(negocioId);
  const ventaNeta = asignacion?.resumen?.montoNuestro ?? null;

  const origen = await obtenerOrigenCompra(negocioId);
  let costoNeto: number | null = null;
  let fuenteCosto: MargenCalculado['fuenteCosto'] = null;

  if (origen.origen === 'IMPORTACION') {
    const aterrizado = await calcularCostoAterrizado(negocioId);
    if (aterrizado) { costoNeto = aterrizado.totalAterrizado; fuenteCosto = 'costo_aterrizado'; }
  }

  const escenario = await obtenerEscenarioElegido(negocioId);
  if (fuenteCosto == null && escenario) { costoNeto = Number(escenario.costo_total); fuenteCosto = 'escenario_elegido'; }
  else if (fuenteCosto == null && asignacion?.resumen?.existeCosteo && asignacion.resumen.montoCosteado != null) {
    costoNeto = asignacion.resumen.montoCosteado; fuenteCosto = 'costeo_estimado';
  }
  const margenPct = (ventaNeta && costoNeto != null && ventaNeta > 0)
    ? Math.round(((ventaNeta - costoNeto) / ventaNeta) * 1000) / 10 : null;
  return { ventaNeta, costoNeto, margenPct, fuenteCosto };
}

export const MARGEN_MINIMO_PCT = 20; // §10.3

/** §10.3 — bajo 20% el sistema avisa, desbloquea, exige motivo y pide autorización expresa. No
 *  bloquea de plano: el motivo es obligatorio SOLO si el margen calculado queda bajo el mínimo. */
export async function proponerAprobacionMargen(
  negocioId: number, motivoSiBajo: string | null, actorId: number, actorNombre: string | null,
): Promise<MargenCalculado> {
  const margen = await calcularMargenPrevisto(negocioId);
  if (margen.margenPct != null && margen.margenPct < MARGEN_MINIMO_PCT && !motivoSiBajo?.trim()) {
    throw new Error(`El margen previsto (${margen.margenPct}%) queda bajo el mínimo de ${MARGEN_MINIMO_PCT}% — requiere motivo y autorización expresa (spec §10.3).`);
  }
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO compras_aprobacion (negocio_id, tipo, estado, detalle_json, motivo, propuesto_por, propuesto_por_nombre, propuesto_at, created_at, updated_at)
     VALUES (?, 'MARGEN', 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE estado='PENDIENTE', detalle_json=VALUES(detalle_json), motivo=VALUES(motivo),
       propuesto_por=VALUES(propuesto_por), propuesto_por_nombre=VALUES(propuesto_por_nombre), propuesto_at=VALUES(propuesto_at),
       resuelto_por=NULL, resuelto_por_nombre=NULL, resuelto_at=NULL, comentario_resolucion=NULL, updated_at=VALUES(updated_at)`,
    [negocioId, JSON.stringify(margen), motivoSiBajo || null, actorId, actorNombre, ahora, ahora, ahora],
  );
  await registrarEvento({
    tipo: 'COMPRAS_APROBACION_MARGEN_PROPUESTA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se propuso la Compuerta 2 (Aprobación de margen) — margen previsto ${margen.margenPct ?? '—'}%${motivoSiBajo ? `: ${motivoSiBajo}` : ''}.`,
    metadata: { negocio_id: negocioId, margen_pct: margen.margenPct },
  });
  return margen;
}

const ESTADO_POR_DECISION: Record<DecisionAprobacion, EstadoAprobacion> = {
  APROBAR: 'APROBADA', APROBAR_CON_MODIFICACION: 'APROBADA_CON_MODIFICACION', RECHAZAR: 'RECHAZADA',
};

/** §10.4 — resuelve una compuerta. Sea cual sea el monto, la resuelve el jefe de ventas (verificado
 *  en la capa de API, no acá: acá solo se persiste la decisión). */
export async function resolverAprobacion(
  negocioId: number, tipo: TipoAprobacion, decision: DecisionAprobacion, comentario: string | null,
  actorId: number, actorNombre: string | null,
): Promise<void> {
  if (decision === 'RECHAZAR' && !comentario?.trim()) throw new Error('Rechazar requiere comentario (spec §10.4).');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_aprobacion
        SET estado = ?, resuelto_por = ?, resuelto_por_nombre = ?, resuelto_at = ?, comentario_resolucion = ?, updated_at = ?
      WHERE negocio_id = ? AND tipo = ? AND estado = 'PENDIENTE'`,
    [ESTADO_POR_DECISION[decision], actorId, actorNombre, ahora, comentario || null, ahora, negocioId, tipo],
  ) as any;
  if (!r?.affectedRows) throw new Error('No hay una propuesta pendiente de esta compuerta (puede que ya se haya resuelto o invalidado).');
  await registrarEvento({
    tipo: `COMPRAS_APROBACION_${tipo}_${ESTADO_POR_DECISION[decision]}`, licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Compuerta ${tipo === 'COMPRA' ? '1 (Compra)' : '2 (Margen)'}: ${decision.replace(/_/g, ' ').toLowerCase()}${comentario ? ` — ${comentario}` : ''}.`,
    metadata: { negocio_id: negocioId, tipo, decision },
  });
}

// ── SKU (§7) ─────────────────────────────────────────────────────────────────────────────────────
export interface Sku {
  id: number; productoId: number; skuPropio: string; skuProveedor: string | null;
  proveedorNombre: string | null; marca: string | null; modelo: string | null;
  verificadoObuma: boolean; obumaProductoId: string | null; obumaCodigoComercial: string | null;
  creadoPorNombre: string | null; createdAt: string;
}

export async function listarSkus(negocioId: number): Promise<Sku[]> {
  const [rows] = await pool.query(
    `SELECT id, producto_id, sku_propio, sku_proveedor, proveedor_nombre, marca, modelo,
            verificado_obuma, obuma_producto_id, obuma_codigo_comercial, creado_por_nombre, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM compras_sku WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => ({
    id: r.id, productoId: r.producto_id, skuPropio: r.sku_propio, skuProveedor: r.sku_proveedor,
    proveedorNombre: r.proveedor_nombre, marca: r.marca, modelo: r.modelo,
    verificadoObuma: !!r.verificado_obuma, obumaProductoId: r.obuma_producto_id,
    obumaCodigoComercial: r.obuma_codigo_comercial,
    creadoPorNombre: r.creado_por_nombre, createdAt: r.created_at,
  }));
}

export interface DatosSku {
  skuPropio: string; skuProveedor?: string | null; proveedorNombre?: string | null; marca?: string | null; modelo?: string | null;
  // §7.4 — homologación de códigos: el ID del producto en OBUMA, cuando ya se sabe cuál es a mano.
  obumaProductoId?: string | null;
  // Crear el producto DE VERDAD en Obuma (§7, activado 10-sep-2026, escritura real contra el ERP
  // de producción) — requiere elegir la subcategoría real (bajo "Mercado Publico", ver obuma.ts).
  // Si viene true, `obumaProductoId`/`obumaCodigoComercial` los llena el propio Obuma, no se piden.
  crearEnObuma?: boolean; obumaSubcategoriaId?: string | null;
  // El nombre que se manda a Obuma como `producto_nombre` — SIEMPRE lo que se está COTIZANDO/
  // COMPRANDO (armado en el formulario a partir de Tipo/Atributo/Medida/Marca, mismo patrón que ya
  // usaba grupoica-intranet para este mismo Obuma), NUNCA la descripción de la línea de la
  // licitación (regla dura §7.3: "el SKU se nombra por lo que compramos, nunca por lo que el
  // cliente nos pidió"). Obligatorio cuando `crearEnObuma` es true.
  nombreObuma?: string | null;
  // El costo que el usuario vio en pantalla al confirmar (viene del mismo endpoint de preview que
  // usa la UI). Si al momento de crear el costo real del escenario ya cambió, crearSku rechaza en
  // vez de mandar a Obuma un número que el usuario nunca llegó a confirmar.
  costoEsperado?: number | null;
}

export interface CostoEscenarioProducto { costoUnitario: number; escenarioTipo: string }

/** El costo real de un producto puntual, según el escenario YA elegido (nunca se inventa un costo
 *  aparte para Obuma — mismo criterio que calcularMargenPrevisto: una sola fuente, el escenario
 *  elegido). Se usa DOS VECES con la misma lógica: acá en crearSku (lo que de verdad se manda) y en
 *  el preview que ve el usuario ANTES de confirmar — así nunca pueden divergir uno del otro. */
export async function costoEscenarioParaProducto(negocioId: number, productoId: number): Promise<CostoEscenarioProducto | null> {
  const escenario = await obtenerEscenarioElegido(negocioId);
  if (!escenario) return null;
  let detalle: any = null;
  try { detalle = typeof escenario.detalle_json === 'string' ? JSON.parse(escenario.detalle_json) : escenario.detalle_json; } catch { /* detalle inválido, se trata como vacío */ }
  const item = (detalle?.porProducto || []).find((p: any) => p.productoId === productoId);
  if (item?.precioUnitario == null) return null;
  return { costoUnitario: Number(item.precioUnitario), escenarioTipo: escenario.tipo };
}

/** §7.1 — se crea DESPUÉS de aprobada la compra: "debe describir lo que efectivamente se va a
 *  comprar, y eso solo se sabe cuando la compra está definida". §7.3 — regla dura de nomenclatura:
 *  el SKU se nombra por lo que SE COMPRA, nunca por lo que pidió el cliente (no se valida en código
 *  porque es una decisión de redacción humana, pero queda documentado en el formulario).
 *
 *  El usuario debe poder VER el costo exacto que se va a mandar a Obuma antes de que se mande de
 *  verdad — el escenario puede haberse editado después de armar el formulario, así que `datos`
 *  trae `costoEsperado` (lo último que el usuario vio en pantalla) y si no coincide con el costo
 *  real leído ACÁ, se rechaza: mejor que el usuario vuelva a confirmar con el número correcto que
 *  mandar un costo que ya cambió sin que se diera cuenta. */
export async function crearSku(negocioId: number, productoId: number, datos: DatosSku, actorId: number, actorNombre: string | null): Promise<number> {
  const aprobacionCompra = await leerAprobacion(negocioId, 'COMPRA');
  if (!aprobacionCompra || !['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(aprobacionCompra.estado)) {
    throw new Error('El SKU se crea después de aprobada la Compuerta 1 (Aprobación de compra) — spec §7.1.');
  }
  const productos = await listarProductosCompra(negocioId);
  const producto = productos.find(p => p.id === productoId);
  if (!producto) throw new Error('El producto no pertenece a este negocio.');
  // Licitank y Obuma son de la misma empresa (pedido explícito del usuario, 10-sep-2026): cuando el
  // producto se crea de verdad en Obuma, el código que Obuma asigna ES el identificador — no tiene
  // sentido inventar un SKU propio aparte y mantener dos códigos para lo mismo. El campo manual
  // solo se exige cuando NO se crea en Obuma (ej. referencia puramente interna, o se homologa a
  // mano con un `obumaProductoId` ya conocido más abajo).
  if (!datos.crearEnObuma && !datos.skuPropio?.trim()) throw new Error('Falta el SKU propio.');

  let obumaProductoId = datos.obumaProductoId?.trim() || null;
  let obumaCodigoComercial: string | null = null;
  let verificadoObuma = !!obumaProductoId;

  if (datos.crearEnObuma) {
    if (!datos.obumaSubcategoriaId?.trim()) throw new Error('Falta elegir la subcategoría de Obuma (bajo "Mercado Publico") para crear el producto.');
    if (!datos.nombreObuma?.trim()) throw new Error('Falta el nombre del producto (Tipo/Atributo/Medida/Marca) — es lo que se está cotizando, no la línea de la licitación.');

    const costo = await costoEscenarioParaProducto(negocioId, productoId);
    if (!costo) throw new Error('Falta elegir un escenario de compra antes de crear el SKU en Obuma — no hay costo real de dónde partir.');
    if (datos.costoEsperado != null && Math.round(datos.costoEsperado) !== Math.round(costo.costoUnitario)) {
      throw new Error(`El costo del escenario cambió desde que se abrió el formulario (ahora es ${Math.round(costo.costoUnitario).toLocaleString('es-CL')}, no ${Math.round(datos.costoEsperado).toLocaleString('es-CL')}) — vuelve a revisar antes de crear en Obuma.`);
    }

    const nombreObuma = datos.nombreObuma.trim();
    const codigoSugerido = await siguienteSkuMercadoPublico(datos.obumaSubcategoriaId.trim());
    const { productoId: idCreado, codigoComercial } = await crearProductoObuma({
      nombre: nombreObuma, codigoComercial: codigoSugerido, subcategoriaId: datos.obumaSubcategoriaId.trim(),
      costoClpNeto: costo.costoUnitario,
    });
    obumaProductoId = idCreado;
    obumaCodigoComercial = codigoComercial; // el que Obuma confirmó al releer, no el sugerido
    verificadoObuma = true;
  }

  // Una sola fuente de identidad: si se creó en Obuma, el código de Obuma ES el "SKU propio" — no
  // se guardan dos códigos distintos para el mismo producto.
  const skuPropioFinal = (datos.crearEnObuma && obumaCodigoComercial ? obumaCodigoComercial : datos.skuPropio?.trim()) || '';
  if (!skuPropioFinal) throw new Error('Falta el SKU propio.');

  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_sku (negocio_id, producto_id, sku_propio, sku_proveedor, proveedor_nombre, marca, modelo, obuma_producto_id, obuma_codigo_comercial, verificado_obuma, creado_por, creado_por_nombre, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE sku_propio=VALUES(sku_propio), sku_proveedor=VALUES(sku_proveedor), proveedor_nombre=VALUES(proveedor_nombre),
       marca=VALUES(marca), modelo=VALUES(modelo), obuma_producto_id=VALUES(obuma_producto_id),
       obuma_codigo_comercial=VALUES(obuma_codigo_comercial), verificado_obuma=VALUES(verificado_obuma)`,
    [negocioId, productoId, skuPropioFinal.slice(0, 80), datos.skuProveedor?.trim() || null,
     datos.proveedorNombre?.trim() || null, datos.marca?.trim() || null, datos.modelo?.trim() || null,
     obumaProductoId, obumaCodigoComercial, verificadoObuma ? 1 : 0, actorId, actorNombre, ahora],
  ) as any;
  await registrarEvento({
    tipo: 'COMPRAS_SKU_CREADO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se creó el SKU "${skuPropioFinal}"${datos.marca ? ` (${datos.marca}${datos.modelo ? ` ${datos.modelo}` : ''})` : ''}`
      + (datos.crearEnObuma ? ` — creado en Obuma con código ${obumaCodigoComercial}.` : '.'),
    metadata: { negocio_id: negocioId, producto_id: productoId, sku: skuPropioFinal, obuma_producto_id: obumaProductoId },
  });
  if (r.insertId) return r.insertId as number;
  const [rows] = await pool.query(`SELECT id FROM compras_sku WHERE producto_id = ?`, [productoId]) as any;
  return (rows as any[])[0]?.id;
}

export interface VerificacionObuma { existe: boolean; codigoComercial: string | null }

/** Obuma no avisa a Licitank cuando alguien borra o edita un producto directamente ahí (no hay
 *  webhook conectado) — el vínculo local (`obuma_producto_id`/`obuma_codigo_comercial`) puede
 *  quedar mintiendo. Esto releé el producto en vivo: si ya no existe, limpia el vínculo local (en
 *  vez de seguir mostrando "Creado en Obuma" de algo que ya no está); si existe pero el código
 *  cambió (alguien lo editó en Obuma), se actualiza el código local también — nunca se asume que lo
 *  que quedó guardado hace tiempo sigue siendo cierto. */
export async function verificarVinculoObuma(negocioId: number, skuId: number, actorId: number, actorNombre: string | null): Promise<VerificacionObuma> {
  const [rows] = await pool.query(
    `SELECT id, producto_id, sku_propio, obuma_producto_id FROM compras_sku WHERE id = ? AND negocio_id = ? LIMIT 1`,
    [skuId, negocioId],
  ) as any;
  const sku = (rows as any[])[0];
  if (!sku) throw new Error('SKU no encontrado.');
  if (!sku.obuma_producto_id) throw new Error('Este SKU no está vinculado a Obuma.');

  const r = await listarProductosObuma({ id: String(sku.obuma_producto_id) });
  const producto = r.data?.[0];

  if (!producto) {
    await pool.query(
      `UPDATE compras_sku SET obuma_producto_id = NULL, obuma_codigo_comercial = NULL, verificado_obuma = 0 WHERE id = ?`,
      [skuId],
    );
    await registrarEvento({
      tipo: 'COMPRAS_SKU_OBUMA_DESVINCULADO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
      mensaje: `Se desvinculó el SKU "${sku.sku_propio}" de Obuma — el producto ${sku.obuma_producto_id} ya no existe ahí (borrado o inaccesible).`,
      metadata: { negocio_id: negocioId, sku_id: skuId, obuma_producto_id_anterior: sku.obuma_producto_id },
    });
    return { existe: false, codigoComercial: null };
  }

  const codigoActual = String(producto.producto_codigo_comercial);
  await pool.query(`UPDATE compras_sku SET obuma_codigo_comercial = ?, verificado_obuma = 1 WHERE id = ?`, [codigoActual, skuId]);
  return { existe: true, codigoComercial: codigoActual };
}
