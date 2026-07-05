// app/lib/api-auth.ts
// Autenticación/locks/rate-limit para API Routes (runtime nodejs).
//
// DEFENSA EN PROFUNDIDAD: aunque proxy.ts (middleware) ya inyecta x-user-id/x-user-rol
// desde el JWT verificado, las rutas sensibles NO deben confiar solo en ese header.
// getAuthedUser() vuelve a verificar el JWT de la cookie dentro de la propia ruta,
// de modo que un eventual bypass del middleware no convierta el header en falsificable.

import { type NextRequest } from 'next/server';
import { getSessionFromRequest, type UsuarioSession } from '@/app/lib/auth-edge';
import pool from '@/app/lib/db';

/** Usuario autenticado verificando el JWT de la cookie (fuente de verdad). */
export async function getAuthedUser(req: NextRequest): Promise<UsuarioSession | null> {
  return getSessionFromRequest(req);
}

/** ¿Es admin? Verificado contra el JWT (no contra el header del cliente). */
export async function esAdmin(req: NextRequest): Promise<boolean> {
  const u = await getAuthedUser(req);
  return u?.rol === 'admin';
}

/** ¿Es trabajador externo? (rol restringido: solo sus licitaciones asignadas). */
export async function esExterno(req: NextRequest): Promise<boolean> {
  const u = await getAuthedUser(req);
  return u?.rol === 'externo';
}

/**
 * GUARD CENTRAL: ¿este usuario puede ver/operar ESTA licitación?
 *  · admin o quien tenga ver_otros_negocios → sí (acceso amplio).
 *  · externo → SOLO si la licitación está asignada a él (negocios.asignado_a).
 *  · usuario normal → se conserva su comportamiento actual (no se restringe aquí).
 * Evita que un externo abra `/licitacion/CUALQUIER-CODIGO` escribiendo la URL a mano.
 * Fail-closed para externo: ante error de BD, DENIEGA (no filtra licitaciones ajenas).
 */
export async function puedeVerLicitacion(req: NextRequest, codigo: string): Promise<boolean> {
  const u = await getAuthedUser(req);
  if (!u) return false;
  if (u.rol === 'admin') return true;
  const p = await permisosDeUsuario(u.id, u.rol);
  if (p.ver_otros_negocios) return true;
  if (u.rol !== 'externo') return true; // usuario normal: comportamiento previo intacto
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM negocios WHERE licitacion_codigo = ? AND asignado_a = ? AND activo = TRUE LIMIT 1`,
      [codigo, u.id],
    );
    return (rows as any[]).length > 0;
  } catch {
    return false; // fail-closed: sin certeza de asignación, no mostrar
  }
}

// ─── Permisos granulares ─────────────────────────────────────────────────────────
// El admin es "super": tiene TODOS los permisos implícitamente. Un usuario normal solo
// tiene los que el admin le haya otorgado (columna usuarios.permisos JSON). Catálogo:
//   ver_otros_negocios · acceso_radar · comentar_viabilidad · exportar
export type Permiso = 'ver_otros_negocios' | 'acceso_radar' | 'comentar_viabilidad' | 'exportar';
export type Permisos = Partial<Record<Permiso, boolean>>;
const PERMISOS_ADMIN: Record<Permiso, boolean> = {
  ver_otros_negocios: true, acceso_radar: true, comentar_viabilidad: true, exportar: true,
};

/** Lee los permisos efectivos de un usuario por id+rol. Admin → todos. Tolera columna ausente. */
export async function permisosDeUsuario(userId: number, rol?: string | null): Promise<Permisos> {
  if (rol === 'admin') return { ...PERMISOS_ADMIN };
  try {
    const [rows] = await pool.query('SELECT permisos FROM usuarios WHERE id = ? LIMIT 1', [userId]);
    const raw = (rows as any[])[0]?.permisos;
    if (!raw) return {};
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (p && typeof p === 'object') ? p : {};
  } catch {
    return {}; // columna aún no existe (migración pendiente) → sin permisos extra
  }
}

/** ¿El request tiene el permiso dado? (admin siempre sí). Verificado contra el JWT. */
export async function tienePermiso(req: NextRequest, permiso: Permiso): Promise<boolean> {
  const u = await getAuthedUser(req);
  if (!u) return false;
  if (u.rol === 'admin') return true;
  const p = await permisosDeUsuario(u.id, u.rol);
  return !!p[permiso];
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
