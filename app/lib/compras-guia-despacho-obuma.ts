// app/lib/compras-guia-despacho-obuma.ts
// Guía de despacho (DTE 52) en Obuma, armada con las líneas de una OC de Obuma (ya traen el SKU/producto del proveedor).
// Se crea con POST /ventasIntegracionExternas.create.json, venta_tipo_dcto = 52 (obuma.cl/ayuda/articulo/141, 13-nov-2026):
// Obuma pone el folio, la timbra y la manda al SII → es un documento tributario REAL. Siempre se ve un borrador antes,
// y la creación la confirma una persona en pantalla. Con OBUMA_SIMULAR=1 no se envía nada.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import {
  listarComprasOcItems, listarBodegasObuma, listarSucursalesObuma, listarRegionesComunasObuma, ultimasGuiasObuma,
  crearVentaIntegracionExterna, clientesObumaCompleto, centrosDeCostoCompleto, buscarCentroCostoPorLicitacion,
} from '@/app/lib/obuma';

// Precio de cada línea = precio de VENTA neto del costeo/acta (compras_producto.monto_unitario, el mismo que se manda al crear el SKU),
// NO el precio de compra de la OC (dueño, 13-nov-2026). Vínculo OC→producto del negocio: compras_sku.obuma_producto_id / código comercial.
export interface LineaGuia {
  productoIdObuma: string; sku: string | null; nombre: string; cantidad: number;
  precioCompraNeto: number;                    // referencia: lo que se paga al proveedor en la OC
  precioNeto: number | null;                   // precio de venta neto (costeo o escrito a mano); null = falta
  origenPrecio: 'costeo' | 'manual' | null;
  subtotalNeto: number;
}
export interface GuiaDespachoBorrador { folioOc: string; lineas: LineaGuia[]; totalNeto: number; faltanPrecios: number }

/** Lo que se escribe/corrige en el borrador. Todo viene prellenado; nada se inventa. */
export interface DatosGuia {
  clienteRut: string; clienteRazonSocial: string; clienteGiro: string; clienteDireccion: string;
  clienteComuna: string; clienteRegion: string; clienteEmail: string; clienteTelefono: string; clienteContacto: string;
  direccionDespacho: string;
  bodegaCodigo: string;
  tipoTraslado: number;        // 1 operación de venta … 7 devolución
  tipoDespacho: number;        // 1 por cuenta del cliente, 2 emisor a instalaciones del cliente, 3 emisor a otras instalaciones
  choferRut: string; choferNombre: string; patente: string;
  rebajarStock: boolean;
  observacion: string;
}

/** Precio de venta neto por producto de Obuma, sacado del costeo del negocio. */
async function preciosVentaDelNegocio(negocioId: number): Promise<{ porId: Map<string, number>; porCodigo: Map<string, number> }> {
  const [rows] = await pool.query(
    `SELECT s.obuma_producto_id, s.obuma_codigo_comercial, p.monto_unitario
       FROM compras_sku s JOIN compras_producto p ON p.id = s.producto_id AND p.negocio_id = s.negocio_id
      WHERE s.negocio_id = ? AND p.monto_unitario > 0`,
    [negocioId],
  ) as any;
  const porId = new Map<string, number>(), porCodigo = new Map<string, number>();
  for (const r of rows as any[]) {
    const v = Math.round(Number(r.monto_unitario));
    if (r.obuma_producto_id) porId.set(String(r.obuma_producto_id), v);
    if (r.obuma_codigo_comercial) porCodigo.set(String(r.obuma_codigo_comercial), v);
  }
  return { porId, porCodigo };
}

/** Borrador de la guía: productos, SKU y cantidades de la OC de Obuma; precios de venta del costeo.
 *  `preciosManual` (por productoIdObuma) solo rellena las líneas que el costeo no trae: nunca pisa el precio del costeo. */
export async function armarGuiaDesdeOcObuma(negocioId: number, folioOc: string, preciosManual: Record<string, unknown> = {}): Promise<GuiaDespachoBorrador> {
  const folio = String(folioOc || '').trim();
  if (!folio) throw new Error('Falta el folio de la orden de compra.');
  const [r, ventas] = await Promise.all([listarComprasOcItems({ folio_dcto: folio, limit: 500 }), preciosVentaDelNegocio(negocioId)]);
  // folio_dcto podría no filtrar en esta cuenta (patrón ya visto en otros endpoints): se vuelve a filtrar acá.
  const items = (r.data || []).filter(i => String(i.compra_oc_folio) === folio);
  if (!items.length) throw new Error(`Obuma no devolvió ítems para la OC ${folio}.`);
  const lineas: LineaGuia[] = items.map(i => {
    const cantidad = Number(i.cantidad) || 0;
    const productoIdObuma = String(i.producto_id);
    const sku = i.codigo_comercial ? String(i.codigo_comercial) : null;   // en Obuma el SKU es `codigo_comercial` (OC 4054: 6027000230)
    const delCosteo = ventas.porId.get(productoIdObuma) ?? (sku ? ventas.porCodigo.get(sku) : undefined) ?? null;
    const manual = Math.round(Number(preciosManual[productoIdObuma]));
    const precioNeto = delCosteo ?? (manual > 0 ? manual : null);
    return {
      productoIdObuma, sku, nombre: String(i.producto_nombre || '').trim(), cantidad,
      precioCompraNeto: Math.round(Number(i.precio) || 0),
      precioNeto, origenPrecio: delCosteo != null ? 'costeo' : precioNeto != null ? 'manual' : null,
      subtotalNeto: precioNeto != null ? Math.round(cantidad * precioNeto) : 0,
    };
  });
  return {
    folioOc: folio, lineas,
    totalNeto: lineas.reduce((s, l) => s + l.subtotalNeto, 0),
    faltanPrecios: lineas.filter(l => l.precioNeto == null).length,
  };
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(region|región)\s+(de\s+(la\s+|los\s+)?|del\s+)?/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
const rutLimpio = (s: string) => String(s || '').replace(/[^0-9kK]/g, '').toUpperCase();

async function licitacionDelNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo || null;
}

/** Datos sugeridos para el borrador: cliente = comprador de la OC de Mercado Público (lo mismo que va en la factura),
 *  bodega = la que usaron las últimas guías emitidas en Obuma. Lo que no se encuentra queda vacío para escribirlo. */
export async function datosSugeridosGuia(negocioId: number): Promise<{ datos: DatosGuia; bodegas: { codigo: string; nombre: string }[]; avisos: string[] }> {
  const avisos: string[] = [];
  const codigo = await licitacionDelNegocio(negocioId);
  const { ordenesDeLicitacion } = await import('@/app/lib/ordenes-compra');   // dinámico: evita ciclos de importación
  const ocMp = codigo ? (await ordenesDeLicitacion(codigo).catch(() => [])).find(o => o.esNuestra && o.facturacion) : undefined;
  const f = ocMp?.facturacion;
  if (!f) avisos.push('No encontré la OC de Mercado Público de este negocio: escribe los datos del cliente.');

  const [bodegas, guias, clientes] = await Promise.all([
    listarBodegasObuma(), ultimasGuiasObuma(10).catch(() => []), f?.rut ? clientesObumaCompleto().catch(() => []) : Promise.resolve([]),
  ]);
  const activas = bodegas.filter(b => b.activa && b.codigo);
  const usada = guias.map(g => activas.find(b => b.id === g.bodegaId)).find(Boolean);
  // La OC de Mercado Público a veces no trae email/teléfono (2736-443-SE26): se completan con la ficha del cliente en Obuma, si existe.
  const cObuma = f?.rut ? clientes.find(c => rutLimpio(String(c.cliente_rut)) === rutLimpio(f.rut!)) : undefined;
  const deObuma = (k: string) => { const v = String(cObuma?.[k] ?? '').trim(); return v && v !== '0' && v !== '-' ? v : ''; };

  return {
    datos: {
      clienteRut: f?.rut || '', clienteRazonSocial: f?.razonSocial || '', clienteGiro: f?.giro || deObuma('cliente_giro_comercial'),
      clienteDireccion: f?.direccion || '', clienteComuna: f?.comuna || '', clienteRegion: f?.region || '',
      clienteEmail: f?.contactoMail || deObuma('cliente_email'),
      clienteTelefono: f?.contactoFono || deObuma('cliente_telefono') || deObuma('cliente_celular'),
      clienteContacto: f?.contactoNombre || deObuma('cliente_contacto'),
      direccionDespacho: f?.direccionDespacho || f?.direccion || '',
      bodegaCodigo: usada?.codigo || '',
      tipoTraslado: 1, tipoDespacho: 2,
      choferRut: '', choferNombre: '', patente: '',
      rebajarStock: false,
      observacion: ocMp ? `OC Mercado Público ${ocMp.codigo}` : '',
    },
    bodegas: activas.map(b => ({ codigo: b.codigo, nombre: b.nombre })),
    avisos,
  };
}

/** JSON exacto que se manda a Obuma + lo que falta para poder mandarlo. */
export async function armarDocumentoGuia(negocioId: number, g: GuiaDespachoBorrador, d: DatosGuia): Promise<{ doc: Record<string, unknown>; faltan: string[]; clienteEnObuma: boolean }> {
  const faltan: string[] = [];
  if (g.faltanPrecios > 0) faltan.push(`${g.faltanPrecios} precio(s) de venta`);
  const req: Array<[keyof DatosGuia, string]> = [
    ['clienteRut', 'RUT del cliente'], ['clienteRazonSocial', 'razón social'], ['clienteGiro', 'giro'], ['clienteDireccion', 'dirección'],
    ['clienteEmail', 'email del cliente'], ['clienteTelefono', 'teléfono del cliente'], ['clienteContacto', 'contacto del cliente'],
    ['bodegaCodigo', 'bodega'], ['choferRut', 'RUT del chofer'], ['choferNombre', 'nombre del chofer'], ['patente', 'patente'],
  ];
  for (const [k, nombre] of req) if (!String(d[k] ?? '').trim()) faltan.push(nombre);

  const [{ regiones, comunas }, bodegas, sucursales, clientes] = await Promise.all([
    listarRegionesComunasObuma(), listarBodegasObuma(), listarSucursalesObuma(), clientesObumaCompleto().catch(() => []),
  ]);
  // Mercado Público dice «Región de la Araucanía»; Obuma puede decir «Araucania» o «La Araucania»: exacto primero, si no, contención.
  const rBus = sinTildes(d.clienteRegion);
  const region = regiones.find(r => sinTildes(r.nombre) === rBus)
    ?? (rBus.length > 3 ? regiones.find(r => { const n = sinTildes(r.nombre); return n.length > 3 && (rBus.includes(n) || n.includes(rBus)); }) : undefined);
  const candidatasComuna = comunas.filter(c => sinTildes(c.nombre) === sinTildes(d.clienteComuna));
  const comuna = candidatasComuna.find(c => !region || c.regionId === region.id) ?? candidatasComuna[0];
  if (!comuna) faltan.push(`comuna «${d.clienteComuna || 'vacía'}» (no está en el listado de Obuma)`);
  if (!region) faltan.push(`región «${d.clienteRegion || 'vacía'}» (no está en el listado de Obuma)`);
  const bodega = bodegas.find(b => b.codigo === d.bodegaCodigo);
  if (d.bodegaCodigo && !bodega) faltan.push(`bodega ${d.bodegaCodigo} (no existe en Obuma)`);
  const sucursal = bodega ? sucursales.find(s => s.id === bodega.sucursalId) : undefined;
  const clienteEnObuma = clientes.some(c => rutLimpio(String(c.cliente_rut)) === rutLimpio(d.clienteRut));

  const codigo = await licitacionDelNegocio(negocioId);
  const cc = codigo ? await buscarCentroCostoPorLicitacion(codigo).catch(() => null) : null;
  const ccCodigo = cc ? ((await centrosDeCostoCompleto().catch(() => [])).find(c => c.id === cc.id)?.codigo || '') : '';

  const neto = g.lineas.reduce((s, l) => s + l.subtotalNeto, 0);
  const iva = Math.round(neto * 0.19);
  const hoy = ahoraChileSQL().slice(0, 10);
  const doc: Record<string, unknown> = {
    venta_tipo_dcto: 52,
    venta_nro_dcto: '',
    venta_fecha: hoy,
    venta_fecha_vencimiento: hoy,
    ...(sucursal?.codigo ? { venta_sucursal: sucursal.codigo } : {}),
    venta_bodega: d.bodegaCodigo,
    ...(ccCodigo ? { venta_centro_costo: ccCodigo } : {}),
    venta_subtotal: String(neto),
    venta_exento: '0',
    venta_neto: String(neto),
    venta_iva: String(iva),
    venta_total: String(neto + iva),
    venta_total_pagado: 0,
    venta_total_por_pagar: 0,
    venta_guia_tipo_traslado: d.tipoTraslado,
    venta_guia_tipo_despacho: d.tipoDespacho,
    // Chofer y patente: no están en la doc del create; son los nombres con que Obuma los guarda (ventas.list.json de una guía real, 13-nov).
    venta_guia_rut_chofer: d.choferRut.trim(),
    venta_guia_nombre_chofer: d.choferNombre.trim(),
    venta_guia_patente: d.patente.trim().toUpperCase(),
    ...(d.direccionDespacho.trim() ? { venta_direccion_despacho: d.direccionDespacho.trim() } : {}),
    venta_rebajar_stock: d.rebajarStock ? 1 : 0,
    cliente_rut: d.clienteRut.trim(),
    cliente_razon_social: d.clienteRazonSocial.trim(),
    cliente_direccion: d.clienteDireccion.trim(),
    cliente_comuna: comuna?.id ?? '',
    cliente_region: region?.id ?? '',
    cliente_giro: d.clienteGiro.trim(),
    cliente_email: d.clienteEmail.trim(),
    cliente_telefono: d.clienteTelefono.trim(),
    cliente_contacto: d.clienteContacto.trim(),
    venta_observacion: [`Guía desde OC Obuma ${g.folioOc}`, d.observacion.trim()].filter(Boolean).join(' · '),
    venta_detalle: g.lineas.map(l => ({
      producto_nombre: l.nombre,
      codigo_comercial: l.sku ?? '',
      cantidad: String(l.cantidad),
      producto_precio: String(l.precioNeto ?? 0),
      descuento: '0',
      descuento_monto: '0',
      subtotal: String(l.subtotalNeto),
      producto_exento: '0',
    })),
  };
  return { doc, faltan, clienteEnObuma };
}

/** Envía la guía a Obuma (documento tributario real). Con OBUMA_SIMULAR=1 solo lo deja en el log. */
export async function crearGuiaDespachoObuma(doc: Record<string, unknown>, permitirRepetida: boolean): Promise<{ simulada: boolean; folio: string | null; pdf: string | null; detalle: string }> {
  if (process.env.OBUMA_SIMULAR === '1') {
    console.warn('[obuma][SIMULADO] ventasIntegracionExternas.create guía 52', JSON.stringify(doc).slice(0, 1500));
    return { simulada: true, folio: `SIM-GUIA-${Date.now() % 100000}`, pdf: null, detalle: 'Simulación: no se envió nada a Obuma.' };
  }
  // Freno al doble clic / doble envío: una guía de hoy con el mismo neto ya emitida en Obuma.
  if (!permitirRepetida) {
    const hoy = String(doc.venta_fecha);
    const repetida = (await ultimasGuiasObuma(20).catch(() => [])).find(x => x.fechaIngreso.startsWith(hoy) && x.neto === Number(doc.venta_neto));
    if (repetida) throw new Error(`REPETIDA: hoy ya se emitió la guía ${repetida.folio} con el mismo neto. Revísala en Obuma antes de crear otra.`);
  }
  try {
    const r = await crearVentaIntegracionExterna(doc);
    return { simulada: false, ...r };
  } catch (e: any) {
    // mensajeSeguro oculta textos de más de 300 caracteres: se recorta para que el equipo vea la causa real (ej. «112 Error no hay CAF»).
    console.error('[obuma][guía 52] falló:', String(e?.message || e).slice(0, 1500));
    throw new Error(`Obuma rechazó la guía: ${String(e?.message || e).replace(/^Obuma\s+\S+:\s*/, '')}`.slice(0, 280));
  }
}

// Obuma de Grupo ICA funciona solo con Inversiones Claro (dueño, 13-nov-2026): las guías se ofrecen únicamente en sus negocios.
const RUT_CLARO = '769026592';
export async function negocioEsDeClaro(negocioId: number): Promise<boolean> {
  const [rows] = await pool.query(`SELECT e.rut FROM negocios n JOIN empresas e ON e.id = n.empresa_id WHERE n.id = ? LIMIT 1`, [negocioId]) as any;
  return String((rows as any[])[0]?.rut || '').replace(/[^0-9kK]/g, '').toUpperCase() === RUT_CLARO;
}

/** OC del negocio con folio de Obuma (las que sirven de base para una guía). */
export async function ocsParaGuia(negocioId: number): Promise<{ folio: string; proveedor: string; total: number; lineas: number }[]> {
  const { ordenesCompraParaVista } = await import('@/app/lib/compras-oc-obuma');   // dinámico: evita ciclos de importación
  const ocs = await ordenesCompraParaVista(negocioId);
  return ocs.filter(o => o.folio).map(o => ({ folio: String(o.folio), proveedor: o.proveedorNombre, total: o.total, lineas: o.items.length }));
}
