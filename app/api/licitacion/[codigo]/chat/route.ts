// app/api/licitacion/[codigo]/chat/route.ts
// Chatbot de una licitación.
//   GET  ?sesionId=...  → historial persistido de esa sesión.
//   POST { sesionId, pregunta, documento? }
//        - sin `documento` → responde sobre el CORPUS completo (sesion_id = "corpus").
//        - con `documento`  → responde SOLO sobre ese documento (chat rápido por fila,
//          sesion_id = "doc:<nombre>"). Mucho menos texto → respuesta más rápida.
// Nunca re-descarga ni re-OCR-ea: reusa documentos_cache.texto_extraido.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import {
  construirContextoChat,
  construirContextoDocumento,
  obtenerHistorial,
  guardarTurno,
  responderChat,
} from '@/app/lib/chat-licitacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ codigo: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await getAuthedUser(request))) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  const sesionId = (request.nextUrl.searchParams.get('sesionId') || '').slice(0, 64);
  if (!sesionId) return NextResponse.json({ mensajes: [] });

  const mensajes = await obtenerHistorial(codigoDecoded, sesionId);
  return NextResponse.json({ mensajes });
}

export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);

  const body = await request.json().catch(() => ({}));
  const pregunta = String(body.pregunta || '').trim();
  const sesionId = String(body.sesionId || '').slice(0, 64);
  const documento = body.documento ? String(body.documento) : null;

  if (!pregunta) return NextResponse.json({ error: 'La pregunta está vacía.' }, { status: 400 });
  if (!sesionId) return NextResponse.json({ error: 'Falta el identificador de sesión.' }, { status: 400 });

  // Contexto: corpus completo o un solo documento.
  const { texto: contexto, encontrado } = documento
    ? await construirContextoDocumento(codigoDecoded, documento)
    : await construirContextoChat(codigoDecoded);

  if (!encontrado) {
    const respuesta = documento
      ? 'Este documento todavía no fue procesado por la IA (aún no tiene texto extraído). Corre el análisis de viabilidad de la licitación y vuelve a intentarlo.'
      : 'Todavía no hay documentos procesados para esta licitación. Descarga las bases y corre el análisis de viabilidad para poder consultarlas.';
    return NextResponse.json({ respuesta, sinContexto: true });
  }

  try {
    const historial = await obtenerHistorial(codigoDecoded, sesionId);
    const { respuesta, modelo } = await responderChat({ contexto, historial, pregunta });
    await guardarTurno(codigoDecoded, sesionId, pregunta, respuesta, modelo, usuario.id ?? null);
    return NextResponse.json({ respuesta, modelo });
  } catch (e) {
    console.error('[chat] error respondiendo:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'No se pudo generar la respuesta en este momento. Intenta de nuevo en unos segundos.' },
      { status: 502 },
    );
  }
}
