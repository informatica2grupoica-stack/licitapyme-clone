// app/api/documentos/clasificar/route.ts
// Clasificador Documental v1.3 — PROMPT 1 (Fase 1).
// La lógica central vive en app/lib/clasificacion.ts (reutilizada por el pipeline).
// POST { codigo } → clasifica y persiste la categoría de cada documento.
// PATCH → mueve un documento a otra caja manualmente.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { clasificarLicitacion } from '@/app/lib/clasificacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ─── POST /api/documentos/clasificar ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  let codigo: string;
  try {
    const body = await req.json();
    codigo = body.codigo?.trim();
    if (!codigo) throw new Error('Falta código');
  } catch {
    return NextResponse.json({ error: 'Body inválido — se espera { codigo: string }' }, { status: 400 });
  }

  try {
    const r = await clasificarLicitacion(codigo);
    if (!r.success) {
      return NextResponse.json({ error: r.error || 'No se pudo clasificar', codigo, disponibles: 0 }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      codigo,
      licitacion_nombre: r.licitacion_nombre,
      total: r.total,
      resumen_licitacion: r.resumen_licitacion,
      documentos: r.documentos,
      cajas: r.cajas,
      clasificadoAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[clasificar] Error:', error);
    return NextResponse.json({ error: `Error al clasificar: ${String(error)}`, codigo }, { status: 500 });
  }
}

// ─── PATCH /api/documentos/clasificar — mover un documento a otra caja ────────
export async function PATCH(req: NextRequest) {
  try {
    const { codigo, documento_nombre, nueva_categoria } = await req.json();
    if (!codigo || !documento_nombre || !nueva_categoria) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }
    await pool.query(
      `UPDATE documentos_cache SET categoria = ? WHERE licitacion_codigo = ? AND documento_nombre = ?`,
      [nueva_categoria, codigo, documento_nombre],
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
