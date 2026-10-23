// app/api/admin/clientes/route.ts
// Panel del SUPERUSUARIO: empresas-cliente de LICITANK, sus módulos, vencimiento y estado.
//   GET   → lista de empresas con módulos, usuarios y últimos movimientos.
//   POST  → crea una empresa y su perfil admin (clave temporal).
//   PATCH → activa/quita módulos, suspende/reactiva, vencimiento, tope de usuarios, notas. Todo queda en la bitácora.
// Solo `es_superadmin` de Grupo ICA. Un admin de una empresa-cliente jamás llega aquí (proxy.ts bloquea /api/admin a los clientes).
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { olvidarFichaCliente, CLIENTE_ICA } from '@/app/lib/tenant';
import { TODOS_LOS_MODULOS, MODULOS_BASE, MODULOS_ACTIVABLES, modulosEfectivos } from '@/app/lib/modulos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function exigirSuperadmin(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const [rows] = await pool.query('SELECT es_superadmin FROM usuarios WHERE id = ? AND cliente_id = ? LIMIT 1', [u.id, CLIENTE_ICA]);
  if (!(rows as Array<{ es_superadmin: number }>)[0]?.es_superadmin)
    return { error: NextResponse.json({ error: 'Solo el superusuario' }, { status: 403 }) };
  return { u };
}

async function bitacora(clienteId: number, usuarioId: number, accion: string, detalle: unknown) {
  await pool.query('INSERT INTO clientes_bitacora (cliente_id, usuario_id, accion, detalle) VALUES (?, ?, ?, ?)',
    [clienteId, usuarioId, accion, JSON.stringify(detalle ?? null)]).catch(e => console.error('[clientes] bitácora:', String(e)));
}

export async function GET(req: NextRequest) {
  const g = await exigirSuperadmin(req);
  if (g.error) return g.error;
  const [clientes] = await pool.query(
    `SELECT c.id, c.nombre, c.rut, c.plan, c.estado, c.max_usuarios, c.cupo_ia_mensual, c.modulos, c.notas, c.contacto_nombre, c.contacto_email,
            DATE_FORMAT(c.vence_at, '%Y-%m-%d') AS vence_at,
            (SELECT COUNT(*) FROM usuarios u WHERE u.cliente_id = c.id AND u.activo = TRUE) AS usuarios
       FROM clientes c WHERE c.activo = TRUE ORDER BY c.id`);
  const [bit] = await pool.query(
    `SELECT b.cliente_id, b.accion, b.detalle, b.created_at, u.nombre AS por
       FROM clientes_bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id DESC LIMIT 60`).catch(() => [[]] as unknown as [unknown]);
  const lista = (clientes as Array<Record<string, unknown>>).map(c => ({ ...c, modulos: modulosEfectivos(c.modulos).filter(m => MODULOS_ACTIVABLES.includes(m)) }));
  return NextResponse.json({ success: true, clientes: lista, catalogo: TODOS_LOS_MODULOS, activables: MODULOS_ACTIVABLES, bitacora: bit });
}

export async function POST(req: NextRequest) {
  const g = await exigirSuperadmin(req);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));

  // Agregar una persona a una empresa existente (respeta el tope de usuarios del plan).
  if (b.accion === 'usuario') {
    const cid = Number(b.clienteId), em = String(b.email || '').toLowerCase().trim(), cl = String(b.clave || '');
    if (!cid || cid === CLIENTE_ICA || !em || cl.length < 8) return NextResponse.json({ error: 'Faltan empresa, correo o clave (mínimo 8 caracteres)' }, { status: 400 });
    const [[c]] = await pool.query('SELECT nombre, max_usuarios FROM clientes WHERE id = ? AND activo = TRUE', [cid]) as any;
    if (!c) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios WHERE cliente_id = ? AND activo = TRUE', [cid]) as any;
    if (c.max_usuarios != null && Number(n) >= Number(c.max_usuarios))
      return NextResponse.json({ error: `El plan permite ${c.max_usuarios} usuario(s). Sube el tope primero.` }, { status: 409 });
    const [dup2] = await pool.query('SELECT 1 FROM usuarios WHERE email = ? LIMIT 1', [em]);
    if ((dup2 as unknown[]).length) return NextResponse.json({ error: 'Ese correo ya existe' }, { status: 409 });
    const perm = { acceso_radar: true, ver_otros_negocios: true, exportar: true };
    await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo, cliente_id, permisos) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [em, await bcrypt.hash(cl, 10), String(b.nombre || '').trim() || em, c.nombre, b.rol === 'admin' ? 'admin' : 'usuario', cid, JSON.stringify(perm)]);
    await bitacora(cid, g.u!.id, 'usuario', { email: em, rol: b.rol === 'admin' ? 'admin' : 'usuario' });
    return NextResponse.json({ success: true });
  }

  const nombre = String(b.nombre || '').trim(), rut = String(b.rut || '').trim();
  const email = String(b.adminEmail || '').toLowerCase().trim(), adminNombre = String(b.adminNombre || '').trim();
  const clave = String(b.clave || '');
  if (!nombre || !email || clave.length < 8) return NextResponse.json({ error: 'Faltan nombre, correo del admin o clave (mínimo 8 caracteres)' }, { status: 400 });
  const modulos = (Array.isArray(b.modulos) ? b.modulos : MODULOS_BASE).filter((m: string) => (MODULOS_ACTIVABLES as string[]).includes(m));
  const [dup] = await pool.query('SELECT 1 FROM usuarios WHERE email = ? LIMIT 1', [email]);
  if ((dup as unknown[]).length) return NextResponse.json({ error: 'Ese correo ya existe' }, { status: 409 });

  const [r] = await pool.query(
    `INSERT INTO clientes (nombre, rut, plan, max_usuarios, estado, modulos, vence_at, contacto_nombre, contacto_email, activo)
     VALUES (?, ?, 'BASE', ?, 'ACTIVO', ?, ?, ?, ?, 1)`,
    [nombre, rut || null, Number(b.maxUsuarios) || 1, JSON.stringify(modulos), b.venceAt || null, adminNombre || null, email]);
  const clienteId = (r as { insertId: number }).insertId;
  // Perfil admin de la empresa: admin DENTRO de su empresa (proxy.ts le impide salir de ella). Permisos solo de los módulos contratados.
  const permisos = { acceso_radar: true, ver_otros_negocios: true, exportar: true, repartir_puente: true };
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo, cliente_id, permisos) VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)`,
    [email, await bcrypt.hash(clave, 10), adminNombre || nombre, nombre, clienteId, JSON.stringify(permisos)]);
  await bitacora(clienteId, g.u!.id, 'crear', { nombre, modulos, admin: email });
  return NextResponse.json({ success: true, id: clienteId });
}

export async function PATCH(req: NextRequest) {
  const g = await exigirSuperadmin(req);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id || id === CLIENTE_ICA) return NextResponse.json({ error: 'Empresa no válida' }, { status: 400 });
  const sets: string[] = [], vals: unknown[] = [], det: Record<string, unknown> = {};
  if (Array.isArray(b.modulos)) {
    const m = b.modulos.filter((x: string) => (MODULOS_ACTIVABLES as string[]).includes(x));
    sets.push('modulos = ?'); vals.push(JSON.stringify(m)); det.modulos = m;
  }
  if (b.estado === 'ACTIVO' || b.estado === 'SUSPENDIDO' || b.estado === 'BAJA') { sets.push('estado = ?'); vals.push(b.estado); det.estado = b.estado; }
  if ('venceAt' in b) { sets.push('vence_at = ?'); vals.push(b.venceAt || null); det.venceAt = b.venceAt || null; }
  if (b.maxUsuarios != null) { sets.push('max_usuarios = ?'); vals.push(Math.max(1, Number(b.maxUsuarios) || 1)); det.maxUsuarios = b.maxUsuarios; }
  if (b.cupoIa != null) { sets.push('cupo_ia_mensual = ?'); vals.push(Math.max(0, Number(b.cupoIa) || 0)); det.cupoIa = b.cupoIa; }
  if (typeof b.notas === 'string') { sets.push('notas = ?'); vals.push(b.notas.slice(0, 2000)); det.notas = true; }
  if (!sets.length) return NextResponse.json({ error: 'Nada que cambiar' }, { status: 400 });
  vals.push(id);
  await pool.query(`UPDATE clientes SET ${sets.join(', ')} WHERE id = ?`, vals);
  olvidarFichaCliente(id); // rige al instante
  await bitacora(id, g.u!.id, 'cambio', det);
  return NextResponse.json({ success: true });
}
