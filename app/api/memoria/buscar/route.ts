// app/api/memoria/buscar/route.ts
// Frente F.3 — "¿ya vendimos esto antes?".
//
// Es la consulta que le da valor a la memoria: se usa desde el costeo (Frente D) para partir de
// un precio real en vez de una hoja en blanco, y desde el análisis para saber si el producto ya
// está en la mano.
//
// NO devuelve recomendaciones ni veredictos, solo hechos con su respaldo (qué OC, de qué fecha,
// para qué entidad). El histórico orienta, no decide — el análisis de viabilidad manda siempre.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { buscarProductoEnMemoria } from '@/app/lib/memoria-historica';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol === 'externo') return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 3) return NextResponse.json({ coincidencias: [], resumen: null });

  const limite = Number(req.nextUrl.searchParams.get('limite')) || 20;
  try {
    const coincidencias = await buscarProductoEnMemoria(q, limite);

    // Resumen de precios: sirve para "partir desde acá" en el costeo. La MEDIANA y no el
    // promedio, porque una sola compra atípica (un equipo grande entre diez repuestos) arrastra
    // el promedio y daría un punto de partida engañoso.
    const precios = coincidencias.map(c => c.precioUnitario).filter((p): p is number => p != null && p > 0).sort((a, b) => a - b);
    const resumen = precios.length === 0 ? null : {
      veces: coincidencias.length,
      conPrecio: precios.length,
      min: precios[0],
      max: precios[precios.length - 1],
      mediana: precios.length % 2
        ? precios[(precios.length - 1) / 2]
        : Math.round((precios[precios.length / 2 - 1] + precios[precios.length / 2]) / 2),
      ultimaFecha: coincidencias.find(c => c.ocFecha)?.ocFecha ?? null,
    };

    return NextResponse.json({ coincidencias, resumen });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
