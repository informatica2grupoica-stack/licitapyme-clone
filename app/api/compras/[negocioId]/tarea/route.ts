// app/api/compras/[negocioId]/tarea/route.ts
// MÓDULO DE COMPRAS — crea una tarea MANUAL fuera del catálogo (§5.1: "se crean tareas propias de
// cada proyecto fuera del catálogo").
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { crearTareaManual, obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const titulo = String(body.titulo || '').trim();
  if (!titulo) return NextResponse.json({ error: 'Falta el título de la tarea.' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) {
      return NextResponse.json({ error: 'Sin acceso a Compras de este negocio.' }, { status: 403 });
    }

    let responsableId: number | null = body.responsableId != null ? parseInt(body.responsableId) : asignacion.asignadoA;
    let responsableNombre: string | null = asignacion.asignadoNombre;
    if (responsableId != null && responsableId !== asignacion.asignadoA) {
      const [rows] = await pool.query('SELECT nombre FROM usuarios WHERE id = ? AND activo = TRUE LIMIT 1', [responsableId]) as any;
      responsableNombre = (rows as any[])[0]?.nombre || null;
      if (!responsableNombre) responsableId = null;
    }

    const tareaId = await crearTareaManual(id, {
      titulo: titulo.slice(0, 300),
      descripcion: body.descripcion ? String(body.descripcion).slice(0, 2000) : null,
      responsableId, responsableNombre, creadoPor: userId,
    });
    return NextResponse.json({ success: true, tareaId });
  } catch (error: any) {
    console.error('[compras/[negocioId]/tarea][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo crear la tarea.' }, { status: 500 });
  }
}
