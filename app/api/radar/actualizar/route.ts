// app/api/radar/actualizar/route.ts
// Disparo MANUAL del INTAKE (paso 1 de 3) desde el front (botón "Actualizar ahora").
// El botón orquesta las 3 fases del automático EN EL CLIENTE, secuencialmente y con
// progreso visible, porque hacerlas en una sola request tarda demasiado (el intake solo
// ya toma ~60s) y en Vercel el tope de duración cortaría la cadena. Cada fase es su
// propia llamada, dentro de límites, y reanudable:
//   Paso 1 (aquí)        → /api/radar/actualizar   → /api/cron/alertas (intake)
//   Paso 2 (front, loop) → /api/radar/enriquecer-pendientes (admin)
//   Paso 3 (front, loop) → /api/prefiltro/analizar-pendientes (sesión)
//
// Por qué existe: /api/cron/alertas se protege con CRON_SECRET (para cron-job.org). Antes
// el front mandaba ese secreto desde el navegador → quedaba EXPUESTO en el bundle. Este
// endpoint está protegido por SESIÓN (solo admin) y el secreto vive SOLO en el servidor.

import { NextRequest, NextResponse } from 'next/server';
import { GET as ejecutarIntake } from '@/app/api/cron/alertas/route';
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

  // Reusa el handler del cron de intake pasándole el secreto del servidor (nunca sale al cliente).
  const cronReq = new NextRequest(new URL('/api/cron/alertas', request.url), {
    headers: { authorization: `Bearer ${secret}` },
  });
  return ejecutarIntake(cronReq);
}
