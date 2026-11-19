// app/lib/compras-pareo-global.ts
// PAREO GLOBAL de las cotizaciones de un negocio: capa de BD sobre el núcleo puro (compras-pareo-global-core.ts).
// Corre SOLO después de leer una cotización (programarPareoGlobal, con espera para juntar varias subidas seguidas) y a mano con el botón
// «Corregir pareo» (corregirPareo). Lo que una persona ya tocó, o un producto que ya avanzó (aprobado, comprado…), NO se mueve.
import pool from '@/app/lib/db';
import { crearChatIA as crearChatIABase, geminiTextoHabilitado } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
import { conCupo } from '@/app/lib/cupo-ia';
import { listarProductosCompra } from '@/app/lib/compras';
import { esSubestadoFuera } from '@/app/lib/compras-no-adjudicadas';
import { lineasDesdeTabla, asignacionRespaldadaPorDocumento, factoresPrecioDeCotizacion } from '@/app/lib/compras-cotizacion-lineas';
import { recalcularPreciosDeCotizacion, cargarFleteAProductos } from '@/app/lib/compras-adicionales';
import { auditarCotizacionEnSegundoPlano } from '@/app/lib/compras-auditoria-cotizacion';
import { marcarCotizandoSiHayCotizacion } from '@/app/lib/compras-avance-estados';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { parearNegocio, planificarEscrituraPareo, type CotizacionPareo, type ItemGuardado } from '@/app/lib/compras-pareo-global-core';

const crearChatIA = conModuloIA('compras', crearChatIABase);

/** Modelo del pareo. En el banco (negocio 1356) glm-4.7 dio 75,8 % y Kimi rápido 78,8 % contra el comparativo del equipo, con ~1 min contra ~5 min:
 *  se usa glm-4.7 (el mismo de la lectura de cotizaciones). Cambiar aquí si el banco dice otra cosa. */
const MODELO_PAREO = 'glm-4.7'; // respaldo: el principal es Gemini (ver llamarIA)

export interface ResumenPareo { ejecutado: boolean; motivo?: string; asignados: number; quitados: number; sinRespaldo: number; saltados: number; llamadas: number; sinCuadrar: string[] }

async function ejecutar(negocioId: number, actor?: { id: number; nombre: string | null }, quitar = false): Promise<ResumenPareo> {
  const vacio = (motivo: string): ResumenPareo => ({ ejecutado: false, motivo, asignados: 0, quitados: 0, sinRespaldo: 0, saltados: 0, llamadas: 0, sinCuadrar: [] });
  const [cotRows]: any = await pool.query(
    `SELECT id, proveedor_nombre, moneda, tipo_cambio_usado, notas, descuento_pct, precio_total, flete_monto, descripcion_libre, archivo_nombre
       FROM compras_cotizacion WHERE negocio_id = ? AND descripcion_libre IS NOT NULL AND descripcion_libre <> '' ORDER BY created_at, id`, [negocioId]);
  const cotizaciones = cotRows as CotizacionPareo[];
  if (cotizaciones.length === 0) return vacio('el negocio no tiene cotizaciones leídas');
  const productos = (await listarProductosCompra(negocioId)).filter(p => !esSubestadoFuera(p.subestado) && !p.esServicio);
  if (productos.length === 0) return vacio('el negocio no tiene productos');

  const R = await parearNegocio({
    productos: productos.map(p => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad, montoUnitario: p.montoUnitario })),
    cotizaciones,
    llamarIA: async (system, user) => {
      const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
      const salida = (c: any) => ({ content: String(c.choices?.[0]?.message?.content ?? ''), finishReason: c.choices?.[0]?.finish_reason ?? null });
      // Prueba del 19-nov (pedido del dueño): primero Gemini (GEMINI_MODEL, hoy gemini-3.6-flash: 80 % en el banco del 1356, ~20 s)
      // y, si falla o devuelve vacío, glm-4.7 como antes.
      if (geminiTextoHabilitado()) {
        try {
          const c: any = await conCupo('compras-lectura', 3, () => crearChatIA({
            messages, temperature: 0, stream: false, max_tokens: 30_000, response_format: { type: 'json_object' },
          }, { timeoutMs: 240_000, proveedorPreferido: 'gemini', sinRespaldo: true }));
          const r = salida(c);
          if (r.content.trim()) return r;
          console.warn('[pareo] Gemini devolvió vacío → glm-4.7');
        } catch (e: any) {
          console.warn(`[pareo] Gemini falló (${String(e?.status ?? e?.message ?? e).slice(0, 100)}) → glm-4.7`);
        }
      }
      const completion: any = await conCupo('compras-lectura', 3, () => crearChatIA({
        messages, temperature: 0, stream: false, max_tokens: 12_000, response_format: { type: 'json_object' },
      }, { timeoutMs: 300_000, modeloPreferido: MODELO_PAREO, soloGlm: true }));
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
  const plan = planificarEscrituraPareo({
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
    mensaje: `Pareo global de ${cotizaciones.length} cotización(es): ${plan.escribir.length} asignación(es) escritas, ${plan.quitar.length} quitadas, ${plan.saltados.length} no se tocaron.`,
    metadata: { negocio_id: negocioId, escritas: plan.escribir.length, quitadas: plan.quitar.length, saltadas: plan.saltados.length, llamadas: R.llamadas, sin_cuadrar: sinCuadrar },
  } as any).catch(() => {});
  return { ejecutado: true, asignados: plan.escribir.length, quitados: plan.quitar.length, sinRespaldo: plan.sinRespaldo.length, saltados: plan.saltados.length, llamadas: R.llamadas, sinCuadrar };
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
