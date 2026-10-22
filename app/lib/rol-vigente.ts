// app/lib/rol-vigente.ts
// El rol viaja dentro del JWT (7 días). Si un usuario cambia de rol (p. ej. pasa a admin) después de
// iniciar sesión, su token sigue diciendo el rol viejo hasta que vuelva a entrar. Esto lee el rol REAL
// desde la BD (caché de 30 s) para que el cambio de rol rija al tiro. Solo runtime nodejs (usa pool).
// Lo mismo vale para el CLIENTE (multi-cliente, migration-164): se toma de la BD, no del token.
import pool from '@/app/lib/db';

type Rol = 'admin' | 'usuario' | 'externo';
const TTL_MS = 30_000;
interface Vigente { rol: Rol | null; activo: boolean; clienteId: number | null; esSuperadmin: boolean; hasta: number }
const cache = new Map<number, Vigente>();

export interface EstadoVigente { rol: Rol; activo: boolean; clienteId: number; esSuperadmin: boolean }

/**
 * Rol y estado vigentes en BD. Un usuario DESACTIVADO (activo=0) no debe seguir entrando con un JWT
 * emitido antes (dura 7 días): se informa `activo:false` y proxy/getAuthedUser lo rechazan.
 * También cuenta como desactivado el de un cliente que no está ACTIVO (suspendido o dado de baja).
 * Fail-open ante error de BD (igual que antes): no se bloquea a nadie por una caída de la base.
 * `clienteId`: el de la BD si se pudo leer; si no, el del token (firmado, no falsificable).
 */
export async function estadoVigente(userId: number, rolToken: Rol, clienteToken = 1): Promise<EstadoVigente> {
  const c = cache.get(userId);
  if (c && c.hasta > Date.now()) {
    return { rol: c.rol ?? rolToken, activo: c.activo, clienteId: c.clienteId ?? clienteToken, esSuperadmin: c.esSuperadmin };
  }
  try {
    const [rows] = await pool.query(
      `SELECT u.rol, u.activo, u.cliente_id, u.es_superadmin, c.estado AS cliente_estado
         FROM usuarios u LEFT JOIN clientes c ON c.id = u.cliente_id
        WHERE u.id = ? LIMIT 1`,
      [userId],
    );
    const fila = (rows as any[])[0];
    const r = fila?.rol;
    const rol: Rol | null = r === 'admin' || r === 'usuario' || r === 'externo' ? r : null;
    const clienteActivo = !fila || !fila.cliente_estado || fila.cliente_estado === 'ACTIVO';
    const activo = fila ? !!fila.activo && clienteActivo : true; // sin fila: se mantiene el comportamiento previo
    const clienteId: number | null = fila?.cliente_id != null ? Number(fila.cliente_id) : null;
    const esSuperadmin = !!fila?.es_superadmin;
    cache.set(userId, { rol, activo, clienteId, esSuperadmin, hasta: Date.now() + TTL_MS });
    return { rol: rol ?? rolToken, activo, clienteId: clienteId ?? clienteToken, esSuperadmin };
  } catch {
    return { rol: rolToken, activo: true, clienteId: clienteToken, esSuperadmin: false };
  }
}

/** Rol vigente en BD; si la BD falla o el usuario no existe, devuelve el del token. */
export async function rolVigente(userId: number, rolToken: Rol): Promise<Rol> {
  return (await estadoVigente(userId, rolToken)).rol;
}
