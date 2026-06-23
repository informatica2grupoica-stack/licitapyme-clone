// app/api/radar/actualizar/route.ts
// Disparo MANUAL del cron de alertas desde el front (botón "Actualizar ahora").
//
// Por qué existe: /api/cron/alertas está en rutas públicas y se protege con
// CRON_SECRET (para cron-job.org). Antes el front mandaba ese secreto desde el
// navegador (NEXT_PUBLIC_CRON_SECRET + hardcode) → quedaba EXPUESTO en el bundle,
// permitiendo a cualquiera disparar el cron. Este endpoint, en cambio, está
// protegido por sesión (el proxy inyecta x-user-id/x-user-rol) y solo lo puede
// usar un admin; el secreto vive SOLO en el servidor (process.env.CRON_SECRET).

import { NextRequest, NextResponse } from 'next/server';
import { GET as ejecutarCron } from '@/app/api/cron/alertas/route';
import { getAuthedUser } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST (no GET): dispara un proceso pesado y muta datos; un GET sería vulnerable a
// disparo por navegación top-level (CSRF con sameSite=lax). Rol verificado vía JWT.
export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (usuario.rol !== 'admin') return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });

  const secret = process.env.CRON_SECRET || '';
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET no configurado en el servidor' }, { status: 503 });

  // Reusa el handler del cron pasándole el secreto del servidor (nunca sale al cliente).
  const cronReq = new NextRequest(new URL('/api/cron/alertas', request.url), {
    headers: { authorization: `Bearer ${secret}` },
  });
  return ejecutarCron(cronReq);
}
