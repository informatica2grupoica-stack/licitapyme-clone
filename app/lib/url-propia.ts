// app/lib/url-propia.ts
// ¿Esta URL apunta a NUESTRO bucket R2? Se valida el HOSTNAME real (no `includes` sobre la cadena:
// `http://169.254.169.254/?x=.r2.dev` pasaba el chequeo viejo y se descargaba directo = SSRF).
// Si devuelve false, el llamador cae al camino ya existente (/api/proxy, que filtra dominios).

export function esUrlR2Propia(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();

  if (host.endsWith('.r2.dev') || host.endsWith('.r2.cloudflarestorage.com')) return true;

  const cuenta = (process.env.R2_ACCOUNT_ID || '').toLowerCase();
  if (cuenta && host.split('.').includes(cuenta)) return true;

  const base = process.env.R2_PUBLIC_URL;
  if (base) {
    try { if (host === new URL(base).hostname.toLowerCase()) return true; } catch { /* base mal formada: ignorar */ }
  }
  return false;
}
