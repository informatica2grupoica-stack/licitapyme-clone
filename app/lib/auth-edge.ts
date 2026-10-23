// app/lib/auth-edge.ts
// ⚠️  SOLO funciones compatibles con Edge Runtime (middleware)
// NO importar next/headers aquí — no está disponible en Edge
import { jwtVerify, type JWTPayload } from 'jose';
import { type NextRequest } from 'next/server';

export const COOKIE_NAME = 'licitapyme_session';

export interface UsuarioSession {
  id: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario' | 'externo';
}

export interface TokenPayload extends JWTPayload {
  userId: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario' | 'externo';
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no configurado en variables de entorno');
  return new TextEncoder().encode(secret);
}

export async function verificarToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/** Usa en middleware — lee la cookie del objeto Request directamente */
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
