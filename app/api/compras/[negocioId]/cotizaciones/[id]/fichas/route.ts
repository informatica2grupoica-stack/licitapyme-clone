// app/api/compras/[negocioId]/cotizaciones/[id]/fichas/route.ts
// «Leer specs»: revisa UNA cotización ya cargada y, si trae especificaciones técnicas, deja esos productos como ficha en Fichas técnicas.
// Es la misma revisión que se hace sola al subir una cotización nueva (compras-cotizacion-specs.ts), pero a pedido y sin el filtro por texto.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { fichasDesdeCotizacion } from '@/app/lib/compras-cotizacion-specs';
import { compartirEnVuelo } from '@/app/lib/en-vuelo';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type Params = { params: Promise<{ negocioId: string; id: string }> };

async function __POST(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id } = await params;
  const negId = parseInt(negocioId), cotId = parseInt(id);
  if (!Number.isFinite(negId) || !Number.isFinite(cotId)) return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    // Dos pulsaciones sobre la misma cotización comparten UNA sola lectura (cada lectura con IA puede tardar minutos).
    const r = await compartirEnVuelo(`fichas-cotizacion:${negId}:${cotId}`, () =>
      fichasDesdeCotizacion({ negocioId: negId, cotizacionId: cotId, actor: { id: userId, nombre: nombre || 'Compras' }, forzar: true }));
    const n = (x: string) => r.ruteo?.productos.filter(p => p.resultado === x).length ?? 0;
    return NextResponse.json({ success: true, hecho: r.hecho, motivo: r.motivo, asignadas: n('asignada'), porAsignar: n('por_confirmar') + n('sin_producto'), yaEstaban: n('ya_asignada'), soloPrecio: n('no_es_ficha') });
  } catch (error: any) {
    console.error('[compras/cotizaciones/fichas][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo leer la cotización como ficha.') }, { status: 500 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
