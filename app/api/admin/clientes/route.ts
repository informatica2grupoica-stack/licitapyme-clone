// app/api/admin/clientes/route.ts
// Panel de LICITANK para las empresas-cliente: plan (Básico/Pro), módulos adicionales, vencimiento y estado.
//   GET   → lista de empresas con módulos, usuarios y últimos movimientos.
//   POST  → crea una empresa y su perfil admin (clave temporal).
//   PATCH → cambia el plan, activa/quita adicionales, suspende/reactiva, vencimiento, tope de usuarios, notas. Todo queda en la bitácora.
// Entran el superusuario y los admin de Grupo ICA (cliente 1; regla del dueño 2026-11-18). BORRAR una empresa sigue siendo solo del
// superusuario (no se puede deshacer). Un admin de una empresa-cliente jamás llega aquí (proxy.ts bloquea /api/admin a los clientes).
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { olvidarFichaCliente, CLIENTE_ICA } from '@/app/lib/tenant';
import { encolarEvaluacion, leerEvaluacion, rutsDeCliente, rutValido, formatearRut } from '@/app/lib/evaluar-empresa-rut';
import { exigirAdminLicitank } from '@/app/lib/admin-licitank';
import { crearEmpresaCliente, ErrorAlta } from '@/app/lib/crear-empresa-cliente';
import { guardarOpciones } from '@/app/lib/opciones-empresa';
import { guardarConfigEmpresa } from '@/app/lib/cv/viabilidad-empresa';
import { normalizarConfigEmpresa } from '@/app/lib/cv/viabilidad-empresa-core';
import { normalizarOpciones } from '@/app/lib/opciones-empresa-core';
import { gastoIaMesPorCliente, consultasMpHoyPorCliente } from '@/app/lib/medidor-cliente';
import { planBorrado, exportarCliente, borrarCliente, archivosDelCliente } from '@/app/lib/borrar-cliente';
import { TODOS_LOS_MODULOS, MODULOS_ACTIVABLES, MODULOS_DEL_PLAN, PLANES, modulosEfectivos, modulosDeCliente, normalizarPlan, type Plan } from '@/app/lib/modulos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const planValido = (v: unknown): v is Plan => (PLANES as string[]).includes(String(v));

async function bitacora(clienteId: number, usuarioId: number, accion: string, detalle: unknown) {
  await pool.query('INSERT INTO clientes_bitacora (cliente_id, usuario_id, accion, detalle) VALUES (?, ?, ?, ?)',
    [clienteId, usuarioId, accion, JSON.stringify(detalle ?? null)]).catch(e => console.error('[clientes] bitácora:', String(e)));
}

export async function GET(req: NextRequest) {
  const g = await exigirAdminLicitank(req);
  if (g.error) return g.error;
  const evId = Number(req.nextUrl.searchParams.get('evaluacion'));
  if (evId) return NextResponse.json({ success: true, evaluacion: await leerEvaluacion(evId) });
  // Equipo de una empresa (pestaña Usuarios de la ficha).
  const usrId = Number(req.nextUrl.searchParams.get('usuarios'));
  if (usrId) {
    const [us] = await pool.query('SELECT id, nombre, email, rol, activo FROM usuarios WHERE cliente_id = ? ORDER BY activo DESC, rol, nombre', [usrId]);
    return NextResponse.json({ success: true, usuarios: us });
  }
  // Baja de una empresa (Ley 21.719): vista previa de lo que se borraría, o exportación de todos sus datos (JSON descargable).
  const borradoId = Number(req.nextUrl.searchParams.get('borrado'));
  const exportarId = Number(req.nextUrl.searchParams.get('exportar'));
  // Exportar (todos los datos de la empresa) y borrar quedan solo para el superusuario.
  if ((borradoId || exportarId) && !g.superadmin) return NextResponse.json({ error: 'Solo el superusuario' }, { status: 403 });
  if (borradoId) {
    if (borradoId === CLIENTE_ICA) return NextResponse.json({ error: 'Grupo ICA no se puede borrar' }, { status: 400 });
    const plan = await planBorrado(borradoId);
    const archivos = (await archivosDelCliente(plan.pasos)).length;
    return NextResponse.json({ success: true, ...plan, archivos, pasos: plan.pasos.filter(p => p.filas > 0).map(({ tabla, accion, filas }) => ({ tabla, accion, filas })) });
  }
  if (exportarId) {
    if (exportarId === CLIENTE_ICA) return NextResponse.json({ error: 'No aplica a Grupo ICA' }, { status: 400 });
    const datos = await exportarCliente(exportarId);
    await bitacora(exportarId, g.u!.id, 'exportar', null);
    return new NextResponse(JSON.stringify(datos, null, 1), { headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="licitank-empresa-${exportarId}-${new Date().toISOString().slice(0, 10)}.json"`,
    } });
  }
  const [clientes] = await pool.query(
    `SELECT c.id, c.nombre, c.rut, c.plan, c.estado, c.max_usuarios, c.cupo_ia_mensual, c.tope_ia_usd_mes, c.tope_mp_diario, c.modulos, c.notas, c.contacto_nombre, c.contacto_email, c.config_json,
            DATE_FORMAT(c.vence_at, '%Y-%m-%d') AS vence_at,
            (SELECT COUNT(*) FROM usuarios u WHERE u.cliente_id = c.id AND u.activo = TRUE) AS usuarios
       FROM clientes c WHERE c.activo = TRUE ORDER BY c.id`);
  const [bit] = await pool.query(
    `SELECT b.cliente_id, b.accion, b.detalle, b.created_at, u.nombre AS por
       FROM clientes_bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id DESC LIMIT 60`).catch(() => [[]] as unknown as [unknown]);
  // Medidor (migration-185): gasto de IA del mes y consultas a MP de hoy, por empresa.
  const [iaMes, mpHoy] = await Promise.all([gastoIaMesPorCliente(), consultasMpHoyPorCliente()]).catch(() => [new Map<number, number>(), new Map<number, number>()]);
  // Configuración de la Viabilidad IA de cada empresa (migration-201): una consulta para todas.
  const cfgViab = new Map<number, unknown>();
  try { const [fv] = await pool.query('SELECT cliente_id, config FROM cliente_viabilidad_config'); for (const f of fv as Array<{ cliente_id: number; config: unknown }>) cfgViab.set(Number(f.cliente_id), f.config); } catch { /* sin migration-201 */ }
  const lista = (clientes as Array<Record<string, unknown>>).map(c => ({
    viabilidad: normalizarConfigEmpresa(cfgViab.get(Number(c.id))),
    ...c, plan: normalizarPlan(c.plan), opciones: normalizarOpciones(c.config_json), config_json: undefined,
    // adicionales = lo marcado a mano que el plan no trae; modulos = lo que de verdad usa (plan + adicionales)
    adicionales: (c.modulos == null ? [] : modulosEfectivos(c.modulos)).filter(m => MODULOS_ACTIVABLES.includes(m) && !MODULOS_DEL_PLAN[normalizarPlan(c.plan)].includes(m)),
    modulos: modulosDeCliente(c.plan, c.modulos),
    ia_usd_mes: Math.round((iaMes.get(Number(c.id)) ?? 0) * 100) / 100, mp_hoy: mpHoy.get(Number(c.id)) ?? 0,
  }));
  return NextResponse.json({ success: true, clientes: lista, catalogo: TODOS_LOS_MODULOS, activables: MODULOS_ACTIVABLES, planes: MODULOS_DEL_PLAN, bitacora: bit, puedeBorrar: g.superadmin });
}

export async function POST(req: NextRequest) {
  const g = await exigirAdminLicitank(req);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));

  // (Re)evaluar la empresa por TODOS sus RUT: va a la cola (sobrevive a un deploy); el avance se lee con GET ?evaluacion=<id>.
  if (b.accion === 'evaluar') {
    const cid = Number(b.clienteId);
    const [[c]] = await pool.query('SELECT id FROM clientes WHERE id = ? AND activo = TRUE', [cid]) as any;
    if (!cid || cid === CLIENTE_ICA || !c) return NextResponse.json({ error: 'Empresa no válida' }, { status: 400 });
    const r = await encolarEvaluacion(cid, { forzar: true });
    if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: r.motivo?.includes('en curso') ? 409 : 400 });
    await bitacora(cid, g.u!.id, 'evaluar', { ruts: (await rutsDeCliente(cid)).map(x => x.rut) });
    return NextResponse.json({ success: true });
  }

  // Borrar TODOS los datos de una empresa (tiene que estar suspendida; se confirma escribiendo su nombre exacto).
  if (b.accion === 'borrar') {
    if (!g.superadmin) return NextResponse.json({ error: 'Borrar una empresa lo hace solo el superusuario' }, { status: 403 });
    const cid = Number(b.clienteId);
    const [[c]] = await pool.query('SELECT nombre FROM clientes WHERE id = ?', [cid]) as any;
    if (!cid || cid === CLIENTE_ICA || !c) return NextResponse.json({ error: 'Empresa no válida' }, { status: 400 });
    if (String(b.confirmar || '').trim() !== String(c.nombre).trim()) return NextResponse.json({ error: 'Para confirmar, escribe el nombre exacto de la empresa.' }, { status: 400 });
    try {
      const { hechos, archivos } = await borrarCliente(cid, g.u!.id);
      olvidarFichaCliente(cid);
      return NextResponse.json({ success: true, filas: hechos.reduce((a, h) => a + (h.accion === 'borrar' ? h.filas : 0), 0), archivos });
    } catch (e) {
      return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 400 });
    }
  }

  // Activar/desactivar a una persona de una empresa-cliente, o ponerle una clave temporal nueva. Solo usuarios de empresas-cliente (nunca de ICA).
  if (b.accion === 'usuario_estado' || b.accion === 'usuario_clave') {
    const uid = Number(b.usuarioId);
    const [[uu]] = await pool.query('SELECT u.id, u.email, u.activo, u.cliente_id, c.max_usuarios FROM usuarios u JOIN clientes c ON c.id = u.cliente_id WHERE u.id = ? LIMIT 1', [uid]) as any;
    if (!uu || Number(uu.cliente_id) === CLIENTE_ICA) return NextResponse.json({ error: 'Usuario no válido' }, { status: 400 });
    if (b.accion === 'usuario_estado') {
      const activar = !!b.activo;
      if (activar && !uu.activo && uu.max_usuarios != null) {
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios WHERE cliente_id = ? AND activo = TRUE', [uu.cliente_id]) as any;
        if (Number(n) >= Number(uu.max_usuarios)) return NextResponse.json({ error: `El plan permite ${uu.max_usuarios} usuario(s). Sube el tope primero.` }, { status: 409 });
      }
      await pool.query('UPDATE usuarios SET activo = ? WHERE id = ?', [activar ? 1 : 0, uid]);
      await bitacora(Number(uu.cliente_id), g.u!.id, activar ? 'usuario_activar' : 'usuario_desactivar', { email: uu.email });
      return NextResponse.json({ success: true });
    }
    const cl = String(b.clave || '');
    if (cl.length < 8) return NextResponse.json({ error: 'La clave necesita al menos 8 caracteres' }, { status: 400 });
    await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(cl, 10), uid]);
    await bitacora(Number(uu.cliente_id), g.u!.id, 'usuario_clave', { email: uu.email }); // la clave nunca se guarda en la bitácora
    return NextResponse.json({ success: true });
  }

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

  try {
    // Una sola copia de la lógica de alta (la comparte la aprobación de solicitudes de /registro).
    const clienteId = await crearEmpresaCliente({
      nombre: b.nombre, rut: b.rut, adminEmail: b.adminEmail, adminNombre: b.adminNombre, clave: b.clave,
      plan: b.plan, modulos: b.modulos, maxUsuarios: b.maxUsuarios, venceAt: b.venceAt,
    }, g.u!.id);
    return NextResponse.json({ success: true, id: clienteId });
  } catch (e) {
    if (e instanceof ErrorAlta) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  const g = await exigirAdminLicitank(req);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id || id === CLIENTE_ICA) return NextResponse.json({ error: 'Empresa no válida' }, { status: 400 });
  const sets: string[] = [], vals: unknown[] = [], det: Record<string, unknown> = {};
  if ('plan' in b) {
    if (!planValido(b.plan)) return NextResponse.json({ error: 'Plan no válido' }, { status: 400 });
    sets.push('plan = ?'); vals.push(b.plan); det.plan = b.plan;
  }
  if (Array.isArray(b.modulos)) { // adicionales (lo que el plan no trae)
    const m = b.modulos.filter((x: string) => (MODULOS_ACTIVABLES as string[]).includes(x));
    sets.push('modulos = ?'); vals.push(JSON.stringify(m)); det.adicionales = m;
  }
  if (b.estado === 'ACTIVO' || b.estado === 'SUSPENDIDO' || b.estado === 'BAJA') { sets.push('estado = ?'); vals.push(b.estado); det.estado = b.estado; }
  if ('venceAt' in b) { sets.push('vence_at = ?'); vals.push(b.venceAt || null); det.venceAt = b.venceAt || null; }
  if (b.maxUsuarios != null) { sets.push('max_usuarios = ?'); vals.push(Math.max(1, Number(b.maxUsuarios) || 1)); det.maxUsuarios = b.maxUsuarios; }
  if (b.cupoIa != null) { sets.push('cupo_ia_mensual = ?'); vals.push(Math.max(0, Number(b.cupoIa) || 0)); det.cupoIa = b.cupoIa; }
  // Topes del medidor: vacío o null = sin tope.
  if ('topeIaUsd' in b) { const v = b.topeIaUsd === null || b.topeIaUsd === '' ? null : Math.max(0, Number(b.topeIaUsd) || 0); sets.push('tope_ia_usd_mes = ?'); vals.push(v); det.topeIaUsd = v; }
  if ('topeMp' in b) { const v = b.topeMp === null || b.topeMp === '' ? null : Math.max(0, Math.round(Number(b.topeMp) || 0)); sets.push('tope_mp_diario = ?'); vals.push(v); det.topeMp = v; }
  if (b.aprobacionesAuditor !== undefined) {
    const r = await guardarOpciones(id, { aprobaciones_auditor: b.aprobacionesAuditor });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    det.aprobacionesAuditor = r.opciones.aprobaciones_auditor;
    if (!sets.length) { olvidarFichaCliente(id); await bitacora(id, g.u!.id, 'cambio', det); return NextResponse.json({ success: true }); }
  }
  if (b.viabilidadCalce !== undefined || b.viabilidadMinimoNeto !== undefined) {
    const r = await guardarConfigEmpresa(id, { calce: b.viabilidadCalce, minimo_neto: b.viabilidadMinimoNeto });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    det.viabilidad = r.config;
    if (!sets.length) { await bitacora(id, g.u!.id, 'cambio', det); return NextResponse.json({ success: true }); }
  }
  if (typeof b.notas === 'string') { sets.push('notas = ?'); vals.push(b.notas.slice(0, 2000)); det.notas = true; }
  if (!sets.length) return NextResponse.json({ error: 'Nada que cambiar' }, { status: 400 });
  vals.push(id);
  await pool.query(`UPDATE clientes SET ${sets.join(', ')} WHERE id = ?`, vals);
  olvidarFichaCliente(id); // rige al instante
  await bitacora(id, g.u!.id, 'cambio', det);
  return NextResponse.json({ success: true });
}
