// app/api/cron/compras-asignacion/route.ts
// Cron frecuente (cada 15-30 min) del Módulo de Compras. Hace dos cosas, las dos del mismo tipo:
// lo que tiene que pasar solo, sin que nadie apriete nada.
//
//   1. §3.3 — Fallback de asignación: si venció el plazo de 3h hábiles y el jefe de ventas no
//      asignó encargado a mano, el sistema lo asigna al de menor carga.
//   2. §3.6 — La orden de compra del cliente: se busca en Mercado Público y se carga sola en la
//      ficha del negocio ganado, avisando al encargado.
//   3. Acta de evaluación (sep-2026): antes solo se traía si un admin la pedía a mano en
//      "Resultado". Se lee y descarga sola, de a 5 negocios por corrida, junto con el contacto de
//      la licitación que esa misma página trae (ver acta-adjudicacion.ts).
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
import { licitacionesEnComprasSinActa, traerActaAutomatico } from '@/app/lib/acta-adjudicacion';

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

    // El acta de evaluación (y el contacto de la licitación que trae, ver acta-adjudicacion.ts)
    // antes solo llegaba si un admin la pedía a mano en "Resultado". Se trae sola acá, de a pocas
    // por corrida — el cron vuelve a pasar en 15-30 min. Requiere IP chilena (igual que la OC de
    // arriba); si el servidor no la tiene, falla en silencio y sigue intentando en la próxima
    // corrida, nunca tumba el cron.
    let acta = { intentadas: 0, traidas: 0 };
    try {
      const pendientes = await licitacionesEnComprasSinActa(5);
      acta.intentadas = pendientes.length;
      for (const codigo of pendientes) {
        try {
          const res = await traerActaAutomatico(codigo);
          if (res.ok && res.documentos > 0) acta.traidas++;
        } catch (e: any) {
          console.warn(`[cron/compras-asignacion] acta de ${codigo} falló:`, String(e).slice(0, 150));
        }
      }
    } catch (e: any) {
      console.warn('[cron/compras-asignacion] búsqueda de actas pendientes falló:', String(e).slice(0, 150));
    }

    return NextResponse.json({ success: true, ...r, oc, acta, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
