// app/api/licitacion-adjudicacion/[codigo]/route.ts
// ¿Esta licitación ya fue adjudicada? Y en ese caso, ¿quién ganó cada línea y por cuánto?
//
// La usa el apartado "Postuladas": una vez que postulamos, la licitación se queda ahí
// hasta que MP publica el resultado (CodigoEstado 8 = Adjudicada).
//
// La lógica (cache adjudicacion_cache mig. 35 + consulta a MP + enriquecimiento con
// nuestros RUT) vive en app/lib/adjudicacion.ts — compartida con el cron que auto-promueve
// las postuladas y avisa la apertura. Esta ruta solo resuelve auth + ?force y delega.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { obtenerAdjudicacion } from '@/app/lib/adjudicacion';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const { codigo } = await params;
  if (!codigo) return NextResponse.json({ error: 'Código requerido' }, { status: 400 });

  const cod = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, cod)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    const r = await obtenerAdjudicacion(cod, { force });
    if (r) return NextResponse.json(r);
    return NextResponse.json({ error: 'No encontrada en Mercado Público' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
