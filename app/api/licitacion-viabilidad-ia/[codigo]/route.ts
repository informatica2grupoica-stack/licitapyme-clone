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
import { analizarYGuardarViabilidadIA, calcularDocsHash } from '@/app/lib/viabilidad-ia';
import { getAuthedUser, tomarLock, liberarLock, permitido, puedeVerLicitacion } from '@/app/lib/api-auth';
import { iaTextoConfigurada } from '@/app/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ codigo: string }> };

// Lee el informe IA ya guardado (o null) sin volver a llamar al modelo.
async function leerInformeGuardado(codigo: string): Promise<any | null> {
  const [rows] = await pool.query(
    `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
    // Prefiere el informe v3 (nuevo esquema modular) si existe; si no, el v2.
    return ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
  } catch { return null; }
}

// GET — informe IA cacheado (si existe)
export async function GET(request: NextRequest, { params }: Params) {
  if (!(await getAuthedUser(request))) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
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
        informeIA = ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;   // prefiere v3 si existe
      } catch { /* json inválido */ }
    }
    return NextResponse.json({ success: true, informeIA });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — corre el analista IA (Gemini) sobre los documentos de la licitación
export async function POST(request: NextRequest, { params }: Params) {
  // 1) Autenticación verificada contra el JWT (no contra el header del cliente).
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  const force = new URL(request.url).searchParams.get('force') === '1';

  // RE-analizar es SOLO admin. El PRIMER análisis (aún no hay informe guardado) lo puede
  // correr cualquier usuario autenticado (p.ej. el asignado). Re-análisis = force=1 o ya
  // existe un informe guardado.
  if (usuario.rol !== 'admin') {
    const yaExiste = await leerInformeGuardado(codigoDecoded).catch(() => null);
    if (force || yaExiste) {
      return NextResponse.json({ error: 'Solo un administrador puede re-analizar la viabilidad.' }, { status: 403 });
    }
  }

  // El análisis PROMPT 2 corre sobre el proveedor de texto activo (GLM de Z.AI).
  // Gemini está retirado: ya no cuenta como proveedor configurado.
  if (!iaTextoConfigurada()) {
    return NextResponse.json({ error: 'No hay proveedor de IA configurado (ZAI_API_KEY).' }, { status: 503 });
  }

  // 2) Rate-limit por usuario: el análisis es caro (Gemini visión, hasta 5 min).
  if (!(await permitido(`viabilidad:${usuario.id}`, 20, 600))) {
    return NextResponse.json({ error: 'Demasiados análisis seguidos. Espera unos minutos.' }, { status: 429 });
  }

  // 3) Cache por huella de documentos: si nada cambió, devolver el informe guardado.
  if (!force) {
    try {
      const [guardado, hashActual] = await Promise.all([leerInformeGuardado(codigoDecoded), calcularDocsHash(codigoDecoded)]);
      if (guardado && hashActual && guardado.docs_hash === hashActual) {
        return NextResponse.json({ success: true, informeIA: guardado, cacheado: true });
      }
    } catch { /* si falla la comprobación, seguimos al análisis normal */ }
  }

  // 4) Lock: evita que dos disparos simultáneos del mismo código gasten Gemini dos veces.
  const lockKey = `viab:${codigoDecoded}`;
  if (!(await tomarLock(lockKey, 300))) {
    return NextResponse.json({ error: 'Ya hay un análisis en curso para esta licitación.' }, { status: 409 });
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
    // Saturación transitoria de Gemini → mensaje accionable, sin filtrar el detalle interno.
    if (msg.includes('saturad') || msg.includes('503')) {
      return NextResponse.json({ error: 'Gemini está saturado en este momento. Reintenta en unos minutos.' }, { status: 503 });
    }
    console.error('[licitacion-viabilidad-ia] Error:', msg);
    return NextResponse.json({ error: 'No se pudo completar el análisis.' }, { status: 500 });
  } finally {
    await liberarLock(lockKey);
  }
}
