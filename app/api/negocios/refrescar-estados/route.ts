// app/api/negocios/refrescar-estados/route.ts
// Refresco AUTORITATIVO on-demand del estado de Mercado Público para las licitaciones ASIGNADAS
// vivas (negocios). Reutiliza refrescarEstadosAsignadas (Capa 2): por cada código asignado no
// resuelto consulta la API de MP y, si el estado real es DEFINITIVO (Cerrada/Desierta/Adjudicada/
// Revocada/Suspendida) y difiere del cacheado, persiste `licitacion_estado` en negocios + alertas
// y notifica UNA vez si fue transición real. El front lo dispara en background, ACOTADO a cada 2h
// (throttle en cliente), así la vista de Negocios abre con lo cacheado y los badges se actualizan
// solos sin demorar la apertura. También lo usa el botón "Actualizar" para un pull manual.
import { NextRequest, NextResponse } from 'next/server';
import { refrescarEstadosAsignadas } from '@/app/lib/refrescar-estados';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // margen para el sondeo acotado a MP

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

  try {
    // Presupuesto/timeout más ajustados que el cron: es interactivo. Notifica en transición real
    // (el UPDATE atómico con guardia evita duplicar la campana aunque coincida con el cron).
    const r = await refrescarEstadosAsignadas({ presupuestoMs: 22_000, timeoutMs: 6_000, notificar: true });
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    console.error('[negocios/refrescar-estados] falló:', String(e));
    // No es crítico: el front seguirá mostrando el estado cacheado.
    return NextResponse.json({ success: false, error: 'No se pudo refrescar desde Mercado Público' }, { status: 200 });
  }
}
