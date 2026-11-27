// app/api/mi-empresa/opciones/route.ts — opciones de funcionamiento de MI empresa (migration-200).
//   GET → las opciones y si hoy el Auditor pide aprobación (cualquier persona de la empresa).
//   PUT → { aprobaciones_auditor: 'auto' | 'siempre' | 'nunca' } (solo el admin de la empresa).
// La empresa sale de la sesión, nunca del navegador. LICITANK cambia lo mismo desde /api/admin/clientes.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { leerOpciones, guardarOpciones, aprobacionesAuditorActivas } from '@/app/lib/opciones-empresa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ success: true, opciones: await leerOpciones(u.clienteId), aprobacionesActivas: await aprobacionesAuditorActivas(u.clienteId) });
}

export async function PUT(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol !== 'admin') return NextResponse.json({ error: 'Solo el admin de la empresa puede cambiar estas opciones' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const r = await guardarOpciones(u.clienteId, { aprobaciones_auditor: b.aprobaciones_auditor, recargo_costeo: b.recargo_costeo });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ success: true, opciones: r.opciones, aprobacionesActivas: await aprobacionesAuditorActivas(u.clienteId) });
}
