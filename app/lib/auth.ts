// app/lib/auth.ts
// Utilidades de autenticación: JWT con jose + bcrypt para contraseñas
// Sesión guardada en cookie HTTP-only (no accesible desde JS del browser)

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// CONSTANTES
// ============================================================

const COOKIE_NAME = 'licitapyme_session';
const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 días

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no configurado en variables de entorno');
  return new TextEncoder().encode(secret);
}

// ============================================================
// TIPOS
// ============================================================

export interface UsuarioSession {
  id: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario';
}

export interface TokenPayload extends JWTPayload {
  userId: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario';
}

// ============================================================
// JWT
// ============================================================

export async function crearToken(usuario: UsuarioSession): Promise<string> {
  const payload: TokenPayload = {
    userId: usuario.id,
    email:  usuario.email,
    nombre: usuario.nombre,
    empresa: usuario.empresa,
    rol:    usuario.rol,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRY_SECONDS}s`)
    .sign(getSecret());
}

export async function verificarToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

// ============================================================
// COOKIES (solo en Server Components / API Routes)
// ============================================================

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: EXPIRY_SECONDS,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value;
}

// ============================================================
// OBTENER USUARIO DE LA SESIÓN
// ============================================================

/** Usa en Server Components y API Routes para obtener la sesión actual */
export async function getSession(): Promise<UsuarioSession | null> {
  const token = await getSessionCookie();
  if (!token) return null;

  const payload = await verificarToken(token);
  if (!payload) return null;

  return {
    id:      payload.userId,
    email:   payload.email,
    nombre:  payload.nombre,
    empresa: payload.empresa,
    rol:     payload.rol,
  };
}

/** Usa en middleware (no puede usar cookies() de next/headers) */
export async function getSessionFromRequest(req: NextRequest): Promise<UsuarioSession | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verificarToken(token);
  if (!payload) return null;

  return {
    id:      payload.userId,
    email:   payload.email,
    nombre:  payload.nombre,
    empresa: payload.empresa,
    rol:     payload.rol,
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
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: EXPIRY_SECONDS,
    path: '/',
  });
  return response;
}
