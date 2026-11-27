// app/lib/sesiones-revocadas.ts
// Sesiones cerradas (migration-191). El JWT dura 7 días; al cerrar sesión se anota su jti y desde ese momento el servidor lo rechaza.
// Solo runtime nodejs (usa pool). Fail-open ante error de BD o tabla ausente (igual que rol-vigente.ts): una caída de la base no deja a nadie fuera.
import pool from '@/app/lib/db';

const TTL_MS = 5_000;
let cache: { hasta: number; jtis: Set<string>; cortes: Map<number, number> } = { hasta: 0, jtis: new Set(), cortes: new Map() };
// Revocadas por ESTE proceso: rigen al tiro, sin esperar a la recarga de la caché.
const locales = new Set<string>();
const cortesLocales = new Map<number, number>();
// «Cerrar TODAS las sesiones de una persona» (cambio de clave): una fila `todas:<id>` cuya revocada_at es el corte. Sin migración.
const PREFIJO_TODAS = 'todas:';
const DURACION_TOKEN_S = 60 * 60 * 24 * 7;

/** ¿Esta sesión ya no vale? Por su jti («Salir») o porque se emitió ANTES del último cambio de clave de la persona (`iat` del token).
 *  Un token sin jti no se puede cerrar de a uno, pero sí cae con el cambio de clave. */
export async function sesionRevocada(jti: string | null | undefined, usuarioId?: number, iat?: number): Promise<boolean> {
  if (jti && locales.has(jti)) return true;
  if (cache.hasta <= Date.now()) {
    try {
      const [rows] = await pool.query('SELECT jti, usuario_id, UNIX_TIMESTAMP(revocada_at) AS corte FROM sesiones_revocadas WHERE expira_at > NOW()');
      const filas = rows as Array<{ jti: string; usuario_id: number; corte: number }>;
      cache = {
        hasta: Date.now() + TTL_MS,
        jtis: new Set(filas.map((r) => r.jti)),
        cortes: new Map(filas.filter((r) => r.jti.startsWith(PREFIJO_TODAS)).map((r) => [Number(r.usuario_id), Number(r.corte)])),
      };
    } catch {
      cache = { ...cache, hasta: Date.now() + TTL_MS };
    }
  }
  if (jti && cache.jtis.has(jti)) return true;
  if (!usuarioId) return false;
  const corte = Math.max(cortesLocales.get(usuarioId) ?? 0, cache.cortes.get(usuarioId) ?? 0);
  return corte > 0 && (iat ?? 0) < corte;   // «<»: la sesión nueva que se entrega en ese mismo segundo sigue valiendo
}

/** Cierra todas las sesiones emitidas hasta ahora para esa persona. Se llama al cambiar su clave. */
export async function cerrarSesionesDeUsuario(usuarioId: number): Promise<void> {
  const corte = Math.floor(Date.now() / 1000);
  cortesLocales.set(usuarioId, corte);
  cache.hasta = 0;
  try {
    await pool.query(
      `INSERT INTO sesiones_revocadas (jti, usuario_id, expira_at, revocada_at) VALUES (?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?))
       ON DUPLICATE KEY UPDATE expira_at = VALUES(expira_at), revocada_at = VALUES(revocada_at)`,
      [`${PREFIJO_TODAS}${usuarioId}`, usuarioId, corte + DURACION_TOKEN_S + 86_400, corte]);
  } catch (e) {
    console.error('[sesiones-revocadas] no se pudieron cerrar las sesiones:', String(e).slice(0, 200));
  }
}

/** Anota la sesión como cerrada hasta que el token venza por sí solo (`expSegundos` = campo exp del JWT). */
export async function revocarSesion(jti: string, usuarioId: number, expSegundos: number): Promise<void> {
  locales.add(jti);
  cache.hasta = 0;
  try {
    await pool.query('INSERT IGNORE INTO sesiones_revocadas (jti, usuario_id, expira_at) VALUES (?, ?, FROM_UNIXTIME(?))', [jti, usuarioId, expSegundos]);
    // Limpieza barata de las que ya vencieron (no hace falta guardarlas).
    await pool.query('DELETE FROM sesiones_revocadas WHERE expira_at < NOW() - INTERVAL 1 DAY');
  } catch (e) {
    console.error('[sesiones-revocadas] no se pudo anotar:', String(e).slice(0, 200));
  }
}
