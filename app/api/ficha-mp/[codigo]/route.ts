// Ficha oficial de MP (criterios, garantías, antecedentes, etc.) leída del HTML público, sin IA.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { obtenerFichaMP, type FichaMP } from '@/app/lib/ficha-mp';

// La ficha cambia poco; evita pedírsela a MP en cada apertura del Resumen.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; ficha: FichaMP }>();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const codigo = decodeURIComponent((await params).codigo || '');
  if (!/^[\w-]{3,40}$/.test(codigo))
    return NextResponse.json({ error: 'Código de licitación inválido' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, codigo)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  const hit = cache.get(codigo);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ ficha: hit.ficha });

  try {
    const ficha = await obtenerFichaMP(codigo);
    cache.set(codigo, { at: Date.now(), ficha });
    return NextResponse.json({ ficha });
  } catch (e) {
    console.error(`[ficha-mp] ${codigo}:`, e);
    return NextResponse.json({ error: 'No se pudo leer la ficha de Mercado Público' }, { status: 502 });
  }
}
