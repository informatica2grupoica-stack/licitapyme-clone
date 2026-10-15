// app/api/licitacion-adjudicacion/[codigo]/reconsultar/route.ts
// POST — vuelve a consultar la adjudicación en Mercado Público (en vivo) para esta licitación.
// La ruta GET hermana es solo-cache a propósito; esto es una acción EXPLÍCITA de una persona
// (botón «Volver a consultar» del Resultado) para trabajar una readjudicación sin esperar al cron.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { reconsultarResultado } from '@/app/lib/procesar-postuladas';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const { codigo } = await params;
  const cod = decodeURIComponent(codigo || '');
  if (!cod) return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, cod)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  try {
    const { adj, cambios } = await reconsultarResultado(cod);
    if (!adj) return NextResponse.json({ error: 'Mercado Público no respondió; reintenta en un momento' }, { status: 502 });
    return NextResponse.json({ ...adj, cambios });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
