// app/lib/compras-oc-obuma.ts
// ÓRDENES DE COMPRA REALES CONTRA OBUMA (spec §11.1). Hasta el 10-sep-2026 "Orden de compra
// emitida" era un checkbox marcado a mano — el §11.1 dice "el módulo controla y registra el
// estado, no los ejecuta", pero soporte de Obuma confirmó por correo que /comprasOc.create.json
// SÍ permite crear la OC de verdad desde la API. Esto la ejecuta.
//
// UNA OC POR PROVEEDOR (pedido explícito del usuario): el escenario elegido (compras-auditor.ts)
// ya sabe qué proveedor quedó asignado a cada producto — acá se agrupa por proveedor y se arma una
// orden de compra separada para cada uno, nunca mezclando ítems de proveedores distintos.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { obtenerAprobaciones, obtenerEscenarioElegido } from '@/app/lib/compras-aprobaciones';
import { marcarHitoReparto, obtenerReparto } from '@/app/lib/compras-reparto';
import {
  crearOrdenCompraObuma, listarFormasPago, proveedorPorRut, crearProveedorObuma, buscarCentroCostoPorLicitacion,
  listarComprasOc, listarComprasOcItems, mapaFormasPagoCompleto, type ObumaFormaPago, type DatosCrearProveedorObuma,
} from '@/app/lib/obuma';
import { comprasObumaDeLicitacion } from '@/app/lib/obuma-compras';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export interface ItemOrdenCompra {
  productoId: number; descripcion: string; cantidad: number; precioUnitario: number; subtotal: number;
  obumaProductoId: string | null; obumaCodigoComercial: string | null;
}
export interface ProveedorOrdenCompra {
  proveedorNombre: string; proveedorId: number | null; proveedorRut: string | null;
  proveedorDireccion: string | null; proveedorComuna: string | null; proveedorEmail: string | null; proveedorTelefono: string | null;
  proveedorGiro: string | null; proveedorContacto: string | null;
  items: ItemOrdenCompra[]; subtotal: number;
  yaCreada: { obumaCompraOcId: string; folio: string | null; total: number; fechaOc: string } | null;
  // Pedido explícito del usuario (14-sep-2026, caso real: el encargado de compras ya había creado
  // la OC directo en Obuma — "yaCreada" (arriba) no lo veía porque solo mira lo que creó Licitank).
  // Esto busca en las OC REALES de Obuma para este proveedor, no solo en nuestra tabla local.
  posibleDuplicadoObuma: { folio: string | null; referencia: string; fecha: string; total: number } | null;
}

/** Busca si YA existe una OC real en Obuma para este proveedor que mencione alguno de los productos
 *  que estamos por comprar — mismo criterio que `sugerirProveedoresPorDescripcion`
 *  (compras-proveedores.ts): palabras clave de 4+ letras contra el texto de referencia/observación
 *  de la OC, barato (una sola llamada a `comprasOc.list.json`, sin tocar el endpoint de ítems que
 *  tiene cuota diaria agotable). Es un AVISO, no un bloqueo — la spec ya usa ese criterio en todo
 *  el módulo (margen bajo, presupuesto excedido): mejor avisar y dejar decidir que bloquear de
 *  plano cuando la coincidencia podría ser casualidad. */
async function buscarOcRealSimilar(
  proveedorObumaId: string, descripciones: string[],
): Promise<{ folio: string | null; referencia: string; fecha: string; total: number } | null> {
  const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const palabrasClave = descripciones
    .flatMap(d => normalizar(d).split(/[^A-Z0-9]+/).filter(w => w.length >= 4))
    .slice(0, 15);
  if (palabrasClave.length === 0) return null;

  const r = await listarComprasOc({ proveedor: proveedorObumaId, limit: 20 }).catch(() => null);
  for (const oc of r?.data || []) {
    const texto = normalizar(`${oc.compra_oc_referencia || ''} ${oc.compra_oc_observacion || ''}`);
    if (palabrasClave.some(p => texto.includes(p))) {
      return {
        folio: oc.compra_oc_folio ? String(oc.compra_oc_folio) : null,
        referencia: String(oc.compra_oc_referencia || ''),
        fecha: String(oc.compra_oc_fecha_ingreso || ''),
        total: Number(oc.compra_oc_total) || 0,
      };
    }
  }
  return null;
}

/** Del escenario ELEGIDO (no cualquiera — el que de verdad se va a comprar), agrupa por proveedor.
 *  Cruza cada ítem con su SKU (si ya está homologado con Obuma, la OC queda enlazada al mismo
 *  producto del catálogo — spec §7, no a un texto suelto) y con el catálogo de proveedores (para
 *  la ficha: RUT, dirección, contacto) usando el mismo proveedor_id que ya quedó guardado en la
 *  cotización que ganó ese ítem — no se adivina por nombre. */
export async function proveedoresParaOrdenCompra(negocioId: number): Promise<ProveedorOrdenCompra[]> {
  const escenario = await obtenerEscenarioElegido(negocioId);
  if (!escenario) return [];
  let detalle: any = null;
  try { detalle = typeof escenario.detalle_json === 'string' ? JSON.parse(escenario.detalle_json) : escenario.detalle_json; } catch { /* detalle inválido, se trata como vacío */ }
  const porProducto: Array<{ productoId: number; descripcion: string; proveedor: string | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null }> = detalle?.porProducto || [];
  const cubiertos = porProducto.filter(p => p.proveedor && p.precioUnitario != null);
  if (cubiertos.length === 0) return [];

  const productoIds = cubiertos.map(p => p.productoId);
  const [skuRows] = await pool.query(
    `SELECT producto_id, obuma_producto_id, obuma_codigo_comercial FROM compras_sku
      WHERE negocio_id = ? AND producto_id IN (${productoIds.map(() => '?').join(',')})`,
    [negocioId, ...productoIds],
  ) as any;
  const skuPorProducto = new Map<number, { obumaProductoId: string | null; obumaCodigoComercial: string | null }>(
    (skuRows as any[]).map(r => [r.producto_id, { obumaProductoId: r.obuma_producto_id, obumaCodigoComercial: r.obuma_codigo_comercial }]),
  );

  // proveedor_id/rut reales: los que YA quedaron guardados en la cotización que ganó — es la fuente
  // de verdad de a quién se le está comprando, no un texto libre que puede escribirse distinto.
  const [cotRows] = await pool.query(
    `SELECT proveedor_nombre, proveedor_id, proveedor_rut FROM compras_cotizacion WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const fichaPorNombre = new Map<string, { proveedorId: number | null; rut: string | null }>();
  for (const c of cotRows as any[]) fichaPorNombre.set(c.proveedor_nombre, { proveedorId: c.proveedor_id, rut: c.proveedor_rut });

  const idsProveedor = [...new Set([...fichaPorNombre.values()].map(f => f.proveedorId).filter((v): v is number => v != null))];
  const fichaCompleta = new Map<number, { direccion: string | null; comuna: string | null; email: string | null; telefono: string | null; giro: string | null; contacto: string | null; obumaProveedorId: string | null }>();
  if (idsProveedor.length) {
    const [provRows] = await pool.query(
      `SELECT id, direccion, comuna, correo, telefono, giro, contacto_nombre, obuma_proveedor_id FROM compras_proveedor WHERE id IN (${idsProveedor.map(() => '?').join(',')})`,
      idsProveedor,
    ) as any;
    for (const p of provRows as any[]) fichaCompleta.set(p.id, { direccion: p.direccion, comuna: p.comuna, email: p.correo, telefono: p.telefono, giro: p.giro, contacto: p.contacto_nombre, obumaProveedorId: p.obuma_proveedor_id });
  }

  const [ocRows] = await pool.query(
    `SELECT proveedor_nombre, obuma_compra_oc_id, obuma_folio, total_neto, DATE_FORMAT(fecha_oc, '%Y-%m-%d') AS fecha_oc
       FROM compras_orden_compra_obuma WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const ocPorProveedor = new Map<string, { obumaCompraOcId: string; folio: string | null; total: number; fechaOc: string }>(
    (ocRows as any[]).map(r => [r.proveedor_nombre, { obumaCompraOcId: r.obuma_compra_oc_id, folio: r.obuma_folio, total: Number(r.total_neto), fechaOc: r.fecha_oc }]),
  );

  const grupos = new Map<string, ProveedorOrdenCompra>();
  for (const p of cubiertos) {
    const nombre = p.proveedor as string;
    const ficha = fichaPorNombre.get(nombre) || { proveedorId: null, rut: null };
    const extra = ficha.proveedorId != null ? fichaCompleta.get(ficha.proveedorId) : undefined;
    const sku = skuPorProducto.get(p.productoId);
    if (!grupos.has(nombre)) {
      grupos.set(nombre, {
        proveedorNombre: nombre, proveedorId: ficha.proveedorId, proveedorRut: ficha.rut,
        proveedorDireccion: extra?.direccion ?? null, proveedorComuna: extra?.comuna ?? null,
        proveedorEmail: extra?.email ?? null, proveedorTelefono: extra?.telefono ?? null,
        proveedorGiro: extra?.giro ?? null, proveedorContacto: extra?.contacto ?? null,
        items: [], subtotal: 0, yaCreada: ocPorProveedor.get(nombre) ?? null, posibleDuplicadoObuma: null,
      });
    }
    const grupo = grupos.get(nombre)!;
    const subtotal = p.subtotal ?? 0;
    grupo.items.push({
      productoId: p.productoId, descripcion: p.descripcion, cantidad: p.cantidad ?? 1,
      precioUnitario: p.precioUnitario as number, subtotal,
      obumaProductoId: sku?.obumaProductoId ?? null, obumaCodigoComercial: sku?.obumaCodigoComercial ?? null,
    });
    grupo.subtotal += subtotal;
  }

  // Chequeo anti-duplicado (pedido explícito, 14-sep-2026: caso real donde el encargado ya había
  // creado la OC directo en Obuma y Licitank no se enteró) — solo para grupos que todavía no tienen
  // una OC nuestra Y tienen un proveedor identificado en Obuma; si ya está `yaCreada` no hace falta
  // ni preguntar. En paralelo, son solo llamadas de lectura baratas (comprasOc.list.json).
  await Promise.all([...grupos.values()].filter(g => !g.yaCreada && g.proveedorId != null).map(async g => {
    const obumaProveedorId = g.proveedorId != null ? fichaCompleta.get(g.proveedorId)?.obumaProveedorId : null;
    if (!obumaProveedorId) return;
    g.posibleDuplicadoObuma = await buscarOcRealSimilar(obumaProveedorId, g.items.map(it => it.descripcion)).catch(() => null);
  }));

  return [...grupos.values()];
}

export async function formasDePagoObuma(): Promise<ObumaFormaPago[]> {
  return listarFormasPago();
}

export interface FichaProveedorObuma {
  proveedorId: string; rut: string; razonSocial: string; direccion: string | null; comuna: string | null;
  telefono: string | null; email: string | null; giro: string | null; contacto: string | null;
}

/** Pedido explícito del usuario: la creación del proveedor en Obuma NUNCA es automática — se
 *  verifica por RUT, y si no existe, la UI ofrece un botón que abre un formulario con TODOS los
 *  campos reales de Obuma para que la persona decida qué llenar y lo cree a mano (ver
 *  crearProveedorEnObumaExplicito). Esto solo verifica, nunca escribe. */
export async function verificarProveedorEnObuma(rut: string): Promise<FichaProveedorObuma | null> {
  const p = await proveedorPorRut(rut);
  if (!p) return null;
  return {
    proveedorId: p.proveedor_id, rut, razonSocial: p.proveedor_razon_social,
    direccion: p.proveedor_direccion || null, comuna: p.proveedor_comuna || null,
    telefono: (p.proveedor_telefono as string) || null, email: (p.proveedor_email as string) || null,
    giro: p.proveedor_giro_comercial || null, contacto: p.proveedor_contacto || null,
  };
}

/** Crea el proveedor en Obuma — escritura real, disparada SOLO por una acción explícita de la
 *  persona en el modal (nunca desde `crearOrdenCompraParaProveedor`). */
export async function crearProveedorEnObumaExplicito(datos: DatosCrearProveedorObuma): Promise<{ proveedorId: string }> {
  return crearProveedorObuma(datos);
}

/** Crea la OC de verdad en Obuma para UN proveedor del escenario elegido (spec §11.1, escritura
 *  real — nunca se llama sin que un humano lo haya pedido explícitamente). Se habilita con el
 *  mismo criterio que el SKU: recién con la Compuerta 1 (compra) aprobada, porque antes de eso no
 *  hay compra real que emitir. */
export async function crearOrdenCompraParaProveedor(
  negocioId: number, proveedorNombre: string,
  opciones: { formaPagoId: string; incluirFlete: boolean; fleteMonto: number | null; confirmarPeseADuplicado?: boolean },
  actorId: number, actorNombre: string | null,
): Promise<{ obumaCompraOcId: string; folio: string | null; total: number }> {
  // Control de gasto (pedido explícito del usuario): dinero de verdad sale recién cuando se crea la
  // OC en Obuma, así que ese es el punto de mayor riesgo — se exigen AMBAS compuertas aprobadas, no
  // solo la de compra. La spec (§11.1) solo pide la Compuerta 1 para arrancar "el proceso documental
  // posterior"; esto es un guardarraíl adicional, no una regla que la contradiga.
  const { compra, margen } = await obtenerAprobaciones(negocioId);
  if (!compra || !['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(compra.estado)) {
    throw new Error('La orden de compra se emite después de aprobada la Compuerta 1 (Aprobación de compra) — spec §11.1.');
  }
  if (!margen || !['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(margen.estado)) {
    throw new Error('Falta aprobar la Compuerta 2 (Aprobación de margen) — control de gasto: no se emite dinero real sin las dos compuertas.');
  }

  const grupos = await proveedoresParaOrdenCompra(negocioId);
  const grupo = grupos.find(g => g.proveedorNombre === proveedorNombre);
  if (!grupo) throw new Error('Ese proveedor no tiene ítems en el escenario elegido.');
  if (grupo.yaCreada) throw new Error(`Ya existe una orden de compra para este proveedor en Obuma (folio ${grupo.yaCreada.folio ?? grupo.yaCreada.obumaCompraOcId}).`);
  // Segundo freno (no solo el aviso en pantalla): caso real, 14-sep-2026 — el encargado de compras
  // ya había creado esta misma OC directo en Obuma, y Licitank no se enteraba porque solo miraba su
  // propia tabla. Mismo criterio "avisa, exige confirmación explícita" que el presupuesto/margen —
  // no bloquea de plano por si la coincidencia de palabras es casualidad, pero nunca deja pasar en
  // silencio sin que alguien confirme a propósito.
  if (grupo.posibleDuplicadoObuma && !opciones.confirmarPeseADuplicado) {
    throw new Error(
      `Ya existe una OC real en Obuma para este proveedor que menciona algo parecido: `
      + `"${grupo.posibleDuplicadoObuma.referencia}" (folio ${grupo.posibleDuplicadoObuma.folio ?? '—'}, ${grupo.posibleDuplicadoObuma.fecha.slice(0, 10)}, `
      + `${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(grupo.posibleDuplicadoObuma.total)}). `
      + `Revísala antes de crear otra — si de verdad es una compra distinta, confirma para continuar igual.`,
    );
  }
  if (opciones.incluirFlete && !(opciones.fleteMonto! > 0)) throw new Error('Falta el monto del flete.');

  const licitacionCodigo = await licitacionDeNegocio(negocioId);
  const fecha = ahoraChileSQL().slice(0, 10);

  // El proveedor tiene que YA estar registrado en Obuma antes de emitir la OC — pedido explícito:
  // la creación del proveedor NUNCA es automática, la persona la hace a mano desde el modal (ver
  // verificarProveedorEnObuma/crearProveedorEnObumaExplicito). Acá solo se comprueba, no se crea.
  if (!grupo.proveedorRut?.trim()) throw new Error('Este proveedor no tiene RUT registrado — complétalo en Proveedores antes de emitir la orden de compra.');
  const ficha = await verificarProveedorEnObuma(grupo.proveedorRut);
  if (!ficha) throw new Error('Este proveedor todavía no está creado en Obuma — créalo primero con el botón "Crear proveedor en Obuma".');

  // Centro de costo real, si esta licitación ya tiene un Proyecto armado en Obuma (ver
  // buscarCentroCostoPorLicitacion) — si no lo tiene, se omite del payload sin bloquear la OC.
  const centroCosto = licitacionCodigo ? await buscarCentroCostoPorLicitacion(licitacionCodigo).catch(() => null) : null;

  const creada = await crearOrdenCompraObuma({
    proveedorRut: ficha.rut || null, proveedorRazonSocial: ficha.razonSocial,
    proveedorDireccion: ficha.direccion, proveedorComuna: ficha.comuna,
    proveedorEmail: ficha.email, proveedorTelefono: ficha.telefono,
    fecha, formaPagoId: opciones.formaPagoId,
    referencia: licitacionCodigo || `negocio-${negocioId}`,
    concepto: `Compra para licitación ${licitacionCodigo || negocioId}`,
    centroCostoId: centroCosto?.id ?? null,
    items: grupo.items.map(it => ({
      productoIdObuma: it.obumaProductoId, codigoComercial: it.obumaCodigoComercial,
      nombre: it.descripcion, cantidad: it.cantidad, precioUnitarioNeto: it.precioUnitario,
    })),
    fleteMonto: opciones.incluirFlete ? opciones.fleteMonto : null,
  });

  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO compras_orden_compra_obuma
       (negocio_id, proveedor_id, proveedor_nombre, proveedor_rut, obuma_compra_oc_id, obuma_folio, items_json,
        incluye_flete, flete_monto, subtotal_neto, total_neto, forma_pago_codigo, forma_pago_nombre, fecha_oc,
        creado_por, creado_por_nombre, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      negocioId, grupo.proveedorId, grupo.proveedorNombre, grupo.proveedorRut,
      creada.compraOcId, creada.folio, JSON.stringify(grupo.items),
      opciones.incluirFlete ? 1 : 0, opciones.incluirFlete ? opciones.fleteMonto : null,
      creada.subtotalNeto, creada.total, opciones.formaPagoId, null, fecha,
      actorId, actorNombre, ahora,
    ],
  );

  await registrarEvento({
    tipo: 'COMPRAS_OC_OBUMA_CREADA', licitacionCodigo, actorId, actorNombre,
    mensaje: `Se creó la orden de compra en Obuma para "${grupo.proveedorNombre}" — folio ${creada.folio ?? creada.compraOcId}, ${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(creada.total)}.`,
    metadata: { negocio_id: negocioId, proveedor: grupo.proveedorNombre, obuma_compra_oc_id: creada.compraOcId },
  });

  // Refleja el hito del checklist (§11) con TODOS los folios emitidos hasta ahora para este
  // negocio — puede haber más de una OC (una por proveedor), el checklist muestra el resumen.
  const [todas] = await pool.query(
    `SELECT COALESCE(obuma_folio, obuma_compra_oc_id) AS ref FROM compras_orden_compra_obuma WHERE negocio_id = ? ORDER BY created_at`,
    [negocioId],
  ) as any;
  const resumenFolios = (todas as any[]).map(r => r.ref).join(', ');
  await marcarHitoReparto(negocioId, 'ocEmitida', { activo: true, ocNumero: resumenFolios }, actorId, actorNombre);

  return { obumaCompraOcId: creada.compraOcId, folio: creada.folio, total: creada.total };
}

export interface ItemOrdenCompraVista {
  descripcion: string; cantidad: number; precioUnitario: number; subtotal: number;
}
export interface OrdenCompraVista {
  origen: 'LICITANK' | 'OBUMA_MANUAL';
  folio: string | null; obumaCompraOcId: string | null;
  proveedorNombre: string; proveedorRut: string | null;
  proveedorDireccion: string | null; proveedorComuna: string | null;
  proveedorGiro: string | null; proveedorContacto: string | null;
  proveedorEmail: string | null; proveedorTelefono: string | null;
  fecha: string | null; centroCosto: string | null; formaPago: string | null;
  items: ItemOrdenCompraVista[];
  subtotal: number; flete: number; total: number;
  error?: string; // solo para OBUMA_MANUAL cuando no se pudo traer en vivo
}

/** Pedido explícito del usuario (14-sep-2026: "podemos rescatar el documento de obuma para poder
 *  ver la OC"). Obuma NO confirma tener un endpoint de descarga del PDF (ver nota al inicio del
 *  archivo obuma.ts sobre el falso-positivo de las rutas .pdf/.print) — esto arma una VISTA propia
 *  de Licitank con los mismos datos que trae la OC real (confirmado contra un PDF real de Obuma
 *  que el usuario adjuntó: proveedor, ítems, cantidades, precios, descuento, subtotal/neto/IVA/
 *  total, centro de costo, forma de pago), no una réplica exacta del documento oficial.
 *
 *  Dos fuentes, según quién creó la OC:
 *   - LICITANK: ya tenemos todo guardado en compras_orden_compra_obuma (items_json) — no hace
 *     falta pegarle a Obuma de nuevo, es instantáneo y no gasta cuota.
 *   - OBUMA_MANUAL: el encargado la creó directo en Obuma y solo quedó el folio tipeado en el
 *     campo "N° de OC" del checklist (reparto.ocNumero, puede traer varios separados por coma) —
 *     se busca en vivo por folio (comprasOc.list + comprasOc.listItems, con cuota diaria). */
export async function ordenesCompraParaVista(negocioId: number): Promise<OrdenCompraVista[]> {
  const [ocRows] = await pool.query(
    `SELECT proveedor_nombre, proveedor_rut, obuma_compra_oc_id, obuma_folio, items_json,
            flete_monto, subtotal_neto, total_neto, forma_pago_codigo, DATE_FORMAT(fecha_oc, '%Y-%m-%d') AS fecha_oc
       FROM compras_orden_compra_obuma WHERE negocio_id = ? ORDER BY created_at`,
    [negocioId],
  ) as any;
  const filas = ocRows as any[];

  const [formasPago, centroCosto] = await Promise.all([
    mapaFormasPagoCompleto().catch(() => new Map<string, string>()),
    licitacionDeNegocio(negocioId).then(cod => cod ? buscarCentroCostoPorLicitacion(cod).catch(() => null) : null),
  ]);

  const vistas: OrdenCompraVista[] = filas.map(r => {
    let items: ItemOrdenCompraVista[] = [];
    try { items = (JSON.parse(r.items_json) as any[]).map(it => ({ descripcion: it.descripcion, cantidad: it.cantidad, precioUnitario: it.precioUnitario, subtotal: it.subtotal })); } catch { /* items_json corrupto — se muestra vacío antes que inventar */ }
    return {
      origen: 'LICITANK', folio: r.obuma_folio, obumaCompraOcId: r.obuma_compra_oc_id,
      proveedorNombre: r.proveedor_nombre, proveedorRut: r.proveedor_rut,
      proveedorDireccion: null, proveedorComuna: null, proveedorGiro: null, proveedorContacto: null,
      proveedorEmail: null, proveedorTelefono: null,
      fecha: r.fecha_oc, centroCosto: centroCosto?.nombre ?? null,
      formaPago: formasPago.get(String(r.forma_pago_codigo)) ?? null,
      items, subtotal: Number(r.subtotal_neto), flete: Number(r.flete_monto) || 0, total: Number(r.total_neto),
    };
  });

  // Folios que YA quedaron cubiertos por una OC creada desde Licitank — no repetir la búsqueda en
  // vivo para ellos aunque el texto de ocNumero los mencione también.
  const foliosLicitank = new Set(vistas.map(v => v.folio).filter((f): f is string => !!f));

  const reparto = await obtenerReparto(negocioId);
  const foliosManual = (reparto.ocNumero || '')
    .split(/[,;\s]+/).map(f => f.trim()).filter(f => f && !foliosLicitank.has(f));

  for (const folio of foliosManual) {
    try {
      const header = await listarComprasOc({ folio_dcto: folio, limit: 1 });
      const oc = header.data?.[0];
      if (!oc) { vistas.push(vistaManualError(folio, 'No se encontró esa OC en Obuma.')); continue; }
      const itemsR = await listarComprasOcItems({ folio_dcto: folio, limit: 200 });
      const items: ItemOrdenCompraVista[] = (itemsR.data || []).map(it => ({
        descripcion: String(it.producto_nombre), cantidad: Number(it.cantidad), precioUnitario: Number(it.precio), subtotal: Number(it.subtotal),
      }));
      vistas.push({
        origen: 'OBUMA_MANUAL', folio: String(oc.compra_oc_folio || folio), obumaCompraOcId: String(oc.compra_oc_id),
        proveedorNombre: String(oc.compra_oc_referencia || ''), proveedorRut: null,
        proveedorDireccion: null, proveedorComuna: null, proveedorGiro: null, proveedorContacto: null,
        proveedorEmail: null, proveedorTelefono: null,
        fecha: String(oc.compra_oc_fecha_ingreso || '').slice(0, 10) || null,
        centroCosto: String(oc.compra_oc_centro_costo || '') || null, formaPago: null,
        items, subtotal: items.reduce((s, it) => s + it.subtotal, 0), flete: 0, total: Number(oc.compra_oc_total) || 0,
      });
    } catch (e: any) {
      // Cuota diaria de comprasOc.listItems agotable (verificado en vivo) — se avisa en vez de
      // reventar toda la vista por un solo folio.
      vistas.push(vistaManualError(folio, e?.message?.includes('limite de consultas diario') ? 'Cuota diaria de Obuma agotada para hoy — intenta de nuevo mañana.' : 'No se pudo consultar esta OC en Obuma en este momento.'));
    }
  }

  return vistas;
}

function vistaManualError(folio: string, error: string): OrdenCompraVista {
  return {
    origen: 'OBUMA_MANUAL', folio, obumaCompraOcId: null,
    proveedorNombre: '', proveedorRut: null, proveedorDireccion: null, proveedorComuna: null,
    proveedorGiro: null, proveedorContacto: null, proveedorEmail: null, proveedorTelefono: null,
    fecha: null, centroCosto: null, formaPago: null, items: [], subtotal: 0, flete: 0, total: 0, error,
  };
}

// ── Resumen final del módulo de Compras (pedido explícito del usuario, 22-sep-2026): "no tenemos
// un resumen de cuánto gastamos, las OC creadas y las facturas realizadas" — hasta hoy ese número
// solo se veía en la ficha de la licitación (bloque "Compras (Obuma)", ComprasObumaBloque.tsx), no
// dentro del propio módulo de Compras. Junta DOS fuentes que ya existían pero nunca se habían
// combinado en una sola pantalla:
//   1. compras_orden_compra_obuma — las OC que EMITIMOS nosotros desde Licitank (migración 106).
//   2. obuma_compras — todo lo que el cron cruzó por referencia (incluye compras hechas directo en
//      Obuma sin pasar por acá, y las facturas reales con su XML — migración 66/67).
// Ambas fuentes son lectura de BASE, no llaman a Obuma en vivo — mismo criterio que el resto de la
// pantalla de Compras (la consulta en vivo del Proyecto completo sigue siendo un botón aparte, ver
// gastosDelProyectoPorLicitacion en obuma.ts).
export interface ResumenGastosCompra {
  ocCreadas: { cantidad: number; totalNeto: number; proveedores: { nombre: string; folio: string | null; total: number; fecha: string }[] };
  comprasCruzadas: { cantidad: number; total: number };
  facturas: { cantidad: number; total: number };
  montoCosteado: number | null;
  variacionPct: number | null; // (gastado real - costeado) / costeado, positivo = gastamos más de lo presupuestado
}

export async function resumenGastosCompra(negocioId: number, montoCosteado: number | null): Promise<ResumenGastosCompra> {
  const [ocRows] = await pool.query(
    `SELECT proveedor_nombre, obuma_folio, total_neto, DATE_FORMAT(fecha_oc, '%Y-%m-%d') AS fecha_oc
       FROM compras_orden_compra_obuma WHERE negocio_id = ? ORDER BY created_at`,
    [negocioId],
  ) as any;
  const ocCreadas = (ocRows as any[]).map(r => ({ nombre: r.proveedor_nombre, folio: r.obuma_folio, total: Number(r.total_neto), fecha: r.fecha_oc }));
  const totalOcCreadas = ocCreadas.reduce((s, o) => s + o.total, 0);

  const codigo = await licitacionDeNegocio(negocioId);
  const cruzadas = codigo ? await comprasObumaDeLicitacion(codigo) : [];
  const totalCruzadas = cruzadas.reduce((s, c) => s + (c.total || 0), 0);
  const facturas = cruzadas.flatMap(c => c.facturas);
  const totalFacturas = facturas.reduce((s, f) => s + (f.total || 0), 0);

  const gastadoReal = totalOcCreadas || totalCruzadas || null;
  const variacionPct = montoCosteado && montoCosteado > 0 && gastadoReal != null
    ? Math.round(((gastadoReal - montoCosteado) / montoCosteado) * 1000) / 10
    : null;

  return {
    ocCreadas: { cantidad: ocCreadas.length, totalNeto: totalOcCreadas, proveedores: ocCreadas },
    comprasCruzadas: { cantidad: cruzadas.length, total: totalCruzadas },
    facturas: { cantidad: facturas.length, total: totalFacturas },
    montoCosteado, variacionPct,
  };
}
