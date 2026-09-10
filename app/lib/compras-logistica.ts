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

export type CategoriaFletero = 'UNICA' | 'CONSOLIDADA';
export type ModalidadRetiro = 'INTERNA' | 'EXTERNA' | 'MIXTA';

export interface Fletero {
  id: number; rut: string | null; nombre: string; categoria: CategoriaFletero;
  capacidadCamion: string | null; tipoCamion: string | null; precio: number | null; costoKm: number | null;
  incluyeDescarga: boolean; tienePionetas: boolean; plazoDespachoDias: number | null;
  quedoEnPana: boolean; nota: number | null; activo: boolean; zonas: string[];
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
    capacidadCamion: r.capacidad_camion, tipoCamion: r.tipo_camion,
    precio: r.precio == null ? null : Number(r.precio), costoKm: r.costo_km == null ? null : Number(r.costo_km),
    incluyeDescarga: !!r.incluye_descarga, tienePionetas: !!r.tiene_pionetas,
    plazoDespachoDias: r.plazo_despacho_dias, quedoEnPana: !!r.quedo_en_pana,
    nota: r.nota == null ? null : Number(r.nota), activo: !!r.activo, zonas,
  };
}

export async function listarFleteros(filtro?: { categoria?: CategoriaFletero; soloActivos?: boolean }): Promise<Fletero[]> {
  const cond: string[] = []; const params: any[] = [];
  if (filtro?.categoria) { cond.push('categoria = ?'); params.push(filtro.categoria); }
  if (filtro?.soloActivos) cond.push('activo = 1');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT * FROM compras_fletero ${where} ORDER BY nombre`, params) as any;
  const zonasPorId = await zonasDe((rows as any[]).map(r => r.id));
  return (rows as any[]).map(r => filaAFletero(r, zonasPorId.get(r.id) || []));
}

export interface DatosFletero {
  rut?: string | null; nombre: string; categoria: CategoriaFletero;
  capacidadCamion?: string | null; tipoCamion?: string | null; precio?: number | null; costoKm?: number | null;
  incluyeDescarga?: boolean; tienePionetas?: boolean; plazoDespachoDias?: number | null; zonas?: string[];
}

/** Alta de fletero (§13.3). El RUT es el enganche con OBUMA para identidad/histórico económico —
 *  no se valida contra la API acá (esa dirección de sincronización sigue sin resolverse, igual que
 *  con el SKU, §7.5); es solo el dato de enganche para cuando se resuelva. */
export async function crearFletero(datos: DatosFletero, actorId: number, actorNombre: string | null): Promise<number> {
  if (!datos.nombre?.trim()) throw new Error('Falta el nombre del fletero.');
  if (!['UNICA', 'CONSOLIDADA'].includes(datos.categoria)) throw new Error('Categoría inválida.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_fletero
       (rut, nombre, categoria, capacidad_camion, tipo_camion, precio, costo_km, incluye_descarga, tiene_pionetas,
        plazo_despacho_dias, creado_por, creado_por_nombre, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      datos.rut?.trim() || null, datos.nombre.trim().slice(0, 300), datos.categoria,
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

export async function actualizarFletero(id: number, datos: Partial<DatosFletero> & { activo?: boolean }): Promise<void> {
  const campos: string[] = []; const valores: any[] = [];
  const mapa: Record<string, string> = {
    rut: 'rut', nombre: 'nombre', categoria: 'categoria', capacidadCamion: 'capacidad_camion', tipoCamion: 'tipo_camion',
    precio: 'precio', costoKm: 'costo_km', plazoDespachoDias: 'plazo_despacho_dias',
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
export async function sugerirFleteros(zona: string, urgente: boolean): Promise<SugerenciaFletero[]> {
  const zonaNorm = normZona(zona);
  if (!zonaNorm) return [];
  const [rows] = await pool.query(
    `SELECT f.* FROM compras_fletero f
       JOIN compras_fletero_zona z ON z.fletero_id = f.id
      WHERE f.activo = 1 AND f.quedo_en_pana = 0 AND z.zona = ?
        ${urgente ? "AND f.categoria = 'UNICA'" : ''}`,
    [zonaNorm],
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
