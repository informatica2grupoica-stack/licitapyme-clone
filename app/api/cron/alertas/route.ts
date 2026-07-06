// app/api/cron/alertas/route.ts
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por cron-job.org cada 4 horas (o Vercel Cron diario).
// Protección: Authorization: Bearer <CRON_SECRET>  o  x-vercel-cron: 1
//
// ESTRATEGIA (matchear+insertar primero; enriquecer al final con lo que sobre):
//   1. obtenerActivasHoy() + obtenerUltimosDias(15) EN PARALELO → pool batch (solo nombres)
//   2. Cargar keywords
//   3. Volcar el CACHÉ PERSISTENTE (licitaciones_cache) ya enriquecido — sin gastar API
//   4. Matchear por keyword (text-match: acento/plural/campo) + INSERT por lotes con score
//      → el output valioso queda guardado SIEMPRE, aunque falte tiempo después
//   5. Enrichment de FONDO con throttle+backoff (rate-limit MP) y el tiempo restante:
//      prioriza los que pegaron y rota el resto → cobertura crece entre corridas y
//      se persiste en el caché (compartido con la búsqueda manual)

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import type { Licitacion } from '@/app/types/mercado-publico.types';
import { registrarActividad } from '@/app/lib/actividad';
import { indexarLicitacion, evaluarKeyword, normalizar, tokenizar, type LicitacionIndexada } from '@/app/lib/text-match';
import { leerCache, planificarEnriquecimiento, enriquecerYCachear } from '@/app/lib/licitaciones-cache';
import { matchearEInsertar } from '@/app/lib/radar-matching';
import { enviarDigestRadar } from '@/app/lib/email';

const CRON_SECRET        = process.env.CRON_SECRET || '';
const DIAS_RECIENTES     = 15;
const KW_CONCURRENCY     = 4;   // keywords procesadas en paralelo
const INSERT_BATCH       = 200; // filas por INSERT IGNORE
const TIEMPO_LIMITE_MS   = 50_000; // presupuesto total del run
// Enriquecimiento (rate-limit MP): concurrencia 1 + delay + backoff vía
// enriquecerYCachear. El caché persiste entre corridas, así que basta enriquecer
// un lote acotado por run; la cobertura crece con el tiempo.
const ENRICH_MAX_MS       = 20_000; // tiempo máximo de enrichment de fondo por run (margen bajo maxDuration 60s)
const ENRICH_BASE_DELAY_MS = 1_500; // espera base entre llamadas a ?codigo=
const ENRICH_TTL_DIAS     = 7;      // re-enriquecer activas si el caché es más viejo

// ── Helper: concurrencia limitada ─────────────────────────────────────────────
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const active = new Set<Promise<void>>();
  for (const item of items) {
    const p: Promise<void> = fn(item).finally(() => active.delete(p));
    active.add(p);
    if (active.size >= limit) await Promise.race(active);
  }
  if (active.size > 0) await Promise.all(active);
}

// ── Helper: campos buscables de una licitación para el matcher compartido ─────
// La API batch solo trae Nombre; el detalle agrega Descripcion, Items y Categoria
// (taxonomía oficial). text-match.ts pondera cada campo distinto.
function camposDe(lic: Licitacion) {
  const items     = (lic.Items || []).map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''}`).join(' ');
  const categoria = (lic.Items || []).map(it => it.Categoria || '').join(' ');
  return {
    nombre:      lic.Nombre || '',
    descripcion: lic.Descripcion || '',
    items,
    categoria,
  };
}

// ¿El texto contiene algún token de la keyword? (acento-insensible, con prefijo)
function contieneAlgunToken(texto: string, kwTokens: string[]): boolean {
  const palabras = new Set(normalizar(texto).split(' ').filter(Boolean));
  return kwTokens.some(t =>
    palabras.has(t) || (t.length >= 4 && [...palabras].some(w => w.startsWith(t) || (t.length >= 6 && w.includes(t))))
  );
}

// Devuelve un fragmento (en su forma ORIGINAL, con tildes) alrededor de la palabra
// que coincidió. Acento-insensible: ubica por palabra normalizada y corta del original.
function snippetAlrededor(texto: string, kwTokens: string[]): string {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const idx = palabras.findIndex(w => {
    const n = normalizar(w);
    return kwTokens.some(t => n === t || (t.length >= 4 && (n.startsWith(t) || (t.length >= 6 && n.includes(t)))));
  });
  if (idx === -1) return '';
  const start = Math.max(0, idx - 8);
  const end   = Math.min(palabras.length, idx + 9);
  return (start > 0 ? '…' : '') + palabras.slice(start, end).join(' ').trim() + (end < palabras.length ? '…' : '');
}

// Extrae un fragmento donde apareció la keyword (solo si NO está en el título —
// en el título ya se ve en la tarjeta). Acento-insensible.
function extraerContexto(lic: Licitacion, keyword: string): string {
  const kwTokens = tokenizar(keyword);
  if (kwTokens.length === 0) return '';
  if (contieneAlgunToken(lic.Nombre || '', kwTokens)) return '';

  const candidatos = [
    lic.Descripcion || '',
    ...(lic.Items || []).map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''} ${it.Categoria || ''}`),
  ];
  for (const texto of candidatos) {
    const ctx = snippetAlrededor(texto, kwTokens);
    if (ctx) return ctx;
  }
  return '';
}

// ── Helper: INSERT IGNORE por lote ────────────────────────────────────────────
type KwRow = { id: number; usuario_id: number; keyword: string };
type Coincidencia = { lic: Licitacion; fuente: string; contexto: string; score: number };

async function batchInsertAlertas(
  kw: KwRow,
  coincidencias: Coincidencia[],
): Promise<number> {
  if (coincidencias.length === 0) return 0;

  let total = 0;

  for (let start = 0; start < coincidencias.length; start += INSERT_BATCH) {
    const chunk = coincidencias.slice(start, start + INSERT_BATCH);

    try {
      // INSERT completo con ON DUPLICATE KEY UPDATE para rellenar campos vacíos en alertas ya existentes
      // (organismo, monto, región y fecha_publicacion quedan vacíos cuando la licitación no fue enriquecida)
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values: unknown[] = [];
      for (const { lic, fuente, contexto, score } of chunk) {
        values.push(
          kw.usuario_id,
          kw.id,
          kw.keyword,
          lic.Codigo,
          lic.Nombre?.substring(0, 500)    ?? null,
          lic.Organismo?.substring(0, 500) || null,
          lic.MontoEstimado                || null,
          lic.FechaCierre      ? new Date(lic.FechaCierre)      : null,
          lic.FechaPublicacion ? new Date(lic.FechaPublicacion) : null,
          lic.EstadoNombre || lic.Estado   || null,
          lic.Region                       || null,
          (lic.Tipo || '').substring(0, 20) || null,
          fuente,
          contexto || null,
          Number.isFinite(score) ? Number(score.toFixed(3)) : null,
        );
      }
      const [res] = await pool.query(
        `INSERT INTO alertas_licitaciones
           (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
            licitacion_nombre, licitacion_organismo, licitacion_monto,
            licitacion_cierre, licitacion_fecha_publicacion,
            licitacion_estado, licitacion_region,
            licitacion_tipo, match_fuente, match_contexto, match_score)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           licitacion_organismo       = IF(licitacion_organismo IS NULL OR licitacion_organismo = '', VALUES(licitacion_organismo), licitacion_organismo),
           licitacion_monto           = IF(licitacion_monto IS NULL, VALUES(licitacion_monto), licitacion_monto),
           licitacion_region          = IF(licitacion_region IS NULL OR licitacion_region = '', VALUES(licitacion_region), licitacion_region),
           licitacion_tipo            = IF(licitacion_tipo IS NULL OR licitacion_tipo = '', VALUES(licitacion_tipo), licitacion_tipo),
           licitacion_fecha_publicacion = IF(licitacion_fecha_publicacion IS NULL, VALUES(licitacion_fecha_publicacion), licitacion_fecha_publicacion),
           licitacion_estado          = COALESCE(VALUES(licitacion_estado), licitacion_estado),
           match_contexto             = IF(match_contexto IS NULL, VALUES(match_contexto), match_contexto),
           match_score                = GREATEST(COALESCE(match_score, 0), COALESCE(VALUES(match_score), 0))`,
        values,
      ) as any[];
      // affectedRows: 1 = INSERT, 2 = UPDATE (ON DUPLICATE KEY), 0 = sin cambios
      // Contamos solo los verdaderos INSERTs nuevos
      const affected = (res as any).affectedRows ?? 0;
      total += Math.min(affected, chunk.length);
    } catch (e: any) {
      if (!String(e).toLowerCase().includes('unknown column')) continue;

      // Fallback 1: falta match_score (migración 19 pendiente) pero existen
      // match_fuente/contexto (migración 10). Insertamos sin match_score.
      try {
        const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const values: unknown[] = [];
        for (const { lic, fuente, contexto } of chunk) {
          values.push(
            kw.usuario_id, kw.id, kw.keyword, lic.Codigo,
            lic.Nombre?.substring(0, 500)    ?? null,
            lic.Organismo?.substring(0, 500) || null,
            lic.MontoEstimado                || null,
            lic.FechaCierre      ? new Date(lic.FechaCierre)      : null,
            lic.FechaPublicacion ? new Date(lic.FechaPublicacion) : null,
            lic.EstadoNombre || lic.Estado   || null,
            lic.Region                       || null,
            (lic.Tipo || '').substring(0, 20) || null,
            fuente,
            contexto || null,
          );
        }
        const [res] = await pool.query(
          `INSERT INTO alertas_licitaciones
             (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
              licitacion_nombre, licitacion_organismo, licitacion_monto,
              licitacion_cierre, licitacion_fecha_publicacion,
              licitacion_estado, licitacion_region,
              licitacion_tipo, match_fuente, match_contexto)
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE
             licitacion_organismo       = IF(licitacion_organismo IS NULL OR licitacion_organismo = '', VALUES(licitacion_organismo), licitacion_organismo),
             licitacion_monto           = IF(licitacion_monto IS NULL, VALUES(licitacion_monto), licitacion_monto),
             licitacion_region          = IF(licitacion_region IS NULL OR licitacion_region = '', VALUES(licitacion_region), licitacion_region),
             licitacion_tipo            = IF(licitacion_tipo IS NULL OR licitacion_tipo = '', VALUES(licitacion_tipo), licitacion_tipo),
             licitacion_fecha_publicacion = IF(licitacion_fecha_publicacion IS NULL, VALUES(licitacion_fecha_publicacion), licitacion_fecha_publicacion),
             licitacion_estado          = COALESCE(VALUES(licitacion_estado), licitacion_estado),
             match_contexto             = IF(match_contexto IS NULL, VALUES(match_contexto), match_contexto)`,
          values,
        ) as any[];
        total += Math.min((res as any).affectedRows ?? 0, chunk.length);
      } catch (e2: any) {
        if (!String(e2).toLowerCase().includes('unknown column')) continue;
        // Fallback 2: faltan también match_fuente/contexto/etc (migración 10 pendiente).
        try {
          const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
          const values: unknown[] = [];
          for (const { lic } of chunk) {
            values.push(
              kw.usuario_id, kw.id, kw.keyword, lic.Codigo,
              lic.Nombre?.substring(0, 500)    ?? null,
              lic.Organismo?.substring(0, 500) || null,
              lic.MontoEstimado                || null,
              lic.FechaCierre ? new Date(lic.FechaCierre) : null,
              lic.EstadoNombre || lic.Estado   || null,
              lic.Region                       || null,
            );
          }
          const [res] = await pool.query(
            `INSERT IGNORE INTO alertas_licitaciones
               (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
                licitacion_nombre, licitacion_organismo, licitacion_monto,
                licitacion_cierre, licitacion_estado, licitacion_region)
             VALUES ${placeholders}`,
            values,
          ) as any[];
          total += (res as any).affectedRows ?? 0;
        } catch { /* silencioso */ }
      }
    }
  }

  return total;
}

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const isCron     = request.headers.get('x-vercel-cron') === '1';
  const isManual   = CRON_SECRET !== '' && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isCron && !isManual) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!process.env.MERCADO_PUBLICO_TICKET) {
    console.error('[Cron] ❌ MERCADO_PUBLICO_TICKET no configurado en Vercel.');
    return NextResponse.json({
      success: false,
      error: 'MERCADO_PUBLICO_TICKET no configurado. Ve a Vercel → Settings → Environment Variables.',
    }, { status: 503 });
  }

  console.log(`[Cron] 🚀 Iniciando — ${new Date().toISOString()}`);

  const stats = {
    licitacionesActivas:    0,
    licitacionesRecientes:  0,
    licitacionesTotales:    0,
    cacheHits:              0,   // licitaciones ya enriquecidas en caché (sin API)
    enriquecidasRun:        0,   // nuevas enriquecidas en esta corrida
    r429:                   0,   // veces que la API pidió bajar el ritmo
    agotoTiempoEnrich:      false,
    enriquecidas:           0,   // total con descripción disponible (caché + run)
    enriquecimientoOmitido: false,
    keywordsProcesadas:     0,
    alertasNuevas:          0,
    correosEnviados:        0,   // digests de radar enviados por perfil
    errores:                0,
    duracionMs:             0,
  };

  const startTime = Date.now();
  const elapsed   = () => Date.now() - startTime;

  try {
    const client = getMercadoPublicoClient();

    // ── Paso 1: Descarga batch en paralelo ────────────────────────────────────
    console.log('[Cron] 🔍 Descargando licitaciones activas + últimos días (paralelo)...');
    const [licitacionesActivas, licitacionesRecientes] = await Promise.all([
      client.obtenerActivasHoy(),
      client.obtenerUltimosDias(DIAS_RECIENTES),
    ]);

    stats.licitacionesActivas   = licitacionesActivas.length;
    stats.licitacionesRecientes = licitacionesRecientes.length;
    console.log(
      `[Cron] ✅ ${licitacionesActivas.length} activas + ` +
      `${licitacionesRecientes.length} de últimos ${DIAS_RECIENTES} días — ${elapsed()}ms`,
    );

    // Deduplicar. Una licitación puede venir por ambas vías: "activas" (sin objeto
    // Fechas → sin FechaPublicacion) y "últimos días" (que pasa la fecha del día como
    // fallback de publicación). Preferimos SIEMPRE la versión que SÍ trae fecha de
    // publicación, para que la de "activas" (vacía) no pise a la fechada.
    const mapa = new Map<string, Licitacion>();
    for (const lic of [...licitacionesActivas, ...licitacionesRecientes]) {
      const prev = mapa.get(lic.Codigo);
      if (!prev) { mapa.set(lic.Codigo, lic); continue; }
      if (!prev.FechaPublicacion && lic.FechaPublicacion) mapa.set(lic.Codigo, lic);
    }
    const licitaciones = Array.from(mapa.values());
    stats.licitacionesTotales   = licitaciones.length;
    console.log(`[Cron] 🗂️  Total único: ${licitaciones.length} — ${elapsed()}ms`);

    if (licitaciones.length === 0) {
      console.warn('[Cron] ⚠️ La API no devolvió licitaciones');
      stats.duracionMs = elapsed();
      return NextResponse.json({ success: false, error: 'Sin licitaciones', ...stats }, { status: 503 });
    }

    // ── Paso 2: Cargar keywords (antes del enrichment, para priorizar) ────────
    // Se separan POSITIVAS (generan alertas) de NEGATIVAS (es_negativa=1, excluyen).
    // Si la columna es_negativa no existe (migración 30 pendiente), todas son positivas.
    let kws: KwRow[] = [];
    let kwsNeg: KwRow[] = [];
    try {
      const [rows] = await pool.query(
        `SELECT pk.id, pk.usuario_id, pk.keyword, pk.es_negativa
         FROM palabras_clave pk
         JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
         WHERE pk.activo = TRUE
         ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`,
      );
      for (const r of rows as any[]) {
        const kw: KwRow = { id: r.id, usuario_id: r.usuario_id, keyword: r.keyword };
        if (Number(r.es_negativa) === 1) kwsNeg.push(kw); else kws.push(kw);
      }
    } catch {
      const [rows] = await pool.query(
        `SELECT pk.id, pk.usuario_id, pk.keyword
         FROM palabras_clave pk
         JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
         WHERE pk.activo = TRUE
         ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`,
      );
      kws = rows as KwRow[];
    }
    console.log(`[Cron] 📋 ${kws.length} keywords positivas, ${kwsNeg.length} negativas`);

    // ── Paso 3: Volcar el CACHÉ persistente (sin gastar API) ──────────────────
    // El enriquecimiento nuevo se hace DESPUÉS de matchear+insertar (Paso 5), para
    // que el output valioso (alertas) nunca se pierda si el run se queda sin tiempo.
    const allCodigos = licitaciones.map(l => l.Codigo);
    const enrichedMap = new Map<string, Licitacion>(licitaciones.map(l => [l.Codigo, l]));

    const cache = await leerCache(allCodigos);
    for (const [cod, entry] of cache) enrichedMap.set(cod, entry.lic);
    stats.cacheHits = cache.size;
    stats.enriquecidas = cache.size;
    console.log(`[Cron] 🗃️  ${cache.size}/${allCodigos.length} ya enriquecidas en caché — ${elapsed()}ms`);

    // Listado final (enriquecido desde caché donde se pudo, batch donde no)
    const licitacionesFinales = Array.from(enrichedMap.values());

    // Pre-indexar cada licitación UNA sola vez (normaliza acentos/plurales por campo).
    const indices = new Map<string, LicitacionIndexada>(
      licitacionesFinales.map(l => [l.Codigo, indexarLicitacion(camposDe(l))]),
    );

    // ── Paso 3.5: Excluir por palabras NEGATIVAS ──────────────────────────────
    // Una licitación que calza CUALQUIER keyword negativa queda excluida y no
    // genera alertas, aunque calce positivas. Se evalúa una sola vez por licitación.
    const excluidasNeg = new Set<string>();
    if (kwsNeg.length > 0) {
      for (const lic of licitacionesFinales) {
        const idx = indices.get(lic.Codigo)!;
        if (kwsNeg.some(neg => evaluarKeyword(idx, neg.keyword).match)) excluidasNeg.add(lic.Codigo);
      }
      console.log(`[Cron] 🚫 ${excluidasNeg.size} licitaciones excluidas por palabras negativas`);
    }

    // ── Paso 4: Procesar keywords en paralelo ─────────────────────────────────
    const alertasMap = new Map<number, number>();
    const matchedCodigos = new Set<string>(); // los que pegan → prioridad de enrichment

    await withConcurrency(kws, KW_CONCURRENCY, async (kw) => {
      try {
        // Matcher compartido: normaliza acentos/plurales, pondera por campo y
        // entrega score de relevancia. Reemplaza el includes() literal.
        const coincidencias: Coincidencia[] = [];
        for (const lic of licitacionesFinales) {
          if (excluidasNeg.has(lic.Codigo)) continue; // palabra negativa manda
          const r = evaluarKeyword(indices.get(lic.Codigo)!, kw.keyword);
          if (!r.match) continue;
          matchedCodigos.add(lic.Codigo);
          coincidencias.push({
            lic,
            fuente:   r.fuentes.join(',') || 'titulo',
            contexto: extraerContexto(lic, kw.keyword),
            score:    r.score,
          });
        }

        const insertadas = await batchInsertAlertas(kw, coincidencias);

        await pool.query(
          `UPDATE palabras_clave
           SET ultima_busqueda   = NOW(),
               resultados_nuevos = resultados_nuevos + ?,
               total_encontradas = total_encontradas + ?
           WHERE id = ?`,
          [insertadas, coincidencias.length, kw.id] as unknown[],
        );

        alertasMap.set(kw.id, insertadas);

        console.log(
          `[Cron] "${kw.keyword}" → ${coincidencias.length} coincidencias` +
          (insertadas > 0 ? `, ${insertadas} nuevas 🆕` : ' (ya conocidas)'),
        );
      } catch (err) {
        console.error(`[Cron] ❌ Error procesando "${kw.keyword}":`, err);
        stats.errores++;
      }
    });

    stats.keywordsProcesadas = kws.length;
    for (const v of alertasMap.values()) stats.alertasNuevas += v;

    // Historial: registrar cuántas licitaciones nuevas le llegaron a cada usuario
    const nuevasPorUsuario = new Map<number, number>();
    for (const kw of kws) {
      const n = alertasMap.get(kw.id) || 0;
      if (n > 0) nuevasPorUsuario.set(kw.usuario_id, (nuevasPorUsuario.get(kw.usuario_id) || 0) + n);
    }
    for (const [uid, n] of nuevasPorUsuario) {
      registrarActividad({
        usuarioId: uid, accion: 'radar_nuevas', entidadTipo: 'radar', entidadId: null,
        descripcion: `${n} nueva${n !== 1 ? 's' : ''} licitación${n !== 1 ? 'es' : ''} encontrada${n !== 1 ? 's' : ''} en el radar`,
        metadata: { cantidad: n },
      });
    }

    // ── Paso 5: Enrichment de FONDO (con el tiempo que sobró) ──────────────────
    // Las alertas ya están insertadas (Paso 4). Aquí solo rellenamos el caché para
    // las próximas corridas: prioriza los que pegaron por keyword y rota el resto.
    // Si no queda tiempo, no enriquece — el output valioso ya está a salvo.
    const presupuesto = Math.min(ENRICH_MAX_MS, TIEMPO_LIMITE_MS - elapsed());
    if (presupuesto > 3_000) {
      // SIN sesgo de prioridad: antes priorizaba los que ya pegaron por título, así
      // las que solo matchearían por ítems/categoría (ej. rubro EQUIPAMIENTO) nunca
      // se enriquecían. Ahora se cubren TODAS (el plan ordena sin-caché primero), para
      // que su rubro/ítems queden disponibles y se matcheen en la próxima corrida.
      // El grueso del backlog lo cubre el botón "Enriquecer todo" (loop desde el navegador).
      const plan = planificarEnriquecimiento(allCodigos, cache, new Set(), ENRICH_TTL_DIAS);
      if (plan.aEnriquecer.length > 0) {
        console.log(
          `[Cron] 🔎 Enrichment de fondo (sin sesgo): ${plan.aEnriquecer.length} candidatos, ` +
          `presupuesto ${Math.round(presupuesto / 1000)}s...`,
        );
        const res = await enriquecerYCachear(client, plan.aEnriquecer, {
          maxMs: presupuesto,
          baseDelayMs: ENRICH_BASE_DELAY_MS,
        });
        stats.enriquecidasRun   = res.enriquecidas;
        stats.r429              = res.r429;
        stats.agotoTiempoEnrich = res.agotoTiempo;
        console.log(`[Cron] ✅ enrich: +${res.enriquecidas} nuevas, ${res.r429} 429 — ${elapsed()}ms`);

        // Re-matchear las recién enriquecidas (capta las que solo calzan por rubro/ítems)
        // e inserta sus alertas + CORRIGE su fecha de publicación REAL (del detalle).
        if (res.lics.length > 0) {
          try {
            const m = await matchearEInsertar(res.lics, { positivas: kws, negativas: kwsNeg });
            stats.alertasNuevas += m.alertasNuevas;
            console.log(`[Cron] 🔁 re-match enriquecidas: +${m.alertasNuevas} alertas, ${m.fechasCorregidas} fechas corregidas`);
          } catch (e) { console.error('[Cron] re-match enriquecidas falló:', String(e)); }
        }
      }
    } else {
      stats.enriquecimientoOmitido = true;
      console.warn(`[Cron] ⏭ Enrichment de fondo omitido — sin presupuesto (${presupuesto}ms)`);
    }

    // ── Paso 6: Digest por correo a cada perfil con licitaciones nuevas ────────
    // Un solo correo por usuario con SUS coincidencias nuevas de esta corrida. Se
    // determina "nuevas" por created_at dentro de la ventana del run (INTERVAL desde
    // NOW() del servidor de BD → sin depender del reloj de la app). Best-effort: si
    // falla el envío o falta SMTP, NO rompe el cron (el radar ya tiene las alertas).
    // Kill-switch: ALERTAS_EMAIL=false lo desactiva.
    if (process.env.ALERTAS_EMAIL !== 'false') {
      try {
        const cutoffSeg = Math.ceil(elapsed() / 1000) + 120; // duración del run + margen
        const [nuevasRows] = await pool.query(
          `SELECT a.usuario_id, u.email, u.nombre,
                  a.licitacion_codigo, a.licitacion_nombre, a.licitacion_organismo,
                  a.licitacion_monto, a.licitacion_cierre, a.keyword_texto
           FROM alertas_licitaciones a
           JOIN usuarios u ON u.id = a.usuario_id AND u.activo = TRUE
           WHERE a.created_at >= (NOW() - INTERVAL ? SECOND)
             AND u.email IS NOT NULL AND u.email <> ''
           ORDER BY a.usuario_id, a.created_at DESC`,
          [cutoffSeg],
        ) as any[];

        // Agrupar por usuario (unique_alerta garantiza 1 fila por usuario+código).
        const porUsuario = new Map<number, { email: string; nombre: string | null; items: any[] }>();
        for (const r of nuevasRows as any[]) {
          let g = porUsuario.get(r.usuario_id);
          if (!g) { g = { email: r.email, nombre: r.nombre, items: [] }; porUsuario.set(r.usuario_id, g); }
          g.items.push(r);
        }

        const TOP = 12; // máximo de licitaciones listadas en el correo (el resto va como "+N más")
        for (const [, g] of porUsuario) {
          const enviado = await enviarDigestRadar({
            to: g.email, nombre: g.nombre,
            totalNuevas: g.items.length,
            licitaciones: g.items.slice(0, TOP).map(r => ({
              codigo: r.licitacion_codigo, nombre: r.licitacion_nombre, organismo: r.licitacion_organismo,
              monto: r.licitacion_monto, cierre: r.licitacion_cierre, keyword: r.keyword_texto,
            })),
          });
          if (enviado) stats.correosEnviados++;
        }
        console.log(`[Cron] 📧 Digests enviados: ${stats.correosEnviados}/${porUsuario.size} perfiles con nuevas`);
      } catch (e) {
        console.error('[Cron] digest email falló (no crítico):', String(e));
      }
    }

    stats.duracionMs = elapsed();
    console.log(`[Cron] ✅ Completado en ${stats.duracionMs}ms —`, stats);

    return NextResponse.json({ success: true, ...stats });

  } catch (error) {
    stats.duracionMs = elapsed();
    console.error('[Cron] ❌ Error general:', error);
    return NextResponse.json({ success: false, error: String(error), ...stats }, { status: 500 });
  }
}
