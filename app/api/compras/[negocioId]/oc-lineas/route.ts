// app/api/compras/[negocioId]/oc-lineas/route.ts
// PATCH: «unidades para este negocio» de una línea de OC de Obuma (migration-184). Ej.: la OC 3811 trae 2 rodillos y solo se vende 1:
// se guarda 1 y el costo del negocio descuenta el otro. Solo cambia lo que cuenta Licitank; en Obuma no se toca nada.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { guardarUnidadesDelNegocio } from '@/app/lib/compras-oc-lineas-negocio';
import { sincronizarTrasCambioDeOc } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function __PATCH(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const compraOcId = String(body?.compraOcId ?? '').trim();
    const lineaId = String(body?.lineaId ?? '').trim();
    const cantidad = Number(body?.cantidadNegocio);
    const nota = typeof body?.nota === 'string' && body.nota.trim() ? body.nota.trim() : null;
    if (!compraOcId || !lineaId) return NextResponse.json({ error: 'Falta la orden de compra o la línea.' }, { status: 400 });
    if (body?.cantidadNegocio === '' || body?.cantidadNegocio == null || !Number.isFinite(cantidad)) return NextResponse.json({ error: 'Indica cuántas unidades son de este negocio.' }, { status: 400 });
    let r;
    try {
      r = await guardarUnidadesDelNegocio(id, compraOcId, lineaId, cantidad, nota, userId, request.headers.get('x-user-nombre'));
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'No se pudo guardar.' }, { status: 400 });   // errores de validación, escritos para mostrarse
    }
    await sincronizarTrasCambioDeOc(id);   // margen aprobado con el costo nuevo
    return NextResponse.json({ success: true, ...r });
  } catch (error: any) {
    console.error('[compras/oc-lineas][PATCH]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo guardar las unidades de este negocio.') }, { status: 500 });
  }
}

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
