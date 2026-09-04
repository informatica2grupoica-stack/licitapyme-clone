// app/api/cron/compras-asignacion/route.ts
// Cron frecuente (cada 15-30 min) del Módulo de Compras. Hace dos cosas, las dos del mismo tipo:
// lo que tiene que pasar solo, sin que nadie apriete nada.
//
//   1. §3.3 — Fallback de asignación: si venció el plazo de 3h hábiles y el jefe de ventas no
//      asignó encargado a mano, el sistema lo asigna al de menor carga.
//   2. §3.6 — La orden de compra del cliente: se busca en Mercado Público y se carga sola en la
//      ficha del negocio ganado, avisando al encargado.
//
// POR QUÉ LA OC VA ACÁ Y NO EN EL CRON DIARIO DE ÓRDENES: ese barre el listado completo de un día
// (~16.000 órdenes de todo Chile) porque la API no deja preguntar por una licitación concreta, y
// eso no se puede correr cada 20 minutos. La vía directa por proveedor sí: son 2 llamadas, una por
// empresa. Se usa esa (`soloProveedor`) para que la orden aparezca el mismo día que llega, y el
// cron diario sigue haciendo el barrido ancho que encuentra lo que la vía directa no ve.
//
// Protección igual que los demás cron: x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
import { NextRequest, NextResponse } from 'next/server';
import { asignacionAutomaticaFallback, engancharOrdenesCompraPendientes } from '@/app/lib/compras';
import { sincronizarOrdenesCompra } from '@/app/lib/ordenes-compra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const t0 = Date.now();
  try {
    const r = await asignacionAutomaticaFallback();
    if (r.asignadas > 0) {
      console.log(`[cron/compras-asignacion] ${r.asignadas} negocio(s) asignado(s) automáticamente por carga, de ${r.revisadas} vencido(s)`);
    }

    // La OC del cliente. Los dos pasos son independientes de la asignación: una orden puede llegar
    // antes de que nadie haya tomado el caso, y eso es justamente lo que hay que avisar rápido.
    // Ninguno de los dos puede tumbar el cron — el fallback de asignación ya corrió.
    let oc = { buscadas: 0, enganchadas: 0 };
    try {
      const sync = await sincronizarOrdenesCompra({ dias: 2, soloProveedor: true });
      oc.buscadas = sync.nuevas + sync.cambiosEstado;
    } catch (e: any) {
      console.warn('[cron/compras-asignacion] búsqueda de órdenes por proveedor falló:', String(e).slice(0, 150));
    }
    try {
      // Engancha también lo que ya estaba guardado de corridas anteriores (o de cuando la
      // licitación todavía no estaba abierta en Compras).
      oc.enganchadas = (await engancharOrdenesCompraPendientes(25)).enganchadas;
    } catch (e: any) {
      console.warn('[cron/compras-asignacion] enganche de órdenes falló:', String(e).slice(0, 150));
    }

    return NextResponse.json({ success: true, ...r, oc, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
