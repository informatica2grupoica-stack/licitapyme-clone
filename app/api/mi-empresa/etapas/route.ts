// app/api/mi-empresa/etapas/route.ts — etapas de avance propias de la empresa (migration-199).
//   GET    → las etapas de MI empresa (las lee cualquier persona de la empresa: salen en el selector de etapa y en los comentarios).
//   POST   → { nombre, color, base } crea una (solo el admin de la empresa).
//   PUT    → { id, nombre, color, base } edita, o { id, mover: -1 | 1 } cambia el orden (solo admin).
//   DELETE → ?id=<n> la quita; los negocios que estaban en ella siguen en su etapa base del sistema (solo admin).
// La empresa sale de la sesión, nunca del navegador.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { listarEtapas, crearEtapa, actualizarEtapa, moverEtapa, borrarEtapa } from '@/app/lib/etapas-cliente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function sesion(req: NextRequest, soloAdmin: boolean) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (soloAdmin && u.rol !== 'admin') return { error: NextResponse.json({ error: 'Solo el admin de la empresa puede cambiar las etapas' }, { status: 403 }) };
  return { u: { ...u, clienteId: u.clienteId } };
}

export async function GET(req: NextRequest) {
  const g = await sesion(req, false);
  if (g.error) return g.error;
  return NextResponse.json({ success: true, etapas: await listarEtapas(g.u.clienteId) });
}

export async function POST(req: NextRequest) {
  const g = await sesion(req, true);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  const r = await crearEtapa(g.u.clienteId, { nombre: String(b.nombre ?? ''), color: String(b.color ?? ''), base: String(b.base ?? '') });
  return r.ok ? NextResponse.json({ success: true, id: r.id }) : NextResponse.json({ error: r.error }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const g = await sesion(req, true);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: 'Falta la etapa' }, { status: 400 });
  if (b.mover === -1 || b.mover === 1) { await moverEtapa(g.u.clienteId, id, b.mover); return NextResponse.json({ success: true }); }
  const r = await actualizarEtapa(g.u.clienteId, id, { nombre: String(b.nombre ?? ''), color: String(b.color ?? ''), base: String(b.base ?? '') });
  return r.ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: r.error }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const g = await sesion(req, true);
  if (g.error) return g.error;
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'Falta la etapa' }, { status: 400 });
  await borrarEtapa(g.u.clienteId, id);
  return NextResponse.json({ success: true });
}
