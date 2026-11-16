// app/lib/compras-oc-documento.ts
// «Ver OC»: arma el documento de una orden de compra REAL de Obuma (la que está en obuma_compras) con el mismo orden de datos
// que el PDF que imprime Obuma (emisor, proveedor, entrega/despacho/pago, ítems, totales, condiciones). Solo lee la base:
// Obuma no entrega el PDF por API y proveedores.findById tiene cuota diaria (se agotó en las pruebas), así que los datos del
// proveedor salen de la ficha local y lo que no esté queda en blanco, como Obuma.
import pool from '@/app/lib/db';
import { centrosDeCostoCompleto, listarProductosObuma, proveedorPorId, proveedoresObumaCompleto, type ObumaProveedor } from '@/app/lib/obuma';

export interface OcDocumento {
  folio: string; fecha: string | null; estado: string | null;
  emisor: { razonSocial: string; rut: string; giro: string; direccion: string; telefono: string; email: string } | null;
  proveedor: { nombre: string; rut: string | null; giro: string | null; direccion: string | null; comuna: string | null; telefono: string | null; email: string | null; contacto: string | null };
  fechaEntrega: string | null; direccionEnvioFactura: string | null; direccionDespacho: string | null;
  metodoDespacho: string | null; formaPago: string | null; centroCosto: string | null; referencia: string | null;
  items: Array<{ codigo: string | null; descripcion: string; cantidad: number; precio: number; descuento: number; subtotal: number; imagenUrl: string | null }>;
  subtotal: number; descuentoPorcentaje: number; descuento: number; neto: number; iva: number; total: number;
  condiciones: string | null; generadoPor: string | null;
}

// Datos de la empresa que emite (rel_empresa_id de Obuma), tal como salen en el PDF de Obuma.
const EMISORES: Record<string, NonNullable<OcDocumento['emisor']>> = {
  '1005': {
    razonSocial: 'INVERSIONES CLARO ARZ SPA', rut: '76.902.659-2',
    giro: 'ALQUILER-REPARACION-FABRICACION DE MAQUINARIA Y OTRAS ACTV. DE SERVICI',
    direccion: 'BARROS ARANA 492, Depto. 78, Concepcion - Biobio', telefono: '56931462445', email: 'ventas@grupoica.cl',
  },
};
// Usuarios de Obuma conocidos por el PDF («Generado por»); el resto queda sin nombre antes que inventarlo.
const USUARIOS: Record<string, string> = { '5707': 'Carlos A M' };

// Foto principal del producto en el catálogo de Obuma (producto_imagen_principal, un enlace público de su S3). Se recuerda en memoria
// por producto; si Obuma no responde (cuota diaria) o no tiene foto, la celda IMAGEN queda vacía.
const fotos = new Map<string, string | null>();
async function fotoProducto(productoId: string | null): Promise<string | null> {
  if (!productoId || productoId === '0') return null;
  if (fotos.has(productoId)) return fotos.get(productoId)!;
  try {
    const p = (await listarProductosObuma({ id: productoId, limit: 1 })).data?.[0];
    const url = p && String(p.producto_id) === productoId ? texto(p.producto_imagen_principal) : null;
    fotos.set(productoId, url);
    return url;
  } catch { return null; }
}

// Catálogo de proveedores de Obuma en memoria (10 min): proveedores.findById tiene cuota diaria y se agota; proveedores.list no.
let catalogoProv: { at: number; porId: Map<string, ObumaProveedor> } | null = null;
async function proveedorDeObuma(id: string): Promise<ObumaProveedor | null> {
  try { return await proveedorPorId(id); } catch { /* cuota diaria agotada: se usa el catálogo completo */ }
  if (!catalogoProv || Date.now() - catalogoProv.at > 10 * 60_000) {
    const todos = await proveedoresObumaCompleto();
    catalogoProv = { at: Date.now(), porId: new Map(todos.map(p => [String(p.proveedor_id), p])) };
  }
  return catalogoProv.porId.get(id) ?? null;
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const texto = (v: unknown) => { const s = String(v ?? '').trim(); return s || null; };
const fechaIso = (v: unknown) => { const s = String(v ?? '').trim(); return !s || s.startsWith('0000') ? null : s.slice(0, 10); };

/** La OC `folio` de la licitación del negocio, o null si no existe / es de otra licitación. */
export async function documentoOcObuma(licitacionCodigo: string, folio: string): Promise<OcDocumento | null> {
  const [rows] = await pool.query(
    `SELECT folio, estado, proveedor_id, proveedor_rut, proveedor_razon_social, items_json, raw_json
       FROM obuma_compras WHERE licitacion_codigo = ? AND folio = ? LIMIT 1`,
    [licitacionCodigo, folio],
  ) as any[];
  const r = (rows as any[])[0];
  if (!r) return null;
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(r.raw_json || '{}'); } catch { /* sin cabecera: se muestra con lo que haya */ }
  let items: any[] = [];
  try { items = JSON.parse(r.items_json || '[]'); } catch { /* sin ítems */ }

  // El id del proveedor puede faltar en la fila si la sincronización no pudo resolverlo (OC creada por nosotros): la cabecera de
  // Obuma lo trae en rel_proveedor_id.
  const proveedorId = texto(r.proveedor_id) || texto(raw.rel_proveedor_id);
  const [pv] = await pool.query(
    `SELECT nombre_empresa, rut, giro, direccion, comuna, telefono, correo, contacto_nombre FROM compras_proveedor WHERE obuma_proveedor_id = ? LIMIT 1`,
    [proveedorId],
  ) as any[];
  const p = (pv as any[])[0] || {};
  let nombreProv = texto(r.proveedor_razon_social) || texto(p.nombre_empresa);
  let rutProv = texto(r.proveedor_rut) || texto(p.rut);
  // Último recurso: preguntarle a Obuma por el proveedor (tiene cuota diaria: si falla, queda en blanco como antes).
  if ((!nombreProv || !rutProv || !p.direccion || !p.giro || !p.telefono || !p.correo) && proveedorId && proveedorId !== '0') {
    try {
      const o = await proveedorDeObuma(proveedorId);
      if (o) {
        nombreProv = nombreProv || texto(o.proveedor_razon_social) || texto(o.proveedor_nombre_fantasia);
        rutProv = rutProv || texto(o.proveedor_rut);
        p.giro = p.giro || texto(o.proveedor_giro_comercial);
        p.direccion = p.direccion || texto(o.proveedor_direccion);
        p.comuna = p.comuna || texto(o.proveedor_comuna);
        p.contacto_nombre = p.contacto_nombre || texto(o.proveedor_contacto);
        p.telefono = p.telefono || texto(o.proveedor_telefono) || texto(o.proveedor_celular);
        p.correo = p.correo || texto(o.proveedor_email) || texto(o.proveedor_correo);
        if ((nombreProv || rutProv) && (!r.proveedor_razon_social || !r.proveedor_rut)) {
          await pool.query(
            `UPDATE obuma_compras SET proveedor_id = COALESCE(proveedor_id, ?), proveedor_rut = COALESCE(proveedor_rut, ?), proveedor_razon_social = COALESCE(proveedor_razon_social, ?) WHERE licitacion_codigo = ? AND folio = ?`,
            [proveedorId, rutProv, nombreProv, licitacionCodigo, folio],
          ).catch(() => {});
        }
      }
    } catch { /* Obuma sin respuesta: queda en blanco */ }
  }

  // Nombre del centro de costo: viene como id; el catálogo de Obuma está cacheado en memoria.
  let centroCosto: string | null = null;
  const ccId = texto(raw.compra_oc_centro_costo);
  if (ccId) centroCosto = (await centrosDeCostoCompleto().catch(() => [])).find(c => c.id === ccId)?.nombre ?? null;

  // Las OC exentas o de importación (p. ej. la 3855 de Yucheng) traen subtotal, neto e IVA en 0 en la cabecera y solo el total (en
  // «exento»): se completan desde los ítems para que el documento cuadre (neto + IVA = total).
  const sumaItems = items.reduce((t, it) => t + n(it.subtotal), 0);
  const descuento = n(raw.compra_oc_descuento_pesos);
  const subtotal = n(raw.compra_oc_subtotal) || sumaItems;
  const iva = n(raw.compra_oc_iva);
  const neto = n(raw.compra_oc_neto) || Math.max(0, subtotal - descuento);
  const total = n(raw.compra_oc_total) || neto + iva;

  const comuna = texto(p.comuna);
  return {
    folio: String(r.folio), fecha: fechaIso(raw.compra_oc_fecha_ingreso), estado: r.estado ?? null,
    emisor: EMISORES[String(raw.rel_empresa_id)] ?? null,
    proveedor: {
      nombre: nombreProv || '', rut: rutProv, giro: texto(p.giro), direccion: texto(p.direccion),
      comuna: comuna && !/^\d+$/.test(comuna) ? comuna : null, telefono: texto(p.telefono), email: texto(p.correo), contacto: texto(p.contacto_nombre),
    },
    fechaEntrega: texto(raw.compra_oc_fecha_entrega_productos), direccionEnvioFactura: texto(raw.compra_oc_direccion_envio_factura),
    direccionDespacho: texto(raw.compra_oc_direccion_despacho), metodoDespacho: texto(raw.compra_oc_metodo_despacho),
    formaPago: texto(raw.compra_oc_forma_pago), centroCosto, referencia: texto(raw.compra_oc_referencia),
    items: await Promise.all(items.map(async it => ({
      codigo: texto(it.codigo_comercial), descripcion: String(it.producto_nombre || it.producto_descripcion || ''),
      cantidad: n(it.cantidad), precio: n(it.precio), descuento: n(it.descuento), subtotal: n(it.subtotal),
      imagenUrl: await fotoProducto(texto(it.producto_id)),
    }))),
    subtotal, descuentoPorcentaje: n(raw.compra_oc_descuento_porciento), descuento, neto, iva, total,
    condiciones: texto(raw.compra_oc_condiciones), generadoPor: USUARIOS[String(raw.rel_usuario_id)] ?? null,
  };
}
