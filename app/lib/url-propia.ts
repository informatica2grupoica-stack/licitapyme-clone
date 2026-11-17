// app/lib/url-propia.ts
// ¿Esta URL apunta a NUESTRO bucket R2 o a Mercado Público? Se valida el HOSTNAME real (no `includes` sobre la cadena:
// `http://169.254.169.254/?x=.r2.dev` pasaba el chequeo viejo y se descargaba directo = SSRF).
// Si devuelve false, el llamador cae al camino ya existente (/api/proxy, que filtra dominios).
//
// Auditoría 2026-11-17 (SEC-001): antes se aceptaba cualquier host que CONTUVIERA el id de cuenta R2 (`<id>.sitio-ajeno.com`; el id no es
// secreto) y el fetch seguía redirecciones solo, así que un *.r2.dev ajeno podía redirigir a la red interna. Ahora el id de cuenta
// solo vale como `<id>.r2.cloudflarestorage.com` y toda descarga directa pasa por `fetchHostSeguro` (redirecciones a mano, host revalidado).

function hostDeUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return u.hostname.toLowerCase();
}

export function hostR2Propio(host: string): boolean {
  const h = host.toLowerCase();
  if (h.endsWith('.r2.dev') || h.endsWith('.r2.cloudflarestorage.com')) return true;
  const base = process.env.R2_PUBLIC_URL;
  if (base) {
    try { if (h === new URL(base).hostname.toLowerCase()) return true; } catch { /* base mal formada: ignorar */ }
  }
  return false;
}

export function hostMercadoPublico(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'mercadopublico.cl' || h.endsWith('.mercadopublico.cl');
}

export function esUrlR2Propia(url: string): boolean {
  const host = hostDeUrl(url);
  return !!host && hostR2Propio(host);
}

/** fetch para URLs que ya pasaron `esUrlR2Propia` o `hostMercadoPublico`: sigue hasta 3 redirecciones A MANO y exige que cada
 *  salto caiga en un host permitido (si no, lanza). Evita que un archivo en un `*.r2.dev` ajeno redirija a una dirección interna. */
export async function fetchHostSeguro(url: string, init: RequestInit = {}): Promise<Response> {
  let destino = new URL(url);
  for (let salto = 0; salto <= 3; salto++) {
    const host = destino.hostname.toLowerCase();
    if ((destino.protocol !== 'https:' && destino.protocol !== 'http:') || !(hostR2Propio(host) || hostMercadoPublico(host))) {
      throw new Error('Host no permitido');
    }
    const res = await fetch(destino.href, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const sig = res.headers.get('location');
    if (!sig) return res;
    destino = new URL(sig, destino);
  }
  throw new Error('Demasiadas redirecciones');
}
