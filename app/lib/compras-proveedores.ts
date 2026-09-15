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
import {
  proveedoresObumaCompleto, proveedorPorRut, proveedorPorId, mapaFormasPagoCompleto, listarComprasOcItems,
  comprasOcCompleto, type ObumaProveedor,
} from '@/app/lib/obuma';

// BUG REAL (14-sep-2026, reproducido dos veces: primero rompió el listado completo de proveedores,
// después `historialComprasObuma`): una fecha DATETIME mal formada que llegó a la base (Obuma trae
// `compra_oc_fecha_ingreso` vacío/roto en algunas OC) vuelve como un objeto Date INVÁLIDO desde
// mysql2 — `.toISOString()` sobre eso explota (RangeError), reventando el endpoint entero, no solo
// esa fila. Un solo helper para todas las fechas que salen de `compras_historial_oc`/
// `compras_proveedor`, para no repetir el mismo guard (y el mismo bug) en cada función nueva.
function fechaSqlAIso(v: unknown): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  return typeof v === 'string' && v.trim() ? v : null;
}

export interface Proveedor {
  id: number; rut: string | null; nombreEmpresa: string; nombreFantasia: string | null;
  categoria: string | null; giro: string | null; contactoNombre: string | null; correo: string | null; telefono: string | null;
  direccion: string | null; comuna: string | null; region: string | null;
  banco: string | null; tipoCuenta: string | null; numeroCuenta: string | null; titularCuenta: string | null;
  rutTitular: string | null; correoPagos: string | null; obumaProveedorId: string | null;
  // Solo lectura desde Obuma — nunca editables a mano, se pisan en cada sincronización (ver
  // identidadDesdeObuma). Separadas de banco/tipoCuenta/numeroCuenta de arriba, que SÍ son de
  // Licitank y un usuario puede corregir sin que una sincronización se las borre.
  obumaTieneCuentaBancaria: boolean | null; obumaNumeroCuenta: string | null;
  obumaTipoCuenta: string | null; obumaFormaPago: string | null;
  // Resumen de compras (para listar/filtrar/contar rápido — ver comprasOcCompleto en obuma.ts). El
  // detalle folio a folio sigue yendo en vivo, esto es solo el agregado.
  obumaComprasCantidad: number; obumaComprasMontoTotal: number; obumaUltimaCompraFecha: string | null;
  notas: string | null; activo: boolean; creadoPorNombre: string | null; createdAt: string;
}

function filaAProveedor(r: any): Proveedor {
  return {
    id: r.id, rut: r.rut, nombreEmpresa: r.nombre_empresa, nombreFantasia: r.nombre_fantasia,
    categoria: r.categoria, giro: r.giro, contactoNombre: r.contacto_nombre, correo: r.correo, telefono: r.telefono,
    direccion: r.direccion, comuna: r.comuna, region: r.region,
    banco: r.banco, tipoCuenta: r.tipo_cuenta, numeroCuenta: r.numero_cuenta, titularCuenta: r.titular_cuenta,
    rutTitular: r.rut_titular, correoPagos: r.correo_pagos, obumaProveedorId: r.obuma_proveedor_id,
    obumaTieneCuentaBancaria: r.obuma_tiene_cuenta_bancaria == null ? null : !!r.obuma_tiene_cuenta_bancaria,
    obumaNumeroCuenta: r.obuma_numero_cuenta, obumaTipoCuenta: r.obuma_tipo_cuenta, obumaFormaPago: r.obuma_forma_pago,
    obumaComprasCantidad: r.obuma_compras_cantidad ?? 0, obumaComprasMontoTotal: Number(r.obuma_compras_monto_total) || 0,
    obumaUltimaCompraFecha: fechaSqlAIso(r.obuma_ultima_compra_fecha),
    notas: r.notas, activo: !!r.activo, creadoPorNombre: r.creado_por_nombre,
    createdAt: fechaSqlAIso(r.created_at) || r.created_at,
  };
}

export interface DatosProveedor {
  rut?: string | null; nombreEmpresa: string; nombreFantasia?: string | null; categoria?: string | null; giro?: string | null;
  contactoNombre?: string | null; correo?: string | null; telefono?: string | null;
  direccion?: string | null; comuna?: string | null; region?: string | null;
  banco?: string | null; tipoCuenta?: string | null; numeroCuenta?: string | null; titularCuenta?: string | null;
  rutTitular?: string | null; correoPagos?: string | null; obumaProveedorId?: string | null; notas?: string | null;
  obumaTieneCuentaBancaria?: boolean | null; obumaNumeroCuenta?: string | null;
  obumaTipoCuenta?: string | null; obumaFormaPago?: string | null;
  obumaComprasCantidad?: number; obumaComprasMontoTotal?: number; obumaUltimaCompraFecha?: string | null;
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
        banco, tipo_cuenta, numero_cuenta, titular_cuenta, rut_titular, correo_pagos, obuma_proveedor_id,
        obuma_tiene_cuenta_bancaria, obuma_numero_cuenta, obuma_tipo_cuenta, obuma_forma_pago,
        obuma_compras_cantidad, obuma_compras_monto_total, obuma_ultima_compra_fecha, notas,
        creado_por, creado_por_nombre, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      datos.rut?.trim() || null, datos.nombreEmpresa.trim().slice(0, 300), datos.nombreFantasia?.trim() || null,
      datos.categoria?.trim() || null, datos.giro?.trim() || null, datos.contactoNombre?.trim() || null,
      datos.correo?.trim() || null, datos.telefono?.trim() || null, datos.direccion?.trim() || null,
      datos.comuna?.trim() || null, datos.region?.trim() || null,
      datos.banco?.trim() || null, datos.tipoCuenta?.trim() || null, datos.numeroCuenta?.trim() || null,
      datos.titularCuenta?.trim() || null, datos.rutTitular?.trim() || null, datos.correoPagos?.trim() || null,
      datos.obumaProveedorId?.trim() || null,
      datos.obumaTieneCuentaBancaria == null ? null : (datos.obumaTieneCuentaBancaria ? 1 : 0),
      datos.obumaNumeroCuenta?.trim() || null, datos.obumaTipoCuenta?.trim() || null, datos.obumaFormaPago?.trim() || null,
      datos.obumaComprasCantidad ?? null, datos.obumaComprasMontoTotal ?? null, datos.obumaUltimaCompraFecha || null,
      datos.notas?.trim() || null,
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
  obumaNumeroCuenta: 'obuma_numero_cuenta', obumaTipoCuenta: 'obuma_tipo_cuenta', obumaFormaPago: 'obuma_forma_pago',
};

export async function actualizarProveedor(id: number, datos: Partial<DatosProveedor> & { activo?: boolean }): Promise<void> {
  const campos: string[] = []; const valores: any[] = [];
  for (const [k, col] of Object.entries(CAMPOS_ACTUALIZABLES)) {
    if ((datos as any)[k] !== undefined) { campos.push(`${col} = ?`); valores.push((datos as any)[k] || null); }
  }
  if (datos.activo !== undefined) { campos.push('activo = ?'); valores.push(datos.activo ? 1 : 0); }
  // Booleano aparte del loop genérico de arriba: `false || null` evaluaría a null y perdería el
  // "no tiene cuenta" (un false real) — mismo cuidado que `activo`.
  if (datos.obumaTieneCuentaBancaria !== undefined) {
    campos.push('obuma_tiene_cuenta_bancaria = ?');
    valores.push(datos.obumaTieneCuentaBancaria == null ? null : (datos.obumaTieneCuentaBancaria ? 1 : 0));
  }
  // Mismo cuidado que el booleano de arriba: `obumaComprasCantidad: 0` (nunca le hemos comprado) es
  // un valor real y válido — `0 || null` lo convertiría en null y se perdería la distinción entre
  // "sabemos que son 0" y "no se consultó".
  if (datos.obumaComprasCantidad !== undefined) { campos.push('obuma_compras_cantidad = ?'); valores.push(datos.obumaComprasCantidad); }
  if (datos.obumaComprasMontoTotal !== undefined) { campos.push('obuma_compras_monto_total = ?'); valores.push(datos.obumaComprasMontoTotal); }
  if (datos.obumaUltimaCompraFecha !== undefined) { campos.push('obuma_ultima_compra_fecha = ?'); valores.push(datos.obumaUltimaCompraFecha); }
  if (campos.length === 0) return;
  campos.push('updated_at = ?'); valores.push(ahoraChileSQL());
  const [r] = await pool.query(`UPDATE compras_proveedor SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]) as any;
  if (!r?.affectedRows) throw new Error('Proveedor no encontrado.');
}

// BUG REAL (11-sep-2026, reportado por el usuario con captura del dropdown de cotizaciones): sin
// RUT, el lookup comparaba `nombre_empresa` EXACTO — "TechSat Solutions S.A", "TechSat Solutions
// S.A" (un espacio de más) y "TechSat Solutions S.A." (con punto) nunca calzaban entre sí y cada
// cotización creaba un proveedor NUEVO. El catálogo terminó con 3 filas para la misma empresa.
// Se normaliza (espacios colapsados, sin puntos finales, sin distinguir mayúsculas) antes de
// comparar — el `nombre_empresa` guardado NO se toca, solo se usa para encontrar el ya existente.
function normNombreProveedor(s: string): string {
  return s.trim().replace(/\.+$/, '').replace(/\s+/g, ' ').toUpperCase();
}

// Varios campos "vacíos" en Obuma vienen como el string "0" en vez de "" (visto en vivo en
// proveedor_comuna/proveedor_region) — sin filtrarlo, la ficha mostraba literalmente "0" como
// comuna. Compartido entre el alta individual y la sincronización masiva.
function limpiarCampoObuma(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t && t !== '0' ? t : null;
}

// Obuma NO expone el nombre del banco en ningún campo de proveedores.list.json (verificado en vivo,
// 14-sep-2026, contra "COMERCIAL KMX LTDA" que sí tiene cuenta cargada) — solo si tiene una cuenta
// cargada, su número, su tipo ("Cuenta Corriente"/"Cuenta Vista"/...) y el ID de forma de pago
// (resuelto a nombre contra `mapaFormasPagoCompleto`). No se inventa un campo "banco" que la API no
// entrega.
interface ResumenComprasObuma { cantidad: number; montoTotal: number; ultimaFecha: string | null }

function identidadDesdeObuma(
  remoto: ObumaProveedor, formasPago: Map<string, string>,
  comprasPorProveedor: Map<string, ResumenComprasObuma> = new Map(),
): DatosProveedor {
  const rutLimpio = limpiarCampoObuma(remoto.proveedor_rut);
  const formaPagoId = limpiarCampoObuma(remoto.proveedor_forma_pago);
  const obumaId = String(remoto.proveedor_id);
  const resumenCompras = comprasPorProveedor.get(obumaId);
  return {
    rut: rutLimpio && rutLimpio.toUpperCase() !== 'SINRUT' ? rutLimpio : null,
    nombreEmpresa: remoto.proveedor_razon_social.trim(),
    nombreFantasia: limpiarCampoObuma(remoto.proveedor_nombre_fantasia),
    giro: limpiarCampoObuma(remoto.proveedor_giro_comercial),
    contactoNombre: limpiarCampoObuma(remoto.proveedor_contacto),
    direccion: limpiarCampoObuma(remoto.proveedor_direccion),
    comuna: limpiarCampoObuma(remoto.proveedor_comuna),
    obumaProveedorId: obumaId,
    obumaTieneCuentaBancaria: String(remoto.proveedor_banco_cuenta) === '1',
    obumaNumeroCuenta: limpiarCampoObuma(remoto.proveedor_nro_cuenta),
    obumaTipoCuenta: limpiarCampoObuma(remoto.proveedor_tipo_cuenta),
    obumaFormaPago: formaPagoId ? (formasPago.get(formaPagoId) || null) : null,
    obumaComprasCantidad: resumenCompras?.cantidad ?? 0,
    obumaComprasMontoTotal: resumenCompras?.montoTotal ?? 0,
    obumaUltimaCompraFecha: resumenCompras?.ultimaFecha ?? null,
  };
}

export interface ValidacionProveedorObuma {
  estado: 'en_catalogo' | 'en_obuma_no_catalogo' | 'no_existe_en_obuma';
  nombreEmpresa: string | null;
  obumaProveedorId: string | null;
  proveedorLocalId: number | null;
}

/** Pedido explícito del usuario (14-sep-2026, tras registrar una cotización con un proveedor
 *  nuevo): "no me dijo si este proveedor estaba en Obuma o no... todo lo que ingresemos debe estar
 *  validado". Chequea el RUT contra el catálogo local primero (instantáneo) y, si no está, contra
 *  Obuma en vivo (una sola llamada, mismo criterio que `obtenerOCrearProveedor`) — para que la
 *  pantalla pueda avisar CLARO uno de tres estados antes de guardar, no recién después:
 *   - 'en_catalogo': ya está en nuestro catálogo Y enlazado a Obuma.
 *   - 'en_obuma_no_catalogo': existe en Obuma pero todavía no está sincronizado localmente — se
 *     enlazará solo al guardar la cotización.
 *   - 'no_existe_en_obuma': Obuma no tiene este RUT — se creará una ficha SOLO en Licitank (Obuma
 *     nunca se crea automático, ver crearProveedorObuma en obuma.ts). */
export async function validarProveedorObuma(rut: string): Promise<ValidacionProveedorObuma> {
  const rutNorm = normRut(rut);
  const [filas] = await pool.query(
    `SELECT id, nombre_empresa, obuma_proveedor_id FROM compras_proveedor
     WHERE UPPER(REPLACE(REPLACE(rut, '.', ''), '-', '')) = ? LIMIT 1`,
    [rutNorm],
  ) as any;
  const local = (filas as any[])[0];
  if (local?.obuma_proveedor_id) {
    return { estado: 'en_catalogo', nombreEmpresa: local.nombre_empresa, obumaProveedorId: String(local.obuma_proveedor_id), proveedorLocalId: local.id };
  }

  const remoto = await proveedorPorRut(rut.trim()).catch(() => null);
  if (remoto?.proveedor_razon_social?.trim()) {
    return {
      estado: 'en_obuma_no_catalogo', nombreEmpresa: remoto.proveedor_razon_social.trim(),
      obumaProveedorId: String(remoto.proveedor_id), proveedorLocalId: local?.id ?? null,
    };
  }

  return { estado: 'no_existe_en_obuma', nombreEmpresa: local?.nombre_empresa ?? null, obumaProveedorId: null, proveedorLocalId: local?.id ?? null };
}

/** Encuentra el proveedor por RUT (o por nombre normalizado si no hay RUT) o lo crea. Se usa cuando
 *  alguien tipea un proveedor "nuevo" al registrar una cotización — sin esto, ese proveedor quedaba
 *  pegado a UNA cotización y nunca entraba al catálogo (correo, teléfono, categoría, cuenta
 *  bancaria se perdían para siempre, había que retipear todo la próxima vez).
 *
 *  Pedido explícito del usuario (14-sep-2026): que un proveedor nuevo aparezca con sus datos REALES
 *  sin tener que apretar "Sincronizar con Obuma" a mano cada vez. Antes de crear una ficha vacía
 *  (solo nombre+RUT), se consulta Obuma por ese RUT puntual — una sola llamada rápida, no el
 *  catálogo completo — y si existe ahí, la ficha se crea ya con giro/contacto/dirección/comuna
 *  reales y enlazada a `obuma_proveedor_id`. Si Obuma no lo tiene o la consulta falla (offline,
 *  cuota agotada), sigue el camino de siempre: ficha mínima con lo tipeado a mano. */
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

    try {
      const [remoto, formasPago] = await Promise.all([proveedorPorRut(rut.trim()), mapaFormasPagoCompleto()]);
      if (remoto?.proveedor_razon_social?.trim()) {
        return crearProveedor(identidadDesdeObuma(remoto, formasPago), actorId, actorNombre);
      }
    } catch { /* Obuma no disponible ahora — sigue con la ficha mínima de abajo */ }
  } else {
    const nombreNorm = normNombreProveedor(nombreLimpio);
    // El catálogo es transversal (no por negocio) y chico — traer nombre+id para comparar
    // normalizado en JS es más simple y seguro que intentar reproducir la misma normalización en
    // SQL (colapsar espacios y quitar puntos finales en MySQL sin REGEXP_REPLACE es frágil).
    const [rows] = await pool.query(`SELECT id, nombre_empresa FROM compras_proveedor`) as any;
    const match = (rows as any[]).find(r => normNombreProveedor(r.nombre_empresa) === nombreNorm);
    if (match) return match.id;
  }
  return crearProveedor({ nombreEmpresa: nombreLimpio, rut }, actorId, actorNombre);
}

/** Trae el catálogo COMPLETO de Obuma y lo refleja en `compras_proveedor` (pedido explícito del
 *  usuario, 14-sep-2026: el catálogo de /compras/proveedores debe mostrar los proveedores REALES
 *  que existen en Obuma, no proveedores de prueba tipeados a mano). Es una acción CONSCIENTE
 *  (botón "Sincronizar con Obuma"), nunca automática — mismo criterio que `crearProveedorObuma`
 *  en obuma.ts.
 *
 *  Empareja por `obuma_proveedor_id` primero (ya sincronizado antes) y si no, por RUT normalizado
 *  (mismo criterio que `obtenerOCrearProveedor`) — así un proveedor que YA se había cotizado a mano
 *  se enlaza con su ficha real de Obuma en vez de duplicarse. Solo pisa los campos de IDENTIDAD que
 *  Obuma sí tiene (razón social, nombre de fantasía, giro, contacto, dirección, comuna) — nunca
 *  correo/teléfono/categoría, que son SOLO de Licitank y Obuma no los tiene.
 *
 *  Cuenta bancaria (pedido explícito, 14-sep-2026): Obuma SÍ expone si el proveedor tiene una cuenta
 *  cargada, su número, tipo y forma de pago — se guardan en columnas `obuma_*` de solo lectura
 *  (nunca en `banco`/`tipoCuenta`/`numeroCuenta`, que son 100% editables a mano en Licitank). Obuma
 *  NO expone el nombre del banco en ningún campo — no se inventa.
 *
 *  Filtra a `proveedor_activo === '1'` (verificado en vivo, 14-sep-2026: de 2769 proveedores del
 *  ERP, solo 394 están activos — el resto son fichas dadas de baja hace años, casi la mitad sin
 *  siquiera razón social cargada. Traer las 2769 habría inundado el catálogo de Licitank con
 *  proveedores muertos en vez de reflejar "los que tenemos" como pidió el usuario).
 *
 *  RENDIMIENTO (bug real, 14-sep-2026: el usuario reportó el botón "cargando" sin responder) — la
 *  primera versión hacía 2-3 SELECT por proveedor ANTES de cada escritura (~800-1200 round-trips
 *  secuenciales contra Bluehost, varios minutos). Ahora se precarga el catálogo local completo UNA
 *  vez (1 SELECT), el cruce con Obuma se hace en memoria, y las escrituras van en lotes paralelos
 *  (`connectionLimit` del pool ya limita cuántas conexiones simultáneas soporta Bluehost). */
const LOTE_ESCRITURA_SYNC = 6; // deja margen bajo el límite del pool para otras consultas concurrentes

export async function sincronizarProveedoresObuma(
  actorId: number, actorNombre: string | null,
): Promise<{ creados: number; actualizados: number; total: number }> {
  const [remotos, formasPago, todasLasOc, filasLocales] = await Promise.all([
    proveedoresObumaCompleto(),
    mapaFormasPagoCompleto(),
    comprasOcCompleto(),
    pool.query(`SELECT id, obuma_proveedor_id, rut FROM compras_proveedor`) as Promise<[any[], any]>,
  ]);
  const [filas] = filasLocales;

  // Resumen de compras por proveedor (cantidad, monto total, última fecha) — pedido explícito del
  // usuario, 14-sep-2026: estadísticas/filtros de "le hemos comprado" sin pegarle a Obuma por cada
  // proveedor. Se arma UNA vez acá recorriendo las ~4.000 OC ya traídas, no una llamada extra por
  // proveedor.
  const comprasPorProveedor = new Map<string, ResumenComprasObuma>();
  for (const oc of todasLasOc) {
    const obumaId = String(oc.rel_proveedor_id);
    const total = Number(oc.compra_oc_total) || 0;
    // BUG REAL (14-sep-2026): algunas OC traen `compra_oc_fecha_ingreso` vacío o mal formado — sin
    // este chequeo, esa fecha basura llegaba hasta la columna DATETIME y MySQL la guardaba como
    // "0000-00-00", que después revienta al leerla (ver el guard en filaAProveedor). Se valida con
    // un patrón simple ANTES de que entre a la base — no se inventa una fecha, se descarta.
    const fechaCruda = String(oc.compra_oc_fecha_ingreso || '');
    const fecha = /^\d{4}-\d{2}-\d{2}/.test(fechaCruda) ? fechaCruda : '';
    const actual = comprasPorProveedor.get(obumaId);
    if (actual) {
      actual.cantidad += 1;
      actual.montoTotal += total;
      if (fecha && (!actual.ultimaFecha || fecha > actual.ultimaFecha)) actual.ultimaFecha = fecha;
    } else {
      comprasPorProveedor.set(obumaId, { cantidad: 1, montoTotal: total, ultimaFecha: fecha || null });
    }
  }

  const localPorObumaId = new Map<string, number>();
  const localPorRut = new Map<string, number>();
  for (const f of filas) {
    if (f.obuma_proveedor_id) localPorObumaId.set(String(f.obuma_proveedor_id), f.id);
    if (f.rut) localPorRut.set(normRut(f.rut), f.id);
  }

  // Obuma a veces repite el mismo proveedor_id (o el mismo RUT bajo dos ids) en el listado — sin
  // deduplicar acá, dos escrituras del mismo lote podrían correr en paralelo e insertar dos filas
  // para la misma empresa (la precarga de arriba no las ve todavía porque ninguna se guardó aún).
  const vistoObumaId = new Set<string>();
  const vistoRutNorm = new Set<string>();
  const unicos: ObumaProveedor[] = [];
  for (const p of remotos) {
    if (p.proveedor_activo !== '1' || !p.proveedor_razon_social?.trim()) continue;
    const obumaId = String(p.proveedor_id);
    if (vistoObumaId.has(obumaId)) continue;
    const identidad = identidadDesdeObuma(p, formasPago, comprasPorProveedor);
    const rutNorm = identidad.rut ? normRut(identidad.rut) : null;
    if (rutNorm && vistoRutNorm.has(rutNorm)) continue;
    vistoObumaId.add(obumaId);
    if (rutNorm) vistoRutNorm.add(rutNorm);
    unicos.push(p);
  }

  let creados = 0, actualizados = 0;
  for (let i = 0; i < unicos.length; i += LOTE_ESCRITURA_SYNC) {
    const lote = unicos.slice(i, i + LOTE_ESCRITURA_SYNC);
    const resultados = await Promise.all(lote.map(async p => {
      const identidad = identidadDesdeObuma(p, formasPago, comprasPorProveedor);
      const obumaId = String(p.proveedor_id);
      const existenteId = localPorObumaId.get(obumaId) ?? (identidad.rut ? localPorRut.get(normRut(identidad.rut)) : undefined);
      if (existenteId) {
        await actualizarProveedor(existenteId, identidad);
        return 'actualizado' as const;
      }
      await crearProveedor(identidad, actorId, actorNombre);
      return 'creado' as const;
    }));
    for (const r of resultados) r === 'creado' ? creados++ : actualizados++;
  }

  const totalActivos = creados + actualizados;
  await registrarEvento({
    tipo: 'COMPRAS_PROVEEDORES_SINCRONIZADOS', actorId, actorNombre,
    mensaje: `Se sincronizó el catálogo de proveedores con Obuma: ${creados} nuevo(s), ${actualizados} actualizado(s) — ${totalActivos} proveedor(es) activo(s) de ${remotos.length} en el ERP.`,
    metadata: { creados, actualizados, totalActivos, totalErp: remotos.length },
  });

  return { creados, actualizados, total: totalActivos };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HISTORIAL DE COMPRAS — GUARDADO LOCAL (pedido explícito del usuario, 14-sep-2026: "necesito que
// esté todo en nuestra base de datos así es más rápido y los avisos que me dé son más eficientes").
// Antes CADA consulta (expandir un proveedor, buscar un producto) pegaba en vivo contra Obuma —
// lento y no permitía cruzar contra los ítems que se están cotizando sin antes buscarlos uno por
// uno contra la API. Ahora las OC y sus ítems viven en `compras_historial_oc` /
// `compras_historial_oc_item`, y las lecturas de abajo son consultas SQL locales, no HTTP.
//
// Las cabeceras de OC son baratas de traer completas (comprasOcCompleto ya pagina ~4 llamadas para
// las ~4.000 de la empresa) — se sincronizan de una sola vez con un INSERT masivo
// (`ON DUPLICATE KEY UPDATE`). Los ÍTEMS son caros (una llamada POR CADA OC, no hay endpoint que
// los traiga todos juntos) — se sincronizan INCREMENTAL, por lotes, marcando qué OC ya se procesó
// (`items_sincronizados_at`) para poder reanudar sin repetir trabajo ni golpear la cuota diaria de
// Obuma de una sola vez.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Trae TODAS las cabeceras de OC de Obuma y las refleja en `compras_historial_oc` — rápido (un
 *  puñado de INSERT masivos con ON DUPLICATE KEY UPDATE, no una escritura por fila). Se corre junto
 *  con `sincronizarProveedoresObuma` (mismo botón "Sincronizar con Obuma"). */
export async function sincronizarHistorialOcHeaders(): Promise<{ procesadas: number }> {
  const todas = await comprasOcCompleto();
  const ahora = ahoraChileSQL();
  const filas = todas.map(oc => {
    const fechaCruda = String(oc.compra_oc_fecha_ingreso || '');
    const fecha = /^\d{4}-\d{2}-\d{2}/.test(fechaCruda) ? fechaCruda : null;
    return [
      String(oc.compra_oc_id), String(oc.rel_proveedor_id),
      oc.compra_oc_folio ? String(oc.compra_oc_folio) : null,
      fecha, Number(oc.compra_oc_total) || 0, String(oc.compra_oc_estado || ''),
      ahora, ahora,
    ];
  });
  const LOTE = 500;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    if (lote.length === 0) continue;
    await pool.query(
      `INSERT INTO compras_historial_oc
         (obuma_compra_oc_id, obuma_proveedor_id, folio, fecha, total, estado, created_at, updated_at)
       VALUES ?
       ON DUPLICATE KEY UPDATE obuma_proveedor_id=VALUES(obuma_proveedor_id), folio=VALUES(folio),
         fecha=VALUES(fecha), total=VALUES(total), estado=VALUES(estado), updated_at=VALUES(updated_at)`,
      [lote],
    );
  }
  return { procesadas: filas.length };
}

/** Trae los ÍTEMS de un LOTE de OC todavía pendientes (`items_sincronizados_at IS NULL`), las más
 *  recientes primero — se puede volver a invocar hasta vaciar el pendiente (la UI la repite sola,
 *  ver /api/compras/proveedores/sincronizar-historial-items). Una OC que falla puntualmente (folio
 *  raro, timeout) queda pendiente para el próximo lote, no bloquea el resto.
 *
 *  BUG REAL (14-sep-2026, visto en vivo): Obuma tiene cuota DIARIA por método
 *  ("comprasOc.listItems") — al agotarse, CADA llamada del lote falla con el mismo error ("Error
 *  005... Bloqueo por exceder limite de consultas diario"). Sin detectarlo, la UI reintentaba el
 *  mismo lote de 150 una y otra vez sin avanzar nunca (`pendientesRestantes` pegado). Ahora se
 *  reconoce ese error puntual y se corta el lote ahí mismo — nada queda marcado a medias, se
 *  reintenta solo. */
const MARCADOR_CUOTA_OBUMA = 'exceder limite de consultas diario';

export async function sincronizarItemsHistorialOc(
  loteMax = 100,
): Promise<{ procesadas: number; itemsGuardados: number; pendientesRestantes: number; cuotaAgotada: boolean }> {
  const [pendientesRows] = await pool.query(
    `SELECT id, folio FROM compras_historial_oc WHERE items_sincronizados_at IS NULL ORDER BY fecha DESC LIMIT ?`,
    [loteMax],
  ) as any;
  const pendientes = pendientesRows as Array<{ id: number; folio: string | null }>;
  const ahora = ahoraChileSQL();

  if (pendientes.length === 0) {
    return { procesadas: 0, itemsGuardados: 0, pendientesRestantes: 0, cuotaAgotada: false };
  }

  let itemsGuardados = 0, procesadas = 0;
  let cuotaAgotada = false;
  const CONCURRENCIA = 5;
  for (let i = 0; i < pendientes.length && !cuotaAgotada; i += CONCURRENCIA) {
    const grupo = pendientes.slice(i, i + CONCURRENCIA);
    const resultados = await Promise.all(grupo.map(async oc => {
      try {
        // Sin folio no hay forma de pedir los ítems (comprasOc.listItems.json filtra por
        // folio_dcto) — se marca sincronizada igual, para no reintentarla cada vez en vano.
        if (!oc.folio) { await pool.query(`UPDATE compras_historial_oc SET items_sincronizados_at=? WHERE id=?`, [ahora, oc.id]); return null; }
        const r = await listarComprasOcItems({ folio_dcto: oc.folio, limit: 200 });
        const items = r.data || [];
        if (items.length > 0) {
          const filas = items.map(it => [
            oc.id, String(it.producto_nombre || '').trim().slice(0, 300) || '(sin nombre)',
            Number(it.cantidad) || 0, Number(it.precio) || 0, Number(it.subtotal) || 0, ahora,
          ]);
          await pool.query(
            `INSERT INTO compras_historial_oc_item (historial_oc_id, producto_nombre, cantidad, precio_unitario, subtotal, created_at) VALUES ?`,
            [filas],
          );
          itemsGuardados += filas.length;
        }
        await pool.query(`UPDATE compras_historial_oc SET items_sincronizados_at=? WHERE id=?`, [ahora, oc.id]);
        return null;
      } catch (e: any) {
        // Cuota diaria agotada: NO es un fallo puntual de esta OC — reintentarla no va a andar
        // hasta que Obuma resetee la cuota. Se detecta por texto (mismo criterio que `llamar()` en
        // obuma.ts: Obuma no usa códigos HTTP para sus propios errores de negocio).
        return String(e?.message || '').includes(MARCADOR_CUOTA_OBUMA) ? 'cuota' : null;
        // (si no es cuota, la OC puntual falló y queda pendiente — se reintenta en el próximo lote)
      }
    }));
    procesadas += grupo.length;
    if (resultados.includes('cuota')) cuotaAgotada = true;
  }

  const [[{ total: pendientesRestantes }]] = await pool.query(
    `SELECT COUNT(*) as total FROM compras_historial_oc WHERE items_sincronizados_at IS NULL`,
  ) as any;
  return { procesadas, itemsGuardados, pendientesRestantes, cuotaAgotada };
}

// ── Lecturas — SQL local, sin llamadas a Obuma ──────────────────────────────────────────────────
export interface CompraOcResumen { id: string; folio: string | null; fecha: string; total: number; estado: string }

export async function historialComprasObuma(
  obumaProveedorId: string, limite = 100,
): Promise<{ compras: CompraOcResumen[]; totalReal: number }> {
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) as total FROM compras_historial_oc WHERE obuma_proveedor_id = ?`, [obumaProveedorId],
  ) as any;
  const [rows] = await pool.query(
    `SELECT obuma_compra_oc_id, folio, fecha, total, estado FROM compras_historial_oc
     WHERE obuma_proveedor_id = ? ORDER BY fecha DESC LIMIT ?`,
    [obumaProveedorId, limite],
  ) as any;
  const compras: CompraOcResumen[] = (rows as any[]).map(r => ({
    id: r.obuma_compra_oc_id, folio: r.folio,
    fecha: fechaSqlAIso(r.fecha) || '',
    total: Number(r.total) || 0, estado: r.estado || '',
  }));
  return { compras, totalReal: total };
}

export interface ItemCompraOc { nombre: string; cantidad: number; precioUnitario: number; subtotal: number }

/** Ítems de UNA orden de compra puntual, por folio. Local primero (instantáneo, si ya se
 *  sincronizó); si esa OC todavía no tiene ítems guardados, se trae en vivo de Obuma UNA vez y se
 *  guarda de inmediato (caché de escritura) — la próxima consulta sobre la misma OC ya sale local. */
export async function itemsCompraOcObuma(folio: string): Promise<ItemCompraOc[]> {
  const [ocRows] = await pool.query(
    `SELECT id, items_sincronizados_at FROM compras_historial_oc WHERE folio = ? LIMIT 1`, [folio],
  ) as any;
  const oc = (ocRows as any[])[0];

  if (oc?.items_sincronizados_at) {
    const [items] = await pool.query(
      `SELECT producto_nombre, cantidad, precio_unitario, subtotal FROM compras_historial_oc_item WHERE historial_oc_id = ?`,
      [oc.id],
    ) as any;
    return (items as any[]).map(it => ({
      nombre: it.producto_nombre, cantidad: Number(it.cantidad) || 0,
      precioUnitario: Number(it.precio_unitario) || 0, subtotal: Number(it.subtotal) || 0,
    }));
  }

  // Todavía no sincronizada localmente (OC muy reciente, o el backfill por lotes no ha llegado
  // hasta acá) — se trae en vivo y se guarda para la próxima vez.
  const r = await listarComprasOcItems({ folio_dcto: folio, limit: 200 });
  const items = (r.data || []).map(it => ({
    nombre: String(it.producto_nombre || '').trim() || '(sin nombre)', cantidad: Number(it.cantidad) || 0,
    precioUnitario: Number(it.precio) || 0, subtotal: Number(it.subtotal) || 0,
  }));
  if (oc) {
    const ahora = ahoraChileSQL();
    if (items.length > 0) {
      await pool.query(
        `INSERT INTO compras_historial_oc_item (historial_oc_id, producto_nombre, cantidad, precio_unitario, subtotal, created_at) VALUES ?`,
        [items.map(it => [oc.id, it.nombre.slice(0, 300), it.cantidad, it.precioUnitario, it.subtotal, ahora])],
      );
    }
    await pool.query(`UPDATE compras_historial_oc SET items_sincronizados_at=? WHERE id=?`, [ahora, oc.id]);
  }
  return items;
}

// ── Búsqueda "¿a quién le hemos comprado <producto>?" (pedido explícito, 14-sep-2026) ──────────
export interface ProveedorPorProducto {
  proveedorId: number | null; // id LOCAL (compras_proveedor) si está en el catálogo, null si no
  obumaProveedorId: string; nombreEmpresa: string; rut: string | null;
  productos: Array<{ nombre: string; veces: number; ultimaFecha: string | null }>;
}

async function resolverIdentidadesProveedores(obumaIds: string[]): Promise<Map<string, { id: number | null; nombreEmpresa: string; rut: string | null }>> {
  const resultado = new Map<string, { id: number | null; nombreEmpresa: string; rut: string | null }>();
  if (obumaIds.length === 0) return resultado;
  const [filas] = await pool.query(
    `SELECT id, obuma_proveedor_id, nombre_empresa, rut FROM compras_proveedor WHERE obuma_proveedor_id IN (?)`,
    [obumaIds],
  ) as any;
  for (const f of filas as any[]) resultado.set(String(f.obuma_proveedor_id), { id: f.id, nombreEmpresa: f.nombre_empresa, rut: f.rut });
  // Los que no están en el catálogo local (proveedor inactivo/no sincronizado en Obuma) se resuelven
  // uno por uno contra Obuma — debería ser la excepción, no la regla, una vez que el catálogo está
  // sincronizado.
  const faltantes = obumaIds.filter(id => !resultado.has(id));
  await Promise.all(faltantes.map(async id => {
    const remoto = await proveedorPorId(id).catch(() => null);
    if (remoto?.proveedor_razon_social?.trim()) {
      resultado.set(id, { id: null, nombreEmpresa: remoto.proveedor_razon_social.trim(), rut: remoto.proveedor_rut?.trim() || null });
    }
  }));
  return resultado;
}

/** Busca en el historial LOCAL (compras_historial_oc_item) — SQL, no HTTP: instantáneo apenas el
 *  backfill de ítems avanzó. Responde literalmente "si pongo martillo, decime a quién le hemos
 *  comprado martillo": proveedor, variante exacta del producto, cuántas veces, última fecha. */
export async function buscarProveedoresPorProducto(query: string): Promise<ProveedorPorProducto[]> {
  const like = `%${query.trim()}%`;
  const [rows] = await pool.query(
    `SELECT h.obuma_proveedor_id, i.producto_nombre, COUNT(*) as veces, MAX(h.fecha) as ultima_fecha
     FROM compras_historial_oc_item i
     JOIN compras_historial_oc h ON h.id = i.historial_oc_id
     WHERE i.producto_nombre LIKE ?
     GROUP BY h.obuma_proveedor_id, i.producto_nombre
     ORDER BY veces DESC
     LIMIT 200`,
    [like],
  ) as any;
  return agruparPorProveedor(rows as any[]);
}

async function agruparPorProveedor(
  filas: Array<{ obuma_proveedor_id: string; producto_nombre: string; veces: number; ultima_fecha: Date | string | null }>,
): Promise<ProveedorPorProducto[]> {
  const obumaIds = [...new Set(filas.map(f => String(f.obuma_proveedor_id)))];
  const identidades = await resolverIdentidadesProveedores(obumaIds);

  const porProveedor = new Map<string, ProveedorPorProducto>();
  for (const f of filas) {
    const obumaId = String(f.obuma_proveedor_id);
    const identidad = identidades.get(obumaId);
    if (!identidad) continue; // proveedor sin nombre resoluble — no se muestra basura
    const entrada = porProveedor.get(obumaId) || {
      proveedorId: identidad.id, obumaProveedorId: obumaId, nombreEmpresa: identidad.nombreEmpresa, rut: identidad.rut, productos: [],
    };
    entrada.productos.push({
      nombre: f.producto_nombre, veces: Number(f.veces) || 0,
      ultimaFecha: fechaSqlAIso(f.ultima_fecha),
    });
    porProveedor.set(obumaId, entrada);
  }
  return [...porProveedor.values()].sort((a, b) => {
    const totalA = a.productos.reduce((s, p) => s + p.veces, 0);
    const totalB = b.productos.reduce((s, p) => s + p.veces, 0);
    return totalB - totalA;
  });
}

function normalizarTextoProducto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** Pedido explícito del usuario (14-sep-2026): "cuando ingrese una cotización... que me diga el
 *  sistema ojo le hemos comprado clavos a este proveedor... según los ítems que tengamos que
 *  cotizar en el módulo de compra". Se busca por PALABRAS clave de la descripción (no la frase
 *  completa — "Martillo carpintero 27mm mango Stanley" nunca calzaría literal contra "MARTILLO
 *  CARPINTERO STANLEY 16OZ" en el historial) contra `compras_historial_oc_item`, 100% local.
 *
 *  BUG REAL (14-sep-2026, visto en vivo): con "Clavos de acero galvanizado 2 pulgadas", una sola
 *  palabra suelta como "ACERO" o "GALVANIZADO" calzaba con medio catálogo (botas, rieles, cajas...)
 *  sin relación real con clavos — el filtro SQL solo exigía que UNA palabra calzara. Ahora se trae
 *  el universo candidato con el mismo OR (rápido, usa el índice), pero se EXIGE en memoria que cada
 *  ítem calce con al menos 2 palabras clave (o con la única que haya, si la descripción trae solo
 *  una) antes de contarlo como sugerencia — mucho más selectivo, menos ruido. */
export async function sugerirProveedoresPorDescripcion(descripcion: string): Promise<ProveedorPorProducto[]> {
  const palabras = normalizarTextoProducto(descripcion)
    .split(/[^A-Z0-9]+/)
    .filter(w => w.length >= 4)
    .slice(0, 6); // tope — una descripción larga no debería armar una consulta de 20 OR
  if (palabras.length === 0) return [];

  const condiciones = palabras.map(() => `i.producto_nombre LIKE ?`).join(' OR ');
  const params = palabras.map(p => `%${p}%`);
  const [rows] = await pool.query(
    `SELECT h.obuma_proveedor_id, i.producto_nombre, h.fecha
     FROM compras_historial_oc_item i
     JOIN compras_historial_oc h ON h.id = i.historial_oc_id
     WHERE ${condiciones}
     LIMIT 1000`,
    params,
  ) as any;

  const umbralMatches = Math.min(2, palabras.length);
  const agregados = new Map<string, { obuma_proveedor_id: string; producto_nombre: string; veces: number; ultima_fecha: Date | string | null }>();
  for (const r of rows as any[]) {
    const nombreNorm = normalizarTextoProducto(String(r.producto_nombre));
    const matches = palabras.reduce((n, p) => n + (nombreNorm.includes(p) ? 1 : 0), 0);
    if (matches < umbralMatches) continue;
    const clave = `${r.obuma_proveedor_id}|${r.producto_nombre}`;
    const actual = agregados.get(clave);
    if (actual) {
      actual.veces += 1;
      if (r.fecha && (!actual.ultima_fecha || String(r.fecha) > String(actual.ultima_fecha))) actual.ultima_fecha = r.fecha;
    } else {
      agregados.set(clave, { obuma_proveedor_id: r.obuma_proveedor_id, producto_nombre: r.producto_nombre, veces: 1, ultima_fecha: r.fecha });
    }
  }

  const resultado = await agruparPorProveedor([...agregados.values()]);
  return resultado.slice(0, 5); // 5 proveedores sugeridos como mucho — es un aviso, no un listado completo
}
