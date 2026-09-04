// app/api/compras/[negocioId]/asignar/route.ts
// MÓDULO DE COMPRAS — asignación manual del encargado (§3.3). Solo jefe de ventas o admin; el
// fallback automático por vencimiento de plazo pasa por app/lib/compras.ts vía el cron, no por acá.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { asignarEncargado, obtenerAsignacion } from '@/app/lib/compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function esJefeDeVentas(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!p.aprobar_comercial;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esJefeDeVentas(userId, rol))) {
    return NextResponse.json({ error: 'Solo el jefe de ventas puede asignar Compras.' }, { status: 403 });
  }
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const encargadoId = parseInt(body.encargadoId);
  if (!Number.isFinite(encargadoId)) return NextResponse.json({ error: 'Falta encargadoId' }, { status: 400 });

  try {
    const existe = await obtenerAsignacion(id);
    if (!existe) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras.' }, { status: 404 });

    const [rows] = await pool.query('SELECT nombre FROM usuarios WHERE id = ? AND activo = TRUE LIMIT 1', [encargadoId]) as any;
    const encargadoNombre = (rows as any[])[0]?.nombre || null;
    if (!encargadoNombre) return NextResponse.json({ error: 'Ese usuario no existe o está inactivo.' }, { status: 400 });

    await asignarEncargado(id, encargadoId, encargadoNombre, userId);
    const actualizado = await obtenerAsignacion(id);
    return NextResponse.json({ success: true, asignacion: actualizado });
  } catch (error: any) {
    console.error('[compras/[negocioId]/asignar][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo asignar.' }, { status: 500 });
  }
}
