// app/api/negocios/[id]/comercial/costeo-editor/imagen/route.ts
// POST multipart { file } → sube la FOTO de un ítem del costeo a R2 y devuelve su URL pública.
// No toca el costeo: la URL queda en la fila (`imagenUrl`) recién cuando se aprieta «Guardar».
// Mismo gate que el resto de comercial/costeo-editor: admin, o el permiso `costeo_editor`.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerNegocioAsignado, permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarNegocio } from '../../route';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function POST(request: NextRequest, { params }: Params) {
  const idH = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  const userId = idH ? parseInt(idH) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin' && !(await permisosCrudosDeUsuario(userId)).costeo_editor)
    return NextResponse.json({ error: 'El costeo del sistema está habilitado solo para administradores o para quien tenga el permiso "Costeo — trabajarlo".' }, { status: 403 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a))) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id, rol)) return NextResponse.json({ error: 'Este negocio ya se postuló: el costeo quedó congelado, de solo lectura.' }, { status: 409 });

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Falta la imagen' }, { status: 400 });
    const ext = TIPOS[file.type];
    if (!ext) return NextResponse.json({ error: 'Sube una imagen PNG, JPG o WEBP.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'La imagen pesa más de 5 MB: achícala y vuelve a subirla.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await subirDocumentoR2(negocio.licitacion_codigo, `COSTEO_IMG_${negocio.id}.${ext}`, buffer, file.type);
    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error('[comercial/costeo-editor/imagen]', String(error));
    return NextResponse.json({ error: 'No se pudo subir la imagen' }, { status: 500 });
  }
}
