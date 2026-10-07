// app/api/viabilidad-feedback/[codigo]/route.ts
// Feedback loop del análisis de viabilidad: el experto corrige el veredicto de la IA.
// La corrección se destila en una regla y se inyecta en futuros análisis (prompt dinámico).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, esCA, puedeVerLicitacion } from '@/app/lib/api-auth';
import { guardarFeedback, listarFeedback, eliminarFeedback } from '@/app/lib/viabilidad-feedback';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ codigo: string }> };

// Snapshot de lo que mostró el sistema (para registrar contra qué se corrigió). v4.0 (P12): el
// NIVEL de atractivo (`score.nivel`) — la escala GANABLE/NO VAMOS desapareció. Informes viejos
// (v3) caen al semáforo/score de antes.
async function veredictoIAActual(codigo: string): Promise<string | null> {
  try {
    const [rows] = await pool.query(
      `SELECT informe_ejecutivo, score_total, semaforo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const row = (rows as any[])[0];
    if (!row) return null;
    try {
      const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
      const nivel = ie?._informe_ia_v3?.score?.nivel;
      if (nivel) return String(nivel).slice(0, 32);
    } catch { /* noop */ }
    const partes = [row.semaforo, row.score_total != null ? `${row.score_total}/100` : ''].filter(Boolean);
    return partes.join(' ').slice(0, 32) || null;
  } catch { return null; }
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await getAuthedUser(request))) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  if (!(await puedeVerLicitacion(request, decodeURIComponent(codigo))))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  // v4.0 (P12): las reglas son de CA. Cualquier otro usuario recibe la lista vacía (no un error:
  // el resto de la pantalla no depende de esto).
  const usr = await getAuthedUser(request);
  if (!usr || !(await esCA(usr.id))) return NextResponse.json({ success: true, feedback: [] });
  const feedback = await listarFeedback(decodeURIComponent(codigo));
  return NextResponse.json({ success: true, feedback });
}

export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  // v4.0 (P12): solo CA crea reglas. El servidor rechaza a cualquier otro usuario (incluido admin).
  if (!(await esCA(usuario.id))) {
    return NextResponse.json({ error: 'Solo CA puede enseñarle reglas a la IA.' }, { status: 403 });
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
    const { regla, sinDestilar } = await guardarFeedback({
      codigo: codigoDecoded, usuarioId: usuario.id, comentario, veredictoHumano, veredictoIA, ambito,
    });
    registrarActividad({
      usuarioId: usuario.id, accion: 'feedback_viabilidad',
      entidadTipo: 'licitacion', entidadId: codigoDecoded,
      descripcion: `Corrigió la viabilidad de ${codigoDecoded} (${ambito}): ${comentario.slice(0, 200)}`,
      metadata: { licitacion_codigo: codigoDecoded, ambito, veredicto_humano: veredictoHumano || undefined },
    });
    const feedback = await listarFeedback(codigoDecoded);
    return NextResponse.json({
      success: true, regla, feedback, sin_destilar: sinDestilar,
      ...(sinDestilar ? { aviso: 'La IA no pudo convertir el comentario en una regla general: quedó guardado para revisión y no se usará hasta que el jefe de ventas lo revise.' } : {}),
    });
  } catch (error) {
    console.error('[viabilidad-feedback:POST]', String(error));
    return NextResponse.json({ error: 'No se pudo guardar el feedback.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esCA(usuario.id))) {
    return NextResponse.json({ error: 'Solo CA puede desactivar reglas de la IA.' }, { status: 403 });
  }
  const { codigo } = await params;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10);
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  await eliminarFeedback(id, usuario.id);   // v4.0: desactiva (queda en el historial), no borra
  registrarActividad({
    usuarioId: usuario.id, accion: 'feedback_viabilidad',
    entidadTipo: 'licitacion', entidadId: decodeURIComponent(codigo),
    descripcion: `Desactivó una corrección de viabilidad de ${decodeURIComponent(codigo)}`,
    metadata: { licitacion_codigo: decodeURIComponent(codigo), feedback_id: id, desactivado: true },
  });
  const feedback = await listarFeedback(decodeURIComponent(codigo));
  return NextResponse.json({ success: true, feedback });
}
