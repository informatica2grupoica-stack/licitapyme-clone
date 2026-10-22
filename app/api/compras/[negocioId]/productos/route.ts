// app/api/compras/[negocioId]/productos/route.ts
// Estados y subestados de cobertura por producto (spec §14). GET lista, PATCH cambia subestado,
// propone/aprueba renuncia a una línea (§14.5) o agrega/quita una parte que se compra aparte.
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion, listarProductosCompra, poblarProductosCompra, cambiarSubestadoProducto,
  proponerRenunciaLinea, aprobarRenunciaLinea, coberturaProyecto, sincronizarProductosConCosteo, aplicarAdjudicacionPorLinea,
  crearParteProducto, eliminarParteProducto,
  type SubestadoProducto } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { linksDelCosteoPorProducto } from '@/app/lib/compras-auditoria-cotizacion';
import { listarComprasRapidas, type CompraRapida } from '@/app/lib/compras-compra-rapida';
import { marcarCompradosConOc } from '@/app/lib/compras-oc-obuma';

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

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    // Backfill perezoso: negocios asignados antes de que existiera este bloque (§14) nunca
    // poblaron sus productos. poblarProductosCompra es idempotente (no repite si ya hay filas).
    if (asignacion.asignadoA != null) await poblarProductosCompra(id).catch(() => {});

    // Líneas ofertadas que el acta de MP dio a otro proveedor: se marcan solas (idempotente, solo lee
    // la caché del acta) y la pantalla las muestra atenuadas con quién se las llevó.
    const adj = asignacion.asignadoA != null ? await aplicarAdjudicacionPorLinea(id).catch(() => null) : null;
    // Lo que ya tiene OC emitida (desde Licitank o directo en Obuma) se muestra «Comprado» (solo lee la base, no llama a Obuma).
    await marcarCompradosConOc(id).catch(e => console.warn('[compras/productos] marcar Comprado por OC:', String(e).slice(0, 150)));
    const [productos, cobertura, linksCosteo] = await Promise.all([listarProductosCompra(id), coberturaProyecto(id), linksDelCosteoPorProducto(id).catch(() => ({}))]);
    return NextResponse.json({ success: true, productos, cobertura, linksCosteo, perdidas: adj?.perdidas ?? [], ganadas: adj?.ganadas ?? [], conflictos: adj?.conflictos ?? [], aviso: adj?.revisarAMano ?? null });
  } catch (error) {
    console.error('[compras/productos][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar los productos.' }, { status: 500 });
  }
}

async function __PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();

    if (body.accion === 'sincronizar_costeo') {
      const r = await sincronizarProductosConCosteo(id);
      const [productos, cobertura] = await Promise.all([listarProductosCompra(id), coberturaProyecto(id)]);
      return NextResponse.json({ success: true, productos, cobertura, ...r });
    }

    const productoId = Number(body.productoId);
    if (!Number.isFinite(productoId)) return NextResponse.json({ error: 'Falta productoId' }, { status: 400 });

    if (body.accion === 'subestado') {
      // Una compra rápida sin aprobar (pendiente o rechazada) no puede pasar a «Comprado» a mano: primero la aprueba el jefe de ventas.
      if (body.subestado === 'COMPRADO') {
        const { compras } = await listarComprasRapidas(id).catch(() => ({ compras: [] as CompraRapida[] }));
        const cr = compras.find(c => c.productoId === productoId);
        if (cr && cr.estado !== 'APROBADA') return NextResponse.json({ error: `Este producto tiene una compra rápida ${cr.estado === 'PENDIENTE' ? 'esperando' : 'rechazada por'} el jefe de ventas: no se puede marcar Comprado hasta que la apruebe.` }, { status: 400 });
      }
      await cambiarSubestadoProducto(productoId, body.subestado as SubestadoProducto);
    } else if ((body.accion === 'agregar_parte' || body.accion === 'quitar_parte') && !(await listarProductosCompra(id)).some(p => p.id === productoId)) {
      return NextResponse.json({ error: 'Ese producto no es de esta compra.' }, { status: 400 });
    } else if (body.accion === 'agregar_parte') {
      // Parte que se compra aparte (migration-163): los pernos de una butaca «que incluye pernos», a otro proveedor.
      await crearParteProducto(productoId, { descripcion: String(body.descripcion || ''), cantidad: Number(body.cantidad), unidad: body.unidad ?? null }, userId, nombre);
    } else if (body.accion === 'quitar_parte') {
      await eliminarParteProducto(productoId, userId, nombre);
    } else if (body.accion === 'proponer_renuncia') {
      if (!String(body.motivo || '').trim()) return NextResponse.json({ error: 'Falta el motivo de la renuncia.' }, { status: 400 });
      await proponerRenunciaLinea(productoId, body.motivo, userId, nombre);
    } else if (body.accion === 'aprobar_renuncia') {
      // permisosCrudosDeUsuario (no permisosDeUsuario): "ser admin" ya no autoriza por sí solo
      // (10-sep-2026, mismo criterio del resto del módulo) — se exige aprobar_comercial o
      // compras_todo de verdad.
      const permisos = await permisosCrudosDeUsuario(userId);
      if (!permisos.compras_todo && !permisos.aprobar_comercial)
        return NextResponse.json({ error: 'Solo el jefe de ventas aprueba la renuncia a una línea (spec §14.5).' }, { status: 403 });
      await aprobarRenunciaLinea(productoId, userId, nombre);
    } else {
      return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
    }

    const [productos, cobertura] = await Promise.all([listarProductosCompra(id), coberturaProyecto(id)]);
    return NextResponse.json({ success: true, productos, cobertura });
  } catch (error: any) {
    console.error('[compras/productos][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar el producto.' }, { status: 400 });
  }
}

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
