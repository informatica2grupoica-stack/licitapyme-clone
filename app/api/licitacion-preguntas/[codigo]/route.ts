// app/api/licitacion-preguntas/[codigo]/route.ts
// Foro de Preguntas y Respuestas de una licitación (portal de MP, la API pública no lo expone).
// GET  → lee el CACHÉ guardado (instantáneo, sin tocar el portal). El cron (/api/cron/preguntas)
//        lo mantiene al día; null si nunca se ha consultado esta licitación.
// POST → fuerza una consulta EN VIVO al portal (navegador real, ~10-15s) y actualiza el caché.
//        Usado por el botón "Actualizar" / cuando el GET no trae nada.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion, permitido } from '@/app/lib/api-auth';
import { leerCachePreguntas, refrescarPreguntas } from '@/app/lib/preguntas-respuestas';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

type Params = { params: Promise<{ codigo: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  const cache = await leerCachePreguntas(codigoDecoded);
  if (!cache) return NextResponse.json({ success: true, cache: false });
  return NextResponse.json({ success: true, cache: true, ...cache });
}

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
    const foro = await refrescarPreguntas(codigoDecoded);
    if (!foro) return NextResponse.json({ error: 'No se pudo traer el foro de preguntas desde Mercado Público.' }, { status: 502 });

    registrarActividad({
      usuarioId: userId, accion: 'ver_preguntas_licitacion',
      entidadTipo: 'licitacion', entidadId: codigoDecoded,
      descripcion: `Consultó preguntas y respuestas de ${codigoDecoded}`,
      metadata: { licitacion_codigo: codigoDecoded, n_preguntas: foro.preguntas.length },
    });

    return NextResponse.json({ success: true, cache: true, ...foro });
  } catch (e) {
    console.error(`[licitacion-preguntas] ${codigoDecoded}: error:`, String(e).slice(0, 300));
    return NextResponse.json({ error: 'No se pudo traer el foro. Reintenta en unos minutos.' }, { status: 500 });
  }
}
