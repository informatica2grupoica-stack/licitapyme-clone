// app/lib/medidor-cliente.ts
// MEDIDOR POR CLIENTE (multiempresa, Etapa 1 — docs/memoria/multiempresa.md, migration-185).
// Dice de qué empresa-cliente es el trabajo que está corriendo (para anotar el gasto de IA y las consultas a Mercado Público)
// y corta cuando una empresa llega a su tope (clientes.tope_ia_usd_mes / clientes.tope_mp_diario; NULL = sin tope).
//
// De quién es: 1) lo fijado con conCliente() (trabajo en segundo plano lanzado para una empresa, p. ej. la evaluación por RUT),
// 2) el header x-cliente-id que proxy.ts pone desde la sesión en cada petición, 3) el cliente del usuario si se conoce,
// 4) si no hay nada (cron, scheduler, scripts) = 1, el sistema (Grupo ICA).
// Grupo ICA (1) nunca tiene tope. Si la tabla o las columnas no existen todavía, nada se corta.
import { AsyncLocalStorage } from 'node:async_hooks';
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

const CLIENTE_SISTEMA = 1;
const als = new AsyncLocalStorage<number>();

/** Corre `fn` atribuyendo todo su gasto (IA, Mercado Público) a esa empresa-cliente. */
export function conCliente<T>(clienteId: number, fn: () => Promise<T>): Promise<T> {
  return als.run(clienteId, fn);
}

const clienteDeUsuario = new Map<number, number>();

export async function clienteActual(usuarioId?: number | null): Promise<number> {
  const fijo = als.getStore();
  if (fijo) return fijo;
  try {
    const { headers } = await import('next/headers'); // solo existe dentro de una petición
    const n = parseInt((await headers()).get('x-cliente-id') ?? '', 10);
    if (n > 0) return n;
  } catch { /* fuera de una petición */ }
  if (usuarioId) {
    if (!clienteDeUsuario.has(usuarioId)) {
      try {
        const [[u]] = await pool.query('SELECT cliente_id FROM usuarios WHERE id = ?', [usuarioId]) as any;
        clienteDeUsuario.set(usuarioId, Number(u?.cliente_id) || CLIENTE_SISTEMA);
      } catch { return CLIENTE_SISTEMA; }
    }
    return clienteDeUsuario.get(usuarioId)!;
  }
  return CLIENTE_SISTEMA;
}

/** Error que corta el trabajo de una empresa que llegó a su tope. El mensaje se puede mostrar tal cual al usuario. */
export class TopeClienteError extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'TopeClienteError'; }
}

// Topes y consumo se leen de la BD con un caché corto por cliente: no se consulta la base en cada llamada.
const CACHE_MS = 30_000;
type Topes = { ia: number | null; mp: number | null; en: number };
const topesCache = new Map<number, Topes>();
const iaMesCache = new Map<number, { usd: number; en: number }>();

async function topesDe(clienteId: number): Promise<Topes> {
  const c = topesCache.get(clienteId);
  if (c && Date.now() - c.en < CACHE_MS) return c;
  let t: Topes = { ia: null, mp: null, en: Date.now() };
  try {
    const [[r]] = await pool.query('SELECT tope_ia_usd_mes, tope_mp_diario FROM clientes WHERE id = ?', [clienteId]) as any;
    t = { ia: r?.tope_ia_usd_mes == null ? null : Number(r.tope_ia_usd_mes), mp: r?.tope_mp_diario == null ? null : Number(r.tope_mp_diario), en: Date.now() };
  } catch { /* migration-185 sin aplicar → sin topes */ }
  topesCache.set(clienteId, t);
  return t;
}

/** Inicio del mes calendario de hoy en hora Chile ('YYYY-MM-01 00:00:00'); ia_uso.created_at se guarda en hora Chile. */
function inicioMesChile(): string { return `${ahoraChileSQL().slice(0, 7)}-01 00:00:00`; }

/** Gasto de IA del mes (USD) por empresa: { clienteId: usd }. */
export async function gastoIaMesPorCliente(): Promise<Map<number, number>> {
  const [rows] = await pool.query('SELECT cliente_id, SUM(costo_usd) usd FROM ia_uso WHERE created_at >= ? GROUP BY cliente_id', [inicioMesChile()]) as any;
  return new Map((rows as any[]).map(r => [Number(r.cliente_id), Number(r.usd) || 0]));
}

/** Consultas a Mercado Público de hoy por empresa: { clienteId: consultas }. */
export async function consultasMpHoyPorCliente(): Promise<Map<number, number>> {
  const [rows] = await pool.query('SELECT cliente_id, consultas FROM mp_api_uso_cliente WHERE fecha = ?', [ahoraChileSQL().slice(0, 10)]) as any;
  return new Map((rows as any[]).map(r => [Number(r.cliente_id), Number(r.consultas) || 0]));
}

/** Lanza TopeClienteError si la empresa de este trabajo ya gastó su tope de IA del mes. */
export async function verificarTopeIA(): Promise<void> {
  const cid = await clienteActual();
  if (cid === CLIENTE_SISTEMA) return;
  const { ia } = await topesDe(cid);
  if (ia == null) return;
  let g = iaMesCache.get(cid);
  if (!g || Date.now() - g.en > CACHE_MS) {
    try {
      const [[r]] = await pool.query('SELECT COALESCE(SUM(costo_usd), 0) usd FROM ia_uso WHERE cliente_id = ? AND created_at >= ?', [cid, inicioMesChile()]) as any;
      g = { usd: Number(r?.usd) || 0, en: Date.now() };
    } catch { return; }
    iaMesCache.set(cid, g);
  }
  if (g.usd >= ia) throw new TopeClienteError('Tu empresa llegó al tope mensual de análisis con IA de su plan. Escríbenos para ampliarlo.');
}

/** Lanza TopeClienteError si la empresa de este trabajo ya hizo hoy todas las consultas a Mercado Público de su plan. */
export async function verificarTopeMP(): Promise<void> {
  const cid = await clienteActual();
  if (cid === CLIENTE_SISTEMA) return;
  const { mp } = await topesDe(cid);
  if (mp == null) return;
  let usadas = 0;
  try {
    const [[r]] = await pool.query('SELECT consultas FROM mp_api_uso_cliente WHERE cliente_id = ? AND fecha = ?', [cid, ahoraChileSQL().slice(0, 10)]) as any;
    usadas = Number(r?.consultas) || 0;
  } catch { return; }
  if (usadas >= mp) throw new TopeClienteError('Tu empresa llegó al tope diario de consultas a Mercado Público de su plan. Se renueva a medianoche.');
}

/** Suma una consulta a Mercado Público a la empresa de este trabajo. Nunca lanza. */
export async function registrarConsultaMpCliente(): Promise<void> {
  try {
    const cid = await clienteActual();
    await pool.query(
      `INSERT INTO mp_api_uso_cliente (fecha, cliente_id, consultas, actualizado_at) VALUES (?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE consultas = consultas + 1, actualizado_at = NOW()`,
      [ahoraChileSQL().slice(0, 10), cid]);
  } catch { /* migration-185 sin aplicar: el total de mp_api_uso_diario igual se cuenta */ }
}
