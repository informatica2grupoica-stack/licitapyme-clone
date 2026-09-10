// app/lib/compras-auditor.ts
// AUDITOR DE COMPRAS (spec §8) — hermano del Auditor Técnico (motor-comercial.ts) pero aplicado a
// cotizaciones de proveedores en vez de a la oferta. Instrucción explícita de la spec (§8.1): "no
// es un comparador, es un sugeridor" — entrega recomendaciones razonadas, exige IA, no lógica de
// planilla que solo ordena columnas.
//
// REGLA DE NO EXCLUSIÓN (§8.8.1): ningún proveedor se excluye del ranking por incumplimiento
// técnico. Importa QUÉ no cumple, no QUE no cumpla. Único caso de exclusión real: "producto
// totalmente distinto a lo pedido" (NO_ES_EL_PRODUCTO). Todo lo demás se clasifica en un espectro
// (CUMPLE / MEJORA / INFERIOR_NEGOCIABLE / INFERIOR_INSALVABLE), nunca se descarta en silencio.
//
// ORIGEN GEOGRÁFICO FIJO (§8.10.1): todas las distancias se calculan desde la bodega de Talagante
// (Epeira 575), no desde Santiago ni la casa matriz. Viaje interno local = $40.000 (§8.10.2).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { proveedorPorRut, listarComprasOc, listarComprasDte } from '@/app/lib/obuma';
import { listarProductosCompra, invalidarAprobacionesCompras, type ProductoCompra } from '@/app/lib/compras';
import { obtenerOCrearProveedor } from '@/app/lib/compras-proveedores';
import { obtenerTipoCambio } from '@/app/lib/tipo-cambio';
import { parsearDiasDeTexto } from '@/app/lib/numeros';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}
const fmtMonto = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export const VIAJE_INTERNO_CLP = 40_000; // §8.10.2 — editable acá, no disperso en el código
export const BODEGA_ORIGEN = 'Epeira 575, Talagante'; // §8.10.1

export type OrigenCotizacion = 'pdf' | 'imagen' | 'whatsapp' | 'texto' | 'correo' | 'llamada';
export type CumpleItem = 'CUMPLE' | 'MEJORA' | 'INFERIOR_NEGOCIABLE' | 'INFERIOR_INSALVABLE' | 'NO_ES_EL_PRODUCTO';

export interface DatosCotizacion {
  proveedorNombre: string; proveedorRut?: string | null;
  proveedorId?: number | null; // engancha al catálogo de compras-proveedores.ts, si se eligió uno
  origen: OrigenCotizacion;
  descripcionLibre?: string | null;
  precioUnitario?: number | null; precioTotal?: number | null; moneda?: string;
  plazoEntregaTexto?: string | null; plazoEntregaDias?: number | null;
  incluyeFlete?: boolean | null; direccionBodega?: string | null;
  fichaTecnicaUrl?: string | null; archivoUrl?: string | null; archivoNombre?: string | null;
  tomadaAt?: string | null; // si no viene, se usa ahora
  vigenciaAt?: string | null; notas?: string | null;
  // Multi-ítem al crear (§8.7, mejora de UX pedida por el usuario 09-sep-2026): si el comprador ya
  // sabe con certeza a qué producto(s) corresponde esta cotización, lo indica de una vez acá en vez
  // de crearla y abrir "Asignar productos" como paso aparte. Cuando viene, reemplaza a la
  // homologación automática por IA — ver nota en registrarCotizacion.
  itemsManual?: Array<{ productoId: number; precioUnitario: number | null; cumple: CumpleItem; detalleDesviacion?: string | null }> | null;
}

/** Registro de una cotización — cualquier formato (§8.3), incluida la telefónica (§8.4). Dispara la
 *  homologación con IA SOLA, en segundo plano, sin bloquear la respuesta del registro ni esperar a
 *  que alguien apriete "Homologar" — es la lectura ACTIVA de "visión de agentes" (§19.1): el agente
 *  de auditoría de compra actúa apenas hay una cotización nueva, no solo cuando se le pregunta. El
 *  botón manual de re-homologar sigue existiendo para corregir lo que la IA haya decidido. */
export async function registrarCotizacion(
  negocioId: number, datos: DatosCotizacion, actorId: number, actorNombre: string | null,
): Promise<number> {
  // Si viene de un proveedor del catálogo, ESA ficha manda sobre lo tipeado a mano — es la fuente
  // de verdad una vez que el proveedor está dado de alta (compras-proveedores.ts).
  let proveedorNombre = datos.proveedorNombre; let proveedorRut = datos.proveedorRut ?? null;
  let proveedorId = datos.proveedorId ?? null;
  if (proveedorId) {
    const [pRows] = await pool.query(`SELECT nombre_empresa, rut FROM compras_proveedor WHERE id = ?`, [proveedorId]) as any;
    const p = (pRows as any[])[0];
    if (p) { proveedorNombre = p.nombre_empresa; proveedorRut = p.rut; }
  } else if (proveedorNombre?.trim()) {
    // Proveedor "nuevo" tipeado a mano: se le da de alta en el catálogo (ficha mínima, editable
    // después en /compras/proveedores) — sin esto se perdía todo salvo nombre/RUT en ESTA
    // cotización, y había que retipearlo cada vez que se le volviera a cotizar algo.
    proveedorId = await obtenerOCrearProveedor(proveedorNombre, proveedorRut, actorId, actorNombre).catch(() => null);
  }

  // Blindaje contra NaN (bug real 10-sep-2026): un precio tipeado con puntos de miles chilenos
  // ("6.745.621") convertido con Number() a secas da NaN, no el número — y un NaN que llega hasta
  // acá terminaba crudo en la consulta SQL (mysql2 lo escapa como el texto SIN COMILLAS "NaN", que
  // MySQL confunde con el nombre de una columna → "Unknown column 'NaN' in field list"). Los
  // llamadores ya deberían mandar números limpios (ver parsearMontoCL en los endpoints), pero esta
  // función NUNCA debe dejar pasar un NaN a la base de datos pase lo que pase río arriba.
  if (datos.precioUnitario != null && !Number.isFinite(datos.precioUnitario)) datos.precioUnitario = null;
  if (datos.precioTotal != null && !Number.isFinite(datos.precioTotal)) datos.precioTotal = null;

  // Conversión a CLP (hallazgo real 09-sep-2026, cotización de Unisource en USD): el cuadro
  // comparativo y los escenarios comparan precios — comparar USD contra CLP sin convertir es un
  // error de cálculo, no cosmético. Se guardan AMBOS: el original (para mostrar el documento tal
  // cual llegó) y el convertido (el que de verdad entra a las cuentas), con el tipo de cambio del
  // día como foto — nunca se recalcula después.
  const moneda = datos.moneda || 'CLP';
  let tipoCambioUsado: number | null = null;
  let precioUnitarioClp = datos.precioUnitario ?? null;
  let precioTotalClp = datos.precioTotal ?? null;
  if (moneda !== 'CLP') {
    const tc = await obtenerTipoCambio(moneda);
    if (tc) {
      tipoCambioUsado = tc.valor;
      precioUnitarioClp = datos.precioUnitario != null ? Math.round(datos.precioUnitario * tc.valor) : null;
      precioTotalClp = datos.precioTotal != null ? Math.round(datos.precioTotal * tc.valor) : null;
    } else {
      // Sin tipo de cambio disponible: NO se inventa un valor CLP — queda sin convertir y el
      // cuadro comparativo/escenarios la excluyen hasta que se pueda convertir.
      precioUnitarioClp = null; precioTotalClp = null;
    }
  }

  // Bug real (10-sep-2026): el formulario solo pide el plazo como texto libre ("30 días hábiles")
  // — nunca hay un campo numérico separado, así que `plazo_entrega_dias` quedaba SIEMPRE null. El
  // escenario "Más rápido" (compras-auditor.ts, calcularEscenarios) ordena candidatos por ESTE
  // campo — con todos en null, el desempate era arbitrario y "Más rápido" terminaba coincidiendo
  // con los demás escenarios sin ninguna razón real (nunca comparaba plazos de verdad). Se deriva
  // acá del texto si no vino un número explícito — nunca inventa uno si el texto no trae ninguno.
  const plazoEntregaDias = datos.plazoEntregaDias ?? parsearDiasDeTexto(datos.plazoEntregaTexto);

  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_cotizacion
       (negocio_id, proveedor_id, proveedor_nombre, proveedor_rut, origen, descripcion_libre, precio_unitario, precio_total,
        moneda, tipo_cambio_usado, precio_unitario_clp, precio_total_clp,
        plazo_entrega_texto, plazo_entrega_dias, incluye_flete, direccion_bodega, ficha_tecnica_url,
        archivo_url, archivo_nombre, registrado_por, registrado_por_nombre, tomada_at, vigencia_at, notas, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      negocioId, proveedorId || null, proveedorNombre.slice(0, 300), proveedorRut || null, datos.origen,
      datos.descripcionLibre || null, datos.precioUnitario ?? null, datos.precioTotal ?? null,
      moneda, tipoCambioUsado, precioUnitarioClp, precioTotalClp,
      datos.plazoEntregaTexto || null, plazoEntregaDias,
      datos.incluyeFlete == null ? null : (datos.incluyeFlete ? 1 : 0), datos.direccionBodega || null,
      datos.fichaTecnicaUrl || null, datos.archivoUrl || null, datos.archivoNombre || null,
      actorId, actorNombre, datos.tomadaAt || ahora, datos.vigenciaAt || null, datos.notas || null, ahora,
    ],
  ) as any;
  const id = r.insertId as number;

  // Proveedor nuevo o antiguo (§8.5) — best-effort: si OBUMA no responde, queda NULL (no bloquea).
  if (proveedorRut) {
    proveedorNuevoOAntiguo(proveedorRut)
      .then(esNuevo => pool.query(`UPDATE compras_cotizacion SET proveedor_nuevo = ? WHERE id = ?`, [esNuevo ? 1 : 0, id]))
      .catch(() => { /* OBUMA caído o RUT no encontrado: no bloquea el registro */ });
  }
  await registrarEvento({
    tipo: 'COMPRAS_COTIZACION_REGISTRADA', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `Se registró una cotización de "${proveedorNombre}" (${datos.origen})${datos.precioUnitario ? ` — ${fmtMonto(datos.precioUnitario)}` : ''}.`,
    metadata: { negocio_id: negocioId, cotizacion_id: id, proveedor: proveedorNombre, origen: datos.origen },
  });

  if (datos.itemsManual && datos.itemsManual.length > 0) {
    // El comprador ya dejó explícito a qué producto(s) corresponde y a qué precio — no tiene
    // sentido que el agente adivine encima, y hacerlo igual era una condición de carrera real: la
    // homologación es asíncrona y podía sobreescribir minutos después (vía el mismo UPSERT que usa
    // para su propio resultado) lo que el comprador acababa de tipear a mano.
    const itemsClp = datos.itemsManual.map(it => ({
      productoId: it.productoId,
      precioUnitario: it.precioUnitario == null ? null
        : moneda === 'CLP' ? it.precioUnitario
        : (tipoCambioUsado ? Math.round(it.precioUnitario * tipoCambioUsado) : null), // sin tipo de cambio, no se inventa
      cumple: it.cumple, detalleDesviacion: it.detalleDesviacion || null,
    }));
    await asignarItemsCotizacion(negocioId, id, itemsClp, actorId, actorNombre).catch(e =>
      console.error(`[compras-auditor] asignación manual al crear falló para cotización ${id}:`, String(e).slice(0, 200)));
  } else {
    // Agente activo (§19.1): homologa sola, sin que nadie la dispare. Fire-and-forget — si la IA
    // falla o tarda, la cotización ya quedó registrada y el botón "Homologar con IA" sigue
    // disponible para reintentar a mano.
    homologarCotizacionIA(id).catch(e =>
      console.error(`[compras-auditor] homologación automática falló para cotización ${id}:`, String(e).slice(0, 200)));
  }

  return id;
}

/** §8.5: "lo determina el sistema, consultando en OBUMA si existe factura o algún pago previo." */
export async function proveedorNuevoOAntiguo(rut: string): Promise<boolean> {
  const proveedor = await proveedorPorRut(rut).catch(() => null);
  if (!proveedor) return true; // ni siquiera existe en OBUMA → nuevo
  const [ocs, dtes] = await Promise.all([
    listarComprasOc({ proveedor: proveedor.proveedor_id, limit: 1 }).catch(() => ({ data: [] }) as any),
    listarComprasDte({ proveedor: proveedor.proveedor_id, limit: 1 } as any).catch(() => ({ data: [] }) as any),
  ]);
  const tieneHistorial = (ocs?.data?.length || 0) > 0 || (dtes?.data?.length || 0) > 0;
  return !tieneHistorial;
}

export interface CotizacionFila {
  id: number; proveedorId: number | null; proveedorNombre: string; proveedorRut: string | null; proveedorNuevo: boolean | null;
  origen: OrigenCotizacion; precioUnitario: number | null; precioTotal: number | null;
  moneda: string; tipoCambioUsado: number | null; precioUnitarioClp: number | null; precioTotalClp: number | null;
  plazoEntregaTexto: string | null; plazoEntregaDias: number | null; incluyeFlete: boolean | null;
  ficaTecnicaUrl: string | null; archivoUrl: string | null; homologadaAt: string | null; tomadaAt: string;
  items: Array<{ productoId: number; precioUnitario: number | null; cumple: CumpleItem; detalleDesviacion: string | null }>;
}

export async function listarCotizaciones(negocioId: number): Promise<CotizacionFila[]> {
  const [rows] = await pool.query(
    `SELECT id, proveedor_id, proveedor_nombre, proveedor_rut, proveedor_nuevo, origen, precio_unitario, precio_total,
            moneda, tipo_cambio_usado, precio_unitario_clp, precio_total_clp,
            plazo_entrega_texto, plazo_entrega_dias, incluye_flete, ficha_tecnica_url, archivo_url,
            DATE_FORMAT(homologada_at, '%Y-%m-%d %H:%i:%s') AS homologada_at,
            DATE_FORMAT(tomada_at, '%Y-%m-%d %H:%i:%s') AS tomada_at
       FROM compras_cotizacion WHERE negocio_id = ? ORDER BY created_at DESC`,
    [negocioId],
  ) as any;
  const cotizaciones = rows as any[];
  if (cotizaciones.length === 0) return [];
  const ids = cotizaciones.map(c => c.id);
  const [itemRows] = await pool.query(
    `SELECT cotizacion_id, producto_id, precio_unitario, cumple, detalle_desviacion
       FROM compras_cotizacion_item WHERE cotizacion_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  ) as any;
  const itemsPorCotiz = new Map<number, any[]>();
  for (const it of itemRows as any[]) {
    const arr = itemsPorCotiz.get(it.cotizacion_id) || []; arr.push(it); itemsPorCotiz.set(it.cotizacion_id, arr);
  }
  return cotizaciones.map(c => ({
    id: c.id, proveedorId: c.proveedor_id, proveedorNombre: c.proveedor_nombre, proveedorRut: c.proveedor_rut,
    proveedorNuevo: c.proveedor_nuevo == null ? null : !!c.proveedor_nuevo, origen: c.origen,
    precioUnitario: c.precio_unitario == null ? null : Number(c.precio_unitario),
    precioTotal: c.precio_total == null ? null : Number(c.precio_total),
    moneda: c.moneda || 'CLP', tipoCambioUsado: c.tipo_cambio_usado == null ? null : Number(c.tipo_cambio_usado),
    precioUnitarioClp: c.precio_unitario_clp == null ? null : Number(c.precio_unitario_clp),
    precioTotalClp: c.precio_total_clp == null ? null : Number(c.precio_total_clp),
    plazoEntregaTexto: c.plazo_entrega_texto, plazoEntregaDias: c.plazo_entrega_dias,
    incluyeFlete: c.incluye_flete == null ? null : !!c.incluye_flete,
    ficaTecnicaUrl: c.ficha_tecnica_url, archivoUrl: c.archivo_url,
    homologadaAt: c.homologada_at, tomadaAt: c.tomada_at,
    items: (itemsPorCotiz.get(c.id) || []).map(it => ({
      productoId: it.producto_id, precioUnitario: it.precio_unitario == null ? null : Number(it.precio_unitario),
      cumple: it.cumple, detalleDesviacion: it.detalle_desviacion,
    })),
  }));
}

export interface AsignacionItemManual { productoId: number; precioUnitario: number | null; cumple: CumpleItem; detalleDesviacion?: string | null }

/** Asignación MANUAL de una cotización a uno o varios productos (§8.7: "una cotización puede cubrir
 *  varios productos"). Complementa a `homologarCotizacionIA` — existe porque depender solo de que la
 *  IA adivine desde el texto libre deja al comprador sin forma de corregirla o de saltársela cuando
 *  ya sabe con certeza a qué productos corresponde una cotización (caso típico: el proveedor cotizó
 *  por WhatsApp precio por precio, sin ambigüedad ninguna — no hace falta gastar IA en eso).
 *  Reemplaza TODA la asignación anterior de esta cotización (manual o de IA) por la que se manda acá,
 *  para que la pantalla sea "esto es lo que cubre hoy", no un historial acumulado de intentos. */
export async function asignarItemsCotizacion(
  negocioId: number, cotizacionId: number, items: AsignacionItemManual[], actorId?: number, actorNombre?: string | null,
): Promise<void> {
  const [cotizRows] = await pool.query(`SELECT id FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`, [cotizacionId, negocioId]) as any;
  if (!(cotizRows as any[]).length) throw new Error('Cotización no encontrada para este negocio.');

  const productos = await listarProductosCompra(negocioId);
  const idsValidos = new Set(productos.map(p => p.id));
  const limpios = items.filter(it => idsValidos.has(it.productoId));
  if (limpios.length === 0) throw new Error('Ningún producto válido en la asignación.');

  await pool.query(`DELETE FROM compras_cotizacion_item WHERE cotizacion_id = ?`, [cotizacionId]);
  // Mismo blindaje contra NaN que registrarCotizacion — nunca debe llegar un NaN a la consulta.
  const filas = limpios.map(it => [
    cotizacionId, it.productoId,
    it.precioUnitario != null && Number.isFinite(it.precioUnitario) ? it.precioUnitario : null,
    it.cumple, it.detalleDesviacion || null,
  ]);
  const ph = filas.map(() => '(?,?,?,?,?)').join(',');
  await pool.query(
    `INSERT INTO compras_cotizacion_item (cotizacion_id, producto_id, precio_unitario, cumple, detalle_desviacion) VALUES ${ph}`,
    filas.flat(),
  );
  await registrarEvento({
    tipo: 'COMPRAS_COTIZACION_ITEMS_ASIGNADOS', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `Se asignó manualmente una cotización a ${limpios.length} producto(s).`,
    metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, productos: limpios.map(i => i.productoId) },
  });
}

const SYS_HOMOLOGACION = `Eres el Auditor de Compras de una empresa que revende productos adjudicados en licitaciones públicas chilenas.

Te doy la descripción libre de UNA cotización de un proveedor (puede mencionar uno o varios productos) y una lista NUMERADA de los PRODUCTOS GANADOS que la empresa necesita comprar para cumplir la licitación.

Tu trabajo, para cada producto de la lista que la cotización efectivamente cubra:
1. Decide si es el MISMO producto por SIGNIFICADO, no por nombre exacto — los proveedores no nombran los productos igual que la licitación (spec §8.6).
2. Clasifica el cumplimiento técnico con esta regla de NO EXCLUSIÓN (spec §8.8.1): nunca excluyas por incumplimiento, salvo que sea un producto totalmente distinto. Usa:
   - "CUMPLE": cumple todo lo exigido.
   - "MEJORA": es igual o superior a lo exigido, a un costo notoriamente menor u otra ventaja clara (posible Oportunidad de Mejora).
   - "INFERIOR_NEGOCIABLE": le falta algo respecto a lo exigido, pero es una diferencia menor/negociable (ej. una medida ligeramente distinta).
   - "INFERIOR_INSALVABLE": le falta una característica crítica que no se puede negociar.
   - "NO_ES_EL_PRODUCTO": único caso de exclusión real — es un producto totalmente distinto al pedido.
3. Si detectas una desviación, descríbela en 1 frase concreta (ej. "mesa de 39cm vs 40cm exigidos").

Si la cotización no menciona un producto de la lista, simplemente NO lo incluyas en la respuesta — no inventes cobertura.

Responde SOLO JSON, sin markdown:
{"items":[{"producto":<número de la lista>,"cumple":"CUMPLE"|"MEJORA"|"INFERIOR_NEGOCIABLE"|"INFERIOR_INSALVABLE"|"NO_ES_EL_PRODUCTO","detalle":"<frase o null>","precioUnitarioAsignado":<número o null, si la cotización trae precio por ese producto en particular>}],"puntosCriticos":"<1-3 frases: qué es negociable y qué es insalvable en esta cotización, en general>"}`;

/** Homologa UNA cotización contra los productos ganados del negocio (§8.6-§8.8), vía IA. Escribe
 *  compras_cotizacion_item y acumula el resumen en compras_veredicto por producto. No excluye
 *  proveedores — solo clasifica (§8.8.1). */
export async function homologarCotizacionIA(cotizacionId: number): Promise<{ items: number }> {
  const [rows] = await pool.query(
    `SELECT negocio_id, proveedor_nombre, descripcion_libre, precio_unitario, precio_total, moneda, tipo_cambio_usado, precio_unitario_clp
       FROM compras_cotizacion WHERE id = ? LIMIT 1`,
    [cotizacionId],
  ) as any;
  const cotiz = (rows as any[])[0];
  if (!cotiz) throw new Error('Cotización no encontrada.');

  const productos = (await listarProductosCompra(cotiz.negocio_id)).filter(p => p.subestado !== 'RENUNCIADO');
  if (productos.length === 0) return { items: 0 };

  const sufijoMoneda = cotiz.moneda && cotiz.moneda !== 'CLP' ? ` ${cotiz.moneda}` : '';
  const user = `PRODUCTOS GANADOS (número: descripción, cantidad, unidad):
${productos.map((p, i) => `${i + 1}. ${p.descripcion}${p.cantidad ? `, cantidad ${p.cantidad}` : ''}${p.unidad ? ` ${p.unidad}` : ''}`).join('\n')}

COTIZACIÓN de "${cotiz.proveedor_nombre}"${cotiz.precio_unitario ? ` — precio unitario informado: ${Number(cotiz.precio_unitario).toLocaleString('es-CL')}${sufijoMoneda}` : ''}${cotiz.precio_total ? ` — total: ${Number(cotiz.precio_total).toLocaleString('es-CL')}${sufijoMoneda}` : ''}${sufijoMoneda ? `\n(Todo precio que asignes por producto debe estar en la MISMA moneda del documento, ${cotiz.moneda} — no conviertas tú, la conversión a CLP la hace el sistema aparte.)` : ''}:
${cotiz.descripcion_libre || '(sin descripción libre — usar solo el precio si corresponde a un único producto)'}`;

  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS_HOMOLOGACION }, { role: 'user', content: user }],
    temperature: 0, stream: false, max_tokens: 3_000,
    response_format: { type: 'json_object' },
  }, { timeoutMs: 60_000, modeloPreferido: 'glm-4.7', soloGlm: true });

  const txt = String(completion.choices?.[0]?.message?.content ?? '');
  const parsed: any = parseJsonIA(txt) || {};
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const cumples: CumpleItem[] = ['CUMPLE', 'MEJORA', 'INFERIOR_NEGOCIABLE', 'INFERIOR_INSALVABLE', 'NO_ES_EL_PRODUCTO'];

  let escritos = 0;
  const ahora = ahoraChileSQL();
  const tipoCambio = cotiz.tipo_cambio_usado != null ? Number(cotiz.tipo_cambio_usado) : null;
  for (const it of items) {
    const idx = Number(it?.producto);
    const producto = productos[idx - 1];
    if (!producto || !cumples.includes(it.cumple)) continue;
    // compras_cotizacion_item.precio_unitario es SIEMPRE CLP (es lo que alimenta el cuadro
    // comparativo y los escenarios) — si la IA asignó un precio propio, viene en la moneda del
    // documento (se le pidió explícitamente que no convirtiera) y hay que pasarlo por el mismo
    // tipo de cambio que se congeló al registrar la cotización; si no asignó nada, cae al precio
    // unitario CLP ya calculado a nivel de cotización.
    const asignadoIA = Number(it.precioUnitarioAsignado);
    const precioClpCrudo = Number.isFinite(asignadoIA)
      ? (tipoCambio ? Math.round(asignadoIA * tipoCambio) : asignadoIA)
      : (cotiz.precio_unitario_clp ?? null);
    // Blindaje contra NaN: si la IA devolvió algo no numérico en precioUnitarioAsignado, no se
    // deja pasar crudo a la consulta (mismo bug real que en registrarCotizacion, arriba).
    const precioClp = precioClpCrudo != null && Number.isFinite(precioClpCrudo) ? precioClpCrudo : null;
    await pool.query(
      `INSERT INTO compras_cotizacion_item (cotizacion_id, producto_id, precio_unitario, cumple, detalle_desviacion)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE precio_unitario = VALUES(precio_unitario), cumple = VALUES(cumple), detalle_desviacion = VALUES(detalle_desviacion)`,
      [cotizacionId, producto.id, precioClp, it.cumple, it.detalle || null],
    );
    escritos++;
    await pool.query(
      `INSERT INTO compras_veredicto (producto_id, resumen_ia, generado_at, modelo)
       VALUES (?,?,?,'glm-4.7')
       ON DUPLICATE KEY UPDATE resumen_ia = VALUES(resumen_ia), generado_at = VALUES(generado_at)`,
      [producto.id, parsed.puntosCriticos || null, ahora],
    );
  }
  await pool.query(`UPDATE compras_cotizacion SET homologada_at = ? WHERE id = ?`, [ahora, cotizacionId]);
  await registrarEvento({
    tipo: 'COMPRAS_AGENTE_HOMOLOGO', licitacionCodigo: await licitacionDeNegocio(cotiz.negocio_id),
    mensaje: `El agente de auditoría de compra homologó sola la cotización de "${cotiz.proveedor_nombre}" — ${escritos} producto(s) mapeado(s) (spec §19.1).`,
    metadata: { negocio_id: cotiz.negocio_id, cotizacion_id: cotizacionId, items: escritos },
  });
  return { items: escritos };
}

export interface EspacioNegociacion { productoId: number; descripcion: string; minimo: number; maximo: number; diferencia: number; proveedorMasCaro: string }

/** §8.9 — sin IA, es aritmética: si varias cotizaciones del mismo producto difieren en precio, hay
 *  margen para negociar con el más caro. */
export async function detectarEspacioNegociacion(negocioId: number): Promise<EspacioNegociacion[]> {
  const cotizaciones = await listarCotizaciones(negocioId);
  const productos = await listarProductosCompra(negocioId);
  const porProducto = new Map<number, Array<{ precio: number; proveedor: string }>>();
  for (const c of cotizaciones) {
    for (const it of c.items) {
      if (it.precioUnitario == null || it.cumple === 'NO_ES_EL_PRODUCTO') continue;
      const arr = porProducto.get(it.productoId) || []; arr.push({ precio: it.precioUnitario, proveedor: c.proveedorNombre });
      porProducto.set(it.productoId, arr);
    }
  }
  const out: EspacioNegociacion[] = [];
  for (const [productoId, precios] of porProducto) {
    if (precios.length < 2) continue;
    const minimo = Math.min(...precios.map(p => p.precio));
    const masCaro = precios.reduce((a, b) => (b.precio > a.precio ? b : a));
    if (masCaro.precio <= minimo) continue;
    out.push({
      productoId, descripcion: productos.find(p => p.id === productoId)?.descripcion || `#${productoId}`,
      minimo, maximo: masCaro.precio, diferencia: masCaro.precio - minimo, proveedorMasCaro: masCaro.proveedor,
    });
  }
  return out;
}

export interface CuadroComparativoFila {
  productoId: number; descripcion: string;
  cotizacionesPorProveedor: Array<{ proveedor: string; precioUnitario: number | null; cumple: CumpleItem | null }>;
  cubierto: boolean;
  // §8.8.2 — "requisito de IA: identificar los puntos críticos de cumplimiento técnico... para
  // discriminar qué desviación es negociable y cuál insalvable". Antes se calculaba y se guardaba en
  // compras_veredicto pero nunca se mandaba a la pantalla — quedaba invisible para el comprador, que
  // es exactamente a quien tiene que servirle (spec §8.1: "es un sugeridor").
  puntosCriticos: string | null;
}

/** §8.7 — matriz producto × proveedor, tolerando cobertura parcial: deja visibles los huecos.
 *  Incluye el veredicto de IA por producto (§8.8.2). */
export async function cuadroComparativo(negocioId: number): Promise<CuadroComparativoFila[]> {
  const productos = (await listarProductosCompra(negocioId)).filter(p => p.subestado !== 'RENUNCIADO');
  const cotizaciones = await listarCotizaciones(negocioId);
  const [veredictoRows] = productos.length
    ? await pool.query(
        `SELECT producto_id, resumen_ia FROM compras_veredicto WHERE producto_id IN (${productos.map(() => '?').join(',')})`,
        productos.map(p => p.id),
      ) as any
    : [[]];
  const veredictoPorProducto = new Map<number, string | null>((veredictoRows as any[]).map(v => [v.producto_id, v.resumen_ia]));

  return productos.map(p => {
    const filas = cotizaciones
      .map(c => ({ c, it: c.items.find(i => i.productoId === p.id) }))
      .filter(x => x.it)
      .map(x => ({ proveedor: x.c.proveedorNombre, precioUnitario: x.it!.precioUnitario, cumple: x.it!.cumple }));
    return {
      productoId: p.id, descripcion: p.descripcion, cotizacionesPorProveedor: filas, cubierto: filas.length > 0,
      puntosCriticos: veredictoPorProducto.get(p.id) ?? null,
    };
  });
}

export type TipoEscenario = 'MAS_RAPIDO' | 'MINIMO_PRECIO' | 'MINIMOS_VIAJES' | 'EQUILIBRADO';

export interface DetalleEscenario {
  porProducto: Array<{ productoId: number; descripcion: string; proveedor: string | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null; plazoEntregaDias: number | null }>;
  proveedoresInvolucrados: string[];
}

export interface Escenario {
  tipo: TipoEscenario; costoTotal: number; diasEstimados: number | null; viajesEstimados: number;
  detalle: DetalleEscenario; esPrincipal: boolean;
}

interface EleccionPorProducto { productoId: number; descripcion: string; cantidad: number | null; item: CotizacionFila['items'][number] & { proveedor: string; plazoEntregaDias: number | null } }

function elegirCandidatos(productos: ProductoCompra[], cotizaciones: CotizacionFila[]) {
  // Por producto, las cotizaciones que lo cubren y no son excluyentes (NO_ES_EL_PRODUCTO se descarta).
  const porProducto = new Map<number, EleccionPorProducto['item'][]>();
  for (const c of cotizaciones) {
    for (const it of c.items) {
      if (it.cumple === 'NO_ES_EL_PRODUCTO' || it.precioUnitario == null) continue;
      const arr = porProducto.get(it.productoId) || [];
      arr.push({ ...it, proveedor: c.proveedorNombre, plazoEntregaDias: c.plazoEntregaDias });
      porProducto.set(it.productoId, arr);
    }
  }
  return porProducto;
}

/** §8.10 — 4 escenarios ponderando precio + cantidad de compras + cantidad de viajes + agrupación
 *  geográfica, todo calculado desde la bodega de Talagante (§8.10.1). Sin catálogo de fleteros real
 *  todavía (tanda 4), el "viaje" se aproxima agrupando por proveedor (una recogida por proveedor
 *  distinto) y el costo de cada viaje usa el valor fijo interno (§8.10.2). Se perfecciona cuando
 *  exista la tabla de fleteros. */
export async function calcularEscenarios(negocioId: number): Promise<Escenario[]> {
  const productos = (await listarProductosCompra(negocioId)).filter(p => p.subestado !== 'RENUNCIADO');
  if (productos.length === 0) return []; // nada que escenariar sin productos poblados
  const cotizaciones = await listarCotizaciones(negocioId);
  if (cotizaciones.length === 0) return []; // sin ninguna cotización todavía: no hay nada que ponderar
  const porProducto = elegirCandidatos(productos, cotizaciones);

  function armar(tipo: TipoEscenario, elegir: (candidatos: EleccionPorProducto['item'][]) => EleccionPorProducto['item'] | undefined): Escenario | null {
    const porProductoDetalle: DetalleEscenario['porProducto'] = [];
    const proveedoresSet = new Set<string>();
    let costoMercaderia = 0;
    let diasMax = 0;
    let cubreTodo = true;
    for (const p of productos) {
      const candidatos = porProducto.get(p.id) || [];
      const elegido = candidatos.length ? elegir(candidatos) : undefined;
      if (!elegido) { cubreTodo = false; porProductoDetalle.push({ productoId: p.id, descripcion: p.descripcion, proveedor: null, precioUnitario: null, cantidad: p.cantidad, subtotal: null, plazoEntregaDias: null }); continue; }
      const subtotal = (elegido.precioUnitario || 0) * (p.cantidad || 1);
      costoMercaderia += subtotal;
      proveedoresSet.add(elegido.proveedor);
      if (elegido.plazoEntregaDias != null) diasMax = Math.max(diasMax, elegido.plazoEntregaDias);
      porProductoDetalle.push({ productoId: p.id, descripcion: p.descripcion, proveedor: elegido.proveedor, precioUnitario: elegido.precioUnitario, cantidad: p.cantidad, subtotal, plazoEntregaDias: elegido.plazoEntregaDias });
    }
    if (!cubreTodo && porProductoDetalle.every(d => d.proveedor == null)) return null; // sin ninguna cotización todavía
    const viajes = proveedoresSet.size; // proxy de "un viaje por proveedor" hasta que exista tanda 4 (fleteros reales)
    const costoLogistico = viajes * VIAJE_INTERNO_CLP;
    return {
      tipo, costoTotal: costoMercaderia + costoLogistico, diasEstimados: diasMax || null, viajesEstimados: viajes,
      detalle: { porProducto: porProductoDetalle, proveedoresInvolucrados: [...proveedoresSet] },
      esPrincipal: tipo === 'MAS_RAPIDO',
    };
  }

  const masRapido = armar('MAS_RAPIDO', cands =>
    [...cands].sort((a, b) => (a.plazoEntregaDias ?? 999) - (b.plazoEntregaDias ?? 999))[0]);
  const minimoPrecio = armar('MINIMO_PRECIO', cands =>
    [...cands].sort((a, b) => (a.precioUnitario ?? Infinity) - (b.precioUnitario ?? Infinity))[0]);
  // Mínimos viajes: prioriza concentrar en el proveedor que ya cubre más productos (agrupación §8.10).
  const conteoProveedor = new Map<string, number>();
  for (const arr of porProducto.values()) for (const it of arr) conteoProveedor.set(it.proveedor, (conteoProveedor.get(it.proveedor) || 0) + 1);
  const minimosViajes = armar('MINIMOS_VIAJES', cands =>
    [...cands].sort((a, b) => (conteoProveedor.get(b.proveedor) || 0) - (conteoProveedor.get(a.proveedor) || 0) || (a.precioUnitario ?? Infinity) - (b.precioUnitario ?? Infinity))[0]);
  const equilibrado = armar('EQUILIBRADO', cands =>
    [...cands].sort((a, b) => {
      const scoreA = (a.precioUnitario ?? Infinity) - (conteoProveedor.get(a.proveedor) || 0) * 1000;
      const scoreB = (b.precioUnitario ?? Infinity) - (conteoProveedor.get(b.proveedor) || 0) * 1000;
      return scoreA - scoreB;
    })[0]);

  return [masRapido, minimoPrecio, minimosViajes, equilibrado].filter((e): e is Escenario => e != null);
  // NOTA: esta función es de solo cálculo — NO escribe en `compras_escenario`. Antes lo hacía en
  // cada llamada, y como el GET de pantalla la invoca en cada carga, insertaba 4 filas nuevas por
  // cada vez que alguien miraba la pestaña (la tabla crecía sin límite y sin ningún valor: nadie
  // consulta ese histórico). La única escritura real ocurre en `elegirEscenario`, que es el único
  // momento con significado de negocio (§8.10.4).
}

/** §8.10.4 — el encargado puede salirse del escenario sugerido, pero debe justificarlo. Recalcula
 *  los 4 escenarios en el momento (no depende de una fila ya persistida) y guarda SOLO el elegido —
 *  ese es el único escenario cuyo cálculo importa conservar en el tiempo. */
export async function elegirEscenario(
  negocioId: number, tipo: TipoEscenario, justificacion: string | null, actorId: number, actorNombre: string | null,
): Promise<void> {
  if (tipo !== 'MAS_RAPIDO' && !justificacion?.trim()) {
    throw new Error('Elegir un escenario distinto de "Más rápido" requiere justificación (spec §8.10.4).');
  }
  const escenarios = await calcularEscenarios(negocioId);
  const elegido = escenarios.find(e => e.tipo === tipo);
  if (!elegido) throw new Error('No hay un escenario calculado de ese tipo — carga cotizaciones primero.');

  const ahora = ahoraChileSQL();
  await pool.query(`UPDATE compras_escenario SET elegido = 0 WHERE negocio_id = ?`, [negocioId]);
  await pool.query(
    `INSERT INTO compras_escenario
       (negocio_id, tipo, detalle_json, costo_total, dias_estimados, viajes_estimados, generado_at,
        elegido, elegido_justificacion, elegido_por, elegido_por_nombre, elegido_at)
     VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`,
    [negocioId, elegido.tipo, JSON.stringify(elegido.detalle), elegido.costoTotal, elegido.diasEstimados, elegido.viajesEstimados,
     ahora, justificacion || null, actorId, actorNombre, ahora],
  );

  // Cambiar el escenario elegido cambia lo que se va a comprar — invalida una aprobación previa (§10.5).
  await invalidarAprobacionesCompras(negocioId, 'Se eligió un escenario de compra distinto.');
  await registrarEvento({
    tipo: 'COMPRAS_ESCENARIO_ELEGIDO', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `Se eligió el escenario "${tipo}" (${fmtMonto(elegido.costoTotal)})${justificacion ? `: ${justificacion}` : ''}.`,
    metadata: { negocio_id: negocioId, tipo, costoTotal: elegido.costoTotal },
  });
}

/** Qué escenario está elegido HOY (si alguno) — para que la pantalla pinte "Elegido" en la tarjeta
 *  correcta sin tener que adivinarlo comparando costos. */
export async function escenarioElegidoTipo(negocioId: number): Promise<TipoEscenario | null> {
  const [rows] = await pool.query(
    `SELECT tipo FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`,
    [negocioId],
  ) as any;
  return (rows as any[])[0]?.tipo ?? null;
}
