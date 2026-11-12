// app/api/compras/[negocioId]/postventa/route.ts
// §17.1 — los compromisos de postventa vienen del resumen ejecutivo (paquete de traspaso); acá
// solo se marca cuáles ya se resolvieron.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarPostventa, marcarPostventaResuelta, desmarcarPostventa } from '@/app/lib/compras-entrega';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const compromisos = asignacion.resumen ? ((asignacion.resumen as any).compromisosPostventa || []) : [];
    const garantiasResumen = asignacion.resumen ? ((asignacion.resumen as any).garantias || []) : [];
    // El detalle (p. ej. «12 meses…») se lee EN VIVO del Auditor Técnico: el resumen es una foto vieja y llegaba sin descripción (387-55-LE26, 12-nov-2026).
    const [vivos] = await pool.query(
      `SELECT titulo, valor_texto FROM checklist_comercial WHERE negocio_id = ? AND valor_texto IS NOT NULL AND valor_texto <> '' AND (titulo LIKE '%garant%' OR titulo LIKE '%postventa%')`, [id],
    ).catch(() => [[]] as any) as any;
    const valorDe = new Map((vivos as any[]).map(v => [String(v.titulo).trim(), String(v.valor_texto)]));
    const garantias = garantiasResumen.map((g: any) => ({ titulo: g.titulo, descripcion: valorDe.get(String(g.titulo).trim()) ?? g.descripcion ?? null }));
    const resueltos = await listarPostventa(id);
    return NextResponse.json({
      success: true,
      compromisos: compromisos.map((c: any) => ({ titulo: c.titulo, descripcion: c.descripcion ?? null, ...(resueltos.get(c.titulo) || { resuelto: false, resueltoPorNombre: null, resueltoAt: null, notas: null }) })),
      garantias,
    });
  } catch (error) {
    console.error('[compras/postventa][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la postventa.' }, { status: 500 });
  }
}

async function __PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    if (body.resuelto) await marcarPostventaResuelta(id, body.compromisoTexto, body.notas || null, userId, nombre);
    else await desmarcarPostventa(id, body.compromisoTexto);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/postventa][PATCH]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo actualizar.') }, { status: 400 });
  }
}

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
