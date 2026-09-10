// app/api/compras/[negocioId]/route.ts
// MÓDULO DE COMPRAS — detalle de UN negocio ganado: resumen ejecutivo, estado de asignación y sus
// tareas. Visible para admin, jefe de ventas, cualquier Encargado de Compras, y el propio asignado
// (aunque no tenga el permiso general — es su trabajo).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { obtenerAsignacion, listarTareas, candidatosEncargado, crearTareasCatalogoSiCorresponde, obtenerResumenFases } from '@/app/lib/compras';
import { ordenesDeLicitacion } from '@/app/lib/ordenes-compra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Gate AMPLIO: encargado de compras/entrega del negocio, jefe de ventas o admin. Es el que ya
// usaban TODAS las rutas del módulo (aprobaciones, SKU, incidencias, importación, logística,
// gastos, productos, cotizaciones/escenarios, y casi toda `entrega`) — se deja intacto para no
// regalarle a los perfiles angostos nuevos (ver más abajo) acceso de escritura a secciones que no
// son suyas.
export async function puedeOperarCompras(userId: number, rol: string | null, asignadoA: number | null): Promise<boolean> {
  if (rol === 'admin') return true;
  if (asignadoA != null && Number(asignadoA) === Number(userId)) return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!(p.compras || p.aprobar_comercial);
}

// Gate ANCHO, solo para VER: suma administración y bodega (§2.2, sep-2026) — necesitan poder abrir
// la pestaña para llegar a SU sección, aunque no sean el encargado del negocio. Úsalo SOLO para
// lectura general (el GET de esta ruta) o para las acciones puntuales que de verdad son de ellos
// (RepartoAdminCard completo; la verificación dentro de EntregaCard) — nunca como reemplazo de
// `puedeOperarCompras` en una ruta de escritura genérica, o estarías dándoles permiso de más.
export async function puedeVerCompras(userId: number, rol: string | null, asignadoA: number | null): Promise<boolean> {
  if (await puedeOperarCompras(userId, rol, asignadoA)) return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!(p.compras_administracion || p.compras_bodega);
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Este negocio todavía no entra a Compras (no está ganado, o el resumen no se abrió).' }, { status: 404 });

    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA))) {
      return NextResponse.json({ error: 'Sin acceso a Compras de este negocio.' }, { status: 403 });
    }

    // Backfill perezoso: negocios asignados antes de que existiera una tarea nueva en el catálogo
    // (ej. "contacto_pagos", §17.3) nunca la sembraron. Idempotente.
    if (asignacion.asignadoA != null) {
      await crearTareasCatalogoSiCorresponde(id, asignacion.asignadoA, asignacion.asignadoNombre).catch(() => {});
    }

    const [tareas, candidatos, negRows, ordenes] = await Promise.all([
      listarTareas(id),
      candidatosEncargado(),
      pool.query(`SELECT licitacion_nombre, licitacion_organismo FROM negocios WHERE id = ? LIMIT 1`, [id]) as any,
      // La orden de compra ya vive en `ordenes_compra` con su link al portal y su PDF descargado.
      // Se manda lo justo para pintarla: el resto de la ficha ya viene en `asignacion.ordenCompra`.
      ordenesDeLicitacion(asignacion.licitacionCodigo).catch(() => []),
    ]);
    const neg = (negRows[0] as any[])[0] || {};
    const ocNuestra = (ordenes as any[]).find(o => o.esNuestra) || null;
    // Contadores por pestaña (solo tiene sentido pedirlos con encargado asignado — antes no hay
    // productos, cotizaciones ni compuertas de qué contar).
    const resumenFases = asignacion.asignadoA != null ? await obtenerResumenFases(id, tareas) : null;

    return NextResponse.json({
      success: true,
      asignacion,
      tareas,
      candidatos,
      resumenFases,
      licitacionNombre: neg.licitacion_nombre ?? null,
      licitacionOrganismo: neg.licitacion_organismo ?? null,
      ordenCompraMp: ocNuestra ? {
        codigo: ocNuestra.codigo, estado: ocNuestra.estado, url: ocNuestra.url, pdfUrl: ocNuestra.pdfUrl,
      } : null,
    });
  } catch (error: any) {
    console.error('[compras/[negocioId]][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar Compras de este negocio.' }, { status: 500 });
  }
}
