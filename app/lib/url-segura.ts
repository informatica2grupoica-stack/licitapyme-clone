// app/lib/url-segura.ts
// GUARDIÁN ÚNICO para que el servidor baje una URL que escribió una persona (link de un producto, imagen, archivo «subido»).
// Sin esto, un link como http://169.254.169.254/… o http://licitapyme-db:3306 mandaba al servidor a leer algo INTERNO (SSRF) y el
// resultado terminaba en la IA o en la base de datos. Antes solo lo hacía la captura con navegador (auditor-compras-captura.ts).
//
// Límite conocido: se resuelve el DNS para revisar y `fetch` vuelve a resolverlo (un dominio que cambia de IP entre las dos
// consultas, «DNS rebinding»). Con las revisiones en cada salto y el tope de tamaño/tiempo queda en riesgo bajo; cerrarlo del todo
// exigiría un agente HTTP que fije la IP.
import { isIP } from 'node:net';

/** ¿Es una dirección que NO debe tocar el servidor? (loopback, redes privadas, link-local/metadata, CGNAT, multicast, IPv6 locales) */
export function esDireccionPrivada(ip: string): boolean {
  let a = ip.trim().toLowerCase();
  const mapeada = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);   // IPv4 disfrazada de IPv6
  if (mapeada) a = mapeada[1];
  const v = isIP(a);
  if (v === 4) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 || p >= 224
      || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)
      || (p === 100 && q >= 64 && q <= 127);           // 100.64/10: CGNAT
  }
  if (v === 6) return a === '::' || a === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(a) || /^::ffff:/.test(a);
  return true;                                          // no es una IP válida: no se arriesga
}

/** Dirección que el servidor puede bajar sin riesgo: http(s) y que ninguna de las IP a las que resuelve sea interna. */
export async function urlPublicaSegura(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (isIP(host)) return !esDireccionPrivada(host);
    const { lookup } = await import('node:dns/promises');
    const dirs = await lookup(host, { all: true });
    return dirs.length > 0 && dirs.every(d => !esDireccionPrivada(d.address));
  } catch { return false; }
}

const MAX_SALTOS = 4;

/** fetch para URLs que escribió una persona: revisa la URL y CADA redirección (a mano) con `urlPublicaSegura`. Lanza si alguna no es pública. */
export async function fetchSeguro(url: string, init: RequestInit = {}): Promise<Response> {
  let destino = url;
  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    if (!(await urlPublicaSegura(destino))) throw new Error('Esa dirección no se puede descargar desde el servidor.');
    const res = await fetch(destino, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const sig = res.headers.get('location');
    if (!sig) return res;
    destino = new URL(sig, destino).href;
  }
  throw new Error('Demasiadas redirecciones.');
}
