// app/api/compras/[negocioId]/route.ts
// MÓDULO DE COMPRAS — detalle de UN negocio ganado: resumen ejecutivo, estado de asignación y sus
// tareas. Visible para admin, jefe de ventas, cualquier Encargado de Compras, y el propio asignado
// (aunque no tenga el permiso general — es su trabajo).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { armarRelojAutomatico, obtenerAsignacion, listarTareas, candidatosEncargado, crearTareasCatalogoSiCorresponde, obtenerResumenFases, obtenerHitosGantt, negociosConCompraAprobada, esAuditorAcotado } from '@/app/lib/compras';
import { ordenesDeLicitacion } from '@/app/lib/ordenes-compra';
import { facturacionActaGuardada } from '@/app/lib/acta-adjudicacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Gate AMPLIO: encargado de compras/entrega del negocio, jefe de ventas, o admin CON `compras_todo`.
// Es el que ya usaban TODAS las rutas del módulo (aprobaciones, SKU, incidencias, importación,
// logística, gastos, productos, cotizaciones/escenarios, y casi toda `entrega`) — se deja intacto
// para no regalarle a los perfiles angostos nuevos (ver más abajo) acceso de escritura a secciones
// que no son suyas.
//
// OJO — cambio de criterio (10-sep-2026, pedido explícito): "ser admin" YA NO alcanza por sí solo
// para el módulo de Compras. Antes cualquier admin de la cuenta entraba a todo; ahora se exige el
// permiso `compras_todo` real, o `compras`/`aprobar_comercial` reales — ninguno de los tres se lee
// con `permisosDeUsuario` (ese auto-otorga `compras` y `aprobar_comercial` a CUALQUIER admin, lo
// que dejaría la puerta abierta igual) sino con `permisosCrudosDeUsuario`, que ignora el rol y lee
// solo lo guardado de verdad. Se asigna a mano solo a los perfiles que de verdad deben ver TODO el
// módulo (hoy: Asesor y el dueño del proyecto). Un admin sin ninguno de estos tres permisos reales
// sigue entrando igual si es el encargado asignado de ESE negocio puntual.
export async function puedeOperarCompras(userId: number, rol: string | null, asignadoA: number | null, coencargados: Array<{ id: number }> = []): Promise<boolean> {
  if (asignadoA != null && Number(asignadoA) === Number(userId)) return true;
  if (coencargados.some(c => Number(c.id) === Number(userId))) return true;   // otro encargado del mismo negocio (migration-142)
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial || p.compras_auditor);
}

// Igual que `puedeOperarCompras`, pero SIN el perfil Auditor de Compras (`compras_auditor`): el Auditor trabaja desde que se
// aprueba la compra (SKU, OC, logística, entrega, cierre) y no entra a cotizar/costear (cotizaciones, escenarios, fichas, costeo).
export async function puedeOperarPreAprobacion(userId: number, rol: string | null, asignadoA: number | null, coencargados: Array<{ id: number }> = []): Promise<boolean> {
  if (asignadoA != null && Number(asignadoA) === Number(userId)) return true;
  if (coencargados.some(c => Number(c.id) === Number(userId))) return true;
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial);
}
export async function puedeVerPreAprobacion(userId: number, rol: string | null, asignadoA: number | null, coencargados: Array<{ id: number }> = []): Promise<boolean> {
  if (await puedeOperarPreAprobacion(userId, rol, asignadoA, coencargados)) return true;
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_administracion || p.compras_bodega || p.compras_ver || p.compras_auditor);
}

// Gate ANCHO, solo para VER: suma administración y bodega (§2.2, sep-2026) — necesitan poder abrir
// la pestaña para llegar a SU sección, aunque no sean el encargado del negocio. Úsalo SOLO para
// lectura general (el GET de esta ruta) o para las acciones puntuales que de verdad son de ellos
// (RepartoAdminCard completo; la verificación dentro de EntregaCard) — nunca como reemplazo de
// `puedeOperarCompras` en una ruta de escritura genérica, o estarías dándoles permiso de más.
export async function puedeVerCompras(userId: number, rol: string | null, asignadoA: number | null, coencargados: Array<{ id: number }> = []): Promise<boolean> {
  if (await puedeOperarCompras(userId, rol, asignadoA, coencargados)) return true;
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_administracion || p.compras_bodega || p.compras_ver);
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

    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) {
      return NextResponse.json({ error: 'Sin acceso a Compras de este negocio.' }, { status: 403 });
    }
    // Auditor de Compras: entra recién cuando la compra del negocio está aprobada (compra directa o cuadro de compra).
    if (esAuditorAcotado(await permisosCrudosDeUsuario(userId)) && !(await puedeVerPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados))
        && !(await negociosConCompraAprobada(id)).has(id)) {
      return NextResponse.json({ error: 'Este negocio todavía no tiene la compra aprobada. El Auditor entra desde la aprobación.' }, { status: 403 });
    }

    // Backfill perezoso: negocios asignados antes de que existiera una tarea nueva en el catálogo
    // (ej. "contacto_pagos", §17.3) nunca la sembraron. Idempotente.
    // El reloj de entrega se arma solo cuando ya hay inicio real del plazo (no pisa uno ya fijado).
    // Tareas y reloj no dependen entre sí: van a la vez.
    await Promise.all([
      asignacion.asignadoA != null ? crearTareasCatalogoSiCorresponde(id, asignacion.asignadoA, asignacion.asignadoNombre).catch(() => {}) : null,
      armarRelojAutomatico(id),
    ]);

    // Contadores por pestaña (solo tiene sentido pedirlos con encargado asignado — antes no hay
    // productos, cotizaciones ni compuertas de qué contar). Arrancan apenas llegan las tareas, sin esperar al resto.
    const tareasP = listarTareas(id);
    const [tareas, resumenFases, hitosGantt, candidatos, negRows, ordenes, facturacionActa] = await Promise.all([
      tareasP,
      asignacion.asignadoA != null ? tareasP.then(t => obtenerResumenFases(id, t)) : null,
      obtenerHitosGantt(id),
      candidatosEncargado(),
      pool.query(`SELECT licitacion_nombre, licitacion_organismo, licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [id]) as any,
      // La orden de compra ya vive en `ordenes_compra` con su link al portal y su PDF descargado.
      // Se manda lo justo para pintarla: el resto de la ficha ya viene en `asignacion.ordenCompra`.
      ordenesDeLicitacion(asignacion.licitacionCodigo, asignacion.ordenCompra?.codigoMp).catch(() => []),
      // Datos para facturar desde el acta: existen desde la adjudicación, antes de que llegue la OC.
      facturacionActaGuardada(asignacion.licitacionCodigo),
    ]);
    const neg = (negRows[0] as any[])[0] || {};
    const ocNuestra = (ordenes as any[]).find(o => o.esNuestra) || null;

    return NextResponse.json({
      success: true,
      asignacion,
      tareas,
      hitosGantt,
      candidatos,
      resumenFases,
      licitacionNombre: neg.licitacion_nombre ?? null,
      licitacionOrganismo: neg.licitacion_organismo ?? null,
      // El código de licitación EN VIVO de `negocios` (no el congelado en `compras_asignacion.
      // licitacion_codigo` al momento de ganar) — los documentos se suben/clasifican por código de
      // licitación en cualquier momento, incluso después de ganada, así que la tarjeta de
      // documentos debe buscar por el código actual para no dejar huérfanos si el código se corrigió.
      licitacionCodigoActual: neg.licitacion_codigo ?? asignacion.licitacionCodigo,
      ordenCompraMp: ocNuestra ? {
        codigo: ocNuestra.codigo, estado: ocNuestra.estado, url: ocNuestra.url, pdfUrl: ocNuestra.pdfUrl, facturacion: ocNuestra.facturacion ?? null,
      } : null,
      facturacionActa,
    });
  } catch (error: any) {
    console.error('[compras/[negocioId]][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar Compras de este negocio.' }, { status: 500 });
  }
}
