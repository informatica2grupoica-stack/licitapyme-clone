// app/api/negocios/[id]/comercial/costeo/route.ts
// MOTOR COMERCIAL (Auditor Técnico, Fase 4, spec §7) — ingesta del costeo real subido por el
// asistente. El archivo ya se subió a R2 vía /api/documentos/subir (mismo flujo que "Subir
// ficha técnica" en el Agente Técnico); acá solo se recibe la URL, se descarga, se parsea y se
// calculan las 4 alertas obligatorias (§7.4).
//
//   GET    → versión vigente + últimas versiones (historial, spec §7.6)
//   POST   { url, nombre } → parsea, calcula alertas, guarda nueva versión (baja la anterior)
//   DELETE { id } → borra una versión puntual (ej. la subió por error). Si era la vigente, la
//            siguiente más reciente que quede pasa a vigente sola — nunca deja "sin costeo" si
//            todavía hay versiones. No toca los precios ya cargados en el checklist: esos
//            quedan como están, el borrado es solo del registro/evidencia del costeo.
//
// Sincronización con el checklist (spec §7.5, ampliada 03-sep-2026): cada ítem 'precio' del bloque
// COMERCIAL se mantiene igual al total del costeo en CADA guardado, no solo la primera vez — el
// costeo SIEMPRE tiene prioridad (pedido del usuario: "que sea manual y automático pero siempre
// prioridad al automático"). Un precio cargado a mano es válido mientras tanto (para el flujo
// asistente→asesor), pero no está protegido: el siguiente guardado del costeo lo pisa igual. El
// ÚNICO freno real es aprobar el punto — ahí sí queda fijo hasta que el asesor lo reabra, que es
// la decisión que la alerta de discordancia existe para avisar.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { esPorLinea, lineasDelInforme } from '@/app/lib/checklist-comercial';
import { IVA } from '@/app/lib/costeo-comparativo';
import { parsearCosteo, calcularAlertasMotorComercial, totalesDeCosteo, totalPrecioDeLinea, presupuestoDeLaOferta, type AlertaMotorComercial } from '@/app/lib/motor-comercial';
import { cargarNegocio, leerInforme, leerItems, nombreDe, asesores } from '../route';
import { yaCongelado } from '@/app/lib/congelamiento';
import { lineasExcluidasDeNegocio } from '@/app/lib/lineas-oferta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function totalAnexoEconomico(negocioId: number): Promise<number | null> {
  const [rows] = await pool.query(
    `SELECT valor_numero FROM checklist_comercial
      WHERE negocio_id = ? AND bloque = 'COMERCIAL' AND tipo = 'precio' AND (ofertamos IS NULL OR ofertamos = 1)`,
    [negocioId],
  ) as any;
  const vals = (rows as any[]).map(r => r.valor_numero).filter((v: any) => v != null);
  if (!vals.length) return null;
  return vals.reduce((s: number, v: any) => s + Number(v), 0);
}

// ═══ GET ══════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const [rows] = await pool.query(
      `SELECT id, version, vigente, archivo_url, archivo_nombre, origen, total_costo_neto, total_precio_neto,
              presupuesto_publicado, total_anexo_economico, alertas, subido_por_nombre, subido_at
         FROM checklist_comercial_costeo WHERE negocio_id = ? ORDER BY version DESC LIMIT 15`,
      [negocio.id],
    ) as any;
    const historial = (rows as any[]).map(r => ({
      ...r, vigente: !!r.vigente,
      alertas: typeof r.alertas === 'string' ? JSON.parse(r.alertas) : (r.alertas || []),
    }));

    return NextResponse.json({ success: true, vigente: historial.find(h => h.vigente) || null, historial });
  } catch (error) {
    console.error('[comercial/costeo][GET]', String(error));
    // Tabla puede no existir todavía (migración 53 pendiente) — no romper la pestaña por eso.
    return NextResponse.json({ success: true, vigente: null, historial: [], migracionPendiente: true });
  }
}

// ── Ingesta de una nueva versión del costeo — común a las dos fuentes posibles ────────────────
// (1) el Excel que sube el asistente (POST de acá abajo, parseado con parsearCosteo), y
// (2) el editor integrado (app/api/negocios/[id]/comercial/costeo-editor/route.ts), cuyas filas ya
// vienen en la MISMA forma FilaCosteo (ver app/lib/costeo-editor.ts:editorAFilasCosteo). Ninguna
// de las dos rutas duplica alertas, versionado ni auto-precarga: ambas terminan acá.
export interface OpcionesIngestaCosteo {
  origen: 'archivo' | 'editor';
  archivoUrl: string | null;
  archivoNombre: string;
  userId: number;
  nombreActor: string;
}

export async function ingresarVersionCosteo(
  negocio: { id: number; licitacion_codigo: string; licitacion_nombre: string },
  filas: Awaited<ReturnType<typeof parsearCosteo>>,
  opts: OpcionesIngestaCosteo,
) {
  const { userId, nombreActor } = opts;
  const informe = await leerInforme(negocio.licitacion_codigo);
  // EL TOPE POR LÍNEA VIENE CON IVA y se compara contra un costeo NETO (03-sep-2026). El manifiesto
  // guarda `presupuesto_linea` tal como lo publican las bases —"viene IVA incluido en ambos
  // formatos soportados", ver el backfill de presupuesto en viabilidad-ia.ts— mientras que
  // calcularAlertasMotorComercial suma `precioTotalNeto`. Comparar neto contra bruto deja el tope
  // 19% más alto del que existe, así que la alerta SOBRE_PRESUPUESTO_LINEA se quedaba muda en todo
  // sobrecosto de hasta 19%. Caso real 1271359-92-LE26 línea 2: costeo $19.556.323 neto contra un
  // tope publicado de $21.478.000 → parecía holgado, pero el tope real es $18.048.739 neto y la
  // oferta iba 8,4% POR ENCIMA (es exactamente lo que el comercial calcula a mano en su Excel,
  // celda K14 = F15/1,19). Se normaliza acá, en el borde: el motor sigue comparando neto con neto
  // sin tener que saber de IVA. `presupuestoDeLineaEsUnitario` no se ve afectado — ya prueba contra
  // el global y contra el global × 1,19.
  const lineaConIva = informe?.presupuesto?.con_iva !== false;
  // Crudas = tal como las publica el informe (topes CON IVA). Las necesita presupuestoDeLaOferta,
  // que hace su propia normalización y además prueba el guardarraíl del "unitario" contra el
  // monto crudo — pasarle las ya divididas restaría el IVA dos veces.
  const lineasPublicadasCrudas = informe ? lineasDelInforme(informe) : [];
  const lineasPublicadas = lineasPublicadasCrudas.map(l => ({
    ...l,
    presupuestoLinea: l.presupuestoLinea != null && lineaConIva ? l.presupuestoLinea / IVA : l.presupuestoLinea,
  }));
  const { totalCostoNeto, totalPrecioNeto } = totalesDeCosteo(filas);

  // Se necesita ANTES de calcular alertas (no solo para la auto-precarga de más abajo): una
  // línea que no ofertamos no debe contar ni para el total ni para "sobre presupuesto", aunque
  // el costeo la traiga cotizada. Antes esto miraba SOLO las filas del checklist marcadas
  // "no ofertamos"; ahora la fuente principal es el selector de líneas (migración 78), porque
  // una línea descartada ahí ya ni siquiera genera fila de precio que mirar.
  const items = await leerItems(negocio.id);
  const lineasExcluidas = await lineasExcluidasDeNegocio(negocio.id, lineasPublicadas.map(l => l.linea));

  // EL PRESUPUESTO ES EL DE LO QUE OFERTAMOS, no el de la licitación entera — ver
  // presupuestoDeLaOferta(). Con una sola de dos canastas en juego, el global no es un tope:
  // es la suma de dos topes distintos, y comparar contra él regala holgura que no existe.
  const presupuestoPublicado = presupuestoDeLaOferta(informe, lineasPublicadasCrudas, lineasExcluidas);

  const ahora = ahoraChileSQL();

  // ── SINCRONIZAR el checklist con el costeo ANTES de calcular alertas (03-sep-2026) ──────────
  // Antes esto corría DESPUÉS de calcular alertas y guardar la versión, y encima solo sobre
  // ítems todavía en PENDIENTE (spec §7.5 original): la primera vez que se guardaba un costeo,
  // el precio se copiaba al checklist — pero desde ahí quedaba CONGELADO para siempre, aunque
  // nadie hubiera tocado el checklist a mano. Cualquier ajuste posterior al costeo (bajar el
  // recargo, agregar un ítem) dejaba el checklist con el total viejo, y la alerta
  // DISCORDANCIA_COSTEO_ANEXO saltaba en TODA edición — el usuario lo reportó: "no cada vez que
  // modifique el costeo me va a salir eso... la idea es que el costeo mande las cosas al auditor
  // técnico".
  //
  // Y el criterio final (mismo día, tras precisar el pedido): "que sea manual y automático pero
  // siempre prioridad al automático, pero que se pueda modificar manual" — o sea, el costeo
  // SIEMPRE sincroniza mientras el punto no esté APROBADO, sin excepción por "alguien ya lo
  // cargó a mano". Cargar un precio a mano sigue siendo válido (para el flujo asistente→asesor,
  // o para licitaciones sin costeo), pero no queda protegido: el siguiente guardado del costeo
  // lo pisa igual. Solo aprobar el punto lo saca de este ciclo — ahí sí es una decisión firmada
  // que el costeo no debe tocar en silencio, y es lo único que la alerta de discordancia avisa.
  //
  // Y NUNCA sobre una línea que quedó fuera de la oferta: el UPDATE de abajo escribe
  // `ofertamos = 1` (correcto para lo que sí se oferta, porque sincronizar un precio ES
  // comprometerse con esa línea), así que sin este filtro subir un costeo REVERTIRÍA en
  // silencio la decisión del selector — y encima dejaría la línea CARGADA, lista para que
  // alguien la visara. Aplica sobre todo a los negocios viejos, donde las filas de las líneas
  // descartadas ya existen; en uno nuevo el selector directamente no las genera.
  const itemsPrecio = items.filter((i: any) =>
    i.bloque === 'COMERCIAL' && i.tipo === 'precio' && i.estado !== 'APROBADO' && i.ofertamos !== false);
  if (esPorLinea(informe)) {
    // Suma TODOS los sub-ítems de la línea (totalPrecioDeLinea), no una fila suelta con la
    // clave equivocada — una línea real puede traer varios productos en su misma hoja.
    for (const it of itemsPrecio) {
      const total = it.linea_numero != null ? totalPrecioDeLinea(filas, it.linea_numero) : null;
      if (total == null) continue;
      if (Math.round((Number(it.valor_numero ?? NaN) - total) * 100) === 0) continue; // ya está al día
      await pool.query(
        `UPDATE checklist_comercial SET estado = 'CARGADO', valor_numero = ?, ofertamos = 1,
                cargado_por = ?, cargado_por_nombre = ?, cargado_at = ? WHERE id = ?`,
        [total, userId, nombreActor, ahora, it.id],
      );
    }
  } else {
    const totalItem = itemsPrecio.find((i: any) => i.linea_numero == null);
    if (totalItem && totalPrecioNeto > 0
      && Math.round((Number(totalItem.valor_numero ?? NaN) - totalPrecioNeto) * 100) !== 0) {
      await pool.query(
        `UPDATE checklist_comercial SET estado = 'CARGADO', valor_numero = ?, ofertamos = 1,
                cargado_por = ?, cargado_por_nombre = ?, cargado_at = ? WHERE id = ?`,
        [totalPrecioNeto, userId, nombreActor, ahora, totalItem.id],
      );
    }
  }

  // Se relee DESPUÉS de sincronizar: si nadie divergió a mano, esto ya es igual a totalPrecioNeto
  // y la alerta de discordancia de abajo simplemente no tiene nada que decir.
  const totalAnexo = await totalAnexoEconomico(negocio.id);
  const alertas: AlertaMotorComercial[] = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: totalAnexo, presupuestoPublicado, lineasPublicadas, lineasExcluidas,
  });

  const [[{ maxVersion }]] = await pool.query(
    `SELECT COALESCE(MAX(version), 0) AS maxVersion FROM checklist_comercial_costeo WHERE negocio_id = ?`,
    [negocio.id],
  ) as any;
  const version = Number(maxVersion) + 1;

  await pool.query(`UPDATE checklist_comercial_costeo SET vigente = 0 WHERE negocio_id = ? AND vigente = 1`, [negocio.id]);
  await pool.query(
    `INSERT INTO checklist_comercial_costeo
       (negocio_id, version, vigente, archivo_url, archivo_nombre, origen, total_costo_neto, total_precio_neto,
        presupuesto_publicado, total_anexo_economico, alertas, subido_por, subido_por_nombre, subido_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      negocio.id, version, opts.archivoUrl ? opts.archivoUrl.slice(0, 600) : null, opts.archivoNombre.slice(0, 300), opts.origen,
      totalCostoNeto, totalPrecioNeto, presupuestoPublicado, totalAnexo,
      JSON.stringify(alertas), userId, nombreActor, ahora,
    ],
  );

  // Aviso a los asesores solo si hay alertas — un costeo limpio no necesita interrumpir a nadie.
  if (alertas.length > 0) {
    for (const a of await asesores()) {
      if (Number(a.id) === Number(userId)) continue;
      await registrarEvento({
        tipo: 'COSTEO_CON_ALERTAS',
        licitacionCodigo: negocio.licitacion_codigo, licitacionNombre: negocio.licitacion_nombre,
        usuarioId: a.id, usuarioNombre: a.nombre, actorId: userId, actorNombre: nombreActor,
        mensaje: `${nombreActor} ${opts.origen === 'editor' ? 'guardó' : 'subió'} un costeo con ${alertas.length} alerta(s): ${alertas.map(x => x.descripcion).join(', ')}`,
        metadata: { negocioId: negocio.id, alertas: alertas.map(a2 => a2.codigo) },
      });
    }
  }
  publicarCambio('checklist_comercial');

  return {
    version, alertas,
    totales: { totalCostoNeto, totalPrecioNeto, presupuestoPublicado, totalAnexoEconomico: totalAnexo },
  };
}

// ═══ POST — ingesta de una nueva versión del costeo, desde un Excel subido ═══════════════════
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const url = String(body.url || '').trim();
    const nombreArchivo = String(body.nombre || 'costeo.xlsx').trim();
    if (!url) return NextResponse.json({ error: 'Falta la URL del archivo subido' }, { status: 400 });

    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: 'No se pudo descargar el archivo subido' }, { status: 400 });
    const buffer = Buffer.from(await res.arrayBuffer());

    let filas;
    try { filas = await parsearCosteo(buffer); }
    catch (e) { return NextResponse.json({ error: `No se pudo leer el Excel: ${String(e)}` }, { status: 400 }); }
    if (!filas.length) return NextResponse.json({ error: 'El archivo no trae ítems reconocibles (¿es la plantilla de costeo?)' }, { status: 400 });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
    const { version, alertas, totales } = await ingresarVersionCosteo(negocio, filas, {
      origen: 'archivo', archivoUrl: url, archivoNombre: nombreArchivo, userId, nombreActor,
    });

    return NextResponse.json({ success: true, version, alertas, totales });
  } catch (error) {
    console.error('[comercial/costeo][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ DELETE — borra una versión puntual del costeo ═══════════════════════════════
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const versionId = Number(body.id);
    if (!versionId) return NextResponse.json({ error: 'Falta el id de la versión a eliminar' }, { status: 400 });

    const [rows] = await pool.query(
      `SELECT id, vigente FROM checklist_comercial_costeo WHERE id = ? AND negocio_id = ? LIMIT 1`,
      [versionId, negocio.id],
    ) as any;
    const fila = (rows as any[])[0];
    if (!fila) return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 });

    await pool.query(`DELETE FROM checklist_comercial_costeo WHERE id = ?`, [versionId]);

    // Si la que se borró era la vigente, la más reciente que quede pasa a vigente sola — así el
    // Motor Comercial nunca queda "sin costeo" mientras todavía haya alguna versión subida.
    if (fila.vigente) {
      const [siguientes] = await pool.query(
        `SELECT id FROM checklist_comercial_costeo WHERE negocio_id = ? ORDER BY version DESC LIMIT 1`,
        [negocio.id],
      ) as any;
      const siguiente = (siguientes as any[])[0];
      if (siguiente) await pool.query(`UPDATE checklist_comercial_costeo SET vigente = 1 WHERE id = ?`, [siguiente.id]);
    }

    publicarCambio('checklist_comercial');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[comercial/costeo][DELETE]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
