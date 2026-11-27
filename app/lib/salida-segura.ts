// app/lib/salida-segura.ts
// CONEXIONES que el servidor abre hacia una máquina que ELIGIÓ UNA PERSONA y que no son un `fetch` (para eso está url-segura.ts):
// el navegador del Auditor y la cuenta de correo propia de una empresa (QA 2026-11-27, SSRF).
//
// Las dos cosas se resuelven igual: se resuelve el nombre, se exige que TODAS sus direcciones sean públicas y se conecta a la IP
// revisada (no se vuelve a preguntar el DNS, así un nombre no puede cambiar de IP entre la revisión y la conexión).
import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { esDireccionPrivada } from '@/app/lib/url-segura';

/** La IP a la que conectarse para ese nombre, o null si no existe o alguna de sus direcciones es interna. */
export async function ipPublicaDe(nombre: string): Promise<string | null> {
  const host = nombre.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return null;
  if (net.isIP(host)) return esDireccionPrivada(host) ? null : host;
  try {
    const dirs = await lookup(host, { all: true });
    if (!dirs.length || dirs.some(d => esDireccionPrivada(d.address))) return null;
    return (dirs.find(d => d.family === 4) ?? dirs[0]).address;
  } catch { return null; }
}

export const PUERTOS_SMTP = [25, 465, 587, 2525];

/** Cuenta de correo propia: solo puertos de correo y solo servidores públicos. Devuelve la IP a la que conectarse. */
export async function destinoSmtpPermitido(host: string, port: number): Promise<string> {
  if (!PUERTOS_SMTP.includes(port)) throw new Error(`Puerto de correo no permitido: usa ${PUERTOS_SMTP.join(', ')}.`);
  const ip = await ipPublicaDe(host);
  if (!ip) throw new Error('Ese servidor de correo no se puede usar: revisa que el nombre esté bien escrito.');
  return ip;
}

/**
 * Proxy local para el navegador: TODO lo que pide una página (la navegación, sus redirecciones, imágenes, scripts, ventanas
 * nuevas, websockets) pasa por aquí, y lo que apunte a una dirección interna se rechaza.
 */
export async function abrirProxySeguro(): Promise<{ puerto: number; cerrar: () => void }> {
  const abiertos = new Set<net.Socket>();
  const seguir = (s: net.Socket) => { abiertos.add(s); s.on('close', () => abiertos.delete(s)); s.on('error', () => s.destroy()); };

  // http:// → el navegador manda la dirección completa en la línea de la petición.
  const servidor = http.createServer(async (req, res) => {
    let u: URL;
    try { u = new URL(req.url || ''); } catch { res.writeHead(400).end(); return; }
    const ip = u.protocol === 'http:' ? await ipPublicaDe(u.hostname) : null;
    if (!ip) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Dirección no permitida'); return; }
    const cabeceras: http.OutgoingHttpHeaders = { ...req.headers, host: u.host };
    delete cabeceras['proxy-connection'];
    const salida = http.request({ host: ip, port: Number(u.port || 80), method: req.method, path: u.pathname + u.search, headers: cabeceras }, r => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    salida.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(salida);
  });
  servidor.on('connection', seguir);

  // https:// y wss:// → túnel CONNECT host:puerto.
  servidor.on('connect', async (req: http.IncomingMessage, cliente: net.Socket, resto: Buffer) => {
    const m = /^(.+):(\d+)$/.exec(req.url || '');
    const ip = m ? await ipPublicaDe(m[1]) : null;
    if (!m || !ip) { cliente.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const destino = net.connect(Number(m[2]), ip, () => {
      cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (resto.length) destino.write(resto);
      destino.pipe(cliente);
      cliente.pipe(destino);
    });
    seguir(destino);
    destino.on('close', () => cliente.destroy());
    cliente.on('close', () => destino.destroy());
  });

  await new Promise<void>((ok, mal) => { servidor.once('error', mal); servidor.listen(0, '127.0.0.1', () => ok()); });
  servidor.unref();
  return {
    puerto: (servidor.address() as net.AddressInfo).port,
    cerrar: () => { servidor.close(); for (const s of abiertos) s.destroy(); },
  };
}

/** Argumentos de Chromium para que no pueda salir por otro camino. `<-loopback>` quita la excepción que trae para localhost. */
export const argsConProxy = (puerto: number): string[] => [
  `--proxy-server=http://127.0.0.1:${puerto}`,
  '--proxy-bypass-list=<-loopback>',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-quic',
];
