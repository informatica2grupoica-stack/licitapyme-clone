// app/lib/auditor-acceso.ts
// Acceso común a las rutas del AUDITOR unificado (app/api/negocios/[id]/auditor/**): usuario, permiso
// `auditor_compra` (o admin), negocio y si puede aprobar (EM = admin o `aprobar_comercial`).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado, permisosCrudosDeUsuario } from '@/app/lib/api-auth';

// Consultas mínimas propias (en vez de importar ../comercial/route, que arrastra todo el Auditor Técnico).
async function cargarNegocio(id: string) {
  const [rows] = await pool.query(
    `SELECT id, licitacion_codigo, estado_pipeline, asignado_a FROM negocios WHERE id = ? AND activo = TRUE LIMIT 1`, [id]) as any;
  return (rows as any[])[0] || null;
}
async function nombreDe(userId: number): Promise<string | null> {
  try {
    const [rows] = await pool.query('SELECT nombre FROM usuarios WHERE id = ? LIMIT 1', [userId]) as any;
    return (rows as any[])[0]?.nombre ?? null;
  } catch { return null; }
}

export interface ContextoAuditor {
  userId: number;
  perm: { acceso: boolean; esEM: boolean };
  negocio: { id: number; licitacion_codigo: string; estado_pipeline: string; asignado_a: number | null };
  actor: { id: number; nombre: string };
}

/** Devuelve el contexto autorizado o una NextResponse de error lista para retornar. */
export async function contextoAuditor(request: NextRequest, params: Promise<{ id: string }>): Promise<ContextoAuditor | NextResponse> {
  const idH = request.headers.get('x-user-id'), rol = request.headers.get('x-user-rol');
  const userId = idH ? parseInt(idH) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  let perm = { acceso: true, esEM: true };
  if (rol !== 'admin') { const p = await permisosCrudosDeUsuario(userId); perm = { acceso: !!p.auditor_compra, esEM: !!p.aprobar_comercial }; }
  if (!perm.acceso) return NextResponse.json({ error: 'El Auditor está habilitado solo para administradores o para quien tenga el permiso "Auditor de Compra — trabajarlo".' }, { status: 403 });
  const { id } = await params;
  const negocio = await cargarNegocio(id);
  if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a))) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  const nombre = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
  return { userId, perm, negocio, actor: { id: userId, nombre } };
}
