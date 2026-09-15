// app/api/compras/proveedores/importar-obuma/route.ts
// Sincroniza el catálogo de /compras/proveedores con el catálogo REAL de Obuma (pedido explícito
// del usuario, 14-sep-2026) — acción consciente disparada por un botón, nunca automática.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { sincronizarProveedoresObuma, sincronizarHistorialOcHeaders, listarProveedores } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, nombre };
}

async function puedeVerProveedores(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial);
}

export async function POST(request: NextRequest) {
  const { id: userId, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    // Cabeceras de OC primero — llena el caché de comprasOcCompleto() que sincronizarProveedoresObuma
    // reusa enseguida para el resumen "le hemos comprado", sin pedirlo dos veces a Obuma.
    const historialOc = await sincronizarHistorialOcHeaders();
    const resultado = await sincronizarProveedoresObuma(userId, nombre);
    const proveedores = await listarProveedores();
    return NextResponse.json({ success: true, ...resultado, historialOc, proveedores });
  } catch (error: any) {
    console.error('[compras/proveedores/importar-obuma][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo sincronizar con Obuma.' }, { status: 500 });
  }
}
