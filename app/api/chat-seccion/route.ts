// app/api/chat-seccion/route.ts
// Chat de cada MENÚ de LICITANK (Negocios, Compras, Postuladas, Radar…). Un chatbot por sección: responde con las tablas de
// ese menú (ver app/lib/chat-secciones.ts) usando el mismo motor de solo lectura del chat general.
//   GET  ?seccion=<id>             → historial del usuario en esa sección.
//   POST { seccion, pregunta }     → respuesta con datos de la BD.
//
// Multiempresa: la empresa sale de la sesión (nunca del navegador); cada tabla se lee ya filtrada por empresa (chat-global.ts)
// y la sección solo existe si la empresa tiene contratado el módulo de ese menú. Permiso: `chat_licitacion` (admin siempre).
// El Dashboard usa el chat general (/api/chat-global, permiso `chat_global`).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, permisosDeUsuario } from '@/app/lib/api-auth';
import { obtenerHistorial, guardarTurno } from '@/app/lib/chat-licitacion';
import { responderGlobal, restringidoPara, ETIQUETA_MOTOR_SQL } from '@/app/lib/chat-global';
import { seccionPorId } from '@/app/lib/chat-secciones';
import { fichaCliente } from '@/app/lib/tenant';
import { rutaPermitida } from '@/app/lib/modulos';
import { registrarActividadDiaria } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function autorizar(request: NextRequest, idSeccion: string | null) {
  const u = await getAuthedUser(request);
  if (!u) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (!u.clienteId) return { error: NextResponse.json({ error: 'Tu cuenta no tiene empresa asignada.' }, { status: 403 }) };
  const sec = idSeccion ? seccionPorId(idSeccion) : null;
  if (!sec || sec.id === 'dashboard') return { error: NextResponse.json({ error: 'Este menú no tiene chat propio.' }, { status: 404 }) };
  if (u.rol !== 'admin') {
    const p = await permisosDeUsuario(u.id, u.rol);
    if (!p.chat_licitacion) return { error: NextResponse.json({ error: 'No tienes permiso para usar el chat IA.' }, { status: 403 }) };
  }
  // La empresa solo chatea con los menús que tiene contratados.
  const f = await fichaCliente(u.clienteId);
  if (!f.vigente || (u.clienteId !== 1 && !(rutaPermitida(sec.rutaModulo, u.clienteId, f.modulos).ok && f.modulos.includes('ia_chat'))))
    return { error: NextResponse.json({ error: 'Este chat no está incluido en tu plan.' }, { status: 403 }) };
  return { usuario: u, sec, clienteId: u.clienteId };
}

// Código y sesión bajo los que se guarda el historial (cada persona tiene el suyo por menú; el id de usuario ya es único por empresa).
const codigoDe = (id: string) => `__SEC__${id}`.slice(0, 64);
const sesionDe = (userId: number) => `s-${userId}`;

export async function GET(request: NextRequest) {
  const a = await autorizar(request, request.nextUrl.searchParams.get('seccion'));
  if (a.error) return a.error;
  return NextResponse.json({ mensajes: await obtenerHistorial(codigoDe(a.sec!.id), sesionDe(a.usuario!.id)) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const a = await autorizar(request, typeof body.seccion === 'string' ? body.seccion : null);
  if (a.error) return a.error;
  const { usuario, sec, clienteId } = a as { usuario: NonNullable<typeof a.usuario>; sec: NonNullable<typeof a.sec>; clienteId: number };
  const pregunta = String(body.pregunta || '').trim().slice(0, 2000);
  if (!pregunta) return NextResponse.json({ error: 'La pregunta está vacía.' }, { status: 400 });

  try {
    const historial = await obtenerHistorial(codigoDe(sec.id), sesionDe(usuario.id));
    const { respuesta, sql, filas } = await responderGlobal(pregunta, historial, {
      seccion: sec.id, clienteId, restringidoUserId: await restringidoPara(usuario),
    });
    await guardarTurno(codigoDe(sec.id), sesionDe(usuario.id), pregunta, respuesta, ETIQUETA_MOTOR_SQL, usuario.id ?? null);
    registrarActividadDiaria({
      usuarioId: usuario.id, accion: 'chat_ia',
      descripcion: `Consultó al chat del menú ${sec.nombre}`, metadata: { seccion: sec.id, filas },
    }, `sec-${sec.id}`);
    return NextResponse.json({ respuesta, sql, filas });
  } catch (e) {
    console.error('[chat-seccion] error:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo generar la respuesta en este momento. Intenta de nuevo en unos segundos.' }, { status: 502 });
  }
}
