// app/api/compras/proveedores/[id]/guardar-obuma/route.ts
// Envía a Obuma los datos de contacto que la persona corrigió en la ficha de Licitank (proveedores.update.json).
// Escritura real, solo por el clic explícito. Banco y cuenta NO se envían: la API de Obuma no los guarda.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { obtenerProveedor } from '@/app/lib/compras-proveedores';
import { actualizarProveedorObuma } from '@/app/lib/obuma';
import { registrarEvento } from '@/app/lib/historial';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const idHeader = request.headers.get('x-user-id');
  const userId = idHeader ? parseInt(idHeader) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const p = await permisosCrudosDeUsuario(userId);
  if (!(p.compras_todo || p.compras || p.aprobar_comercial)) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  const { id } = await params;
  const proveedorId = parseInt(id);
  if (!Number.isFinite(proveedorId)) return NextResponse.json({ error: 'Proveedor inválido.' }, { status: 400 });

  try {
    const prov = await obtenerProveedor(proveedorId);
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado.' }, { status: 404 });
    if (!prov.obumaProveedorId) return NextResponse.json({ error: 'Este proveedor no está enlazado a Obuma: créalo en Obuma o usa «Sincronizar con Obuma».' }, { status: 400 });

    const r = await actualizarProveedorObuma(prov.obumaProveedorId, {
      contacto: prov.contactoNombre, telefono: prov.telefono, email: prov.correo,
      direccion: prov.direccion, comuna: prov.comuna, region: prov.region, giro: prov.giro,
    });
    await registrarEvento({
      tipo: 'COMPRAS_PROVEEDOR_ENVIADO_OBUMA', actorId: userId, actorNombre: request.headers.get('x-user-nombre'),
      mensaje: `Se enviaron a Obuma los datos de contacto de "${prov.nombreEmpresa}" (${r.guardados.length} campo(s) guardado(s)).`,
      metadata: { proveedor_id: proveedorId, ...r },
    });
    return NextResponse.json({ success: true, ...r });
  } catch (error: any) {
    console.error('[compras/proveedores/guardar-obuma][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo guardar en Obuma.') }, { status: 400 });
  }
}
