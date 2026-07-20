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
import { registrarActividad } from '@/app/lib/actividad';
import { validarInformeViabilidad } from '@/app/lib/validador-viabilidad';

// Recalcula el validador (código puro, sin IA) sobre un informe YA guardado, para que las
// correcciones de reglas se vean al instante en pantalla sin gastar un re-análisis con IA. El
// _validador guardado en BD queda como snapshot del momento del análisis; este SIEMPRE pisa ese
// snapshot con el resultado fresco al servir el informe (mismo criterio de "código barato,
// recalcular siempre" del score determinista).
function conValidadorFresco(informeIA: any): any {
  if (!informeIA || informeIA._schema !== 'v3') return informeIA;
  try {
    return { ...informeIA, _validador: validarInformeViabilidad(informeIA, Number(informeIA.score_0_100) || 0) };
  } catch { return informeIA; }
}

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

// ── Re-análisis: admin sin límite; usuario normal SOLO UNA VEZ por licitación asignada ─────────
// (antes era exclusivo de admin). Se cuenta en negocios.reanalisis_usado (migración 43): la fila
// de negocios representa la asignación ACTIVA vigente, así que si se reasigna a otro perfil, la
// fila nueva/fusionada arranca en 0 — el nuevo asignado tiene su propia oportunidad.
async function estadoReanalisis(usuario: { id: number; rol: string }, codigo: string): Promise<
  { puede: true; negocioId: number | null } | { puede: false; motivo: string }
> {
  if (usuario.rol === 'admin') return { puede: true, negocioId: null };
  try {
    const [rows] = await pool.query(
      `SELECT id, reanalisis_usado FROM negocios WHERE licitacion_codigo = ? AND asignado_a = ? AND activo = TRUE LIMIT 1`,
      [codigo, usuario.id],
    ) as any[];
    const neg = (rows as any[])[0];
    if (!neg) return { puede: false, motivo: 'Solo el usuario asignado (o un administrador) puede re-analizar la viabilidad.' };
    if (Number(neg.reanalisis_usado) === 1) return { puede: false, motivo: 'Ya usaste tu única re-análisis para esta licitación. Solo un administrador puede volver a analizarla.' };
    return { puede: true, negocioId: neg.id };
  } catch {
    return { puede: false, motivo: 'No se pudo verificar el permiso de re-análisis.' };
  }
}

// GET — informe IA cacheado (si existe)
export async function GET(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) {
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
    const reanalisis = await estadoReanalisis(usuario, codigoDecoded);
    return NextResponse.json({
      success: true,
      informeIA: conValidadorFresco(informeIA),
      enProceso: job?.estado === 'procesando',
      error: job?.estado === 'error' ? (job.error || 'No se pudo completar el análisis.') : null,
      puedeReanalizar: reanalisis.puede,
      motivoNoPuedeReanalizar: reanalisis.puede ? null : reanalisis.motivo,
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

  // El PRIMER análisis (aún no hay informe guardado) lo puede correr cualquier usuario
  // autenticado con acceso (p.ej. el asignado). Re-análisis = force=1 o ya existe un informe
  // guardado: admin sin límite; usuario normal asignado, SOLO UNA VEZ (migración 43).
  const yaExiste = await leerInformeGuardado(codigoDecoded).catch(() => null);
  const esReanalisis = force || !!yaExiste;
  let negocioIdReanalisis: number | null = null;
  if (esReanalisis && usuario.rol !== 'admin') {
    const chequeo = await estadoReanalisis(usuario, codigoDecoded);
    if (!chequeo.puede) {
      return NextResponse.json({ error: chequeo.motivo }, { status: 403 });
    }
    negocioIdReanalisis = chequeo.negocioId;
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
        return NextResponse.json({ success: true, informeIA: conValidadorFresco(guardado), cacheado: true });
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
  // Bitácora: corrió (o re-corrió) el análisis de viabilidad IA (best-effort, aparece en el Historial).
  registrarActividad({
    usuarioId: usuario.id, accion: 'viabilidad',
    entidadTipo: 'licitacion', entidadId: codigoDecoded,
    descripcion: force ? 'Re-analizó la viabilidad IA' : 'Corrió el análisis de viabilidad IA',
    metadata: { licitacion_codigo: codigoDecoded, force },
  });
  analizarYGuardarViabilidadIA(codigoDecoded)
    .then((informeIA) => {
      if (!informeIA) {
        jobs.set(codigoDecoded, { estado: 'error', error: 'No hay documentos legibles para analizar. Descárgalos primero.', desde: Date.now() });
      } else {
        jobs.delete(codigoDecoded); // OK: el informe quedó guardado en BD, el GET ya lo devuelve.
        // Marca la única re-análisis del usuario normal como usada — SOLO si el análisis terminó
        // bien de verdad (si falla, no le cobramos su oportunidad).
        if (negocioIdReanalisis != null) {
          pool.query(`UPDATE negocios SET reanalisis_usado = 1 WHERE id = ?`, [negocioIdReanalisis])
            .catch(e => console.error('[licitacion-viabilidad-ia] marcar reanalisis_usado falló:', String(e)));
        }
      }
    })
    .catch((error) => {
      jobs.set(codigoDecoded, { estado: 'error', error: mensajeErrorAnalisis(error), desde: Date.now() });
    })
    .finally(() => { void liberarLock(lockKey); });

  return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });
}
