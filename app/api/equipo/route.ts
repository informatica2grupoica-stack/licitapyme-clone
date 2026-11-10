// app/api/equipo/route.ts
// «Mi equipo»: el admin de una empresa-cliente administra a las personas de SU empresa: crear, perfil/rol, permisos, clave y activar/desactivar.
//   GET   → personas de mi empresa (con sus permisos), el catálogo de permisos de MIS módulos, los perfiles y el tope del plan.
//   POST  → agrega una persona (perfil o permisos a mano + clave temporal).
//   PATCH → cambia a una persona de mi empresa: { id, nombre?, perfil? | rol?+permisos?, activo?, resetClave? }.
// Reglas del servidor (la pantalla solo las muestra): todo va acotado a MI cliente_id; el navegador nunca dice de qué empresa; los permisos se
// filtran a los módulos contratados; nadie se cambia a sí mismo el rol ni el estado; la empresa nunca se queda sin un admin activo; el tope de
// personas del plan se respeta también al reactivar. Un id de otra empresa responde «no encontrado», igual que uno que no existe.
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { fichaCliente } from '@/app/lib/tenant';
import { olvidarEstadoVigente } from '@/app/lib/rol-vigente';
import { registrarActividad } from '@/app/lib/actividad';
import {
  PERFILES, ROLES_EMPRESA, catalogoParaModulos, claveTemporal, perfilPorId, permisosDePerfil, sanearPermisos, type RolEmpresa,
} from '@/app/lib/equipo-permisos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noEncontrado = () => NextResponse.json({ error: 'No encontrado' }, { status: 404 });
const soloAdmin = () => NextResponse.json({ error: 'Solo el admin de la empresa puede administrar al equipo' }, { status: 403 });

function leerPermisos(raw: unknown): Record<string, boolean> {
  if (!raw) return {};
  try { const p = typeof raw === 'string' ? JSON.parse(raw) : raw; return p && typeof p === 'object' ? p as Record<string, boolean> : {}; } catch { return {}; }
}

/** ¿Cuántos admins ACTIVOS tiene la empresa, sin contar a `salvoId`? */
async function adminsActivos(clienteId: number, salvoId: number): Promise<number> {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM usuarios WHERE cliente_id = ? AND rol = 'admin' AND activo = 1 AND id <> ?`, [clienteId, salvoId]) as any;
  return Number(r.n);
}
async function activosDeLaEmpresa(clienteId: number): Promise<number> {
  const [[r]] = await pool.query(`SELECT COUNT(*) n FROM usuarios WHERE cliente_id = ? AND activo = 1`, [clienteId]) as any;
  return Number(r.n);
}

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const ficha = await fichaCliente(u.clienteId);
  const [rows] = await pool.query(
    `SELECT id, nombre, email, rol, activo, ultimo_login, permisos FROM usuarios WHERE cliente_id = ? AND COALESCE(es_superadmin, 0) = 0 ORDER BY activo DESC, id`,
    [u.clienteId]) as any;
  const personas = (rows as any[]).map(r => ({ id: r.id, nombre: r.nombre, email: r.email, rol: r.rol, activo: r.activo, ultimo_login: r.ultimo_login, permisos: leerPermisos(r.permisos) }));
  const admin = u.rol === 'admin';
  return NextResponse.json({
    success: true, personas, maxUsuarios: ficha.maxUsuarios, puedeAdministrar: admin, yo: u.id,
    // Solo el admin necesita el catálogo y los perfiles (para dibujar el editor).
    ...(admin ? { catalogo: catalogoParaModulos(ficha.modulos), perfiles: PERFILES.map(p => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion, rol: p.rol, permisos: Object.keys(permisosDePerfil(p, ficha.modulos)) })) } : {}),
  });
}

export async function POST(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol !== 'admin') return soloAdmin();
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').toLowerCase().trim(), clave = String(b.clave || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Escribe un correo válido' }, { status: 400 });
  if (clave.length < 8) return NextResponse.json({ error: 'La clave temporal necesita mínimo 8 caracteres' }, { status: 400 });
  const ficha = await fichaCliente(u.clienteId);
  if (ficha.maxUsuarios != null && await activosDeLaEmpresa(u.clienteId) >= ficha.maxUsuarios)
    return NextResponse.json({ error: `Tu plan permite ${ficha.maxUsuarios} persona(s). Para sumar más, escríbenos.` }, { status: 409 });
  const [dup] = await pool.query('SELECT 1 FROM usuarios WHERE email = ? LIMIT 1', [email]);
  // Mensaje neutro: el correo puede estar en otra empresa y no hay que decir dónde.
  if ((dup as unknown[]).length) return NextResponse.json({ error: 'Ese correo no está disponible. Usa otro.' }, { status: 409 });

  // Perfil (por defecto, Analista) o rol + permisos a mano. Siempre filtrado a los módulos contratados.
  const perfil = perfilPorId(b.perfil ?? (b.rol || b.permisos ? null : 'analista'));
  let rol: RolEmpresa, permisos: Record<string, true>;
  if (perfil) { rol = perfil.rol; permisos = permisosDePerfil(perfil, ficha.modulos); }
  else {
    rol = ROLES_EMPRESA.includes(b.rol) ? b.rol : 'usuario';
    permisos = sanearPermisos(b.permisos, ficha.modulos);
  }
  const [r] = await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo, cliente_id, permisos) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [email, await bcrypt.hash(clave, 10), String(b.nombre || '').trim().slice(0, 120) || email, ficha.nombre, rol, u.clienteId, JSON.stringify(permisos)]) as any;
  registrarActividad({ usuarioId: u.id, accion: 'equipo_agregar', entidadTipo: 'usuario', entidadId: String(r.insertId), descripcion: `Agregó a ${email} (${rol})`, metadata: { rol, permisos: Object.keys(permisos) } });
  return NextResponse.json({ success: true, id: r.insertId });
}

export async function PATCH(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol !== 'admin') return soloAdmin();
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Falta la persona' }, { status: 400 });

  // La persona tiene que ser de MI empresa (y nunca un superusuario de LICITANK).
  const [rows] = await pool.query(
    `SELECT id, email, rol, activo FROM usuarios WHERE id = ? AND cliente_id = ? AND COALESCE(es_superadmin, 0) = 0 LIMIT 1`, [id, u.clienteId]) as any;
  const p = (rows as any[])[0];
  if (!p) return noEncontrado();
  const ficha = await fichaCliente(u.clienteId);
  const soyYo = id === u.id;
  const sets: string[] = [], vals: unknown[] = [];
  const cambios: string[] = [];
  let claveNueva: string | undefined;

  if (typeof b.nombre === 'string') { sets.push('nombre = ?'); vals.push(b.nombre.trim().slice(0, 120) || p.email); cambios.push('nombre'); }

  // Perfil, o rol y/o permisos por separado.
  const perfil = b.perfil != null ? perfilPorId(b.perfil) : null;
  if (b.perfil != null && !perfil) return NextResponse.json({ error: 'Perfil desconocido' }, { status: 400 });
  const rolNuevo: RolEmpresa | undefined = perfil ? perfil.rol : (b.rol != null ? b.rol : undefined);
  if (rolNuevo !== undefined && !ROLES_EMPRESA.includes(rolNuevo)) return NextResponse.json({ error: 'Rol desconocido' }, { status: 400 });
  if (rolNuevo !== undefined && rolNuevo !== p.rol) {
    if (soyYo) return NextResponse.json({ error: 'No puedes cambiarte tu propio rol' }, { status: 400 });
    if (p.rol === 'admin' && p.activo && await adminsActivos(u.clienteId, id) === 0)
      return NextResponse.json({ error: 'La empresa no puede quedarse sin un administrador activo' }, { status: 409 });
    sets.push('rol = ?'); vals.push(rolNuevo); cambios.push(`rol→${rolNuevo}`);
  }
  if (perfil || b.permisos !== undefined) {
    if (soyYo) return NextResponse.json({ error: 'No puedes cambiarte tus propios permisos' }, { status: 400 });
    const permisos = perfil ? permisosDePerfil(perfil, ficha.modulos) : sanearPermisos(b.permisos, ficha.modulos);
    sets.push('permisos = ?'); vals.push(JSON.stringify(permisos)); cambios.push('permisos');
  }

  if (b.activo !== undefined) {
    const activar = !!b.activo;
    if (soyYo) return NextResponse.json({ error: 'No puedes desactivarte a ti mismo' }, { status: 400 });
    if (activar && !p.activo && ficha.maxUsuarios != null && await activosDeLaEmpresa(u.clienteId) >= ficha.maxUsuarios)
      return NextResponse.json({ error: `Tu plan permite ${ficha.maxUsuarios} persona(s) activa(s). Desactiva a otra primero.` }, { status: 409 });
    if (!activar && p.rol === 'admin' && p.activo && await adminsActivos(u.clienteId, id) === 0)
      return NextResponse.json({ error: 'La empresa no puede quedarse sin un administrador activo' }, { status: 409 });
    sets.push('activo = ?'); vals.push(activar ? 1 : 0); cambios.push(activar ? 'reactivar' : 'desactivar');
  }

  if (b.resetClave === true) {
    claveNueva = claveTemporal();
    sets.push('password_hash = ?'); vals.push(await bcrypt.hash(claveNueva, 10)); cambios.push('clave');
  }

  if (!sets.length) return NextResponse.json({ error: 'No hay nada que cambiar' }, { status: 400 });
  await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ? AND cliente_id = ?`, [...vals, id, u.clienteId]);
  olvidarEstadoVigente(id);   // el nuevo rol o el estado desactivado rigen de inmediato (la caché dura 30 s)
  registrarActividad({ usuarioId: u.id, accion: 'equipo_cambiar', entidadTipo: 'usuario', entidadId: String(id), descripcion: `Cambió a ${p.email}: ${cambios.join(', ')}`, metadata: { cambios } });
  // La clave temporal se entrega UNA sola vez en esta respuesta; no queda guardada en ningún lado.
  return NextResponse.json({ success: true, ...(claveNueva ? { claveTemporal: claveNueva } : {}) });
}
