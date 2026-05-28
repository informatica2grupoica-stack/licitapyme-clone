// app/api/debug/test-two-pass/route.ts
// Prueba el two-pass en vivo para una keyword específica.
// Solo admins.
// GET /api/debug/test-two-pass?keyword=mantenimiento&dias=1

import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import type { Licitacion } from '@/app/types/mercado-publico.types';

const ENRICH_CONCURRENCY = 10;
const ENRICH_TIMEOUT_MS  = 8_000;
const ENRICH_CAP         = 100; // solo 100 para que el test sea rápido

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

function textoCompleto(lic: Licitacion): string {
  const items = (lic.Items || [])
    .map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''} ${it.Categoria || ''}`)
    .join(' ');
  return `${lic.Nombre} ${lic.Descripcion || ''} ${items}`.toLowerCase();
}

export async function GET(request: NextRequest) {
  const rol = request.headers.get('x-user-rol');
  if (rol !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  if (!process.env.MERCADO_PUBLICO_TICKET) {
    return NextResponse.json({ error: 'MERCADO_PUBLICO_TICKET no configurado' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const keyword = (searchParams.get('keyword') || '').toLowerCase().trim();
  const dias    = Math.min(parseInt(searchParams.get('dias') || '3'), 7);

  if (!keyword) {
    return NextResponse.json({
      error: 'Parámetro requerido: ?keyword=TEXTO',
      ejemplo: '/api/debug/test-two-pass?keyword=mantenimiento&dias=3',
    }, { status: 400 });
  }

  const t0     = Date.now();
  const client = getMercadoPublicoClient();

  // ── Paso 0: Descarga batch ────────────────────────────────────────────────
  const licitaciones = await client.obtenerUltimosDias(dias);
  const tiempoDescarga = Date.now() - t0;

  // ── Paso 1: Filtro por Nombre únicamente ──────────────────────────────────
  const porNombre = licitaciones.filter(l =>
    l.Nombre.toLowerCase().includes(keyword)
  );
  const codigosPorNombre = new Set(porNombre.map(l => l.Codigo));

  // ── Paso 2: Enriquecer con descripción (las primeras ENRICH_CAP) ──────────
  const toEnrich = licitaciones
    .sort((a, b) => new Date(b.FechaPublicacion || 0).getTime() - new Date(a.FechaPublicacion || 0).getTime())
    .slice(0, ENRICH_CAP);

  const enrichedMap = new Map<string, Licitacion>(licitaciones.map(l => [l.Codigo, l]));
  let enriquecidas = 0;

  await withConcurrency(toEnrich, ENRICH_CONCURRENCY, async (lic) => {
    const full = await client.obtenerPorCodigoRapido(lic.Codigo, ENRICH_TIMEOUT_MS);
    if (full) {
      enrichedMap.set(lic.Codigo, full);
      if ((full.Descripcion || '').trim().length > 0) enriquecidas++;
    }
  });

  // ── Paso 3: Re-filtrar con texto completo ─────────────────────────────────
  const porTextoCompleto = Array.from(enrichedMap.values()).filter(l =>
    textoCompleto(l).includes(keyword)
  );

  // Separar: los que ya estaban en paso 1 vs los nuevos (solo en descripción)
  const soloEnDescripcion = porTextoCompleto.filter(l => !codigosPorNombre.has(l.Codigo));
  const confirmadosPorNombre = porTextoCompleto.filter(l =>  codigosPorNombre.has(l.Codigo));

  const tiempoTotal = Date.now() - t0;

  return NextResponse.json({
    keyword,
    dias_analizados:     dias,
    total_batch:         licitaciones.length,
    enriquecidas_con_desc: enriquecidas,
    cap_enriquecimiento: ENRICH_CAP,
    timing: {
      descarga_ms:   tiempoDescarga,
      total_ms:      tiempoTotal,
    },

    resultados: {
      por_nombre:           porNombre.length,
      por_texto_completo:   porTextoCompleto.length,
      nuevos_por_descripcion: soloEnDescripcion.length,
      ganancia_pct: porNombre.length > 0
        ? `+${Math.round(soloEnDescripcion.length / porNombre.length * 100)}%`
        : soloEnDescripcion.length > 0 ? '∞ (0 por nombre, todos por descripción)' : 'sin coincidencias',
    },

    // Muestra los primeros 5 que solo aparecen en descripción (el valor del two-pass)
    muestra_nuevos_por_descripcion: soloEnDescripcion.slice(0, 5).map(l => ({
      codigo:      l.Codigo,
      nombre:      l.Nombre.substring(0, 100),
      descripcion: (l.Descripcion || '').substring(0, 300),
      organismo:   l.Organismo?.substring(0, 60),
    })),

    // Muestra los primeros 5 que ya salían por nombre (control)
    muestra_por_nombre: confirmadosPorNombre.slice(0, 5).map(l => ({
      codigo:  l.Codigo,
      nombre:  l.Nombre.substring(0, 100),
    })),

    nota: enriquecidas === 0
      ? '⚠️ La API no devolvió descripciones — la búsqueda solo opera en Nombre'
      : `✅ Two-pass activo — se buscó en Nombre + Descripcion de ${enriquecidas} licitaciones`,
  });
}
