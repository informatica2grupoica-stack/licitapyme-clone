// app/api/negocios/[id]/comercial/[itemId]/producto-imagen/route.ts
// Reemplazo MANUAL de la foto del producto ofertado — hermana de .../caracteristicas/route.ts
// (que trae la foto automática al comparar la ficha, ver ficha-imagen-extraer.ts).
//
//   POST (multipart, campo "file") → sube la foto a R2 y la deja CONFIRMADA (subirla a mano ya
//        es la revisión — mismo criterio que confirmar_producto: lo que hace una persona manda).
//
// Ruta aparte porque el resto de acciones de la línea viajan como JSON y esta necesita
// multipart/form-data para el archivo (mismo patrón que app/api/empresas/[id]/documentos/route.ts).
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { yaCongelado } from '@/app/lib/congelamiento';
import { publicarCambio } from '@/app/lib/sse-bus';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { confirmarImagenProducto } from '@/app/lib/producto-ofertado-db';
import { cargarNegocio } from '../../route';
import { cargarItemLineaTecnica, productosDeItem } from '../caracteristicas/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; itemId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

const TIPOS_ACEPTADOS = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TAMANO_MAX = 8_000_000; // 8 MB — de sobra para una foto de producto, corta un adjunto errado

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
    if (!TIPOS_ACEPTADOS.has(file.type))
      return NextResponse.json({ error: 'La foto debe ser PNG, JPG o WEBP.' }, { status: 400 });
    if (file.size > TAMANO_MAX)
      return NextResponse.json({ error: 'La foto es demasiado grande (máximo 8 MB).' }, { status: 400 });
    // 0 por defecto: la línea normal de un solo producto. Una línea-paquete (migración 82) manda
    // el índice del producto al que le está subiendo la foto.
    const productoIndexRaw = Number(formData.get('productoIndex'));
    const productoIndex = Number.isInteger(productoIndexRaw) && productoIndexRaw >= 0 ? productoIndexRaw : 0;

    const buffer = Buffer.from(await file.arrayBuffer());
    const nombre = `producto_linea${item.id}_${productoIndex}_manual.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
    const url = await subirDocumentoR2(negocio.licitacion_codigo, nombre, buffer, file.type);

    await confirmarImagenProducto({ itemId: item.id, negocioId: negocio.id, productoIndex, imagenUrl: url });
    publicarCambio('checklist_comercial');

    return NextResponse.json({ success: true, productos: await productosDeItem(item, negocio.licitacion_codigo) });
  } catch (error) {
    console.error('[comercial][producto-imagen][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
