// app/api/chat-global/route.ts
// Chat general de la burbuja flotante (fuera de una licitación). Ver app/lib/chat-global.ts.
//   GET  → historial del usuario.   POST { pregunta } → respuesta con datos de la BD.
// Mira datos de TODAS las licitaciones y de negocios de otros usuarios, así que exige el permiso
// `chat_global` (admin siempre; el resto se otorga en Editar permisos).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, permisosDeUsuario } from '@/app/lib/api-auth';
import { fichaCliente } from '@/app/lib/tenant';
import { obtenerHistorial, guardarTurno, borrarHistorial } from '@/app/lib/chat-licitacion';
import { responderGlobal, restringidoPara, ETIQUETA_MOTOR_SQL } from '@/app/lib/chat-global';
import { registrarActividadDiaria } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CODIGO_GLOBAL = '__GLOBAL__';

async function autorizar(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (u.rol !== 'admin') {
    const p = await permisosDeUsuario(u.id, u.rol);
    if (!p.chat_global)
      return { error: NextResponse.json({ error: 'No tienes permiso para usar el chat general.' }, { status: 403 }) };
  }
  if (!u.clienteId) return { error: NextResponse.json({ error: 'Tu cuenta no tiene empresa asignada.' }, { status: 403 }) };
  // Una empresa-cliente solo lo usa si tiene contratado el módulo de consultas a la IA.
  if (u.clienteId !== 1 && !(await fichaCliente(u.clienteId)).modulos.includes('ia_chat'))
    return { error: NextResponse.json({ error: 'Este chat no está incluido en tu plan.' }, { status: 403 }) };
  return { usuario: u, clienteId: u.clienteId, restringido: await restringidoPara(u) };
}

export async function GET(request: NextRequest) {
  const a = await autorizar(request);
  if (a.error) return a.error;
  return NextResponse.json({ mensajes: await obtenerHistorial(CODIGO_GLOBAL, `g-${a.usuario!.id}`) });
}

export async function DELETE(request: NextRequest) {
  const a = await autorizar(request);
  if (a.error) return a.error;
  const n = await borrarHistorial(CODIGO_GLOBAL, `g-${a.usuario!.id}`, a.usuario!.id);
  return NextResponse.json({ ok: true, borrados: n });
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
    const { respuesta, sql, filas } = await responderGlobal(pregunta, historial, { seccion: 'dashboard', clienteId: a.clienteId!, restringidoUserId: a.restringido });
    await guardarTurno(CODIGO_GLOBAL, sesionId, pregunta, respuesta, ETIQUETA_MOTOR_SQL, usuario.id ?? null);
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
