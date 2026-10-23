// app/api/cv/perfil/route.ts — Perfil de negocio de la empresa-cliente (lo que la IA usa para dictaminar).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { leerPerfil, guardarPerfil, estadoCupo } from '@/app/lib/cliente-viabilidad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ success: true, perfil: await leerPerfil(u.clienteId), cupo: await estadoCupo(u.clienteId) });
}

export async function PUT(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol !== 'admin') return NextResponse.json({ error: 'Solo el admin de la empresa puede editar el perfil' }, { status: 403 });
  await guardarPerfil(u.clienteId, await req.json().catch(() => ({})));
  return NextResponse.json({ success: true });
}
