// app/api/cron/enriquecer/route.ts
// ENRIQUECIMIENTO AUTOMÁTICO (paso previo al prefiltro) — pensado para Vercel Cron.
// Enriquece las licitaciones activas + últimos días que aún no tienen metadata completa
// (ítems/categoría/descripción vía ?codigo=), las guarda en el caché persistente y
// RE-MATCHEA cada una recién enriquecida contra las keywords (aplicando negativas),
// generando las alertas que faltaban. Reanudable: lo que no alcance queda para la
// próxima corrida (el caché persiste, así que la cobertura crece entre runs).
//
// Es el equivalente automático del botón "Enriquecer todo" del radar. Solo usa la API
// pública de MP → corre en Vercel sin IP chilena (a diferencia de la descarga de docs).
//
// ⚠️ Vercel Cron dispara con GET, así que el TRABAJO va en el handler GET (igual que
// /api/cron/alertas). POST es un alias para disparadores externos/manuales.
//   GET  → enriquece dentro del presupuesto de tiempo. ?lote= · ?peek=1 (solo contar).
//   POST → mismo trabajo. Body/query: { lote? }
//
// Protección: x-vercel-cron:1 · Authorization: Bearer <CRON_SECRET> · ?secret= · x-cron-secret.

import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import type { Licitacion } from '@/app/types/mercado-publico.types';
import { leerCache, planificarEnriquecimiento, enriquecerYCachear } from '@/app/lib/licitaciones-cache';
import { cargarKeywordsRadar, matchearEInsertar } from '@/app/lib/radar-matching';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIAS_RECIENTES  = 15;
const LOTE_DEFAULT     = 15;     // códigos enriquecidos por tanda (1×1 con rate-limit)
const ENRICH_TTL_DIAS  = 7;      // re-enriquecer activas si el caché es más viejo
const PRESUPUESTO_MS   = 52_000; // margen bajo maxDuration=60

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

// Universo a cubrir: activas + últimos N días, deduplicado (preferir versión con fecha).
async function universoActivas(): Promise<Licitacion[]> {
  const client = getMercadoPublicoClient();
  const [activas, recientes] = await Promise.all([
    client.obtenerActivasHoy(),
    client.obtenerUltimosDias(DIAS_RECIENTES),
  ]);
  const mapa = new Map<string, Licitacion>();
  for (const lic of [...activas, ...recientes]) {
    const prev = mapa.get(lic.Codigo);
    if (!prev) { mapa.set(lic.Codigo, lic); continue; }
    if (!prev.FechaPublicacion && lic.FechaPublicacion) mapa.set(lic.Codigo, lic);
  }
  return Array.from(mapa.values());
}

// Núcleo del trabajo: enriquece dentro del presupuesto de tiempo, re-matchea e inserta.
async function enriquecerLote(lote: number) {
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const stats = { enriquecidas: 0, r429: 0, alertasNuevas: 0, excluidasPorNegativa: 0, fechasCorregidas: 0, tandas: 0 };

  const client = getMercadoPublicoClient();
  const lics = await universoActivas();
  const codigos = lics.map(l => l.Codigo);
  const keywords = await cargarKeywordsRadar();

  // `intentados` evita re-tomar los mismos códigos dentro de esta corrida (se
  // reintentan en la próxima). El caché se relee cada tanda para reflejar avance.
  const intentados = new Set<string>();
  while (elapsed() < PRESUPUESTO_MS) {
    const cache = await leerCache(codigos);
    const plan = planificarEnriquecimiento(codigos, cache, new Set(), ENRICH_TTL_DIAS);
    const aProcesar = plan.aEnriquecer.filter(c => !intentados.has(c)).slice(0, lote);
    if (aProcesar.length === 0) break;
    for (const c of aProcesar) intentados.add(c);

    const presupuestoTanda = Math.min(PRESUPUESTO_MS - elapsed(), 45_000);
    const res = await enriquecerYCachear(client, aProcesar, {
      maxMs: presupuestoTanda,
      baseDelayMs: 1_200,
      maxDelayMs: 8_000,
      guardarCada: 10,
    });
    stats.enriquecidas += res.enriquecidas;
    stats.r429         += res.r429;
    stats.tandas++;

    if (res.lics.length > 0) {
      const match = await matchearEInsertar(res.lics, keywords);
      stats.alertasNuevas        += match.alertasNuevas;
      stats.excluidasPorNegativa += match.excluidasPorNegativa;
      stats.fechasCorregidas     += match.fechasCorregidas;
    }
    // Si la API no devolvió nada (rate-limit total), no insistir en bucle.
    if (res.enriquecidas === 0) break;
  }

  // Pendientes reales tras la corrida.
  const cacheFinal = await leerCache(codigos);
  const planFinal = planificarEnriquecimiento(codigos, cacheFinal, new Set(), ENRICH_TTL_DIAS);
  return { stats, pendientes: planFinal.aEnriquecer.length, totalActivas: codigos.length, duracionMs: elapsed() };
}

async function procesar(req: NextRequest, loteRaw: unknown) {
  if (!process.env.MERCADO_PUBLICO_TICKET) {
    return NextResponse.json({ error: 'MERCADO_PUBLICO_TICKET no configurado' }, { status: 503 });
  }
  const lote = Math.min(Number(loteRaw) || LOTE_DEFAULT, 40);
  try {
    const { stats, pendientes, totalActivas, duracionMs } = await enriquecerLote(lote);
    return NextResponse.json({
      success: true,
      ...stats,
      totalActivas,
      pendientes,
      completado: pendientes === 0,
      duracionMs,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  // ?peek=1 → solo diagnóstico (sin enriquecer).
  if (req.nextUrl.searchParams.get('peek') === '1') {
    try {
      const lics = await universoActivas();
      const codigos = lics.map(l => l.Codigo);
      const cache = await leerCache(codigos);
      const plan = planificarEnriquecimiento(codigos, cache, new Set(), ENRICH_TTL_DIAS);
      return NextResponse.json({
        success: true,
        totalActivas: codigos.length,
        enriquecidas: plan.frescos.size,
        pendientes: plan.aEnriquecer.length,
      });
    } catch (e: any) {
      return NextResponse.json({ pendientes: 0, error: e.message }, { status: 500 });
    }
  }

  return procesar(req, req.nextUrl.searchParams.get('lote'));
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return procesar(req, body.lote ?? req.nextUrl.searchParams.get('lote'));
}
