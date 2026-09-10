// app/api/compras/[negocioId]/orden-compra/buscar/route.ts
// MÓDULO DE COMPRAS §3.6 — "buscar automáticamente ahora" para la orden de compra del cliente, en
// vez de esperar al cron de 15-30 min o cargarla a mano. Pedido explícito del usuario: para
// licitaciones ganadas ANTES de que existiera el módulo de Compras, la OC ya estaba emitida y
// muchas veces YA ESTÁ guardada en `ordenes_compra` (el sync general la trajo en su momento) — lo
// único que falta es engancharla con este negocio, que es barato y no necesita nada de Mercado
// Público. Solo si de verdad no está guardada todavía se intenta una búsqueda en vivo.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion, vincularOrdenCompraDeMP } from '@/app/lib/compras';
import { sincronizarOrdenesCompra } from '@/app/lib/ordenes-compra';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function ocGuardadaLocalmente(licitacionCodigo: string) {
  const [rows] = await pool.query(
    `SELECT codigo, estado, total, total_neto,
            DATE_FORMAT(COALESCE(fecha_envio, fecha_creacion), '%Y-%m-%d') AS emitida,
            DATE_FORMAT(fecha_aceptacion, '%Y-%m-%d') AS aceptada
       FROM ordenes_compra WHERE licitacion_codigo = ? AND es_nuestra = 1 LIMIT 1`,
    [licitacionCodigo],
  ) as any;
  return (rows as any[])[0] || null;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) {
      return NextResponse.json({ error: 'Sin acceso a Compras de este negocio.' }, { status: 403 });
    }

    // 1. ¿Ya está guardada de antes? (típico en licitaciones ganadas antes de que existiera
    //    Compras — el sync general ya la trajo, solo faltaba engancharla con este negocio).
    let oc = await ocGuardadaLocalmente(asignacion.licitacionCodigo);
    let viaVivo = false;

    // 2. Si no, se intenta en vivo contra Mercado Público (requiere IP chilena — en un entorno sin
    //    ella falla en silencio, igual que el cron; no rompe la respuesta).
    if (!oc) {
      try {
        await sincronizarOrdenesCompra({ soloProveedor: true, dias: 5, avisar: false });
        oc = await ocGuardadaLocalmente(asignacion.licitacionCodigo);
        viaVivo = true;
      } catch (e: any) {
        console.warn('[compras/orden-compra/buscar] búsqueda en vivo falló:', String(e).slice(0, 200));
      }
    }

    if (!oc) {
      return NextResponse.json({ success: true, encontrada: false });
    }

    const { vinculada } = await vincularOrdenCompraDeMP(asignacion.licitacionCodigo, {
      codigo: oc.codigo, estado: oc.estado ?? null,
      fechaEmision: oc.emitida ?? null, fechaAceptacion: oc.aceptada ?? null,
      total: oc.total == null ? null : Number(oc.total),
      totalNeto: oc.total_neto == null ? null : Number(oc.total_neto),
    });

    return NextResponse.json({
      success: true, encontrada: true, vinculada, viaVivo,
      oc: { numero: oc.codigo, estado: oc.estado, emitidaAt: oc.emitida, aceptadaAt: oc.aceptada },
    });
  } catch (error: any) {
    console.error('[compras/[negocioId]/orden-compra/buscar][POST]', String(error));
    return NextResponse.json({ error: 'No se pudo buscar la orden de compra.' }, { status: 500 });
  }
}
