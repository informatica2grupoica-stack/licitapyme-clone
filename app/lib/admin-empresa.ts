// app/lib/admin-empresa.ts
// Guardia de las rutas /api/mi-empresa que solo puede usar el ADMIN de una empresa-cliente (no Grupo ICA). La empresa sale de la sesión, nunca del navegador.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { CLIENTE_ICA } from '@/app/lib/tenant';

export async function adminDeCliente(req: NextRequest, sinAcceso = 'Solo el admin de la empresa puede hacer esto') {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (u.clienteId === CLIENTE_ICA) return { error: NextResponse.json({ error: 'Grupo ICA usa las cuentas del servidor' }, { status: 400 }) };
  if (u.rol !== 'admin') return { error: NextResponse.json({ error: sinAcceso }, { status: 403 }) };
  return { u: { ...u, clienteId: u.clienteId } };
}
