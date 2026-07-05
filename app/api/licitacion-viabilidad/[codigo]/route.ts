// app/api/licitacion-viabilidad/[codigo]/route.ts
// Fase 2 — Score de Viabilidad por licitación.
// GET  → devuelve la viabilidad guardada en BD.
// POST → asegura el análisis exhaustivo (lo genera si falta) y calcula + guarda la viabilidad.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { rowToViabilidad } from '@/app/lib/viabilidad';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';
import { puedeVerLicitacion, esExterno } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ codigo: string }> };

// ─── GET — viabilidad cacheada ────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const [rows] = await pool.query(
      `SELECT * FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
      [codigoDecoded],
    );
    const row = (rows as any[])[0];
    if (!row) return NextResponse.json({ success: true, viabilidad: null });
    return NextResponse.json({ success: true, viabilidad: rowToViabilidad(row) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ─── POST — calcular (genera análisis exhaustivo si falta) ────────────────────
export async function POST(request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);

  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const forzar = body.forzar === true;
    // El EXTERNO puede correr la PRIMERA viabilidad, pero no re-analizar (forzar).
    if (forzar && await esExterno(request))
      return NextResponse.json({ error: 'No autorizado para re-analizar' }, { status: 403 });

    // Pipeline completo: Fase 1 (clasificar) → análisis exhaustivo (si falta) → viabilidad
    const res = await procesarLicitacionCompleta(codigoDecoded, { forzar });
    if (!res.ok || !res.viabilidad) {
      return NextResponse.json(
        { error: res.error || 'No se pudo calcular la viabilidad. Verifica que haya documentos descargados.' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, viabilidad: res.viabilidad });
  } catch (error) {
    console.error('[licitacion-viabilidad] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
