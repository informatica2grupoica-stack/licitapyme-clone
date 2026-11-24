// app/lib/compras-logistica.ts
// LOGÍSTICA Y FLETEROS (spec §13). Compras y logística se diseñan integrados hoy por decisión
// deliberada (§13.1) — este archivo es la frontera limpia para separarlos después sin refactor caro:
// el catálogo de fleteros es transversal a todos los negocios (no cuelga de un negocio puntual),
// mientras que la modalidad de retiro sí es una decisión POR negocio y vive en `compras_asignacion`.
//
// DOS CATEGORÍAS CON VARIABLES DISTINTAS (§13.3.1-§13.3.4): en carga ÚNICA el plazo no es variable
// de ranking (es inmediata por definición) y es la ÚNICA categoría que compite en Cadena de
// Urgencia (§13.3.4/§15.3); en CONSOLIDADA el plazo sí manda.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { proveedorPorRut } from '@/app/lib/obuma';
import { CLIENTE_ICA } from '@/app/lib/tenant';

export type CategoriaFletero = 'UNICA' | 'CONSOLIDADA';
export type ModalidadRetiro = 'INTERNA' | 'EXTERNA' | 'MIXTA';

/** Lo que Obuma sabe de un fletero: cuántas OC se le han hecho, cuándo fue la última y cuánto costó el último flete (neto). */
export interface HistorialFlete { ocs: number; ultimaFecha: string | null; ultimoFlete: number | null }

export interface Fletero {
  id: number; rut: string | null; nombre: string; categoria: CategoriaFletero;
  contactoNombre: string | null; telefono: string | null; correo: string | null; comuna: string | null;
  capacidadCamion: string | null; tipoCamion: string | null; precio: number | null; costoKm: number | null;
  incluyeDescarga: boolean; tienePionetas: boolean; plazoDespachoDias: number | null;
  quedoEnPana: boolean; nota: number | null; activo: boolean; zonas: string[];
  historial: HistorialFlete | null;
  /** En cuántos retiros de negocios se eligió este fletero (si > 0 no se puede eliminar: se perdería ese historial). */
  usos: number;
}

function normZona(z: string): string { return z.trim().toLowerCase(); }

async function zonasDe(fleteroIds: number[]): Promise<Map<number, string[]>> {
  if (fleteroIds.length === 0) return new Map();
  const [rows] = await pool.query(
    `SELECT fletero_id, zona FROM compras_fletero_zona WHERE fletero_id IN (${fleteroIds.map(() => '?').join(',')})`,
    fleteroIds,
  ) as any;
  const m = new Map<number, string[]>();
  for (const r of rows as any[]) { const arr = m.get(r.fletero_id) || []; arr.push(r.zona); m.set(r.fletero_id, arr); }
  return m;
}

function filaAFletero(r: any, zonas: string[]): Fletero {
  return {
    id: r.id, rut: r.rut, nombre: r.nombre, categoria: r.categoria,
    contactoNombre: r.contacto_nombre ?? null, telefono: r.telefono ?? null, correo: r.correo ?? null, comuna: r.comuna ?? null,
    historial: null, usos: 0,
    capacidadCamion: r.capacidad_camion, tipoCamion: r.tipo_camion,
    precio: r.precio == null ? null : Number(r.precio), costoKm: r.costo_km == null ? null : Number(r.costo_km),
    incluyeDescarga: !!r.incluye_descarga, tienePionetas: !!r.tiene_pionetas,
    plazoDespachoDias: r.plazo_despacho_dias, quedoEnPana: !!r.quedo_en_pana,
    nota: r.nota == null ? null : Number(r.nota), activo: !!r.activo, zonas,
  };
}

export async function listarFleteros(filtro?: { categoria?: CategoriaFletero; soloActivos?: boolean; clienteId?: number }): Promise<Fletero[]> {
  const clienteId = filtro?.clienteId ?? CLIENTE_ICA;
  const cond: string[] = ['cliente_id = ?']; const params: any[] = [clienteId];
  if (filtro?.categoria) { cond.push('categoria = ?'); params.push(filtro.categoria); }
  if (filtro?.soloActivos) cond.push('activo = 1');
  const [rows] = await pool.query(`SELECT * FROM compras_fletero WHERE ${cond.join(' AND ')} ORDER BY nombre`, params) as any;
  const zonasPorId = await zonasDe((rows as any[]).map(r => r.id));
  const lista = (rows as any[]).map(r => filaAFletero(r, zonasPorId.get(r.id) || []));
  const historial = await historialDeRuts(lista.map(f => f.rut), clienteId);
  for (const f of lista) f.historial = (f.rut && historial.get(normRut(f.rut))) || null;
  if (lista.length) {
    const [usos] = await pool.query(
      `SELECT transporte_fletero_id id, COUNT(*) n FROM compras_retiro_proveedor
        WHERE transporte_fletero_id IN (${lista.map(() => '?').join(',')}) GROUP BY transporte_fletero_id`,
      lista.map(f => f.id)) as any;
    const porId = new Map<number, number>((usos as any[]).map(u => [Number(u.id), Number(u.n)]));
    for (const f of lista) f.usos = porId.get(f.id) ?? 0;
  }
  return lista;
}

/** Elimina un fletero del catálogo (con sus zonas). Se niega si ya se eligió en algún retiro de un negocio: se perdería ese historial
 *  (para dejar de usarlo sin borrar nada está «en pana»). Debe ser del cliente de quien lo pide. */
export async function eliminarFletero(id: number, clienteId: number, actorId: number, actorNombre: string | null): Promise<string> {
  const [rows] = await pool.query(`SELECT nombre FROM compras_fletero WHERE id = ? AND cliente_id = ? LIMIT 1`, [id, clienteId]) as any;
  const f = (rows as any[])[0];
  if (!f) throw Object.assign(new Error('Fletero no encontrado.'), { status: 404 });
  const [uso] = await pool.query(`SELECT COUNT(*) n FROM compras_retiro_proveedor WHERE transporte_fletero_id = ?`, [id]) as any;
  const n = Number((uso as any[])[0]?.n ?? 0);
  if (n > 0) {
    throw Object.assign(new Error(`${f.nombre} está en ${n} retiro${n === 1 ? '' : 's'} de negocios: no se puede eliminar para no perder ese historial. Si ya no quieres usarlo, márcalo «en pana».`), { status: 409 });
  }
  await pool.query(`DELETE FROM compras_fletero_zona WHERE fletero_id = ?`, [id]);
  await pool.query(`DELETE FROM compras_fletero WHERE id = ? AND cliente_id = ?`, [id, clienteId]);
  await registrarEvento({
    tipo: 'COMPRAS_FLETERO_ELIMINADO', actorId, actorNombre,
    mensaje: `Se eliminó el fletero "${f.nombre}" del catálogo.`, metadata: { fletero_id: id },
  });
  return f.nombre as string;
}

// ── Lo que Obuma ya sabe de los transportistas (OC hechas, último flete) ─────────────────────────
// Obuma existe solo para el cliente ICA (ver skill multiempresa-escalable): para otro cliente no hay historial ni candidatos.
const normRut = (r: string | null | undefined) => String(r ?? '').replace(/[.\-\s]/g, '').toUpperCase();
const ES_LINEA_FLETE = /flete|transporte|despacho|camion|camión/i;
// (sin courier/expres/starken: Chilexpress y similares son paquetería, no fleteros — decisión del dueño, 24-nov-2026)
const NOMBRE_TRANSPORTISTA = /transport|flete|logist|camion|camión/i;

interface OcFlete { rut: string; razon: string; fecha: string | null; lineas: Array<{ descripcion: string; subtotal: number }> }

function lineasDe(json: unknown): Array<{ descripcion: string; subtotal: number }> {
  try {
    return (JSON.parse(String(json ?? '[]')) as any[]).map(it => ({
      descripcion: String(it.producto_nombre || it.producto_descripcion || ''), subtotal: Number(it.subtotal) || 0,
    }));
  } catch { return []; }
}

async function ocsObuma(filtroSql: string, params: any[]): Promise<OcFlete[]> {
  const [rows] = await pool.query(
    `SELECT proveedor_rut, proveedor_razon_social, fecha_ingreso, items_json FROM obuma_compras
      WHERE estado <> 'ANULADA' AND proveedor_rut IS NOT NULL ${filtroSql} ORDER BY fecha_ingreso DESC`,
    params,
  ) as any;
  return (rows as any[]).map(r => ({
    rut: String(r.proveedor_rut), razon: String(r.proveedor_razon_social ?? ''),
    fecha: r.fecha_ingreso ? new Date(r.fecha_ingreso).toISOString().slice(0, 10) : null,
    lineas: lineasDe(r.items_json),
  }));
}

function resumir(ocs: OcFlete[]): HistorialFlete {
  const conFlete = ocs.find(o => o.lineas.some(l => ES_LINEA_FLETE.test(l.descripcion)));
  const monto = conFlete ? conFlete.lineas.filter(l => ES_LINEA_FLETE.test(l.descripcion)).reduce((s, l) => s + l.subtotal, 0) : 0;
  return { ocs: ocs.length, ultimaFecha: ocs[0]?.fecha ?? null, ultimoFlete: monto > 0 ? Math.round(monto) : null };
}

async function historialDeRuts(ruts: Array<string | null>, clienteId: number): Promise<Map<string, HistorialFlete>> {
  const out = new Map<string, HistorialFlete>();
  const limpios = [...new Set(ruts.filter((r): r is string => !!r).map(normRut))];
  if (clienteId !== CLIENTE_ICA || limpios.length === 0) return out;
  const ocs = await ocsObuma(
    `AND REPLACE(REPLACE(REPLACE(proveedor_rut,'.',''),'-',''),' ','') IN (${limpios.map(() => '?').join(',')})`, limpios);
  const porRut = new Map<string, OcFlete[]>();
  for (const o of ocs) { const k = normRut(o.rut); porRut.set(k, [...(porRut.get(k) || []), o]); }
  for (const [k, lista] of porRut) out.set(k, resumir(lista));
  return out;
}

// Obuma rellena con «SIN INFORMACION» lo que no sabe: eso no es un dato.
const limpio = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return !s || /^sin informaci[oó]n$/i.test(s) || s === '-' ? null : s;
};

// Obuma guarda la comuna como código numérico («17», «212»): eso no sirve de zona, solo el texto.
const comunaTexto = (v: unknown): string | null => { const s = limpio(v); return s && !/^\d+$/.test(s) ? s : null; };
// Teléfonos vacíos de Obuma vienen como «0» o «000000000».
const telefonoValido = (v: unknown): string | null => { const s = limpio(v); return s && /[1-9]/.test(s) ? s : null; };

/** Contacto de un proveedor: primero lo que dice Obuma (nombre, teléfono o celular, correo, comuna); lo que falte, del catálogo de
 *  Proveedores de Licitank (`compras_proveedor`) si el RUT está ahí. */
async function contactoDe(obuma: Awaited<ReturnType<typeof proveedorPorRut>>, rutNorm: string) {
  const [cp] = await pool.query(
    `SELECT contacto_nombre, telefono, correo, comuna FROM compras_proveedor
      WHERE REPLACE(REPLACE(REPLACE(rut,'.',''),'-',''),' ','') = ? LIMIT 1`, [rutNorm]) as any;
  const loc = (cp as any[])[0];
  return {
    contactoNombre: limpio(obuma?.proveedor_contacto) ?? limpio(loc?.contacto_nombre),
    telefono: telefonoValido(obuma?.proveedor_telefono) ?? telefonoValido(obuma?.proveedor_celular) ?? telefonoValido(loc?.telefono),
    correo: limpio(obuma?.proveedor_email) ?? limpio(loc?.correo),
    comuna: comunaTexto(obuma?.proveedor_comuna) ?? comunaTexto(loc?.comuna),
  };
}

export interface CandidatoFletero {
  rut: string; nombre: string; contactoNombre: string | null; telefono: string | null; correo: string | null; comuna: string | null;
  historial: HistorialFlete; motivo: string;
}

/** Transportistas que Obuma ya conoce y que todavía no están en el catálogo. Un proveedor entra si su nombre es de transporte/logística
 *  o si alguna de sus OC trae SOLO líneas de flete (así una tienda que vendió algo y cobró despacho NO entra). Los datos de contacto
 *  salen del catálogo de Proveedores (`compras_proveedor`). */
export async function candidatosFleteros(clienteId: number, soloRuts?: Set<string>): Promise<CandidatoFletero[]> {
  if (clienteId !== CLIENTE_ICA) return [];
  const [yaRows] = await pool.query(`SELECT rut FROM compras_fletero WHERE cliente_id = ? AND rut IS NOT NULL`, [clienteId]) as any;
  const ya = new Set((yaRows as any[]).map(r => normRut(r.rut)));
  const ocs = await ocsObuma('', []);
  const porRut = new Map<string, OcFlete[]>();
  for (const o of ocs) { const k = normRut(o.rut); if (k && !ya.has(k)) porRut.set(k, [...(porRut.get(k) || []), o]); }

  const elegidos: Array<{ k: string; lista: OcFlete[]; motivo: string }> = [];
  for (const [k, lista] of porRut) {
    if (soloRuts && !soloRuts.has(k)) continue;
    const porNombre = NOMBRE_TRANSPORTISTA.test(lista[0].razon);
    const soloFlete = lista.some(o => o.lineas.length > 0 && o.lineas.every(l => ES_LINEA_FLETE.test(l.descripcion)));
    if (porNombre || soloFlete) elegidos.push({ k, lista, motivo: porNombre && soloFlete ? 'nombre y OC de flete' : porNombre ? 'por su nombre' : 'sus OC son solo de flete' });
  }
  if (elegidos.length === 0) return [];

  // Una consulta a Obuma por candidato, en serie (son pocos): si Obuma falla para uno, se queda con el catálogo local.
  const salida: CandidatoFletero[] = [];
  for (const { k, lista, motivo } of elegidos) {
    const obuma = await proveedorPorRut(lista[0].rut).catch(() => null);
    const c = await contactoDe(obuma, k);
    salida.push({ rut: lista[0].rut, nombre: lista[0].razon.replace(/\s+/g, ' ').trim(), ...c, historial: resumir(lista), motivo });
  }
  return salida.sort((a, b) => b.historial.ocs - a.historial.ocs);
}

/** Importa al catálogo los transportistas elegidos (por RUT). Entran como «carga única», con el último flete como precio de referencia
 *  y su comuna como primera zona; el resto (zonas, categoría, plazo) lo completa una persona. */
export async function importarFleterosDesdeObuma(ruts: string[], clienteId: number, actorId: number, actorNombre: string | null): Promise<number> {
  const quiere = new Set(ruts.map(normRut));
  const candidatos = await candidatosFleteros(clienteId, quiere);
  for (const c of candidatos) {
    await crearFletero({
      rut: c.rut, nombre: c.nombre, categoria: 'UNICA', contactoNombre: c.contactoNombre, telefono: c.telefono, correo: c.correo,
      comuna: c.comuna, precio: c.historial.ultimoFlete, zonas: c.comuna ? [c.comuna] : [],
    }, actorId, actorNombre, clienteId);
  }
  return candidatos.length;
}

export interface DatosFletero {
  rut?: string | null; nombre: string; categoria: CategoriaFletero;
  contactoNombre?: string | null; telefono?: string | null; correo?: string | null; comuna?: string | null;
  capacidadCamion?: string | null; tipoCamion?: string | null; precio?: number | null; costoKm?: number | null;
  incluyeDescarga?: boolean; tienePionetas?: boolean; plazoDespachoDias?: number | null; zonas?: string[];
}

export interface IdentidadFleteroObuma {
  rut: string; razonSocial: string; contacto: string | null; direccion: string | null; comuna: string | null;
  telefono: string | null; correo: string | null;
}

/** §13.3: "Se puebla desde OBUMA, que conecta con facturas y proveedores" — la IDENTIDAD del
 *  fletero (razón social, RUT) sale de ahí, no se tipea a ciegas; solo lo OPERATIVO (capacidad,
 *  tipo de camión, costo/km, pionetas, zonas, nota, pana) es propio de Licitank y no existe en
 *  OBUMA (§13.3, "advertencia técnica"). Antes `crearFletero` guardaba el RUT como un dato suelto
 *  "para cuando se resuelva la integración" y nunca se consultaba — esto lo resuelve: se busca por
 *  RUT ANTES de crear, igual que ya hace `verificarProveedorEnObuma` para proveedores de producto
 *  (compras-oc-obuma.ts). Devuelve null si el RUT no tiene facturas/registro en OBUMA todavía (un
 *  fletero nuevo, nunca contratado antes, es un caso real — no se bloquea el alta por eso). */
export async function buscarFleteroEnObuma(rut: string): Promise<IdentidadFleteroObuma | null> {
  const p = await proveedorPorRut(rut);
  if (!p) return null;
  const c = await contactoDe(p, normRut(p.proveedor_rut));
  return {
    rut: p.proveedor_rut, razonSocial: p.proveedor_razon_social,
    contacto: c.contactoNombre, direccion: p.proveedor_direccion || null, comuna: c.comuna,
    telefono: c.telefono, correo: c.correo,
  };
}

/** Alta de fletero (§13.3). El nombre/RUT deberían venir de `buscarFleteroEnObuma` (identidad real,
 *  spec §13.3) — se acepta igual sin ese paso para un fletero que todavía no tiene facturas en OBUMA
 *  (contratado por primera vez), pero la UI ofrece la búsqueda antes de escribir nada a mano. */
export async function crearFletero(datos: DatosFletero, actorId: number, actorNombre: string | null, clienteId: number = CLIENTE_ICA): Promise<number> {
  if (!datos.nombre?.trim()) throw new Error('Falta el nombre del fletero.');
  if (!['UNICA', 'CONSOLIDADA'].includes(datos.categoria)) throw new Error('Categoría inválida.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_fletero
       (cliente_id, rut, nombre, categoria, contacto_nombre, telefono, correo, comuna, capacidad_camion, tipo_camion, precio, costo_km,
        incluye_descarga, tiene_pionetas, plazo_despacho_dias, creado_por, creado_por_nombre, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      clienteId, datos.rut?.trim() || null, datos.nombre.trim().slice(0, 300), datos.categoria,
      datos.contactoNombre?.trim().slice(0, 160) || null, datos.telefono?.trim().slice(0, 40) || null,
      datos.correo?.trim().slice(0, 160) || null, datos.comuna?.trim().slice(0, 120) || null,
      datos.capacidadCamion || null, datos.tipoCamion || null, datos.precio ?? null, datos.costoKm ?? null,
      datos.incluyeDescarga ? 1 : 0, datos.tienePionetas ? 1 : 0,
      datos.categoria === 'CONSOLIDADA' ? (datos.plazoDespachoDias ?? null) : null,
      actorId, actorNombre, ahora, ahora,
    ],
  ) as any;
  const id = r.insertId as number;

  const zonas = [...new Set((datos.zonas || []).map(normZona).filter(Boolean))];
  if (zonas.length) {
    const ph = zonas.map(() => '(?,?)').join(',');
    await pool.query(`INSERT INTO compras_fletero_zona (fletero_id, zona) VALUES ${ph}`, zonas.flatMap(z => [id, z]));
  }
  await registrarEvento({
    tipo: 'COMPRAS_FLETERO_CREADO', actorId, actorNombre,
    mensaje: `Se agregó el fletero "${datos.nombre}" (${datos.categoria === 'UNICA' ? 'carga única' : 'carga consolidada'}).`,
    metadata: { fletero_id: id },
  });
  return id;
}

/** Anti-IDOR: ¿este fletero es del cliente de quien consulta? Un id de otro cliente responde «no encontrado». */
export async function fleteroEsDeCliente(id: number, clienteId: number): Promise<boolean> {
  const [rows] = await pool.query(`SELECT 1 FROM compras_fletero WHERE id = ? AND cliente_id = ? LIMIT 1`, [id, clienteId]) as any;
  return (rows as any[]).length > 0;
}

export async function actualizarFletero(id: number, datos: Partial<DatosFletero> & { activo?: boolean }): Promise<void> {
  const campos: string[] = []; const valores: any[] = [];
  const mapa: Record<string, string> = {
    rut: 'rut', nombre: 'nombre', categoria: 'categoria', capacidadCamion: 'capacidad_camion', tipoCamion: 'tipo_camion',
    precio: 'precio', costoKm: 'costo_km', plazoDespachoDias: 'plazo_despacho_dias',
    contactoNombre: 'contacto_nombre', telefono: 'telefono', correo: 'correo', comuna: 'comuna',
  };
  for (const [k, col] of Object.entries(mapa)) {
    if ((datos as any)[k] !== undefined) { campos.push(`${col} = ?`); valores.push((datos as any)[k]); }
  }
  if (datos.incluyeDescarga !== undefined) { campos.push('incluye_descarga = ?'); valores.push(datos.incluyeDescarga ? 1 : 0); }
  if (datos.tienePionetas !== undefined) { campos.push('tiene_pionetas = ?'); valores.push(datos.tienePionetas ? 1 : 0); }
  if (datos.activo !== undefined) { campos.push('activo = ?'); valores.push(datos.activo ? 1 : 0); }
  if (campos.length) {
    campos.push('updated_at = ?'); valores.push(ahoraChileSQL());
    await pool.query(`UPDATE compras_fletero SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]);
  }
  if (datos.zonas) {
    const zonas = [...new Set(datos.zonas.map(normZona).filter(Boolean))];
    await pool.query(`DELETE FROM compras_fletero_zona WHERE fletero_id = ?`, [id]);
    if (zonas.length) {
      const ph = zonas.map(() => '(?,?)').join(',');
      await pool.query(`INSERT INTO compras_fletero_zona (fletero_id, zona) VALUES ${ph}`, zonas.flatMap(z => [id, z]));
    }
  }
}

/** §13.3.2: "si alguna vez quedó en pana, queda descartado por no confiable" — marca dura, no una
 *  nota baja. Una vez TRUE, `sugerirFleteros` lo excluye para siempre (no hay vuelta atrás en código;
 *  si algún día se decide reincorporarlo, es una decisión humana vía `actualizarFletero`). */
export async function registrarPana(fleteroId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const [r] = await pool.query(
    `UPDATE compras_fletero SET quedo_en_pana = 1, updated_at = ? WHERE id = ?`, [ahoraChileSQL(), fleteroId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Fletero no encontrado.');
  await registrarEvento({
    tipo: 'COMPRAS_FLETERO_PANA', actorId, actorNombre,
    mensaje: `Se registró que el fletero #${fleteroId} quedó en pana — queda descartado de las sugerencias (spec §13.3.2).`,
    metadata: { fletero_id: fleteroId },
  });
}

/** §13.4: "la nota la define el propio encargado tras la experiencia." 1.0 a 5.0. */
export async function evaluarFletero(fleteroId: number, nota: number, actorId: number, actorNombre: string | null): Promise<void> {
  if (!Number.isFinite(nota) || nota < 1 || nota > 5) throw new Error('La nota debe estar entre 1 y 5.');
  const [r] = await pool.query(
    `UPDATE compras_fletero SET nota = ?, updated_at = ? WHERE id = ?`, [Math.round(nota * 10) / 10, ahoraChileSQL(), fleteroId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Fletero no encontrado.');
  await registrarEvento({
    tipo: 'COMPRAS_FLETERO_EVALUADO', actorId, actorNombre,
    mensaje: `Se calificó al fletero #${fleteroId} con nota ${nota}.`,
    metadata: { fletero_id: fleteroId, nota },
  });
}

export interface SugerenciaFletero extends Fletero { costoTentativo: number | null }

/** §13.5: "el sistema propone el mejor fletero, o todas las alternativas ordenadas, sin que nadie
 *  busque." Caso de prueba real de la spec: entrega en Coyhaique → devuelve los proveedores que
 *  llegan a Coyhaique con sus precios tentativos.
 *
 *  §13.3.4: "el reloj del proyecto filtra la categoría antes que al proveedor: en Cadena de
 *  Urgencia solo compite carga única" — `urgente` fuerza `categoria=UNICA`.
 *
 *  Orden (§13.3.1, "la diferenciación principal es por costo"): UNICA por precio ascendente;
 *  CONSOLIDADA por plazo de despacho primero (§13.3.3, "acá el plazo sí manda"), precio después.
 *  Los que quedaron en pana NUNCA aparecen (§13.3.2). */
export async function sugerirFleteros(zona: string, urgente: boolean, clienteId: number = CLIENTE_ICA): Promise<SugerenciaFletero[]> {
  const zonaNorm = normZona(zona);
  if (!zonaNorm) return [];
  const [rows] = await pool.query(
    `SELECT f.* FROM compras_fletero f
       JOIN compras_fletero_zona z ON z.fletero_id = f.id
      WHERE f.cliente_id = ? AND f.activo = 1 AND f.quedo_en_pana = 0 AND z.zona = ?
        ${urgente ? "AND f.categoria = 'UNICA'" : ''}`,
    [clienteId, zonaNorm],
  ) as any;
  const fleteros = rows as any[];
  const zonasPorId = await zonasDe(fleteros.map(f => f.id));
  const lista = fleteros.map(f => ({ ...filaAFletero(f, zonasPorId.get(f.id) || []), costoTentativo: f.precio == null ? null : Number(f.precio) }));

  lista.sort((a, b) => {
    if (a.categoria !== b.categoria) return a.categoria === 'UNICA' ? -1 : 1; // única primero: es la que compite siempre
    if (a.categoria === 'CONSOLIDADA') {
      const d = (a.plazoDespachoDias ?? Infinity) - (b.plazoDespachoDias ?? Infinity);
      if (d !== 0) return d;
    }
    return (a.costoTentativo ?? Infinity) - (b.costoTentativo ?? Infinity);
  });
  return lista;
}

// ── Modalidad de retiro (§13.2) — decisión POR negocio, "se define en el primer instante" ───────
export interface ModalidadRetiroInfo { modalidad: ModalidadRetiro | null; definidaPorNombre: string | null; definidaAt: string | null }

export async function obtenerModalidadRetiro(negocioId: number): Promise<ModalidadRetiroInfo> {
  const [rows] = await pool.query(
    `SELECT modalidad_retiro, modalidad_retiro_por_nombre, DATE_FORMAT(modalidad_retiro_at, '%Y-%m-%d %H:%i:%s') AS modalidad_retiro_at
       FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return { modalidad: null, definidaPorNombre: null, definidaAt: null };
  return { modalidad: r.modalidad_retiro, definidaPorNombre: r.modalidad_retiro_por_nombre, definidaAt: r.modalidad_retiro_at };
}

// ── Retiro POR PROVEEDOR: cada proveedor está en un lugar distinto, así que se elige por separado ──
export async function obtenerRetiroPorProveedor(negocioId: number): Promise<Record<string, 'INTERNA' | 'EXTERNA'>> {
  const [rows] = await pool.query(`SELECT proveedor_nombre, modalidad FROM compras_retiro_proveedor WHERE negocio_id = ?`, [negocioId]) as any;
  const out: Record<string, 'INTERNA' | 'EXTERNA'> = {};
  for (const r of rows as any[]) out[r.proveedor_nombre] = r.modalidad;
  return out;
}

/** Guarda la elección de un proveedor y deja la modalidad global del negocio como resumen
 *  (todos igual → esa; mezclados → MIXTA) para no tocar lo que ya lee la modalidad global. */
export async function definirRetiroProveedor(
  negocioId: number, proveedorNombre: string, modalidad: 'INTERNA' | 'EXTERNA', actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!['INTERNA', 'EXTERNA'].includes(modalidad)) throw new Error('Modalidad inválida.');
  if (!proveedorNombre.trim()) throw new Error('Falta el proveedor.');
  await pool.query(
    `INSERT INTO compras_retiro_proveedor (negocio_id, proveedor_nombre, modalidad, por_nombre, updated_at) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE modalidad = VALUES(modalidad), por_nombre = VALUES(por_nombre), updated_at = VALUES(updated_at)`,
    [negocioId, proveedorNombre, modalidad, actorNombre, ahoraChileSQL()],
  );
  const elegidas = Object.values(await obtenerRetiroPorProveedor(negocioId));
  const distintas = new Set(elegidas);
  const resumen: ModalidadRetiro = distintas.size > 1 ? 'MIXTA' : (elegidas[0] as ModalidadRetiro);
  await definirModalidadRetiro(negocioId, resumen, actorId, actorNombre);
}

// ── Datos del transporte de un proveedor (migration-158, pedido del dueño 21-oct-2026): quién lo trae
// (nombre y RUT, para su factura o pago), cuánto cobra, desde dónde, hasta dónde y cuándo.
export interface TransporteRetiro {
  fleteroId: number | null; nombre: string | null; rut: string | null; telefono: string | null;
  precio: number | null; precioConIva: boolean; origen: string | null; destino: string | null;
  fecha: string | null; nota: string | null;
}

export async function obtenerTransportesRetiro(negocioId: number): Promise<Record<string, TransporteRetiro>> {
  const [rows] = await pool.query(
    `SELECT proveedor_nombre, transporte_fletero_id, transporte_nombre, transporte_rut, transporte_telefono, transporte_precio,
            transporte_precio_con_iva, transporte_origen, transporte_destino, DATE_FORMAT(transporte_fecha, '%Y-%m-%d') AS transporte_fecha, transporte_nota
       FROM compras_retiro_proveedor WHERE negocio_id = ? AND transporte_nombre IS NOT NULL`,
    [negocioId],
  ) as any;
  const out: Record<string, TransporteRetiro> = {};
  for (const r of rows as any[]) out[r.proveedor_nombre] = {
    fleteroId: r.transporte_fletero_id, nombre: r.transporte_nombre, rut: r.transporte_rut, telefono: r.transporte_telefono,
    precio: r.transporte_precio == null ? null : Number(r.transporte_precio), precioConIva: !!r.transporte_precio_con_iva,
    origen: r.transporte_origen, destino: r.transporte_destino, fecha: r.transporte_fecha, nota: r.transporte_nota,
  };
  return out;
}

export async function guardarTransporteRetiro(
  negocioId: number, proveedorNombre: string, t: TransporteRetiro, actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!t.nombre?.trim()) throw new Error('Falta el nombre del transporte.');
  if (t.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(t.fecha)) throw new Error('La fecha del retiro no es válida.');
  const [r] = await pool.query(
    `UPDATE compras_retiro_proveedor SET transporte_fletero_id = ?, transporte_nombre = ?, transporte_rut = ?, transporte_telefono = ?,
            transporte_precio = ?, transporte_precio_con_iva = ?, transporte_origen = ?, transporte_destino = ?, transporte_fecha = ?,
            transporte_nota = ?, por_nombre = ?, updated_at = ?
      WHERE negocio_id = ? AND proveedor_nombre = ? AND modalidad = 'EXTERNA'`,
    [t.fleteroId || null, t.nombre.trim().slice(0, 300), t.rut?.trim() || null, t.telefono?.trim() || null,
      t.precio != null && t.precio > 0 ? Math.round(t.precio) : null, t.precioConIva ? 1 : 0,
      t.origen?.trim() || null, t.destino?.trim() || null, t.fecha || null, t.nota?.trim() || null,
      actorNombre, ahoraChileSQL(), negocioId, proveedorNombre],
  ) as any;
  if (!r?.affectedRows) throw new Error('Primero marca que este proveedor lo trae un transporte.');
  const [negRows] = await pool.query(`SELECT licitacion_codigo FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
  await registrarEvento({
    tipo: 'COMPRAS_TRANSPORTE_RETIRO', licitacionCodigo: (negRows as any[])[0]?.licitacion_codigo ?? null, actorId, actorNombre,
    mensaje: `Transporte de ${proveedorNombre}: ${t.nombre.trim()}${t.precio ? ` por $${Math.round(t.precio).toLocaleString('es-CL')}` : ''}${t.origen || t.destino ? ` (${t.origen || '?'} → ${t.destino || '?'})` : ''}.`,
    metadata: { negocio_id: negocioId, proveedor: proveedorNombre, transporte: t },
  });
}

/** "La define el humano; el sistema propone, no decide" (§13.2) — por eso no hay ningún cálculo
 *  automático acá, solo el registro de la decisión humana. */
export async function definirModalidadRetiro(
  negocioId: number, modalidad: ModalidadRetiro, actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!['INTERNA', 'EXTERNA', 'MIXTA'].includes(modalidad)) throw new Error('Modalidad inválida.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_asignacion SET modalidad_retiro = ?, modalidad_retiro_por = ?, modalidad_retiro_por_nombre = ?, modalidad_retiro_at = ?
       WHERE negocio_id = ?`,
    [modalidad, actorId, actorNombre, ahora, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Compras no está abierto para este negocio.');
  const [negRows] = await pool.query(`SELECT licitacion_codigo FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
  await registrarEvento({
    tipo: 'COMPRAS_MODALIDAD_RETIRO_DEFINIDA', licitacionCodigo: (negRows as any[])[0]?.licitacion_codigo ?? null,
    actorId, actorNombre, mensaje: `Se definió la modalidad de retiro: ${modalidad.toLowerCase()}.`,
    metadata: { negocio_id: negocioId, modalidad },
  });
}
