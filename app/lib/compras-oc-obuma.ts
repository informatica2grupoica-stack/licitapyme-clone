// app/lib/compras-oc-obuma.ts
// ÓRDENES DE COMPRA REALES CONTRA OBUMA (spec §11.1). Hasta el 10-sep-2026 "Orden de compra
// emitida" era un checkbox marcado a mano — el §11.1 dice "el módulo controla y registra el
// estado, no los ejecuta", pero soporte de Obuma confirmó por correo que /comprasOc.create.json
// SÍ permite crear la OC de verdad desde la API. Esto la ejecuta.
//
// UNA OC POR PROVEEDOR (pedido explícito del usuario): el escenario elegido (compras-auditor.ts)
// ya sabe qué proveedor quedó asignado a cada producto — acá se agrupa por proveedor y se arma una
// orden de compra separada para cada uno, nunca mezclando ítems de proveedores distintos.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { obtenerAprobaciones, obtenerEscenarioElegido } from '@/app/lib/compras-aprobaciones';
import { marcarHitoReparto } from '@/app/lib/compras-reparto';
import {
  crearOrdenCompraObuma, listarFormasPago, proveedorPorRut, crearProveedorObuma, buscarCentroCostoPorLicitacion,
  type ObumaFormaPago, type DatosCrearProveedorObuma,
} from '@/app/lib/obuma';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export interface ItemOrdenCompra {
  productoId: number; descripcion: string; cantidad: number; precioUnitario: number; subtotal: number;
  obumaProductoId: string | null; obumaCodigoComercial: string | null;
}
export interface ProveedorOrdenCompra {
  proveedorNombre: string; proveedorId: number | null; proveedorRut: string | null;
  proveedorDireccion: string | null; proveedorComuna: string | null; proveedorEmail: string | null; proveedorTelefono: string | null;
  proveedorGiro: string | null; proveedorContacto: string | null;
  items: ItemOrdenCompra[]; subtotal: number;
  yaCreada: { obumaCompraOcId: string; folio: string | null; total: number; fechaOc: string } | null;
}

/** Del escenario ELEGIDO (no cualquiera — el que de verdad se va a comprar), agrupa por proveedor.
 *  Cruza cada ítem con su SKU (si ya está homologado con Obuma, la OC queda enlazada al mismo
 *  producto del catálogo — spec §7, no a un texto suelto) y con el catálogo de proveedores (para
 *  la ficha: RUT, dirección, contacto) usando el mismo proveedor_id que ya quedó guardado en la
 *  cotización que ganó ese ítem — no se adivina por nombre. */
export async function proveedoresParaOrdenCompra(negocioId: number): Promise<ProveedorOrdenCompra[]> {
  const escenario = await obtenerEscenarioElegido(negocioId);
  if (!escenario) return [];
  let detalle: any = null;
  try { detalle = typeof escenario.detalle_json === 'string' ? JSON.parse(escenario.detalle_json) : escenario.detalle_json; } catch { /* detalle inválido, se trata como vacío */ }
  const porProducto: Array<{ productoId: number; descripcion: string; proveedor: string | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null }> = detalle?.porProducto || [];
  const cubiertos = porProducto.filter(p => p.proveedor && p.precioUnitario != null);
  if (cubiertos.length === 0) return [];

  const productoIds = cubiertos.map(p => p.productoId);
  const [skuRows] = await pool.query(
    `SELECT producto_id, obuma_producto_id, obuma_codigo_comercial FROM compras_sku
      WHERE negocio_id = ? AND producto_id IN (${productoIds.map(() => '?').join(',')})`,
    [negocioId, ...productoIds],
  ) as any;
  const skuPorProducto = new Map<number, { obumaProductoId: string | null; obumaCodigoComercial: string | null }>(
    (skuRows as any[]).map(r => [r.producto_id, { obumaProductoId: r.obuma_producto_id, obumaCodigoComercial: r.obuma_codigo_comercial }]),
  );

  // proveedor_id/rut reales: los que YA quedaron guardados en la cotización que ganó — es la fuente
  // de verdad de a quién se le está comprando, no un texto libre que puede escribirse distinto.
  const [cotRows] = await pool.query(
    `SELECT proveedor_nombre, proveedor_id, proveedor_rut FROM compras_cotizacion WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const fichaPorNombre = new Map<string, { proveedorId: number | null; rut: string | null }>();
  for (const c of cotRows as any[]) fichaPorNombre.set(c.proveedor_nombre, { proveedorId: c.proveedor_id, rut: c.proveedor_rut });

  const idsProveedor = [...new Set([...fichaPorNombre.values()].map(f => f.proveedorId).filter((v): v is number => v != null))];
  const fichaCompleta = new Map<number, { direccion: string | null; comuna: string | null; email: string | null; telefono: string | null; giro: string | null; contacto: string | null }>();
  if (idsProveedor.length) {
    const [provRows] = await pool.query(
      `SELECT id, direccion, comuna, correo, telefono, giro, contacto_nombre FROM compras_proveedor WHERE id IN (${idsProveedor.map(() => '?').join(',')})`,
      idsProveedor,
    ) as any;
    for (const p of provRows as any[]) fichaCompleta.set(p.id, { direccion: p.direccion, comuna: p.comuna, email: p.correo, telefono: p.telefono, giro: p.giro, contacto: p.contacto_nombre });
  }

  const [ocRows] = await pool.query(
    `SELECT proveedor_nombre, obuma_compra_oc_id, obuma_folio, total_neto, DATE_FORMAT(fecha_oc, '%Y-%m-%d') AS fecha_oc
       FROM compras_orden_compra_obuma WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const ocPorProveedor = new Map<string, { obumaCompraOcId: string; folio: string | null; total: number; fechaOc: string }>(
    (ocRows as any[]).map(r => [r.proveedor_nombre, { obumaCompraOcId: r.obuma_compra_oc_id, folio: r.obuma_folio, total: Number(r.total_neto), fechaOc: r.fecha_oc }]),
  );

  const grupos = new Map<string, ProveedorOrdenCompra>();
  for (const p of cubiertos) {
    const nombre = p.proveedor as string;
    const ficha = fichaPorNombre.get(nombre) || { proveedorId: null, rut: null };
    const extra = ficha.proveedorId != null ? fichaCompleta.get(ficha.proveedorId) : undefined;
    const sku = skuPorProducto.get(p.productoId);
    if (!grupos.has(nombre)) {
      grupos.set(nombre, {
        proveedorNombre: nombre, proveedorId: ficha.proveedorId, proveedorRut: ficha.rut,
        proveedorDireccion: extra?.direccion ?? null, proveedorComuna: extra?.comuna ?? null,
        proveedorEmail: extra?.email ?? null, proveedorTelefono: extra?.telefono ?? null,
        proveedorGiro: extra?.giro ?? null, proveedorContacto: extra?.contacto ?? null,
        items: [], subtotal: 0, yaCreada: ocPorProveedor.get(nombre) ?? null,
      });
    }
    const grupo = grupos.get(nombre)!;
    const subtotal = p.subtotal ?? 0;
    grupo.items.push({
      productoId: p.productoId, descripcion: p.descripcion, cantidad: p.cantidad ?? 1,
      precioUnitario: p.precioUnitario as number, subtotal,
      obumaProductoId: sku?.obumaProductoId ?? null, obumaCodigoComercial: sku?.obumaCodigoComercial ?? null,
    });
    grupo.subtotal += subtotal;
  }
  return [...grupos.values()];
}

export async function formasDePagoObuma(): Promise<ObumaFormaPago[]> {
  return listarFormasPago();
}

export interface FichaProveedorObuma {
  proveedorId: string; rut: string; razonSocial: string; direccion: string | null; comuna: string | null;
  telefono: string | null; email: string | null; giro: string | null; contacto: string | null;
}

/** Pedido explícito del usuario: la creación del proveedor en Obuma NUNCA es automática — se
 *  verifica por RUT, y si no existe, la UI ofrece un botón que abre un formulario con TODOS los
 *  campos reales de Obuma para que la persona decida qué llenar y lo cree a mano (ver
 *  crearProveedorEnObumaExplicito). Esto solo verifica, nunca escribe. */
export async function verificarProveedorEnObuma(rut: string): Promise<FichaProveedorObuma | null> {
  const p = await proveedorPorRut(rut);
  if (!p) return null;
  return {
    proveedorId: p.proveedor_id, rut, razonSocial: p.proveedor_razon_social,
    direccion: p.proveedor_direccion || null, comuna: p.proveedor_comuna || null,
    telefono: (p.proveedor_telefono as string) || null, email: (p.proveedor_email as string) || null,
    giro: p.proveedor_giro_comercial || null, contacto: p.proveedor_contacto || null,
  };
}

/** Crea el proveedor en Obuma — escritura real, disparada SOLO por una acción explícita de la
 *  persona en el modal (nunca desde `crearOrdenCompraParaProveedor`). */
export async function crearProveedorEnObumaExplicito(datos: DatosCrearProveedorObuma): Promise<{ proveedorId: string }> {
  return crearProveedorObuma(datos);
}

/** Crea la OC de verdad en Obuma para UN proveedor del escenario elegido (spec §11.1, escritura
 *  real — nunca se llama sin que un humano lo haya pedido explícitamente). Se habilita con el
 *  mismo criterio que el SKU: recién con la Compuerta 1 (compra) aprobada, porque antes de eso no
 *  hay compra real que emitir. */
export async function crearOrdenCompraParaProveedor(
  negocioId: number, proveedorNombre: string,
  opciones: { formaPagoId: string; incluirFlete: boolean; fleteMonto: number | null },
  actorId: number, actorNombre: string | null,
): Promise<{ obumaCompraOcId: string; folio: string | null; total: number }> {
  const { compra } = await obtenerAprobaciones(negocioId);
  if (!compra || !['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(compra.estado)) {
    throw new Error('La orden de compra se emite después de aprobada la Compuerta 1 (Aprobación de compra) — spec §11.1.');
  }

  const grupos = await proveedoresParaOrdenCompra(negocioId);
  const grupo = grupos.find(g => g.proveedorNombre === proveedorNombre);
  if (!grupo) throw new Error('Ese proveedor no tiene ítems en el escenario elegido.');
  if (grupo.yaCreada) throw new Error(`Ya existe una orden de compra para este proveedor en Obuma (folio ${grupo.yaCreada.folio ?? grupo.yaCreada.obumaCompraOcId}).`);
  if (opciones.incluirFlete && !(opciones.fleteMonto! > 0)) throw new Error('Falta el monto del flete.');

  const licitacionCodigo = await licitacionDeNegocio(negocioId);
  const fecha = ahoraChileSQL().slice(0, 10);

  // El proveedor tiene que YA estar registrado en Obuma antes de emitir la OC — pedido explícito:
  // la creación del proveedor NUNCA es automática, la persona la hace a mano desde el modal (ver
  // verificarProveedorEnObuma/crearProveedorEnObumaExplicito). Acá solo se comprueba, no se crea.
  if (!grupo.proveedorRut?.trim()) throw new Error('Este proveedor no tiene RUT registrado — complétalo en Proveedores antes de emitir la orden de compra.');
  const ficha = await verificarProveedorEnObuma(grupo.proveedorRut);
  if (!ficha) throw new Error('Este proveedor todavía no está creado en Obuma — créalo primero con el botón "Crear proveedor en Obuma".');

  // Centro de costo real, si esta licitación ya tiene un Proyecto armado en Obuma (ver
  // buscarCentroCostoPorLicitacion) — si no lo tiene, se omite del payload sin bloquear la OC.
  const centroCosto = licitacionCodigo ? await buscarCentroCostoPorLicitacion(licitacionCodigo).catch(() => null) : null;

  const creada = await crearOrdenCompraObuma({
    proveedorRut: ficha.rut || null, proveedorRazonSocial: ficha.razonSocial,
    proveedorDireccion: ficha.direccion, proveedorComuna: ficha.comuna,
    proveedorEmail: ficha.email, proveedorTelefono: ficha.telefono,
    fecha, formaPagoId: opciones.formaPagoId,
    referencia: licitacionCodigo || `negocio-${negocioId}`,
    concepto: `Compra para licitación ${licitacionCodigo || negocioId}`,
    centroCostoId: centroCosto?.id ?? null,
    items: grupo.items.map(it => ({
      productoIdObuma: it.obumaProductoId, codigoComercial: it.obumaCodigoComercial,
      nombre: it.descripcion, cantidad: it.cantidad, precioUnitarioNeto: it.precioUnitario,
    })),
    fleteMonto: opciones.incluirFlete ? opciones.fleteMonto : null,
  });

  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO compras_orden_compra_obuma
       (negocio_id, proveedor_id, proveedor_nombre, proveedor_rut, obuma_compra_oc_id, obuma_folio, items_json,
        incluye_flete, flete_monto, subtotal_neto, total_neto, forma_pago_codigo, forma_pago_nombre, fecha_oc,
        creado_por, creado_por_nombre, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      negocioId, grupo.proveedorId, grupo.proveedorNombre, grupo.proveedorRut,
      creada.compraOcId, creada.folio, JSON.stringify(grupo.items),
      opciones.incluirFlete ? 1 : 0, opciones.incluirFlete ? opciones.fleteMonto : null,
      creada.subtotalNeto, creada.total, opciones.formaPagoId, null, fecha,
      actorId, actorNombre, ahora,
    ],
  );

  await registrarEvento({
    tipo: 'COMPRAS_OC_OBUMA_CREADA', licitacionCodigo, actorId, actorNombre,
    mensaje: `Se creó la orden de compra en Obuma para "${grupo.proveedorNombre}" — folio ${creada.folio ?? creada.compraOcId}, ${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(creada.total)}.`,
    metadata: { negocio_id: negocioId, proveedor: grupo.proveedorNombre, obuma_compra_oc_id: creada.compraOcId },
  });

  // Refleja el hito del checklist (§11) con TODOS los folios emitidos hasta ahora para este
  // negocio — puede haber más de una OC (una por proveedor), el checklist muestra el resumen.
  const [todas] = await pool.query(
    `SELECT COALESCE(obuma_folio, obuma_compra_oc_id) AS ref FROM compras_orden_compra_obuma WHERE negocio_id = ? ORDER BY created_at`,
    [negocioId],
  ) as any;
  const resumenFolios = (todas as any[]).map(r => r.ref).join(', ');
  await marcarHitoReparto(negocioId, 'ocEmitida', { activo: true, ocNumero: resumenFolios }, actorId, actorNombre);

  return { obumaCompraOcId: creada.compraOcId, folio: creada.folio, total: creada.total };
}
