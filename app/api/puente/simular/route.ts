// app/api/puente/simular/route.ts
// VISTA PREVIA del reparto: calcula quién se lleva qué SIN escribir nada.
//
// Llama al mismo motor puro que la ejecución (app/lib/puente-reparto.ts) con el mismo contexto,
// así que lo que se ve acá es exactamente lo que va a pasar al confirmar — siempre que se
// reenvíe la `semilla` que devuelve esta respuesta.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, tienePermiso } from '@/app/lib/api-auth';
import { contextoReparto, parsearConfig, nuevaSemilla } from '@/app/lib/puente';
import { repartir } from '@/app/lib/puente-reparto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tienePermiso(request, 'repartir_puente')))
    return NextResponse.json({ error: 'Sin permiso para usar el puente' }, { status: 403 });

  let body: any;
  try { body = await request.json(); } catch { body = {}; }

  const parsed = parsearConfig(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { licitaciones, perfiles } = await contextoReparto();
    if (licitaciones.length === 0)
      return NextResponse.json({ error: 'El puente está vacío' }, { status: 400 });

    const cfg = { ...parsed.cfg, semilla: parsed.cfg.semilla ?? nuevaSemilla() };
    const resultado = repartir(licitaciones, perfiles, cfg);

    // Se devuelven también las licitaciones para que la vista previa pinte las tarjetas sin
    // tener que cruzarlas contra otra llamada (y sin riesgo de mostrar datos desfasados).
    return NextResponse.json({ success: true, resultado, licitaciones, semilla: resultado.semilla });
  } catch (error) {
    console.error('[puente:simular]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
