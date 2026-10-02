// app/lib/rol-vigente.ts
// El rol viaja dentro del JWT (7 días). Si un usuario cambia de rol (p. ej. pasa a admin) después de
// iniciar sesión, su token sigue diciendo el rol viejo hasta que vuelva a entrar. Esto lee el rol REAL
// desde la BD (caché de 30 s) para que el cambio de rol rija al tiro. Solo runtime nodejs (usa pool).
import pool from '@/app/lib/db';

type Rol = 'admin' | 'usuario' | 'externo';
const TTL_MS = 30_000;
const cache = new Map<number, { rol: Rol | null; activo: boolean; hasta: number }>();

/**
 * Rol y estado vigentes en BD. Un usuario DESACTIVADO (activo=0) no debe seguir entrando con un JWT
 * emitido antes (dura 7 días): se informa `activo:false` y proxy/getAuthedUser lo rechazan.
 * Fail-open ante error de BD (igual que antes): no se bloquea a nadie por una caída de la base.
 */
export async function estadoVigente(userId: number, rolToken: Rol): Promise<{ rol: Rol; activo: boolean }> {
  const c = cache.get(userId);
  if (c && c.hasta > Date.now()) return { rol: c.rol ?? rolToken, activo: c.activo };
  try {
    const [rows] = await pool.query('SELECT rol, activo FROM usuarios WHERE id = ? LIMIT 1', [userId]);
    const fila = (rows as any[])[0];
    const r = fila?.rol;
    const rol: Rol | null = r === 'admin' || r === 'usuario' || r === 'externo' ? r : null;
    const activo = fila ? !!fila.activo : true; // sin fila: se mantiene el comportamiento previo
    cache.set(userId, { rol, activo, hasta: Date.now() + TTL_MS });
    return { rol: rol ?? rolToken, activo };
  } catch {
    return { rol: rolToken, activo: true };
  }
}

/** Rol vigente en BD; si la BD falla o el usuario no existe, devuelve el del token. */
export async function rolVigente(userId: number, rolToken: Rol): Promise<Rol> {
  return (await estadoVigente(userId, rolToken)).rol;
}
