// app/api/chat-proyecto/route.ts
// Chat de la burbuja flotante, modo PROYECTO: responde sobre UNA licitación completa
// (documentos + ficha del negocio + viabilidad + costeo). La licitación se indica con `codigo`
// o con `negocioId` (la burbuja solo conoce la URL, que puede ser /negocios/<id>).
//   GET  ?codigo=|negocioId=&sesionId=  → historial.
//   POST { codigo|negocioId, sesionId, pregunta }
// Comparte sesion_id "corpus" con el panel de la ficha: es la misma conversación.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeChatearLicitacion, tienePermiso } from '@/app/lib/api-auth';
import {
  construirContextoChat,
  construirContextoProyecto,
  obtenerHistorial,
  guardarTurno,
  responderChat,
} from '@/app/lib/chat-licitacion';
import { registrarActividadDiaria } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function resolverCodigo(codigo: unknown, negocioId: unknown): Promise<string | null> {
  if (codigo) return String(codigo).slice(0, 100);
  const id = Number(negocioId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [id]);
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

// Permiso `chat_licitacion` (admin siempre; el resto desde Editar permisos), además de poder ver la licitación.
const SIN_PERMISO = () => NextResponse.json({ error: 'No tienes permiso para usar el chat IA de la licitación.' }, { status: 403 });

export async function GET(request: NextRequest) {
  if (!(await getAuthedUser(request))) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tienePermiso(request, 'chat_licitacion'))) return SIN_PERMISO();
  const sp = request.nextUrl.searchParams;
  const codigo = await resolverCodigo(sp.get('codigo'), sp.get('negocioId'));
  if (!codigo) return NextResponse.json({ mensajes: [] });
  if (!(await puedeChatearLicitacion(request, codigo)))
    return NextResponse.json({ error: 'Esta licitación está asignada a otro perfil: solo puedes usar el chat en tus licitaciones.' }, { status: 403 });
  const sesionId = (sp.get('sesionId') || 'corpus').slice(0, 64);
  return NextResponse.json({ codigo, mensajes: await obtenerHistorial(codigo, sesionId) });
}

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tienePermiso(request, 'chat_licitacion'))) return SIN_PERMISO();

  const body = await request.json().catch(() => ({}));
  const pregunta = String(body.pregunta || '').trim();
  const sesionId = String(body.sesionId || 'corpus').slice(0, 64);
  if (!pregunta) return NextResponse.json({ error: 'La pregunta está vacía.' }, { status: 400 });

  const codigo = await resolverCodigo(body.codigo, body.negocioId);
  if (!codigo) return NextResponse.json({ error: 'No se encontró la licitación.' }, { status: 404 });
  if (!(await puedeChatearLicitacion(request, codigo)))
    return NextResponse.json({ error: 'Esta licitación está asignada a otro perfil: solo puedes usar el chat en tus licitaciones.' }, { status: 403 });

  const { texto: docs, encontrado, actualizadoEn } = await construirContextoChat(codigo);
  const analisis = await construirContextoProyecto(codigo);
  if (!encontrado && !analisis) {
    return NextResponse.json({
      respuesta: 'Todavía no hay documentos ni análisis para esta licitación. Descarga las bases y corre el análisis de viabilidad para poder consultarla.',
      sinContexto: true,
    });
  }
  const contexto = [docs, analisis].filter(Boolean).join('\n\n');

  try {
    const historial = await obtenerHistorial(codigo, sesionId, actualizadoEn);
    const { respuesta, modelo } = await responderChat({ contexto, historial, pregunta });
    await guardarTurno(codigo, sesionId, pregunta, respuesta, modelo, usuario.id ?? null);
    registrarActividadDiaria({
      usuarioId: usuario.id, accion: 'chat_ia',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Consultó a la IA sobre la licitación ${codigo}`,
      metadata: { licitacion_codigo: codigo },
    }, 'corpus');
    return NextResponse.json({ codigo, respuesta, modelo });
  } catch (e) {
    console.error('[chat-proyecto] error respondiendo:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'No se pudo generar la respuesta en este momento. Intenta de nuevo en unos segundos.' },
      { status: 502 },
    );
  }
}
