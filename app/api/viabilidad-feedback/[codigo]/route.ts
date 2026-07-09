// app/api/viabilidad-feedback/[codigo]/route.ts
// Feedback loop del análisis de viabilidad: el experto corrige el veredicto de la IA.
// La corrección se destila en una regla y se inyecta en futuros análisis (prompt dinámico).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, tienePermiso, puedeVerLicitacion } from '@/app/lib/api-auth';
import { guardarFeedback, listarFeedback, eliminarFeedback } from '@/app/lib/viabilidad-feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ codigo: string }> };

// Snapshot del veredicto que dio la IA (para registrar contra qué se corrigió).
async function veredictoIAActual(codigo: string): Promise<string | null> {
  try {
    const [rows] = await pool.query(
      `SELECT informe_ejecutivo, score_total, semaforo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const row = (rows as any[])[0];
    if (!row) return null;
    let gana = '';
    try {
      const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
      gana = ie?._informe_ia?.veredicto?.gana_probable || '';
    } catch { /* noop */ }
    const partes = [row.semaforo, row.score_total != null ? `${row.score_total}/100` : '', gana ? `gana:${gana}` : ''].filter(Boolean);
    return partes.join(' ') || null;
  } catch { return null; }
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await getAuthedUser(request))) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  if (!(await puedeVerLicitacion(request, decodeURIComponent(codigo))))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  const feedback = await listarFeedback(decodeURIComponent(codigo));
  return NextResponse.json({ success: true, feedback });
}

export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  // Solo admin (o usuario con permiso explícito) puede comentar/corregir la viabilidad.
  if (!(await tienePermiso(request, 'comentar_viabilidad'))) {
    return NextResponse.json({ error: 'No tienes permiso para comentar la viabilidad.' }, { status: 403 });
  }

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const comentario = typeof body?.comentario === 'string' ? body.comentario.trim() : '';
  const veredictoHumano = typeof body?.veredicto_humano === 'string' ? body.veredicto_humano : null;
  // 'lectura' = regla sobre CÓMO se leen los documentos (mejora el costeo); 'global' = veredicto.
  const ambito: 'global' | 'lectura' = body?.ambito === 'lectura' ? 'lectura' : 'global';
  if (comentario.length < 4) return NextResponse.json({ error: 'Escribe un comentario.' }, { status: 400 });

  try {
    // Solo tiene sentido registrar el veredicto de la IA cuando la regla es de negocio (global).
    const veredictoIA = ambito === 'lectura' ? null : await veredictoIAActual(codigoDecoded);
    const { regla } = await guardarFeedback({
      codigo: codigoDecoded, usuarioId: usuario.id, comentario, veredictoHumano, veredictoIA, ambito,
    });
    const feedback = await listarFeedback(codigoDecoded);
    return NextResponse.json({ success: true, regla, feedback });
  } catch (error) {
    console.error('[viabilidad-feedback:POST]', String(error));
    return NextResponse.json({ error: 'No se pudo guardar el feedback.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tienePermiso(request, 'comentar_viabilidad'))) {
    return NextResponse.json({ error: 'No tienes permiso para gestionar la viabilidad.' }, { status: 403 });
  }
  const { codigo } = await params;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10);
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  await eliminarFeedback(id);
  const feedback = await listarFeedback(decodeURIComponent(codigo));
  return NextResponse.json({ success: true, feedback });
}
