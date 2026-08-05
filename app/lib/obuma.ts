// app/lib/obuma.ts
// Cliente de la API de Obuma (ERP de compras/proveedores de la empresa) — fuente del COSTO real
// (a quién le compramos, qué ítems, con qué factura) que complementa la orden de compra de
// Mercado Público (que es la VENTA). Ver app/lib/ordenes-compra.ts para el otro lado del cruce.
//
// AUTENTICACIÓN (verificado en vivo, 4-ago-2026 — no está en la documentación pública de Obuma,
// hubo que sacarlo de la página de ayuda artículo por artículo):
//   header  access-token: <OBUMA_API_TOKEN>
//   header  content-type: application/json
// Todo lo demás (Bearer, query param, POST body) devuelve SIEMPRE el mismo error genérico
// "Error 000... Error de autenticacion." sin importar ruta ni método — no es un 401 real, así
// que no sirve para diagnosticar nada más que "falta o está mal el header".
//
// DOS VERSIONES DE API:
//   v1.0 (base OBUMA_API_URL) → todo lo probado y funcionando: proveedores, comprasOc (con sus
//        ítems), comprasDte (facturas recibidas, con el XML en `s3_link`).
//   v2.0 → el módulo de Proyectos vive acá. Pide un header extra `access-url` (la URL/subdominio
//        de la cuenta en Obuma) que TODAVÍA no tenemos — sin él, v2.0 responde
//        "Acceso no autorizado a la version 2.0" (error DISTINTO al de v1.0, lo que confirma que
//        la ruta existe pero falta autorización, no que esté mal escrita).
//
// EL ESLABÓN QUE FALTA VERIFICAR: cómo se relaciona un Proyecto con sus facturas/OC de compra.
// La documentación de comprasOc/comprasDte no lista ningún filtro `proyecto_id` — puede que el
// propio `proyectos.findById` traiga las facturas anidadas, o que la relación sea por
// `centro_costo`. No se puede saber sin una respuesta real de v2.0, así que esa parte NO está
// escrita todavía (ver obuma-memoria.ts) — escribirla a ciegas arriesgaría cruzar mal el costo
// real de una experiencia, que es justo el dato que no se puede inventar.

const BASE_V1 = process.env.OBUMA_API_URL || 'https://api.obuma.cl/v1.0';
const BASE_V2 = BASE_V1.replace(/\/v1\.0\/?$/, '/v2.0');
const TOKEN = process.env.OBUMA_API_TOKEN || '';

export interface ObumaListado<T> {
  'data-actual-total': number;
  'data-actual-limit': number | string;
  'data-actual-page': number;
  'data-total-items': number | null;
  'data-total-pages': number | null;
  data: T[];
}

async function llamar<T = any>(
  base: string, path: string, params: Record<string, string | number | undefined> = {}, extraHeaders: Record<string, string> = {},
): Promise<T> {
  if (!TOKEN) throw new Error('OBUMA_API_TOKEN no configurado');
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: {
      'access-token': TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await res.text();
  let json: any;
  try { json = JSON.parse(texto); } catch {
    throw new Error(`Obuma ${path}: respuesta no-JSON (HTTP ${res.status}): ${texto.slice(0, 200)}`);
  }
  // Obuma no usa códigos HTTP para sus propios errores de negocio — vienen como {"result":...} o
  // un string plano "Error NNN... texto". Se detecta por forma, no por status.
  if (typeof json === 'string' || (json && typeof json.data === 'undefined' && json.result === undefined)) {
    throw new Error(`Obuma ${path}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json as T;
}

// ── v1.0 — verificado contra datos reales ───────────────────────────────────

export interface ObumaProveedor {
  proveedor_id: string;
  proveedor_rut: string;
  proveedor_razon_social: string;
  proveedor_nombre_fantasia: string;
  proveedor_contacto: string;
  proveedor_giro_comercial: string;
  proveedor_direccion: string;
  proveedor_comuna: string;
  [k: string]: unknown;
}

export function listarProveedores(params: { limit?: number; page?: number } = {}) {
  return llamar<ObumaListado<ObumaProveedor>>(BASE_V1, '/proveedores.list.json', params);
}

export async function proveedorPorId(id: string | number): Promise<ObumaProveedor | null> {
  const r = await llamar<ObumaListado<ObumaProveedor>>(BASE_V1, `/proveedores.findById.json/${id}`);
  return r.data?.[0] || null;
}

export async function proveedorPorRut(rut: string): Promise<ObumaProveedor | null> {
  const r = await llamar<ObumaListado<ObumaProveedor>>(BASE_V1, `/proveedores.findByRut.json/${encodeURIComponent(rut)}`);
  return r.data?.[0] || null;
}

export interface ObumaCompraOc {
  compra_oc_id: string;
  compra_oc_folio: string;
  compra_oc_fecha_ingreso: string;
  compra_oc_total: string;
  compra_oc_estado: string;
  compra_oc_referencia: string;
  compra_oc_observacion: string;
  compra_oc_centro_costo: string;
  rel_proveedor_id: string;
  [k: string]: unknown;
}

export function listarComprasOc(params: {
  folio_dcto?: string; fecha_desde?: string; fecha_hasta?: string;
  proveedor?: string; estado?: string; moneda?: string; limit?: number; page?: number;
} = {}) {
  return llamar<ObumaListado<ObumaCompraOc>>(BASE_V1, '/comprasOc.list.json', params);
}

export async function compraOcPorId(id: string | number): Promise<ObumaCompraOc | null> {
  const r = await llamar<ObumaListado<ObumaCompraOc>>(BASE_V1, `/comprasOc.findById.json/${id}`);
  return r.data?.[0] || null;
}

export interface ObumaCompraOcItem {
  cod_id: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: string;
  precio: string;
  subtotal: string;
  rel_compra_oc_id: string;
  compra_oc_folio: string;
  [k: string]: unknown;
}

export function listarComprasOcItems(params: { folio_dcto?: string; producto_id?: string; limit?: number; page?: number } = {}) {
  return llamar<ObumaListado<ObumaCompraOcItem>>(BASE_V1, '/comprasOc.listItems.json', params);
}

export interface ObumaDte {
  dte_id: string;
  dte_folio: string;
  dte_tipo: string;
  dte_fecha: string;
  dte_rut_emisor: string;
  dte_razonsocial_emisor: string;
  dte_total: string;
  rel_compra_id: string;
  rel_proveedor_id: string;
  s3_link: string;   // XML de la factura, descarga directa
  [k: string]: unknown;
}

export function listarComprasDte(params: {
  id_dcto?: string; tipo_dcto?: string; folio_dcto?: string;
  mes_contable?: string; ano_contable?: string; proveedor?: string; rut_proveedor?: string;
  id_compra?: string; limit?: number; page?: number;
} = {}) {
  return llamar<ObumaListado<ObumaDte>>(BASE_V1, '/comprasDte.list.json', params);
}

// ── v2.0 — Proyectos: pendiente de acceso ───────────────────────────────────
// Sin OBUMA_ACCESS_URL, ni se intenta: mejor un error claro ahora que un header vacío que Obuma
// interprete como otra cosa.
export interface ObumaProyecto {
  proyecto_id?: string;
  proyecto_folio?: string;
  proyecto_nombre?: string;
  proyecto_referencia?: string;
  [k: string]: unknown;
}

export function listarProyectos(params: { limit?: number; page?: number } = {}) {
  const accessUrl = process.env.OBUMA_ACCESS_URL;
  if (!accessUrl) throw new Error('OBUMA_ACCESS_URL no configurado — falta para habilitar v2.0 (módulo Proyectos)');
  return llamar<ObumaListado<ObumaProyecto>>(BASE_V2, '/proyectos.list.json', params, { 'access-url': accessUrl });
}

export async function proyectoPorId(id: string | number): Promise<ObumaProyecto | null> {
  const accessUrl = process.env.OBUMA_ACCESS_URL;
  if (!accessUrl) throw new Error('OBUMA_ACCESS_URL no configurado — falta para habilitar v2.0 (módulo Proyectos)');
  const r = await llamar<ObumaListado<ObumaProyecto>>(BASE_V2, `/proyectos.findById.json/${id}`, {}, { 'access-url': accessUrl });
  return r.data?.[0] || null;
}
