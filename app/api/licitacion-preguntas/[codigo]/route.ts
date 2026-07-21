// app/api/licitacion-preguntas/[codigo]/route.ts
// POST → trae el foro de Preguntas y Respuestas de una licitación desde el PORTAL de Mercado
// Público (la API pública no lo expone, solo las fechas — ver app/lib/mp-preguntas-respuestas.ts).
// On-demand (no se cachea en BD): abre un navegador real, ~10-15s por licitación.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion, permitido } from '@/app/lib/api-auth';
import { obtenerPreguntasRespuestas } from '@/app/lib/mp-preguntas-respuestas';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

type Params = { params: Promise<{ codigo: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  // Rate-limit: cada consulta abre un navegador real (costoso).
  if (!(await permitido(`preguntas-mp:${userId}`, 20, 600)))
    return NextResponse.json({ error: 'Demasiadas consultas seguidas. Espera unos minutos.' }, { status: 429 });

  try {
    const foro = await obtenerPreguntasRespuestas(codigoDecoded);
    if (!foro) return NextResponse.json({ error: 'No se pudo traer el foro de preguntas desde Mercado Público.' }, { status: 502 });

    registrarActividad({
      usuarioId: userId, accion: 'ver_preguntas_licitacion',
      entidadTipo: 'licitacion', entidadId: codigoDecoded,
      descripcion: `Consultó preguntas y respuestas de ${codigoDecoded}`,
      metadata: { licitacion_codigo: codigoDecoded, n_preguntas: foro.preguntas.length },
    });

    return NextResponse.json({ success: true, ...foro });
  } catch (e) {
    console.error(`[licitacion-preguntas] ${codigoDecoded}: error:`, String(e).slice(0, 300));
    return NextResponse.json({ error: 'No se pudo traer el foro. Reintenta en unos minutos.' }, { status: 500 });
  }
}
