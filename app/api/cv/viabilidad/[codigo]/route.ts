// app/api/cv/viabilidad/[codigo]/route.ts — dictamen de viabilidad de la empresa-cliente para UNA licitación.
//   GET  → el dictamen guardado de MI empresa (nunca el de otra, ni el de Grupo ICA).
//   POST → genera/regenera el dictamen con el perfil de mi empresa. Gasta del cupo mensual del plan.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, puedeVerLicitacion } from '@/app/lib/api-auth';
import { leerDictamen, generarDictamen, estadoCupo } from '@/app/lib/cliente-viabilidad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type Ctx = { params: Promise<{ codigo: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const codigo = decodeURIComponent((await params).codigo);
  if (!(await puedeVerLicitacion(req, codigo))) return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  return NextResponse.json({ success: true, dictamen: await leerDictamen(u.clienteId, codigo), cupo: await estadoCupo(u.clienteId) });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const codigo = decodeURIComponent((await params).codigo);
  if (!(await puedeVerLicitacion(req, codigo))) return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  const r = await generarDictamen(u.clienteId, codigo, { id: u.id, nombre: u.nombre });
  if (!r.ok) return NextResponse.json({ success: false, codigo: r.codigo, error: r.mensaje }, { status: r.codigo === 'ERROR' ? 502 : 409 });
  return NextResponse.json({ success: true, dictamen: r.dictamen, cupo: await estadoCupo(u.clienteId) });
}
