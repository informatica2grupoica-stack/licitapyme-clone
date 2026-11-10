// app/lib/integraciones-cliente.ts
// CUENTAS EXTERNAS POR CLIENTE (multiempresa, Etapa 2 — docs/memoria/multiempresa.md, migration-186).
// Cada empresa-cliente puede poner su propio ticket de Mercado Público y su propia cuenta de correo de envío (SMTP).
//
// Reglas:
//  · Los secretos se guardan cifrados (AES-256-GCM) con INTEGRACIONES_CLAVE (32 bytes en base64, en el .env; nunca en git ni en la BD).
//    Al navegador solo sale la `pista` (sin secretos).
//  · Ticket de MP: si la empresa tiene el suyo, sus consultas van con él (sin tope de LICITANK: la cuota es suya). Si no, usa el
//    ticket compartido de .env con el tope diario de su plan (medidor-cliente.ts). Grupo ICA usa siempre el de .env.
//  · Correo «a nombre de la empresa» (p. ej. la OC al proveedor): con su cuenta; sin cuenta, solo Grupo ICA usa la de .env y
//    cualquier otra empresa recibe un mensaje claro para configurarla. Los avisos de la plataforma (alertas, recuperar clave)
//    siguen saliendo por la cuenta de LICITANK (.env).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import pool from '@/app/lib/db';
import { clienteActual } from '@/app/lib/medidor-cliente';

const CLIENTE_ICA = 1;
export type TipoIntegracion = 'mp_ticket' | 'correo';
export interface CorreoSmtp { host: string; port: number; secure: boolean; user: string; pass: string; from: string }

// ── Cifrado ──────────────────────────────────────────────────────────────────
function clave(): Buffer {
  const k = Buffer.from(process.env.INTEGRACIONES_CLAVE || '', 'base64');
  if (k.length !== 32) throw new Error('Falta INTEGRACIONES_CLAVE en el servidor (32 bytes en base64). Avísale al administrador de LICITANK.');
  return k;
}
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave(), iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
export function descifrar(guardado: string): string {
  const [v, iv, tag, ct] = guardado.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Formato de credencial desconocido');
  const d = createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

// ── Lectura / escritura (caché corto por cliente) ─────────────────────────────
const CACHE_MS = 60_000;
const cache = new Map<string, { valor: unknown; en: number }>();
const claveCache = (c: number, t: TipoIntegracion) => `${c}:${t}`;

async function leer<T>(clienteId: number, tipo: TipoIntegracion): Promise<T | null> {
  const k = claveCache(clienteId, tipo);
  const c = cache.get(k);
  if (c && Date.now() - c.en < CACHE_MS) return c.valor as T | null;
  let valor: T | null = null;
  try {
    const [[r]] = await pool.query('SELECT datos_cifrados FROM cliente_integracion WHERE cliente_id = ? AND tipo = ?', [clienteId, tipo]) as any;
    if (r?.datos_cifrados) valor = JSON.parse(descifrar(r.datos_cifrados)) as T;
  } catch (e) {
    // Tabla sin crear (migration-186) o clave ausente/cambiada: se trabaja como si no hubiera cuenta propia.
    console.warn(`[integraciones] cliente ${clienteId} ${tipo}:`, String((e as Error)?.message ?? e).slice(0, 120));
  }
  cache.set(k, { valor, en: Date.now() });
  return valor;
}

export async function guardarIntegracion(clienteId: number, tipo: TipoIntegracion, datos: unknown, pista: string, usuarioId: number): Promise<void> {
  await pool.query(
    `INSERT INTO cliente_integracion (cliente_id, tipo, datos_cifrados, pista, verificado_at, actualizado_por) VALUES (?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE datos_cifrados = VALUES(datos_cifrados), pista = VALUES(pista), verificado_at = NOW(), actualizado_por = VALUES(actualizado_por)`,
    [clienteId, tipo, cifrar(JSON.stringify(datos)), pista.slice(0, 160), usuarioId]);
  cache.delete(claveCache(clienteId, tipo));
  transportes.delete(clienteId);
}

export async function borrarIntegracion(clienteId: number, tipo: TipoIntegracion): Promise<void> {
  await pool.query('DELETE FROM cliente_integracion WHERE cliente_id = ? AND tipo = ?', [clienteId, tipo]);
  cache.delete(claveCache(clienteId, tipo));
  transportes.delete(clienteId);
}

/** Lo que se puede mostrar en pantalla: qué está configurado, la pista y cuándo se verificó. Sin secretos. */
export async function resumenIntegraciones(clienteId: number): Promise<Record<TipoIntegracion, { pista: string | null; verificado_at: string | null } | null>> {
  const r: Record<TipoIntegracion, { pista: string | null; verificado_at: string | null } | null> = { mp_ticket: null, correo: null };
  const [rows] = await pool.query('SELECT tipo, pista, verificado_at FROM cliente_integracion WHERE cliente_id = ?', [clienteId]) as any;
  for (const f of rows as any[]) if (f.tipo in r) r[f.tipo as TipoIntegracion] = { pista: f.pista, verificado_at: f.verificado_at };
  return r;
}

// ── Mercado Público ───────────────────────────────────────────────────────────
/** Ticket propio de la empresa de este trabajo, o null (usa el compartido). Grupo ICA siempre null (usa .env). */
export async function ticketMpPropio(): Promise<string | null> {
  const cid = await clienteActual();
  if (cid === CLIENTE_ICA) return null;
  return (await leer<{ ticket: string }>(cid, 'mp_ticket'))?.ticket || null;
}

/** Prueba un ticket contra la API de MP. ok=false solo si MP dice que el ticket no sirve; si MP no responde, se acepta con aviso. */
export async function probarTicketMp(ticket: string): Promise<{ ok: boolean; aviso?: string }> {
  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=1-1-L111&ticket=${encodeURIComponent(ticket)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    const data: any = await res.json().catch(() => null);
    const mensaje = String(data?.Mensaje || data?.mensaje || '');
    if (/ticket/i.test(mensaje) && !/cuota/i.test(mensaje)) return { ok: false, aviso: `Mercado Público respondió: ${mensaje}` };
    if (!res.ok) return { ok: true, aviso: `No se pudo comprobar (Mercado Público respondió HTTP ${res.status}); quedó guardado igual.` };
    return { ok: true };
  } catch {
    return { ok: true, aviso: 'No se pudo comprobar ahora (Mercado Público no respondió); quedó guardado igual.' };
  }
}

// ── Correo ────────────────────────────────────────────────────────────────────
const transportes = new Map<number, { t: Transporter; cuenta: CorreoSmtp }>();

export function crearTransporteSmtp(c: CorreoSmtp): Transporter {
  return nodemailer.createTransport({
    name: c.user.split('@')[1] || undefined, // EHLO con el dominio de la cuenta (ver email.ts: sin esto el antispam descarta)
    host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass },
    pool: true, maxConnections: 1, maxMessages: 50, rateDelta: 1000, rateLimit: 1,
  });
}

/** Cuenta de correo propia de la empresa (con su transporte), o null si no configuró una. */
export async function correoDeCliente(clienteId: number): Promise<{ t: Transporter; cuenta: CorreoSmtp } | null> {
  const ya = transportes.get(clienteId);
  if (ya) return ya;
  const cuenta = await leer<CorreoSmtp>(clienteId, 'correo');
  if (!cuenta) return null;
  const v = { t: crearTransporteSmtp(cuenta), cuenta };
  transportes.set(clienteId, v);
  return v;
}
