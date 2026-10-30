// app/api/compras/[negocioId]/documentos-compra/route.ts
// Archivos de cotizaciones y fichas técnicas de un negocio, SOLO para abrirlos (sin precios, márgenes ni comparación).
// Es lo que ve el perfil Auditor de Compras, que no entra a «Costeo y auditoría».
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const idH = request.headers.get('x-user-id');
  const userId = idH ? parseInt(idH) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [[cot], [fichas]] = await Promise.all([
      pool.query(
        `SELECT id, proveedor_nombre, archivo_url, archivo_nombre, ficha_tecnica_url, DATE_FORMAT(tomada_at, '%Y-%m-%d') AS fecha
           FROM compras_cotizacion WHERE negocio_id = ? AND (archivo_url IS NOT NULL OR ficha_tecnica_url IS NOT NULL) ORDER BY id`, [id]) as Promise<any>,
      pool.query(
        `SELECT DISTINCT documento_url, documento_nombre FROM auditor_respaldo
          WHERE negocio_id = ? AND tipo = 'ficha_tecnica' AND vigente = 1 AND documento_url IS NOT NULL ORDER BY id`, [id]).catch(() => [[]]) as Promise<any>,
    ]);

    const cotizaciones = (cot as any[]).filter(r => r.archivo_url).map(r => ({
      id: Number(r.id), proveedor: r.proveedor_nombre as string, nombre: (r.archivo_nombre || 'Cotización') as string, url: r.archivo_url as string, fecha: r.fecha as string | null,
    }));
    // Fichas: las cargadas con la cotización + las que pasaron por la pestaña «Fichas técnicas».
    const vistas = new Set<string>();
    const fichasOut: { proveedor: string | null; nombre: string; url: string }[] = [];
    for (const r of cot as any[]) if (r.ficha_tecnica_url && !vistas.has(r.ficha_tecnica_url)) { vistas.add(r.ficha_tecnica_url); fichasOut.push({ proveedor: r.proveedor_nombre, nombre: 'Ficha técnica', url: r.ficha_tecnica_url }); }
    for (const r of fichas as any[]) if (r.documento_url && !vistas.has(r.documento_url)) { vistas.add(r.documento_url); fichasOut.push({ proveedor: null, nombre: r.documento_nombre || 'Ficha técnica', url: r.documento_url }); }

    return NextResponse.json({ success: true, cotizaciones, fichas: fichasOut });
  } catch (error: any) {
    console.error('[compras][documentos-compra]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar los documentos.' }, { status: 500 });
  }
}
