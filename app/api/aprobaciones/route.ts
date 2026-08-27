// app/api/aprobaciones/route.ts
// BANDEJA DE APROBACIÓN TRANSVERSAL (Auditor Técnico, Fase 2) — vista cruzada de TODOS los
// negocios con algo pendiente de aprobación por bloque (TÉCNICO / COMERCIAL), para el asesor/CA.
//
// No es una tabla nueva: el estado de bloque se computa desde checklist_comercial en cada
// consulta (ver estadoDeBloque() en app/lib/checklist-comercial.ts) — así la regla de "cualquier
// cambio posterior invalida la aprobación" queda resuelta gratis, sin persistir nada.
//
// Reusa los helpers de la ruta hermana .../negocios/[id]/comercial/route.ts (mismo patrón de
// import cruzado que ya usa .../caracteristicas/route.ts) para no duplicar la máquina de
// estados ni la bitácora.
//
//   GET   → listado de negocios con bloques pendientes + totalPendientes
//   PATCH → { negocioId, bloque, accion: 'APROBAR_BLOQUE'|'RECHAZAR_BLOQUE' }
//           { negocioId, itemId, accion: 'APROBAR_CON_MODIFICACION', valorTexto?, valorNumero? }
//
// Ruta deliberadamente en /api/aprobaciones, NO /api/admin/aprobaciones: proxy.ts bloquea
// /admin/* a cualquiera que no sea rol==='admin', y un asesor/CA típico es rol='usuario' con el
// permiso aprobar_comercial — quedaría afuera de su propia bandeja. Se agrupa visualmente bajo
// "ADMIN" en el sidebar (igual que /empresas), pero la URL no lleva ese prefijo.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { ahoraChileSQL } from '@/app/lib/tz';
import {
  estadoDeBloque, resumirChecklist, transicion, BLOQUES_CON_APROBACION_CA, esAlertaDeCumplimiento,
  type BloqueAprobable, type EstadoItem,
} from '@/app/lib/checklist-comercial';
import { calcularSemaforo, causalesDeBloqueo } from '@/app/lib/semaforo-auditor';
import { esAsesor, bitacora, nombreDe, cargarNegocio, COLS } from '@/app/api/negocios/[id]/comercial/route';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

function horasHastaCierre(fechaCierre: string | null): number | null {
  return fechaCierre ? (new Date(fechaCierre).getTime() - Date.now()) / 3_600_000 : null;
}

interface FilaChecklist {
  bloque: BloqueAprobable; tipo: string; estado: EstadoItem; ofertamos: number | boolean | null;
  valor_numero: number | null; valor_texto: string | null; titulo: string; id: number;
  clave_origen: string | null;
}

/**
 * Una query ancha (negocios × checklist_comercial de bloques aprobables) + dos agregadas
 * (características técnicas, sin N+1), agrupadas en memoria — mismo patrón que ya usa
 * leerResumenesTecnicos() en la ruta hermana. Devuelve solo negocios con algo POR_APROBAR u
 * OBSERVADO: si nadie cargó nada todavía, no es "pendiente de aprobación", es trabajo que ni
 * siquiera empezó.
 */
export async function construirBandeja() {
  const [rows] = await pool.query(
    `SELECT n.id AS negocio_id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
            n.licitacion_cierre, n.asignado_a, u.nombre AS asignado_nombre,
            c.id, c.bloque, c.tipo, c.estado, c.ofertamos, c.valor_numero, c.valor_texto, c.titulo,
            c.clave_origen
       FROM negocios n
       JOIN checklist_comercial c ON c.negocio_id = n.id AND c.bloque IN ('TECNICO','COMERCIAL')
       LEFT JOIN usuarios u ON u.id = n.asignado_a
      WHERE n.activo = TRUE AND n.oculto_aprobaciones = 0
      ORDER BY n.id, c.bloque, c.orden`,
  ) as any;

  const [filasCaract] = await pool.query(
    `SELECT negocio_id,
            SUM(veredicto = 'CUMPLE') AS cumplen, SUM(veredicto = 'NO_CUMPLE') AS no_cumplen,
            SUM(veredicto = 'CUMPLE_CON_COMPLEMENTO') AS con_complemento, SUM(veredicto IS NULL) AS sin_evaluar,
            SUM(corregido_por IS NOT NULL) AS corregidas_por_asesor,
            SUM(pendiente_confirmacion_proveedor = 1) AS pendientes_proveedor
       FROM checklist_comercial_caracteristicas GROUP BY negocio_id`,
  ) as any;
  const veredictoPorNegocio = new Map<number, any>();
  for (const r of filasCaract as any[]) {
    veredictoPorNegocio.set(r.negocio_id, {
      cumplen: Number(r.cumplen), noCumplen: Number(r.no_cumplen),
      conComplemento: Number(r.con_complemento), sinEvaluar: Number(r.sin_evaluar),
      corregidasPorAsesor: Number(r.corregidas_por_asesor),
      pendientesProveedor: Number(r.pendientes_proveedor),
    });
  }

  // Alertas vigentes del Motor Comercial (Fase 4) — try/catch: si la migración 53 no está
  // aplicada todavía, la bandeja sigue funcionando sin esta columna, no revienta.
  const alertasPorNegocio = new Map<number, Array<{ codigo: string; descripcion: string; detalle: string }>>();
  try {
    const [filasCosteo] = await pool.query(
      `SELECT negocio_id, alertas FROM checklist_comercial_costeo WHERE vigente = 1`,
    ) as any;
    for (const r of filasCosteo as any[]) {
      const alertas = typeof r.alertas === 'string' ? JSON.parse(r.alertas) : (r.alertas || []);
      if (Array.isArray(alertas) && alertas.length) alertasPorNegocio.set(r.negocio_id, alertas);
    }
  } catch { /* migración 53 pendiente */ }

  const porNegocio = new Map<number, { info: any; items: FilaChecklist[] }>();
  for (const r of rows as any[]) {
    let entry = porNegocio.get(r.negocio_id);
    if (!entry) { entry = { info: r, items: [] }; porNegocio.set(r.negocio_id, entry); }
    entry.items.push(r);
  }

  const negocios: any[] = [];
  for (const [negocioId, { info, items }] of porNegocio) {
    const bloques: Record<string, any> = {};
    let precioTotal: number | null = null;
    let lineasNoOfertadas = 0;
    let plazoOfertado: string | null = null;
    // Bloqueantes ADMISIBILIDAD_DURA sumados solo de TECNICO+COMERCIAL (lo que esta query trae).
    // El bloque ADMINISTRATIVO también puede tener admisibilidad dura, pero no requiere
    // aprobación de CA (spec §3) y no se trae acá — la página del negocio (semaforoDelNegocio
    // en comercial/route.ts) sí lee TODOS los ítems y es la fuente de verdad completa.
    let bloqueantesPendientes = 0;

    for (const bloque of BLOQUES_CON_APROBACION_CA) {
      const delBloque = items.filter(i => i.bloque === bloque).map(i => ({
        ...i, ofertamos: i.ofertamos === null ? null : !!i.ofertamos,
      }));
      // Los bloqueantes pendientes se cuentan sobre TODO el bloque (las alertas de cumplimiento
      // también son admisibilidad y el asesor tiene que verlas), pero el estado y el avance del
      // BLOQUE se calculan sin ellas: se visan en su propia sección, no como parte del bloque
      // técnico/comercial (misma regla que la pantalla del Auditor — esAlertaDeCumplimiento).
      bloqueantesPendientes += resumirChecklist(delBloque as any).bloqueantesPendientes;
      const itemsBloque = delBloque.filter(i => !esAlertaDeCumplimiento(i));
      const resumen = resumirChecklist(itemsBloque as any);
      bloques[bloque] = {
        estado: estadoDeBloque(itemsBloque as any),
        total: resumen.total, aprobados: resumen.aprobados,
        porAprobar: resumen.porAprobar, observados: resumen.observados,
      };
      if (bloque === 'COMERCIAL') {
        const precios = itemsBloque.filter(i => i.tipo === 'precio' && i.ofertamos !== false && i.valor_numero != null);
        if (precios.length) precioTotal = precios.reduce((s, i) => s + Number(i.valor_numero), 0);
        lineasNoOfertadas = itemsBloque.filter(i => i.tipo === 'precio' && i.ofertamos === false).length;
        const plazo = itemsBloque.find(i => i.tipo === 'dato' && /plazo/i.test(i.titulo));
        plazoOfertado = plazo?.valor_texto || null;
      }
    }

    const requiereAtencion = BLOQUES_CON_APROBACION_CA.some(
      b => bloques[b].estado === 'POR_APROBAR' || bloques[b].estado === 'OBSERVADO',
    );
    if (!requiereAtencion) continue;

    const veredictoTecnico = veredictoPorNegocio.get(negocioId)
      || { cumplen: 0, noCumplen: 0, conComplemento: 0, sinEvaluar: 0, corregidasPorAsesor: 0, pendientesProveedor: 0 };

    const bloqueTecnicoAprobado = bloques.TECNICO.estado === 'APROBADO' || bloques.TECNICO.estado === 'SIN_ITEMS';
    const bloqueComercialAprobado = bloques.COMERCIAL.estado === 'APROBADO' || bloques.COMERCIAL.estado === 'SIN_ITEMS';
    const horasRestantes = horasHastaCierre(info.licitacion_cierre);
    const semaforo = calcularSemaforo({
      horasRestantes, bloqueantesPendientes,
      faltaAprobacionVigente: !bloqueTecnicoAprobado || !bloqueComercialAprobado,
    });
    const causales = causalesDeBloqueo({
      bloqueantesPendientes,
      itemsNoCumpleSinResolver: veredictoTecnico.noCumplen,
      itemsPendientesProveedor: veredictoTecnico.pendientesProveedor,
      bloqueTecnicoAprobado, bloqueComercialAprobado, horasRestantes,
    });

    negocios.push({
      negocioId,
      licitacionCodigo: info.licitacion_codigo,
      licitacionNombre: info.licitacion_nombre,
      licitacionOrganismo: info.licitacion_organismo,
      asignadoNombre: info.asignado_nombre,
      cierre: { fecha: info.licitacion_cierre, horasRestantes },
      semaforo, causalesBloqueo: causales,
      bloques,
      veredictoTecnico: {
        cumplen: veredictoTecnico.cumplen, noCumplen: veredictoTecnico.noCumplen,
        conComplemento: veredictoTecnico.conComplemento, sinEvaluar: veredictoTecnico.sinEvaluar,
      },
      comercial: { precioTotal, plazoOfertado },
      decisionesEstrategicas: {
        lineasNoOfertadas,
        especificacionesCorregidas: veredictoTecnico.corregidasPorAsesor,
      },
      alertasMotorComercial: alertasPorNegocio.get(negocioId) || [],
    });
  }

  // Rojo primero, luego por horas al cierre — la bandeja es una cola de trabajo, no un
  // calendario: lo que ya está bloqueado importa más que lo que simplemente cierra antes.
  const RANGO_SEMAFORO = { ROJO: 0, AMARILLO: 1, VERDE: 2 };
  negocios.sort((a, b) => {
    const porSemaforo = RANGO_SEMAFORO[a.semaforo as keyof typeof RANGO_SEMAFORO] - RANGO_SEMAFORO[b.semaforo as keyof typeof RANGO_SEMAFORO];
    if (porSemaforo !== 0) return porSemaforo;
    return (a.cierre.horasRestantes ?? Infinity) - (b.cierre.horasRestantes ?? Infinity);
  });
  const totalPendientes = negocios.filter(n => BLOQUES_CON_APROBACION_CA.some(b => n.bloques[b].estado === 'POR_APROBAR')).length;

  return { negocios, totalPendientes };
}

// ═══ GET ══════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esAsesor(userId, rol)))
    return NextResponse.json({ error: 'Solo el asesor puede ver la bandeja de aprobación.' }, { status: 403 });

  try {
    const { negocios, totalPendientes } = await construirBandeja();
    return NextResponse.json({ success: true, negocios, totalPendientes });
  } catch (error) {
    console.error('[aprobaciones][GET]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ PATCH — aprobar/rechazar un bloque completo, o corregir+aprobar un ítem puntual ══════════
export async function PATCH(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esAsesor(userId, rol)))
    return NextResponse.json({ error: 'Solo el asesor puede aprobar o rechazar.' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const negocioId = Number(body.negocioId);
    const accion = String(body.accion || '');
    if (!negocioId || !['APROBAR_BLOQUE', 'RECHAZAR_BLOQUE', 'APROBAR_CON_MODIFICACION', 'OCULTAR_NEGOCIO', 'APROBAR_TODO'].includes(accion))
      return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });

    const negocio = await cargarNegocio(String(negocioId));
    if (!negocio) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
    const ahora = ahoraChileSQL();
    const lic = { licitacionCodigo: negocio.licitacion_codigo, licitacionNombre: negocio.licitacion_nombre };

    // ── Sacar el negocio de esta bandeja — SOLO admin, y a propósito ANTES del guard de
    // congelamiento: no toca checklist_comercial ni activo, así que da lo mismo si ya se
    // postuló. Reemplaza el DELETE de /api/negocios/[id] que se usaba antes acá por error: ese
    // hace activo = FALSE y saca el negocio de TODA la app (Negocios, Postuladas, el tablero del
    // asignado…), no solo de esta bandeja. Ver docs/migration-74-aprobaciones-ocultar.sql.
    if (accion === 'OCULTAR_NEGOCIO') {
      if (rol !== 'admin')
        return NextResponse.json({ error: 'Solo un administrador puede sacar un negocio de la bandeja.' }, { status: 403 });
      await pool.query(
        `UPDATE negocios SET oculto_aprobaciones = 1, oculto_aprobaciones_por = ?, oculto_aprobaciones_at = ? WHERE id = ?`,
        [userId, ahora, negocioId],
      );
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, ...(await construirBandeja()) });
    }

    if (await yaCongelado(negocioId, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    // ── Aprobar TODO de un clic: los dos bloques (técnico y comercial) que tengan algo cargado,
    // en una sola acción — pedido explícito del admin: la bandeja separaba en dos botones lo que
    // en la práctica se revisa y visa junto. Silenciosamente no hace nada en el bloque que no
    // tenga CARGADO (p.ej. ya aprobado, o esperando al asistente en OBSERVADO): esos siguen
    // necesitando su propio "Rechazar"/re-carga, "aprobar todo" no los fuerza.
    if (accion === 'APROBAR_TODO') {
      let totalAprobados = 0;
      const bloquesAprobados: BloqueAprobable[] = [];
      for (const bloqueActual of BLOQUES_CON_APROBACION_CA) {
        const [rows] = await pool.query(
          `SELECT ${COLS} FROM checklist_comercial WHERE negocio_id = ? AND bloque = ? AND estado = 'CARGADO'`,
          [negocioId, bloqueActual],
        ) as any;
        // Las alertas de cumplimiento quedan FUERA del visado en bloque: desde el 26-ago-2026 son
        // un acuse de lectura del asistente (acción ACUSAR), no algo que el asesor audite. Ya se
        // excluían del ESTADO del bloque (más arriba), pero "aprobar todo" igual las barría si
        // habían quedado en CARGADO con el flujo viejo — y las dejaba firmadas por un asesor que
        // nunca las miró.
        const items = (rows as any[]).filter(i => !esAlertaDeCumplimiento(i));
        if (!items.length) continue;
        for (const item of items) {
          await pool.query(
            `UPDATE checklist_comercial SET estado = 'APROBADO', observacion = NULL,
                    aprobado_por = ?, aprobado_por_nombre = ?, aprobado_at = ? WHERE id = ?`,
            [userId, nombreActor, ahora, item.id],
          );
          await bitacora(item.id, negocioId, 'APROBAR_BLOQUE', item.estado, 'APROBADO', null, userId, nombreActor);
        }
        totalAprobados += items.length;
        bloquesAprobados.push(bloqueActual);
      }
      if (!totalAprobados)
        return NextResponse.json({ error: 'No hay nada por aprobar en este negocio.' }, { status: 400 });

      if (negocio.asignado_a && Number(negocio.asignado_a) !== Number(userId)) {
        const nombresBloques = bloquesAprobados.map(b => b === 'TECNICO' ? 'técnico' : 'comercial').join(' y ');
        await registrarEvento({
          tipo: 'COMERCIAL_APROBADO', ...lic,
          usuarioId: negocio.asignado_a, usuarioNombre: negocio.asignado_nombre,
          actorId: userId, actorNombre: nombreActor,
          mensaje: `${nombreActor} aprobó el bloque ${nombresBloques} completo`,
          metadata: { negocioId, bloques: bloquesAprobados },
        });
      }
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, ...(await construirBandeja()) });
    }

    // ── Corregir y aprobar UN ítem puntual (redirige aquí desde el link "Ver detalle" de la
    // bandeja hacia el negocio; este endpoint queda disponible igual para uso directo). ──────
    if (accion === 'APROBAR_CON_MODIFICACION') {
      const itemId = Number(body.itemId);
      if (!itemId) return NextResponse.json({ error: 'Falta itemId' }, { status: 400 });
      const [rows] = await pool.query(`SELECT ${COLS} FROM checklist_comercial WHERE id = ? AND negocio_id = ? LIMIT 1`, [itemId, negocioId]) as any;
      const item = (rows as any[])[0];
      if (!item) return NextResponse.json({ error: 'Punto no encontrado' }, { status: 404 });
      if (item.estado === 'APROBADO')
        return NextResponse.json({ error: 'Ya está aprobado — usa Reabrir desde el negocio si necesitas corregirlo.' }, { status: 400 });

      await pool.query(
        `UPDATE checklist_comercial
            SET valor_texto = COALESCE(?, valor_texto), valor_numero = COALESCE(?, valor_numero),
                estado = 'APROBADO', observacion = NULL,
                aprobado_por = ?, aprobado_por_nombre = ?, aprobado_at = ?
          WHERE id = ?`,
        [
          body.valorTexto ?? null,
          body.valorNumero != null && body.valorNumero !== '' ? Number(body.valorNumero) : null,
          userId, nombreActor, ahora, itemId,
        ],
      );
      await bitacora(itemId, negocioId, 'APROBAR_CON_MODIFICACION', item.estado, 'APROBADO',
        body.comentario || 'Valor corregido por el asesor antes de aprobar', userId, nombreActor);

      if (negocio.asignado_a && Number(negocio.asignado_a) !== Number(userId)) {
        await registrarEvento({
          tipo: 'COMERCIAL_APROBADO', ...lic,
          usuarioId: negocio.asignado_a, usuarioNombre: negocio.asignado_nombre,
          actorId: userId, actorNombre: nombreActor,
          mensaje: `${nombreActor} corrigió y aprobó "${item.titulo}"`,
          metadata: { negocioId, itemId, bloque: item.bloque },
        });
      }
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, ...(await construirBandeja()) });
    }

    // ── Aprobar / rechazar el bloque completo (todos los ítems CARGADO de ese bloque). ───────
    const bloque = String(body.bloque || '') as BloqueAprobable;
    if (!BLOQUES_CON_APROBACION_CA.includes(bloque))
      return NextResponse.json({ error: 'Bloque inválido' }, { status: 400 });
    if (accion === 'RECHAZAR_BLOQUE' && !String(body.comentario || '').trim())
      return NextResponse.json({ error: 'El comentario es obligatorio para rechazar.' }, { status: 400 });

    const [rows] = await pool.query(
      `SELECT ${COLS} FROM checklist_comercial WHERE negocio_id = ? AND bloque = ? AND estado = 'CARGADO'`,
      [negocioId, bloque],
    ) as any;
    // Mismo motivo que en APROBAR_TODO: las alertas de cumplimiento no las visa el asesor.
    const items = (rows as any[]).filter(i => !esAlertaDeCumplimiento(i));
    if (!items.length) {
      return NextResponse.json({
        error: `No hay nada cargado en el bloque ${bloque === 'TECNICO' ? 'técnico' : 'comercial'} para ${accion === 'APROBAR_BLOQUE' ? 'aprobar' : 'rechazar'}.`,
      }, { status: 400 });
    }

    const comentario = accion === 'RECHAZAR_BLOQUE' ? String(body.comentario).trim().slice(0, 2000) : null;
    const nuevoEstado = transicion('CARGADO', accion === 'APROBAR_BLOQUE' ? 'APROBAR' : 'OBSERVAR') as EstadoItem;
    const bitacoraAccion = accion === 'APROBAR_BLOQUE' ? 'APROBAR_BLOQUE' : 'RECHAZAR_BLOQUE';

    for (const item of items) {
      if (accion === 'APROBAR_BLOQUE') {
        await pool.query(
          `UPDATE checklist_comercial SET estado = 'APROBADO', observacion = NULL,
                  aprobado_por = ?, aprobado_por_nombre = ?, aprobado_at = ? WHERE id = ?`,
          [userId, nombreActor, ahora, item.id],
        );
      } else {
        await pool.query(
          `UPDATE checklist_comercial SET estado = 'OBSERVADO', observacion = ?,
                  aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL WHERE id = ?`,
          [comentario, item.id],
        );
      }
      await bitacora(item.id, negocioId, bitacoraAccion, item.estado, nuevoEstado, comentario, userId, nombreActor);
    }

    if (negocio.asignado_a && Number(negocio.asignado_a) !== Number(userId)) {
      const nombreBloque = bloque === 'TECNICO' ? 'técnico' : 'comercial';
      await registrarEvento({
        tipo: accion === 'APROBAR_BLOQUE' ? 'COMERCIAL_APROBADO' : 'COMERCIAL_OBSERVADO', ...lic,
        usuarioId: negocio.asignado_a, usuarioNombre: negocio.asignado_nombre,
        actorId: userId, actorNombre: nombreActor,
        mensaje: accion === 'APROBAR_BLOQUE'
          ? `${nombreActor} aprobó el bloque ${nombreBloque} completo`
          : `${nombreActor} rechazó el bloque ${nombreBloque}: ${comentario?.slice(0, 160)}`,
        metadata: { negocioId, bloque },
      });
    }
    publicarCambio('checklist_comercial');
    return NextResponse.json({ success: true, ...(await construirBandeja()) });
  } catch (error) {
    console.error('[aprobaciones][PATCH]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
