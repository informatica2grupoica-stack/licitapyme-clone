// app/api/compras/[negocioId]/proyecto-obuma/route.ts
// Proyectos reales de Obuma para vincular la «carpeta de proyecto» del negocio (pedido del dueño,
// 21-oct-2026). La API de Obuma no permite crear proyectos, así que solo se vincula uno existente.
// Lee el snapshot de listarProyectosObuma() (el mismo de la pantalla Proyectos), que ya cruza cada
// proyecto con los negocios que menciona — esos van como sugeridos.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarProyectosObuma } from '@/app/lib/compras-proyectos-obuma';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = parseInt(request.headers.get('x-user-id') || '');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarReparto(userId, request.headers.get('x-user-rol'), asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const { proyectos } = await listarProyectosObuma(false);
    const lista = proyectos
      .filter(p => p.tieneProyectoReal && p.folio != null)
      .map(p => ({
        folio: p.folio as number, nombre: p.nombre, referencia: p.referencia, cliente: p.cliente, estado: p.estado,
        sugerido: p.negociosCoincidentes.some(n => n.negocioId === id),
      }))
      .sort((a, b) => Number(b.sugerido) - Number(a.sugerido) || b.folio - a.folio);
    return NextResponse.json({ success: true, proyectos: lista });
  } catch (error) {
    console.error('[compras/proyecto-obuma][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron leer los proyectos de Obuma.' }, { status: 500 });
  }
}
