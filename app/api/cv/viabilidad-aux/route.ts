// app/api/cv/viabilidad-aux/route.ts — extremos auxiliares de la pantalla de viabilidad de las empresas-cliente.
// Etapa 1: la pantalla copiada los llama; aún no hay aprendizaje por empresa ni búsqueda de productos, así que responden vacío / «no disponible»
// en vez de romper. (Se implementan por etapas; ver el plan de la viabilidad completa.)
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ success: true, feedback: [] });
}
export async function POST(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ error: 'Esta función estará disponible pronto para tu empresa.' }, { status: 501 });
}
export const DELETE = GET;
