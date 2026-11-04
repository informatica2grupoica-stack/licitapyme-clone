// app/api/admin/whatsapp/avisos/route.ts — qué avisos de WhatsApp recibe cada perfil (selector de «Editar permisos»).
//   GET ?usuario=ID            → { avisos: {ganada, perdida, apertura}, telefono, activo }
//   PUT { usuario, avisos }    → guarda lo elegido
// Solo admin, y solo perfiles de su propia empresa.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { avisosEfectivos, guardarAvisos } from '@/app/lib/whatsapp-avisos';
import { normalizarTelefono } from '@/app/lib/perfil-datos';

async function perfilDeMiEmpresa(req: NextRequest, id: number) {
  const u = await getAuthedUser(req);
  if (!u || u.rol !== 'admin') return { error: NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 }) };
  const [rows] = await pool.query('SELECT id, rol, activo, telefono FROM usuarios WHERE id = ? AND cliente_id = ? LIMIT 1', [id, u.clienteId]) as any[];
  const p = (rows as any[])[0];
  if (!p) return { error: NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 }) };
  return { perfil: p };
}

export async function GET(req: NextRequest) {
  const id = parseInt(new URL(req.url).searchParams.get('usuario') || '', 10);
  if (!id) return NextResponse.json({ error: 'usuario requerido' }, { status: 400 });
  const { perfil, error } = await perfilDeMiEmpresa(req, id);
  if (error) return error;
  try {
    return NextResponse.json({
      avisos: await avisosEfectivos(id, perfil.rol),
      telefono: normalizarTelefono(perfil.telefono ?? ''),
      activo: !!perfil.activo,
    });
  } catch (e: any) {
    if (e?.code === 'ER_NO_SUCH_TABLE') return NextResponse.json({ error: 'Falta la migración 178: node scripts/aplicar-migration-178.mjs' }, { status: 503 });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.usuario);
  if (!id) return NextResponse.json({ error: 'usuario requerido' }, { status: 400 });
  const { error } = await perfilDeMiEmpresa(req, id);
  if (error) return error;
  try {
    await guardarAvisos(id, body?.avisos ?? {});
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e?.code === 'ER_NO_SUCH_TABLE') return NextResponse.json({ error: 'Falta la migración 178: node scripts/aplicar-migration-178.mjs' }, { status: 503 });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
