// app/api/cron/procesar-postuladas/route.ts
// Refresca el RESULTADO de las POSTULADAS cerradas: consulta MP (API oficial, no exige IP
// chilena), refresca adjudicacion_cache y auto-promueve a ADJUDICADA/PERDIDA avisando al perfil.
// Es lo que hace que el apartado Postuladas (que ahora lee SOLO cache) esté al día sin que el
// usuario espere nada al entrar.
//
// Pensado para el scheduler (cada 2h). Protección igual que los otros cron.
// GET  → healthcheck simple. POST → ejecuta una pasada.

import { NextRequest, NextResponse } from 'next/server';
import { procesarPostuladas } from '@/app/lib/procesar-postuladas';
import { repararContactosFaltantes, congelarPendientes } from '@/app/lib/congelamiento';
import { publicarCambio } from '@/app/lib/sse-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const t0 = Date.now();
  try {
    // promover:true (2026-07-21, reversa la decisión anterior de "quédense en Postuladas"):
    // el usuario confirmó con datos reales que sin promoción /analisis-licitacion (que lee el
    // acta directo) y /postuladas·/adjudicadas (que dependen más de estado_pipeline) mostraban
    // conteos distintos — 12 licitaciones YA ganadas por RUT seguían atascadas en POSTULADA.
    // soloCerradas:false → también refresca las Publicadas para el filtro por estado.
    const r = await procesarPostuladas({ promover: true, soloCerradas: false });
    // Refrescó el cache desde MP → avisar a los tableros abiertos para que repinten con el
    // resultado nuevo (Postuladas y Adjudicadas leen ese mismo cache).
    if (r.codigos > 0) publicarCambio('adjudicacion');

    // Repara paquetes de traspaso congelados sin contactos de cliente (MP caído al postular).
    // Best-effort y acotado: nunca rompe el cron.
    let contactos = { revisados: 0, reparados: 0 };
    try { contactos = await repararContactosFaltantes(20); }
    catch (e) { console.error('[cron postuladas] reparar contactos falló:', String(e).slice(0, 200)); }

    // Reconcilia POSTULADAs (o más allá) que se quedaron sin paquete congelado en Compras
    // porque el disparo original es fire-and-forget y traga errores. Best-effort.
    let congelamiento = { revisados: 0, congelados: 0 };
    try { congelamiento = await congelarPendientes(20); }
    catch (e) { console.error('[cron postuladas] reconciliar congelamiento falló:', String(e).slice(0, 200)); }

    // La cola son TODAS las que no tienen veredicto de MP. Una llamada solo alcanza a mirar un
    // lote (MP acepta ~1 consulta cada 2s), así que se expone `restantes` y el scheduler vuelve a
    // llamar hasta vaciarla — el orden por `consultado_en` garantiza que cada pasada tome las que
    // faltan, no las mismas. Antes se exponía `sinPresupuesto`, que solo contaba lo que quedaba
    // DENTRO del lote: con un lote más chico que la cola, daba `completado:true` con decenas de
    // licitaciones sin revisar y el loop del scheduler paraba de más.
    return NextResponse.json({
      success: true, ...r, contactosReparados: contactos.reparados,
      congelamientoReconciliado: congelamiento.congelados,
      completado: r.restantes === 0, pendientes: r.restantes,
      duracionMs: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
