// app/api/auth/logout/route.ts
// Cierra la sesión de verdad: borra la cookie (web) y anota el jti del token (web o app móvil) para que el servidor lo rechace
// aunque alguien lo haya copiado (migration-191). Solo revoca ESTA sesión, no las otras del mismo usuario.
import { NextRequest, NextResponse } from 'next/server';
import { tokenDeRequest, verificarToken } from '@/app/lib/auth-edge';
import { revocarSesion } from '@/app/lib/sesiones-revocadas';

export async function POST(request: NextRequest) {
  try {
    const token = tokenDeRequest(request);
    const payload = token ? await verificarToken(token) : null;
    if (payload?.jti && payload.userId && payload.exp) await revocarSesion(payload.jti, Number(payload.userId), Number(payload.exp));
  } catch (e) {
    console.error('[logout] no se pudo revocar la sesión:', String(e).slice(0, 200)); // nunca impide cerrar sesión
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set('licitapyme_session', '', { maxAge: 0, path: '/' });
  return response;
}
