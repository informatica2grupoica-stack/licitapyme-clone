// app/lib/ia-uso.ts
// Gasto de IA por perfil y módulo (migration-139, tabla ia_uso). Cada llamada exitosa al modelo de
// texto (crearChatIA → logTelemetriaIA en gemini.ts) deja UNA fila: quién la disparó, en qué módulo,
// con qué modelo, tokens y costo en USD. Alimenta /admin/gasto-ia.
//
// Atribución:
//  · módulo: cada archivo que llama a crearChatIA lo declara con `conModuloIA('viabilidad', crearChatIABase)`.
//  · usuario: el que tiene la sesión en la petición que originó la llamada (cookie JWT). Las corridas
//    sin petición (cron, scheduler, scripts) quedan con usuario_id NULL → "Automático (sistema)".
//    `conUsuarioIA` lo fija a mano cuando la llamada corre desacoplada de la petición.
import { AsyncLocalStorage } from 'node:async_hooks';

export type ModuloIA =
  | 'viabilidad' | 'consultas' | 'auditor' | 'anexos' | 'compras' | 'costeo' | 'prefiltro' | 'otros';

export const MODULOS_IA: Record<ModuloIA, string> = {
  viabilidad: 'Viabilidad',
  consultas: 'Consultas / chat de documentos',
  auditor: 'Auditor (técnico, costo, mercado)',
  anexos: 'Anexos',
  compras: 'Compras',
  costeo: 'Costeo y precios',
  prefiltro: 'Prefiltro / clasificación',
  otros: 'Otros',
};

interface ContextoIA { modulo?: ModuloIA; licitacion?: string; usuarioId?: number | null; usuarioNombre?: string | null }
const als = new AsyncLocalStorage<ContextoIA>();

/** Envuelve `crearChatIA` de un archivo: toda llamada que haga queda atribuida a ese módulo. */
export function conModuloIA<F extends (...a: any[]) => Promise<any>>(modulo: ModuloIA, fn: F): F {
  return ((...args: any[]) => als.run({ ...als.getStore(), modulo: als.getStore()?.modulo ?? modulo }, () => fn(...args))) as F;
}

/** Corre `fn` atribuyendo el gasto a un usuario (y licitación) explícitos. */
export function conUsuarioIA<T>(ctx: { usuarioId?: number | null; usuarioNombre?: string | null; licitacion?: string }, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...als.getStore(), ...ctx }, fn);
}

async function usuarioActual(): Promise<{ id: number | null; nombre: string | null }> {
  const c = als.getStore();
  if (c && c.usuarioId !== undefined) return { id: c.usuarioId ?? null, nombre: c.usuarioNombre ?? null };
  try {
    const { getSession } = await import('@/app/lib/auth'); // next/headers: solo existe dentro de una petición
    const s = await getSession();
    if (s) return { id: Number(s.id), nombre: s.nombre || s.email || null };
  } catch { /* fuera de una petición (cron, scripts) → automático */ }
  return { id: null, nombre: null };
}

function proveedorDe(modelo: string): string {
  const m = modelo.toLowerCase();
  if (m.includes('glm')) return 'zai';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('kimi')) return 'kimi';
  return 'otro';
}

let avisoTabla = false;
/** Guarda una llamada al modelo. Nunca lanza ni bloquea a quien la llama. */
export function registrarUsoIA(d: { modelo: string; respaldo: boolean; tokensIn: number; tokensOut: number; costoUSD: number; ms: number }): void {
  const ctx = als.getStore();
  void (async () => {
    try {
      const [{ default: pool }, { ahoraChileSQL }, u] = await Promise.all([import('@/app/lib/db'), import('@/app/lib/tz'), usuarioActual()]);
      await pool.query(
        `INSERT INTO ia_uso (created_at, usuario_id, usuario_nombre, modulo, licitacion_codigo, proveedor, modelo, respaldo, tokens_in, tokens_out, costo_usd, duracion_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ahoraChileSQL(), u.id, u.nombre, ctx?.modulo ?? 'otros', ctx?.licitacion ?? null, proveedorDe(d.modelo), d.modelo, d.respaldo ? 1 : 0,
         Math.round(d.tokensIn), Math.round(d.tokensOut), d.costoUSD.toFixed(6), Math.round(d.ms)],
      );
    } catch (e) {
      if (!avisoTabla) { avisoTabla = true; console.warn('[ia-uso] no se pudo registrar el gasto de IA (¿falta aplicar migration-139?):', String((e as Error)?.message ?? e).slice(0, 120)); }
    }
  })();
}
