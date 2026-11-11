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
  /** Empresa-cliente (1 = Grupo ICA). Del JWT es solo una pista: la fuente de verdad es estadoVigente(). */
  clienteId?: number;
  /** Identificador de ESTA sesión (para poder cerrarla de verdad). Tokens viejos no lo traen. */
  jti?: string;
}

export interface TokenPayload extends JWTPayload {
  userId: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario' | 'externo';
  clienteId?: number;
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

/** Token de la petición: cookie (web) o `Authorization: Bearer` (app móvil). */
export function tokenDeRequest(req: NextRequest): string | undefined {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie) return cookie;
  const auth = req.headers.get('authorization');
  return auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() || undefined : undefined;
}

/** Usa en middleware — lee la cookie (o el Bearer de la app móvil) del objeto Request directamente */
export async function getSessionFromRequest(req: NextRequest): Promise<UsuarioSession | null> {
  const token = tokenDeRequest(req);
  if (!token) return null;
  const payload = await verificarToken(token);
  if (!payload) return null;
  return {
    id:      payload.userId,
    email:   payload.email,
    nombre:  payload.nombre,
    empresa: payload.empresa,
    rol:     payload.rol,
    clienteId: payload.clienteId,
    jti: payload.jti,
  };
}
