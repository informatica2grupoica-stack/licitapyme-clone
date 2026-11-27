// app/lib/compras-pareo-global.ts
// PAREO GLOBAL de las cotizaciones de un negocio: capa de BD sobre el núcleo puro (compras-pareo-global-core.ts).
// Corre SOLO después de leer una cotización (programarPareoGlobal, con espera para juntar varias subidas seguidas) y a mano con el botón
// «Corregir pareo» (corregirPareo). Lo que una persona ya tocó, o un producto que ya avanzó (aprobado, comprado…), NO se mueve.
import pool from '@/app/lib/db';
import { crearChatIA as crearChatIABase } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
import { conCupo } from '@/app/lib/cupo-ia';
import { listarProductosCompra } from '@/app/lib/compras';
import { esSubestadoFuera } from '@/app/lib/compras-no-adjudicadas';
import { lineasDesdeTabla, asignacionRespaldadaPorDocumento, factoresPrecioDeCotizacion } from '@/app/lib/compras-cotizacion-lineas';
import { recalcularPreciosDeCotizacion, cargarFleteAProductos, descuentoSobreTotal } from '@/app/lib/compras-adicionales';
import { auditarCotizacionEnSegundoPlano } from '@/app/lib/compras-auditoria-cotizacion';
import { marcarCotizandoSiHayCotizacion } from '@/app/lib/compras-avance-estados';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { listarEquivalencias } from '@/app/lib/compras-equivalencias';
import { clienteDeNegocio } from '@/app/lib/tenant';
import { reparacionesDeUnidad, parearNegocio, planificarEscrituraPareo, precioBaseAGuardar, netoDeBaseGuardada, type CotizacionPareo, type ItemGuardado } from '@/app/lib/compras-pareo-global-core';

const crearChatIA = conModuloIA('compras', crearChatIABase);

export interface ResumenPareo { ejecutado: boolean; motivo?: string; asignados: number; quitados: number; sinRespaldo: number; saltados: number; llamadas: number; sinCuadrar: string[]; sinRespuestaIA?: string[] }

async function ejecutar(negocioId: number, actor?: { id: number; nombre: string | null }, quitar = false): Promise<ResumenPareo> {
  const vacio = (motivo: string): ResumenPareo => ({ ejecutado: false, motivo, asignados: 0, quitados: 0, sinRespaldo: 0, saltados: 0, llamadas: 0, sinCuadrar: [] });
  const [cotRows]: any = await pool.query(
    `SELECT id, proveedor_nombre, moneda, tipo_cambio_usado, notas, descuento_pct, precio_total, flete_monto, descripcion_libre, archivo_nombre
       FROM compras_cotizacion WHERE negocio_id = ? AND descripcion_libre IS NOT NULL AND descripcion_libre <> '' ORDER BY created_at, id`, [negocioId]);
  const cotizaciones = cotRows as CotizacionPareo[];
  if (cotizaciones.length === 0) return vacio('el negocio no tiene cotizaciones leídas');
  const productos = (await listarProductosCompra(negocioId)).filter(p => !esSubestadoFuera(p.subestado) && !p.esServicio);
  if (productos.length === 0) return vacio('el negocio no tiene productos');

  // Equivalencias que fijó la empresa dueña del negocio (modelo → familia); sin tabla o sin filas = lista vacía.
  const equivalencias = await clienteDeNegocio(negocioId).then(c => listarEquivalencias(c)).catch(() => []);
  const R = await parearNegocio({
    equivalencias: equivalencias.map(e => ({ patron: e.patron, familia: e.familia })),
    productos: productos.map(p => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad, montoUnitario: p.montoUnitario })),
    cotizaciones,
    llamarIA: async (system, user) => {
      const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
      const salida = (c: any) => ({ content: String(c.choices?.[0]?.message?.content ?? ''), finishReason: c.choices?.[0]?.finish_reason ?? null });
      // 25-nov-2026 (pedido del dueño): el pareo va con Kimi (rápido, sin razonar); si falla, un respaldo GLM-4.7. Sin Gemini.
      const completion: any = await conCupo('compras-lectura', 3, () => crearChatIA({
        messages, temperature: 0, stream: false, max_tokens: 24_000, response_format: { type: 'json_object' },
      }, { timeoutMs: 420_000, modeloPreferido: 'glm-5.2', respaldoKimi: true }));
      return salida(completion);
    },
  });

  // Lo que ya hay guardado y quién lo tocó.
  const ids = cotizaciones.map(c => c.id);
  const [itemRows]: any = await pool.query(`SELECT cotizacion_id, producto_id, precio_base FROM compras_cotizacion_item WHERE cotizacion_id IN (?)`, [ids]);
  const itemsGuardados: ItemGuardado[] = (itemRows as any[]).map(r => ({ cotizacionId: Number(r.cotizacion_id), productoId: Number(r.producto_id), precioBase: r.precio_base == null ? null : Number(r.precio_base) }));
  const [manRows]: any = await pool.query(
    `SELECT DISTINCT CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.cotizacion_id')) AS UNSIGNED) AS id FROM historial_eventos
      WHERE tipo = 'COMPRAS_COTIZACION_ITEMS_ASIGNADOS' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.negocio_id')) AS UNSIGNED) = ?
      UNION SELECT DISTINCT cotizacion_id FROM compras_cotizacion_adicional WHERE cotizacion_id IN (?) AND creado_por IS NOT NULL`, [negocioId, ids]);
  const cotizacionesDeUnaPersona = new Set<number>((manRows as any[]).map(r => Number(r.id)).filter(Boolean));

  const porCot = new Map(cotizaciones.map(c => [c.id, c]));
  const lineasDoc = new Map(cotizaciones.map(c => [c.id, lineasDesdeTabla(String(c.descripcion_libre || ''))]));
  const desc = new Map(productos.map(p => [p.id, p.descripcion]));
  const [stRows]: any = await pool.query('SELECT id, descuento_pct FROM compras_cotizacion WHERE id IN (?) AND descuento_sobre_total = 1', [ids]).catch(() => [[]]);   // sin la migration-195: ninguna
  const sobreTotal = new Map<number, number>((stRows as any[]).filter(r => Number(r.descuento_pct) > 0).map(r => [Number(r.id), Number(r.descuento_pct)]));
  const plan = planificarEscrituraPareo({
    descuentoSobreTotal: sobreTotal,
    quitar, resultado: R, productos: productos.map(p => ({ id: p.id, subestado: p.subestado })), itemsGuardados, cotizacionesDeUnaPersona,
    respaldado: it => {
      const c = porCot.get(it.cotizacionId)!;
      const factoresPrecio = factoresPrecioDeCotizacion({ moneda: c.moneda, tipoCambioUsado: c.tipo_cambio_usado != null ? Number(c.tipo_cambio_usado) : null, notas: c.notas });
      return asignacionRespaldadaPorDocumento(String(desc.get(it.productoId) ?? ''), it.precioBase, lineasDoc.get(it.cotizacionId) ?? [], { factoresPrecio });
    },
  });

  const ahora = ahoraChileSQL();
  const tocadas = new Set<number>();
  for (const w of plan.escribir) {
    await pool.query(
      `INSERT INTO compras_cotizacion_item (cotizacion_id, producto_id, precio_unitario, precio_base, cumple, detalle_desviacion) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE precio_unitario = VALUES(precio_unitario), precio_base = VALUES(precio_base), cumple = VALUES(cumple), detalle_desviacion = VALUES(detalle_desviacion)`,
      [w.cotizacionId, w.productoId, w.precio, w.precio, w.cumple, w.detalle]);
    tocadas.add(w.cotizacionId);
  }
  for (const q of plan.quitar) {
    await pool.query(`DELETE FROM compras_cotizacion_adicional WHERE cotizacion_id = ? AND producto_id = ? AND creado_por IS NULL`, [q.cotizacionId, q.productoId]).catch(() => {});
    await pool.query(`DELETE FROM compras_cotizacion_item WHERE cotizacion_id = ? AND producto_id = ?`, [q.cotizacionId, q.productoId]);
    await pool.query(`DELETE FROM compras_auditoria_cotizacion WHERE cotizacion_id = ? AND producto_id = ?`, [q.cotizacionId, q.productoId]).catch(() => {});
    await pool.query(
      `UPDATE compras_producto p SET p.subestado = 'PENDIENTE', p.updated_at = ?
        WHERE p.id = ? AND p.subestado = 'COTIZANDO' AND NOT EXISTS (SELECT 1 FROM compras_cotizacion_item ci WHERE ci.producto_id = p.id)`, [ahora, q.productoId]);
    tocadas.add(q.cotizacionId);
  }
  // Precios guardados por el motor anterior con el rollo/caja mal convertido ($2.390/m × 100 = $239.000 con 400 m cotizados): se vuelven al precio de la línea.
  const yaEscritos = new Set(plan.escribir.map(w => `${w.cotizacionId}:${w.productoId}`));
  const movibles = new Set(productos.filter(p => p.subestado === 'PENDIENTE' || p.subestado === 'COTIZANDO').map(p => p.id));
  const reparaciones = reparacionesDeUnidad({
    // Se comparan en neto contra las líneas; lo guardado a precio de lista se pasa a neto antes y vuelve a lista al escribir.
    itemsGuardados: itemsGuardados.map(i => i.precioBase == null ? i : { ...i, precioBase: netoDeBaseGuardada(i.precioBase, sobreTotal.get(i.cotizacionId)) }),
    lineas: R.lineas, productos: productos.map(p => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad })),
    excluir: it => cotizacionesDeUnaPersona.has(it.cotizacionId) || !movibles.has(it.productoId) || yaEscritos.has(`${it.cotizacionId}:${it.productoId}`),
  });
  for (const r of reparaciones) {
    await pool.query(`UPDATE compras_cotizacion_item SET precio_unitario = ?, precio_base = ?, detalle_desviacion = ? WHERE cotizacion_id = ? AND producto_id = ?`,
      [precioBaseAGuardar(r.precio, sobreTotal.get(r.cotizacionId)), precioBaseAGuardar(r.precio, sobreTotal.get(r.cotizacionId)), `Pareo global: ${r.motivo}`.slice(0, 480), r.cotizacionId, r.productoId]);
    tocadas.add(r.cotizacionId);
  }
  for (const id of tocadas) {
    await recalcularPreciosDeCotizacion(id);   // los adicionales ya cargados se vuelven a sumar al base nuevo
    await cargarFleteAProductos(id).catch(() => {});
    auditarCotizacionEnSegundoPlano(negocioId, id, actor);
  }
  if (plan.escribir.length > 0) await marcarCotizandoSiHayCotizacion(negocioId);

  const sinCuadrar = R.cuadres.filter(q => q.cuadraLectura === false).map(q => `${q.proveedor}: las líneas leídas suman $${q.sumaLineas.toLocaleString('es-CL')} y el documento dice $${q.netoDocumento?.toLocaleString('es-CL')}`);
  await registrarEvento({
    tipo: 'COMPRAS_PAREO_GLOBAL', licitacionCodigo: (await pool.query('SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1', [negocioId]).then(([r]: any) => r?.[0]?.licitacion_codigo).catch(() => null)) ?? undefined,
    actorId: actor?.id, actorNombre: actor?.nombre ?? undefined,
    mensaje: `Pareo global de ${cotizaciones.length} cotización(es): ${plan.escribir.length} asignación(es) escritas, ${reparaciones.length} precios de unidad corregidos, ${plan.quitar.length} quitadas, ${plan.saltados.length} no se tocaron.`,
    metadata: { negocio_id: negocioId, escritas: plan.escribir.length, reparadas: reparaciones.length, quitadas: plan.quitar.length, saltadas: plan.saltados.length, llamadas: R.llamadas, sin_cuadrar: sinCuadrar, sin_respuesta_ia: R.sinRespuesta },
  } as any).catch(() => {});
  return { ejecutado: true, asignados: plan.escribir.length, quitados: plan.quitar.length, sinRespaldo: plan.sinRespaldo.length, saltados: plan.saltados.length, llamadas: R.llamadas, sinCuadrar, sinRespuestaIA: R.sinRespuesta };
}

// Un negocio a la vez; varias subidas seguidas se juntan en una sola corrida (espera corta) y, si llega otra durante la corrida, se repite una vez.
const estado = new Map<number, { corriendo: boolean; repetir: boolean; quitarAlRepetir: boolean; timer: ReturnType<typeof setTimeout> | null; terminan: Array<() => void> }>();
const ESPERA_MS = 10_000;
const est = (n: number) => { let e = estado.get(n); if (!e) { e = { corriendo: false, repetir: false, quitarAlRepetir: false, timer: null, terminan: [] }; estado.set(n, e); } return e; };

async function correrSerializado(negocioId: number, actor?: { id: number; nombre: string | null }, quitar = false): Promise<ResumenPareo> {
  const e = est(negocioId);
  if (e.corriendo) { e.repetir = true; e.quitarAlRepetir = e.quitarAlRepetir || quitar; return { ejecutado: false, motivo: 'ya hay un pareo en curso: se repetirá al terminar', asignados: 0, quitados: 0, sinRespaldo: 0, saltados: 0, llamadas: 0, sinCuadrar: [] }; }
  e.corriendo = true;
  try {
    let r = await ejecutar(negocioId, actor, quitar);
    while (e.repetir) { const q = e.quitarAlRepetir; e.repetir = false; e.quitarAlRepetir = false; r = await ejecutar(negocioId, actor, q); }
    return r;
  } finally { e.corriendo = false; }
}

/** Después de leer una cotización: agenda el pareo del negocio (sin bloquear a quien llama; un error queda en el log y no rompe la subida). */
export function programarPareoGlobal(negocioId: number): void {
  const e = est(negocioId);
  if (e.timer) clearTimeout(e.timer);
  e.timer = setTimeout(() => {
    e.timer = null;
    correrSerializado(negocioId).catch(err => console.error(`[pareo-global] falló para el negocio ${negocioId}:`, String(err).slice(0, 300)));
  }, ESPERA_MS);
}

/** Botón «Corregir pareo»: lo corre ya y devuelve el resumen. A diferencia del automático, también quita lo guardado que el pareo ya no sostiene y el documento no respalda. */
export async function corregirPareo(negocioId: number, actor: { id: number; nombre: string | null }): Promise<ResumenPareo> {
  const e = est(negocioId);
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  return correrSerializado(negocioId, actor, true);
}

/** Una corrida directa (sin espera ni cola): para pruebas y scripts. */
export { ejecutar as ejecutarPareoGlobal };

/** «Emparejar a mano»: una persona dice que ESTA línea de ESTA cotización es el precio de ESTE producto. Agrega o cambia solo ese producto en esa cotización
 *  (no toca los demás ítems ni sus adicionales) y deja el evento de asignación manual: desde entonces el pareo automático ya no rehace esa cotización. */
export async function emparejarAMano(negocioId: number, a: { cotizacionId: number; productoId: number; precio: number; linea: string; cumple: 'CUMPLE' | 'INFERIOR_NEGOCIABLE'; aviso?: string | null }, actor: { id: number; nombre: string | null }): Promise<void> {
  if (!(Number.isFinite(a.precio) && a.precio > 0)) throw new Error('El precio tiene que ser mayor que cero.');
  const [cot]: any = await pool.query('SELECT id FROM compras_cotizacion WHERE id = ? AND negocio_id = ? LIMIT 1', [a.cotizacionId, negocioId]);
  if (!cot?.length) throw new Error('Esa cotización no es de este negocio.');
  const producto = (await listarProductosCompra(negocioId)).find(p => p.id === a.productoId);
  if (!producto) throw new Error('Ese producto no es de este negocio.');
  if (esSubestadoFuera(producto.subestado) || !(producto.subestado === 'PENDIENTE' || producto.subestado === 'COTIZANDO'))
    throw new Error('Ese producto ya avanzó (aprobado, comprado o fuera): no se puede cambiar su cotización.');
  const base = precioBaseAGuardar(a.precio, await descuentoSobreTotal(a.cotizacionId));   // el precio que llega viene en neto, con el descuento
  const linea = String(a.linea || '').trim().slice(0, 200);
  const detalle = `Emparejado a mano${actor.nombre ? ` por ${actor.nombre}` : ''}: línea «${linea}»${a.aviso ? ` · ${String(a.aviso).slice(0, 160)}` : ''}`.slice(0, 480);
  await pool.query(
    `INSERT INTO compras_cotizacion_item (cotizacion_id, producto_id, precio_unitario, precio_base, cumple, detalle_desviacion) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE precio_unitario = VALUES(precio_unitario), precio_base = VALUES(precio_base), cumple = VALUES(cumple), detalle_desviacion = VALUES(detalle_desviacion)`,
    [a.cotizacionId, a.productoId, base, base, a.cumple, detalle]);
  await recalcularPreciosDeCotizacion(a.cotizacionId);   // los adicionales ya cargados se vuelven a sumar al base nuevo
  await cargarFleteAProductos(a.cotizacionId).catch(() => {});
  await registrarEvento({
    tipo: 'COMPRAS_COTIZACION_ITEMS_ASIGNADOS',
    licitacionCodigo: (await pool.query('SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1', [negocioId]).then(([r]: any) => r?.[0]?.licitacion_codigo).catch(() => null)) ?? undefined,
    actorId: actor.id, actorNombre: actor.nombre ?? undefined,
    mensaje: `Se emparejó a mano «${producto.descripcion.slice(0, 80)}» con la línea «${linea.slice(0, 80)}» de la cotización #${a.cotizacionId}.`,
    metadata: { negocio_id: negocioId, cotizacion_id: a.cotizacionId, productos: [a.productoId], manual: true },
  } as any).catch(() => {});
  auditarCotizacionEnSegundoPlano(negocioId, a.cotizacionId, actor);
  await marcarCotizandoSiHayCotizacion(negocioId);
}
