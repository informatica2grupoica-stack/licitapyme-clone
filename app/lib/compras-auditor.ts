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
import { precioClpDeItemIA } from '@/app/lib/compras-precio-homologacion';
import pool from '@/app/lib/db';
import { esRutPropio } from '@/app/lib/auditor-compras-datos';
import { filasDeCotizacion, programarAuditoria } from '@/app/lib/auditor-compras';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { proveedorPorRut, listarComprasOc, listarComprasDte } from '@/app/lib/obuma';
import { listarProductosCompra, invalidarAprobacionesCompras, type ProductoCompra } from '@/app/lib/compras';
import { obtenerOCrearProveedor } from '@/app/lib/compras-proveedores';
import { obtenerTipoCambio } from '@/app/lib/tipo-cambio';
import { parsearDiasDeTexto } from '@/app/lib/numeros';
import { auditarCotizacionEnSegundoPlano } from '@/app/lib/compras-auditoria-cotizacion';

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
  // `precioUnitario`/`precioTotal` que llegan acá son BRUTOS (lo que dice el documento, antes de
  // descuento) — `descuentoPct`, si viene, se aplica adentro de registrarCotizacion para calcular el
  // NETO real, que es el que termina guardado en `precio_unitario`/`precio_total` (mismo campo de
  // siempre — nada río abajo tuvo que enterarse de que existe un descuento). Pedido explícito del
  // usuario (14-sep-2026, caso real Trotec Chile 4%): sin esto, cada cotización con descuento se
  // guardaba con el precio de ANTES de negociar, y el cuadro comparativo/escenarios/margen nunca
  // veían lo barato que salió de verdad.
  precioUnitario?: number | null; precioTotal?: number | null; descuentoPct?: number | null; moneda?: string;
  plazoEntregaTexto?: string | null; plazoEntregaDias?: number | null;
  // Cargo REAL de flete que cobra el proveedor, si lo desglosa en el documento (pedido explícito,
  // 14-sep-2026: "si pongo no incluye flete es porque nos cobran el flete pero no me deja poner
  // cuánto es"). Cuando viene, `calcularEscenarios` lo usa en vez de adivinar con el interno fijo
  // ($40.000, §8.10.2) — ver el comentario largo en la función `armar` más abajo.
  fleteMonto?: number | null;
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
  // El lector a veces toma el RUT del COMPRADOR (nosotros) como el del proveedor (caso real PanTai, #994): nunca es válido.
  if (await esRutPropio(proveedorRut)) proveedorRut = null;
  let proveedorId = datos.proveedorId ?? null;
  if (proveedorId) {
    const [pRows] = await pool.query(`SELECT nombre_empresa, rut FROM compras_proveedor WHERE id = ?`, [proveedorId]) as any;
    const p = (pRows as any[])[0];
    if (p) { proveedorNombre = p.nombre_empresa; proveedorRut = p.rut; }
    if (await esRutPropio(proveedorRut)) proveedorRut = null;
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
  if (datos.descuentoPct != null && (!Number.isFinite(datos.descuentoPct) || datos.descuentoPct <= 0 || datos.descuentoPct >= 100)) datos.descuentoPct = null;

  // Descuento (pedido explícito del usuario, 14-sep-2026): se aplica ACÁ, una sola vez, ANTES de
  // que el resto de la función toque `precioUnitario`/`precioTotal` — así la conversión de moneda,
  // el guardado y el evento de historial de más abajo ya trabajan con el NETO real sin saber que
  // existe un descuento. El bruto se guarda aparte, solo para mostrar el desglose.
  const precioUnitarioBruto = datos.descuentoPct != null ? datos.precioUnitario : null;
  if (datos.descuentoPct != null) {
    const factor = 1 - datos.descuentoPct / 100;
    if (datos.precioUnitario != null) datos.precioUnitario = Math.round(datos.precioUnitario * factor);
    if (datos.precioTotal != null) datos.precioTotal = Math.round(datos.precioTotal * factor);
  }

  // Conversión a CLP (hallazgo real 09-sep-2026, cotización de Unisource en USD): el cuadro
  // comparativo y los escenarios comparan precios — comparar USD contra CLP sin convertir es un
  // error de cálculo, no cosmético. Se guardan AMBOS: el original (para mostrar el documento tal
  // cual llegó) y el convertido (el que de verdad entra a las cuentas), con el tipo de cambio del
  // día como foto — nunca se recalcula después.
  const moneda = datos.moneda || 'CLP';
  let tipoCambioUsado: number | null = null;
  let precioUnitarioClp = datos.precioUnitario ?? null;
  let precioTotalClp = datos.precioTotal ?? null;
  // `flete_monto` se guarda SIEMPRE en CLP (es lo que `calcularEscenarios` suma directo al costo del
  // escenario, que ya trabaja 100% en CLP) — mismo criterio de conversión que precioUnitario/Total.
  let fleteMontoClp = datos.fleteMonto ?? null;
  if (moneda !== 'CLP') {
    const tc = await obtenerTipoCambio(moneda);
    if (tc) {
      tipoCambioUsado = tc.valor;
      precioUnitarioClp = datos.precioUnitario != null ? Math.round(datos.precioUnitario * tc.valor) : null;
      precioTotalClp = datos.precioTotal != null ? Math.round(datos.precioTotal * tc.valor) : null;
      fleteMontoClp = datos.fleteMonto != null ? Math.round(datos.fleteMonto * tc.valor) : null;
    } else {
      // Sin tipo de cambio disponible: NO se inventa un valor CLP — queda sin convertir y el
      // cuadro comparativo/escenarios la excluyen hasta que se pueda convertir.
      precioUnitarioClp = null; precioTotalClp = null; fleteMontoClp = null;
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
        precio_unitario_bruto, descuento_pct,
        moneda, tipo_cambio_usado, precio_unitario_clp, precio_total_clp,
        plazo_entrega_texto, plazo_entrega_dias, incluye_flete, flete_monto, direccion_bodega, ficha_tecnica_url,
        archivo_url, archivo_nombre, registrado_por, registrado_por_nombre, tomada_at, vigencia_at, notas, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      negocioId, proveedorId || null, proveedorNombre.slice(0, 300), proveedorRut || null, datos.origen,
      datos.descripcionLibre || null, datos.precioUnitario ?? null, datos.precioTotal ?? null,
      precioUnitarioBruto ?? null, datos.descuentoPct ?? null,
      moneda, tipoCambioUsado, precioUnitarioClp, precioTotalClp,
      datos.plazoEntregaTexto || null, plazoEntregaDias,
      datos.incluyeFlete == null ? null : (datos.incluyeFlete ? 1 : 0), fleteMontoClp, datos.direccionBodega || null,
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
    // BUG REAL (15-sep-2026, negocio 332, cotización de Eter srl en EUR): si el comprador marca el
    // checkbox de un producto pero deja "Precio unitario" en blanco (asumiendo, con razón, que el
    // precio de LA cotización completa ya es el precio de ESE producto), el ítem quedaba con
    // precio_unitario NULL para siempre — el producto salía "sin cotización, no cubierto" del
    // cuadro comparativo y los escenarios, aunque la cotización sí tuviera un precio. El camino de
    // homologación por IA (más abajo, línea ~494) YA caía al precio_unitario_clp de la cotización
    // cuando la IA no asignaba uno propio — acá faltaba exactamente ese mismo respaldo.
    const itemsClp = datos.itemsManual.map(it => ({
      productoId: it.productoId,
      precioUnitario: it.precioUnitario == null
        ? precioUnitarioClp // sin precio propio tipeado: usa el de la cotización completa (ya en CLP)
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

// ── Editar / eliminar una cotización ya registrada (pedido explícito del usuario, 14-sep-2026:
// "tampoco se pueden eliminar ni editar las cotizaciones y eso es básico") ─────────────────────────
export interface DatosEdicionCotizacion {
  proveedorNombre: string; proveedorRut?: string | null;
  descripcionLibre?: string | null;
  precioUnitario?: number | null; precioTotal?: number | null; descuentoPct?: number | null; moneda?: string;
  plazoEntregaTexto?: string | null; incluyeFlete?: boolean | null; fleteMonto?: number | null;
  vigenciaAt?: string | null; notas?: string | null;
}

/** Reemplaza los datos de una cotización ya registrada (proveedor, precio, descuento, plazo, flete)
 *  — mismo cálculo de descuento/moneda que `registrarCotizacion`, para que editar y crear nunca
 *  diverjan en cómo calculan el neto. NO toca los ítems asignados (eso sigue siendo "Asignar
 *  productos", un paso aparte) — así una corrección de precio en la cabecera no pisa en silencio
 *  una asignación que alguien ya revisó a mano. */
export async function actualizarCotizacion(
  negocioId: number, cotizacionId: number, datos: DatosEdicionCotizacion, actorId: number, actorNombre: string | null,
): Promise<void> {
  const [existe] = await pool.query(`SELECT id FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`, [cotizacionId, negocioId]) as any;
  if (!(existe as any[])[0]) throw new Error('Cotización no encontrada.');
  if (!datos.proveedorNombre?.trim()) throw new Error('Falta el proveedor.');

  let proveedorNombre = datos.proveedorNombre.trim();
  let proveedorRut = datos.proveedorRut ?? null;
  if (await esRutPropio(proveedorRut)) proveedorRut = null; // ver registrarCotizacion
  const proveedorId = await obtenerOCrearProveedor(proveedorNombre, proveedorRut, actorId, actorNombre).catch(() => null);
  if (proveedorId) {
    const [pRows] = await pool.query(`SELECT nombre_empresa, rut FROM compras_proveedor WHERE id = ?`, [proveedorId]) as any;
    const p = (pRows as any[])[0];
    if (p) { proveedorNombre = p.nombre_empresa; proveedorRut = p.rut; }
    if (await esRutPropio(proveedorRut)) proveedorRut = null;
  }

  if (datos.precioUnitario != null && !Number.isFinite(datos.precioUnitario)) datos.precioUnitario = null;
  if (datos.precioTotal != null && !Number.isFinite(datos.precioTotal)) datos.precioTotal = null;
  if (datos.descuentoPct != null && (!Number.isFinite(datos.descuentoPct) || datos.descuentoPct <= 0 || datos.descuentoPct >= 100)) datos.descuentoPct = null;

  // Mismo cálculo de descuento que registrarCotizacion — ver el comentario largo ahí.
  const precioUnitarioBruto = datos.descuentoPct != null ? datos.precioUnitario : null;
  if (datos.descuentoPct != null) {
    const factor = 1 - datos.descuentoPct / 100;
    if (datos.precioUnitario != null) datos.precioUnitario = Math.round(datos.precioUnitario * factor);
    if (datos.precioTotal != null) datos.precioTotal = Math.round(datos.precioTotal * factor);
  }

  const moneda = datos.moneda || 'CLP';
  let tipoCambioUsado: number | null = null;
  let precioUnitarioClp = datos.precioUnitario ?? null;
  let precioTotalClp = datos.precioTotal ?? null;
  let fleteMontoClp = datos.fleteMonto ?? null;
  if (moneda !== 'CLP') {
    const tc = await obtenerTipoCambio(moneda);
    if (tc) {
      tipoCambioUsado = tc.valor;
      precioUnitarioClp = datos.precioUnitario != null ? Math.round(datos.precioUnitario * tc.valor) : null;
      precioTotalClp = datos.precioTotal != null ? Math.round(datos.precioTotal * tc.valor) : null;
      fleteMontoClp = datos.fleteMonto != null ? Math.round(datos.fleteMonto * tc.valor) : null;
    } else {
      precioUnitarioClp = null; precioTotalClp = null; fleteMontoClp = null;
    }
  }

  const plazoEntregaDias = parsearDiasDeTexto(datos.plazoEntregaTexto);

  await pool.query(
    `UPDATE compras_cotizacion SET
       proveedor_id = ?, proveedor_nombre = ?, proveedor_rut = ?, descripcion_libre = ?,
       precio_unitario = ?, precio_total = ?, precio_unitario_bruto = ?, descuento_pct = ?,
       moneda = ?, tipo_cambio_usado = ?, precio_unitario_clp = ?, precio_total_clp = ?,
       plazo_entrega_texto = ?, plazo_entrega_dias = ?, incluye_flete = ?, flete_monto = ?, vigencia_at = ?, notas = ?
     WHERE id = ? AND negocio_id = ?`,
    [
      proveedorId || null, proveedorNombre.slice(0, 300), proveedorRut || null, datos.descripcionLibre || null,
      datos.precioUnitario ?? null, datos.precioTotal ?? null, precioUnitarioBruto ?? null, datos.descuentoPct ?? null,
      moneda, tipoCambioUsado, precioUnitarioClp, precioTotalClp,
      datos.plazoEntregaTexto || null, plazoEntregaDias,
      datos.incluyeFlete == null ? null : (datos.incluyeFlete ? 1 : 0), fleteMontoClp, datos.vigenciaAt || null, datos.notas || null,
      cotizacionId, negocioId,
    ],
  );

  // Un precio o proveedor editado puede cambiar lo que ya se había aprobado a comprar — mismo
  // criterio que elegir un escenario distinto (§10.5): la aprobación vieja queda sobre un número
  // que ya no es real.
  await invalidarAprobacionesCompras(negocioId, 'Se editó una cotización que puede afectar el costo.');
  // Lo editado (precio, plazo, vigencia, descripción) cambia lo que hay que auditar: se re-audita.
  auditarCotizacionEnSegundoPlano(negocioId, cotizacionId, { id: actorId, nombre: actorNombre });
  await registrarEvento({
    tipo: 'COMPRAS_COTIZACION_EDITADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se editó la cotización de "${proveedorNombre}"${datos.precioUnitario ? ` — ${fmtMonto(datos.precioUnitario)}` : ''}.`,
    metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId },
  });
}

/** Borra una cotización y sus ítems asignados. Mismo criterio que editar (§10.5): si esta
 *  cotización ya estaba metida en un escenario aprobado, borrarla invalida esa aprobación — nadie
 *  debe quedar con una compra aprobada sobre una cotización que ya no existe. */
export async function eliminarCotizacion(negocioId: number, cotizacionId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const [rows] = await pool.query(`SELECT proveedor_nombre FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`, [cotizacionId, negocioId]) as any;
  const c = (rows as any[])[0];
  if (!c) throw new Error('Cotización no encontrada.');

  // Auditor de Compras: las líneas que se apoyaban en esta cotización se re-auditan sin ella.
  const filasAfectadas = await filasDeCotizacion(negocioId, cotizacionId).catch(() => [] as string[]);
  await pool.query(`DELETE FROM compras_cotizacion_item WHERE cotizacion_id = ?`, [cotizacionId]);
  await pool.query(`DELETE FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`, [cotizacionId, negocioId]);
  for (const f of filasAfectadas) programarAuditoria(negocioId, f, { id: actorId, nombre: actorNombre });

  await invalidarAprobacionesCompras(negocioId, 'Se eliminó una cotización que puede afectar el costo.');
  await registrarEvento({
    tipo: 'COMPRAS_COTIZACION_ELIMINADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se eliminó la cotización de "${c.proveedor_nombre}".`,
    metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId },
  });
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
  precioUnitarioBruto: number | null; descuentoPct: number | null;
  moneda: string; tipoCambioUsado: number | null; precioUnitarioClp: number | null; precioTotalClp: number | null;
  plazoEntregaTexto: string | null; plazoEntregaDias: number | null; incluyeFlete: boolean | null; fleteMonto: number | null;
  ficaTecnicaUrl: string | null; archivoUrl: string | null; homologadaAt: string | null; tomadaAt: string;
  // Pedido explícito del usuario (15-sep-2026: "le pongo dónde que se cotizó pero cuando edito no
  // aparece nada") — BUG REAL: esta consulta ni siquiera traía `descripcion_libre`, así que
  // `iniciarEdicion` en el frontend no tenía de dónde sacarlo y lo dejaba fijo en '' — se perdía
  // literalmente lo que la persona había escrito, cada vez que abría "Editar".
  descripcionLibre: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null; cumple: CumpleItem; detalleDesviacion: string | null }>;
}

export async function listarCotizaciones(negocioId: number): Promise<CotizacionFila[]> {
  const [rows] = await pool.query(
    `SELECT id, proveedor_id, proveedor_nombre, proveedor_rut, proveedor_nuevo, origen, descripcion_libre, precio_unitario, precio_total,
            precio_unitario_bruto, descuento_pct,
            moneda, tipo_cambio_usado, precio_unitario_clp, precio_total_clp,
            plazo_entrega_texto, plazo_entrega_dias, incluye_flete, flete_monto, ficha_tecnica_url, archivo_url,
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
    descripcionLibre: c.descripcion_libre,
    precioUnitario: c.precio_unitario == null ? null : Number(c.precio_unitario),
    precioTotal: c.precio_total == null ? null : Number(c.precio_total),
    precioUnitarioBruto: c.precio_unitario_bruto == null ? null : Number(c.precio_unitario_bruto),
    descuentoPct: c.descuento_pct == null ? null : Number(c.descuento_pct),
    moneda: c.moneda || 'CLP', tipoCambioUsado: c.tipo_cambio_usado == null ? null : Number(c.tipo_cambio_usado),
    precioUnitarioClp: c.precio_unitario_clp == null ? null : Number(c.precio_unitario_clp),
    precioTotalClp: c.precio_total_clp == null ? null : Number(c.precio_total_clp),
    plazoEntregaTexto: c.plazo_entrega_texto, plazoEntregaDias: c.plazo_entrega_dias,
    incluyeFlete: c.incluye_flete == null ? null : !!c.incluye_flete,
    fleteMonto: c.flete_monto == null ? null : Number(c.flete_monto),
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
  const [cotizRows] = await pool.query(`SELECT id, precio_unitario_clp FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`, [cotizacionId, negocioId]) as any;
  const cotiz = (cotizRows as any[])[0];
  if (!cotiz) throw new Error('Cotización no encontrada para este negocio.');

  const productos = await listarProductosCompra(negocioId);
  const idsValidos = new Set(productos.map(p => p.id));
  const limpios = items.filter(it => idsValidos.has(it.productoId));
  if (limpios.length === 0) throw new Error('Ningún producto válido en la asignación.');

  await pool.query(`DELETE FROM compras_cotizacion_item WHERE cotizacion_id = ?`, [cotizacionId]);
  // Mismo blindaje contra NaN que registrarCotizacion — nunca debe llegar un NaN a la consulta.
  // BUG REAL (15-sep-2026): si el comprador asigna el producto pero deja "Precio unitario" en
  // blanco (asumiendo, con razón, que el precio de LA cotización completa ya es el de ese
  // producto), esto guardaba NULL y el producto salía "sin cotización" del cuadro comparativo y
  // los escenarios — mismo fix que en registrarCotizacion (itemsManual): sin precio propio, cae al
  // precio_unitario_clp ya calculado de la cotización.
  const filas = limpios.map(it => [
    cotizacionId, it.productoId,
    it.precioUnitario != null && Number.isFinite(it.precioUnitario) ? it.precioUnitario
      : (cotiz.precio_unitario_clp != null ? Number(cotiz.precio_unitario_clp) : null),
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
  // Auditor real (21-sep-2026): el `cumple` que se eligió a mano queda solo como punto de partida —
  // apenas se asigna, el auditor compara la cotización contra lo exigido y fija el veredicto con su
  // evidencia (una decisión manual distinta exige motivo, ver registrarOverrideAuditoria).
  auditarCotizacionEnSegundoPlano(negocioId, cotizacionId, actorId ? { id: actorId, nombre: actorNombre ?? null } : undefined);
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
  const itemsValidos = items.filter((x: any) => productos[Number(x?.producto) - 1] && cumples.includes(x?.cumple)).length;
  for (const it of items) {
    const idx = Number(it?.producto);
    const producto = productos[idx - 1];
    if (!producto || !cumples.includes(it.cumple)) continue;
    // compras_cotizacion_item.precio_unitario es SIEMPRE CLP (es lo que alimenta el cuadro
    // comparativo y los escenarios) — si la IA asignó un precio propio, viene en la moneda del
    // documento (se le pidió explícitamente que no convirtiera) y hay que pasarlo por el mismo
    // tipo de cambio que se congeló al registrar la cotización; si no asignó nada, cae al precio
    // unitario CLP ya calculado a nivel de cotización.
    // Number(null) es 0: antes un producto SIN precio propio quedaba guardado con precio $0 (caso real
    // PanTai/#994). La regla vive en compras-precio-homologacion.ts, con pruebas.
    const precioClp = precioClpDeItemIA({
      precioUnitarioAsignado: it.precioUnitarioAsignado, tipoCambio,
      precioClpCotizacion: cotiz.precio_unitario_clp != null ? Number(cotiz.precio_unitario_clp) : null,
      totalItemsAsignados: itemsValidos,
    });
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
  // La homologación solo decide A QUÉ producto corresponde; que sea de verdad el producto y cumpla
  // lo exigido lo dictamina el auditor, con evidencia (compras-auditoria-cotizacion.ts).
  if (escritos > 0) auditarCotizacionEnSegundoPlano(cotiz.negocio_id, cotizacionId);
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
  porProducto: Array<{ productoId: number; descripcion: string; proveedor: string | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null; plazoEntregaDias: number | null; incluyeFlete: boolean | null; fleteMonto: number | null }>;
  proveedoresInvolucrados: string[];
}

export interface Escenario {
  tipo: TipoEscenario; costoTotal: number; diasEstimados: number | null; viajesEstimados: number;
  detalle: DetalleEscenario; esPrincipal: boolean;
  // Pedido explícito del usuario (15-sep-2026): "no me puedes poner 40 por defecto, eso lo tenemos
  // que poner nosotros ya que es dinero" — true si hay al menos un proveedor que necesita viaje
  // (incluyeFlete !== true) y NADIE escribió cuánto cuesta ese viaje. El monto ya NO se adivina con
  // VIAJE_INTERNO_CLP (ver armar() más abajo): queda en $0 y esta bandera avisa que ese $0 no es un
  // dato confirmado, es solo "todavía no se sabe".
  fleteSinConfirmar: boolean;
}

interface EleccionPorProducto { productoId: number; descripcion: string; cantidad: number | null; item: CotizacionFila['items'][number] & { cotizacionId: number; moneda: string; tipoCambioUsado: number | null; proveedor: string; plazoEntregaDias: number | null; incluyeFlete: boolean | null; fleteMonto: number | null } }

// BUG REAL (11-sep-2026, reportado por el usuario contra el negocio 717): los 4 escenarios
// ordenaban candidatos SOLO por precio/plazo/agrupación, sin mirar `cumple` — así que una cotización
// INFERIOR_NEGOCIABLE (le falta algo, negociable) más barata le ganaba a una CUMPLE más cara, y una
// tercera CUMPLE intermedia (ni la más barata ni la más rápida) no aparecía en NINGÚN escenario. Caso
// real: producto "Plataformas satelital - GOES CS2" — Satellite ($5.950.000/un, INFERIOR_NEGOCIABLE)
// le ganaba a TechSat ($6.745.621/un, CUMPLE) en "Mínimo precio" solo por ser más barata, aunque
// tenía una brecha técnica sin cerrar. Spec §8.8.1 ("ningún proveedor se excluye por incumplimiento
// técnico") dice que no se EXCLUYE — no dice que se prefiera un candidato con brecha sobre uno que
// cumple íntegro cuando ambos están disponibles. Fix: se ordena primero por nivel de cumplimiento
// (CUMPLE/MEJORA antes que INFERIOR_NEGOCIABLE antes que INFERIOR_INSALVABLE) y RECIÉN dentro del
// mismo nivel se aplica el criterio propio de cada escenario (precio, plazo, agrupación). Un
// candidato con brecha solo gana si es el ÚNICO que cubre ese producto — ahí sigue sin excluirse.
function tierCumple(c: CumpleItem): number {
  switch (c) {
    case 'CUMPLE': case 'MEJORA': return 0;
    case 'INFERIOR_NEGOCIABLE': return 1;
    case 'INFERIOR_INSALVABLE': return 2;
    default: return 3; // NO_ES_EL_PRODUCTO ya se filtra antes de llegar acá
  }
}

function elegirCandidatos(productos: ProductoCompra[], cotizaciones: CotizacionFila[]) {
  // Por producto, las cotizaciones que lo cubren y no son excluyentes (NO_ES_EL_PRODUCTO se descarta).
  const porProducto = new Map<number, EleccionPorProducto['item'][]>();
  for (const c of cotizaciones) {
    for (const it of c.items) {
      if (it.cumple === 'NO_ES_EL_PRODUCTO' || it.precioUnitario == null) continue;
      const arr = porProducto.get(it.productoId) || [];
      arr.push({ ...it, cotizacionId: c.id, moneda: c.moneda, tipoCambioUsado: c.tipoCambioUsado, proveedor: c.proveedorNombre, plazoEntregaDias: c.plazoEntregaDias, incluyeFlete: c.incluyeFlete, fleteMonto: c.fleteMonto });
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
    // BUG REAL (14-sep-2026, reportado por el usuario: "en la segunda cotización no tenemos flete...
    // le puse sin flete en las opciones y no lo considera"): `incluyeFlete` se pedía en el
    // formulario, se guardaba en la cotización, y `calcularEscenarios` NUNCA lo leía — el viaje
    // interno de $40.000 se sumaba SIEMPRE, una vez por cada proveedor distinto, sin importar lo que
    // la persona hubiera marcado. Ahora solo cuentan como "necesitan viaje" los proveedores cuyo
    // ítem elegido tiene `incluyeFlete !== true` — si el proveedor ya incluye el despacho en su
    // precio (o retira/entrega sin que haga falta un viaje propio), no se le cobra el interno.
    //
    // SEGUNDO PEDIDO (mismo día): "si pongo no incluye flete es porque nos cobran el flete pero no
    // me deja poner cuánto es". Cuando la cotización trae `fleteMonto` (leído del documento o
    // tipeado a mano), ESE es el cargo real del proveedor — se usa en vez de adivinar con el interno
    // fijo. Si dos productos del mismo proveedor traen `fleteMonto` distintos (raro, pero posible:
    // dos cotizaciones separadas), gana el primero que se encuentre — un proveedor paga UN flete por
    // viaje, no uno por cada línea de producto.
    const proveedoresNecesitanViaje = new Map<string, number | null>(); // proveedor -> fleteMonto real (null = usar el interno fijo)
    let costoMercaderia = 0;
    let diasMax = 0;
    let cubreTodo = true;
    for (const p of productos) {
      const candidatos = porProducto.get(p.id) || [];
      const elegido = candidatos.length ? elegir(candidatos) : undefined;
      if (!elegido) { cubreTodo = false; porProductoDetalle.push({ productoId: p.id, descripcion: p.descripcion, proveedor: null, precioUnitario: null, cantidad: p.cantidad, subtotal: null, plazoEntregaDias: null, incluyeFlete: null, fleteMonto: null }); continue; }
      const subtotal = (elegido.precioUnitario || 0) * (p.cantidad || 1);
      costoMercaderia += subtotal;
      proveedoresSet.add(elegido.proveedor);
      if (elegido.incluyeFlete !== true) {
        const actual = proveedoresNecesitanViaje.get(elegido.proveedor);
        if (actual === undefined || (actual == null && elegido.fleteMonto != null)) {
          proveedoresNecesitanViaje.set(elegido.proveedor, elegido.fleteMonto);
        }
      }
      if (elegido.plazoEntregaDias != null) diasMax = Math.max(diasMax, elegido.plazoEntregaDias);
      porProductoDetalle.push({ productoId: p.id, descripcion: p.descripcion, proveedor: elegido.proveedor, precioUnitario: elegido.precioUnitario, cantidad: p.cantidad, subtotal, plazoEntregaDias: elegido.plazoEntregaDias, incluyeFlete: elegido.incluyeFlete, fleteMonto: elegido.fleteMonto });
    }
    if (!cubreTodo && porProductoDetalle.every(d => d.proveedor == null)) return null; // sin ninguna cotización todavía
    const viajes = proveedoresNecesitanViaje.size; // proxy de "un viaje por proveedor que lo necesita" hasta que exista tanda 4 (fleteros reales)
    // BUG REAL (15-sep-2026, reportado en vivo por el usuario: "no me puedes poner 40 por defecto,
    // eso lo tenemos que poner nosotros ya que es dinero"): hasta acá, un proveedor que "necesita
    // viaje" pero sin `fleteMonto` tipeado sumaba VIAJE_INTERNO_CLP ($40.000) en silencio al costo
    // del escenario — ese número entraba tal cual a la aprobación de compra/margen sin que nadie lo
    // hubiera escrito ni confirmado. Ahora un monto no informado cuenta como $0 (no se inventa un
    // número), y `fleteSinConfirmar` avisa en la UI que ese $0 no es un dato real, es solo que
    // todavía nadie lo cargó — mismo criterio "avisa, no adivina" que el resto del módulo.
    const fleteSinConfirmar = [...proveedoresNecesitanViaje.values()].some(monto => monto == null);
    const costoLogistico = [...proveedoresNecesitanViaje.values()].reduce((s: number, monto) => s + (monto ?? 0), 0);
    return {
      tipo, costoTotal: costoMercaderia + costoLogistico, diasEstimados: diasMax || null, viajesEstimados: viajes,
      detalle: { porProducto: porProductoDetalle, proveedoresInvolucrados: [...proveedoresSet] },
      esPrincipal: tipo === 'MAS_RAPIDO', fleteSinConfirmar,
    };
  }

  const masRapido = armar('MAS_RAPIDO', cands =>
    [...cands].sort((a, b) => tierCumple(a.cumple) - tierCumple(b.cumple) || (a.plazoEntregaDias ?? 999) - (b.plazoEntregaDias ?? 999))[0]);
  const minimoPrecio = armar('MINIMO_PRECIO', cands =>
    [...cands].sort((a, b) => tierCumple(a.cumple) - tierCumple(b.cumple) || (a.precioUnitario ?? Infinity) - (b.precioUnitario ?? Infinity))[0]);
  // Mínimos viajes: prioriza concentrar en el proveedor que ya cubre más productos (agrupación §8.10).
  const conteoProveedor = new Map<string, number>();
  for (const arr of porProducto.values()) for (const it of arr) conteoProveedor.set(it.proveedor, (conteoProveedor.get(it.proveedor) || 0) + 1);
  const minimosViajes = armar('MINIMOS_VIAJES', cands =>
    [...cands].sort((a, b) => tierCumple(a.cumple) - tierCumple(b.cumple)
      || (conteoProveedor.get(b.proveedor) || 0) - (conteoProveedor.get(a.proveedor) || 0) || (a.precioUnitario ?? Infinity) - (b.precioUnitario ?? Infinity))[0]);
  const equilibrado = armar('EQUILIBRADO', cands =>
    [...cands].sort((a, b) => {
      const tierDiff = tierCumple(a.cumple) - tierCumple(b.cumple);
      if (tierDiff !== 0) return tierDiff;
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

// ── TODAS las combinaciones posibles (pedido del usuario, 25-sep-2026) ─────────────────────────────
// Los 4 escenarios de arriba son 4 heurísticas: cada una elige UNA cotización por producto con su propio
// criterio y muchas veces coinciden entre sí (con 2 productos y 3 cotizaciones, "Equilibrado" y "Mínimo
// precio" daban lo mismo). Acá se enumeran TODAS las formas de comprar: el producto cartesiano de las
// cotizaciones que cubren cada producto. Cada combinación trae su costo desglosado (mercadería + flete),
// viajes, plazo, proveedores y avisos; y se marca cuál(es) de los 4 escenarios clásicos es.
export interface ItemCombinacion {
  productoId: number; descripcion: string; cotizacionId: number; proveedor: string; cumple: CumpleItem; detalleDesviacion: string | null;
  moneda: string; tipoCambioUsado: number | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null;
  plazoEntregaDias: number | null; incluyeFlete: boolean | null; fleteMonto: number | null;
}
export interface Combinacion {
  clave: string; costoMercaderia: number; costoLogistico: number; costoTotal: number; diasEstimados: number | null; viajes: number;
  nProveedores: number; proveedores: string[]; peorCumple: CumpleItem; fleteSinConfirmar: boolean; proveedoresSinPlazo: string[];
  items: ItemCombinacion[]; etiquetas: TipoEscenario[]; diferenciaVsMasBarata: number; diferenciaPctVsMasBarata: number | null; avisos: string[];
  detalle: DetalleEscenario & { clave: string };
}
export interface ResultadoCombinaciones {
  combinaciones: Combinacion[]; totalPosibles: number; truncado: boolean;
  productosSinOferta: Array<{ productoId: number; descripcion: string }>; productosCubiertos: number;
}

const LIMITE_ENUMERACION = 3000;
const LIMITE_DEVUELTAS = 500;
const CUMPLE_TXT: Record<CumpleItem, string> = { CUMPLE: 'cumple', MEJORA: 'mejora lo pedido', INFERIOR_NEGOCIABLE: 'inferior (negociable)', INFERIOR_INSALVABLE: 'inferior (insalvable)', NO_ES_EL_PRODUCTO: 'no es el producto' };

export async function enumerarCombinaciones(negocioId: number): Promise<ResultadoCombinaciones> {
  const vacio: ResultadoCombinaciones = { combinaciones: [], totalPosibles: 0, truncado: false, productosSinOferta: [], productosCubiertos: 0 };
  const productos = (await listarProductosCompra(negocioId)).filter(p => p.subestado !== 'RENUNCIADO');
  if (productos.length === 0) return vacio;
  const cotizaciones = await listarCotizaciones(negocioId);
  if (cotizaciones.length === 0) return vacio;
  const porProducto = elegirCandidatos(productos, cotizaciones);
  const cubiertos = productos.filter(p => (porProducto.get(p.id) || []).length > 0);
  const sinOferta = productos.filter(p => (porProducto.get(p.id) || []).length === 0).map(p => ({ productoId: p.id, descripcion: p.descripcion }));
  if (cubiertos.length === 0) return { ...vacio, productosSinOferta: sinOferta };

  // Todas las combinaciones = producto cartesiano. Si explota (> LIMITE), se poda por producto a las mejores
  // (cumplimiento → precio) más la más rápida, y se avisa que es una vista recortada.
  let listas = cubiertos.map(p => porProducto.get(p.id) || []);
  const totalPosibles = listas.reduce((n, l) => n * l.length, 1);
  let truncado = false;
  if (totalPosibles > LIMITE_ENUMERACION) {
    truncado = true;
    const k = Math.max(2, Math.floor(Math.pow(LIMITE_ENUMERACION, 1 / listas.length)));
    listas = listas.map(l => {
      const orden = [...l].sort((a, b) => tierCumple(a.cumple) - tierCumple(b.cumple) || (a.precioUnitario ?? Infinity) - (b.precioUnitario ?? Infinity));
      const rapida = [...l].sort((a, b) => (a.plazoEntregaDias ?? 999) - (b.plazoEntregaDias ?? 999))[0];
      const sel = orden.slice(0, k);
      if (rapida && !sel.includes(rapida)) sel[sel.length - 1] = rapida;
      return sel;
    });
  }

  const todas: Combinacion[] = [];
  const elegidos: EleccionPorProducto['item'][] = new Array(cubiertos.length);
  const recorrer = (i: number) => {
    if (i === cubiertos.length) { todas.push(armarCombinacion(cubiertos, elegidos)); return; }
    for (const c of listas[i]) { elegidos[i] = c; recorrer(i + 1); }
  };
  recorrer(0);

  // Orden: primero las que cumplen mejor, y dentro, la más barata.
  todas.sort((a, b) => tierCumple(a.peorCumple) - tierCumple(b.peorCumple) || a.costoTotal - b.costoTotal);
  const masBarata = todas.length ? Math.min(...todas.map(c => c.costoTotal)) : 0;
  for (const c of todas) { c.diferenciaVsMasBarata = c.costoTotal - masBarata; c.diferenciaPctVsMasBarata = masBarata > 0 ? Math.round(((c.costoTotal - masBarata) / masBarata) * 1000) / 10 : null; }

  // Marca cuál(es) de los 4 escenarios clásicos coincide con cada combinación.
  const clasicos = await calcularEscenarios(negocioId).catch(() => [] as Escenario[]);
  for (const e of clasicos) {
    const firma = e.detalle.porProducto.filter(d => d.proveedor).map(d => `${d.productoId}:${d.proveedor}:${d.precioUnitario}`).sort().join('|');
    for (const c of todas) if (c.items.map(x => `${x.productoId}:${x.proveedor}:${x.precioUnitario}`).sort().join('|') === firma) c.etiquetas.push(e.tipo);
  }
  return { combinaciones: todas.slice(0, LIMITE_DEVUELTAS), totalPosibles, truncado: truncado || todas.length > LIMITE_DEVUELTAS, productosSinOferta: sinOferta, productosCubiertos: cubiertos.length };
}

function armarCombinacion(productos: ProductoCompra[], elegidos: EleccionPorProducto['item'][]): Combinacion {
  const items: ItemCombinacion[] = productos.map((p, i) => {
    const e = elegidos[i];
    return {
      productoId: p.id, descripcion: p.descripcion, cotizacionId: e.cotizacionId, proveedor: e.proveedor, cumple: e.cumple, detalleDesviacion: e.detalleDesviacion ?? null,
      moneda: e.moneda, tipoCambioUsado: e.tipoCambioUsado, precioUnitario: e.precioUnitario, cantidad: p.cantidad, subtotal: (e.precioUnitario || 0) * (p.cantidad || 1),
      plazoEntregaDias: e.plazoEntregaDias, incluyeFlete: e.incluyeFlete, fleteMonto: e.fleteMonto,
    };
  });
  const costoMercaderia = items.reduce((s, x) => s + (x.subtotal || 0), 0);
  // Mismo criterio que armar(): un viaje por proveedor cuyo flete no viene incluido; si trae monto, ese es el cargo real.
  const viaje = new Map<string, number | null>();
  for (const x of items) if (x.incluyeFlete !== true) { const a = viaje.get(x.proveedor); if (a === undefined || (a == null && x.fleteMonto != null)) viaje.set(x.proveedor, x.fleteMonto); }
  const fleteSinConfirmar = [...viaje.values()].some(m => m == null);
  const costoLogistico = [...viaje.values()].reduce((s: number, m) => s + (m ?? 0), 0);
  const proveedores = [...new Set(items.map(x => x.proveedor))];
  const dias = items.reduce((m, x) => Math.max(m, x.plazoEntregaDias ?? 0), 0);
  const sinPlazo = proveedores.filter(pv => items.filter(x => x.proveedor === pv).every(x => x.plazoEntregaDias == null));
  const peor = items.reduce<CumpleItem>((w, x) => (tierCumple(x.cumple) > tierCumple(w) ? x.cumple : w), 'CUMPLE');

  const avisos: string[] = [];
  for (const x of items) if (tierCumple(x.cumple) > 0) avisos.push(`"${x.descripcion.slice(0, 40)}" con ${x.proveedor}: ${CUMPLE_TXT[x.cumple]}${x.detalleDesviacion ? ` — ${x.detalleDesviacion.slice(0, 160)}` : ''}.`);
  if (fleteSinConfirmar) avisos.push('Hay proveedores que necesitan viaje y nadie cargó cuánto cuesta: el flete cuenta como $0 sin confirmar.');
  if (sinPlazo.length) avisos.push(`Sin plazo de entrega declarado: ${sinPlazo.join(', ')} (los días de esta combinación pueden ser mayores).`);
  const ext = [...new Set(items.filter(x => x.moneda !== 'CLP').map(x => x.moneda))];
  if (ext.length) avisos.push(`Incluye precios en ${ext.join('/')} convertidos a pesos con el tipo de cambio de la cotización: es una importación (internación, flete y plazos aparte).`);
  if (proveedores.length > 1) avisos.push(`${proveedores.length} proveedores distintos: ${proveedores.length} compras y coordinaciones separadas.`);

  const clave = items.map(x => `${x.productoId}:${x.cotizacionId}`).join('|');
  return {
    clave, costoMercaderia, costoLogistico, costoTotal: costoMercaderia + costoLogistico, diasEstimados: dias || null, viajes: viaje.size,
    nProveedores: proveedores.length, proveedores, peorCumple: peor, fleteSinConfirmar, proveedoresSinPlazo: sinPlazo, items, etiquetas: [],
    diferenciaVsMasBarata: 0, diferenciaPctVsMasBarata: null, avisos,
    detalle: {
      clave, proveedoresInvolucrados: proveedores,
      porProducto: items.map(x => ({ productoId: x.productoId, descripcion: x.descripcion, proveedor: x.proveedor, precioUnitario: x.precioUnitario, cantidad: x.cantidad, subtotal: x.subtotal, plazoEntregaDias: x.plazoEntregaDias, incluyeFlete: x.incluyeFlete, fleteMonto: x.fleteMonto })),
    },
  };
}

/** Elige UNA combinación concreta (no solo uno de los 4 escenarios clásicos). Pide justificación salvo que
 *  coincida con "Más rápido". Se guarda como tipo COMBINACION con el mismo formato de detalle, así que
 *  aprobaciones, importación y reparto la leen igual que a cualquier escenario. */
export async function elegirCombinacion(
  negocioId: number, clave: string, justificacion: string | null, actorId: number, actorNombre: string | null,
): Promise<void> {
  const { combinaciones } = await enumerarCombinaciones(negocioId);
  const c = combinaciones.find(x => x.clave === clave);
  if (!c) throw new Error('Esa combinación ya no existe (cambiaron las cotizaciones). Recarga y vuelve a elegir.');
  if (!c.etiquetas.includes('MAS_RAPIDO') && !justificacion?.trim()) throw new Error('Elegir una combinación distinta de "Más rápido" requiere justificación (spec §8.10.4).');
  const ahora = ahoraChileSQL();
  await pool.query(`UPDATE compras_escenario SET elegido = 0 WHERE negocio_id = ?`, [negocioId]);
  await pool.query(
    `INSERT INTO compras_escenario (negocio_id, tipo, detalle_json, costo_total, dias_estimados, viajes_estimados, generado_at, elegido, elegido_justificacion, elegido_por, elegido_por_nombre, elegido_at)
     VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`,
    [negocioId, 'COMBINACION', JSON.stringify(c.detalle), c.costoTotal, c.diasEstimados, c.viajes, ahora, justificacion || null, actorId, actorNombre, ahora],
  );
  await invalidarAprobacionesCompras(negocioId, 'Se eligió una combinación de compra distinta.');
  await registrarEvento({
    tipo: 'COMPRAS_ESCENARIO_ELEGIDO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se eligió una combinación de compra con ${c.proveedores.join(' + ')} (${fmtMonto(c.costoTotal)})${justificacion ? `: ${justificacion}` : ''}.`,
    metadata: { negocio_id: negocioId, tipo: 'COMBINACION', clave, costoTotal: c.costoTotal },
  });
}

/** La clave de la combinación elegida hoy (null si lo elegido fue uno de los 4 escenarios clásicos o nada). */
export async function combinacionElegidaClave(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT tipo, detalle_json FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`, [negocioId]) as any;
  const r = (rows as any[])[0];
  if (!r || r.tipo !== 'COMBINACION') return null;
  try { return JSON.parse(r.detalle_json)?.clave ?? null; } catch { return null; }
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
 *  correcta. Devuelve también el costo GUARDADO en ese momento (no el recalculado ahora): sin esto,
 *  la pantalla solo comparaba por `tipo` — si después se registra una cotización nueva y
 *  `calcularEscenarios` recalcula un total DISTINTO para ese mismo tipo, la tarjeta seguía
 *  mostrando "Elegido" sobre el número nuevo aunque nadie hubiera vuelto a confirmar ese monto (bug
 *  real, 11-sep-2026: "Mínimo precio" pasó de $34.662.844 a $20.529.164 al agregar una cotización
 *  de Tecnomaq, y el badge "Elegido" se quedó pegado al tipo sin avisar que el monto ya no era el
 *  guardado). El llamador compara este costo contra el recalculado para saber si sigue vigente. */
export async function escenarioElegidoTipo(negocioId: number): Promise<{ tipo: TipoEscenario; costoTotal: number } | null> {
  const [rows] = await pool.query(
    `SELECT tipo, costo_total FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  return r ? { tipo: r.tipo, costoTotal: Number(r.costo_total) } : null;
}
