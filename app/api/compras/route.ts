// app/api/compras/route.ts
// MÓDULO DE COMPRAS — listado transversal (pantalla /compras): un negocio ganado por fila, con su
// asignación (encargado, plazo de 3h hábiles, urgencia) y el avance de sus tareas. Toda la lógica
// vive en app/lib/compras.ts.
//
// Visible para: admin, jefe de ventas (permiso aprobar_comercial) y Encargado de Compras (permiso
// compras) — el mismo círculo que puede operar el módulo, no solo mirarlo.
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { listarAsignacionesCompras, candidatosEncargado } from '@/app/lib/compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function puedeVerCompras(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!(p.compras || p.aprobar_comercial);
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerCompras(userId, rol))) return NextResponse.json({ error: 'Sin acceso a Compras.' }, { status: 403 });

  try {
    const [filas, candidatos] = await Promise.all([listarAsignacionesCompras(), candidatosEncargado()]);
    return NextResponse.json({ success: true, negocios: filas, candidatos });
  } catch (error: any) {
    console.error('[compras][GET]', String(error));
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json({ success: true, negocios: [], migracionPendiente: true });
    }
    return NextResponse.json({ error: 'No se pudo cargar Compras.' }, { status: 500 });
  }
}
