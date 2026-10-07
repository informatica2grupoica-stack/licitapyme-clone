// app/api/viabilidad/producto-referencia/[codigo]/route.ts
// POST → "Producto de referencia" (spec P9): busca en la web el modelo comercial que el cliente tenía en
// mente y lo compara con la ficha de las bases. Solo a pedido y solo en proyectos ya asignados.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, puedeVerLicitacion, permitido } from '@/app/lib/api-auth';
import { buscarProductoReferencia } from '@/app/lib/producto-referencia';
import { registrarActividad } from '@/app/lib/actividad';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Params = { params: Promise<{ codigo: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  // Solo proyectos ya asignados a un asistente (no corre en licitaciones que nadie trabaja).
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM negocios WHERE licitacion_codigo = ? AND asignado_a IS NOT NULL AND activo = TRUE LIMIT 1`,
      [codigoDecoded],
    );
    if ((rows as any[]).length === 0)
      return NextResponse.json({ error: 'El producto de referencia solo está disponible en proyectos asignados.' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: 'No se pudo verificar la asignación del proyecto.' }, { status: 500 });
  }

  // Rate-limit: cada corrida son varias llamadas a la IA y a Serper.
  if (!(await permitido(`prod-ref:${usuario.id}`, 20, 600)))
    return NextResponse.json({ error: 'Demasiadas búsquedas seguidas. Espera unos minutos.' }, { status: 429 });

  let body: any = {};
  try { body = await request.json(); } catch { /* body vacío */ }
  const nombre = String(body?.nombre || '').trim();
  const caracteristicas = Array.isArray(body?.caracteristicas) ? body.caracteristicas.map(String) : [];
  if (!nombre || caracteristicas.filter((c: string) => c.trim()).length === 0)
    return NextResponse.json({ error: 'Falta el producto (nombre y características).' }, { status: 400 });

  try {
    const resultado = await buscarProductoReferencia({
      nombre,
      marca_modelo_referencia: body?.marca_modelo_referencia ? String(body.marca_modelo_referencia) : null,
      caracteristicas,
    });
    registrarActividad({
      usuarioId: usuario.id, accion: 'producto_referencia',
      entidadTipo: 'licitacion', entidadId: codigoDecoded,
      descripcion: `Buscó el producto de referencia en ${codigoDecoded}: ${nombre}`,
      metadata: { licitacion_codigo: codigoDecoded, producto: nombre },
    });
    return NextResponse.json({ success: true, ...resultado });
  } catch (e) {
    console.error(`[producto-referencia] ${codigoDecoded}: error:`, String(e).slice(0, 300));
    return NextResponse.json({ error: 'No se pudo buscar el producto de referencia. Reintenta en unos minutos.' }, { status: 500 });
  }
}
