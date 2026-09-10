// app/api/logistica/fleteros/route.ts
// Base de datos de fleteros (spec §13.3) — catálogo transversal a todos los negocios (no cuelga de
// una licitación puntual). Mismo círculo de acceso que Compras: admin, jefe de ventas o Encargado
// de Compras (permiso `compras`).
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { listarFleteros, crearFletero, type CategoriaFletero } from '@/app/lib/compras-logistica';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

async function puedeVerLogistica(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!(p.compras || p.aprobar_comercial);
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerLogistica(userId, rol))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const categoria = request.nextUrl.searchParams.get('categoria') as CategoriaFletero | null;
    const fleteros = await listarFleteros({ categoria: categoria || undefined });
    return NextResponse.json({ success: true, fleteros });
  } catch (error) {
    console.error('[logistica/fleteros][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el catálogo de fleteros.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerLogistica(userId, rol))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const body = await request.json();
    const id = await crearFletero(body, userId, nombre);
    const fleteros = await listarFleteros();
    return NextResponse.json({ success: true, id, fleteros });
  } catch (error: any) {
    console.error('[logistica/fleteros][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear el fletero.' }, { status: 400 });
  }
}
