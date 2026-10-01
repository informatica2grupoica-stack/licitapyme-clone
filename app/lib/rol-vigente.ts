// app/lib/rol-vigente.ts
// El rol viaja dentro del JWT (7 días). Si un usuario cambia de rol (p. ej. pasa a admin) después de
// iniciar sesión, su token sigue diciendo el rol viejo hasta que vuelva a entrar. Esto lee el rol REAL
// desde la BD (caché de 30 s) para que el cambio de rol rija al tiro. Solo runtime nodejs (usa pool).
import pool from '@/app/lib/db';

type Rol = 'admin' | 'usuario' | 'externo';
const TTL_MS = 30_000;
const cache = new Map<number, { rol: Rol | null; hasta: number }>();

/** Rol vigente en BD; si la BD falla o el usuario no existe/está inactivo, devuelve el del token. */
export async function rolVigente(userId: number, rolToken: Rol): Promise<Rol> {
  const c = cache.get(userId);
  if (c && c.hasta > Date.now()) return c.rol ?? rolToken;
  try {
    const [rows] = await pool.query('SELECT rol FROM usuarios WHERE id = ? LIMIT 1', [userId]);
    const r = (rows as any[])[0]?.rol;
    const rol: Rol | null = r === 'admin' || r === 'usuario' || r === 'externo' ? r : null;
    cache.set(userId, { rol, hasta: Date.now() + TTL_MS });
    return rol ?? rolToken;
  } catch {
    return rolToken;
  }
}
