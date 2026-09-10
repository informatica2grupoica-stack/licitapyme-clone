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

// Verificado en vivo (10-sep-2026, scripts/scratch/obuma-verificar-filtro-producto-correcto.mts):
// el parámetro documentado y que SÍ filtra de verdad es "producto" (ID del producto) — no
// "producto_id" (lo que usaba esta función antes; un ID inventado devolvía igual todos los
// resultados sin filtrar, bug real: "Ver proveedor histórico" mostraba proveedores de CUALQUIER
// producto, no del que correspondía). También existe "producto_sku" si se prefiere filtrar por SKU.
export function listarComprasOcItems(params: { folio_dcto?: string; producto?: string; producto_sku?: string; limit?: number; page?: number } = {}) {
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

// ── Productos — escritura (sep-2026, spec §7) ───────────────────────────────
// Antes esta integración era standby ("dirección de creación y sincronización... queda en
// standby", §7.5). Se activó a pedido del usuario, que ya la construyó antes para el mismo grupo
// (grupoica-intranet — MISMA cuenta de Obuma, mismo token, verificado). Ese proyecto es la fuente
// de verdad de cómo Obuma espera el payload de creación: `access-token` para todo, "producto_*"
// con strings para números, sin usar códigos HTTP para errores de negocio (mismo patrón que
// `llamar()` de arriba).
//
// Confirmado en vivo (solo lectura, contra la cuenta real) el 10-sep-2026: la categoría "Mercado
// Publico" (id 13255) ya existe con 1383 productos reales bajo ella, con SKU en el formato
// "60" + subcategoría + correlativo (ej. "6026434221" = 60 + MAQUINARIA(26434) + 221) — se replica
// tal cual, no se inventa un esquema nuevo.
export const OBUMA_CATEGORIA_MERCADO_PUBLICO = '13255';
const PREFIJO_SKU_MERCADO_PUBLICO = '60';
const CORRELATIVO_INICIAL = 203; // mismo piso que ya usa grupoica-intranet para esta cuenta

async function llamarPost<T = any>(base: string, path: string, payload: Record<string, unknown>): Promise<T> {
  if (!TOKEN) throw new Error('OBUMA_API_TOKEN no configurado');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'access-token': TOKEN, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await res.text();
  let json: any;
  try { json = JSON.parse(texto); } catch {
    throw new Error(`Obuma ${path}: respuesta no-JSON (HTTP ${res.status}): ${texto.slice(0, 200)}`);
  }
  if (json.success === false || json.status === false || (typeof json === 'string')) {
    throw new Error(`Obuma ${path}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  // Verificado en vivo (10-sep-2026): la respuesta real de /productos.create.json NO trae
  // success/status ni data — viene como { ..., data: null, result: { result: 0, result_detail:
  // "producto creado. producto_id:1118883" } }. result.result parece ser el código de resultado
  // (0 = éxito); si algún día viene distinto de 0, es un error real de negocio aunque el HTTP haya
  // sido 200 (mismo patrón "Obuma no usa códigos HTTP" documentado en llamar() arriba).
  if (json.result && typeof json.result === 'object' && typeof json.result.result === 'number' && json.result.result !== 0) {
    throw new Error(`Obuma ${path}: ${json.result.result_detail || JSON.stringify(json).slice(0, 300)}`);
  }
  return json as T;
}

export interface ObumaProductoCategoria {
  producto_categoria_id: string; producto_categoria_nombre: string; [k: string]: unknown;
}
export function listarCategoriasProductos() {
  return llamar<ObumaListado<ObumaProductoCategoria>>(BASE_V1, '/productosCategorias.list.json');
}

export interface ObumaProductoSubcategoria {
  producto_subcategoria_id: string; producto_subcategoria_nombre: string; rel_producto_categoria_id: string; [k: string]: unknown;
}
export function listarSubcategoriasProductos() {
  return llamar<ObumaListado<ObumaProductoSubcategoria>>(BASE_V1, '/productosSubCategorias.list.json');
}

export interface ObumaProducto {
  producto_id: string; producto_codigo_comercial: string; producto_nombre: string;
  producto_categoria: string; producto_subcategoria: string; [k: string]: unknown;
}
export function listarProductosObuma(params: {
  id?: string; producto_categoria?: string; producto_subcategoria?: string; limit?: number; page?: number;
} = {}) {
  return llamar<ObumaListado<ObumaProducto>>(BASE_V1, '/productos.list.json', params);
}

// Verificado en vivo (10-sep-2026, scripts/scratch/obuma-diagnostico-filtros.mjs): NINGÚN filtro de
// categoría/subcategoría en /productos.list.json funciona en esta cuenta — ni "categoria"/
// "subcategoria" (nombres oficiales de la doc) ni "producto_categoria"/"producto_subcategoria"
// (lo que usaba antes esta función) acotan nada; siempre devuelve el catálogo completo, topado en
// 1000 ítems por página (hay 1383 en total, en 2 páginas — orden producto_id descendente, o sea
// más nuevos primero). Traer solo la página 1 (como hacía esta función, y como hace también
// grupoica-intranet) deja afuera hasta 383 productos — si el correlativo más alto de una
// subcategoría puntual cae justo en esos 383, se calcula un "siguiente" código que en realidad YA
// EXISTE (bug real reportado en vivo por el usuario, código repetido al crear "Plataformas
// satelital"). Por eso acá SIEMPRE se pagina hasta agotar el catálogo, nunca se confía en un
// filtro de servidor que no filtra.
let cacheCatalogo: { en: number; datos: ObumaProducto[] } | null = null;
const CACHE_CATALOGO_MS = 60_000; // suficiente para cubrir un flujo de creación de SKU completo sin recargar cuota de más

async function catalogoObumaCompleto(forzar = false): Promise<ObumaProducto[]> {
  if (!forzar && cacheCatalogo && Date.now() - cacheCatalogo.en < CACHE_CATALOGO_MS) return cacheCatalogo.datos;
  const todos: ObumaProducto[] = [];
  let pagina = 1;
  for (; pagina <= 10; pagina++) { // tope de seguridad — nunca debería llegar a 10 páginas de 1000
    const r = await listarProductosObuma({ page: pagina, limit: 1000 });
    const lote = r.data || [];
    todos.push(...lote);
    const totalPaginas = Number(r['data-total-pages']) || 1;
    if (pagina >= totalPaginas || lote.length === 0) break;
  }
  cacheCatalogo = { en: Date.now(), datos: todos };
  return todos;
}

function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** §7.3 — SKU correlativo dentro de una subcategoría, mismo esquema que ya usa la cuenta real
 *  ("60" + subcategoría + correlativo de 3+ dígitos, arrancando en 203). Calcula sobre el CATÁLOGO
 *  COMPLETO (ver catalogoObumaCompleto — el filtro de servidor no funciona, así que no hay atajo
 *  más barato sin arriesgar una colisión). */
export async function siguienteSkuMercadoPublico(subcategoriaId: string): Promise<string> {
  const prefijo = `${PREFIJO_SKU_MERCADO_PUBLICO}${subcategoriaId}`;
  const catalogo = await catalogoObumaCompleto();
  const usados = catalogo
    .map(p => String(p.producto_codigo_comercial))
    .filter(s => s.startsWith(prefijo))
    .map(s => parseInt(s.slice(prefijo.length), 10) || 0);
  const maximo = usados.length ? Math.max(...usados) : 0;
  const siguiente = maximo < CORRELATIVO_INICIAL ? CORRELATIVO_INICIAL : maximo + 1;
  return `${prefijo}${String(siguiente).padStart(3, '0')}`;
}

export interface ObumaProductoCoincidencia {
  id: string; nombre: string; codigoComercial: string; categoriaId: string; subcategoriaId: string;
}

/** Búsqueda de posibles duplicados por nombre (pedido explícito del usuario: "si pongo pala debe
 *  de mostrar todas las palas que estan en obuma para no duplicarlas"). Sin acento/mayúsculas,
 *  substring simple — no hay endpoint de búsqueda por texto en la API de Obuma (confirmado en la
 *  doc oficial, solo filtra por id/tipo/codigo/categoria/etc.), así que se filtra client-side
 *  sobre el catálogo completo, igual que siguienteSkuMercadoPublico. Busca en TODO Obuma, no solo
 *  en "Mercado Publico": un duplicado en cualquier categoría igual es un duplicado real. */
export async function buscarProductosObumaPorNombre(query: string, limite = 20): Promise<ObumaProductoCoincidencia[]> {
  const q = normalizarTexto(query);
  if (q.length < 3) return []; // evita traer medio catálogo con 1-2 letras
  const catalogo = await catalogoObumaCompleto();
  return catalogo
    .filter(p => normalizarTexto(String(p.producto_nombre || '')).includes(q))
    .slice(0, limite)
    .map(p => ({
      id: String(p.producto_id), nombre: String(p.producto_nombre),
      codigoComercial: String(p.producto_codigo_comercial), categoriaId: String(p.producto_categoria),
      subcategoriaId: String(p.producto_subcategoria),
    }));
}

export interface DatosCrearProductoObuma {
  nombre: string; codigoComercial: string; subcategoriaId: string;
  costoClpNeto: number;
  // Solo interno por defecto (decisión del usuario, 10-sep-2026): un producto comprado para UNA
  // licitación puntual no es algo que Tecnomaq venda al público en su catálogo/tienda.
  paraVenta?: boolean; paraCompra?: boolean; inventariable?: boolean; venderEnWeb?: boolean;
}

/** Crea el producto en Obuma de verdad (§7, escritura real contra el ERP de producción — nunca se
 *  llama sin que un humano lo haya pedido explícitamente). Categoría fija "Mercado Publico"
 *  (13255): es la que la propia empresa ya usa para todo lo que compra para cumplir licitaciones,
 *  con 1383 productos reales ya cargados ahí.
 *
 *  Payload verificado 10-sep-2026 contra la documentación oficial (obuma.cl/ayuda, artículo
 *  "API : Productos") — los campos documentados de `productos.create.json` (producto_tipo,
 *  producto_codigo_comercial, producto_nombre, producto_categoria, producto_subcategoria,
 *  producto_costo_clp_neto, producto_precio_clp_neto) ya están todos cubiertos; el resto
 *  (para_venta/para_compra/inventariable/vender_en_web/impuesto_id/sucursal_id) son los "otros
 *  campos relevantes" que la propia doc menciona sin listar, y coinciden 1:1 con el payload real
 *  que ya usa grupoica-intranet contra esta misma cuenta.
 *
 *  Después de crear, se relee el producto (productos.list.json?id=) para confirmar el código
 *  comercial que Obuma realmente guardó — no se asume que coincide con el que se mandó: si dos
 *  creaciones concurrentes piden el "siguiente" código a la vez, Obuma se queda con el que procesó
 *  primero y el nuestro quedaría mintiendo en compras_sku si no se verifica (regla §"nunca inventar
 *  datos" aplicada también a lo que se guarda DESPUÉS de escribir, no solo antes). */
export async function crearProductoObuma(datos: DatosCrearProductoObuma): Promise<{ productoId: string; codigoComercial: string }> {
  const costoNeto = Math.round(datos.costoClpNeto);
  // Sin venta pública: precio de venta queda en 0, no se inventa un margen — este producto no se
  // vende por catálogo, se compra para entregar lo adjudicado en la licitación.
  const precioNeto = 0;
  const payload = {
    producto_nombre: datos.nombre.toUpperCase().trim().slice(0, 200),
    producto_tipo: '0', // Producto (no Servicio)
    producto_activo: '1',
    producto_mostrar: '0', // nunca visible en el catálogo/tienda
    producto_codigo_comercial: datos.codigoComercial,
    producto_categoria: OBUMA_CATEGORIA_MERCADO_PUBLICO,
    producto_subcategoria: datos.subcategoriaId,
    producto_impuesto_id: '1',
    producto_costo_clp_neto: String(costoNeto),
    producto_costo_clp_neto_estandar: String(costoNeto),
    producto_precio_clp_neto: String(precioNeto),
    producto_precio_clp_iva: '0',
    producto_precio_clp_total: '0',
    producto_para_venta: datos.paraVenta ? '1' : '0',
    producto_para_compra: datos.paraCompra === false ? '0' : '1', // por defecto SÍ, es lo que se está comprando
    producto_inventariable: datos.inventariable ? '1' : '0',
    producto_vender_en_web: datos.venderEnWeb ? '1' : '0',
    sucursal_id: '1',
  };
  const json = await llamarPost<any>(BASE_V1, '/productos.create.json', payload);
  // Verificado en vivo (10-sep-2026): la respuesta REAL de productos.create.json no trae
  // data.producto_id ni producto_id sueltos — el ID viene embebido como texto dentro de
  // result.result_detail: "producto creado. producto_id:1118883". Sin este parseo, la creación
  // queda huérfana en Obuma (el producto SÍ se crea, pero Licitank nunca se entera del ID y tira
  // error igual, dejando compras_sku sin el vínculo — bug real reportado en vivo por el usuario).
  const detalle: string = json.result?.result_detail || json.result_detail || '';
  const productoId = json.data?.producto_id || json.producto_id || detalle.match(/producto_id\s*:\s*(\d+)/i)?.[1];
  if (!productoId) throw new Error(`Obuma no devolvió el ID del producto creado: ${JSON.stringify(json).slice(0, 300)}`);

  // Se invalida el caché del catálogo: si se crea otro SKU en la subcategoría justo después, el
  // próximo correlativo debe contar este producto recién creado, no una foto de hace hasta 60s.
  cacheCatalogo = null;

  // Verificación de lectura: el código comercial que Obuma guardó de verdad, no el que se pidió.
  const verificado = await listarProductosObuma({ id: String(productoId) });
  const codigoReal = verificado.data?.[0]?.producto_codigo_comercial;
  if (!codigoReal) throw new Error(`Obuma creó el producto ${productoId} pero no se pudo releer para confirmar el código comercial.`);
  if (codigoReal !== datos.codigoComercial) {
    throw new Error(`Obuma asignó el código ${codigoReal} (no ${datos.codigoComercial} como se pidió) — probable colisión con otra creación simultánea. Producto ${productoId} quedó creado en Obuma; vuelve a intentar el SKU con la subcategoría para pedir un código nuevo.`);
  }
  return { productoId: String(productoId), codigoComercial: codigoReal };
}

// ── Órdenes de Compra a proveedores — sep-2026, spec §11.1 ──────────────────────────────────
// Confirmado por soporte de Obuma (10-sep-2026, correo directo): "Desde la API si puedes crear
// ordenes de compras, y también listarlas" vía /comprasOc.create.json + /comprasOc.list.json —
// antes "Orden de compra emitida" era solo un checkbox marcado a mano (§11.1: "el módulo controla
// y registra el estado, no los ejecuta"); ahora SÍ se puede ejecutar de verdad.
//
// UNA OC POR PROVEEDOR (pedido explícito del usuario, 10-sep-2026: "las ordenes de compra son por
// proveedor") — nunca se mezclan ítems de dos proveedores distintos en la misma orden.
//
// `oc_concepto_gasto` — confirmado en vivo (10-sep-2026, capturas del flujo real "Ordenes de
// Compras" de Obuma): no es un catálogo con IDs, son 3 botones fijos (Gastos/Inventario/Activos) ×
// Nacional/Internacional. Lo que se compra para entregar una licitación es mercadería real, así
// que el default es INVENTARIO + Nacional (ver DatosCrearOrdenCompra más abajo).
//
// `oc_centro_costo` — CONFIRMADO en vivo que existe una correlación real: cada licitación que ya
// tiene un Proyecto armado en Obuma (módulo v2.0, sin acceso todavía — pide un header `access-url`
// que no tenemos) tiene también un centro de costo en v1.0 cuyo NOMBRE incluye el código de la
// licitación (ej. "PROY-58 - MUNICIPALIDAD DE CALAMA 2385-19-LE25"). `buscarCentroCostoPorLicitacion`
// busca por ese patrón — si lo encuentra, se manda; si no (licitación nueva, todavía sin Proyecto
// armado en Obuma), se omite sin bloquear la OC — no se inventa un centro de costo cualquiera.
export const SUCURSAL_TALAGANTE = '3069'; // empresaSucursales.list.json, verificado en vivo — coincide con BODEGA_ORIGEN (compras-auditor.ts)
export const MONEDA_CLP_ID = '1'; // pg-monedas.list.json, verificado en vivo

export interface ObumaFormaPago { id: string; codigo: string; nombre: string }
/** Solo las formas de pago habilitadas para compras (`usar_en_compras=1`) — no tiene sentido
 *  ofrecer "Nota Crédito de Clientes" al emitir una OC a un proveedor. */
export async function listarFormasPago(): Promise<ObumaFormaPago[]> {
  const r = await llamar<ObumaListado<any>>(BASE_V1, '/empresaFormasDePago.list.json');
  return (r.data || [])
    .filter(f => String(f.usar_en_compras) === '1')
    .map(f => ({ id: String(f.empresa_fp_id), codigo: String(f.empresa_fp_codigo || ''), nombre: String(f.empresa_fp_nombre) }));
}

/** Busca el centro de costo real de una licitación por su código, dentro del nombre del centro de
 *  costo (verificado en vivo, 10-sep-2026: "PROY-58 - MUNICIPALIDAD DE CALAMA 2385-19-LE25" trae
 *  "2385-19-LE25" literal en el texto). `contabilidadCentrosDeCostos.list.json` no tiene ningún
 *  filtro de servidor (se probó y no filtra nada, mismo patrón que otros endpoints de esta cuenta),
 *  así que se trae el listado completo (200 y tantos, una sola consulta barata) y se busca acá.
 *  `null` si esta licitación todavía no tiene un centro de costo armado en Obuma — nunca se inventa
 *  uno ni se manda el primero que aparezca. */
export async function buscarCentroCostoPorLicitacion(licitacionCodigo: string): Promise<{ id: string; nombre: string } | null> {
  const r = await llamar<ObumaListado<any>>(BASE_V1, '/contabilidadCentrosDeCostos.list.json');
  const activos = (r.data || []).filter(c => String(c.ccc_activo) === '1' && String(c.ccc_nombre || '').includes(licitacionCodigo));
  if (activos.length === 0) return null;
  // Si hay más de un centro de costo con el mismo código de licitación (pasa con sub-proyectos,
  // ver "PROY-26 - LOS ANGELES ID 2411-18-LE24 MINIEXCAVADORA"), se prefiere el más reciente
  // (ccc_id más alto) — mejor esfuerzo, no hay forma de saber cuál es "el correcto" sin más datos.
  const elegido = activos.sort((a, b) => Number(b.ccc_id) - Number(a.ccc_id))[0];
  return { id: String(elegido.ccc_id), nombre: String(elegido.ccc_nombre) };
}

export interface DatosItemOrdenCompra {
  // Si el ítem ya tiene SKU homologado con Obuma (compras_sku.obuma_producto_id), se manda su ID
  // real — la OC queda enlazada al mismo producto del catálogo, no a un texto suelto. Si todavía
  // no existe el SKU en Obuma, se manda igual como línea de texto (nombre/precio/cantidad) sin
  // producto_id — no bloquea la OC, pero pierde la trazabilidad del catálogo para ese ítem.
  productoIdObuma: string | null; codigoComercial: string | null;
  nombre: string; cantidad: number; precioUnitarioNeto: number;
}
export interface DatosCrearOrdenCompra {
  proveedorRut: string | null; proveedorRazonSocial: string;
  proveedorDireccion?: string | null; proveedorComuna?: string | null;
  proveedorEmail?: string | null; proveedorTelefono?: string | null;
  fecha: string; // yyyy-mm-dd
  formaPagoId: string;
  referencia: string; // trazabilidad hacia Licitank — código de licitación
  concepto?: string | null;
  items: DatosItemOrdenCompra[];
  // Línea de flete opcional (spec §11, pedido explícito: "puede incluir el flete o no") — se manda
  // como un ítem más de la OC, no como un campo aparte: así entra en el subtotal/IVA/total igual
  // que cualquier otro costo real de la orden.
  fleteMonto?: number | null;
  // Confirmado en vivo (10-sep-2026, capturas de pantalla del flujo real "Ordenes de Compras" en
  // Obuma): antes de armar la OC, Obuma pide elegir Nacional/Internacional y un concepto — Gasto,
  // Inventario o Activo. Los productos que se compran para entregar lo adjudicado en una licitación
  // son mercadería real que se entrega, no un gasto operativo ni un activo fijo de la empresa — el
  // usuario mismo lo confirmó: "ponemos nacionales y pinchamos inventario". Por eso el default acá
  // es INVENTARIO/nacional; si algún día se necesita un concepto distinto (ej. un servicio de
  // logística que sea GASTO puro) habría que exponerlo como opción, no queda hardcodeado por gusto.
  internacional?: boolean; // default false (Nacional)
  conceptoGasto?: 'GASTO' | 'INVENTARIO' | 'ACTIVO'; // default INVENTARIO
  // ID real del centro de costo (contabilidadCentrosDeCostos.list.json) — ver
  // buscarCentroCostoPorLicitacion. Se omite del payload cuando es null: no se manda un centro de
  // costo cualquiera solo por rellenar el campo.
  centroCostoId?: string | null;
}

/** Crea la Orden de Compra DE VERDAD en Obuma (escritura real contra el ERP de producción — nunca
 *  se llama sin que un humano lo haya pedido explícitamente, mismo criterio que crearProductoObuma).
 *  Verifica releyendo la OC creada antes de darla por buena — no se asume que lo mandado quedó
 *  guardado tal cual (regla "nunca inventar datos" aplicada también a lo que se guarda DESPUÉS de
 *  escribir, no solo antes; mismo bug real ya corregido una vez en productos.create.json). */
export async function crearOrdenCompraObuma(
  datos: DatosCrearOrdenCompra,
): Promise<{ compraOcId: string; folio: string | null; subtotalNeto: number; iva: number; total: number }> {
  const itemsPayload: Record<string, unknown>[] = datos.items.map(it => ({
    ...(it.productoIdObuma ? { producto_id: it.productoIdObuma } : {}),
    ...(it.codigoComercial ? { codigo_comercial: it.codigoComercial } : {}),
    producto_nombre: it.nombre.toUpperCase().trim().slice(0, 200),
    unidad_medida: 'UN',
    cantidad: String(it.cantidad),
    precio: String(Math.round(it.precioUnitarioNeto)),
    subtotal: String(Math.round(it.cantidad * it.precioUnitarioNeto)),
  }));
  if (datos.fleteMonto != null) {
    // Blindaje contra NaN (mismo bug real ya corregido en cotizaciones): un flete mal parseado no
    // se ignora en silencio — se rechaza, para no mandar a Obuma un monto corrupto o perder el
    // dato sin que nadie se entere.
    if (!Number.isFinite(datos.fleteMonto)) throw new Error('El monto del flete no es un número válido.');
    if (datos.fleteMonto > 0) {
      itemsPayload.push({
        producto_nombre: 'FLETE / DESPACHO', unidad_medida: 'UN', cantidad: '1',
        precio: String(Math.round(datos.fleteMonto)), subtotal: String(Math.round(datos.fleteMonto)),
      });
    }
  }
  if (itemsPayload.length === 0) throw new Error('La orden de compra no tiene ningún ítem.');

  const subtotalNeto = itemsPayload.reduce((s, it) => s + Number(it.subtotal), 0);
  const iva = Math.round(subtotalNeto * 0.19);
  const total = subtotalNeto + iva;

  const doc: Record<string, unknown> = {
    proveedor_razon_social: datos.proveedorRazonSocial,
    oc_fecha: datos.fecha,
    oc_sucursal: SUCURSAL_TALAGANTE,
    oc_moneda: MONEDA_CLP_ID,
    oc_forma_pago: datos.formaPagoId,
    oc_subtotal: String(subtotalNeto),
    oc_neto: String(subtotalNeto),
    oc_iva: String(iva),
    oc_total: String(total),
    oc_referencia: datos.referencia,
    oc_internacional: datos.internacional ? '1' : '0',
    oc_concepto_gasto: datos.conceptoGasto || 'INVENTARIO',
    oc_detalle: itemsPayload,
  };
  if (datos.proveedorRut) doc.proveedor_rut = datos.proveedorRut;
  if (datos.proveedorDireccion) doc.proveedor_direccion = datos.proveedorDireccion;
  if (datos.proveedorComuna) doc.proveedor_comuna = datos.proveedorComuna;
  if (datos.proveedorEmail) doc.proveedor_email = datos.proveedorEmail;
  if (datos.proveedorTelefono) doc.proveedor_telefono = datos.proveedorTelefono;
  if (datos.concepto) doc.oc_concepto = datos.concepto;
  if (datos.centroCostoId) doc.oc_centro_costo = datos.centroCostoId;

  const json = await llamarPost<any>(BASE_V1, '/comprasOc.create.json', { docs: [doc] });
  // Mismo patrón que productos.create.json: la respuesta no siempre trae el ID en un campo
  // predecible — se busca en las formas conocidas antes de rendirse.
  const detalle: string = json.result?.result_detail || json.result_detail || '';
  const compraOcId = json.data?.[0]?.compra_oc_id || json.data?.compra_oc_id || json.compra_oc_id
    || detalle.match(/compra_oc_id\s*:\s*(\d+)/i)?.[1];
  if (!compraOcId) throw new Error(`Obuma no devolvió el ID de la orden de compra creada: ${JSON.stringify(json).slice(0, 300)}`);

  const verificada = await compraOcPorId(String(compraOcId));
  if (!verificada) throw new Error(`Obuma creó la orden de compra ${compraOcId} pero no se pudo releer para confirmarla.`);

  return {
    compraOcId: String(compraOcId),
    folio: verificada.compra_oc_folio ? String(verificada.compra_oc_folio) : null,
    subtotalNeto, iva, total,
  };
}

/** Crea el proveedor DE VERDAD en Obuma — escritura real, y a propósito NUNCA automática: pedido
 *  explícito del usuario (10-sep-2026) de que la creación del proveedor sea una acción consciente
 *  con un formulario que muestre TODOS los campos que la API acepta (no un subconjunto elegido por
 *  Licitank) — nunca disparada sola al emitir una orden de compra. `proveedor_rut` es lo único
 *  obligatorio para la API; el resto queda a discreción de quien llena el formulario.
 *
 *  OJO — el formulario WEB real de Obuma pide bastante más que esto (Tipo de proveedor, Centro de
 *  costo, Forma de pago, Banco/cuenta bancaria, Tags, "permitir DTE sin O.C."): el usuario mandó un
 *  volcado completo de ese formulario el 10-sep-2026. Esos campos NO están en la documentación
 *  pública de /proveedores.create.json (obuma.cl/ayuda/articulo/157) — solo aparecen `proveedor_*`
 *  básicos + `cuenta_contable` (documentado recién en el endpoint update, pero "todos los
 *  parámetros del create son aplicables" según esa misma doc). Adivinar el nombre de los campos de
 *  configuración contable/bancaria (centro de costo, forma de pago, banco) es demasiado riesgoso —
 *  un nombre de campo equivocado podría clasificar mal la cuenta sin que nadie se entere (regla
 *  "nunca inventar datos" aplicada acá: no se manda nada cuyo nombre de campo no esté confirmado).
 *  Esos datos de configuración financiera se completan después, directo en Obuma. */
export interface DatosCrearProveedorObuma {
  rut: string; razonSocial: string; nombreFantasia?: string | null; contacto?: string | null; giro?: string | null;
  esSupermercado?: boolean; esFactoring?: boolean;
  direccion?: string | null; comuna?: string | null; region?: string | null;
  pais?: string | null; telefono?: string | null; celular?: string | null; email?: string | null;
  website?: string | null; observacion?: string | null; cuentaContable?: string | null;
}
export async function crearProveedorObuma(datos: DatosCrearProveedorObuma): Promise<{ proveedorId: string }> {
  const payload: Record<string, unknown> = {
    proveedor_rut: datos.rut, proveedor_razon_social: datos.razonSocial,
  };
  if (datos.nombreFantasia) payload.proveedor_nombre_fantasia = datos.nombreFantasia;
  if (datos.contacto) payload.proveedor_contacto = datos.contacto;
  if (datos.giro) payload.proveedor_giro_comercial = datos.giro;
  if (datos.esSupermercado) payload.proveedor_es_supermercado = '1';
  if (datos.esFactoring) payload.proveedor_es_factoring = '1';
  if (datos.direccion) payload.proveedor_direccion = datos.direccion;
  if (datos.comuna) payload.proveedor_comuna = datos.comuna;
  if (datos.region) payload.proveedor_region = datos.region;
  if (datos.pais) payload.proveedor_pais = datos.pais;
  if (datos.telefono) payload.proveedor_telefono = datos.telefono;
  if (datos.celular) payload.proveedor_celular = datos.celular;
  if (datos.email) payload.proveedor_email = datos.email;
  if (datos.website) payload.proveedor_website = datos.website;
  if (datos.observacion) payload.proveedor_observacion = datos.observacion;
  if (datos.cuentaContable) payload.cuenta_contable = datos.cuentaContable;

  const json = await llamarPost<any>(BASE_V1, '/proveedores.create.json', payload);
  const detalle: string = json.result?.result_detail || json.result_detail || '';
  const proveedorId = json.data?.proveedor_id || json.proveedor_id || detalle.match(/proveedor_id\s*:\s*(\d+)/i)?.[1];
  if (!proveedorId) throw new Error(`Obuma no devolvió el ID del proveedor creado: ${JSON.stringify(json).slice(0, 300)}`);

  // Verificación de lectura — mismo criterio que crearProductoObuma/crearOrdenCompraObuma.
  const verificado = await proveedorPorRut(datos.rut);
  if (!verificado) throw new Error(`Obuma creó el proveedor ${proveedorId} pero no se pudo releer por RUT para confirmarlo.`);
  return { proveedorId: String(proveedorId) };
}
