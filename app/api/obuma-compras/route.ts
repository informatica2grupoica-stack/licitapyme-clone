// app/api/obuma-compras/route.ts
// GET /api/obuma-compras?codigo=<licitacion>
// Las compras de Obuma YA guardadas para una licitación (las trae el cron, ver
// app/lib/obuma-compras.ts). No llama a Obuma en vivo: mismo criterio que /api/ordenes-compra —
// barrer y cruzar es trabajo del cron, no de una carga de pantalla.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { comprasObumaDeLicitacion } from '@/app/lib/obuma-compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const codigo = request.nextUrl.searchParams.get('codigo');
  if (!codigo) return NextResponse.json({ error: 'Falta el parámetro codigo' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  try {
    return NextResponse.json({ success: true, compras: await comprasObumaDeLicitacion(codigo) });
  } catch (error: any) {
    // La tabla puede no existir todavía (migración 66 sin aplicar): se responde vacío en vez de
    // reventar la sección Resultado entera.
    console.error('[api/obuma-compras]', String(error?.message || error));
    return NextResponse.json({ success: true, compras: [], migracionPendiente: true });
  }
}
