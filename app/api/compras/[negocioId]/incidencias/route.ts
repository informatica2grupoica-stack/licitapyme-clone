// app/api/compras/[negocioId]/incidencias/route.ts
// Zona de incidencias (spec §9) — GET lista, POST abre (manual, defensiva u ofensiva simple; la
// Oportunidad de Mejora con su formulario propio va en /oportunidad-mejora).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarIncidencias, abrirIncidencia, type DatosIncidencia } from '@/app/lib/compras-incidencias';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const incidencias = await listarIncidencias(id);
    return NextResponse.json({ success: true, incidencias });
  } catch (error) {
    console.error('[compras/incidencias][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar las incidencias.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const datos: DatosIncidencia = {
      productoId: body.productoId ? Number(body.productoId) : null,
      naturaleza: body.naturaleza === 'OFENSIVA' ? 'OFENSIVA' : 'DEFENSIVA',
      tipoClave: body.tipoClave || null, tipoLibre: body.tipoLibre || null,
      descripcion: String(body.descripcion || ''),
    };
    const incidenciaId = await abrirIncidencia(id, datos, userId, nombre);
    const incidencias = await listarIncidencias(id);
    return NextResponse.json({ success: true, id: incidenciaId, incidencias });
  } catch (error: any) {
    console.error('[compras/incidencias][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo abrir la incidencia.' }, { status: 400 });
  }
}
