// app/api/negocios/[id]/route.ts
// Detalle de un negocio: GET, PATCH (actualizar monto ofertado / etiquetas), DELETE (admin)
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';

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
              COALESCE(n.estado_pipeline, '1ASIGNADO') AS estado_pipeline,
              u.nombre AS usuario_nombre, u.email AS usuario_email,
              a.nombre AS admin_nombre
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a
       LEFT JOIN usuarios a ON a.id = n.asignado_por
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

    negocio.documentos = (docRows as any)[0] as any[];
    negocio.total_documentos = negocio.documentos.length;

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
    const { monto_ofertado, etiqueta_ids, estado_pipeline } = body;

    // Verificar acceso
    const [rows] = await pool.query(
      `SELECT asignado_a, licitacion_codigo, licitacion_nombre FROM negocios WHERE id = ?`, [id]
    ) as any;
    if (!(rows as any[]).length)
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const neg = (rows as any[])[0];
    if (rol !== 'admin' && neg.asignado_a !== userId)
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    // Actualizar monto
    if (monto_ofertado !== undefined) {
      await pool.query(
        `UPDATE negocios SET monto_ofertado = ? WHERE id = ?`,
        [monto_ofertado || 0, id]
      );
    }

    // Actualizar estado del pipeline (cualquier usuario asignado o admin)
    if (estado_pipeline !== undefined) {
      try {
        await pool.query(
          `UPDATE negocios SET estado_pipeline = ?, updated_at = NOW() WHERE id = ?`,
          [estado_pipeline || null, id]
        );
        registrarActividad({
          usuarioId: userId, accion: 'cambio_pipeline',
          entidadTipo: 'negocio', entidadId: String(id),
          descripcion: `Cambió el estado de "${neg.licitacion_nombre || neg.licitacion_codigo}" a ${estado_pipeline || '—'}`,
          metadata: { licitacion_codigo: neg.licitacion_codigo, estado_pipeline },
        });
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
