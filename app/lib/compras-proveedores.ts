// app/lib/compras-proveedores.ts
// CATÁLOGO DE PROVEEDORES — ficha completa, transversal a todos los negocios (mismo criterio
// arquitectónico que `compras-logistica.ts`: OBUMA aporta identidad e histórico económico cuando ya
// le compramos algo; la caracterización operativa — contacto, categoría, datos bancarios — no
// existe ahí y debe vivir en tabla propia de Licitank, spec §13.3 aplicado por analogía).
//
// Sin esto, un proveedor era solo texto libre (nombre + RUT) tipeado de nuevo en cada cotización,
// sin ficha ni datos para pagarle cuando llega la orden de compra.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { normRut } from '@/app/lib/adjudicacion';

export interface Proveedor {
  id: number; rut: string | null; nombreEmpresa: string; nombreFantasia: string | null;
  categoria: string | null; giro: string | null; contactoNombre: string | null; correo: string | null; telefono: string | null;
  direccion: string | null; comuna: string | null; region: string | null;
  banco: string | null; tipoCuenta: string | null; numeroCuenta: string | null; titularCuenta: string | null;
  rutTitular: string | null; correoPagos: string | null; obumaProveedorId: string | null;
  notas: string | null; activo: boolean; creadoPorNombre: string | null; createdAt: string;
}

function filaAProveedor(r: any): Proveedor {
  return {
    id: r.id, rut: r.rut, nombreEmpresa: r.nombre_empresa, nombreFantasia: r.nombre_fantasia,
    categoria: r.categoria, giro: r.giro, contactoNombre: r.contacto_nombre, correo: r.correo, telefono: r.telefono,
    direccion: r.direccion, comuna: r.comuna, region: r.region,
    banco: r.banco, tipoCuenta: r.tipo_cuenta, numeroCuenta: r.numero_cuenta, titularCuenta: r.titular_cuenta,
    rutTitular: r.rut_titular, correoPagos: r.correo_pagos, obumaProveedorId: r.obuma_proveedor_id,
    notas: r.notas, activo: !!r.activo, creadoPorNombre: r.creado_por_nombre,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

export interface DatosProveedor {
  rut?: string | null; nombreEmpresa: string; nombreFantasia?: string | null; categoria?: string | null; giro?: string | null;
  contactoNombre?: string | null; correo?: string | null; telefono?: string | null;
  direccion?: string | null; comuna?: string | null; region?: string | null;
  banco?: string | null; tipoCuenta?: string | null; numeroCuenta?: string | null; titularCuenta?: string | null;
  rutTitular?: string | null; correoPagos?: string | null; obumaProveedorId?: string | null; notas?: string | null;
}

export async function listarProveedores(filtro?: { q?: string; categoria?: string; soloActivos?: boolean }): Promise<Proveedor[]> {
  const cond: string[] = []; const params: any[] = [];
  if (filtro?.soloActivos) cond.push('activo = 1');
  if (filtro?.categoria) { cond.push('categoria = ?'); params.push(filtro.categoria); }
  if (filtro?.q?.trim()) {
    cond.push('(nombre_empresa LIKE ? OR nombre_fantasia LIKE ? OR rut LIKE ?)');
    const like = `%${filtro.q.trim()}%`; params.push(like, like, like);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT * FROM compras_proveedor ${where} ORDER BY nombre_empresa`, params) as any;
  return (rows as any[]).map(filaAProveedor);
}

export async function obtenerProveedor(id: number): Promise<Proveedor | null> {
  const [rows] = await pool.query(`SELECT * FROM compras_proveedor WHERE id = ? LIMIT 1`, [id]) as any;
  const r = (rows as any[])[0];
  return r ? filaAProveedor(r) : null;
}

export async function crearProveedor(datos: DatosProveedor, actorId: number, actorNombre: string | null): Promise<number> {
  if (!datos.nombreEmpresa?.trim()) throw new Error('Falta el nombre de la empresa.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_proveedor
       (rut, nombre_empresa, nombre_fantasia, categoria, giro, contacto_nombre, correo, telefono, direccion, comuna, region,
        banco, tipo_cuenta, numero_cuenta, titular_cuenta, rut_titular, correo_pagos, obuma_proveedor_id, notas,
        creado_por, creado_por_nombre, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      datos.rut?.trim() || null, datos.nombreEmpresa.trim().slice(0, 300), datos.nombreFantasia?.trim() || null,
      datos.categoria?.trim() || null, datos.giro?.trim() || null, datos.contactoNombre?.trim() || null,
      datos.correo?.trim() || null, datos.telefono?.trim() || null, datos.direccion?.trim() || null,
      datos.comuna?.trim() || null, datos.region?.trim() || null,
      datos.banco?.trim() || null, datos.tipoCuenta?.trim() || null, datos.numeroCuenta?.trim() || null,
      datos.titularCuenta?.trim() || null, datos.rutTitular?.trim() || null, datos.correoPagos?.trim() || null,
      datos.obumaProveedorId?.trim() || null, datos.notas?.trim() || null,
      actorId, actorNombre, ahora, ahora,
    ],
  ) as any;
  const id = r.insertId as number;
  await registrarEvento({
    tipo: 'COMPRAS_PROVEEDOR_CREADO', actorId, actorNombre,
    mensaje: `Se agregó el proveedor "${datos.nombreEmpresa.trim()}" al catálogo.`,
    metadata: { proveedor_id: id },
  });
  return id;
}

const CAMPOS_ACTUALIZABLES: Record<string, string> = {
  rut: 'rut', nombreEmpresa: 'nombre_empresa', nombreFantasia: 'nombre_fantasia', categoria: 'categoria', giro: 'giro',
  contactoNombre: 'contacto_nombre', correo: 'correo', telefono: 'telefono', direccion: 'direccion', comuna: 'comuna', region: 'region',
  banco: 'banco', tipoCuenta: 'tipo_cuenta', numeroCuenta: 'numero_cuenta', titularCuenta: 'titular_cuenta',
  rutTitular: 'rut_titular', correoPagos: 'correo_pagos', obumaProveedorId: 'obuma_proveedor_id', notas: 'notas',
};

export async function actualizarProveedor(id: number, datos: Partial<DatosProveedor> & { activo?: boolean }): Promise<void> {
  const campos: string[] = []; const valores: any[] = [];
  for (const [k, col] of Object.entries(CAMPOS_ACTUALIZABLES)) {
    if ((datos as any)[k] !== undefined) { campos.push(`${col} = ?`); valores.push((datos as any)[k] || null); }
  }
  if (datos.activo !== undefined) { campos.push('activo = ?'); valores.push(datos.activo ? 1 : 0); }
  if (campos.length === 0) return;
  campos.push('updated_at = ?'); valores.push(ahoraChileSQL());
  const [r] = await pool.query(`UPDATE compras_proveedor SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]) as any;
  if (!r?.affectedRows) throw new Error('Proveedor no encontrado.');
}

/** Encuentra el proveedor por RUT (o por nombre exacto si no hay RUT) o lo crea, mínimo con nombre
 *  y RUT. Se usa cuando alguien tipea un proveedor "nuevo" al registrar una cotización — sin esto,
 *  ese proveedor quedaba pegado a UNA cotización y nunca entraba al catálogo (correo, teléfono,
 *  categoría, cuenta bancaria se perdían para siempre, había que retipear todo la próxima vez). */
export async function obtenerOCrearProveedor(nombreEmpresa: string, rut: string | null, actorId: number, actorNombre: string | null): Promise<number> {
  const nombreLimpio = nombreEmpresa.trim();
  if (rut?.trim()) {
    // BUG REAL (10-sep-2026, auditoría estática): comparar el RUT tal cual llegó ("76.123.456-7"
    // vs "76123456-7", la misma empresa tipeada distinto en dos cotizaciones) hacía que el lookup
    // nunca calzara y creara un proveedor DUPLICADO — justo lo que este comentario de arriba dice
    // que se quería evitar. Se compara normalizado (mismo `normRut` que ya usa el resto del
    // proyecto) sin tocar el `rut` guardado — ese se deja tal como lo tipeó la persona.
    const rutNorm = normRut(rut);
    const [rows] = await pool.query(
      `SELECT id FROM compras_proveedor WHERE UPPER(REPLACE(REPLACE(rut, '.', ''), '-', '')) = ? LIMIT 1`,
      [rutNorm],
    ) as any;
    if ((rows as any[])[0]) return (rows as any[])[0].id;
  } else {
    const [rows] = await pool.query(`SELECT id FROM compras_proveedor WHERE nombre_empresa = ? LIMIT 1`, [nombreLimpio]) as any;
    if ((rows as any[])[0]) return (rows as any[])[0].id;
  }
  return crearProveedor({ nombreEmpresa: nombreLimpio, rut }, actorId, actorNombre);
}
