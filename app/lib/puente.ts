// app/lib/puente.ts
// Lo que comparten SIMULAR y REPARTIR: de dónde salen los datos y cómo se lee la config.
//
// Es deliberado que las dos rutas usen exactamente el mismo contexto y el mismo parser: la
// vista previa que el asesor aprueba tiene que ser, literalmente, el reparto que se ejecuta.

import pool from '@/app/lib/db';
import { cargaDeEquipo } from '@/app/lib/carga-perfiles';
import type { ConfigReparto, Estrategia, LicitacionPuente, PerfilDestino } from '@/app/lib/puente-reparto';

const ESTRATEGIAS: Estrategia[] = ['equitativa', 'carga', 'categoria', 'monto', 'region', 'viabilidad', 'manual'];

/** Todo lo que el motor necesita: qué hay en el puente y quiénes pueden recibirlo. */
export async function contextoReparto(): Promise<{ licitaciones: LicitacionPuente[]; perfiles: PerfilDestino[] }> {
  const [licRes, usuRes, carga] = await Promise.all([
    pool.query(
      `SELECT id, licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto,
              licitacion_cierre, licitacion_estado, licitacion_tipo, licitacion_region,
              categoria_nombre, viabilidad_semaforo
       FROM puente_radar
       ORDER BY agregado_en DESC, id DESC`),
    pool.query(`SELECT id, nombre, email FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC`),
    cargaDeEquipo(),
  ]);

  const mapCarga = new Map(carga.map(c => [c.usuario_id, c.total]));
  const licitaciones = ((licRes as any)[0] as any[]).map(l => ({
    ...l,
    // MySQL devuelve DECIMAL como string: sin esto los tramos de monto comparan texto.
    licitacion_monto: l.licitacion_monto == null ? null : Number(l.licitacion_monto),
    licitacion_cierre: l.licitacion_cierre ? new Date(l.licitacion_cierre).toISOString() : null,
  })) as LicitacionPuente[];

  const perfiles = ((usuRes as any)[0] as any[]).map(u => ({
    id: u.id, nombre: u.nombre, email: u.email, cargaActual: mapCarga.get(u.id) ?? 0,
  })) as PerfilDestino[];

  return { licitaciones, perfiles };
}

/**
 * Lee y SANEA la config que manda el cliente. Nunca confía en el body: ids a número, valores
 * recortados, estrategia dentro del catálogo. Devuelve `{ error }` si viene inservible.
 */
export function parsearConfig(body: any): { cfg: ConfigReparto } | { error: string } {
  const estrategia = body?.estrategia as Estrategia;
  if (!ESTRATEGIAS.includes(estrategia)) return { error: 'Estrategia de reparto desconocida' };

  const perfiles = Array.isArray(body?.perfiles)
    ? Array.from(new Set(body.perfiles.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)))
    : [];
  if (perfiles.length === 0) return { error: 'Elige al menos un perfil de destino' };

  const reglas = Array.isArray(body?.reglas)
    ? body.reglas
        .filter((r: any) => typeof r?.valor === 'string' && Number.isInteger(Number(r?.usuarioId)))
        .map((r: any) => ({ valor: String(r.valor).slice(0, 200), usuarioId: Number(r.usuarioId) }))
    : undefined;

  const tramos = Array.isArray(body?.tramos)
    ? body.tramos
        .filter((t: any) => Number.isInteger(Number(t?.usuarioId)))
        .map((t: any) => ({
          desde: t?.desde == null || t.desde === '' ? null : Number(t.desde),
          hasta: t?.hasta == null || t.hasta === '' ? null : Number(t.hasta),
          usuarioId: Number(t.usuarioId),
        }))
        .filter((t: any) => (t.desde == null || Number.isFinite(t.desde)) && (t.hasta == null || Number.isFinite(t.hasta)))
    : undefined;

  const manual = Array.isArray(body?.manual)
    ? body.manual
        .filter((m: any) => typeof m?.codigo === 'string' && Number.isInteger(Number(m?.usuarioId)))
        .map((m: any) => ({ codigo: String(m.codigo), usuarioId: Number(m.usuarioId) }))
    : undefined;

  const fallback = ['equitativa', 'carga', 'ninguno'].includes(body?.fallback) ? body.fallback : undefined;

  // La semilla la genera SIMULAR y la reenvía REPARTIR: es lo que garantiza que se ejecute
  // exactamente el reparto que se vio en pantalla.
  const semilla = Number.isFinite(Number(body?.semilla)) && Number(body?.semilla) > 0
    ? Math.floor(Number(body.semilla)) : undefined;

  return { cfg: { estrategia, perfiles: perfiles as number[], reglas, tramos, manual, fallback, semilla } };
}

/** Semilla nueva para una simulación (no criptográfica: solo tiene que variar). */
export function nuevaSemilla(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}
