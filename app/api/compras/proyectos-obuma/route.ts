// app/api/compras/proyectos-obuma/route.ts
// GET — Vista "Proyectos" de Obuma: desde el hallazgo del 22-sep-2026 (ext-proyectos.list.json en
// v1.0, sin necesitar el access-url de v2.0), todo sale de la API real, en vivo, sin login. Ver
// app/lib/compras-proyectos-obuma.ts. Cacheado 5 min ahí mismo — `forzar=1` lo ignora.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { listarProyectosObuma } from '@/app/lib/compras-proyectos-obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

async function puedeVer(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial);
}

export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVer(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const forzar = request.nextUrl.searchParams.get('forzar') === '1';
    const proyectos = await listarProyectosObuma(forzar);
    return NextResponse.json({ success: true, proyectos });
  } catch (error: any) {
    console.error('[compras/proyectos-obuma][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
