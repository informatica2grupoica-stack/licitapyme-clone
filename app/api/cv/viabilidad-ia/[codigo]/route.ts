// app/api/cv/viabilidad-ia/[codigo]/route.ts
// VIABILIDAD COMPLETA de una EMPRESA-CLIENTE (copia del analizador v4 de ICA, app/lib/cv/). Mismo contrato que la ruta de ICA para que la
// pantalla copiada funcione igual, pero con tablas propias por empresa y sin tocar nada de ICA.
//   GET  → el informe de MI empresa para esta licitación + estado del análisis en curso.
//   POST → arranca el análisis en segundo plano (la pantalla consulta por polling). Gasta del cupo mensual del plan.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, tomarLock, liberarLock, permitido, puedeVerLicitacion } from '@/app/lib/api-auth';
import { iaTextoConfigurada } from '@/app/lib/gemini';
import { conUsuarioIA } from '@/app/lib/ia-uso';
import { registrarActividad } from '@/app/lib/actividad';
import { analizarYGuardarViabilidadIA, conClienteCv } from '@/app/lib/cv/viabilidad-ia';
import { normalizarTextosInforme } from '@/app/lib/cv/v4/textos';
import { validarInformeViabilidad, validarNivelV27 } from '@/app/lib/cv/validador-viabilidad';
import { estadoCupo } from '@/app/lib/cliente-viabilidad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ codigo: string }> };
const TOPE_MS = 15 * 60_000, LATIDO_MS = 20_000, HUERFANO_S = 150;

function conValidadorFresco(inf: any): any {
  if (!inf) return inf;
  try {
    normalizarTextosInforme(inf);
    if (inf._schema === 'v4') {
      const v = validarInformeViabilidad(inf); const v27 = validarNivelV27(inf);
      if (v27) { v.hallazgos.push(v27); v.ok = false; }
      return { ...inf, _validador: v };
    }
    return inf;
  } catch { return inf; }
}

async function leerInforme(cid: number, codigo: string): Promise<any | null> {
  const [rows] = await pool.query('SELECT informe FROM cliente_viabilidad_v4 WHERE cliente_id = ? AND licitacion_codigo = ?', [cid, codigo]);
  const r = (rows as any[])[0];
  if (!r) return null;
  try { return typeof r.informe === 'string' ? JSON.parse(r.informe) : r.informe; } catch { return null; }
}
async function leerJob(cid: number, codigo: string) {
  const [rows] = await pool.query(
    `SELECT *, TIMESTAMPDIFF(SECOND, actualizado_at, UTC_TIMESTAMP()) AS edad_seg, TIMESTAMPDIFF(SECOND, iniciado_at, UTC_TIMESTAMP()) AS elapsed_seg
       FROM cliente_viabilidad_jobs WHERE cliente_id = ? AND licitacion_codigo = ?`, [cid, codigo]);
  return (rows as any[])[0] ?? null;
}
const marcarError = (cid: number, codigo: string, run: string, msg: string) =>
  pool.query(`UPDATE cliente_viabilidad_jobs SET estado = 'error', error = ?, actualizado_at = UTC_TIMESTAMP() WHERE cliente_id = ? AND licitacion_codigo = ? AND run_id = ?`, [msg.slice(0, 500), cid, codigo, run]);

export async function GET(req: NextRequest, { params }: Params) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const codigo = decodeURIComponent((await params).codigo);
  if (!(await puedeVerLicitacion(req, codigo))) return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  let job = await leerJob(u.clienteId, codigo);
  if (job?.estado === 'procesando' && Number(job.edad_seg) > HUERFANO_S) {
    const msg = 'El análisis se interrumpió (el servidor pudo reiniciarse). Vuelve a intentarlo.';
    await marcarError(u.clienteId, codigo, job.run_id, msg).catch(() => {});
    job = { ...job, estado: 'error', error: msg };
  }
  const cupo = await estadoCupo(u.clienteId);
  return NextResponse.json({
    success: true, informeIA: conValidadorFresco(await leerInforme(u.clienteId, codigo)),
    enProceso: job?.estado === 'procesando', error: job?.estado === 'error' ? job.error : null, errorPuedeSerTemporal: false,
    fase: job?.estado === 'procesando' ? job.fase : null, elapsedMs: job ? Number(job.elapsed_seg) * 1000 : null, timeoutMs: TOPE_MS,
    puedeReanalizar: u.rol === 'admin' || cupo.usados < cupo.cupo, motivoNoPuedeReanalizar: null, cupo,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const cid = u.clienteId;
  const codigo = decodeURIComponent((await params).codigo);
  if (!(await puedeVerLicitacion(req, codigo))) return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (!iaTextoConfigurada()) return NextResponse.json({ error: 'La IA no está disponible en este momento.' }, { status: 503 });

  const [[perfil]] = await pool.query('SELECT descripcion, productos_si, rubros FROM cliente_perfil WHERE cliente_id = ?', [cid]) as any;
  if (!perfil || (!`${perfil.descripcion || ''}${perfil.productos_si || ''}${perfil.rubros || ''}`.trim()))
    return NextResponse.json({ error: 'Primero completa el perfil de tu empresa.', codigo: 'SIN_PERFIL' }, { status: 409 });

  // Cupo del plan: un análisis NUEVO gasta uno; volver a analizar el mismo no.
  const yaTiene = await leerInforme(cid, codigo);
  const cupo = await estadoCupo(cid);
  if (!yaTiene && cupo.usados >= cupo.cupo)
    return NextResponse.json({ error: cupo.cupo === 0 ? 'Tu plan no incluye análisis de viabilidad.' : `Usaste los ${cupo.cupo} análisis de este mes.`, codigo: 'SIN_CUPO' }, { status: 409 });

  if (!(await permitido(`cv-viab:${u.id}`, 20, 600))) return NextResponse.json({ error: 'Demasiados análisis seguidos. Espera unos minutos.' }, { status: 429 });
  const previo = await leerJob(cid, codigo);
  if (previo?.estado === 'procesando' && Number(previo.edad_seg) <= HUERFANO_S) return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });
  const lockKey = `cv-viab:${cid}:${codigo}`;
  if (!(await tomarLock(lockKey, 300))) return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    `INSERT INTO cliente_viabilidad_jobs (cliente_id, licitacion_codigo, run_id, estado, fase, error, iniciado_at, actualizado_at)
     VALUES (?, ?, ?, 'procesando', 'leyendo_documentos', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE run_id = VALUES(run_id), estado = 'procesando', fase = 'leyendo_documentos', error = NULL, iniciado_at = UTC_TIMESTAMP(), actualizado_at = UTC_TIMESTAMP()`,
    [cid, codigo, runId]);
  registrarActividad({ usuarioId: u.id, accion: 'viabilidad', entidadTipo: 'licitacion', entidadId: codigo, descripcion: force || yaTiene ? 'Re-analizó la viabilidad IA' : 'Corrió el análisis de viabilidad IA', metadata: { licitacion_codigo: codigo } });

  const latido = setInterval(() => {
    void pool.query(`UPDATE cliente_viabilidad_jobs SET actualizado_at = UTC_TIMESTAMP() WHERE cliente_id = ? AND licitacion_codigo = ? AND run_id = ? AND estado = 'procesando'`, [cid, codigo, runId]).catch(() => {});
  }, LATIDO_MS);
  let settled = false;
  const deadline = new Promise<never>((_, rej) => setTimeout(() => { settled = true; rej(new Error('TOPE_DURO')); }, TOPE_MS));

  Promise.race([
    conClienteCv(cid, () => conUsuarioIA({ usuarioId: u.id, usuarioNombre: u.nombre || u.email || null },
      () => analizarYGuardarViabilidadIA(codigo, (fase) => {
        if (!settled) void pool.query(`UPDATE cliente_viabilidad_jobs SET fase = ?, actualizado_at = UTC_TIMESTAMP() WHERE cliente_id = ? AND licitacion_codigo = ? AND run_id = ?`, [fase, cid, codigo, runId]).catch(() => {});
      }, { fresco: true }))),
    deadline,
  ])
    .then(async (inf) => {
      if (!inf) { await marcarError(cid, codigo, runId, 'No hay documentos legibles para analizar. Descárgalos primero.'); return; }
      await pool.query('DELETE FROM cliente_viabilidad_jobs WHERE cliente_id = ? AND licitacion_codigo = ? AND run_id = ?', [cid, codigo, runId]);
      await pool.query('UPDATE cliente_viabilidad_v4 SET created_by = ? WHERE cliente_id = ? AND licitacion_codigo = ?', [u.id, cid, codigo]).catch(() => {});
    })
    .catch(async (e) => {
      const msg = String((e as any)?.message ?? e);
      console.error('[cv-viabilidad]', codigo, msg.slice(0, 300));
      await marcarError(cid, codigo, runId, msg.startsWith('TOPE_DURO') ? 'El análisis superó el tiempo máximo. Vuelve a intentarlo.' : `No se pudo completar el análisis. Reintenta en unos minutos. (${msg.slice(0, 300)})`).catch(() => {});
    })
    .finally(() => { clearInterval(latido); void liberarLock(lockKey); });

  return NextResponse.json({ success: true, status: 'procesando' }, { status: 202 });
}
