// app/api/documentos/generar-costeo/[codigo]/route.ts
// Genera el Excel de costeo para una licitación a partir de su informe de viabilidad IA.
// POST → genera el Excel, lo sube a R2 y lo registra en documentos_cache.
// GET  → verifica si ya existe uno generado.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { generarCosteoExcel, adaptarViabilidadACosteo } from '@/app/lib/generar-costeo';
import type { ViabilidadIAResult } from '@/app/lib/viabilidad-ia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ codigo: string }> };

const NOMBRE_DOC_PREFIX = 'COSTEO_';

async function leerInformeIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const [rows] = await pool.query(
    `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
    [codigo],
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const ie = typeof row.informe_ejecutivo === 'string'
      ? JSON.parse(row.informe_ejecutivo)
      : row.informe_ejecutivo;
    return ie?._informe_ia ?? null;
  } catch { return null; }
}

// GET — ¿ya existe un costeo generado para este código?
export async function GET(request: NextRequest, { params }: Params) {
  if (!(await getAuthedUser(request))) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);

  const [rows] = await pool.query(
    `SELECT documento_nombre, documento_url_local, created_at
     FROM documentos_cache
     WHERE licitacion_codigo = ? AND documento_nombre LIKE ?
     ORDER BY created_at DESC LIMIT 1`,
    [codigoDecoded, `${NOMBRE_DOC_PREFIX}%`],
  );
  const doc = (rows as any[])[0];
  return NextResponse.json({ existe: !!doc, doc: doc ?? null });
}

// POST — genera o regenera el Excel de costeo
export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);

  // 1) Leer el informe IA desde la DB
  const informeIA = await leerInformeIA(codigoDecoded);
  if (!informeIA) {
    return NextResponse.json(
      { error: 'No hay informe de viabilidad IA para esta licitación. Ejecuta el análisis IA primero.' },
      { status: 404 },
    );
  }

  // 2) Adaptar informe → datos de costeo
  const datosCosteo = adaptarViabilidadACosteo(codigoDecoded, informeIA);

  const totalItems = [...datosCosteo.lineas.values()].reduce((s, v) => s + v.length, 0);
  if (totalItems === 0) {
    return NextResponse.json(
      { error: 'El informe IA no contiene ítems/productos en el manifiesto. Verifica que el análisis haya leído las bases técnicas.' },
      { status: 422 },
    );
  }

  // 3) Generar Excel
  const buffer = generarCosteoExcel(datosCosteo);

  // 4) Subir a R2
  const fecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `${NOMBRE_DOC_PREFIX}${codigoDecoded}_${fecha}.xlsx`;
  const url = await subirDocumentoR2(codigoDecoded, nombreArchivo, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  // 5) Registrar en documentos_cache
  await pool.query(
    `INSERT INTO documentos_cache
       (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, usuario_id)
     VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', ?)
     ON DUPLICATE KEY UPDATE
       documento_url_local = VALUES(documento_url_local),
       size_bytes          = VALUES(size_bytes),
       categoria           = 'DOCUMENTOS_PROPIOS',
       updated_at          = CURRENT_TIMESTAMP`,
    [
      codigoDecoded,
      nombreArchivo,
      url,
      buffer.length,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      usuario.id,
    ],
  );

  return NextResponse.json({
    success: true,
    url,
    nombre: nombreArchivo,
    lineas: datosCosteo.lineas.size,
    items: totalItems,
  });
}
