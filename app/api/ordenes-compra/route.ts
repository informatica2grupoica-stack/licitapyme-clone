// app/api/ordenes-compra/route.ts
// GET /api/ordenes-compra?codigo=<licitacion>
// Las órdenes de compra YA guardadas de una licitación (las trae el cron, ver
// app/lib/ordenes-compra.ts). No llama a Mercado Público: la API no permite consultar por
// licitación, así que preguntar en vivo desde una pantalla no es una opción.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { ordenesDeLicitacion } from '@/app/lib/ordenes-compra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const codigo = request.nextUrl.searchParams.get('codigo');
  if (!codigo) return NextResponse.json({ error: 'Falta el parámetro codigo' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  try {
    return NextResponse.json({ success: true, ordenes: await ordenesDeLicitacion(codigo) });
  } catch (error: any) {
    // La tabla puede no existir todavía (migración 64 sin aplicar): se responde vacío en vez de
    // reventar la sección Resultado entera, que es información que sí está disponible.
    console.error('[api/ordenes-compra]', String(error?.message || error));
    return NextResponse.json({ success: true, ordenes: [], migracionPendiente: true });
  }
}
