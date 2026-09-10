// app/api/licitacion-adjudicacion/[codigo]/route.ts
// ¿Esta licitación ya fue adjudicada? Y en ese caso, ¿quién ganó cada línea y por cuánto?
//
// La usa el apartado "Postuladas" y la sección "Resultado" del detalle de licitación: una vez
// que postulamos, la licitación se queda ahí hasta que MP publica el resultado (CodigoEstado 8).
//
// La lógica (cache adjudicacion_cache mig. 35 + consulta a MP + enriquecimiento con
// nuestros RUT) vive en app/lib/adjudicacion.ts — compartida con el cron que auto-promueve
// las postuladas y avisa la apertura. Esta ruta solo resuelve auth y delega.
//
// SIEMPRE cache-only, CERO salidas a MP (sep-2026, auditoría de tiempo real): antes aceptaba
// `?force=1` (nunca usado por el frontend) y, sin cache o con cache vencido, consultaba MP EN VIVO
// en cada carga de esta sección — exactamente lo que el dueño pidió eliminar: ninguna consulta a
// MP puede depender de que alguien abra una pantalla. Se usa `sinRed:true` (no `soloCache`, que
// igual pega UNA consulta en vivo cuando no hay ninguna fila de cache — ver adjudicacion.ts). El
// único que consulta MP y llena `adjudicacion_cache` es el cron de 5 min (procesar-postuladas /
// estados-asignadas); esta ruta solo lee lo que haya ahí, aunque no haya nada todavía.
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

  try {
    const r = await obtenerAdjudicacion(cod, { sinRed: true });
    if (r) return NextResponse.json(r);
    // Sin fila en adjudicacion_cache todavía (el cron aún no le tocó el turno a este código, o
    // sigue Publicada y nada la ha declarado terminal): NO es un error, es el estado normal
    // "aún sin resultado". Se responde con la misma forma que un `success` sin adjudicar, para que
    // el frontend (ResultadoSection.tsx) muestre "Aún sin resultado publicado" en vez de un error.
    return NextResponse.json({
      success: true, codigo: cod, estado: null, codigoEstado: null, esAdjudicada: false,
      fechaAdjudicacion: null, fechaEstimadaAdjudicacion: null, fechaAperturaTecnica: null,
      adjudicacion: null, lineasAdjudicadas: [], montoAdjudicadoTotal: null,
      ganamos: false, montoNuestro: null, desdeCache: false,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
