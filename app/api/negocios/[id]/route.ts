// app/api/negocios/[id]/route.ts
// Detalle de un negocio: GET, PATCH (actualizar monto ofertado / etiquetas), DELETE (admin)
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';
import { registrarEvento } from '@/app/lib/historial';
import { enviarCorreoCambio, enviarCorreoAsignacion } from '@/app/lib/email';
import { getEstadoPipeline } from '@/app/lib/pipeline';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

type Params = { params: Promise<{ id: string }> };

// GET — detalle del negocio (visible para el asignado o admin)
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  try {
    // Tabla no existe todavía
    try { await pool.query('SELECT 1 FROM negocios LIMIT 1'); }
    catch { return NextResponse.json({ error: 'Ejecuta la migración migration-3-negocios.sql en tu base de datos' }, { status: 503 }); }

    const [rows] = await pool.query(
      `SELECT n.*,
              COALESCE(n.estado_pipeline, 'ASIGNADO') AS estado_pipeline,
              u.nombre AS usuario_nombre, u.email AS usuario_email,
              a.nombre AS admin_nombre,
              d.nombre AS descarte_por_nombre
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a
       LEFT JOIN usuarios a ON a.id = n.asignado_por
       LEFT JOIN usuarios d ON d.id = n.descarte_por
       WHERE n.id = ?`,
      [id]
    ) as any;

    if (!(rows as any[]).length)
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const negocio = (rows as any[])[0];

    // Verificar acceso
    if (rol !== 'admin' && negocio.asignado_a !== userId)
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    // Etiquetas, viabilidad y documentos en paralelo
    const codigo = negocio.licitacion_codigo;
    const [etRows, viabRows, docRows] = await Promise.all([
      pool.query(
        `SELECT e.id, e.nombre, e.color
         FROM negocios_etiquetas ne
         JOIN etiquetas e ON e.id = ne.etiqueta_id
         WHERE ne.negocio_id = ?`, [id]
      ),
      pool.query(
        `SELECT semaforo, score_total, area_negocio, informe_ejecutivo
         FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]
      ).catch(() => [[]] as any),
      pool.query(
        `SELECT nombre_archivo, url_local, url_original, size_bytes, categoria, created_at
         FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at DESC LIMIT 30`, [codigo]
      ).catch(() => [[]] as any),
    ]);

    negocio.etiquetas = (etRows as any)[0];

    const viab = ((viabRows as any)[0] as any[])[0];
    if (viab) {
      negocio.viabilidad_semaforo = viab.semaforo ?? null;
      negocio.viabilidad_score    = viab.score_total ?? null;
      negocio.viabilidad_area     = viab.area_negocio ?? null;
      try {
        negocio.viabilidad_informe = typeof viab.informe_ejecutivo === 'string'
          ? JSON.parse(viab.informe_ejecutivo)
          : (viab.informe_ejecutivo ?? null);
      } catch { negocio.viabilidad_informe = null; }
    }

    // El costeo (con precios de mercado incluido) es visible para cualquier perfil asignado.
    negocio.documentos = (docRows as any)[0] as any[];
    negocio.total_documentos = negocio.documentos.length;

    // Empresa con la que se postuló (si hay). Best-effort.
    if (negocio.empresa_id) {
      try {
        const [er] = await pool.query(
          `SELECT id, razon_social, rut FROM empresas WHERE id = ?`, [negocio.empresa_id]);
        negocio.empresa = (er as any[])[0] || null;
        negocio.empresa_nombre = negocio.empresa?.razon_social ?? null;
      } catch { /* migración 40 pendiente */ }
    }

    return NextResponse.json({ success: true, negocio });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — actualizar monto ofertado y/o etiquetas
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { monto_ofertado, etiqueta_ids, estado_pipeline, asignado_a, empresa_id } = body;
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';

    // Verificar acceso
    const [rows] = await pool.query(
      `SELECT asignado_a, licitacion_codigo, licitacion_nombre,
              licitacion_organismo, licitacion_monto, licitacion_cierre
       FROM negocios WHERE id = ?`, [id]
    ) as any;
    if (!(rows as any[]).length)
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const neg = (rows as any[])[0];
    if (rol !== 'admin' && neg.asignado_a !== userId)
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    // Cambios de esta petición → un correo consolidado al perfil asignado (al final).
    const cambios: { tipo: string; detalle: string }[] = [];
    let huboReasignacion = false;
    const fmtCLP = (n?: number | null) => n
      ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
      : null;

    // Actualizar monto
    if (monto_ofertado !== undefined) {
      await pool.query(
        `UPDATE negocios SET monto_ofertado = ? WHERE id = ?`,
        [monto_ofertado || 0, id]
      );
      cambios.push({ tipo: 'Monto', detalle: `Monto ofertado: ${fmtCLP(Number(monto_ofertado)) || '$0'}.` });
    }

    // Empresa con la que se postula (NULL para desasignar). Tolerante si la columna
    // aún no existe (migración 40 pendiente): degrada sin romper el resto del PATCH.
    if (empresa_id !== undefined) {
      try {
        await pool.query(
          `UPDATE negocios SET empresa_id = ? WHERE id = ?`,
          [empresa_id ? Number(empresa_id) : null, id]
        );
      } catch (colErr: any) {
        if (!String(colErr).toLowerCase().includes('unknown column')) throw colErr;
      }
    }

    // Actualizar estado del pipeline (cualquier usuario asignado o admin)
    if (estado_pipeline !== undefined) {
      // Descartar EXIGE un motivo. Se registra quién y cuándo; al salir de DESCARTADA se limpia.
      if (estado_pipeline === 'DESCARTADA' && !motivo) {
        return NextResponse.json({ error: 'Para descartar la licitación debes indicar un motivo.' }, { status: 400 });
      }
      try {
        if (estado_pipeline === 'DESCARTADA') {
          await pool.query(
            `UPDATE negocios SET estado_pipeline = 'DESCARTADA', descarte_motivo = ?,
                    descarte_por = ?, descarte_at = NOW(), updated_at = NOW() WHERE id = ?`,
            [motivo.slice(0, 500), userId, id]
          );
          // Deja el motivo también en el hilo de comentarios del negocio (best-effort).
          try {
            await pool.query(
              `INSERT INTO comentarios_negocio (negocio_id, usuario_id, comentario) VALUES (?, ?, ?)`,
              [id, userId, `Descartada — motivo: ${motivo}`]
            );
          } catch { /* si la tabla no existe, no bloquea el descarte */ }
        } else {
          // Cualquier otro estado limpia los metadatos de descarte previos.
          await pool.query(
            `UPDATE negocios SET estado_pipeline = ?, descarte_motivo = NULL,
                    descarte_por = NULL, descarte_at = NULL, updated_at = NOW() WHERE id = ?`,
            [estado_pipeline || null, id]
          );
        }
        registrarActividad({
          usuarioId: userId, accion: 'cambio_pipeline',
          entidadTipo: 'negocio', entidadId: String(id),
          descripcion: estado_pipeline === 'DESCARTADA'
            ? `Descartó "${neg.licitacion_nombre || neg.licitacion_codigo}": ${motivo}`
            : `Cambió el estado de "${neg.licitacion_nombre || neg.licitacion_codigo}" a ${estado_pipeline || '—'}`,
          metadata: { licitacion_codigo: neg.licitacion_codigo, estado_pipeline, motivo: motivo || undefined },
        });
        const estadoLabel = getEstadoPipeline(estado_pipeline)?.label || estado_pipeline || '—';
        cambios.push(estado_pipeline === 'DESCARTADA'
          ? { tipo: 'Estado', detalle: `Se descartó. Motivo: ${motivo}` }
          : { tipo: 'Estado', detalle: `Ahora está en ${estadoLabel}.` });
      } catch (colErr: any) {
        if (String(colErr).toLowerCase().includes('unknown column')) {
          return NextResponse.json({
            error: 'Ejecuta migration-4-pipeline.sql en Bluehost → phpMyAdmin',
            migration_needed: true,
          }, { status: 503 });
        }
        throw colErr;
      }
    }

    // Reasignar a otro usuario (SOLO admin). In-place: mantiene el mismo registro de negocio
    // (su historial/comentarios/estado) y solo cambia el responsable.
    if (asignado_a !== undefined && rol === 'admin') {
      const nuevo = Number(asignado_a);
      if (nuevo && nuevo !== Number(neg.asignado_a)) {
        // Evita el choque con la unique (asignado_a, licitacion_codigo): si el destino ya
        // tenía un negocio activo para este código, se desactiva ese duplicado.
        await pool.query(
          `UPDATE negocios SET activo = FALSE WHERE licitacion_codigo = ? AND asignado_a = ? AND activo = TRUE AND id <> ?`,
          [neg.licitacion_codigo, nuevo, id],
        );
        await pool.query(
          `UPDATE negocios SET asignado_a = ?, asignado_por = ?, updated_at = NOW() WHERE id = ?`,
          [nuevo, userId, id],
        );
        registrarActividad({
          usuarioId: userId, accion: 'asignacion',
          entidadTipo: 'negocio', entidadId: String(id),
          descripcion: `Reasignó "${neg.licitacion_nombre || neg.licitacion_codigo}" a otro usuario`,
          metadata: { licitacion_codigo: neg.licitacion_codigo, asignado_a: nuevo },
        });
        huboReasignacion = true;
        // Correo de (re)asignación al NUEVO responsable (best-effort, fire-and-forget).
        try {
          const [uRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [nuevo]);
          const nu = (uRows as any[])[0];
          const [aRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [userId]);
          const actor = (aRows as any[])[0];
          const actorNombre = actor?.nombre || actor?.email || 'Un administrador';
          // Campana en tiempo real al NUEVO responsable (no requiere email).
          registrarEvento({
            tipo: 'REASIGNACION',
            licitacionCodigo: neg.licitacion_codigo, licitacionNombre: neg.licitacion_nombre,
            usuarioId: nuevo, usuarioNombre: nu?.nombre || nu?.email || null,
            actorId: userId, actorNombre,
            mensaje: `${actorNombre} te asignó ${neg.licitacion_nombre || neg.licitacion_codigo}`,
            metadata: { licitacion_codigo: neg.licitacion_codigo, reasignacion: true },
          }).catch(() => {});
          if (nu?.email) {
            enviarCorreoAsignacion({
              to: nu.email, nombre: nu.nombre, codigo: neg.licitacion_codigo,
              licitacionNombre: neg.licitacion_nombre, organismo: neg.licitacion_organismo,
              monto: neg.licitacion_monto, cierre: neg.licitacion_cierre,
              actorNombre, reasignacion: true,
            }).catch(() => {});
          }
        } catch { /* no bloquear por notificación */ }
      }
    }

    // Actualizar etiquetas (solo admin)
    if (rol === 'admin' && Array.isArray(etiqueta_ids)) {
      await pool.query(`DELETE FROM negocios_etiquetas WHERE negocio_id = ?`, [id]);
      for (const eId of etiqueta_ids) {
        await pool.query(
          `INSERT IGNORE INTO negocios_etiquetas (negocio_id, etiqueta_id) VALUES (?, ?)`,
          [id, eId]
        );
      }
      // Nombres de las etiquetas para el historial
      let nombres: string[] = [];
      if (etiqueta_ids.length > 0) {
        const [etRows] = await pool.query(
          `SELECT nombre FROM etiquetas WHERE id IN (${etiqueta_ids.map(() => '?').join(',')})`,
          etiqueta_ids,
        );
        nombres = (etRows as any[]).map(r => r.nombre);
      }
      registrarActividad({
        usuarioId: userId, accion: 'cambio_etiqueta',
        entidadTipo: 'negocio', entidadId: String(id),
        descripcion: `Cambió las líneas de negocio de "${neg.licitacion_nombre || neg.licitacion_codigo}"${nombres.length ? ': ' + nombres.join(', ') : ' (sin líneas)'}`,
        metadata: { licitacion_codigo: neg.licitacion_codigo, etiquetas: nombres },
      });
      cambios.push({
        tipo: 'Líneas',
        detalle: nombres.length ? nombres.join(', ') : 'Sin líneas de negocio.',
      });
    }

    // Correo consolidado de cambios al perfil ASIGNADO. Se omite si:
    //  · no hubo cambios notificables (solo reasignación → ya se envió su propio correo),
    //  · quien hizo el cambio ES el propio asignado (no se auto-notifica),
    //  · el negocio no tiene un asignado con email.
    // Best-effort, fire-and-forget: nunca bloquea ni rompe la respuesta.
    if (cambios.length > 0 && !huboReasignacion && Number(neg.asignado_a) !== Number(userId)) {
      (async () => {
        try {
          const [aRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [userId]);
          const actor = (aRows as any[])[0];
          const actorNombre = actor?.nombre || actor?.email || 'Un administrador';
          const [uRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [neg.asignado_a]);
          const dest = (uRows as any[])[0];

          // Tipo de evento según el cambio dominante.
          const esDescarte = cambios.some(c => c.detalle.startsWith('Se descartó'));
          const tieneEstado = cambios.some(c => c.tipo === 'Estado');
          const tieneLineas = cambios.some(c => c.tipo === 'Líneas');
          const tipoEvento = esDescarte ? 'DESCARTE'
            : tieneEstado ? 'CAMBIO_ETAPA'
            : tieneLineas ? 'CAMBIO_ETIQUETA'
            : 'ACTUALIZACION';

          // Campana en tiempo real al perfil asignado (no requiere email).
          await registrarEvento({
            tipo: tipoEvento,
            licitacionCodigo: neg.licitacion_codigo, licitacionNombre: neg.licitacion_nombre,
            usuarioId: Number(neg.asignado_a), usuarioNombre: dest?.nombre || dest?.email || null,
            actorId: userId, actorNombre,
            mensaje: `${actorNombre}: ${cambios.map(c => c.detalle).join(' · ')}`.slice(0, 500),
            metadata: { licitacion_codigo: neg.licitacion_codigo, cambios },
          });

          // Correo consolidado — solo si el perfil tiene email.
          if (dest?.email) {
            await enviarCorreoCambio({
              to: dest.email, nombre: dest.nombre, codigo: neg.licitacion_codigo,
              licitacionNombre: neg.licitacion_nombre, organismo: neg.licitacion_organismo,
              monto: neg.licitacion_monto, cierre: neg.licitacion_cierre,
              actorNombre, cambios,
            });
          }
        } catch (e) { console.error('[negocios:PATCH] notificación de cambio falló:', String(e)); }
      })();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — desactivar negocio (solo admin)
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

  const { id } = await params;

  try {
    await pool.query(`UPDATE negocios SET activo = FALSE WHERE id = ?`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
