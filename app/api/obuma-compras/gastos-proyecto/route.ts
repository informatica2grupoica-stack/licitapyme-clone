// app/api/obuma-compras/gastos-proyecto/route.ts
// GET /api/obuma-compras/gastos-proyecto?codigo=<licitacion>
// A diferencia de /api/obuma-compras (solo lee lo que el cron ya cruzó), esto SÍ llama a Obuma en
// vivo — a propósito, acción explícita del usuario (botón, no autoload de pantalla): agrupa todos
// los centros de costo que comparten el mismo `rel_proyecto_id` que el de esta licitación (ver
// gastosDelProyectoPorLicitacion en obuma.ts, cruce v1-only sin esperar el acceso a v2.0/Proyectos)
// y suma sus órdenes de compra reales.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { gastosDelProyectoPorLicitacion } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const codigo = request.nextUrl.searchParams.get('codigo');
  if (!codigo) return NextResponse.json({ error: 'Falta el parámetro codigo' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  try {
    const gastos = await gastosDelProyectoPorLicitacion(codigo);
    return NextResponse.json({ success: true, gastos });
  } catch (error: any) {
    console.error('[api/obuma-compras/gastos-proyecto]', String(error?.message || error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
