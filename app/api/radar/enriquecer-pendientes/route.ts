// app/api/radar/enriquecer-pendientes/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// ENRIQUECIMIENTO MASIVO REANUDABLE de TODAS las licitaciones activas.
//
// Problema que resuelve: la API de MP solo entrega ítems/categoría/descripción vía
// ?codigo= (1×1, con rate-limit). El batch (estado=activas) solo trae el nombre.
// Por eso, antes, una licitación cuyo match solo existía en sus ítems/categoría
// (ej. "Cámaras de Televigilancia" → rubro EQUIPAMIENTO) NUNCA se encontraba: el
// cron solo matcheaba el título y el enriquecimiento de fondo priorizaba lo ya
// matcheado. Resultado: ~6% de las activas enriquecidas.
//
// Este endpoint enriquece TODAS las activas (sin sesgo), guarda en el caché
// persistente y RE-MATCHEA cada licitación recién enriquecida contra todas las
// keywords (aplicando exclusión por palabras negativas), generando las alertas
// que faltaban. El navegador lo corre lote a lote (sin el tope de 60s de
// serverless), igual que "Descargar todos" / "Procesar PASA".
//
// El enriquecimiento solo llama a la API pública de MP → funciona desde Vercel
// (NO requiere IP chilena, a diferencia de la descarga de documentos).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import type { Licitacion } from '@/app/types/mercado-publico.types';
import { leerCache, planificarEnriquecimiento, enriquecerYCachear } from '@/app/lib/licitaciones-cache';
import { cargarKeywordsRadar, matchearEInsertar } from '@/app/lib/radar-matching';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DIAS_RECIENTES = 15;

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}
function esAdmin(req: NextRequest): boolean {
  return req.headers.get('x-user-rol') === 'admin';
}

// Trae el universo de licitaciones a cubrir: activas + últimos N días, deduplicado.
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

// GET — diagnóstico: cuántas activas faltan por enriquecer.
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!esAdmin(request)) return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });

  try {
    const lics = await universoActivas();
    const codigos = lics.map(l => l.Codigo);
    const cache = await leerCache(codigos);
    // Sin sesgo: prioritarios vacío → el plan ordena sin-caché primero.
    const plan = planificarEnriquecimiento(codigos, cache, new Set(), 7);
    return NextResponse.json({
      success: true,
      totalActivas: codigos.length,
      enriquecidas: plan.frescos.size,
      pendientes: plan.aEnriquecer.length,
    });
  } catch (error) {
    console.error('[enriquecer:GET]', String(error));
    return NextResponse.json({ error: 'No se pudo calcular pendientes' }, { status: 500 });
  }
}

// POST — enriquece un lote, re-matchea e inserta alertas. Reanudable.
// Body: { lote?: number, excluir?: string[] }
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!esAdmin(request)) return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });

  if (!process.env.MERCADO_PUBLICO_TICKET) {
    return NextResponse.json({ error: 'MERCADO_PUBLICO_TICKET no configurado' }, { status: 503 });
  }

  let lote = 12;
  let excluir: string[] = [];
  try {
    const body = await request.json();
    if (typeof body?.lote === 'number') lote = Math.max(1, Math.min(body.lote, 40));
    if (Array.isArray(body?.excluir)) excluir = body.excluir.slice(0, 2000);
  } catch { /* defaults */ }

  try {
    const client = getMercadoPublicoClient();
    const lics = await universoActivas();
    const codigos = lics.map(l => l.Codigo);
    const cache = await leerCache(codigos);

    // Sin sesgo de prioridad: cubrir TODO. El plan ordena sin-caché primero.
    const plan = planificarEnriquecimiento(codigos, cache, new Set(), 7);
    const exSet = new Set(excluir);
    const aProcesar = plan.aEnriquecer.filter(c => !exSet.has(c)).slice(0, lote);

    if (aProcesar.length === 0) {
      return NextResponse.json({
        success: true, completado: true, pendientes: 0,
        procesados: [], alertasNuevas: 0, excluidasPorNegativa: 0,
      });
    }

    // Enriquecer 1×1 (respeta rate-limit, guarda en caché). Sin tope de tiempo
    // agresivo: el navegador maneja el loop; cada POST procesa el lote completo.
    const res = await enriquecerYCachear(client, aProcesar, {
      maxMs: 270_000,        // margen amplio bajo maxDuration 300
      baseDelayMs: 1_200,
      maxDelayMs: 8_000,
      guardarCada: 10,
    });

    // Re-matchear SOLO las recién enriquecidas (las que la API devolvió) → genera
    // las alertas que faltaban, con exclusión por palabras negativas.
    const keywords = await cargarKeywordsRadar();
    const match = await matchearEInsertar(res.lics, keywords);

    // Resultado por código (para que el cliente sepa qué saltar si falló).
    const okSet = new Set(res.lics.map(l => l.Codigo));
    const procesados = aProcesar.map(codigo => ({ codigo, exito: okSet.has(codigo) }));

    // Pendientes restantes = plan total - los que ya quedaron enriquecidos en este lote.
    const pendientesRestantes = Math.max(0, plan.aEnriquecer.length - res.enriquecidas);

    return NextResponse.json({
      success: true,
      completado: false,
      procesados,
      enriquecidas: res.enriquecidas,
      r429: res.r429,
      alertasNuevas: match.alertasNuevas,
      excluidasPorNegativa: match.excluidasPorNegativa,
      fechasCorregidas: match.fechasCorregidas,
      pendientes: pendientesRestantes,
    });
  } catch (error) {
    console.error('[enriquecer:POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
