// app/api/compras/[negocioId]/sincronizar-obuma/route.ts
// POST: corre YA la misma sincronización que el cron de las 07:45 (compras de Obuma ↔ licitaciones), pero solo
// para la licitación de este negocio, para no esperar al día siguiente después de corregir algo en Obuma. Solo lee de Obuma y escribe en la copia local.
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { sincronizarComprasObuma } from '@/app/lib/obuma-compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Params = { params: Promise<{ negocioId: string }> };

async function __POST(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const resumen = await sincronizarComprasObuma({ paginas: 5, soloCodigo: asignacion.licitacionCodigo });
    return NextResponse.json({ success: true, resumen });
  } catch (error: any) {
    console.error('[compras/sincronizar-obuma][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo sincronizar con Obuma.' }, { status: 500 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
