// app/api/chat-global/route.ts
// Chat general de la burbuja flotante (fuera de una licitación). Ver app/lib/chat-global.ts.
//   GET  → historial del usuario.   POST { pregunta } → respuesta con datos de la BD.
// Mira datos de TODAS las licitaciones y de negocios de otros usuarios, así que exige el permiso
// `chat_global` (admin siempre; el resto se otorga en Editar permisos).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, permisosDeUsuario } from '@/app/lib/api-auth';
import { obtenerHistorial, guardarTurno } from '@/app/lib/chat-licitacion';
import { responderGlobal } from '@/app/lib/chat-global';
import { registrarActividadDiaria } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CODIGO_GLOBAL = '__GLOBAL__';

// Admin y Compras (permiso `compras`, `compras_todo` o `aprobar_comercial`) consultan todo; el resto, solo el mercado y lo suyo.
async function esPrivilegiado(u: { id: number; rol?: string | null }) {
  const p = await permisosDeUsuario(u.id, u.rol);
  return !!(p.compras || p.compras_todo || p.aprobar_comercial);
}

async function autorizar(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (u.rol !== 'admin') {
    const p = await permisosDeUsuario(u.id, u.rol);
    if (!p.chat_global)
      return { error: NextResponse.json({ error: 'No tienes permiso para usar el chat general.' }, { status: 403 }) };
  }
  return { usuario: u, restringido: u.rol !== 'admin' && !(await esPrivilegiado(u)) };
}

export async function GET(request: NextRequest) {
  const a = await autorizar(request);
  if (a.error) return a.error;
  return NextResponse.json({ mensajes: await obtenerHistorial(CODIGO_GLOBAL, `g-${a.usuario!.id}`) });
}

export async function POST(request: NextRequest) {
  const a = await autorizar(request);
  if (a.error) return a.error;
  const usuario = a.usuario!;
  const body = await request.json().catch(() => ({}));
  const pregunta = String(body.pregunta || '').trim();
  if (!pregunta) return NextResponse.json({ error: 'La pregunta está vacía.' }, { status: 400 });

  const sesionId = `g-${usuario.id}`;
  try {
    const historial = await obtenerHistorial(CODIGO_GLOBAL, sesionId);
    const { respuesta, sql, filas } = await responderGlobal(pregunta, historial, a.restringido ? usuario.id : null);
    await guardarTurno(CODIGO_GLOBAL, sesionId, pregunta, respuesta, 'glm-4.7+sql', usuario.id ?? null);
    registrarActividadDiaria({
      usuarioId: usuario.id, accion: 'chat_ia',
      descripcion: 'Consultó al chat general de licitaciones', metadata: { filas },
    }, 'global');
    return NextResponse.json({ respuesta, sql, filas });
  } catch (e) {
    console.error('[chat-global] error:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo generar la respuesta en este momento. Intenta de nuevo en unos segundos.' }, { status: 502 });
  }
}
