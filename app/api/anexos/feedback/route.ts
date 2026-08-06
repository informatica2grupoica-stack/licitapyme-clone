// app/api/anexos/feedback/route.ts
// Feedback loop del Anexo Creator (ver app/lib/anexos-feedback.ts): el usuario corrige una
// casilla que la IA rellenó mal (o dejó como quiso otro valor), la corrección se destila en una
// regla general por TIPO de etiqueta y se inyecta en el prompt de cada análisis futuro.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, esAdmin, puedeVerLicitacion } from '@/app/lib/api-auth';
import { guardarFeedbackAnexo, listarFeedbackAnexo, eliminarFeedbackAnexo } from '@/app/lib/anexos-feedback';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mismo criterio que /api/anexos/analizar: el creador de anexos (y su feedback loop) está
// restringido a admin por ahora.
export async function GET(request: NextRequest) {
  if (!(await esAdmin(request))) return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  const feedback = await listarFeedbackAnexo();
  return NextResponse.json({ success: true, feedback });
}

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  const etiqueta = typeof body?.etiqueta === 'string' ? body.etiqueta.trim() : '';
  const valorCorrecto = typeof body?.valorCorrecto === 'string' ? body.valorCorrecto.trim() : '';
  const valorIA = typeof body?.valorIA === 'string' && body.valorIA.trim() ? body.valorIA.trim() : null;
  const codigo = typeof body?.codigo === 'string' && body.codigo.trim() ? body.codigo.trim() : null;

  if (!etiqueta) return NextResponse.json({ error: 'Falta la etiqueta de la casilla.' }, { status: 400 });
  if (!valorCorrecto) return NextResponse.json({ error: 'Escribe el valor correcto.' }, { status: 400 });
  if (codigo && !(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }

  try {
    const { regla } = await guardarFeedbackAnexo({ codigo, usuarioId: usuario.id, etiqueta, valorIA, valorCorrecto });
    registrarActividad({
      usuarioId: usuario.id, accion: 'feedback_anexo',
      entidadTipo: 'licitacion', entidadId: codigo || 'global',
      descripcion: `Corrigió una casilla de anexo ("${etiqueta.slice(0, 80)}"): "${valorIA ?? '(vacío)'}" → "${valorCorrecto.slice(0, 80)}"`,
      metadata: { licitacion_codigo: codigo || undefined, etiqueta, valor_ia: valorIA, valor_correcto: valorCorrecto },
    });
    return NextResponse.json({ success: true, regla });
  } catch (error) {
    console.error('[anexos-feedback:POST]', String(error));
    return NextResponse.json({ error: 'No se pudo guardar la corrección.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await esAdmin(request))) return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10);
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  await eliminarFeedbackAnexo(id);
  return NextResponse.json({ success: true });
}
