// app/lib/compras-oc-propia.ts
// ÓRDENES DE COMPRA PROPIAS (migration-180, pedido del dueño 05-nov-2026).
// Obuma es solo de Inversiones Claro. Cuando el negocio es de una empresa del grupo que NO está en Obuma (Comercial MP) y la
// mercadería la tiene Inversiones Claro, Comercial MP le emite la OC desde Licitank: folio propio (MP-2026-0001), mismo PDF que
// imprime Obuma pero con el logo de Comercial MP. Como Comercial MP no recibe facturas por Obuma, la factura de Inversiones Claro
// se sube a mano y se empareja con la OC (ver compras-oc-propia-factura.ts).
//
// Tributario: entre empresas relacionadas el precio debe ser de mercado (art. 64 Código Tributario), por eso el formulario
// propone el costo del escenario elegido (lo que le cuesta a Inversiones Claro) y se puede corregir. IVA 19 % sobre el neto.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { listarProductosCompra } from '@/app/lib/compras';
import { costosEscenarioPorProducto } from '@/app/lib/compras-aprobaciones';
import type { OcDocumento } from '@/app/lib/compras-oc-documento';
import { parsearFacturaXml, type FacturaLeida } from '@/app/lib/factura-xml';
import { emparejarFacturaConOc, rutComparable, type ResultadoEmparejo } from '@/app/lib/compras-oc-propia-factura';

export const IVA_OC_PROPIA = 0.19;

/** Empresas del grupo que emiten OC desde Licitank (por RUT, no por id: el id cambia entre bases). Proveedor por defecto = Inversiones Claro. */
const EMISORES_PROPIOS: Record<string, { prefijo: string; logo: string; proveedorRut: string }> = {
  '783881756': { prefijo: 'MP', logo: 'oc-mp/logo.png', proveedorRut: '76.902.659-2' },
};

interface EmpresaFila { id: number; cliente_id: number; razon_social: string; rut: string; giro: string | null; direccion: string | null; region: string | null; email1: string | null; telefono1: string | null }

export interface EmpresaOc { razonSocial: string; rut: string; giro: string; direccion: string; telefono: string; email: string }
export interface ProveedorOc { nombre: string; rut: string; giro: string | null; direccion: string | null; email: string | null; telefono: string | null }
export interface ItemOcPropia { productoId: number | null; codigo: string | null; descripcion: string; cantidad: number; precio: number }
export type EstadoOcPropia = 'EMITIDA' | 'FACTURADA' | 'ANULADA';

export interface OcPropia {
  id: number; folio: string; estado: EstadoOcPropia; fechaOc: string; fechaEntrega: string | null;
  proveedor: ProveedorOc; items: ItemOcPropia[]; neto: number; iva: number; total: number;
  formaPago: string | null; direccionDespacho: string | null; condiciones: string | null;
  factura: { folio: string | null; fecha: string | null; neto: number | null; total: number | null; url: string | null; nombre: string | null; emparejo: string | null; subidaPor: string | null; subidaAt: string | null } | null;
  anuladaMotivo: string | null; creadoPor: string | null; createdAt: string;
}

export interface ProductoParaOc { productoId: number; codigo: string | null; descripcion: string; cantidad: number; precioSugerido: number | null; origenPrecio: string | null; yaEnOc: string | null }

const aEmpresaOc = (e: EmpresaFila): EmpresaOc => ({
  razonSocial: e.razon_social, rut: e.rut, giro: e.giro || '', direccion: [e.direccion, e.region].filter(Boolean).join(' - '),
  telefono: e.telefono1 || '', email: e.email1 || '',
});
const fechaTxt = (v: unknown) => { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v); return s.startsWith('0000') ? null : s.slice(0, 10); };
const redondear = (n: number) => Math.round(n);

/** La empresa del negocio, si emite OC propias (Comercial MP). null = el negocio va por Obuma como siempre. */
export async function emisorOcPropia(negocioId: number): Promise<{ empresa: EmpresaOc; prefijo: string; logo: string; proveedor: ProveedorOc | null } | null> {
  const [rows] = await pool.query(
    `SELECT e.id, e.cliente_id, e.razon_social, e.rut, e.giro, e.direccion, e.region, e.email1, e.telefono1
       FROM negocios n JOIN empresas e ON e.id = n.empresa_id WHERE n.id = ? LIMIT 1`, [negocioId],
  ) as any;
  const e = (rows as EmpresaFila[])[0];
  const conf = e ? EMISORES_PROPIOS[rutComparable(e.rut)] : undefined;
  if (!e || !conf) return null;
  const [prov] = await pool.query(
    `SELECT id, razon_social, rut, giro, direccion, region, email1, telefono1 FROM empresas WHERE activo = TRUE AND cliente_id = ?`, [e.cliente_id],
  ) as any;
  const p = (prov as EmpresaFila[]).find(x => rutComparable(x.rut) === rutComparable(conf.proveedorRut));
  return {
    empresa: aEmpresaOc(e), prefijo: conf.prefijo, logo: conf.logo,
    proveedor: p ? { nombre: p.razon_social, rut: p.rut, giro: p.giro, direccion: [p.direccion, p.region].filter(Boolean).join(' - ') || null, email: p.email1, telefono: p.telefono1 } : null,
  };
}

function filaAOc(r: any): OcPropia {
  let items: ItemOcPropia[] = [];
  try { items = JSON.parse(r.items_json || '[]'); } catch { /* ítems ilegibles: la OC se muestra sin detalle */ }
  return {
    id: r.id, folio: r.folio, estado: r.estado, fechaOc: fechaTxt(r.fecha_oc) || '', fechaEntrega: fechaTxt(r.fecha_entrega),
    proveedor: { nombre: r.proveedor_nombre, rut: r.proveedor_rut, giro: r.proveedor_giro, direccion: r.proveedor_direccion, email: r.proveedor_email, telefono: r.proveedor_telefono },
    items, neto: Number(r.neto), iva: Number(r.iva), total: Number(r.total),
    formaPago: r.forma_pago, direccionDespacho: r.direccion_despacho, condiciones: r.condiciones,
    factura: r.factura_url || r.factura_folio ? {
      folio: r.factura_folio, fecha: fechaTxt(r.factura_fecha), neto: r.factura_neto != null ? Number(r.factura_neto) : null, total: r.factura_total != null ? Number(r.factura_total) : null,
      url: r.factura_url, nombre: r.factura_nombre, emparejo: r.factura_emparejo, subidaPor: r.factura_subida_por_nombre, subidaAt: r.factura_subida_at ? String(r.factura_subida_at) : null,
    } : null,
    anuladaMotivo: r.anulada_motivo, creadoPor: r.creado_por_nombre, createdAt: String(r.created_at),
  };
}

export async function listarOcPropias(negocioId: number): Promise<OcPropia[]> {
  const [rows] = await pool.query(`SELECT * FROM compras_oc_propia WHERE negocio_id = ? ORDER BY id DESC`, [negocioId]) as any;
  return (rows as any[]).map(filaAOc);
}

export interface OcPropiaConNegocio extends OcPropia { negocioId: number; licitacionCodigo: string | null; licitacionNombre: string | null }

/** Todas las OC propias de una empresa-cliente (menú «OC Comercial MP»), con la licitación de cada una. */
export async function listarTodasOcPropias(clienteId: number): Promise<OcPropiaConNegocio[]> {
  const [rows] = await pool.query(
    `SELECT o.*, n.licitacion_codigo, n.licitacion_nombre
       FROM compras_oc_propia o JOIN negocios n ON n.id = o.negocio_id
      WHERE COALESCE(n.cliente_id, 1) = ? ORDER BY o.id DESC`, [clienteId],
  ) as any;
  return (rows as any[]).map(r => ({ ...filaAOc(r), negocioId: r.negocio_id, licitacionCodigo: r.licitacion_codigo ?? null, licitacionNombre: r.licitacion_nombre ?? null }));
}

/** Negocio de una OC propia, solo si es de esa empresa-cliente (para abrir su PDF desde el menú). */
export async function negocioDeOcPropia(ocId: number, clienteId: number): Promise<number | null> {
  const [rows] = await pool.query(
    `SELECT o.negocio_id FROM compras_oc_propia o JOIN negocios n ON n.id = o.negocio_id WHERE o.id = ? AND COALESCE(n.cliente_id, 1) = ? LIMIT 1`,
    [ocId, clienteId],
  ) as any;
  return (rows as any[])[0]?.negocio_id ?? null;
}

async function leerOc(negocioId: number, ocId: number): Promise<OcPropia> {
  const [rows] = await pool.query(`SELECT * FROM compras_oc_propia WHERE id = ? AND negocio_id = ? LIMIT 1`, [ocId, negocioId]) as any;
  const r = (rows as any[])[0];
  if (!r) throw new Error('Esa orden de compra no es de este negocio.');
  return filaAOc(r);
}

/** Productos vigentes del negocio con su código (SKU) y el precio que se propone: el costo del escenario elegido. */
export async function productosParaOcPropia(negocioId: number): Promise<ProductoParaOc[]> {
  const [productos, costoDe, [skus], ocs] = await Promise.all([
    listarProductosCompra(negocioId),
    costosEscenarioPorProducto(negocioId),
    pool.query(`SELECT producto_id, sku_propio, obuma_codigo_comercial FROM compras_sku WHERE negocio_id = ?`, [negocioId]) as any,
    listarOcPropias(negocioId),
  ]);
  const enOc = new Map<number, string>();
  for (const oc of ocs.filter(o => o.estado !== 'ANULADA')) for (const it of oc.items) if (it.productoId != null) enOc.set(it.productoId, oc.folio);
  return productos
    .filter(p => p.subestado !== 'RENUNCIADO' && p.subestado !== 'NO_ADJUDICADA')
    .map(p => {
      const sku = (skus as any[]).find(s => Number(s.producto_id) === p.id);
      const costo = costoDe(p.id);
      return {
        productoId: p.id, codigo: sku ? (sku.obuma_codigo_comercial || sku.sku_propio || null) : null, descripcion: p.descripcion,
        cantidad: p.cantidad != null && p.cantidad > 0 ? Number(p.cantidad) : 1,
        precioSugerido: costo ? redondear(costo.costoUnitario) : null,
        origenPrecio: costo ? (costo.escenarioTipo === 'COMPRA_RAPIDA' ? 'compra rápida' : `escenario ${costo.escenarioTipo}${costo.proveedorNombre ? ` · ${costo.proveedorNombre}` : ''}`) : null,
        yaEnOc: enOc.get(p.id) ?? null,
      };
    });
}

export interface DatosOcPropia {
  proveedor: ProveedorOc; items: ItemOcPropia[]; fechaEntrega: string | null; formaPago: string | null;
  direccionDespacho: string | null; condiciones: string | null;
}

export async function crearOcPropia(negocioId: number, datos: DatosOcPropia, actorId: number, actorNombre: string | null): Promise<OcPropia> {
  const emisor = await emisorOcPropia(negocioId);
  if (!emisor) throw new Error('Este negocio no es de una empresa que emita órdenes de compra desde Licitank: va por Obuma.');
  const nombre = datos.proveedor?.nombre?.trim(); const rut = datos.proveedor?.rut?.trim();
  if (!nombre || !rut) throw new Error('Falta el nombre y el RUT del proveedor.');
  if (rutComparable(rut) === rutComparable(emisor.empresa.rut)) throw new Error('El proveedor no puede ser la misma empresa que emite la OC.');
  const items = (datos.items || [])
    .map(i => ({ productoId: i.productoId ?? null, codigo: i.codigo?.trim() || null, descripcion: String(i.descripcion || '').trim(), cantidad: Number(i.cantidad), precio: Number(i.precio) }))
    .filter(i => i.descripcion);
  if (items.length === 0) throw new Error('La orden de compra no tiene productos.');
  for (const i of items) {
    if (!(i.cantidad > 0)) throw new Error(`Falta la cantidad de «${i.descripcion}».`);
    if (!(i.precio > 0)) throw new Error(`Falta el precio neto de «${i.descripcion}».`);
  }
  const neto = redondear(items.reduce((s, i) => s + i.cantidad * i.precio, 0));
  const iva = redondear(neto * IVA_OC_PROPIA);
  const ahora = ahoraChileSQL(); const hoy = ahora.slice(0, 10); const anio = Number(hoy.slice(0, 4));
  const empresaRut = rutComparable(emisor.empresa.rut);

  // Folio correlativo por empresa y año. Si dos personas emiten a la vez, la clave única hace fallar a una y se reintenta con el siguiente.
  for (let intento = 0; intento < 5; intento++) {
    const [m] = await pool.query(`SELECT COALESCE(MAX(correlativo), 0) AS ultimo FROM compras_oc_propia WHERE empresa_rut = ? AND anio = ?`, [empresaRut, anio]) as any;
    const correlativo = Number((m as any[])[0]?.ultimo || 0) + 1;
    const folio = `${emisor.prefijo}-${anio}-${String(correlativo).padStart(4, '0')}`;
    try {
      const [r] = await pool.query(
        `INSERT INTO compras_oc_propia (negocio_id, empresa_rut, folio, anio, correlativo, proveedor_nombre, proveedor_rut, proveedor_giro, proveedor_direccion,
           proveedor_email, proveedor_telefono, items_json, neto, iva, total, fecha_oc, fecha_entrega, forma_pago, direccion_despacho, condiciones,
           estado, creado_por, creado_por_nombre, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'EMITIDA',?,?,?)`,
        [negocioId, empresaRut, folio, anio, correlativo, nombre.slice(0, 300), rut.slice(0, 20), datos.proveedor.giro?.trim() || null,
         datos.proveedor.direccion?.trim() || null, datos.proveedor.email?.trim() || null, datos.proveedor.telefono?.trim() || null,
         JSON.stringify(items), neto, iva, neto + iva, hoy, datos.fechaEntrega || null, datos.formaPago?.trim() || null,
         datos.direccionDespacho?.trim() || null, datos.condiciones?.trim() || null, actorId, actorNombre, ahora],
      ) as any;
      await registrarEvento({
        tipo: 'COMPRAS_OC_PROPIA_EMITIDA', licitacionCodigo: await codigoDeNegocio(negocioId), actorId, actorNombre,
        mensaje: `${emisor.empresa.razonSocial} emitió la orden de compra ${folio} a ${nombre}: neto $${neto.toLocaleString('es-CL')} + IVA (${items.length} producto${items.length === 1 ? '' : 's'}).`,
        metadata: { negocio_id: negocioId, oc_propia_id: r.insertId, folio, proveedor_rut: rut, neto },
      });
      return leerOc(negocioId, r.insertId);
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_ENTRY') throw e;
    }
  }
  throw new Error('No se pudo asignar el folio de la orden de compra; vuelve a intentarlo.');
}

async function codigoDeNegocio(negocioId: number): Promise<string | null> {
  const [r] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (r as any[])[0]?.licitacion_codigo ?? null;
}

/** La OC en el formato que dibuja el PDF (el mismo de las OC de Obuma). */
export async function documentoOcPropia(negocioId: number, ocId: number): Promise<{ doc: OcDocumento; logo: string }> {
  const [oc, emisor, codigo] = await Promise.all([leerOc(negocioId, ocId), emisorOcPropia(negocioId), codigoDeNegocio(negocioId)]);
  if (!emisor) throw new Error('Este negocio no emite órdenes de compra desde Licitank.');
  const items = oc.items.map(i => ({ codigo: i.codigo, descripcion: i.descripcion, cantidad: i.cantidad, precio: i.precio, descuento: 0, subtotal: redondear(i.cantidad * i.precio), imagenUrl: null }));
  const doc: OcDocumento = {
    folio: oc.folio, fecha: oc.fechaOc, estado: oc.estado,
    emisor: emisor.empresa,
    proveedor: { nombre: oc.proveedor.nombre, rut: oc.proveedor.rut, giro: oc.proveedor.giro, direccion: oc.proveedor.direccion, comuna: null, telefono: oc.proveedor.telefono, email: oc.proveedor.email, contacto: null },
    fechaEntrega: oc.fechaEntrega, direccionEnvioFactura: emisor.empresa.direccion || null, direccionDespacho: oc.direccionDespacho,
    metodoDespacho: null, formaPago: oc.formaPago, centroCosto: null, referencia: codigo ? `Licitación ${codigo}` : null,
    items, subtotal: oc.neto, descuentoPorcentaje: 0, descuento: 0, neto: oc.neto, iva: oc.iva, total: oc.total,
    condiciones: [oc.condiciones, `Al facturar, indicar en la referencia la orden de compra N° ${oc.folio} (tipo 801).`].filter(Boolean).join('\n'),
    generadoPor: oc.creadoPor,
  };
  return { doc, logo: emisor.logo };
}

export interface FacturaSubida {
  archivo: { url: string; nombre: string };
  xml: string | null;                          // si se subió el XML del SII
  manual?: { folio: string; fecha: string | null; neto: number; total: number | null } | null;   // si se subió un PDF
  confirmar?: boolean;                         // el usuario confirmó un emparejamiento solo por monto
}

function revisarXml(xml: string, oc: OcPropia, empresaRut: string): { leida: FacturaLeida; res: ResultadoEmparejo } {
  let leida: FacturaLeida | null = null;
  try { leida = parsearFacturaXml(xml); } catch { /* XML roto: mismo aviso que si no es una factura */ }
  if (!leida) throw new Error('No se pudo leer el XML de la factura. Sube el XML que entrega el SII o el PDF con los datos a mano.');
  const res = emparejarFacturaConOc(leida, { folio: oc.folio, proveedorRut: oc.proveedor.rut, empresaRut, neto: oc.neto });
  if (res.tipo === 'NO') throw new Error(`Esta factura no corresponde a la ${oc.folio}: ${res.motivos.join(' ')}`);
  return { leida, res };
}

/** Revisa un XML contra la OC SIN guardar nada (antes de subir el archivo). Lanza si no calza. */
export async function revisarFacturaXmlOcPropia(negocioId: number, ocId: number, xml: string): Promise<ResultadoEmparejo> {
  const [oc, emisor] = await Promise.all([leerOc(negocioId, ocId), emisorOcPropia(negocioId)]);
  if (!emisor) throw new Error('Este negocio no emite órdenes de compra desde Licitank.');
  if (oc.estado === 'ANULADA') throw new Error('Esa orden de compra está anulada.');
  if (oc.estado === 'FACTURADA') throw new Error(`La orden de compra ${oc.folio} ya tiene su factura. Quítala antes de subir otra.`);
  return revisarXml(xml, oc, emisor.empresa.rut).res;
}

/** Empareja la factura con la OC. Con XML se revisa sola (RUT de los dos lados + referencia 801 o mismo neto); con PDF, los datos
 *  van a mano. Devuelve `pendiente` si el XML calza solo por monto y falta la confirmación del usuario (no se guarda nada). */
export async function registrarFacturaOcPropia(negocioId: number, ocId: number, f: FacturaSubida, actorId: number, actorNombre: string | null):
  Promise<{ oc: OcPropia | null; pendiente: ResultadoEmparejo | null }> {
  const oc = await leerOc(negocioId, ocId);
  if (oc.estado === 'ANULADA') throw new Error('Esa orden de compra está anulada.');
  if (oc.estado === 'FACTURADA') throw new Error(`La orden de compra ${oc.folio} ya tiene su factura. Quítala antes de subir otra.`);
  const emisor = await emisorOcPropia(negocioId);
  if (!emisor) throw new Error('Este negocio no emite órdenes de compra desde Licitank.');

  let folio: string, fecha: string | null, neto: number | null, total: number | null, emparejo: 'REFERENCIA' | 'MONTO' | 'MANUAL';
  if (f.xml) {
    const { leida, res } = revisarXml(f.xml, oc, emisor.empresa.rut);
    if (res.tipo === 'MONTO' && !f.confirmar) return { oc: null, pendiente: res };
    folio = leida.folio; fecha = leida.fechaEmision; neto = leida.totales.neto; total = leida.totales.total; emparejo = res.tipo === 'MONTO' ? 'MONTO' : 'REFERENCIA';   // «NO» ya lanzó en revisarXml
  } else {
    const m = f.manual;
    if (!m?.folio?.trim()) throw new Error('Falta el folio de la factura.');
    if (!(m.neto > 0)) throw new Error('Falta el monto neto de la factura.');
    folio = m.folio.trim(); fecha = m.fecha || null; neto = m.neto; total = m.total ?? redondear(m.neto * (1 + IVA_OC_PROPIA)); emparejo = 'MANUAL';
  }
  const ahora = ahoraChileSQL();
  await pool.query(
    `UPDATE compras_oc_propia SET estado = 'FACTURADA', factura_folio = ?, factura_fecha = ?, factura_neto = ?, factura_total = ?, factura_url = ?,
       factura_nombre = ?, factura_emparejo = ?, factura_subida_por = ?, factura_subida_por_nombre = ?, factura_subida_at = ? WHERE id = ? AND negocio_id = ?`,
    [folio.slice(0, 40), fecha, neto, total, f.archivo.url, f.archivo.nombre.slice(0, 255), emparejo, actorId, actorNombre, ahora, ocId, negocioId],
  );
  const dif = neto != null ? redondear(neto - oc.neto) : null;
  await registrarEvento({
    tipo: 'COMPRAS_OC_PROPIA_FACTURADA', licitacionCodigo: await codigoDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se emparejó la factura ${folio} de ${oc.proveedor.nombre} con la orden de compra ${oc.folio}`
      + (emparejo === 'REFERENCIA' ? ' (la factura cita la OC).' : emparejo === 'MONTO' ? ' (mismo neto, confirmado a mano).' : ' (PDF, datos ingresados a mano).')
      + (dif ? ` Diferencia con la OC: $${dif.toLocaleString('es-CL')} neto.` : ''),
    metadata: { negocio_id: negocioId, oc_propia_id: ocId, folio_oc: oc.folio, folio_factura: folio, emparejo, neto_factura: neto, neto_oc: oc.neto },
  });
  return { oc: await leerOc(negocioId, ocId), pendiente: null };
}

/** Quita la factura emparejada (se subió la equivocada): la OC vuelve a EMITIDA. */
export async function quitarFacturaOcPropia(negocioId: number, ocId: number, actorId: number, actorNombre: string | null): Promise<OcPropia> {
  const oc = await leerOc(negocioId, ocId);
  if (!oc.factura) throw new Error('Esa orden de compra no tiene factura.');
  await pool.query(
    `UPDATE compras_oc_propia SET estado = 'EMITIDA', factura_folio = NULL, factura_fecha = NULL, factura_neto = NULL, factura_total = NULL, factura_url = NULL,
       factura_nombre = NULL, factura_emparejo = NULL, factura_subida_por = NULL, factura_subida_por_nombre = NULL, factura_subida_at = NULL WHERE id = ? AND negocio_id = ?`,
    [ocId, negocioId],
  );
  await registrarEvento({
    tipo: 'COMPRAS_OC_PROPIA_FACTURA_QUITADA', licitacionCodigo: await codigoDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se quitó la factura ${oc.factura.folio ?? ''} de la orden de compra ${oc.folio}.`,
    metadata: { negocio_id: negocioId, oc_propia_id: ocId, folio_oc: oc.folio },
  });
  return leerOc(negocioId, ocId);
}

/** Anula una OC sin factura (el folio no se reutiliza). */
export async function anularOcPropia(negocioId: number, ocId: number, motivo: string, actorId: number, actorNombre: string | null): Promise<OcPropia> {
  const oc = await leerOc(negocioId, ocId);
  if (oc.estado === 'ANULADA') return oc;
  if (oc.factura) throw new Error('La orden de compra ya tiene factura: quita la factura antes de anularla.');
  if (!motivo.trim()) throw new Error('Escribe por qué se anula la orden de compra.');
  await pool.query(`UPDATE compras_oc_propia SET estado = 'ANULADA', anulada_motivo = ? WHERE id = ? AND negocio_id = ?`, [motivo.trim().slice(0, 500), ocId, negocioId]);
  await registrarEvento({
    tipo: 'COMPRAS_OC_PROPIA_ANULADA', licitacionCodigo: await codigoDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se anuló la orden de compra ${oc.folio}: ${motivo.trim()}`,
    metadata: { negocio_id: negocioId, oc_propia_id: ocId, folio_oc: oc.folio },
  });
  return leerOc(negocioId, ocId);
}
