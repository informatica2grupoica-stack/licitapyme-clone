// app/api/negocios/[id]/comercial/auditor-compra/route.ts
// AUDITOR DE COMPRA (etapa comercial, ver app/lib/auditor-compra.ts) — pestaña del negocio, debajo
// del Auditor Técnico, visible solo cuando el negocio ganó.
//
//   GET   → cada fila del Costeo ya guardado, con su link/precio web y lo guardado acá (cotizado,
//           precio cotizado, documento). Si el negocio todavía no tiene Costeo guardado, lista vacía.
//   PATCH → guarda el cotizado sí/no, el precio cotizado y/o el documento legado de UNA fila (filaId).
//   POST  → crea UNA cotización (un documento) que cubre una o más filas a la vez, cada una con su
//           propio precio cotizado (migration-130: antes solo se podía un documento por fila).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado, permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { esGanado } from '@/app/lib/pipeline';
import { ahoraChileSQL } from '@/app/lib/tz';
import { MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor } from '@/app/lib/costeo-editor';
import { lineasAuditorCompra, guardarLineaAuditorCompra, crearCotizacionAuditorCompra } from '@/app/lib/auditor-compra';
import { cargarNegocio, nombreDe } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Mismo criterio que costeo_editor/auditor_tecnico: admin, o el permiso puntual `auditor_compra`.
async function tieneAcceso(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosCrudosDeUsuario(userId);
  return !!p.auditor_compra;
}

function sinAcceso() {
  return NextResponse.json(
    { error: 'El Auditor de Compra está habilitado solo para administradores o para quien tenga el permiso "Auditor de Compra — trabajarlo".' },
    { status: 403 },
  );
}

async function estadoCosteoGuardado(negocioId: number): Promise<EstadoCosteoEditor | null> {
  const [rows] = await pool.query(
    `SELECT modalidad, datos_json FROM negocio_costeo_editor WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
    const grupos = (datos?.grupos || []).map((g: any) => ({ ...g, ofertamos: g.ofertamos !== false }));
    return { modalidad: row.modalidad, margenVenta: Number(datos?.margenVenta) || MARGEN_VENTA_DEFECTO, grupos };
  } catch { return null; }
}

// ═══ GET ══════════════════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tieneAcceso(userId, rol))) return sinAcceso();
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!esGanado(negocio.estado_pipeline))
      return NextResponse.json({ error: 'El Auditor de Compra solo está disponible en negocios ganados.' }, { status: 409 });

    const estadoCosteo = await estadoCosteoGuardado(negocio.id);
    const lineas = await lineasAuditorCompra(negocio.id, estadoCosteo);
    return NextResponse.json({ success: true, lineas, sinCosteo: !estadoCosteo });
  } catch (error) {
    console.error('[comercial/auditor-compra][GET]', String(error));
    // Tabla puede no existir todavía (migración 129 pendiente) — no romper la pestaña por eso.
    return NextResponse.json({ success: true, lineas: [], migracionPendiente: true });
  }
}

// ═══ PATCH ════════════════════════════════════════════════════════════════════════════════════
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tieneAcceso(userId, rol))) return sinAcceso();
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!esGanado(negocio.estado_pipeline))
      return NextResponse.json({ error: 'El Auditor de Compra solo está disponible en negocios ganados.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const filaId = String(body.filaId || '').trim();
    if (!filaId) return NextResponse.json({ error: 'Falta filaId' }, { status: 400 });

    // La fila tiene que ser una de verdad del Costeo guardado — no se acepta cualquier id suelto.
    const estadoCosteo = await estadoCosteoGuardado(negocio.id);
    const existe = (estadoCosteo?.grupos || []).some(g => (g.filas || []).some((f: any) => f.id === filaId));
    if (!existe) return NextResponse.json({ error: 'Esa fila no existe en el Costeo de este negocio.' }, { status: 404 });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
    const precioCotizado = body.precioCotizado === null ? null
      : body.precioCotizado !== undefined ? Number(body.precioCotizado) : undefined;
    await guardarLineaAuditorCompra({
      negocioId: negocio.id, filaId, cotizado: !!body.cotizado,
      precioCotizado,
      documentoUrl: body.documentoUrl ?? null, documentoNombre: body.documentoNombre ?? null,
      userId, nombreActor, ahora: ahoraChileSQL(),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[comercial/auditor-compra][PATCH]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ POST ═════════════════════════════════════════════════════════════════════════════════════
// Crea una cotización (un documento) que cubre una o más filas del Costeo a la vez, cada una con
// su propio precio cotizado — para cuando la cotización real del proveedor trae varios productos
// juntos en un solo PDF, en vez de un documento repetido por cada uno.
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tieneAcceso(userId, rol))) return sinAcceso();
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!esGanado(negocio.estado_pipeline))
      return NextResponse.json({ error: 'El Auditor de Compra solo está disponible en negocios ganados.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const documentoUrl = String(body.documentoUrl || '').trim();
    if (!documentoUrl) return NextResponse.json({ error: 'Falta documentoUrl' }, { status: 400 });
    const filasBody = Array.isArray(body.filas) ? body.filas : [];
    if (filasBody.length === 0) return NextResponse.json({ error: 'Selecciona al menos un producto para esta cotización' }, { status: 400 });

    // Las filas tienen que ser de verdad del Costeo guardado — no se acepta cualquier id suelto.
    const estadoCosteo = await estadoCosteoGuardado(negocio.id);
    const idsValidos = new Set<string>();
    for (const g of (estadoCosteo?.grupos || [])) for (const f of (g.filas || []) as any[]) idsValidos.add(f.id);
    const filas = filasBody
      .map((f: any) => ({ filaId: String(f.filaId || '').trim(), precioCotizado: f.precioCotizado != null ? Number(f.precioCotizado) : null }))
      .filter((f: any) => f.filaId);
    const invalida = filas.find((f: any) => !idsValidos.has(f.filaId));
    if (invalida) return NextResponse.json({ error: 'Una de las filas seleccionadas no existe en el Costeo de este negocio.' }, { status: 404 });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
    const cotizacionId = await crearCotizacionAuditorCompra({
      negocioId: negocio.id,
      documentoUrl,
      documentoNombre: body.documentoNombre ? String(body.documentoNombre) : null,
      filas,
      userId, nombreActor, ahora: ahoraChileSQL(),
    });
    return NextResponse.json({ success: true, cotizacionId });
  } catch (error) {
    console.error('[comercial/auditor-compra][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
