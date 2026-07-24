// app/api/negocios/[id]/comercial/route.ts
// MÓDULO "INFORMACIÓN COMERCIAL" — el auditor de la etapa ANEXOS.
//
//   GET   → checklist del negocio (lo materializa desde la viabilidad la primera vez) + resumen
//   POST  → { accion: 'resincronizar' } agrega los puntos nuevos tras un re-análisis
//           { accion: 'agregar', ... }  punto manual que la IA no vio
//   PATCH → { itemId, accion: 'CARGAR'|'APROBAR'|'OBSERVAR'|'REABRIR', ... }
//
// DOBLE FIRMA: el asistente CARGA, el asesor APRUEBA. Cada acción notifica al otro lado EN EL
// ACTO (SSE + campana), porque el flujo real es "sube a las 10:32, se aprueba a las 10:33" —
// un digest agrupado llegaría cuando la licitación ya cerró.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado, permisosDeUsuario } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import {
  generarItemsDesdeViabilidad, resumirChecklist, transicion, tieneInformacionComercial,
  esPorLinea, modalidadDudosa, type EstadoItem,
} from '@/app/lib/checklist-comercial';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

const COLS = `id, negocio_id, bloque, tipo, titulo, descripcion, criticidad, ponderacion, fuente_cita,
  origen, clave_origen, generable, plantilla_id, linea_numero, ofertamos, estado, valor_texto,
  valor_numero, documento_url, documento_nombre, observacion, orden,
  cargado_por, cargado_por_nombre, cargado_at, aprobado_por, aprobado_por_nombre, aprobado_at`;

/** Negocio + datos de la empresa con la que se postula (los que alimentan los anexos). */
async function cargarNegocio(id: string) {
  const [rows] = await pool.query(
    `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.estado_pipeline, n.asignado_a,
            n.empresa_id, u.nombre AS asignado_nombre,
            e.razon_social, e.rut, e.direccion, e.region, e.giro, e.tipo_persona_juridica,
            e.representante_nombre, e.representante_rut, e.representante_cargo,
            e.email1, e.telefono1, e.banco_tipo_cuenta, e.banco_numero, e.banco_nombre
       FROM negocios n
       LEFT JOIN usuarios u ON u.id = n.asignado_a
       LEFT JOIN empresas e ON e.id = n.empresa_id
      WHERE n.id = ? AND n.activo = TRUE
      LIMIT 1`,
    [id],
  ) as any;
  return (rows as any[])[0] || null;
}

/** Informe de viabilidad guardado (v3 preferido, v2 de respaldo) — misma lectura que usa el panel. */
async function leerInforme(codigo: string): Promise<any | null> {
  try {
    const [rows] = await pool.query(
      `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const row = (rows as any[])[0];
    if (!row) return null;
    const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
    return ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
  } catch { return null; }
}

/** ¿Este usuario visa? Admin siempre; otro perfil solo con el permiso aprobar_comercial. */
async function esAsesor(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!p.aprobar_comercial;
}

/** A quién avisar cuando el asistente carga algo: todos los que pueden visar. */
async function asesores(): Promise<Array<{ id: number; nombre: string }>> {
  try {
    const [rows] = await pool.query(
      // JSON_UNQUOTE(...)='true' y no `= TRUE`: comparar un valor JSON contra el booleano
      // de SQL depende de la versión de MySQL y falla en silencio (no encuentra a nadie).
      `SELECT id, nombre FROM usuarios
        WHERE activo = TRUE
          AND (rol = 'admin' OR JSON_UNQUOTE(JSON_EXTRACT(permisos, '$.aprobar_comercial')) = 'true')`,
    ) as any;
    return rows as any[];
  } catch {
    // Sin columna `permisos` (migración 28 pendiente) o sin `activo`: caer a los admin.
    try {
      const [rows] = await pool.query(`SELECT id, nombre FROM usuarios WHERE rol = 'admin'`) as any;
      return rows as any[];
    } catch { return []; }
  }
}

/**
 * ¿Están creadas las tablas? Las migraciones se aplican a mano en phpMyAdmin, así que el
 * módulo tiene que decir "falta la migración 48" en vez de reventar con un 500 opaco.
 */
async function migracionAplicada(): Promise<boolean> {
  try { await pool.query('SELECT 1 FROM checklist_comercial LIMIT 1'); return true; }
  catch { return false; }
}

async function leerItems(negocioId: number) {
  const [rows] = await pool.query(
    `SELECT ${COLS} FROM checklist_comercial WHERE negocio_id = ? ORDER BY bloque, orden, id`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => ({
    ...r,
    generable: !!r.generable,
    ofertamos: r.ofertamos === null ? null : !!r.ofertamos,
    ponderacion: r.ponderacion === null ? null : Number(r.ponderacion),
    valor_numero: r.valor_numero === null ? null : Number(r.valor_numero),
  }));
}

/**
 * Materializa el checklist desde el informe. Idempotente: `INSERT IGNORE` contra la unique
 * (negocio_id, clave_origen), así que resincronizar tras un re-análisis AGREGA lo nuevo y
 * nunca pisa lo que el asesor ya aprobó.
 */
async function sincronizar(negocioId: number, codigo: string, informe: any): Promise<number> {
  const items = generarItemsDesdeViabilidad(informe);
  if (!items.length) return 0;
  let nuevos = 0;
  for (const it of items) {
    const [r] = await pool.query(
      `INSERT IGNORE INTO checklist_comercial
         (negocio_id, licitacion_codigo, bloque, tipo, titulo, descripcion, criticidad, ponderacion,
          fuente_cita, origen, clave_origen, generable, linea_numero, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        negocioId, codigo, it.bloque, it.tipo, it.titulo, it.descripcion, it.criticidad,
        it.ponderacion, it.fuenteCita, it.origen, it.claveOrigen, it.generable ? 1 : 0,
        it.lineaNumero, it.orden,
      ],
    ) as any;
    if ((r as any).affectedRows) nuevos++;
  }
  return nuevos;
}

async function bitacora(
  itemId: number, negocioId: number, accion: string,
  anterior: string | null, nuevo: string, comentario: string | null,
  userId: number, userNombre: string,
) {
  try {
    await pool.query(
      `INSERT INTO checklist_comercial_bitacora
         (item_id, negocio_id, accion, estado_anterior, estado_nuevo, comentario, usuario_id, usuario_nombre, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemId, negocioId, accion, anterior, nuevo, comentario, userId, userNombre, ahoraChileSQL()],
    );
  } catch (e) {
    console.error('[comercial] bitácora falló:', String(e));  // nunca bloquear la acción principal
  }
}

// ═══ GET ════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    if (!(await migracionAplicada())) {
      return NextResponse.json({
        success: true, migracionPendiente: true, activo: tieneInformacionComercial(negocio.estado_pipeline),
        items: [], resumen: resumirChecklist([]), puedeAprobar: false, sinViabilidad: false,
        modalidad: null, empresa: null,
      });
    }

    const activo = tieneInformacionComercial(negocio.estado_pipeline);
    const informe = await leerInforme(negocio.licitacion_codigo);

    let items = await leerItems(negocio.id);
    // Primera entrada a ANEXOS: se materializa el checklist. Solo si la etapa está activa,
    // para no generar trabajo en licitaciones que aún están en análisis.
    if (activo && items.length === 0 && informe) {
      await sincronizar(negocio.id, negocio.licitacion_codigo, informe);
      items = await leerItems(negocio.id);
    }

    return NextResponse.json({
      success: true,
      activo,
      sinViabilidad: !informe,
      items,
      resumen: resumirChecklist(items),
      puedeAprobar: await esAsesor(userId, rol),
      esAsignado: Number(negocio.asignado_a) === Number(userId),
      modalidad: {
        porLinea: informe ? esPorLinea(informe) : false,
        dudosa: informe ? modalidadDudosa(informe) : true,
        tipo: informe?.modalidad?.tipo ?? null,
        comoSeAdjudica: informe?.modalidad?.como_se_adjudica ?? null,
      },
      empresa: negocio.empresa_id ? {
        id: negocio.empresa_id, razon_social: negocio.razon_social, rut: negocio.rut,
        direccion: negocio.direccion, region: negocio.region, giro: negocio.giro,
        tipo_persona_juridica: negocio.tipo_persona_juridica,
        representante_nombre: negocio.representante_nombre, representante_rut: negocio.representante_rut,
        representante_cargo: negocio.representante_cargo, email1: negocio.email1, telefono1: negocio.telefono1,
        banco_tipo_cuenta: negocio.banco_tipo_cuenta, banco_numero: negocio.banco_numero, banco_nombre: negocio.banco_nombre,
      } : null,
    });
  } catch (error) {
    console.error('[comercial][GET]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ POST — resincronizar / agregar punto manual ════════════════════════════════
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const accion = String(body.accion || 'resincronizar');

    if (accion === 'resincronizar') {
      const informe = await leerInforme(negocio.licitacion_codigo);
      if (!informe) return NextResponse.json({ error: 'Esta licitación aún no tiene informe de viabilidad.' }, { status: 400 });
      const nuevos = await sincronizar(negocio.id, negocio.licitacion_codigo, informe);
      const items = await leerItems(negocio.id);
      return NextResponse.json({ success: true, nuevos, items, resumen: resumirChecklist(items) });
    }

    if (accion === 'agregar') {
      const titulo = String(body.titulo || '').trim();
      if (!titulo) return NextResponse.json({ error: 'Falta el título del punto.' }, { status: 400 });
      const bloque = ['ADMINISTRATIVO', 'TECNICO', 'COMERCIAL'].includes(body.bloque) ? body.bloque : 'ADMINISTRATIVO';
      const clave = `manual:${Date.now()}:${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80)}`;
      await pool.query(
        `INSERT INTO checklist_comercial
           (negocio_id, licitacion_codigo, bloque, tipo, titulo, descripcion, criticidad, origen, clave_origen, orden)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, 999)`,
        [negocio.id, negocio.licitacion_codigo, bloque, body.tipo === 'dato' ? 'dato' : 'documento',
         titulo.slice(0, 280), body.descripcion || null,
         body.criticidad === 'ADMISIBILIDAD_DURA' ? 'ADMISIBILIDAD_DURA' : 'INFORMATIVO', clave],
      );
      const items = await leerItems(negocio.id);
      return NextResponse.json({ success: true, items, resumen: resumirChecklist(items) });
    }

    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 });
  } catch (error) {
    console.error('[comercial][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ PATCH — cargar / aprobar / observar / reabrir ══════════════════════════════
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const itemId = Number(body.itemId);
    const accion = String(body.accion || '') as 'CARGAR' | 'APROBAR' | 'OBSERVAR' | 'REABRIR';
    if (!itemId || !['CARGAR', 'APROBAR', 'OBSERVAR', 'REABRIR'].includes(accion))
      return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });

    const [rows] = await pool.query(
      `SELECT ${COLS} FROM checklist_comercial WHERE id = ? AND negocio_id = ? LIMIT 1`,
      [itemId, negocio.id],
    ) as any;
    const item = (rows as any[])[0];
    if (!item) return NextResponse.json({ error: 'Punto no encontrado' }, { status: 404 });

    const visa = await esAsesor(userId, rol);
    if ((accion === 'APROBAR' || accion === 'OBSERVAR' || accion === 'REABRIR') && !visa)
      return NextResponse.json({ error: 'Solo el asesor puede visar los puntos.' }, { status: 403 });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
    const anterior = item.estado as EstadoItem;

    // ── Marcar/desmarcar una línea que NO se oferta. No es una transición de estado: es
    // decidir que ese punto no entra en la oferta, así que sale del cálculo de avance.
    if (accion === 'CARGAR' && item.tipo === 'precio' && body.ofertamos === false) {
      await pool.query(
        `UPDATE checklist_comercial SET ofertamos = 0, valor_numero = NULL, estado = 'PENDIENTE' WHERE id = ?`,
        [itemId],
      );
      await bitacora(itemId, negocio.id, 'EDITAR', anterior, 'PENDIENTE', 'No se oferta esta línea', userId, nombreActor);
      const items = await leerItems(negocio.id);
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, items, resumen: resumirChecklist(items) });
    }

    const nuevo = transicion(anterior, accion);
    if (!nuevo) return NextResponse.json({ error: `No se puede ${accion.toLowerCase()} un punto en estado ${anterior}.` }, { status: 400 });

    if (accion === 'OBSERVAR' && !String(body.observacion || '').trim())
      return NextResponse.json({ error: 'La observación es obligatoria: el asistente necesita saber qué corregir.' }, { status: 400 });

    const ahora = ahoraChileSQL();

    if (accion === 'CARGAR') {
      // El asistente carga evidencia. Si el punto ya estaba aprobado, vuelve a CARGADO: un
      // valor aprobado que cambia sin que nadie lo vea es justo lo que esto viene a evitar.
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'CARGADO', valor_texto = ?, valor_numero = ?, documento_url = ?, documento_nombre = ?,
                ofertamos = ?, observacion = NULL,
                cargado_por = ?, cargado_por_nombre = ?, cargado_at = ?,
                aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [
          body.valorTexto ?? item.valor_texto ?? null,
          body.valorNumero != null && body.valorNumero !== '' ? Number(body.valorNumero) : item.valor_numero,
          body.documentoUrl ?? item.documento_url ?? null,
          body.documentoNombre ?? item.documento_nombre ?? null,
          item.tipo === 'precio' ? 1 : item.ofertamos,
          userId, nombreActor, ahora, itemId,
        ],
      );
    } else if (accion === 'APROBAR') {
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'APROBADO', observacion = NULL,
                aprobado_por = ?, aprobado_por_nombre = ?, aprobado_at = ?
          WHERE id = ?`,
        [userId, nombreActor, ahora, itemId],
      );
    } else if (accion === 'OBSERVAR') {
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'OBSERVADO', observacion = ?,
                aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [String(body.observacion).trim().slice(0, 2000), itemId],
      );
    } else { // REABRIR
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'PENDIENTE', aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [itemId],
      );
    }

    await bitacora(itemId, negocio.id, accion, anterior, nuevo, body.observacion || null, userId, nombreActor);

    // ── Aviso instantáneo al otro lado del circuito ──────────────────────────────
    const lic = { licitacionCodigo: negocio.licitacion_codigo, licitacionNombre: negocio.licitacion_nombre };
    if (accion === 'CARGAR') {
      // Al asesor: hay algo esperando su visto bueno. Uno por asesor, en el acto.
      for (const a of await asesores()) {
        if (Number(a.id) === Number(userId)) continue;   // no avisarse a sí mismo
        await registrarEvento({
          tipo: 'COMERCIAL_POR_APROBAR', ...lic,
          usuarioId: a.id, usuarioNombre: a.nombre,
          actorId: userId, actorNombre: nombreActor,
          mensaje: `${nombreActor} cargó "${item.titulo}" y espera tu aprobación`,
          metadata: { negocioId: negocio.id, itemId, bloque: item.bloque },
        });
      }
    } else if (accion === 'APROBAR' || accion === 'OBSERVAR') {
      // Al asistente: aprobado o devuelto. El rebote también avisa, no solo la subida.
      if (negocio.asignado_a && Number(negocio.asignado_a) !== Number(userId)) {
        await registrarEvento({
          tipo: accion === 'APROBAR' ? 'COMERCIAL_APROBADO' : 'COMERCIAL_OBSERVADO', ...lic,
          usuarioId: negocio.asignado_a, usuarioNombre: negocio.asignado_nombre,
          actorId: userId, actorNombre: nombreActor,
          mensaje: accion === 'APROBAR'
            ? `${nombreActor} aprobó "${item.titulo}"`
            : `${nombreActor} observó "${item.titulo}": ${String(body.observacion).trim().slice(0, 160)}`,
          metadata: { negocioId: negocio.id, itemId, bloque: item.bloque },
        });
      }
    }
    publicarCambio('checklist_comercial');

    const items = await leerItems(negocio.id);
    return NextResponse.json({ success: true, items, resumen: resumirChecklist(items) });
  } catch (error) {
    console.error('[comercial][PATCH]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function nombreDe(userId: number): Promise<string | null> {
  try {
    const [rows] = await pool.query('SELECT nombre FROM usuarios WHERE id = ? LIMIT 1', [userId]) as any;
    return (rows as any[])[0]?.nombre ?? null;
  } catch { return null; }
}
