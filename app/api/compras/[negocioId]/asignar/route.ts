// app/api/compras/[negocioId]/asignar/route.ts
// MÓDULO DE COMPRAS — asignación manual del encargado (§3.3). Solo jefe de ventas o admin; el
// fallback automático por vencimiento de plazo pasa por app/lib/compras.ts vía el cron, no por acá.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { asignarEncargado, obtenerAsignacion } from '@/app/lib/compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026 — ver el comentario largo en
// app/api/compras/[negocioId]/route.ts): se lee con `permisosCrudosDeUsuario` para que
// `aprobar_comercial` no se auto-otorgue por ser admin. `compras_todo` también habilita asignar —
// es "ve/opera TODO el módulo", que incluye esto.
async function esJefeDeVentas(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.aprobar_comercial);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const encargadoId = parseInt(body.encargadoId);
  if (!Number.isFinite(encargadoId)) return NextResponse.json({ error: 'Falta encargadoId' }, { status: 400 });

  try {
    const existe = await obtenerAsignacion(id);
    if (!existe) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras.' }, { status: 404 });

    // Pedido explícito del usuario, 15-sep-2026: CAMBIAR un encargado que ya tiene otro asignado
    // es cosa de admin — solo la asignación INICIAL (negocio recién entrando a Compras, sin nadie
    // encima) sigue habilitada para el jefe de ventas.
    if (existe.asignadoA != null) {
      if (rol !== 'admin') {
        return NextResponse.json({ error: 'Solo un admin puede cambiar al encargado de Compras.' }, { status: 403 });
      }
    } else if (!(await esJefeDeVentas(userId))) {
      return NextResponse.json({ error: 'Solo el jefe de ventas puede asignar Compras.' }, { status: 403 });
    }

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
