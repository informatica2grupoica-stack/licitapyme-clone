// app/lib/api-auth.ts
// Autenticación/locks/rate-limit para API Routes (runtime nodejs).
//
// DEFENSA EN PROFUNDIDAD: aunque proxy.ts (middleware) ya inyecta x-user-id/x-user-rol
// desde el JWT verificado, las rutas sensibles NO deben confiar solo en ese header.
// getAuthedUser() vuelve a verificar el JWT de la cookie dentro de la propia ruta,
// de modo que un eventual bypass del middleware no convierta el header en falsificable.

import { type NextRequest } from 'next/server';
import { getSessionFromRequest, type UsuarioSession } from '@/app/lib/auth-edge';

/** Usuario autenticado verificando el JWT de la cookie (fuente de verdad). */
export async function getAuthedUser(req: NextRequest): Promise<UsuarioSession | null> {
  return getSessionFromRequest(req);
}

/** ¿Es admin? Verificado contra el JWT (no contra el header del cliente). */
export async function esAdmin(req: NextRequest): Promise<boolean> {
  const u = await getAuthedUser(req);
  return u?.rol === 'admin';
}

// ─── Lock distribuido + rate-limit (best-effort sobre Upstash Redis) ─────────────
// Si Redis no está configurado (p.ej. notebook sin Upstash), TODO degrada a permitir:
// nunca bloqueamos al usuario por falta de infraestructura opcional.

function redisDisponible(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Intenta tomar un lock con TTL. Devuelve true si lo tomó, false si ya estaba tomado.
 * Si Redis no está disponible o falla, devuelve true (no bloquea el flujo).
 */
export async function tomarLock(key: string, ttlSegundos = 300): Promise<boolean> {
  if (!redisDisponible()) return true;
  try {
    const { redis } = await import('@/app/lib/redis');
    // SET key value NX EX ttl → null si ya existía.
    const res = await redis.set(`lock:${key}`, '1', { nx: true, ex: ttlSegundos });
    return res === 'OK';
  } catch {
    return true; // ante fallo de infraestructura, no bloquear
  }
}

export async function liberarLock(key: string): Promise<void> {
  if (!redisDisponible()) return;
  try {
    const { redis } = await import('@/app/lib/redis');
    await redis.del(`lock:${key}`);
  } catch { /* best-effort */ }
}

/**
 * Rate-limit por ventana fija: máx `limite` peticiones por `ventanaSegundos`.
 * Devuelve true si la petición se permite. Si Redis no está disponible, permite.
 */
export async function permitido(key: string, limite: number, ventanaSegundos: number): Promise<boolean> {
  if (!redisDisponible()) return true;
  try {
    const { redis } = await import('@/app/lib/redis');
    const k = `rl:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, ventanaSegundos);
    return n <= limite;
  } catch {
    return true;
  }
}
