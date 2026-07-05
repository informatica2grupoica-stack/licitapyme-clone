// app/api/licitacion-ia/[codigo]/route.ts
// Análisis exhaustivo con Gemini de TODOS los documentos de una licitación.
// GET  → devuelve el análisis guardado en BD.
// POST → extrae texto de todos los documentos, analiza con Gemini y guarda.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { generarAnalisisExhaustivo } from '@/app/lib/analisis-exhaustivo';
import { puedeVerLicitacion, esExterno } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ codigo: string }> };

// ─── Fila de BD → objeto de análisis ─────────────────────────────────────────
function parseJSON<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function rowToAnalisis(row: any) {
  return {
    presupuesto: row.presupuesto_monto != null
      ? { monto: row.presupuesto_monto, moneda: row.presupuesto_moneda || 'CLP' }
      : null,
    plazoEjecucionDias:   row.plazo_ejecucion_dias   ?? null,
    plazoEntregaDias:     row.plazo_entrega_dias      ?? null,
    modalidadAdjudicacion: row.modalidad_adjudicacion ?? null,
    tipoContrato:         row.tipo_contrato           ?? null,
    lugarEntrega:         row.lugar_entrega           ?? null,
    criteriosEvaluacion:  parseJSON(row.criterios_evaluacion)    || [],
    requisitos:           parseJSON(row.requisitos)              || null,
    garantias:            parseJSON(row.garantias)               || [],
    multas:               parseJSON(row.multas)                  || [],
    contacto:             parseJSON(row.contacto)                ?? null,
    especificacionesTecnicas: parseJSON(row.especificaciones_tecnicas) || [],
    documentosAPresenter: parseJSON(row.documentos_a_presentar)  || [],
    resumenBasesAdmin:    parseJSON(row.resumen_bases_admin)      ?? null,
    resumenBasesTecnicas: parseJSON(row.resumen_bases_tecnicas)   ?? null,
    analisisExperto:      parseJSON(row.analisis_experto)         || null,
    documentoAnalizado:   row.documento_analizado,
    documentosDetalle:    parseJSON(row.documentos_detalle)        || null,
    modelo:               row.modelo,
    actualizado:          row.updated_at,
  };
}

// ─── GET — análisis cacheado ──────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const [rows] = await pool.query(
      `SELECT * FROM analisis_ia_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
      [codigoDecoded]
    );
    const row = (rows as any[])[0];
    if (!row) return NextResponse.json({ success: true, analisis: null });
    return NextResponse.json({ success: true, analisis: rowToAnalisis(row) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ─── POST — analiza todos los documentos y guarda TODO ────────────────────────
// Delega en generarAnalisisExhaustivo (lógica centralizada): extrae texto de cada
// documento, registra el detalle por documento (analizado / pendiente + motivo) y
// guarda el análisis completo. Luego devuelve la fila guardada (incluye documentosDetalle).
export async function POST(request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  // Re-generar el análisis = "re-analizar": el EXTERNO no puede.
  if (await esExterno(request))
    return NextResponse.json({ error: 'No autorizado para re-analizar' }, { status: 403 });
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const documentos: Array<{ url: string; nombre: string; categoria?: string | null }> = body.documentos || [];

    const r = await generarAnalisisExhaustivo(codigoDecoded, documentos.length > 0 ? documentos : undefined);
    if (!r.ok) {
      return NextResponse.json({ error: r.error || 'No se pudo analizar la licitación.' }, { status: 400 });
    }

    // Releer la fila guardada para devolver el análisis completo (con documentosDetalle).
    const [rows] = await pool.query(
      `SELECT * FROM analisis_ia_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
      [codigoDecoded]
    );
    const row = (rows as any[])[0];
    return NextResponse.json({ success: true, analisis: row ? rowToAnalisis(row) : null });

  } catch (error) {
    console.error('[licitacion-ia] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
