// app/lib/whatsapp.ts
// Cliente de Evolution API (WhatsApp por QR, vía NO oficial). Un número EMISOR por empresa: desde él salen los avisos al equipo.
// Solo servidor: la clave no sale de aquí. El texto viaja como JSON UTF-8 (emojis y tildes intactos).

const URL_BASE = () => (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const CLAVE = () => process.env.EVOLUTION_API_KEY || '';

export function whatsappConfigurado(): boolean {
  return !!(URL_BASE() && CLAVE());
}

/** Nombre de la instancia emisora de una empresa. Grupo ICA (1) conserva el nombre con el que ya se vinculó el número. */
export function instanciaEmisor(clienteId: number): string {
  return clienteId === 1 ? 'emisor-ica' : `emisor-c${clienteId}`;
}

export class WhatsappError extends Error {
  constructor(msg: string, public status = 502) { super(msg); }
}

async function evo<T = any>(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, cuerpo?: unknown, timeoutMs = 20000): Promise<T> {
  if (!whatsappConfigurado()) throw new WhatsappError('WhatsApp no está configurado en el servidor (falta EVOLUTION_API_URL / EVOLUTION_API_KEY)', 503);
  let res: Response;
  try {
    res = await fetch(`${URL_BASE()}${ruta}`, {
      method: metodo,
      headers: { apikey: CLAVE(), 'Content-Type': 'application/json; charset=utf-8' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch {
    throw new WhatsappError('No se pudo contactar el servicio de WhatsApp (¿está encendido?)', 503);
  }
  const texto = await res.text();
  let json: any = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    const detalle = json?.response?.message ?? json?.message ?? json?.error ?? texto.slice(0, 200);
    throw new WhatsappError(Array.isArray(detalle) ? detalle.join(' ') : String(detalle || `Error ${res.status}`), res.status);
  }
  return json as T;
}

export type EstadoConexion = 'open' | 'connecting' | 'close' | 'sin_instancia';

export async function estadoInstancia(nombre: string): Promise<EstadoConexion> {
  try {
    const r = await evo<any>('GET', `/instance/connectionState/${encodeURIComponent(nombre)}`);
    const s = r?.instance?.state ?? r?.state;
    return s === 'open' || s === 'connecting' || s === 'close' ? s : 'close';
  } catch (e) {
    if (e instanceof WhatsappError && e.status === 404) return 'sin_instancia';
    throw e;
  }
}

/** Número vinculado (ej. "56975491040") si la instancia está conectada. */
export async function numeroVinculado(nombre: string): Promise<string | null> {
  try {
    const r = await evo<any[]>('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(nombre)}`);
    const jid: string | undefined = r?.[0]?.ownerJid;
    return jid ? jid.split('@')[0].split(':')[0] : null;
  } catch { return null; }
}

/** Crea la instancia si falta y devuelve el QR (data URL PNG). Una instancia a medias (sin escanear) se recrea para tener un QR fresco. */
export async function conectarInstancia(nombre: string): Promise<{ qr: string | null; codigo: string | null }> {
  const estado = await estadoInstancia(nombre);
  if (estado === 'connecting' || estado === 'close') {
    await evo('DELETE', `/instance/delete/${encodeURIComponent(nombre)}`).catch(() => {});
  }
  if (estado !== 'open') {
    await evo('POST', '/instance/create', { instanceName: nombre, qrcode: true, integration: 'WHATSAPP-BAILEYS' }, 30000);
  }
  await new Promise(r => setTimeout(r, 2500)); // Evolution tarda un instante en tener el QR listo
  const r = await evo<any>('GET', `/instance/connect/${encodeURIComponent(nombre)}`, undefined, 30000);
  return { qr: r?.base64 ?? null, codigo: r?.pairingCode ?? null };
}

export async function cerrarSesion(nombre: string): Promise<void> {
  try { await evo('DELETE', `/instance/logout/${encodeURIComponent(nombre)}`); } catch (e) {
    if (!(e instanceof WhatsappError && (e.status === 404 || e.status === 400))) throw e;
  }
  try { await evo('DELETE', `/instance/delete/${encodeURIComponent(nombre)}`); } catch (e) {
    if (!(e instanceof WhatsappError && e.status === 404)) throw e;
  }
}

/** `numero` sin signos: "56977922875". */
export async function enviarTexto(nombre: string, numero: string, texto: string): Promise<void> {
  await evo('POST', `/message/sendText/${encodeURIComponent(nombre)}`, { number: numero.replace(/\D/g, ''), text: texto }, 30000);
}
