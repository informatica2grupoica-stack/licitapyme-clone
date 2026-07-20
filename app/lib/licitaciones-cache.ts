// app/lib/licitaciones-cache.ts
// Caché persistente del DETALLE de licitaciones (tabla licitaciones_cache).
// La API de MP solo entrega descripción/ítems vía ?codigo= (1×1) y con rate-limit
// fuerte (429). Este caché acumula el enriquecimiento entre corridas y lo comparte
// entre el cron del radar y la búsqueda manual, en vez de re-pedir lo mismo cada vez.

import pool from '@/app/lib/db';
import type { Licitacion, LicitacionItem } from '@/app/types/mercado-publico.types';
import type { MercadoPublicoClient } from '@/app/lib/mercado-publico';
import { notificarCambioFechaCierre } from '@/app/lib/refrescar-estados';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface CacheEntry {
  lic: Licitacion;       // licitación reconstruida desde el caché (enriquecida)
  enrichedAt: Date | null;
  estado: string;
}

// Estados terminales: la descripción/ítems ya no cambian → no re-enriquecer nunca.
const ESTADOS_TERMINALES = new Set(['cerrada', 'desierta', 'adjudicada', 'revocada']);

function esTerminal(estado: string | null | undefined): boolean {
  return ESTADOS_TERMINALES.has((estado || '').toLowerCase());
}

// ── Reconstrucción Licitacion ↔ fila de caché ────────────────────────────────
function filaALicitacion(row: any): Licitacion {
  let items: LicitacionItem[] = [];
  if (row.items_json) {
    try {
      const arr = JSON.parse(row.items_json);
      if (Array.isArray(arr)) {
        items = arr.map((it: any) => ({
          CodigoProducto: String(it.CodigoProducto || ''),
          NombreProducto: it.NombreProducto || '',
          Descripcion: it.Descripcion || '',
          Categoria: it.Categoria || '',
          Cantidad: it.Cantidad || 0,
          Unidad: it.UnidadMedida || it.Unidad || 'Unidad',
          UnidadMedida: it.UnidadMedida || '',
        }));
      }
    } catch { /* items corruptos → vacío */ }
  }
  return {
    Codigo: row.codigo,
    Nombre: row.nombre || '',
    Descripcion: row.descripcion || '',
    Estado: row.estado || '',
    EstadoNombre: row.estado || '',
    Organismo: row.organismo || '',
    CodigoOrganismo: '',
    Region: row.region || '',
    MontoEstimado: row.monto != null ? Number(row.monto) : undefined,
    MontoTotal: row.monto != null ? Number(row.monto) : undefined,
    Tipo: row.tipo || '',
    FechaCierre: row.fecha_cierre ? new Date(row.fecha_cierre).toISOString() : '',
    FechaPublicacion: row.fecha_publicacion ? new Date(row.fecha_publicacion).toISOString() : '',
    Items: items,
  };
}

/** Lee del caché las licitaciones enriquecidas para un set de códigos. */
export async function leerCache(codigos: string[]): Promise<Map<string, CacheEntry>> {
  const out = new Map<string, CacheEntry>();
  if (codigos.length === 0) return out;
  try {
    // Trozos para no exceder placeholders del IN (...)
    for (let i = 0; i < codigos.length; i += 500) {
      const chunk = codigos.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT * FROM licitaciones_cache WHERE codigo IN (${placeholders}) AND enriquecido = 1`,
        chunk,
      ) as any[];
      for (const row of rows as any[]) {
        out.set(row.codigo, {
          lic: filaALicitacion(row),
          enrichedAt: row.enriched_at ? new Date(row.enriched_at) : null,
          estado: row.estado || '',
        });
      }
    }
  } catch {
    // Tabla inexistente (migración 20 pendiente) → caché vacío, no rompe nada
  }
  return out;
}

// Umbral para considerar un cambio de fecha REAL (no ruido de redondeo/formato al ida-y-vuelta
// entre la API y MySQL). 5 minutos es generoso: los cambios que importan (extensión de plazo,
// aclaración) son de horas o días, nunca segundos.
const UMBRAL_CAMBIO_FECHA_MS = 5 * 60 * 1000;

/** Inserta/actualiza en el caché las licitaciones enriquecidas. Detecta si la FECHA DE CIERRE
 * cambió respecto a lo que ya teníamos y, si la licitación tiene un negocio asignado, dispara
 * notificación (campana + correo) — ver notificarCambioFechaCierre en refrescar-estados.ts. */
export async function guardarCache(lics: Licitacion[]): Promise<void> {
  if (lics.length === 0) return;
  // Fechas ANTERIORES (antes de sobrescribir) para poder comparar tras el upsert.
  const fechasAnteriores = new Map<string, Date>();
  try {
    const codigos = lics.map(l => l.Codigo);
    for (let i = 0; i < codigos.length; i += 500) {
      const chunk = codigos.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT codigo, fecha_cierre FROM licitaciones_cache WHERE codigo IN (${placeholders}) AND fecha_cierre IS NOT NULL`,
        chunk,
      ) as any[];
      for (const r of rows as any[]) fechasAnteriores.set(r.codigo, new Date(r.fecha_cierre));
    }
  } catch { /* si falla la lectura previa, seguimos sin detectar cambios (no bloquea el caché) */ }

  try {
    for (let i = 0; i < lics.length; i += 100) {
      const chunk = lics.slice(i, i + 100);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,1,NOW(),NOW())').join(',');
      const values: unknown[] = [];
      for (const lic of chunk) {
        const items = (lic.Items || []).map(it => ({
          CodigoProducto: it.CodigoProducto,
          NombreProducto: it.NombreProducto,
          Descripcion: it.Descripcion,
          Categoria: it.Categoria,
          Cantidad: it.Cantidad,
          UnidadMedida: it.UnidadMedida,
        }));
        values.push(
          lic.Codigo,
          lic.Nombre?.substring(0, 500) ?? null,
          lic.Descripcion || null,
          lic.Organismo?.substring(0, 500) || null,
          lic.Region?.substring(0, 150) || null,
          lic.MontoEstimado ?? null,
          (lic.EstadoNombre || lic.Estado || '').substring(0, 40) || null,
          (lic.Tipo || '').substring(0, 20) || null,
          lic.FechaCierre ? new Date(lic.FechaCierre) : null,
          lic.FechaPublicacion ? new Date(lic.FechaPublicacion) : null,
          items.length ? JSON.stringify(items) : null,
        );
      }
      await pool.query(
        `INSERT INTO licitaciones_cache
           (codigo, nombre, descripcion, organismo, region, monto, estado, tipo,
            fecha_cierre, fecha_publicacion, items_json, enriquecido, enriched_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           nombre=VALUES(nombre), descripcion=VALUES(descripcion), organismo=VALUES(organismo),
           region=VALUES(region), monto=VALUES(monto), estado=VALUES(estado), tipo=VALUES(tipo),
           fecha_cierre=VALUES(fecha_cierre), fecha_publicacion=VALUES(fecha_publicacion),
           items_json=VALUES(items_json), enriquecido=1, enriched_at=NOW(), updated_at=NOW()`,
        values,
      );
    }
  } catch {
    // Tabla inexistente → no rompe; simplemente no se cachea
    return;
  }

  // Notificación de cambio de fecha — DESPUÉS de guardar (best-effort, nunca bloquea el caché).
  // Compara lo que teníamos ANTES contra lo que trajo esta pasada; si difiere de verdad, avisa.
  // notificarCambioFechaCierre ya filtra internamente: solo notifica si hay un negocio ACTIVO
  // asignado (si nadie la trabaja, no hace nada) — así esto es seguro de llamar para TODOS los
  // códigos enriquecidos (miles del radar general incluidos) sin generar ruido.
  for (const lic of lics) {
    if (!lic.FechaCierre) continue;
    const anterior = fechasAnteriores.get(lic.Codigo);
    if (!anterior) continue; // primera vez que se cachea esta licitación: no es un "cambio"
    const nueva = new Date(lic.FechaCierre);
    if (!Number.isFinite(nueva.getTime())) continue;
    if (Math.abs(nueva.getTime() - anterior.getTime()) < UMBRAL_CAMBIO_FECHA_MS) continue;
    notificarCambioFechaCierre(lic.Codigo, anterior, nueva).catch(e =>
      console.error(`[licitaciones-cache] notificar cambio de fecha "${lic.Codigo}" falló:`, String(e)));
  }
}

export interface PlanEnriquecimiento {
  /** códigos que YA están enriquecidos y frescos (usar del caché, no llamar API) */
  frescos: Set<string>;
  /** códigos que conviene (re)enriquecer, ya priorizados */
  aEnriquecer: string[];
}

// TTL ADAPTATIVO por cercanía al cierre. Caso real 1305525-31-LE26: se cacheó el 13-jul y el
// organismo extendió el cierre en un día (aclaración de última hora); con el TTL fijo de 7 días
// la licitación seguía "fresca" justo cuando estaba por cerrar —el momento en que MÁS cambian las
// bases (aclaraciones, extensiones de plazo)— y el cambio nunca se detectó hasta que el usuario lo
// vio directo en el portal. Mientras más cerca el cierre cacheado, más seguido hay que revisar:
//  - cierra en ≤2 días (o ya venció según nuestro dato, que puede estar MÁS desactualizado que la
//    realidad) → TTL de 6 horas.
//  - cierra en ≤7 días → TTL de 1 día.
//  - resto → el ttlDias que pida el llamador (por defecto 7, sin cambios de comportamiento).
function ttlEfectivoMs(fechaCierreCache: string | undefined, ttlDiasBase: number): number {
  const DIA_MS = 24 * 60 * 60 * 1000;
  if (!fechaCierreCache) return ttlDiasBase * DIA_MS;
  const cierre = new Date(fechaCierreCache).getTime();
  if (!Number.isFinite(cierre)) return ttlDiasBase * DIA_MS;
  const diasHastaCierre = (cierre - Date.now()) / DIA_MS;
  if (diasHastaCierre <= 2) return 6 * 60 * 60 * 1000;   // 6 horas
  if (diasHastaCierre <= 7) return 1 * DIA_MS;            // 1 día
  return ttlDiasBase * DIA_MS;
}

/**
 * Decide qué enriquecer. Reglas:
 *  - Terminal (cerrada/adjudicada/…) y ya enriquecida → fresco (nunca re-enriquecer).
 *  - Activa enriquecida hace < TTL EFECTIVO (adaptativo por cercanía al cierre, ver ttlEfectivoMs) → fresca.
 *  - Resto → a enriquecer. `prioritarios` (ej. los que pegaron por nombre) van primero;
 *    el resto se ordena por más antiguo/nunca enriquecido (rotación entre corridas).
 */
export function planificarEnriquecimiento(
  codigos: string[],
  cache: Map<string, CacheEntry>,
  prioritarios: Set<string>,
  ttlDias = 7,
): PlanEnriquecimiento {
  const frescos = new Set<string>();
  const candidatos: string[] = [];
  const ahora = Date.now();

  for (const cod of codigos) {
    const entry = cache.get(cod);
    if (entry) {
      const edad = entry.enrichedAt ? ahora - entry.enrichedAt.getTime() : Infinity;
      const ttlMs = ttlEfectivoMs(entry.lic.FechaCierre, ttlDias);
      if (esTerminal(entry.estado) || edad < ttlMs) { frescos.add(cod); continue; }
    }
    candidatos.push(cod);
  }

  // Prioridad: primero los prioritarios (name-matches), luego el resto.
  // Dentro de cada grupo, los que no están en caché antes que los frescos vencidos.
  const sinCache = (c: string) => !cache.has(c);
  candidatos.sort((a, b) => {
    const pa = prioritarios.has(a) ? 0 : 1;
    const pb = prioritarios.has(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ca = sinCache(a) ? 0 : 1;
    const cb = sinCache(b) ? 0 : 1;
    return ca - cb;
  });

  return { frescos, aEnriquecer: candidatos };
}

export interface ResultadoEnriquecimiento {
  enriquecidas: number;
  r429: number;
  agotoTiempo: boolean;
  intentos: number;
  delayFinalMs: number;
  lics: Licitacion[];
}

/**
 * Enriquece una lista de códigos respetando el rate-limit de MP:
 * concurrencia 1, espera entre llamadas, y backoff creciente ante 429.
 * Guarda en caché por lotes y devuelve también las licitaciones obtenidas.
 */
export async function enriquecerYCachear(
  client: MercadoPublicoClient,
  codigos: string[],
  opts: { maxMs?: number; baseDelayMs?: number; maxDelayMs?: number; guardarCada?: number } = {},
): Promise<ResultadoEnriquecimiento> {
  const { maxMs = 40_000, baseDelayMs = 1500, maxDelayMs = 8000, guardarCada = 20 } = opts;
  const t0 = Date.now();
  let delay = baseDelayMs;
  let enriquecidas = 0, r429 = 0, intentos = 0;
  let agotoTiempo = false;
  let buffer: Licitacion[] = [];
  const lics: Licitacion[] = [];

  for (const cod of codigos) {
    if (Date.now() - t0 > maxMs) { agotoTiempo = true; break; }

    let reintento = 0, resuelto = false;
    while (reintento < 3 && !resuelto) {
      intentos++;
      const { lic, status } = await client.obtenerDetalleConEstado(cod, 8_000);
      if (status === 429) {
        r429++;
        delay = Math.min(Math.round(delay * 1.7), maxDelayMs); // sube el ritmo solo
        await sleep(delay);
        reintento++;
        continue;
      }
      if (lic) { buffer.push(lic); lics.push(lic); enriquecidas++; }
      resuelto = true;
    }

    if (buffer.length >= guardarCada) { await guardarCache(buffer); buffer = []; }
    await sleep(delay);
  }

  if (buffer.length) await guardarCache(buffer);
  return { enriquecidas, r429, agotoTiempo, intentos, delayFinalMs: delay, lics };
}
