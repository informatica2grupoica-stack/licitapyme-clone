// app/lib/compras-fichas.ts
// FICHAS TÉCNICAS EN COMPRAS: «¿lo que vamos a comprar cumple lo que piden las bases?». Reusa el motor del Auditor
// (Lector → opción de la línea → comparador técnico v3.0, una llamada por línea) y le agrega lo que faltaba para
// trabajar con MUCHAS fichas juntas: el RUTEO AUTOMÁTICO. Se suben N fichas sin decir de qué son y el sistema
//   1) lee cada una (Lector, una sola vez por documento) y saca marca / modelo / producto,
//   2) decide a qué producto (línea) corresponde — primero por código (palabras, modelo, cantidad) y lo dudoso lo
//      resuelve la IA en UNA llamada por documento; solo asigna sola con confianza ALTA, lo demás queda «por confirmar»,
//   3) decide de qué PROVEEDOR es: el modelo aparece en el texto de una cotización, o es el único proveedor cotizado
//      para ese producto; si hay varios y nada decide, queda para elegir (nunca se adivina),
//   4) la deja como respaldo `ficha_tecnica` de una opción (producto + proveedor) del Auditor.
// Comparar es una acción aparte (una llamada de IA por producto, compara a todos sus proveedores juntos).
//
// INDEPENDIENTE DEL AUDITOR: Compras tiene sus propias fichas. Las opciones de Compras viven en las mismas tablas del motor
// pero en un ESPACIO PROPIO (`fila_id = 'cmp:<línea>'`): el Auditor no las ve en su pantalla ni las mezcla en sus comparaciones,
// y este panel no lee nada del Auditor (ni sus opciones, ni sus fichas, ni sus resultados). Solo se comparte el motor y los
// requisitos de las bases.
export const ESPACIO = 'cmp:';
const filaCmp = (filaId: string) => `${ESPACIO}${filaId}`;
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { cargarEstadoCosteo, lineasAuditables, type Actor } from '@/app/lib/auditor-opciones';
import { verificarLineaV3, ultimasCorridasV3, confirmacionesTecnicas, ultimasSegundasPasadasV3, estadoTecnicoV3 } from '@/app/lib/auditor-comparador-v3';
import { leerYGuardarDocumento, extraccionPorId } from '@/app/lib/auditor-lector';
import { normalizarExtraccion, emparejarProductos, coincidenciaIdentidad, type ProductoNormalizado } from '@/app/lib/auditor-opciones-core';
import { sugerirLineas } from '@/app/lib/auditor-sugerir-linea';
import { listarCotizaciones, type CotizacionFila } from '@/app/lib/compras-auditor';
import { listarProductosCompra, type ProductoCompra } from '@/app/lib/compras';
import type { LineaCosteo } from '@/app/lib/auditor-compras-core';

const norm = (s: string | null | undefined) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// ── ¿Es de verdad una ficha técnica de un producto identificable? ───────────────────────────────────
/** Una ficha de fabricante dice QUÉ producto es: marca, o un modelo con letras (no solo «55"»). La propuesta técnica de la oferta
 *  («Televisor 55", 4K…») describe lo pedido, no un producto real, y no sirve para comparar. */
export function identificable(p: { marca?: string | null; modelo?: string | null; sku?: string | null }): boolean {
  if (norm(p.marca).length >= 2) return true;
  const m = norm(p.modelo);
  if (m.length >= 4 && /[a-z]/.test(m)) return true;
  return norm(p.sku).length >= 4;
}

/** El Lector clasifica el documento: una cotización / presupuesto / factura sirve para el PRECIO, no para juzgar el producto. */
export function esDocumentoComercial(tipo: string | null | undefined): boolean {
  return /cotiz|presupuesto|proforma|factura|orden de compra|boleta|nota de venta/i.test(tipo || '');
}

// ── Producto de Compras ↔ línea del costeo (mismo criterio que costeadoDeProducto) ─────────────────
export function lineaDeProducto(prod: ProductoCompra, lineas: LineaCosteo[]): LineaCosteo | null {
  if (prod.correlativo != null) {
    const porNum = lineas.filter(l => l.lineaReal === prod.correlativo);
    if (porNum.length === 1) return porNum[0];
  }
  const d = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  return lineas.find(l => d(l.detalle) === d(String(prod.descripcion))) ?? null;
}
const productoDeLinea = (linea: LineaCosteo, productos: ProductoCompra[]): ProductoCompra | null =>
  productos.find(p => lineaDeProducto(p, [linea])?.id === linea.id) ?? null;

// ── Proveedor de una ficha ─────────────────────────────────────────────────────────────────────────
export interface ProveedorElegido { proveedor: string | null; rut: string | null; confianza: 'alta' | 'media' | null; motivo: string; candidatos: string[] }

/** Entre los proveedores que cotizaron ESE producto: el que menciona el modelo en su cotización, o el único cotizado. */
export function proveedorDeFicha(ficha: { marca: string; modelo: string; sku: string }, cotizaciones: CotizacionFila[]): ProveedorElegido {
  const nombres = [...new Set(cotizaciones.map(c => c.proveedorNombre))];
  if (cotizaciones.length === 0) return { proveedor: null, rut: null, confianza: null, motivo: 'Nadie ha cotizado este producto todavía.', candidatos: [] };
  const claves = [norm(ficha.modelo), norm(ficha.sku)].filter(k => k.length >= 3);
  if (claves.length) {
    const mencionan = cotizaciones.filter(c => { const t = norm(c.descripcionLibre); return claves.some(k => t.includes(k)); });
    const prov = [...new Set(mencionan.map(c => c.proveedorNombre))];
    if (prov.length === 1) return { proveedor: prov[0], rut: mencionan[0].proveedorRut, confianza: 'alta', motivo: `El modelo ${ficha.modelo || ficha.sku} aparece en la cotización de ${prov[0]}.`, candidatos: nombres };
  }
  if (nombres.length === 1) return { proveedor: nombres[0], rut: cotizaciones[0].proveedorRut, confianza: 'media', motivo: `${nombres[0]} es el único proveedor cotizado para este producto.`, candidatos: nombres };
  return { proveedor: null, rut: null, confianza: null, motivo: 'Hay varios proveedores cotizados y ninguna cotización menciona el modelo: elige cuál es.', candidatos: nombres };
}

// ── Estado de lo ya asignado / pendiente ───────────────────────────────────────────────────────────
async function productosYaAsignados(negocioId: number, extraccionId: number): Promise<Set<number>> {
  const [rows] = await pool.query(
    `SELECT r.producto_idx FROM auditor_respaldo r JOIN auditor_opcion o ON o.id = r.opcion_id
      WHERE r.extraccion_id = ? AND r.tipo = 'ficha_tecnica' AND r.vigente = 1 AND o.estado <> 'descartada' AND o.negocio_id = ? AND o.fila_id LIKE 'cmp:%'`, [extraccionId, negocioId]) as any;
  return new Set((rows as any[]).map(r => Number(r.producto_idx)));
}

async function guardarSugerencia(negocioId: number, extraccionId: number, idx: number, filaId: string | null, item: number | null, confianza: string, motivo: string) {
  await pool.query(
    `INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, 0, 'sugerencia_linea', 'asistente', ?, ?)`,
    [negocioId, JSON.stringify({ extraccionId, idx, filaId, item, confianza, motivo, ficha: true }), ahoraChileSQL()]).catch(() => {});
}

/** Marca un documento como «ficha que pasó por Compras»: solo esas aparecen en el panel de Compras (el Auditor lee muchos documentos más). */
async function marcarFichaCompras(negocioId: number, extraccionId: number) {
  const [ya] = await pool.query(`SELECT id FROM auditor_evento WHERE negocio_id = ? AND tipo = 'ficha_compras' AND detalle = ? LIMIT 1`, [negocioId, String(extraccionId)]) as any;
  if ((ya as any[]).length) return;
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, 0, 'ficha_compras', 'asistente', ?, ?)`, [negocioId, String(extraccionId), ahoraChileSQL()]).catch(() => {});
}

// ── Asignar un producto de una ficha a un producto de Compras (+ proveedor) ─────────────────────────
export interface ResultadoAsignacion { ok: boolean; opcionId?: number; proveedor: string | null; motivoProveedor: string; candidatosProveedor: string[]; error?: string }

async function opcionParaFicha(negocioId: number, filaId: string, p: ProductoNormalizado, proveedor: string | null, rut: string | null, actor: Actor): Promise<number> {
  const [existentes] = await pool.query(
    `SELECT id, marca, modelo, sku_proveedor, proveedor_razon_social FROM auditor_opcion WHERE negocio_id = ? AND fila_id = ? AND estado NOT IN ('descartada','en_aprobacion','aprobada')`,
    [negocioId, filaCmp(filaId)]) as any;
  const mismas = (existentes as any[]).filter(o => coincidenciaIdentidad({ marca: o.marca, modelo: o.modelo, sku: o.sku_proveedor }, p) === 'coincide');
  const prov = (proveedor || '').trim().toLowerCase();
  // La misma marca/modelo del mismo proveedor, o la que todavía no tenía proveedor (se le pone): nunca se duplica la opción.
  const elegida = mismas.find(o => (o.proveedor_razon_social || '').trim().toLowerCase() === prov && prov)
    ?? (prov ? mismas.find(o => !(o.proveedor_razon_social || '').trim()) : mismas[0]);
  const ahora = ahoraChileSQL();
  if (elegida) {
    if (prov && !(elegida.proveedor_razon_social || '').trim()) {
      await pool.query(`UPDATE auditor_opcion SET proveedor_razon_social = ?, proveedor_rut = COALESCE(proveedor_rut, ?), actualizado_at = ? WHERE id = ?`, [proveedor, rut, ahora, elegida.id]);
    }
    return elegida.id as number;
  }
  if (!p.marca && !p.modelo) throw new Error('La ficha no dice la marca ni el modelo del producto: no se puede identificar.');
  const [ins] = await pool.query(
    `INSERT INTO auditor_opcion (negocio_id, fila_id, marca, modelo, version_producto, sku_proveedor, proveedor_razon_social, proveedor_rut, via, estado, origen, creado_por, creado_por_nombre, creado_at, actualizado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completa', 'tanteo', 'compras', ?, ?, ?, ?)`,
    [negocioId, filaCmp(filaId), (p.marca || '').slice(0, 120) || null, (p.modelo || '').slice(0, 160) || null, p.version || null, (p.sku || '').slice(0, 120) || null,
      proveedor ? proveedor.slice(0, 200) : null, rut, actor.id, actor.nombre, ahora, ahora]) as any;
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, 'opcion_creada', 'asistente', ?, ?)`,
    [negocioId, ins.insertId, `Opción creada desde una ficha técnica (Compras) por ${actor.nombre}`, ahora]).catch(() => {});
  return ins.insertId as number;
}

/** Deja la ficha como respaldo `ficha_tecnica` de la opción de Compras. Una ficha no trae precio: nunca sostiene el costo. */
async function agregarFichaCompras(p: { negocioId: number; opcionId: number; extraccionId: number; url: string; nombre: string; producto: ProductoNormalizado; actor: Actor }): Promise<void> {
  const { negocioId, opcionId, extraccionId, url, nombre, producto, actor } = p;
  const [ya] = await pool.query(`SELECT id FROM auditor_respaldo WHERE opcion_id = ? AND tipo = 'ficha_tecnica' AND documento_url = ? AND producto_idx = ?`, [opcionId, url, producto.idx]) as any;
  if ((ya as any[]).length) return;
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO auditor_respaldo (opcion_id, negocio_id, tipo, url, documento_url, documento_nombre, precio_declarado, precio_iva, vigente, sostiene_costo,
       origen, cargado_por, cargado_por_nombre, cargado_at, extraccion_id, producto_idx)
     VALUES (?, ?, 'ficha_tecnica', NULL, ?, ?, NULL, 'no_declarado', 1, 0, 'compras', ?, ?, ?, ?, ?)`,
    [opcionId, negocioId, url, nombre.slice(0, 300), actor.id, actor.nombre, ahora, extraccionId, producto.idx]);
  await pool.query(
    `UPDATE auditor_opcion SET marca = COALESCE(NULLIF(marca, ''), ?), modelo = COALESCE(NULLIF(modelo, ''), ?), version_producto = COALESCE(NULLIF(version_producto, ''), ?),
       sku_proveedor = COALESCE(NULLIF(sku_proveedor, ''), ?), actualizado_at = ? WHERE id = ?`,
    [producto.marca || null, producto.modelo || null, producto.version || null, producto.sku || null, ahora, opcionId]);
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, 'documento_nuevo', 'lector', ?, ?)`,
    [negocioId, opcionId, `Ficha técnica (Compras): ${nombre}`, ahora]).catch(() => {});
}

export async function asignarProductoDeFicha(params: {
  negocioId: number; extraccionId: number; productoIdx: number; filaId: string; proveedor?: string | null; actor: Actor;
}): Promise<ResultadoAsignacion> {
  const { negocioId, extraccionId, productoIdx, filaId, actor } = params;
  const ex = await extraccionPorId(extraccionId);
  if (!ex?.data || !ex.documentoUrl) return { ok: false, proveedor: null, motivoProveedor: '', candidatosProveedor: [], error: 'La ficha no existe o no se pudo leer.' };
  const p = normalizarExtraccion(ex.data).find(x => x.idx === productoIdx);
  if (!p) return { ok: false, proveedor: null, motivoProveedor: '', candidatosProveedor: [], error: 'Ese producto no está en la ficha.' };
  if (!identificable(p)) return { ok: false, proveedor: null, motivoProveedor: '', candidatosProveedor: [], error: 'Este documento no trae la marca ni un modelo identificable: no es una ficha de un producto real (¿es la propuesta técnica?).' };
  const lineas = lineasAuditables(await cargarEstadoCosteo(negocioId));
  const linea = lineas.find(l => l.id === filaId);
  if (!linea) return { ok: false, proveedor: null, motivoProveedor: '', candidatosProveedor: [], error: 'Ese producto no tiene línea en el Costeo.' };

  const [productos, cotizaciones] = await Promise.all([listarProductosCompra(negocioId), listarCotizaciones(negocioId)]);
  const prodCompra = productoDeLinea(linea, productos);
  const cubren = prodCompra ? cotizaciones.filter(c => c.items.some(i => i.productoId === prodCompra.id && i.precioUnitario != null)) : [];
  let prov: ProveedorElegido;
  if (params.proveedor?.trim()) {
    const c = cubren.find(x => x.proveedorNombre === params.proveedor!.trim()) ?? cotizaciones.find(x => x.proveedorNombre === params.proveedor!.trim());
    prov = { proveedor: params.proveedor.trim(), rut: c?.proveedorRut ?? null, confianza: 'alta', motivo: 'Elegido a mano.', candidatos: [...new Set(cubren.map(x => x.proveedorNombre))] };
  } else prov = proveedorDeFicha(p, cubren);

  try {
    const opcionId = await opcionParaFicha(negocioId, filaId, p, prov.proveedor, prov.rut, actor);
    await agregarFichaCompras({ negocioId, opcionId, extraccionId, url: ex.documentoUrl, nombre: ex.documentoNombre || 'ficha', producto: p, actor });
    return { ok: true, opcionId, proveedor: prov.proveedor, motivoProveedor: prov.motivo, candidatosProveedor: prov.candidatos };
  } catch (e) {
    return { ok: false, proveedor: prov.proveedor, motivoProveedor: prov.motivo, candidatosProveedor: prov.candidatos, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── RUTEO: una ficha (PDF/imagen) → producto + proveedor ───────────────────────────────────────────
export interface ProductoRuteado {
  idx: number; nombre: string; marca: string; modelo: string;
  resultado: 'asignada' | 'por_confirmar' | 'sin_producto' | 'ya_asignada' | 'no_es_ficha' | 'sin_identificar' | 'error';
  productoCompraId?: number | null; productoNombre?: string; proveedor?: string | null; opcionId?: number;
  confianza?: string; motivo?: string; candidatosProveedor?: string[];
}
export interface ResultadoRuteo { documento: string; extraccionId: number | null; error: string | null; productos: ProductoRuteado[] }

const corto = (s: string) => s.replace(/\s+/g, ' ').trim().split(' - ')[0].slice(0, 80);

export async function procesarFicha(params: { negocioId: number; url: string; nombre: string; actor: Actor }): Promise<ResultadoRuteo> {
  const { negocioId, url, nombre, actor } = params;
  const vacio = (error: string, extraccionId: number | null = null): ResultadoRuteo => ({ documento: nombre, extraccionId, error, productos: [] });

  // 1) Leer UNA sola vez.
  const [previas] = await pool.query(`SELECT id FROM auditor_extraccion WHERE negocio_id = ? AND documento_url = ? AND error IS NULL AND modo = 'completo' ORDER BY id DESC LIMIT 1`, [negocioId, url]) as any;
  let extraccionId: number;
  if ((previas as any[]).length) extraccionId = (previas as any[])[0].id;
  else {
    const lectura = await leerYGuardarDocumento({ negocioId, url, nombre, modo: 'completo' });
    await marcarFichaCompras(negocioId, lectura.id);
    if (lectura.error) return vacio(`No se pudo leer: ${lectura.error}`, lectura.id);
    extraccionId = lectura.id;
  }
  await marcarFichaCompras(negocioId, extraccionId);
  const ex = await extraccionPorId(extraccionId);
  if (!ex?.data) return vacio('La ficha se leyó pero quedó vacía.', extraccionId);
  const productos = normalizarExtraccion(ex.data).filter(p => !p.esCargo);
  if (productos.length === 0) return vacio('No encontré ningún producto en el documento (¿es una ficha legible?).', extraccionId);

  // Un documento comercial (cotización, factura…) no es una ficha: sirve para el precio. Se informa y no se asigna.
  const tipoDoc = ex.data.salida.documento?.tipo || '';
  if (esDocumentoComercial(tipoDoc)) {
    const quien = ex.data.salida.documento?.emisor ? ` de ${ex.data.salida.documento.emisor}` : '';
    return { documento: nombre, extraccionId, error: null, productos: productos.map(p => ({ idx: p.idx, nombre: p.nombre, marca: p.marca, modelo: p.modelo, resultado: 'no_es_ficha' as const, motivo: `Es ${tipoDoc.replace(/_/g, ' ').toLowerCase()}${quien}: sirve para el precio (paso 2), no para juzgar si el producto cumple. Sube la ficha técnica del producto.` })) };
  }

  const lineas = lineasAuditables(await cargarEstadoCosteo(negocioId));
  if (lineas.length === 0) return vacio('Este negocio no tiene un costeo con líneas: no hay a qué producto asignar la ficha.', extraccionId);
  const productosCompra = await listarProductosCompra(negocioId);
  const yaAsignados = await productosYaAsignados(negocioId, extraccionId);
  const sinIdentidad = new Set(productos.filter(p => !identificable(p)).map(p => p.idx));

  const salida: ProductoRuteado[] = productos.map(p => ({ idx: p.idx, nombre: p.nombre, marca: p.marca, modelo: p.modelo, resultado: 'sin_producto' as const }));
  const de = (idx: number) => salida.find(s => s.idx === idx)!;
  for (const p of productos) {
    if (yaAsignados.has(p.idx)) de(p.idx).resultado = 'ya_asignada';
    else if (sinIdentidad.has(p.idx)) { const s = de(p.idx); s.resultado = 'sin_identificar'; s.motivo = 'No trae marca ni un modelo identificable: parece una descripción genérica (¿la propuesta técnica?), no la ficha de un producto real.'; }
  }
  const pendientes = productos.filter(p => !yaAsignados.has(p.idx) && !sinIdentidad.has(p.idx));

  // 2) ¿A qué línea? Primero por código (solo lo ALTO se asigna sin preguntar) …
  const decision = new Map<number, { filaId: string; confianza: 'alta' | 'media'; motivo: string }>();
  const { asignaciones, sinEmparejar } = emparejarProductos(pendientes, lineas, 0.5);
  const dudosos: number[] = [...sinEmparejar];
  for (const a of asignaciones) {
    if (a.confianza === 'alta') decision.set(a.productoIdx, { filaId: a.filaId, confianza: 'alta', motivo: `Coincide por ${a.motivos.join(', ')}.` });
    else dudosos.push(a.productoIdx);
  }
  // … y lo dudoso lo resuelve la IA, UNA llamada por documento.
  if (dudosos.length) {
    try {
      const sug = await sugerirLineas(
        dudosos.map(idx => { const p = productos.find(x => x.idx === idx)!; return { idx, nombre: p.nombre || `${p.marca} ${p.modelo}`, precioNeto: null, cantidad: null, proveedor: '' }; }),
        lineas.map(l => ({ item: l.item, filaId: l.id, detalle: l.detalle, cantidad: l.cantidad, costoNeto: l.costoEstimadoNeto })));
      for (const x of sug) {
        if (x.filaId && x.confianza === 'alta') decision.set(x.idx, { filaId: x.filaId, confianza: 'alta', motivo: x.motivo });
        else {
          const s = de(x.idx);
          s.resultado = x.filaId ? 'por_confirmar' : 'sin_producto';
          s.motivo = x.motivo;
          if (x.filaId) { s.productoCompraId = productoDeLinea(lineas.find(l => l.id === x.filaId)!, productosCompra)?.id ?? null; s.confianza = x.confianza; }
          await guardarSugerencia(negocioId, extraccionId, x.idx, x.filaId, x.item, x.confianza, x.motivo);
        }
      }
    } catch (e) {
      for (const idx of dudosos) { const s = de(idx); s.resultado = 'sin_producto'; s.motivo = `No se pudo decidir con la IA (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}): asígnala a mano.`; }
    }
  }

  // 3) Asignar lo decidido (proveedor + opción + ficha).
  for (const [idx, d] of decision) {
    const s = de(idx);
    const linea = lineas.find(l => l.id === d.filaId)!;
    const prod = productoDeLinea(linea, productosCompra);
    s.productoCompraId = prod?.id ?? null; s.productoNombre = prod ? corto(prod.descripcion) : corto(linea.detalle); s.confianza = d.confianza;
    const r = await asignarProductoDeFicha({ negocioId, extraccionId, productoIdx: idx, filaId: d.filaId, actor });
    s.candidatosProveedor = r.candidatosProveedor;
    if (!r.ok) { s.resultado = 'error'; s.motivo = r.error; continue; }
    s.resultado = 'asignada'; s.opcionId = r.opcionId; s.proveedor = r.proveedor; s.motivo = `${d.motivo} ${r.motivoProveedor}`.trim();
  }
  return { documento: nombre, extraccionId, error: null, productos: salida };
}

// ── Cambiar el proveedor de una opción ─────────────────────────────────────────────────────────────
export async function cambiarProveedorDeOpcion(negocioId: number, opcionId: number, proveedor: string | null): Promise<void> {
  const [rows] = await pool.query(`SELECT id FROM auditor_opcion WHERE id = ? AND negocio_id = ?`, [opcionId, negocioId]) as any;
  if (!(rows as any[])[0]) throw new Error('La opción no existe en este negocio.');
  const cotizaciones = await listarCotizaciones(negocioId);
  const c = proveedor ? cotizaciones.find(x => x.proveedorNombre === proveedor) : null;
  await pool.query(`UPDATE auditor_opcion SET proveedor_razon_social = ?, proveedor_rut = ?, actualizado_at = ? WHERE id = ?`, [proveedor || null, c?.proveedorRut ?? null, ahoraChileSQL(), opcionId]);
}

// ── Comparar un producto contra las bases ──────────────────────────────────────────────────────────
export async function compararProducto(params: { negocioId: number; licitacionCodigo: string; productoCompraId: number; actor: Actor }) {
  const { negocioId, licitacionCodigo, productoCompraId, actor } = params;
  const [productos, estado] = await Promise.all([listarProductosCompra(negocioId), cargarEstadoCosteo(negocioId)]);
  const prod = productos.find(p => p.id === productoCompraId);
  if (!prod) throw new Error('Ese producto no pertenece a este negocio.');
  const linea = lineaDeProducto(prod, lineasAuditables(estado));
  if (!linea) throw new Error('Este producto no tiene una línea en el Costeo: no hay requisitos de las bases contra los que comparar.');
  const [ops] = await pool.query(
    `SELECT o.id FROM auditor_opcion o WHERE o.negocio_id = ? AND o.fila_id = ? AND o.via = 'completa' AND o.estado IN ('tanteo','formalizada','verificada','definitiva')
        AND EXISTS (SELECT 1 FROM auditor_respaldo r WHERE r.opcion_id = o.id AND r.tipo = 'ficha_tecnica' AND r.vigente = 1) ORDER BY o.id`, [negocioId, filaCmp(linea.id)]) as any;
  if ((ops as any[]).length === 0) throw new Error('Este producto todavía no tiene fichas técnicas asignadas.');
  // Una sola llamada compara a TODAS las opciones de Compras de la línea entre sí contra los mismos requisitos de las bases.
  return verificarLineaV3({
    negocioId, licitacionCodigo, filaId: filaCmp(linea.id), lineaReal: linea.lineaReal, nombreLinea: linea.detalle.split(' - ')[0] || linea.detalle,
    cantidad: linea.cantidad, unidad: linea.unidad, actor,
  });
}

// ── Panel ──────────────────────────────────────────────────────────────────────────────────────────
/** Dato que una persona aportó para cerrar un «Falta dato», con su decisión y quién la tomó. */
export interface ComplementoRequisito { resultado: 'CUMPLE' | 'NO_CUMPLE'; dato: string; fuente: string; por: string; at: string }
export interface FilaRequisito {
  n: number; requerido: string; criticidad: string;
  /** Estado que RIGE (el de la IA, o el que decidió una persona al complementar un «Falta dato»). */
  estado: string;
  /** Lo que dijo la IA antes de cualquier complemento. */
  estadoIA: string;
  valor: string; cita: string; rojo: boolean; confirmada: boolean;
  complemento: ComplementoRequisito | null;
}
export interface OpcionFichaDTO {
  opcionId: number; marca: string | null; modelo: string | null; proveedor: string | null; proveedorRut: string | null;
  fichas: Array<{ nombre: string; url: string | null }>;
  tecnico: {
    estado: string; corridoAt: string | null; error: string | null; requisitosTotal: number; sinFicha: boolean;
    resumen: { total: number; cumple: number; noCumple: number; sinVeredicto: number } | null;
    preguntas: Array<{ n: number; texto: string }>; filas: FilaRequisito[]; notas: string[];
  };
}
export interface ProductoFichasDTO {
  productoId: number; descripcion: string; cantidad: number | null; filaId: string | null; lineaReal: number | null;
  cotizados: Array<{ proveedor: string; precioUnit: number | null }>;
  opciones: OpcionFichaDTO[];
}
export interface FichaPendienteDTO {
  extraccionId: number; idx: number; documento: string; url: string | null; nombre: string; marca: string; modelo: string;
  sugerencia: { filaId: string | null; productoCompraId: number | null; confianza: string; motivo: string } | null;
}
export interface PanelFichasDTO {
  productos: ProductoFichasDTO[]; pendientes: FichaPendienteDTO[]; conError: Array<{ extraccionId: number; documento: string; error: string; url: string | null }>;
  /** Documentos que pasaron por aquí pero no son fichas de un producto (cotizaciones, propuesta técnica genérica…). */
  noSonFichas: Array<{ extraccionId: number; documento: string; motivo: string }>;
  sinCosteo: boolean;
}

export async function panelFichas(negocioId: number, licitacionCodigo: string): Promise<PanelFichasDTO> {
  const [productos, estado, cotizaciones] = await Promise.all([listarProductosCompra(negocioId), cargarEstadoCosteo(negocioId), listarCotizaciones(negocioId)]);
  const lineas = lineasAuditables(estado);
  const vigentes = productos.filter(p => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado));
  // Solo lo de Compras (espacio `cmp:`): opciones, sus fichas y sus resultados. Nada del Auditor.
  const [opsRows] = await pool.query(`SELECT id, fila_id, marca, modelo, proveedor_razon_social, proveedor_rut FROM auditor_opcion WHERE negocio_id = ? AND fila_id LIKE 'cmp:%' AND estado <> 'descartada' ORDER BY id`, [negocioId]) as any;
  const [respRows] = await pool.query(`SELECT opcion_id, documento_nombre, documento_url FROM auditor_respaldo WHERE negocio_id = ? AND tipo = 'ficha_tecnica' AND vigente = 1 ORDER BY id`, [negocioId]) as any;
  const [corridas, conf, segundas] = await Promise.all([ultimasCorridasV3(negocioId), confirmacionesTecnicas(negocioId), ultimasSegundasPasadasV3(negocioId)]);
  const complementos = await complementosDeCompras(negocioId);

  const salida: ProductoFichasDTO[] = vigentes.map(p => {
    const linea = lineaDeProducto(p, lineas);
    const opciones: OpcionFichaDTO[] = (opsRows as any[]).filter(o => linea && o.fila_id === filaCmp(linea.id)).map(o => {
      const t = estadoTecnicoV3(corridas.get(o.id), conf.get(o.id), segundas.get(o.id)?.celdas);
      const r = t.resultado;
      // Un «Falta dato» que una persona complementó pasa a Cumple / No cumple (con su nombre y fecha). Solo se aplica mientras la IA siga
      // sin dato: si una ficha nueva ya trae el dato, manda lo que dice la ficha.
      const filas: FilaRequisito[] = (r?.filas || []).map(f => {
        const ia = String(f.estadoCelda || f.veredicto);
        const comp = ia === 'FALTA_DATO' || ia === 'SIN_VEREDICTO' ? (complementos.get(`${o.id}:${f.n}`) ?? null) : null;
        return {
          n: f.n, requerido: f.requeridoTexto, criticidad: f.criticidad, estado: comp ? comp.resultado : ia, estadoIA: ia, valor: comp ? comp.dato : f.valorCorto,
          cita: comp ? '' : (f.partes?.[0]?.citaOriginal || ''), rojo: f.rojo, confirmada: !!f.confirmada, complemento: comp,
        };
      });
      const esCumple = (e: string) => e === 'CUMPLE' || e === 'SOBRECUMPLE' || e === 'CUMPLE_CON_COMPLEMENTO';
      const resumen = r ? { total: filas.length, cumple: filas.filter(f => esCumple(f.estado)).length, noCumple: filas.filter(f => f.estado === 'NO_CUMPLE').length, sinVeredicto: filas.filter(f => f.estado === 'FALTA_DATO' || f.estado === 'SIN_VEREDICTO').length } : null;
      const estadoEfectivo = !r ? 'NO_CORRIDO' : resumen!.noCumple > 0 ? 'NO_CUMPLE' : resumen!.sinVeredicto > 0 ? 'CON_PENDIENTES' : 'CUMPLE';
      const cerradas = new Set(filas.filter(f => f.complemento).map(f => f.n));
      return {
        opcionId: o.id, marca: o.marca, modelo: o.modelo, proveedor: o.proveedor_razon_social, proveedorRut: o.proveedor_rut,
        fichas: (respRows as any[]).filter(x => x.opcion_id === o.id).map(x => ({ nombre: x.documento_nombre || 'ficha', url: x.documento_url })),
        tecnico: {
          estado: estadoEfectivo, corridoAt: t.corridoAt, error: t.error, requisitosTotal: r?.resumen.total ?? 0, sinFicha: !!r?.sinFicha,
          resumen,
          preguntas: (r?.preguntas || []).filter(q => !cerradas.has(q.n)).map(q => ({ n: q.n, texto: q.texto })),
          notas: r?.notas || [],
          filas,
        },
      };
    });
    const cubren = cotizaciones.filter(c => c.items.some(i => i.productoId === p.id && i.precioUnitario != null));
    return {
      productoId: p.id, descripcion: corto(p.descripcion), cantidad: p.cantidad, filaId: linea?.id ?? null, lineaReal: linea?.lineaReal ?? null,
      cotizados: cubren.map(c => ({ proveedor: c.proveedorNombre, precioUnit: c.items.find(i => i.productoId === p.id)?.precioUnitario ?? null })),
      opciones,
    };
  });

  // Fichas que pasaron por este panel y todavía no están en ningún producto (la lectura más reciente de cada documento).
  const [marcadas] = await pool.query(`SELECT detalle FROM auditor_evento WHERE negocio_id = ? AND tipo = 'ficha_compras' ORDER BY id DESC LIMIT 400`, [negocioId]) as any;
  const lecturas = new Map<string, Awaited<ReturnType<typeof extraccionPorId>>>();
  for (const m of marcadas as any[]) {
    const ex = await extraccionPorId(Number(m.detalle));
    if (!ex) continue;
    const k = ex.documentoUrl || String(ex.id);
    const previa = lecturas.get(k);
    if (!previa || ex.id > previa.id) lecturas.set(k, ex);
  }
  const [asig] = await pool.query(
    `SELECT r.extraccion_id, r.producto_idx FROM auditor_respaldo r JOIN auditor_opcion o ON o.id = r.opcion_id
      WHERE r.negocio_id = ? AND r.tipo = 'ficha_tecnica' AND r.vigente = 1 AND o.estado <> 'descartada' AND o.fila_id LIKE 'cmp:%'`, [negocioId]) as any;
  const asignado = new Set((asig as any[]).map(r => `${r.extraccion_id}:${r.producto_idx}`));
  const [evs] = await pool.query(`SELECT detalle FROM auditor_evento WHERE negocio_id = ? AND tipo = 'sugerencia_linea' ORDER BY id`, [negocioId]) as any;
  const sugerencias = new Map<string, any>();
  for (const e of evs as any[]) { try { const d = JSON.parse(e.detalle); if (d?.ficha) sugerencias.set(`${d.extraccionId}:${d.idx}`, d); } catch { /* evento mal formado */ } }

  // Un catálogo con varias variantes (p. ej. «Activa» y «Pasiva») donde ya se asignó un producto: las otras variantes no son pendientes.
  const docsConAsignado = new Set([...asignado].map(k => k.split(':')[0]));
  const pendientes: FichaPendienteDTO[] = []; const conError: PanelFichasDTO['conError'] = []; const noSonFichas: PanelFichasDTO['noSonFichas'] = [];
  for (const ex of lecturas.values()) {
    if (!ex) continue;
    if (ex.error) { conError.push({ extraccionId: ex.id, documento: ex.documentoNombre || 'documento', error: ex.error, url: ex.documentoUrl }); continue; }
    if (!ex.data) continue;
    const prods = normalizarExtraccion(ex.data).filter(x => !x.esCargo);
    const tipoDoc = ex.data.salida.documento?.tipo || '';
    if (esDocumentoComercial(tipoDoc)) { noSonFichas.push({ extraccionId: ex.id, documento: ex.documentoNombre || 'documento', motivo: `Es ${tipoDoc.replace(/_/g, ' ').toLowerCase()}: sirve para el precio, no como ficha técnica.` }); continue; }
    if (prods.length > 0 && !prods.some(identificable)) { noSonFichas.push({ extraccionId: ex.id, documento: ex.documentoNombre || 'documento', motivo: 'No trae marca ni modelo (descripción genérica, p. ej. la propuesta técnica): no sirve para comparar.' }); continue; }
    for (const p of prods) {
      if (!identificable(p)) continue;
      if (asignado.has(`${ex.id}:${p.idx}`) || docsConAsignado.has(String(ex.id))) continue;
      const s = sugerencias.get(`${ex.id}:${p.idx}`);
      const linea = s?.filaId ? lineas.find(l => l.id === s.filaId) : null;
      pendientes.push({
        extraccionId: ex.id, idx: p.idx, documento: ex.documentoNombre || 'documento', url: ex.documentoUrl, nombre: corto(p.nombre || `${p.marca} ${p.modelo}`), marca: p.marca, modelo: p.modelo,
        sugerencia: s ? { filaId: s.filaId ?? null, productoCompraId: linea ? (productoDeLinea(linea, productos)?.id ?? null) : null, confianza: String(s.confianza || ''), motivo: String(s.motivo || '') } : null,
      });
    }
  }
  return { productos: salida, pendientes, conError, noSonFichas, sinCosteo: lineas.length === 0 };
}

// ── Complementar un «Falta dato» ───────────────────────────────────────────────────────────────────
// Cuando la ficha no trae un dato que las bases piden, una persona de Compras lo aporta (de una llamada, el manual, otro documento…)
// y decide si con ese dato el producto cumple o no. Queda un registro con quién, cuándo, el dato y la fuente. El último registro de
// cada (modelo, requisito) manda; «quitar» lo deja de nuevo en «Falta dato». No toca lo que dijo la IA.
const TIPO_COMPLEMENTO = 'complemento_compras';

export async function complementosDeCompras(negocioId: number): Promise<Map<string, ComplementoRequisito>> {
  const [rows] = await pool.query(`SELECT opcion_id, detalle FROM auditor_evento WHERE negocio_id = ? AND tipo = ? ORDER BY id`, [negocioId, TIPO_COMPLEMENTO]) as any;
  const out = new Map<string, ComplementoRequisito>();
  for (const r of rows as any[]) {
    try {
      const d = JSON.parse(r.detalle);
      const k = `${r.opcion_id}:${d.n}`;
      if (d.resultado === 'CUMPLE' || d.resultado === 'NO_CUMPLE') out.set(k, { resultado: d.resultado, dato: String(d.dato || ''), fuente: String(d.fuente || ''), por: String(d.por || ''), at: String(d.at || '') });
      else out.delete(k);   // «quitar complemento»
    } catch { /* registro mal formado */ }
  }
  return out;
}

export async function complementarRequisito(p: { negocioId: number; opcionId: number; n: number; resultado: 'CUMPLE' | 'NO_CUMPLE' | null; dato: string; fuente: string; actor: Actor }): Promise<void> {
  const { negocioId, opcionId, n, resultado, actor } = p;
  const [op] = await pool.query(`SELECT id FROM auditor_opcion WHERE id = ? AND negocio_id = ? AND fila_id LIKE 'cmp:%'`, [opcionId, negocioId]) as any;
  if (!(op as any[])[0]) throw new Error('Ese modelo no es del panel de Compras.');
  if (!Number.isInteger(n) || n < 1) throw new Error('Requisito inválido.');
  const dato = p.dato.replace(/\s+/g, ' ').trim().slice(0, 500);
  const fuente = p.fuente.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (resultado && dato.length < 3) throw new Error('Escribe el dato que aportas (por ejemplo «soporte VESA 400×200 según el manual»).');
  const detalle = JSON.stringify({ n, resultado, dato, fuente, por: actor.nombre, porId: actor.id, at: ahoraChileSQL() });
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, ?, 'compras', ?, ?)`, [negocioId, opcionId, TIPO_COMPLEMENTO, detalle, ahoraChileSQL()]);
}

/** Quita un modelo del panel de Compras (queda descartado; no se borra nada del Auditor: solo se pueden quitar opciones de Compras). */
export async function quitarOpcionDeCompras(negocioId: number, opcionId: number): Promise<void> {
  const [r] = await pool.query(`UPDATE auditor_opcion SET estado = 'descartada', actualizado_at = ? WHERE id = ? AND negocio_id = ? AND fila_id LIKE 'cmp:%'`, [ahoraChileSQL(), opcionId, negocioId]) as any;
  if (!r.affectedRows) throw new Error('Ese modelo no es del panel de Compras.');
}

/** Saca un documento de las listas del panel (pendientes, «no son fichas», con error). Si ya tenía fichas asignadas, estas no se tocan. */
export async function olvidarDocumentoDeCompras(negocioId: number, extraccionId: number): Promise<void> {
  await pool.query(`DELETE FROM auditor_evento WHERE negocio_id = ? AND tipo = 'ficha_compras' AND detalle = ?`, [negocioId, String(extraccionId)]);
  const [evs] = await pool.query(`SELECT id, detalle FROM auditor_evento WHERE negocio_id = ? AND tipo = 'sugerencia_linea'`, [negocioId]) as any;
  for (const e of evs as any[]) { try { const d = JSON.parse(e.detalle); if (d?.ficha && d.extraccionId === extraccionId) await pool.query(`DELETE FROM auditor_evento WHERE id = ?`, [e.id]); } catch { /* evento mal formado */ } }
}

/** Línea del costeo de un producto de Compras (para asignar a mano desde el panel). */
export async function filaDeProductoCompra(negocioId: number, productoCompraId: number): Promise<string | null> {
  const [productos, estado] = await Promise.all([listarProductosCompra(negocioId), cargarEstadoCosteo(negocioId)]);
  const prod = productos.find(p => p.id === productoCompraId);
  return prod ? (lineaDeProducto(prod, lineasAuditables(estado))?.id ?? null) : null;
}
