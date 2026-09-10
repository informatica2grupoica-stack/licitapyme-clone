// app/api/compras/[negocioId]/entrega/route.ts
// Entrega del proyecto (spec §16). GET trae el estado completo. PATCH aplica una acción (body.accion):
// 'modalidad' | 'punto_agregar' | 'punto_quitar' | 'verificacion' | 'numeros' | 'generar_acta' |
// 'aprobar_acta' | 'firmar_acta' | 'firmar_guia'.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import {
  obtenerEntrega, definirModalidadEntrega, agregarPuntoEntrega, quitarPuntoEntrega,
  registrarVerificacion, registrarNumeros, generarActa, aprobarActa, firmarActa, firmarGuia,
  type ModalidadEntrega, type FirmaDatos,
} from '@/app/lib/compras-entrega';
import { puedeOperarCompras, puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
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

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    // GET amplio: bodega (§2.2) necesita ver el estado de la entrega para poder verificar — la
    // escritura de cada acción del PATCH sigue angosta, ver más abajo.
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const entrega = await obtenerEntrega(id);
    return NextResponse.json({ success: true, entrega });
  } catch (error) {
    console.error('[compras/entrega][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la entrega.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    const body = await request.json();

    // Todas las acciones son del encargado de compras/entrega — MENOS "verificacion" (§16.4), que
    // bodega (§2.2) también puede hacer aunque no sea el encargado del negocio. Deliberadamente NO
    // se usa `puedeVerCompras` acá: eso dejaría a bodega generar el acta o firmar la guía, que no
    // es su trabajo.
    const amplio = await puedeOperarCompras(userId, rol, asignacion.asignadoA);
    if (!amplio) {
      const esBodega = body.accion === 'verificacion' && !!(await permisosDeUsuario(userId, rol)).compras_bodega;
      if (!esBodega) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    }

    switch (body.accion) {
      case 'modalidad':
        await definirModalidadEntrega(id, body.modalidad as ModalidadEntrega, body.motivo || null); break;
      case 'punto_agregar':
        await agregarPuntoEntrega(id, body.direccion, body.comuna || null, body.contactoNombre || null, body.contactoTelefono || null); break;
      case 'punto_quitar':
        await quitarPuntoEntrega(id, Number(body.puntoId)); break;
      case 'verificacion':
        await registrarVerificacion(id, !!body.conforme, userId, nombre); break;
      case 'numeros':
        await registrarNumeros(id, body.notaVentaNumero || null, body.guiaDespachoNumero || null); break;
      case 'generar_acta':
        await generarActa(id, userId, nombre); break;
      case 'aprobar_acta':
        await aprobarActa(id, userId, nombre); break;
      case 'firmar_acta':
        await firmarActa(id, body.firma as FirmaDatos, body.conformidad, userId, nombre); break;
      case 'firmar_guia':
        await firmarGuia(id, body.firma as FirmaDatos, !!body.timbre, userId, nombre); break;
      default:
        return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
    }

    const entrega = await obtenerEntrega(id);
    return NextResponse.json({ success: true, entrega });
  } catch (error: any) {
    console.error('[compras/entrega][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar la entrega.' }, { status: 400 });
  }
}
