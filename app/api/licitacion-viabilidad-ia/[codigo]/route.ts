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

// ── Registro del análisis en curso, PERSISTIDO EN BD (tabla viabilidad_jobs, migration-68) ─────
// El análisis de viabilidad tarda 1-3 min normal (OCR + IA), hasta ~10 min en el peor caso
// (cadena de respaldo GLM agotando todos sus timeouts). El túnel/proxy corta cualquier respuesta
// HTTP a los ~100s, así que NO se puede esperar el resultado en la misma petición: el POST
// arranca el análisis en SEGUNDO PLANO y responde de inmediato ("procesando"); el GET informa si
// sigue en curso, terminó con error, o quedó HUÉRFANO, y el front hace polling hasta enterarse.
//
// 13-ago-2026 (bug real, reportado por el usuario en 1171142-100-LE26): esto ANTES vivía en un
// `Map` en memoria del proceso. Si el contenedor se reinicia mientras un análisis corre —
// exactamente lo que pasa al desplegar (`docker compose up -d --build`), como ese mismo día—
// el job muere sin dejar rastro: el Map queda vacío, el GET reporta "nada en curso, sin error,
// sin informe", y el front lo interpretaba como "terminó sin cambios" — la pantalla se cortaba
// en silencio sin decir jamás qué pasó. Persistir en BD sobrevive el reinicio; y si de verdad
// el proceso murió a mitad de camino, `jobHuerfano()` en el GET lo detecta por el `actualizado_at`
// congelado y lo marca error explícito en vez de fingir que no pasó nada.
const VIABILIDAD_JOB_TIMEOUT_MS = Math.max(120_000, Number(process.env.VIABILIDAD_JOB_TIMEOUT_MS) || 10 * 60_000);
const HUERFANO_MARGEN_MS = 90_000; // margen sobre el tope antes de declarar un job huérfano (reloj del server vs. del setInterval de fondo)

type FilaJob = {
  estado: 'procesando' | 'error'; fase: string | null; error: string | null; run_id: string;
  iniciado_at: string; actualizado_at: string; edad_seg: number; elapsed_seg: number;
};

// BUG REAL (14-ago-2026, reportado por el usuario, reproducido en 1057494-50-LR26 — ver también
// 1261-27-LP26): el job huérfano se marcaba a los POCOS SEGUNDOS de arrancar cualquier análisis,
// siempre, no solo tras un reinicio real del contenedor. Causa: `NOW()` de MySQL devuelve la hora
// del SYSTEM del servidor de Bluehost (verificado en vivo: UTC-6, NI la del servidor de la app —
// America/Santiago, UTC-4 — NI UTC real), pero se leía de vuelta con `new Date(job.actualizado_at)`
// en JS, que mysql2 (`timezone:'local'`, ver db.ts) interpreta como si esa hora YA fuera
// America/Santiago. El resultado: cada `edadMs` calculado así traía un sesgo fijo de ~2 HORAS de
// más — muy por encima del margen de huérfano (11.5 min) — así que el primer poll del navegador
// (a los 5s) ya veía el job como "abandonado hace 2 horas" y lo marcaba error de inmediato, sin
// importar que la IA estuviera respondiendo perfecto. El mismo sesgo inflaba `elapsedMs` (la barra
// de progreso IBA SIEMPRE al 97% desde el primer render, con un contador de minutos absurdo).
// Fix: la resta de tiempos se hace DENTRO de MySQL (`TIMESTAMPDIFF` contra `UTC_TIMESTAMP()`, con
// las columnas también escritas en UTC) — nunca cruza el límite Node/mysql2 donde vivía el sesgo.
async function leerJob(codigo: string): Promise<FilaJob | null> {
  const [rows] = await pool.query(
    `SELECT *,
            TIMESTAMPDIFF(SECOND, actualizado_at, UTC_TIMESTAMP()) AS edad_seg,
            TIMESTAMPDIFF(SECOND, iniciado_at, UTC_TIMESTAMP()) AS elapsed_seg
       FROM viabilidad_jobs WHERE licitacion_codigo = ? LIMIT 1`,
    [codigo],
  );
  return (rows as any[])[0] ?? null;
}

async function marcarJobProcesando(codigo: string, runId: string): Promise<void> {
  await pool.query(
    `INSERT INTO viabilidad_jobs (licitacion_codigo, run_id, estado, fase, error, iniciado_at, actualizado_at)
     VALUES (?, ?, 'procesando', 'leyendo_documentos', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE run_id = VALUES(run_id), estado = 'procesando', fase = 'leyendo_documentos', error = NULL, iniciado_at = UTC_TIMESTAMP(), actualizado_at = UTC_TIMESTAMP()`,
    [codigo, runId],
  );
}

// Actualiza la FASE de un job en curso — best-effort (si falla, no debe tumbar el análisis) y
// solo si el `run_id` sigue siendo el mismo (evita que un job viejo, ya reemplazado por un
// re-análisis más nuevo, escriba encima del estado del nuevo).
async function actualizarFaseJob(codigo: string, runId: string, fase: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE viabilidad_jobs SET fase = ?, actualizado_at = UTC_TIMESTAMP() WHERE licitacion_codigo = ? AND run_id = ? AND estado = 'procesando'`,
      [fase, codigo, runId],
    );
  } catch (e) { console.error(`[licitacion-viabilidad-ia] ${codigo}: no se pudo actualizar fase="${fase}":`, String(e).slice(0, 200)); }
}

async function marcarJobError(codigo: string, runId: string, mensaje: string): Promise<void> {
  await pool.query(
    `UPDATE viabilidad_jobs SET estado = 'error', error = ?, actualizado_at = UTC_TIMESTAMP() WHERE licitacion_codigo = ? AND run_id = ?`,
    [mensaje.slice(0, 500), codigo, runId],
  );
}

// BUG REAL (14-ago-2026, reportado por el usuario): cuando el TOPE DURO de arriba dispara, la
// llamada de fondo (`analizarYGuardarViabilidadIA`) NO se cancela — sigue corriendo y, si termina
// bien poco después, guarda el informe real DENTRO de su propia ejecución (ver
// guardarViabilidadIAV3 en viabilidad-ia.ts), sin relación con esta carrera. El usuario vio la
// vista de error roja, pero el informe SÍ había quedado guardado — solo se enteró al refrescar la
// página a mano, porque el polling del front paraba apenas veía CUALQUIER error (ver
// iniciarPolling en ViabilidadIAPanel.tsx). Este prefijo marca el error del tope duro como
// "puede que el trabajo de fondo siga terminando" — a diferencia de un job huérfano de verdad
// (el proceso murió con el contenedor, ahí no hay nada corriendo) o un error real de la IA (cuota,
// sin documentos legibles): esos SÍ son finales. El front usa esto para seguir consultando en vez
// de darse por vencido con un error que puede quedar obsoleto en segundos.
const PREFIJO_ERROR_TEMPORAL = '[TEMPORAL] ';

// Job terminado OK: se borra el registro (el resultado ya vive en viabilidad_licitacion, que es
// lo que lee el GET). Guardado por run_id: si el usuario ya arrancó OTRO análisis (re-análisis
// tras un timeout), esta corrida vieja no debe borrar el job del nuevo.
async function marcarJobListo(codigo: string, runId: string): Promise<void> {
  await pool.query(`DELETE FROM viabilidad_jobs WHERE licitacion_codigo = ? AND run_id = ?`, [codigo, runId]);
}

// Traduce el error interno del análisis a un mensaje claro para el usuario. SIEMPRE loguea el
// detalle completo (mensaje + stack si lo hay) — antes solo quedaba el mensaje genérico visible
// para el usuario y el detalle real se perdía si no se miraba la consola del contenedor en vivo.
function mensajeErrorAnalisis(codigo: string, error: unknown): string {
  const msg = String((error as any)?.message ?? error);
  console.error(`[licitacion-viabilidad-ia] ${codigo}: Error de fondo — ${msg}`, (error as any)?.stack ? `\n${(error as any).stack}` : '');
  if (msg.includes('429') || msg.toLowerCase().includes('quota')) return 'El servicio de IA quedó sin cuota (429). Reintenta más tarde.';
  if (msg.includes('saturad') || msg.includes('503')) return 'El servicio de IA está saturado en este momento. Reintenta en unos minutos.';
  return `No se pudo completar el análisis. Reintenta en unos minutos. (${msg.slice(0, 160)})`;
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
    // Estado del análisis en segundo plano (para el polling del front). Persistido en BD
    // (viabilidad_jobs, migration-68): sobrevive un reinicio del contenedor a mitad de análisis.
    let job = await leerJob(codigoDecoded);
    // Job HUÉRFANO: sigue "procesando" pero nadie actualizó `actualizado_at` hace más del tope +
    // margen — el proceso que lo corría murió (reinicio/deploy/crash) sin poder avisar. Antes
    // esto se veía como "no hay nada corriendo" (silencio); ahora se declara error explícito.
    if (job?.estado === 'procesando') {
      const edadMs = job.edad_seg * 1000;
      if (edadMs > VIABILIDAD_JOB_TIMEOUT_MS + HUERFANO_MARGEN_MS) {
        const msg = 'El análisis se interrumpió (probablemente el servidor se reinició a mitad de camino, p.ej. por un despliegue). Vuelve a intentarlo.';
        console.error(`[licitacion-viabilidad-ia] ${codigoDecoded}: job huérfano detectado (sin actualizar hace ${Math.round(edadMs / 1000)}s) — marcado error.`);
        await marcarJobError(codigoDecoded, job.run_id, msg).catch(() => {});
        job = { ...job, estado: 'error', error: msg };
      }
    }
    const reanalisis = await estadoReanalisis(usuario, codigoDecoded);
    const errorCrudo = job?.estado === 'error' ? (job.error || 'No se pudo completar el análisis.') : null;
    return NextResponse.json({
      success: true,
      informeIA: conValidadorFresco(informeIA),
      enProceso: job?.estado === 'procesando',
      error: errorCrudo?.startsWith(PREFIJO_ERROR_TEMPORAL) ? errorCrudo.slice(PREFIJO_ERROR_TEMPORAL.length) : errorCrudo,
      // El trabajo de fondo del tope duro NO se cancela (ver el prefijo más arriba) — puede seguir
      // corriendo y guardar un informe real segundos/minutos después de marcarse "error". El front
      // usa esto para seguir consultando en vez de darse por vencido con un error obsoleto.
      errorPuedeSerTemporal: !!errorCrudo?.startsWith(PREFIJO_ERROR_TEMPORAL),
      // Para la barra de progreso del front: fase actual + segundos transcurridos + tope duro.
      fase: job?.estado === 'procesando' ? job.fase : null,
      elapsedMs: job ? job.elapsed_seg * 1000 : null,
      timeoutMs: VIABILIDAD_JOB_TIMEOUT_MS,
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
  const jobPrevio = await leerJob(codigoDecoded);
  if (jobPrevio?.estado === 'procesando') {
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
  //    el server es persistente, así que la promesa sigue viva tras responder.
  //
  //    TOPE DURO de 10 minutos (13-ago-2026, pedido explícito del usuario): la cadena de modelos
  //    de respaldo (gemini.ts) puede, en el peor caso, tardar ~610s ELLA SOLA (130s primario + 2
  //    respaldos × 240s) sin contar la lectura/OCR de los documentos — así que no alcanza con
  //    afinar los timeouts internos, hace falta un plazo GLOBAL a nivel de este job. Si se agota,
  //    el job se marca error de inmediato (el usuario deja de ver "procesando" para siempre) — la
  //    promesa de abajo puede seguir viva en el proceso (no se cancela el fetch en curso, ver
  //    nota de `settled`), pero deja de bloquear la experiencia del usuario. `run_id` evita que
  //    esa promesa vieja, si termina más tarde, pise el estado de un re-análisis posterior.
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await marcarJobProcesando(codigoDecoded, runId);
  // Bitácora: corrió (o re-corrió) el análisis de viabilidad IA (best-effort, aparece en el Historial).
  registrarActividad({
    usuarioId: usuario.id, accion: 'viabilidad',
    entidadTipo: 'licitacion', entidadId: codigoDecoded,
    descripcion: force ? 'Re-analizó la viabilidad IA' : 'Corrió el análisis de viabilidad IA',
    metadata: { licitacion_codigo: codigoDecoded, force },
  });

  let settled = false; // true en cuanto el tope duro dispara — evita que el resultado tardío pise un re-análisis nuevo sin querer (se sigue guardando por run_id de todas formas)
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => { settled = true; reject(new Error(`TOPE_DURO_${VIABILIDAD_JOB_TIMEOUT_MS}ms`)); }, VIABILIDAD_JOB_TIMEOUT_MS);
  });

  Promise.race([
    analizarYGuardarViabilidadIA(codigoDecoded, (fase) => { if (!settled) void actualizarFaseJob(codigoDecoded, runId, fase); }),
    deadline,
  ])
    .then((informeIA) => {
      if (!informeIA) {
        void marcarJobError(codigoDecoded, runId, 'No hay documentos legibles para analizar. Descárgalos primero.');
      } else {
        void marcarJobListo(codigoDecoded, runId); // OK: el informe quedó guardado en BD, el GET ya lo devuelve.
        // Marca la única re-análisis del usuario normal como usada — SOLO si el análisis terminó
        // bien de verdad (si falla, no le cobramos su oportunidad).
        if (negocioIdReanalisis != null) {
          pool.query(`UPDATE negocios SET reanalisis_usado = 1 WHERE id = ?`, [negocioIdReanalisis])
            .catch(e => console.error('[licitacion-viabilidad-ia] marcar reanalisis_usado falló:', String(e)));
        }
      }
    })
    .catch((error) => {
      const esTopeDuro = String((error as any)?.message ?? '').startsWith('TOPE_DURO_');
      const msg = esTopeDuro
        ? `${PREFIJO_ERROR_TEMPORAL}El análisis superó el tope de ${Math.round(VIABILIDAD_JOB_TIMEOUT_MS / 60_000)} minutos. El modelo de respaldo puede estar lento — puede que el resultado real aparezca solo en unos momentos más; si no, vuelve a intentarlo.`
        : mensajeErrorAnalisis(codigoDecoded, error);
      if (esTopeDuro) console.error(`[licitacion-viabilidad-ia] ${codigoDecoded}: TOPE DURO de ${VIABILIDAD_JOB_TIMEOUT_MS}ms alcanzado — marcado error (la llamada de fondo puede seguir corriendo, no se cancela).`);
      void marcarJobError(codigoDecoded, runId, msg);
    })
    .finally(() => { void liberarLock(lockKey); });

  return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });
}
