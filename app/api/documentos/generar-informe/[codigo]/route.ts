// app/api/documentos/generar-informe/[codigo]/route.ts
// Genera el DOCUMENTO del informe de viabilidad (PDF) desde el informe IA ya guardado.
// POST → arma el PDF, lo sube a R2 y lo registra en documentos_cache. GET → ¿ya existe uno?
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion } from '@/app/lib/api-auth';
import { autoGenerarInformePdf } from '@/app/lib/viabilidad-ia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ codigo: string }> };
const NOMBRE_DOC_PREFIX = 'INFORME_';

// Lee el informe v3 (preferido) o v2 guardado.
async function leerInforme(codigo: string): Promise<any | null> {
  const [rows] = await pool.query(
    `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
    return ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
  } catch { return null; }
}

// GET — ¿ya existe un informe PDF generado?
export async function GET(request: NextRequest, { params }: Params) {
  if (!(await getAuthedUser(request))) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  const [rows] = await pool.query(
    `SELECT documento_nombre, documento_url_local, created_at FROM documentos_cache
     WHERE licitacion_codigo = ? AND documento_nombre LIKE ? ORDER BY created_at DESC LIMIT 1`,
    [codigoDecoded, `${NOMBRE_DOC_PREFIX}%`]);
  const doc = (rows as any[])[0];
  return NextResponse.json({ existe: !!doc, doc: doc ?? null });
}

// POST — genera o regenera el PDF del informe
export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  const informe = await leerInforme(codigoDecoded);
  if (!informe) {
    return NextResponse.json(
      { error: 'No hay informe de viabilidad para esta licitación. Ejecuta el análisis primero.' }, { status: 404 });
  }

  try {
    const url = await autoGenerarInformePdf(codigoDecoded, informe);
    // url === null → no se detectó maquinaria/equipos (el informe técnico solo aplica a equipamiento).
    if (!url) {
      return NextResponse.json({ success: true, sin_equipamiento: true, url: null,
        mensaje: 'No se detectó maquinaria/equipos en esta licitación: el informe técnico solo se genera para equipamiento.' });
    }
    return NextResponse.json({ success: true, url, nombre: `${NOMBRE_DOC_PREFIX}${codigoDecoded}` });
  } catch (e) {
    console.error(`[informe-tecnico] ${codigoDecoded}: error generando PDF:`, String(e).slice(0, 300));
    return NextResponse.json({ error: 'No se pudo generar el informe técnico. Reintenta en unos minutos.' }, { status: 500 });
  }
}
