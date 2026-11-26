// app/lib/crear-empresa-cliente.ts
// Alta de una empresa-cliente: la empresa, su perfil administrador y (con RUT) su razón social y la evaluación por RUT en cola.
// Una sola copia: la usan el alta manual de /admin/clientes y la aprobación de una solicitud de /registro (solicitud-alta.ts).
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { encolarEvaluacion, rutValido, formatearRut } from '@/app/lib/evaluar-empresa-rut';
import { MODULOS_ACTIVABLES, MODULOS_DEL_PLAN, PLANES, type Plan } from '@/app/lib/modulos';

/** Error con código HTTP y mensaje seguro para mostrar. */
export class ErrorAlta extends Error {
  constructor(mensaje: string, public status: number) { super(mensaje); }
}

export interface DatosAltaEmpresa {
  nombre: string;
  rut?: string | null;
  adminEmail: string;
  adminNombre?: string | null;
  clave: string;
  plan?: unknown;
  modulos?: unknown;
  maxUsuarios?: unknown;
  venceAt?: string | null;
}

export const planValido = (v: unknown): v is Plan => (PLANES as string[]).includes(String(v));

/** Crea la empresa y su admin. `porUsuarioId` = quien la da de alta (queda en la bitácora). Devuelve el id de la empresa. */
export async function crearEmpresaCliente(d: DatosAltaEmpresa, porUsuarioId: number): Promise<number> {
  const nombre = String(d.nombre || '').trim(), rutCrudo = String(d.rut || '').trim();
  if (rutCrudo && !rutValido(rutCrudo)) throw new ErrorAlta('El RUT no es válido (revisa el dígito verificador)', 400);
  const rut = rutCrudo ? formatearRut(rutCrudo) : '';
  const email = String(d.adminEmail || '').toLowerCase().trim(), adminNombre = String(d.adminNombre || '').trim();
  const clave = String(d.clave || '');
  if (!nombre || !email || clave.length < 8) throw new ErrorAlta('Faltan nombre, correo del admin o clave (mínimo 8 caracteres)', 400);
  const plan: Plan = planValido(d.plan) ? d.plan : 'BASICO';
  // `clientes.modulos` guarda solo los ADICIONALES: lo del plan ya viene con el plan
  const modulos = (Array.isArray(d.modulos) ? d.modulos : []).filter((m: string) => (MODULOS_ACTIVABLES as string[]).includes(m) && !(MODULOS_DEL_PLAN[plan] as string[]).includes(m));
  const [dup] = await pool.query('SELECT 1 FROM usuarios WHERE email = ? LIMIT 1', [email]);
  if ((dup as unknown[]).length) throw new ErrorAlta('Ese correo ya existe', 409);

  const [r] = await pool.query(
    `INSERT INTO clientes (nombre, rut, plan, max_usuarios, estado, modulos, vence_at, contacto_nombre, contacto_email, activo)
     VALUES (?, ?, ?, ?, 'ACTIVO', ?, ?, ?, ?, 1)`,
    [nombre, rut || null, plan, Number(d.maxUsuarios) || 1, JSON.stringify(modulos), d.venceAt || null, adminNombre || null, email]);
  const clienteId = (r as { insertId: number }).insertId;
  // Perfil admin de la empresa: admin DENTRO de su empresa (proxy.ts le impide salir de ella). Permisos solo de los módulos contratados.
  const permisos = { acceso_radar: true, ver_otros_negocios: true, exportar: true, repartir_puente: true };
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo, cliente_id, permisos) VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)`,
    [email, await bcrypt.hash(clave, 10), adminNombre || nombre, nombre, clienteId, JSON.stringify(permisos)]);
  await pool.query('INSERT INTO clientes_bitacora (cliente_id, usuario_id, accion, detalle) VALUES (?, ?, ?, ?)',
    [clienteId, porUsuarioId, 'crear', JSON.stringify({ nombre, plan, adicionales: modulos, admin: email })])
    .catch(e => console.error('[clientes] bitácora:', String(e)));
  // Con RUT: su razón social queda creada (la usan postular, anexos y el cruce de OC; el código de proveedor de MP se le guarda
  // al evaluar) y la evaluación entra a la cola (minutos; sobrevive a un deploy) para sugerirle palabras clave y perfil.
  if (rut) {
    await pool.query('INSERT INTO empresas (razon_social, rut, cliente_id, activo) VALUES (?, ?, ?, TRUE)', [nombre, rut, clienteId])
      // sin migration-189 el RUT es único en TODA la plataforma: si ya lo usa otra empresa no se crea (la evaluación usa igual clientes.rut)
      .catch(e => console.warn('[clientes] razón social no creada:', String(e).slice(0, 160)));
    await encolarEvaluacion(clienteId);
  }
  return clienteId;
}
