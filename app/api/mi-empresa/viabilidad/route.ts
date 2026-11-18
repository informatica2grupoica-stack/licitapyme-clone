// app/api/mi-empresa/viabilidad/route.ts — cómo se adapta la Viabilidad IA a MI empresa (migration-201).
//   GET → la configuración (presupuesto mínimo, calce con lo que vende).
//   PUT → { minimo_neto?: number | null, calce?: 'ninguno' | 'suave' | 'normal' | 'estricto' } (solo el admin de la empresa).
// La empresa sale de la sesión, nunca del navegador. Grupo ICA no usa esto (tiene su propia configuración). LICITANK cambia lo mismo desde /api/admin/clientes.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { CLIENTE_ICA } from '@/app/lib/tenant';
import { leerConfigEmpresa, guardarConfigEmpresa } from '@/app/lib/cv/viabilidad-empresa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.clienteId === CLIENTE_ICA) return NextResponse.json({ error: 'Grupo ICA usa su propia configuración' }, { status: 400 });
  return NextResponse.json({ success: true, config: await leerConfigEmpresa(u.clienteId) });
}

export async function PUT(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.clienteId === CLIENTE_ICA) return NextResponse.json({ error: 'Grupo ICA usa su propia configuración' }, { status: 400 });
  if (u.rol !== 'admin') return NextResponse.json({ error: 'Solo el admin de la empresa puede cambiar esto' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const r = await guardarConfigEmpresa(u.clienteId, { minimo_neto: b.minimo_neto, calce: b.calce });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ success: true, config: r.config });
}
