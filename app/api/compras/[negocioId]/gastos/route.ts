// app/api/compras/[negocioId]/gastos/route.ts
// Registro de gastos reales del negocio (flete, horas extras, productos extra, etc. — pedido del
// usuario 09-sep-2026). GET lista + resumen por categoría. POST crea (multipart si trae comprobante,
// JSON si no). DELETE elimina uno (por si se registró por error).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { registrarGasto, listarGastos, resumenGastos, eliminarGasto, promoverCategoriaGasto, type DatosGasto } from '@/app/lib/compras-gastos';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { subirDocumentoR2 } from '@/app/lib/r2';

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

    const [gastos, resumen] = await Promise.all([listarGastos(id), resumenGastos(id)]);
    return NextResponse.json({ success: true, gastos, resumen });
  } catch (error) {
    console.error('[compras/gastos][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar los gastos.' }, { status: 500 });
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

    const contentType = request.headers.get('content-type') || '';
    let datos: DatosGasto;
    let categoriaLibre: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file') as File | null;
      let comprobanteUrl: string | null = null;
      if (file) {
        const buffer = Buffer.from(await file.arrayBuffer());
        comprobanteUrl = await subirDocumentoR2(`compras/${asignacion.licitacionCodigo}`, file.name, buffer, file.type);
      }
      categoriaLibre = (form.get('categoriaLibre') as string) || null;
      datos = {
        categoriaClave: (form.get('categoriaClave') as string) || null,
        descripcion: String(form.get('descripcion') || '').trim(),
        monto: Number(form.get('monto') || 0),
        moneda: (form.get('moneda') as string) || 'CLP',
        fechaGasto: (form.get('fechaGasto') as string) || null,
        comprobanteUrl,
        notas: (form.get('notas') as string) || null,
      };
    } else {
      const body = await request.json();
      categoriaLibre = body.categoriaLibre || null;
      datos = {
        categoriaClave: body.categoriaClave || null, descripcion: String(body.descripcion || '').trim(),
        monto: Number(body.monto || 0), moneda: body.moneda || 'CLP', fechaGasto: body.fechaGasto || null,
        comprobanteUrl: null, notas: body.notas || null,
      };
    }

    if (!datos.descripcion) return NextResponse.json({ error: 'Falta la descripción del gasto.' }, { status: 400 });
    if (!datos.monto || datos.monto <= 0) return NextResponse.json({ error: 'El monto tiene que ser mayor a 0.' }, { status: 400 });

    if (!datos.categoriaClave && categoriaLibre?.trim()) {
      datos.categoriaClave = await promoverCategoriaGasto(categoriaLibre).catch(() => null);
    }

    const gastoId = await registrarGasto(id, datos, userId, nombre);
    return NextResponse.json({ success: true, id: gastoId });
  } catch (error: any) {
    console.error('[compras/gastos][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar el gasto.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const gastoId = Number(searchParams.get('id'));
    if (!gastoId) return NextResponse.json({ error: 'Falta el id del gasto.' }, { status: 400 });

    await eliminarGasto(id, gastoId, userId, nombre);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/gastos][DELETE]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo eliminar el gasto.' }, { status: 400 });
  }
}
