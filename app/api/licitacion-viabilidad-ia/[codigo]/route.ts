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

// ── Registro EN MEMORIA de análisis en curso ──────────────────────────────────────────────
// El análisis de viabilidad tarda 1-3 min (OCR + IA). El túnel de Cloudflare corta cualquier
// respuesta HTTP a los ~100s, así que NO se puede esperar el resultado en la misma petición.
// Solución: el POST arranca el análisis en SEGUNDO PLANO y responde de inmediato ("procesando");
// el GET informa si sigue en curso o si terminó con error, y el front hace polling hasta que
// aparece el informe. Este mapa vive en el proceso (el notebook corre un server Node persistente,
// no serverless), así que el estado del job se conserva entre el POST y los GET de polling.
type EstadoJob = { estado: 'procesando' | 'error'; error?: string; desde: number };
const jobs = new Map<string, EstadoJob>();

// Traduce el error interno del análisis a un mensaje claro para el usuario.
function mensajeErrorAnalisis(error: unknown): string {
  const msg = String((error as any)?.message ?? error);
  if (msg.includes('429') || msg.toLowerCase().includes('quota')) return 'El servicio de IA quedó sin cuota (429). Reintenta más tarde.';
  if (msg.includes('saturad') || msg.includes('503')) return 'El servicio de IA está saturado en este momento. Reintenta en unos minutos.';
  console.error('[licitacion-viabilidad-ia] Error de fondo:', msg);
  return 'No se pudo completar el análisis. Reintenta en unos minutos.';
}

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
    // Estado del análisis en segundo plano (para el polling del front).
    const job = jobs.get(codigoDecoded);
    return NextResponse.json({
      success: true,
      informeIA,
      enProceso: job?.estado === 'procesando',
      error: job?.estado === 'error' ? (job.error || 'No se pudo completar el análisis.') : null,
    });
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

  // 4) ¿Ya hay un análisis en curso para este código? Responder "procesando" (no es un error):
  //    el front seguirá con su polling y tomará el resultado cuando el job que ya corre termine.
  if (jobs.get(codigoDecoded)?.estado === 'procesando') {
    return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });
  }

  // 5) Lock: evita que dos disparos simultáneos del mismo código gasten IA dos veces.
  const lockKey = `viab:${codigoDecoded}`;
  if (!(await tomarLock(lockKey, 300))) {
    // Otro proceso/instancia ya lo está corriendo: tratarlo como "procesando", no como error.
    return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });
  }

  // 6) Arranca el análisis en SEGUNDO PLANO y responde de inmediato (antes del límite ~100s del
  //    túnel). El resultado se guarda en BD; el front lo recoge por polling del GET. NO await:
  //    el server del notebook es persistente, así que la promesa sigue viva tras responder.
  jobs.set(codigoDecoded, { estado: 'procesando', desde: Date.now() });
  analizarYGuardarViabilidadIA(codigoDecoded)
    .then((informeIA) => {
      if (!informeIA) {
        jobs.set(codigoDecoded, { estado: 'error', error: 'No hay documentos legibles para analizar. Descárgalos primero.', desde: Date.now() });
      } else {
        jobs.delete(codigoDecoded); // OK: el informe quedó guardado en BD, el GET ya lo devuelve.
      }
    })
    .catch((error) => {
      jobs.set(codigoDecoded, { estado: 'error', error: mensajeErrorAnalisis(error), desde: Date.now() });
    })
    .finally(() => { void liberarLock(lockKey); });

  return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });
}
