// app/api/equipo/route.ts
// «Mi equipo»: el admin de una empresa-cliente ve y agrega a las personas de SU empresa, dentro del tope de su plan.
//   GET  → personas de mi empresa + cuántas permite el plan.
//   POST → agrega una persona (clave temporal). Solo admin de la empresa.
//   PATCH → activa/desactiva a una persona de mi empresa (no a sí mismo).
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { fichaCliente } from '@/app/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const [rows] = await pool.query(
    'SELECT id, nombre, email, rol, activo, ultimo_login FROM usuarios WHERE cliente_id = ? ORDER BY activo DESC, id', [u.clienteId]);
  const ficha = await fichaCliente(u.clienteId);
  return NextResponse.json({ success: true, personas: rows, maxUsuarios: ficha.maxUsuarios, puedeAdministrar: u.rol === 'admin' });
}

export async function POST(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol !== 'admin') return NextResponse.json({ error: 'Solo el admin de la empresa puede agregar personas' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').toLowerCase().trim(), clave = String(b.clave || '');
  if (!email || clave.length < 8) return NextResponse.json({ error: 'Faltan el correo o la clave (mínimo 8 caracteres)' }, { status: 400 });
  const ficha = await fichaCliente(u.clienteId);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios WHERE cliente_id = ? AND activo = TRUE', [u.clienteId]) as any;
  if (ficha.maxUsuarios != null && Number(n) >= ficha.maxUsuarios)
    return NextResponse.json({ error: `Tu plan permite ${ficha.maxUsuarios} persona(s). Para sumar más, escríbenos.` }, { status: 409 });
  const [dup] = await pool.query('SELECT 1 FROM usuarios WHERE email = ? LIMIT 1', [email]);
  if ((dup as unknown[]).length) return NextResponse.json({ error: 'Ese correo ya está en uso' }, { status: 409 });
  // La persona nueva es un usuario normal de la empresa (nunca admin: el admin lo define LICITANK).
  const permisos = { acceso_radar: true, ver_otros_negocios: true, exportar: true };
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo, cliente_id, permisos) VALUES (?, ?, ?, ?, 'usuario', 1, ?, ?)`,
    [email, await bcrypt.hash(clave, 10), String(b.nombre || '').trim() || email, ficha.nombre, u.clienteId, JSON.stringify(permisos)]);
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol !== 'admin') return NextResponse.json({ error: 'Solo el admin de la empresa' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id || id === u.id) return NextResponse.json({ error: 'No puedes cambiarte a ti mismo' }, { status: 400 });
  await pool.query('UPDATE usuarios SET activo = ? WHERE id = ? AND cliente_id = ?', [b.activo ? 1 : 0, id, u.clienteId]);
  return NextResponse.json({ success: true });
}
