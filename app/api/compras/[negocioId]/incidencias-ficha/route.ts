// app/api/compras/[negocioId]/incidencias-ficha/route.ts
// MÓDULO DE COMPRAS — incidencias levantadas desde un ítem de las fichas técnicas. Cada tipo elegido se crea como una
// TAREA de la licitación (asignada al encargado) y se avisa a los encargados por campana, aviso central y correo.
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { crearTareaManual, obtenerAsignacion } from '@/app/lib/compras';
import { notificarEncargadosCompras, rutaCorregirProducto } from '@/app/lib/compras-avisos';
import { etiquetaTipoIncidenciaFicha } from '@/app/lib/compras-incidencias-ficha-tipos';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function __POST(request: NextRequest, { params }: Params) {
  const userId = parseInt(request.headers.get('x-user-id') || '');
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre');
  if (!Number.isFinite(userId)) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const ids: number[] = [...new Set<number>((Array.isArray(body.productoIds) ? body.productoIds : [body.productoId]).map((x: unknown) => parseInt(String(x))).filter((x: number) => Number.isFinite(x)))].slice(0, 100);
  const tipos: string[] = [...new Set<string>((Array.isArray(body.tipos) ? body.tipos : []).map(String))].filter(t => etiquetaTipoIncidenciaFicha(t));
  const comentario = String(body.comentario || '').trim().slice(0, 1500);
  if (ids.length === 0) return NextResponse.json({ error: 'Elige al menos un ítem.' }, { status: 400 });
  if (tipos.length === 0) return NextResponse.json({ error: 'Elige al menos un tipo de incidencia.' }, { status: 400 });
  if (tipos.includes('otra') && !comentario) return NextResponse.json({ error: 'Explica la incidencia en el comentario.' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) {
      return NextResponse.json({ error: 'Sin acceso a Compras de este negocio.' }, { status: 403 });
    }
    // Los nombres salen de la base (no del cliente) y confirman que los productos son de este negocio.
    const [rows] = await pool.query('SELECT id, descripcion FROM compras_producto WHERE negocio_id = ? AND id IN (?)', [id, ids]) as any;
    const productos = (rows as Array<{ id: number; descripcion: string }>).sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
    if (productos.length === 0) return NextResponse.json({ error: 'Esos ítems no son de este negocio.' }, { status: 404 });
    const acortar = (t: string) => (t.length > 80 ? `${t.slice(0, 77)}…` : t);

    // Una tarea APARTE por cada ítem y cada tipo.
    let creadas = 0;
    for (const prod of productos) {
      for (const t of tipos) {
        await crearTareaManual(id, {
          titulo: `Incidencia en ficha: ${etiquetaTipoIncidenciaFicha(t)} · ${acortar(prod.descripcion)}`.slice(0, 300),
          descripcion: [`Producto: ${prod.descripcion}`, comentario && `Comentario de ${nombre || 'quien la levantó'}: ${comentario}`].filter(Boolean).join('\n').slice(0, 2000),
          responsableId: asignacion.asignadoA, responsableNombre: asignacion.asignadoNombre ?? null, creadoPor: userId,
        });
        creadas++;
      }
    }

    const lista = tipos.map(t => etiquetaTipoIncidenciaFicha(t)).join('; ');
    const donde = productos.length === 1 ? `la ficha de «${acortar(productos[0].descripcion)}»` : `${productos.length} ítems de las fichas (${productos.slice(0, 3).map(x => `«${acortar(x.descripcion).slice(0, 30)}»`).join(', ')}${productos.length > 3 ? '…' : ''})`;
    await notificarEncargadosCompras(id, 'COMPRAS_INCIDENCIA_FICHA', `Incidencia en ${donde}: ${lista}.${comentario ? ` ${comentario}` : ''}`, { id: userId, nombre },
      { resultado: 'INCIDENCIA', que: `en ${donde}`, comentario: `${lista}${comentario ? ` — ${comentario}` : ''}` },
      rutaCorregirProducto(id, productos[0].id, 'fichas'));
    return NextResponse.json({ success: true, tareas: creadas });
  } catch (error: any) {
    console.error('[compras/incidencias-ficha][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo crear la incidencia.' }, { status: 500 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
