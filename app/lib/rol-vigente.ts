// app/lib/rol-vigente.ts
// El rol viaja dentro del JWT (7 días). Si un usuario cambia de rol (p. ej. pasa a admin) después de
// iniciar sesión, su token sigue diciendo el rol viejo hasta que vuelva a entrar. Esto lee el rol REAL
// desde la BD (caché de 30 s) para que el cambio de rol rija al tiro. Solo runtime nodejs (usa pool).
// Multi-cliente: junto con el rol se lee la EMPRESA (usuarios.cliente_id), que es la fuente de verdad del aislamiento.
import pool from '@/app/lib/db';

type Rol = 'admin' | 'usuario' | 'externo';
const TTL_MS = 30_000;
const cache = new Map<number, { rol: Rol | null; activo: boolean; clienteId: number | null; hasta: number }>();

/**
 * Rol y estado vigentes en BD. Un usuario DESACTIVADO (activo=0) no debe seguir entrando con un JWT
 * emitido antes (dura 7 días): se informa `activo:false` y proxy/getAuthedUser lo rechazan.
 * Fail-open ante error de BD (igual que antes): no se bloquea a nadie por una caída de la base.
 *
 * `clienteId`: empresa del usuario según la BD. Si la columna aún no existe (migración 164 pendiente) → 1 (Grupo ICA),
 * que es lo único que existe en ese momento. Si la BD falla por otra causa → el que traiga el token (`clienteToken`),
 * nunca "1" a ciegas: un cliente no debe caer en los datos de ICA por una caída de la base.
 */
export async function estadoVigente(
  userId: number, rolToken: Rol, clienteToken?: number,
): Promise<{ rol: Rol; activo: boolean; clienteId: number }> {
  const c = cache.get(userId);
  if (c && c.hasta > Date.now()) {
    const cid = c.clienteId ?? clienteToken ?? 1;
    return { rol: c.rol ?? rolToken, activo: c.activo, clienteId: cid };
  }
  try {
    let fila: any;
    try {
      const [rows] = await pool.query('SELECT rol, activo, cliente_id FROM usuarios WHERE id = ? LIMIT 1', [userId]);
      fila = (rows as any[])[0];
    } catch (e) {
      if ((e as { code?: string })?.code !== 'ER_BAD_FIELD_ERROR') throw e;
      const [rows] = await pool.query('SELECT rol, activo FROM usuarios WHERE id = ? LIMIT 1', [userId]);
      fila = (rows as any[])[0];
      if (fila) fila.cliente_id = 1; // aún no hay multi-cliente: todo es Grupo ICA
    }
    const r = fila?.rol;
    const rol: Rol | null = r === 'admin' || r === 'usuario' || r === 'externo' ? r : null;
    const activo = fila ? !!fila.activo : true; // sin fila: se mantiene el comportamiento previo
    const clienteId: number | null = fila?.cliente_id != null ? Number(fila.cliente_id) : null;
    cache.set(userId, { rol, activo, clienteId, hasta: Date.now() + TTL_MS });
    const cid = clienteId ?? clienteToken ?? 1;
    return { rol: rol ?? rolToken, activo, clienteId: cid };
  } catch {
    const cid = clienteToken ?? 1;
    return { rol: rolToken, activo: true, clienteId: cid };
  }
}

/** Rol vigente en BD; si la BD falla o el usuario no existe, devuelve el del token. */
export async function rolVigente(userId: number, rolToken: Rol): Promise<Rol> {
  return (await estadoVigente(userId, rolToken)).rol;
}
