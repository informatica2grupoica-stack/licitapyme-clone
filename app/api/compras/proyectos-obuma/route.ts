// app/api/compras/proyectos-obuma/route.ts
// GET — Vista "Proyectos" de Obuma, v1-only (ver compras-proyectos-obuma.ts para el porqué no es
// el Proyecto real de v2.0). Llama a Obuma en vivo (centros de costo + OC completo, ambos
// cacheados unos minutos del lado de obuma.ts) — acción consciente de quien abre la página, no un
// autoload silencioso en cada pantalla de Compras.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { listarProyectosObuma, listarProyectosRealesObuma } from '@/app/lib/compras-proyectos-obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
    const [proyectos, reales] = await Promise.all([
      listarProyectosObuma(forzar),
      listarProyectosRealesObuma(),
    ]);
    return NextResponse.json({ success: true, proyectos, proyectosReales: reales.proyectos, capturadoAt: reales.capturadoAt });
  } catch (error: any) {
    console.error('[compras/proyectos-obuma][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
