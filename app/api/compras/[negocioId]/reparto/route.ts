// app/api/compras/[negocioId]/reparto/route.ts
// Proceso administrativo post-aprobación (spec §11) — el módulo solo registra el estado de hitos
// que EJECUTA OBUMA, nunca los dispara.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerReparto, marcarHitoReparto, type HitoReparto } from '@/app/lib/compras-reparto';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { permisosDeUsuario } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

// §11 es el perfil "administración (pagos y facturación)" de §2.2: puede operar ESTE checklist
// entero aunque no sea el encargado de compras/entrega del negocio. Deliberadamente NO incluye
// `compras_bodega` — bodega solo toca la verificación dentro de EntregaCard, no esto.
async function puedeOperarReparto(userId: number, rol: string | null, asignadoA: number | null): Promise<boolean> {
  if (await puedeOperarCompras(userId, rol, asignadoA)) return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!p.compras_administracion;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const reparto = await obtenerReparto(id);
    return NextResponse.json({ success: true, reparto });
  } catch (error) {
    console.error('[compras/reparto][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el proceso administrativo.' }, { status: 500 });
  }
}

const HITOS: HitoReparto[] = ['ocEmitida', 'pagoRegistrado', 'anticipoPagado', 'facturaCompraRegistrada', 'carpetaProyectoCreada', 'provisionFondos'];

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const hito = body.hito as HitoReparto;
    if (!HITOS.includes(hito)) return NextResponse.json({ error: 'Hito desconocido.' }, { status: 400 });

    await marcarHitoReparto(id, hito, {
      activo: !!body.activo,
      ocNumero: body.ocNumero, anticipoMonto: body.anticipoMonto,
      carpetaProyectoId: body.carpetaProyectoId, provisionFondosMonto: body.provisionFondosMonto, cuentaOrigen: body.cuentaOrigen,
    }, userId, nombre);

    const reparto = await obtenerReparto(id);
    return NextResponse.json({ success: true, reparto });
  } catch (error: any) {
    console.error('[compras/reparto][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar.' }, { status: 400 });
  }
}
