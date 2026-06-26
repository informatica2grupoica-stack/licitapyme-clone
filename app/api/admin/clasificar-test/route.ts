// app/api/admin/clasificar-test/route.ts
// TEMPORAL — prueba del clasificador v2.0 sin sesión de usuario (protegido por CRON_SECRET).
// GET ?secret=...&codigo=XXXX → re-clasifica esa licitación y devuelve el detalle completo.
// Eliminar tras validar.

import { NextRequest, NextResponse } from 'next/server';
import { clasificarLicitacion } from '@/app/lib/clasificacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const codigo = req.nextUrl.searchParams.get('codigo');
  if (!codigo) return NextResponse.json({ error: 'Falta ?codigo=' }, { status: 400 });

  const t0 = Date.now();
  const r = await clasificarLicitacion(codigo);
  const ms = Date.now() - t0;

  return NextResponse.json({
    ms,
    codigo: r.codigo,
    success: r.success,
    error: r.error,
    resumen: r.resumen_licitacion,
    documentos: r.documentos.map(d => ({
      archivo: d.archivo,
      caja: d.caja,
      subtipo: d.subtipo,
      n_paginas: d.n_paginas,
      formato: d.formato,
      escaneado: d.escaneado,
      tecnicas_int: d.contiene_tecnicas_integradas,
      anexos_int: d.contiene_anexos_integrados,
      criterios: d.contiene_criterios_evaluacion,
      confianza: d.confianza,
      notas: d.notas,
    })),
  });
}
