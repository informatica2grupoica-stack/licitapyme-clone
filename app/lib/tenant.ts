// app/lib/tenant.ts
// Multi-cliente: de qué empresa es la petición y qué módulos tiene contratados. Solo runtime nodejs (usa pool).
//
// Regla de oro: el cliente NUNCA se lee de un parámetro, body o header que mande el navegador. Sale de la sesión
// verificada (usuarios.cliente_id vía estadoVigente): ver `getClienteId` en api-auth.ts. Aquí solo vive la ficha comercial.
import pool from '@/app/lib/db';
import { modulosEfectivos, type Modulo } from '@/app/lib/modulos';

export const CLIENTE_ICA = 1;

export interface FichaCliente { id: number; nombre: string; estado: string; venceAt: string | null; modulos: Modulo[]; vigente: boolean; maxUsuarios: number | null }

const TTL_MS = 5_000; // corto a propósito: proxy.ts y las rutas tienen cada una su copia de esta caché, y activar/suspender debe regir en segundos
const cache = new Map<number, { ficha: FichaCliente; hasta: number }>();

/** Ficha comercial del cliente (módulos, estado, vencimiento), con caché de 30 s. Cliente 1 = todo, siempre vigente. */
export async function fichaCliente(clienteId: number): Promise<FichaCliente> {
  const c = cache.get(clienteId);
  if (c && c.hasta > Date.now()) return c.ficha;
  let ficha: FichaCliente;
  if (clienteId === CLIENTE_ICA) {
    ficha = { id: 1, nombre: 'Grupo ICA', estado: 'ACTIVO', venceAt: null, modulos: modulosEfectivos(null), vigente: true, maxUsuarios: null };
  } else {
    try {
      const [rows] = await pool.query(
        `SELECT id, nombre, estado, DATE_FORMAT(vence_at, '%Y-%m-%d') AS vence_at, modulos, max_usuarios, activo FROM clientes WHERE id = ? LIMIT 1`, [clienteId]);
      const f = (rows as any[])[0];
      if (!f) {
        ficha = { id: clienteId, nombre: '', estado: 'BAJA', venceAt: null, modulos: [], vigente: false, maxUsuarios: 0 };
      } else {
        const hoy = new Date().toISOString().slice(0, 10);
        const vencido = !!f.vence_at && f.vence_at < hoy;
        ficha = {
          id: f.id, nombre: f.nombre, estado: f.estado, venceAt: f.vence_at ?? null,
          modulos: modulosEfectivos(f.modulos),
          vigente: !!f.activo && f.estado === 'ACTIVO' && !vencido,
          maxUsuarios: f.max_usuarios ?? null,
        };
      }
    } catch {
      // Falla cerrado para clientes: sin saber qué contrataron, no se les abre nada.
      ficha = { id: clienteId, nombre: '', estado: 'ERROR', venceAt: null, modulos: [], vigente: false, maxUsuarios: 0 };
    }
  }
  cache.set(clienteId, { ficha, hasta: Date.now() + TTL_MS });
  return ficha;
}

/** Fuerza a releer la ficha (lo llama el panel del superusuario tras activar/desactivar un módulo). */
export function olvidarFichaCliente(clienteId?: number) {
  if (clienteId == null) cache.clear(); else cache.delete(clienteId);
}

/** ¿Tiene el cliente este módulo activo (y la cuenta vigente)? */
export async function clienteTieneModulo(clienteId: number, modulo: Modulo): Promise<boolean> {
  const f = await fichaCliente(clienteId);
  return f.vigente && f.modulos.includes(modulo);
}

/** Empresa-cliente leída del header `x-cliente-id` que inyecta proxy.ts desde la sesión verificada (el navegador no puede
 *  fijarlo: proxy lo pisa en cada petición). Para rutas que ya leen `x-user-id`. Sin header → null (la ruta debe negar).
 *  Las rutas sensibles usan `getClienteId(req)` de api-auth.ts, que vuelve a verificar el JWT. */
export function clienteDeHeader(req: Request): number | null {
  const n = parseInt(req.headers.get('x-cliente-id') ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Anti-IDOR: ¿este negocio (por id) es de la empresa de quien consulta? Las rutas `/api/negocios/[id]/...` la llaman ANTES de leer o
 *  modificar nada: un id de otra empresa responde "no encontrado", igual que uno que no existe. */
export async function negocioEsDeMiEmpresa(req: Request, negocioId: string | number): Promise<boolean> {
  const clienteId = clienteDeHeader(req);
  const id = Number(negocioId);
  if (!clienteId || !Number.isFinite(id)) return false;
  try {
    const [rows] = await pool.query('SELECT 1 FROM negocios WHERE id = ? AND cliente_id = ? LIMIT 1', [id, clienteId]);
    return (rows as unknown[]).length > 0;
  } catch {
    return false; // falla cerrado
  }
}

/** Anti-IDOR para ids que llegan en el cuerpo de una petición (a quién reasignar, con qué empresa postular, qué etiquetas poner):
 *  true solo si TODOS pertenecen a la empresa de quien consulta. Lista blanca de tablas (todas tienen cliente_id). */
export async function registroEsDeMiEmpresa(
  req: Request, tabla: 'usuarios' | 'empresas' | 'etiquetas', ids: number | string | Array<number | string>,
): Promise<boolean> {
  const clienteId = clienteDeHeader(req);
  const lista = (Array.isArray(ids) ? ids : [ids]).map(Number);
  if (!clienteId || lista.some(n => !Number.isFinite(n) || n <= 0)) return false;
  if (lista.length === 0) return true;
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM ${tabla} WHERE cliente_id = ? AND id IN (?)`, [clienteId, lista]);
    return Number((rows as Array<{ n: number }>)[0]?.n) === new Set(lista).size;
  } catch {
    return false; // falla cerrado
  }
}

// ── Documentos (documentos_cache) ────────────────────────────────────────────────────────────────────────────
// Los documentos OFICIALES de Mercado Público son compartidos (cliente_id 0). Lo que sube o genera una empresa-cliente es PRIVADO de ella:
// se guarda bajo un código con prefijo `c<N>:<codigo>` (en la tabla y en la ruta de R2). Así, ningún flujo de Grupo ICA (viabilidad, auditor,
// compras…), que busca por el código a secas, puede toparse con archivos de un cliente, y dos empresas con el mismo nombre de archivo no
// se pisan. Grupo ICA (cliente 1) sigue guardando con el código a secas, exactamente como siempre.

/** Código bajo el que una empresa guarda SUS documentos de una licitación (ICA = el código a secas). */
export function codigoAlmacenDocs(clienteId: number, codigo: string): string {
  return clienteId === CLIENTE_ICA ? codigo : `c${clienteId}:${codigo}`;
}

/** Fragmento WHERE para los documentos que VE una empresa de una licitación: los oficiales compartidos + los suyos.
 *  Para Grupo ICA queda igual que antes (todo lo que está bajo el código a secas). */
export function filtroDocsVisibles(clienteId: number, codigo: string, alias = ''): { sql: string; params: string[] } {
  const a = alias ? `${alias}.` : '';
  if (clienteId === CLIENTE_ICA) return { sql: `${a}licitacion_codigo = ?`, params: [codigo] };
  return {
    sql: `((${a}licitacion_codigo = ? AND ${a}cliente_id = 0) OR ${a}licitacion_codigo = ?)`,
    params: [codigo, codigoAlmacenDocs(clienteId, codigo)],
  };
}
