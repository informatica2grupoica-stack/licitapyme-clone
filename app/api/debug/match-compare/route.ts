// app/api/debug/match-compare/route.ts
// Compara el matching VIEJO (texto.includes literal) vs el NUEVO (text-match.ts)
// sobre el pool real de la API, para validar el cambio antes de tocar el cron/BD.
// Solo admins.
//   GET /api/debug/match-compare?keywords=camara,articulos de aseo&dias=3&cap=150
//
// Reporta por keyword: cuántas pega cada método, cuáles GANA el nuevo (no estaban
// en el viejo) y cuáles PIERDE (estaban en el viejo y ya no), con ejemplos.

import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import type { Licitacion } from '@/app/types/mercado-publico.types';
import { indexarLicitacion, evaluarKeyword } from '@/app/lib/text-match';

const ENRICH_CONCURRENCY = 10;
const ENRICH_TIMEOUT_MS  = 8_000;

async function withConcurrency<T>(
  items: T[], limit: number, fn: (item: T) => Promise<void>,
): Promise<void> {
  const active = new Set<Promise<void>>();
  for (const item of items) {
    const p: Promise<void> = fn(item).finally(() => active.delete(p));
    active.add(p);
    if (active.size >= limit) await Promise.race(active);
  }
  if (active.size > 0) await Promise.all(active);
}

// ── Matching VIEJO (réplica exacta del cron actual) ──────────────────────────
function textoCompletoViejo(lic: Licitacion): string {
  const items = (lic.Items || [])
    .map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''} ${it.Categoria || ''}`)
    .join(' ');
  return `${lic.Nombre} ${lic.Descripcion || ''} ${items}`.toLowerCase();
}
function matchViejo(lic: Licitacion, termino: string): boolean {
  return textoCompletoViejo(lic).includes(termino);
}

// ── Campos para el matching NUEVO ────────────────────────────────────────────
function camposDe(lic: Licitacion) {
  const items = (lic.Items || []).map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''}`).join(' ');
  const categoria = (lic.Items || []).map(it => it.Categoria || '').join(' ');
  return {
    nombre: lic.Nombre || '',
    descripcion: lic.Descripcion || '',
    items,
    categoria,
  };
}

export async function GET(request: NextRequest) {
  if (request.headers.get('x-user-rol') !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }
  if (!process.env.MERCADO_PUBLICO_TICKET) {
    return NextResponse.json({ error: 'MERCADO_PUBLICO_TICKET no configurado' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const keywords = (searchParams.get('keywords') || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  const dias = Math.min(parseInt(searchParams.get('dias') || '3'), 15);
  const cap  = Math.min(parseInt(searchParams.get('cap')  || '150'), 600);

  if (keywords.length === 0) {
    return NextResponse.json({
      error: 'Parámetro requerido: ?keywords=kw1,kw2',
      ejemplo: '/api/debug/match-compare?keywords=camara,articulos de aseo&dias=3&cap=150',
    }, { status: 400 });
  }

  const t0 = Date.now();
  const client = getMercadoPublicoClient();

  // Pool igual que el cron: activas + últimos días, deduplicado
  const [activas, recientes] = await Promise.all([
    client.obtenerActivasHoy(),
    client.obtenerUltimosDias(dias),
  ]);
  const mapa = new Map<string, Licitacion>();
  for (const lic of [...activas, ...recientes]) if (!mapa.has(lic.Codigo)) mapa.set(lic.Codigo, lic);
  const pool = Array.from(mapa.values());

  // Enriquecer un cap para tener descripción/items en parte del pool
  const toEnrich = pool.slice(0, cap);
  let enriquecidas = 0;
  await withConcurrency(toEnrich, ENRICH_CONCURRENCY, async (lic) => {
    const full = await client.obtenerPorCodigoRapido(lic.Codigo, ENRICH_TIMEOUT_MS);
    if (full) { mapa.set(lic.Codigo, full); if ((full.Descripcion || '').trim()) enriquecidas++; }
  });
  const licitaciones = Array.from(mapa.values());

  // Pre-indexar para el matcher nuevo (una vez por licitación)
  const indices = new Map(licitaciones.map(l => [l.Codigo, indexarLicitacion(camposDe(l))]));

  const porKeyword = keywords.map(keyword => {
    const termino = keyword.toLowerCase().trim();

    const viejo = new Set<string>();
    const nuevo = new Set<string>();
    const scoreOf = new Map<string, number>();
    const fuenteOf = new Map<string, string[]>();

    for (const lic of licitaciones) {
      if (matchViejo(lic, termino)) viejo.add(lic.Codigo);
      const r = evaluarKeyword(indices.get(lic.Codigo)!, keyword);
      if (r.match) { nuevo.add(lic.Codigo); scoreOf.set(lic.Codigo, r.score); fuenteOf.set(lic.Codigo, r.fuentes); }
    }

    const ganadas = [...nuevo].filter(c => !viejo.has(c));
    const perdidas = [...viejo].filter(c => !nuevo.has(c));
    const nombreDe = (c: string) => licitaciones.find(l => l.Codigo === c)?.Nombre?.substring(0, 90) || '';

    return {
      keyword,
      viejo: viejo.size,
      nuevo: nuevo.size,
      ganadas: ganadas.length,
      perdidas: perdidas.length,
      muestra_ganadas: ganadas.slice(0, 8).map(c => ({
        codigo: c, nombre: nombreDe(c),
        score: Number(scoreOf.get(c)?.toFixed(3)), fuentes: fuenteOf.get(c),
      })),
      muestra_perdidas: perdidas.slice(0, 8).map(c => ({ codigo: c, nombre: nombreDe(c) })),
    };
  });

  return NextResponse.json({
    parametros: { keywords, dias, cap },
    pool: { total_unico: pool.length, enriquecidas_con_desc: enriquecidas, tiempo_ms: Date.now() - t0 },
    nota: 'ganadas = las pega el NUEVO y no el viejo (recall). perdidas = las pegaba el viejo y ya no (revisar precisión).',
    por_keyword: porKeyword,
  });
}
