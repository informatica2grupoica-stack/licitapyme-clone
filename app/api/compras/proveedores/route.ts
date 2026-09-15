// app/api/compras/proveedores/route.ts
// Catálogo de proveedores — transversal, mismo círculo de acceso que el resto de Compras.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { listarProveedores, crearProveedor, validarProveedorObuma } from '@/app/lib/compras-proveedores';
import { historicoProveedorPorRut } from '@/app/lib/compras-aprendizaje';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

// "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026 — ver el comentario largo en
// app/api/compras/[negocioId]/route.ts): mismo círculo que el resto de Compras, leído con
// `permisosCrudosDeUsuario` para que ningún flag se auto-otorgue por ser admin.
async function puedeVerProveedores(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial);
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    // Histórico de compras a ESTE proveedor en OBUMA por RUT (pedido explícito del usuario: avisar
    // "ojo, ya le compramos antes a este proveedor" al registrar una cotización) — separado del
    // listado normal, mismo criterio que `?rutObuma=` en fleteros.
    const historicoRut = request.nextUrl.searchParams.get('historicoRut');
    if (historicoRut) {
      const historico = await historicoProveedorPorRut(historicoRut);
      return NextResponse.json({ success: true, historico });
    }

    // "Todo lo que ingresemos debe estar validado" (pedido explícito del usuario, 14-sep-2026): a
    // diferencia de `historicoRut` (que solo dice si YA le compramos algo), esto responde la
    // pregunta previa — ¿este RUT siquiera EXISTE en Obuma? — para avisar ANTES de guardar si se va
    // a crear una ficha nueva.
    const validarRut = request.nextUrl.searchParams.get('validarRut');
    if (validarRut) {
      const validacion = await validarProveedorObuma(validarRut);
      return NextResponse.json({ success: true, validacion });
    }

    const q = request.nextUrl.searchParams.get('q') || undefined;
    const categoria = request.nextUrl.searchParams.get('categoria') || undefined;
    const proveedores = await listarProveedores({ q, categoria });
    return NextResponse.json({ success: true, proveedores });
  } catch (error) {
    console.error('[compras/proveedores][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el catálogo de proveedores.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const body = await request.json();
    const id = await crearProveedor(body, userId, nombre);
    const proveedores = await listarProveedores();
    return NextResponse.json({ success: true, id, proveedores });
  } catch (error: any) {
    console.error('[compras/proveedores][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear el proveedor.' }, { status: 400 });
  }
}
