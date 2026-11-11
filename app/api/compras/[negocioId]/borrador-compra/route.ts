// app/api/compras/[negocioId]/borrador-compra/route.ts
// Borrador COMPARTIDO de «Elegir a quién comprar»: las marcas productoId → cotizacionId que se van poniendo antes de
// «Elegir esta compra». Todos los del negocio ven las mismas. No toca aprobaciones, SKU ni OC (eso es la compra oficial,
// que sigue en /escenarios). Ver migration-190.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarPreAprobacion, puedeVerPreAprobacion } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function leerSeleccion(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>)) { const p = Number(k), c = Number(v); if (Number.isInteger(p) && Number.isInteger(c)) out[p] = c; }
  return out;
}

async function contexto(request: NextRequest, params: Params['params'], operar: boolean) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  const ok = operar
    ? await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)
    : await puedeVerPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados);
  if (!ok) return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const c = await contexto(request, params, false);
    if ('error' in c) return c.error;
    const [rows] = await pool.query(
      `SELECT seleccion_json, actualizado_por, actualizado_por_nombre, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS at FROM compras_borrador_compra WHERE negocio_id = ?`, [c.id]) as any;
    const r = (rows as any[])[0];
    if (!r) return NextResponse.json({ success: true, seleccion: {}, por: null, nombre: null, at: null });
    return NextResponse.json({ success: true, seleccion: leerSeleccion(JSON.parse(r.seleccion_json)), por: r.actualizado_por, nombre: r.actualizado_por_nombre, at: r.at });
  } catch (error) {
    console.error('[compras/borrador-compra][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo leer el borrador.' }, { status: 500 });
  }
}

// PUT {seleccion} — reemplaza el borrador del negocio (vacío = lo borra).
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const c = await contexto(request, params, true);
    if ('error' in c) return c.error;
    const seleccion = leerSeleccion((await request.json())?.seleccion);
    if (Object.keys(seleccion).length === 0) {
      await pool.query(`DELETE FROM compras_borrador_compra WHERE negocio_id = ?`, [c.id]);
      return NextResponse.json({ success: true, at: null });
    }
    await pool.query(
      `INSERT INTO compras_borrador_compra (negocio_id, cliente_id, seleccion_json, actualizado_por, actualizado_por_nombre, updated_at)
       VALUES (?, COALESCE((SELECT cliente_id FROM negocios WHERE id = ?), 1), ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE seleccion_json = VALUES(seleccion_json), actualizado_por = VALUES(actualizado_por),
         actualizado_por_nombre = VALUES(actualizado_por_nombre), updated_at = VALUES(updated_at)`,
      [c.id, c.id, JSON.stringify(seleccion), c.userId, c.nombre]);
    const [rows] = await pool.query(`SELECT DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS at FROM compras_borrador_compra WHERE negocio_id = ?`, [c.id]) as any;
    return NextResponse.json({ success: true, at: (rows as any[])[0]?.at ?? null });
  } catch (error) {
    console.error('[compras/borrador-compra][PUT]', String(error));
    return NextResponse.json({ error: 'No se pudo guardar el borrador.' }, { status: 500 });
  }
}
