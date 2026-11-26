// app/lib/admin-licitank.ts
// Guardia de las pantallas de administración de LICITANK (empresas-cliente, solicitudes de alta).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { CLIENTE_ICA } from '@/app/lib/tenant';

/** Superusuario o admin de Grupo ICA (cliente 1). Rol y cliente salen de la BD, nunca del navegador. */
export async function exigirAdminLicitank(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const [rows] = await pool.query('SELECT es_superadmin, rol FROM usuarios WHERE id = ? AND cliente_id = ? AND activo = TRUE LIMIT 1', [u.id, CLIENTE_ICA]);
  const f = (rows as Array<{ es_superadmin: number; rol: string }>)[0];
  if (!f || !(f.es_superadmin || f.rol === 'admin'))
    return { error: NextResponse.json({ error: 'Solo los administradores de LICITANK' }, { status: 403 }) };
  return { u, superadmin: !!f.es_superadmin };
}
