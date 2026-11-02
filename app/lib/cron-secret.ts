// app/lib/cron-secret.ts
// Comparación del CRON_SECRET en tiempo constante (con === la respuesta tarda distinto según cuántos caracteres coinciden).
// Falla CERRADO: si el secreto del servidor no está definido, nadie pasa.
import { createHash, timingSafeEqual } from 'node:crypto';

export function igualSecreto(recibido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recibido || !esperado) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(recibido), h(esperado));
}
