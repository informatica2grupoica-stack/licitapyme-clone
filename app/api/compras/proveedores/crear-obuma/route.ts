// app/api/compras/proveedores/crear-obuma/route.ts
// Crear un proveedor en Obuma desde el catálogo (/compras/proveedores), sin negocio de por medio.
// Escritura real, solo por el clic explícito de la persona. Mismo círculo de acceso que crear en el catálogo.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { crearProveedorEnObumaExplicito, datosProveedorDesdeBody, verificarProveedorEnObuma } from '@/app/lib/compras-oc-obuma';
import { obtenerOCrearProveedor, listarProveedores } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const id = request.headers.get('x-user-id');
  const userId = id ? parseInt(id) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const p = await permisosCrudosDeUsuario(userId);
  if (!(p.compras_todo || p.compras || p.aprobar_comercial)) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const datos = datosProveedorDesdeBody(await request.json());
    const existente = await verificarProveedorEnObuma(datos.rut);
    if (existente) return NextResponse.json({ error: `Ese RUT ya existe en Obuma: ${existente.razonSocial}. Usa "Sincronizar con Obuma" para traerlo.` }, { status: 409 });
    const resultado = await crearProveedorEnObumaExplicito(datos);
    // Lo deja también en el catálogo local, ya enlazado a la ficha de Obuma recién creada.
    await obtenerOCrearProveedor(datos.razonSocial, datos.rut, userId, request.headers.get('x-user-nombre')).catch(e => console.error('[proveedores/crear-obuma] catálogo local', String(e)));
    return NextResponse.json({ success: true, ...resultado, proveedores: await listarProveedores() });
  } catch (error: any) {
    console.error('[proveedores/crear-obuma][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear el proveedor.' }, { status: 400 });
  }
}
