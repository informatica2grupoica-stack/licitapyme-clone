// app/api/negocios/[id]/route.ts
// Detalle de un negocio: GET, PATCH (actualizar monto ofertado / etiquetas), DELETE (admin)
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

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
    const [rows] = await pool.query(
      `SELECT n.*,
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

    // Etiquetas del negocio
    const [etRows] = await pool.query(
      `SELECT e.id, e.nombre, e.color
       FROM negocios_etiquetas ne
       JOIN etiquetas e ON e.id = ne.etiqueta_id
       WHERE ne.negocio_id = ?`,
      [id]
    );
    negocio.etiquetas = etRows;

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
    const { monto_ofertado, etiqueta_ids } = body;

    // Verificar acceso
    const [rows] = await pool.query(
      `SELECT asignado_a FROM negocios WHERE id = ?`, [id]
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

    // Actualizar etiquetas (solo admin)
    if (rol === 'admin' && Array.isArray(etiqueta_ids)) {
      await pool.query(`DELETE FROM negocios_etiquetas WHERE negocio_id = ?`, [id]);
      for (const eId of etiqueta_ids) {
        await pool.query(
          `INSERT IGNORE INTO negocios_etiquetas (negocio_id, etiqueta_id) VALUES (?, ?)`,
          [id, eId]
        );
      }
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
