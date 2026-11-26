// app/lib/solicitud-alta.ts
// Alta autónoma con aprobación (migration-210). El formulario público /registro deja una solicitud PENDIENTE: sin cuenta, sin gasto de Mercado
// Público ni de IA. Un admin de LICITANK la aprueba o la rechaza en /admin/solicitudes; al aprobar se usa crearEmpresaCliente (la misma lógica
// que el alta manual), con una clave temporal que se muestra UNA vez al admin para que se la entregue a la empresa.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { rutValido, formatearRut } from '@/app/lib/evaluar-empresa-rut';
import { crearEmpresaCliente, ErrorAlta, type DatosAltaEmpresa } from '@/app/lib/crear-empresa-cliente';
import { claveTemporal } from '@/app/lib/equipo-permisos';
import { validarSolicitud, decidirGuardado, limpiarTexto } from '@/app/lib/solicitud-alta-core';

export const MENSAJE_RECIBIDA = 'Recibimos tu solicitud. Un integrante de LICITANK te contactará al correo o teléfono que indicaste.';

/** Guarda una solicitud del formulario público. Devuelve SIEMPRE el mismo resultado hacia afuera (no revela si el RUT o el correo ya existen). */
export async function registrarSolicitud(raw: unknown, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = validarSolicitud(raw, { valido: rutValido, formatear: formatearRut });
  if (!v.ok) {
    if ('robot' in v) return { ok: true };           // robot: se finge éxito y no se guarda nada
    return { ok: false, error: v.error };
  }
  const d = v.datos;
  try {
    const [[ctx]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM cliente_solicitud WHERE ip = ? AND created_at > ? - INTERVAL 1 DAY) AS ip24,
         (SELECT COUNT(*) FROM cliente_solicitud WHERE estado = 'PENDIENTE') AS pend,
         (SELECT COUNT(*) FROM cliente_solicitud WHERE estado = 'PENDIENTE' AND (rut = ? OR contacto_email = ?)) AS rep,
         ((SELECT COUNT(*) FROM clientes WHERE rut = ? AND activo = 1) + (SELECT COUNT(*) FROM usuarios WHERE email = ?)) AS cli`,
      [ip, ahoraChileSQL(), d.rut, d.contactoEmail, d.rut, d.contactoEmail]) as any;
    const dec = decidirGuardado({
      solicitudesDeLaIp24h: Number(ctx.ip24), pendientesTotal: Number(ctx.pend),
      yaHayPendientePorRutOCorreo: Number(ctx.rep) > 0, yaEsCliente: Number(ctx.cli) > 0,
    });
    if (!dec.guardar) {
      console.log(`[registro] solicitud no guardada (${dec.motivo})`);
      return { ok: true };                              // misma respuesta: no se revela nada
    }
    await pool.query(
      `INSERT INTO cliente_solicitud (razon_social, rut, contacto_nombre, contacto_email, contacto_telefono, mensaje, estado, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?)`,
      [d.razonSocial, d.rut, d.contactoNombre, d.contactoEmail, d.contactoTelefono, d.mensaje, ip.slice(0, 64), ahoraChileSQL()]);
    return { ok: true };
  } catch (e) {
    console.error('[registro] no se pudo guardar la solicitud:', String(e).slice(0, 200));
    return { ok: false, error: 'No pudimos registrar tu solicitud en este momento. Intenta de nuevo en unos minutos.' };
  }
}

export interface SolicitudFila {
  id: number; razon_social: string; rut: string; contacto_nombre: string; contacto_email: string; contacto_telefono: string | null;
  mensaje: string | null; estado: string; cliente_id: number | null; motivo: string | null; created_at: string; resuelta_at: string | null;
}

export async function listarSolicitudes(limite = 100): Promise<SolicitudFila[]> {
  const [rows] = await pool.query(
    `SELECT id, razon_social, rut, contacto_nombre, contacto_email, contacto_telefono, mensaje, estado, cliente_id, motivo,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at, DATE_FORMAT(resuelta_at, '%Y-%m-%d %H:%i') AS resuelta_at
       FROM cliente_solicitud ORDER BY (estado = 'PENDIENTE') DESC, created_at DESC LIMIT ?`, [limite]);
  return rows as SolicitudFila[];
}

export async function contarPendientes(): Promise<number> {
  try {
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM cliente_solicitud WHERE estado = 'PENDIENTE'`) as any;
    return Number(r.n) || 0;
  } catch { return 0; }
}

// Datos personales mínimos (Ley 21.719): al rechazar se borran el teléfono y el mensaje.
export async function rechazarSolicitud(id: number, porUsuarioId: number, motivo: string): Promise<void> {
  const [r] = await pool.query(
    `UPDATE cliente_solicitud SET estado = 'RECHAZADA', resuelta_por = ?, resuelta_at = ?, motivo = ?,
            contacto_telefono = NULL, mensaje = NULL
      WHERE id = ? AND estado = 'PENDIENTE'`,
    [porUsuarioId, ahoraChileSQL(), limpiarTexto(motivo, 300) || null, id]);
  if (!(r as { affectedRows: number }).affectedRows) throw new ErrorAlta('La solicitud no existe o ya fue resuelta', 404);
}

export interface OpcionesAprobacion { plan?: unknown; modulos?: unknown; maxUsuarios?: unknown; venceAt?: string | null }

/** Aprueba: crea la empresa y su admin. Devuelve la clave temporal (se muestra una sola vez; solo queda su hash). */
export async function aprobarSolicitud(id: number, porUsuarioId: number, o: OpcionesAprobacion): Promise<{ clienteId: number; email: string; clave: string }> {
  // Se «toma» la solicitud primero (PENDIENTE → APROBADA) para que dos admin no la aprueben a la vez; si crear la empresa falla, se devuelve a PENDIENTE.
  const [tomada] = await pool.query(`UPDATE cliente_solicitud SET estado = 'APROBADA', resuelta_por = ?, resuelta_at = ? WHERE id = ? AND estado = 'PENDIENTE'`,
    [porUsuarioId, ahoraChileSQL(), id]);
  if (!(tomada as { affectedRows: number }).affectedRows) throw new ErrorAlta('La solicitud no existe o ya fue resuelta', 404);
  try {
    const [[s]] = await pool.query(`SELECT razon_social, rut, contacto_nombre, contacto_email FROM cliente_solicitud WHERE id = ?`, [id]) as any;
    const clave = claveTemporal();
    const datos: DatosAltaEmpresa = {
      nombre: s.razon_social, rut: s.rut, adminEmail: s.contacto_email, adminNombre: s.contacto_nombre, clave,
      plan: o.plan, modulos: o.modulos, maxUsuarios: o.maxUsuarios, venceAt: o.venceAt,
    };
    const clienteId = await crearEmpresaCliente(datos, porUsuarioId);
    await pool.query(`UPDATE cliente_solicitud SET cliente_id = ? WHERE id = ?`, [clienteId, id]);
    return { clienteId, email: s.contacto_email, clave };
  } catch (e) {
    await pool.query(`UPDATE cliente_solicitud SET estado = 'PENDIENTE', resuelta_por = NULL, resuelta_at = NULL WHERE id = ?`, [id]).catch(() => {});
    throw e;
  }
}
