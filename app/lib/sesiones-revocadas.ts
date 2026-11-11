// app/lib/sesiones-revocadas.ts
// Sesiones cerradas (migration-191). El JWT dura 7 días; al cerrar sesión se anota su jti y desde ese momento el servidor lo rechaza.
// Solo runtime nodejs (usa pool). Fail-open ante error de BD o tabla ausente (igual que rol-vigente.ts): una caída de la base no deja a nadie fuera.
import pool from '@/app/lib/db';

const TTL_MS = 5_000;
let cache: { hasta: number; jtis: Set<string> } = { hasta: 0, jtis: new Set() };
// Revocadas por ESTE proceso: rigen al tiro, sin esperar a la recarga de la caché.
const locales = new Set<string>();

/** ¿Esta sesión (jti del token) ya fue cerrada? Un token sin jti (emitido antes de la migración) no se puede revocar: devuelve false. */
export async function sesionRevocada(jti: string | null | undefined): Promise<boolean> {
  if (!jti) return false;
  if (locales.has(jti)) return true;
  if (cache.hasta <= Date.now()) {
    try {
      const [rows] = await pool.query('SELECT jti FROM sesiones_revocadas WHERE expira_at > NOW()');
      cache = { hasta: Date.now() + TTL_MS, jtis: new Set((rows as Array<{ jti: string }>).map((r) => r.jti)) };
    } catch {
      cache = { hasta: Date.now() + TTL_MS, jtis: cache.jtis };
    }
  }
  return cache.jtis.has(jti);
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
