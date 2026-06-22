// app/api/licitacion-viabilidad-ia/[codigo]/route.ts
// VIABILIDAD v2 (PROMPT 2) — Analista IA bajo demanda para UNA licitación.
// POST → Gemini lee TODOS los documentos (incl. escaneados vía visión) y emite el
//        Informe de Viabilidad completo (GANA/NO GANA con fuentes). Lo guarda anidado
//        en viabilidad_licitacion.informe_ejecutivo._informe_ia.
// GET  → devuelve el informe IA ya guardado.
//
// Requiere GEMINI_API_KEY con cuota (plan de pago de Gemini): las bases suelen ser
// PDF de imagen escaneada que solo un modelo de visión puede leer.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { analizarYGuardarViabilidadIA } from '@/app/lib/viabilidad-ia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ codigo: string }> };

// GET — informe IA cacheado (si existe)
export async function GET(_request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  try {
    const [rows] = await pool.query(
      `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
      [codigoDecoded],
    );
    const row = (rows as any[])[0];
    let informeIA = null;
    if (row) {
      try {
        const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
        informeIA = ie?._informe_ia ?? null;
      } catch { /* json inválido */ }
    }
    return NextResponse.json({ success: true, informeIA });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — corre el analista IA (Gemini) sobre los documentos de la licitación
export async function POST(_request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY no configurada.' }, { status: 503 });
  }

  try {
    const informeIA = await analizarYGuardarViabilidadIA(codigoDecoded);
    if (!informeIA) {
      return NextResponse.json(
        { error: 'No hay documentos legibles para analizar. Descárgalos primero.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, informeIA });
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    // Cuota de Gemini agotada → mensaje claro para el usuario.
    if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
      return NextResponse.json(
        { error: 'Gemini sin cuota (429). Activa el plan de pago de Gemini para tu API key.' },
        { status: 429 },
      );
    }
    console.error('[licitacion-viabilidad-ia] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
