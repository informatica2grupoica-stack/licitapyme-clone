// app/api/compras/route.ts
// MÓDULO DE COMPRAS — listado transversal (pantalla /compras): un negocio ganado por fila, con su
// asignación (encargado, plazo de 3h hábiles, urgencia) y el avance de sus tareas. Toda la lógica
// vive en app/lib/compras.ts.
//
// Visible para: admin, jefe de ventas (permiso aprobar_comercial) y Encargado de Compras (permiso
// compras) — el mismo círculo que puede operar el módulo, no solo mirarlo.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { listarAsignacionesCompras, candidatosEncargado } from '@/app/lib/compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function puedeVerCompras(userId: number, rol: string | null): Promise<boolean> {
  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026 — ver el comentario largo en
  // app/api/compras/[negocioId]/route.ts): se lee con `permisosCrudosDeUsuario` (ignora el rol)
  // para que `compras`/`aprobar_comercial` no se auto-otorguen por ser admin, igual que ya pasa
  // con `compras_todo`.
  const p = await permisosCrudosDeUsuario(userId);
  // administración/bodega (§2.2) también entran al listado: necesitan llegar a SU negocio para
  // operar su sección angosta, aunque no sean el encargado de compras/entrega.
  return !!(p.compras_todo || p.compras || p.aprobar_comercial || p.compras_administracion || p.compras_bodega || p.compras_ver);
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
