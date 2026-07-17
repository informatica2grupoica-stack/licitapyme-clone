// app/api/viabilidad/buscar-equipamiento/[codigo]/route.ts
// POST → genera el PROMPT de búsqueda de un equipo/maquinaria (specs filtradas por IA) para pegar
// en Gemini y encontrar 3 homólogos o superiores en Chile / China (Alibaba) / exportadores a Chile.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, puedeVerLicitacion, permitido } from '@/app/lib/api-auth';
import { generarBusquedaEquipamiento } from '@/app/lib/buscar-equipamiento';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

type Params = { params: Promise<{ codigo: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  // Rate-limit: cada búsqueda es una llamada a la IA.
  if (!(await permitido(`buscar-equip:${usuario.id}`, 40, 600)))
    return NextResponse.json({ error: 'Demasiadas búsquedas seguidas. Espera unos minutos.' }, { status: 429 });

  let body: any = {};
  try { body = await request.json(); } catch { /* body vacío */ }
  const nombre = String(body?.nombre || '').trim();
  const caracteristicas = Array.isArray(body?.caracteristicas) ? body.caracteristicas.map(String) : [];
  if (!nombre && caracteristicas.length === 0)
    return NextResponse.json({ error: 'Falta el producto (nombre o características).' }, { status: 400 });

  try {
    const resultado = await generarBusquedaEquipamiento({
      nombre,
      caracteristicas,
      cantidad: body?.cantidad ?? null,
      region: body?.region ? String(body.region) : undefined,
    });
    registrarActividad({
      usuarioId: usuario.id, accion: 'busqueda_equipamiento',
      entidadTipo: 'licitacion', entidadId: codigoDecoded,
      descripcion: `Generó búsqueda de equipamiento en ${codigoDecoded}${nombre ? `: ${nombre}` : ''}`,
      metadata: { licitacion_codigo: codigoDecoded, producto: nombre || undefined },
    });
    return NextResponse.json({ success: true, ...resultado });
  } catch (e) {
    console.error(`[buscar-equipamiento] ${codigoDecoded}: error:`, String(e).slice(0, 300));
    return NextResponse.json({ error: 'No se pudo generar la búsqueda. Reintenta en unos minutos.' }, { status: 500 });
  }
}
