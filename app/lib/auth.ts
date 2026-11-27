// app/lib/auth.ts
// Utilidades de autenticación para Server Components y API Routes
// (NO usar en middleware — usa auth-edge.ts allí)
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';

// Re-exportar tipos comunes desde auth-edge (fuente única de verdad)
export type { UsuarioSession, TokenPayload } from '@/app/lib/auth-edge';
export { verificarToken, getSessionFromRequest, COOKIE_NAME } from '@/app/lib/auth-edge';

import type { UsuarioSession } from '@/app/lib/auth-edge';

// ============================================================
// CONSTANTES
// ============================================================

const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 días

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no configurado en variables de entorno');
  return new TextEncoder().encode(secret);
}

// ============================================================
// JWT
// ============================================================

export async function crearToken(usuario: UsuarioSession): Promise<string> {
  return new SignJWT({
    userId:  usuario.id,
    email:   usuario.email,
    nombre:  usuario.nombre,
    empresa: usuario.empresa,
    rol:     usuario.rol,
    clienteId: usuario.clienteId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${EXPIRY_SECONDS}s`)
    .sign(getSecret());
}

/** Entrega a quien cambió SU PROPIA clave una sesión nueva en esa respuesta (las anteriores se cierran). Con los datos de la BD. */
export async function renovarSesion(response: NextResponse, usuarioId: number): Promise<void> {
  const [rows] = await pool.query('SELECT id, email, nombre, empresa, rol, cliente_id FROM usuarios WHERE id = ? LIMIT 1', [usuarioId]);
  const u = (rows as Array<{ id: number; email: string; nombre: string | null; empresa: string | null; rol: UsuarioSession['rol']; cliente_id: number | null }>)[0];
  if (!u) return;
  const token = await crearToken({ id: u.id, email: u.email, nombre: u.nombre, empresa: u.empresa, rol: u.rol, clienteId: u.cliente_id ?? undefined });
  response.cookies.set('licitapyme_session', token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: EXPIRY_SECONDS, path: '/',
  });
}

// ============================================================
// COOKIES (Server Components / API Routes únicamente)
// ============================================================

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set('licitapyme_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: EXPIRY_SECONDS,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('licitapyme_session');
}

export async function getSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get('licitapyme_session')?.value;
}

// ============================================================
// OBTENER USUARIO DE LA SESIÓN (Server Components / API Routes)
// ============================================================

export async function getSession(): Promise<UsuarioSession | null> {
  const token = await getSessionCookie();
  if (!token) return null;
  const { verificarToken } = await import('@/app/lib/auth-edge');
  const payload = await verificarToken(token);
  if (!payload) return null;
  return {
    id:      payload.userId,
    email:   payload.email,
    nombre:  payload.nombre,
    empresa: payload.empresa,
    rol:     payload.rol,
    clienteId: payload.clienteId,
  };
}

// ============================================================
// RESPUESTA CON COOKIE (para API routes que hacen login)
// ============================================================

export async function respuestaConSession(
  usuario: UsuarioSession,
  datos: object,
  status = 200
): Promise<NextResponse> {
  const token = await crearToken(usuario);
  const response = NextResponse.json({ success: true, usuario, ...datos }, { status });
  response.cookies.set('licitapyme_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: EXPIRY_SECONDS,
    path: '/',
  });
  return response;
}
