// app/lib/compras-incidencias.ts
// ZONA DE INCIDENCIAS (spec §9). Etapa TRANSVERSAL, no secuencial (§9.1): "el proyecto tiene o no
// tiene incidencia. Si la tiene se gestiona, y la gestión depende del tipo." Nunca detiene el reloj
// de entrega (§9.7 — el reloj vive en tanda 6, pero la regla ya queda documentada acá: nada en este
// archivo toca ninguna fecha de plazo).
//
// Abre y cierra el ENCARGADO de entrega del proyecto (§9.5) — mismo círculo que opera el resto de
// Compras (puedeOperarCompras), salvo la Oportunidad de Mejora, que tiene su propio doble visado.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';

export type Naturaleza = 'DEFENSIVA' | 'OFENSIVA';
export type OrigenIncidencia = 'MANUAL' | 'AUTOMATICA';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export interface TipoIncidencia { clave: string; naturaleza: Naturaleza; titulo: string; descripcion: string | null }

export async function listarCatalogoIncidencias(): Promise<TipoIncidencia[]> {
  const [rows] = await pool.query(
    `SELECT clave, naturaleza, titulo, descripcion FROM compras_incidencia_tipo WHERE activo = 1 ORDER BY orden`,
  ) as any;
  return rows as TipoIncidencia[];
}

/** §1.3.5 — "lo escrito en texto libre debe poder promoverse a categoría estable cuando se repite."
 *  Acción manual (no automática: promover un tipo es una decisión de criterio, no de conteo). */
export async function promoverTipoIncidencia(tipoLibre: string, naturaleza: Naturaleza): Promise<string> {
  const clave = tipoLibre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || `tipo_${Date.now()}`;
  await pool.query(
    `INSERT IGNORE INTO compras_incidencia_tipo (clave, naturaleza, titulo, descripcion, orden, promovido_de_texto_libre)
     VALUES (?, ?, ?, NULL, 999, 1)`,
    [clave, naturaleza, tipoLibre.trim().slice(0, 200)],
  );
  return clave;
}

export interface Incidencia {
  id: number; negocioId: number; productoId: number | null; naturaleza: Naturaleza; origen: OrigenIncidencia;
  tipoClave: string | null; tipoLibre: string | null; tituloTipo: string | null; descripcion: string;
  estado: 'ABIERTA' | 'CERRADA';
  abiertaPorNombre: string | null; abiertaAt: string; cerradaPorNombre: string | null; cerradaAt: string | null; resolucion: string | null;
  om: {
    ahorroEstimado: number | null; productoAlternativo: string | null;
    aprobadaJefeVentas: boolean; aprobadaJefeVentasPorNombre: string | null; aprobadaJefeVentasAt: string | null;
    planteadaClienteAt: string | null; aprobadaCliente: boolean | null; constancia: string | null;
  } | null;
}

function filaAIncidencia(r: any): Incidencia {
  return {
    id: r.id, negocioId: r.negocio_id, productoId: r.producto_id, naturaleza: r.naturaleza, origen: r.origen,
    tipoClave: r.tipo_clave, tipoLibre: r.tipo_libre, tituloTipo: r.titulo_tipo, descripcion: r.descripcion,
    estado: r.estado, abiertaPorNombre: r.abierta_por_nombre, abiertaAt: r.abierta_at,
    cerradaPorNombre: r.cerrada_por_nombre, cerradaAt: r.cerrada_at, resolucion: r.resolucion,
    om: r.naturaleza !== 'OFENSIVA' ? null : {
      ahorroEstimado: r.om_ahorro_estimado == null ? null : Number(r.om_ahorro_estimado),
      productoAlternativo: r.om_producto_alternativo,
      aprobadaJefeVentas: !!r.om_aprobada_jefe_ventas, aprobadaJefeVentasPorNombre: r.om_aprobada_jefe_ventas_por_nombre,
      aprobadaJefeVentasAt: r.om_aprobada_jefe_ventas_at, planteadaClienteAt: r.om_planteada_cliente_at,
      aprobadaCliente: r.om_aprobada_cliente == null ? null : !!r.om_aprobada_cliente, constancia: r.om_constancia,
    },
  };
}

const SELECT_BASE = `
  SELECT i.*, t.titulo AS titulo_tipo,
         DATE_FORMAT(i.abierta_at, '%Y-%m-%d %H:%i:%s') AS abierta_at_fmt,
         DATE_FORMAT(i.cerrada_at, '%Y-%m-%d %H:%i:%s') AS cerrada_at_fmt,
         DATE_FORMAT(i.om_aprobada_jefe_ventas_at, '%Y-%m-%d %H:%i:%s') AS om_aprobada_jefe_ventas_at_fmt,
         DATE_FORMAT(i.om_planteada_cliente_at, '%Y-%m-%d %H:%i:%s') AS om_planteada_cliente_at_fmt
    FROM compras_incidencia i LEFT JOIN compras_incidencia_tipo t ON t.clave = i.tipo_clave`;

function normalizarFila(r: any): any {
  return { ...r, abierta_at: r.abierta_at_fmt, cerrada_at: r.cerrada_at_fmt,
    om_aprobada_jefe_ventas_at: r.om_aprobada_jefe_ventas_at_fmt, om_planteada_cliente_at: r.om_planteada_cliente_at_fmt };
}

export async function listarIncidencias(negocioId: number): Promise<Incidencia[]> {
  const [rows] = await pool.query(`${SELECT_BASE} WHERE i.negocio_id = ? ORDER BY i.estado = 'ABIERTA' DESC, i.abierta_at DESC`, [negocioId]) as any;
  return (rows as any[]).map(r => filaAIncidencia(normalizarFila(r)));
}

export interface DatosIncidencia {
  productoId?: number | null; naturaleza: Naturaleza; tipoClave?: string | null; tipoLibre?: string | null;
  descripcion: string; tareaId?: number | null;
}

/** §9.2 — apertura MANUAL (el encargado la describe). La automática vive en `compras.ts`
 *  (`abrirIncidenciaPorHallazgo`), sin pasar por acá, para no crear un ciclo de imports entre los
 *  dos archivos — mismo criterio que `invalidarAprobacionesCompras`. */
export async function abrirIncidencia(
  negocioId: number, datos: DatosIncidencia, actorId: number, actorNombre: string | null,
): Promise<number> {
  if (!datos.descripcion?.trim()) throw new Error('Falta describir la incidencia.');
  if (!datos.tipoClave && !datos.tipoLibre?.trim()) throw new Error('Falta el tipo de incidencia (del catálogo o en texto libre).');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_incidencia
       (negocio_id, producto_id, tarea_id, naturaleza, origen, tipo_clave, tipo_libre, descripcion, estado,
        abierta_por, abierta_por_nombre, abierta_at, created_at, updated_at)
     VALUES (?,?,?,?, 'MANUAL', ?,?,?, 'ABIERTA', ?,?,?,?,?)`,
    [negocioId, datos.productoId ?? null, datos.tareaId ?? null, datos.naturaleza,
     datos.tipoClave || null, datos.tipoLibre?.trim() || null, datos.descripcion.trim(),
     actorId, actorNombre, ahora, ahora, ahora],
  ) as any;
  const id = r.insertId as number;
  await registrarEvento({
    tipo: 'COMPRAS_INCIDENCIA_ABIERTA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se abrió una incidencia ${datos.naturaleza === 'OFENSIVA' ? '(Oportunidad de Mejora)' : ''}: ${datos.descripcion.trim().slice(0, 200)}`,
    metadata: { negocio_id: negocioId, incidencia_id: id, naturaleza: datos.naturaleza },
  });
  return id;
}

/** §9.5 — cierra el encargado de entrega del proyecto. */
export async function cerrarIncidencia(id: number, resolucion: string | null, actorId: number, actorNombre: string | null): Promise<void> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_incidencia SET estado = 'CERRADA', cerrada_por = ?, cerrada_por_nombre = ?, cerrada_at = ?, resolucion = ?, updated_at = ?
       WHERE id = ? AND estado = 'ABIERTA'`,
    [actorId, actorNombre, ahora, resolucion || null, ahora, id],
  ) as any;
  if (!r?.affectedRows) throw new Error('La incidencia no existe o ya está cerrada.');
  const [rows] = await pool.query(`SELECT negocio_id FROM compras_incidencia WHERE id = ?`, [id]) as any;
  await registrarEvento({
    tipo: 'COMPRAS_INCIDENCIA_CERRADA', licitacionCodigo: await licitacionDeNegocio((rows as any[])[0]?.negocio_id), actorId, actorNombre,
    mensaje: `Se cerró la incidencia #${id}${resolucion ? `: ${resolucion}` : ''}.`,
    metadata: { incidencia_id: id },
  });
}

// ── Oportunidad de Mejora (§9.4) — doble aprobación: detecta encargado → jefe de ventas → cliente ──
export interface DatosOportunidadMejora {
  productoId: number; productoAlternativo: string; ahorroEstimado: number | null; descripcion: string;
}

/** Paso 1, "la detecta el encargado de compras" — es la misma apertura de incidencia, con
 *  naturaleza OFENSIVA y los campos propios de la Oportunidad de Mejora. */
export async function crearOportunidadMejora(
  negocioId: number, datos: DatosOportunidadMejora, actorId: number, actorNombre: string | null,
): Promise<number> {
  if (!datos.productoAlternativo?.trim()) throw new Error('Falta describir el producto alternativo.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_incidencia
       (negocio_id, producto_id, naturaleza, origen, tipo_clave, descripcion, estado,
        om_ahorro_estimado, om_producto_alternativo,
        abierta_por, abierta_por_nombre, abierta_at, created_at, updated_at)
     VALUES (?,?, 'OFENSIVA', 'MANUAL', 'oportunidad_mejora', ?, 'ABIERTA', ?, ?, ?,?,?,?,?)`,
    [negocioId, datos.productoId, datos.descripcion.trim(), datos.ahorroEstimado ?? null, datos.productoAlternativo.trim(),
     actorId, actorNombre, ahora, ahora, ahora],
  ) as any;
  const id = r.insertId as number;
  await registrarEvento({
    tipo: 'COMPRAS_OPORTUNIDAD_MEJORA_DETECTADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se detectó una Oportunidad de Mejora: ${datos.productoAlternativo.trim()}.`,
    metadata: { negocio_id: negocioId, incidencia_id: id },
  });
  return id;
}

/** Paso 2 — "la aprueba el jefe de ventas". Verificado en la API, no acá. */
export async function aprobarOportunidadJefeVentas(id: number, actorId: number, actorNombre: string | null): Promise<void> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_incidencia SET om_aprobada_jefe_ventas = 1, om_aprobada_jefe_ventas_por = ?, om_aprobada_jefe_ventas_por_nombre = ?,
        om_aprobada_jefe_ventas_at = ?, updated_at = ?
      WHERE id = ? AND naturaleza = 'OFENSIVA' AND om_aprobada_jefe_ventas = 0`,
    [actorId, actorNombre, ahora, ahora, id],
  ) as any;
  if (!r?.affectedRows) throw new Error('No es una Oportunidad de Mejora pendiente de aprobación del jefe de ventas.');
}

/** Paso 3 — "sin la aprobación interna no se plantea al cliente" (regla dura). Solo registra que
 *  YA se le planteó (una acción externa, humana, fuera del sistema); no envía nada. */
export async function plantearOportunidadACliente(id: number, actorId: number, actorNombre: string | null): Promise<void> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_incidencia SET om_planteada_cliente_at = ?, updated_at = ?
       WHERE id = ? AND naturaleza = 'OFENSIVA' AND om_aprobada_jefe_ventas = 1 AND om_planteada_cliente_at IS NULL`,
    [ahora, ahora, id],
  ) as any;
  if (!r?.affectedRows) throw new Error('Falta la aprobación del jefe de ventas antes de plantearla al cliente (spec §9.4).');
}

/** Respuesta del cliente + constancia mínima (recomendación §9.4: "quién autorizó, con quién se
 *  habló, cuándo" — aunque no haya correo). Si aprueba, cierra la incidencia con esa resolución. */
export async function registrarRespuestaCliente(
  id: number, aprobada: boolean, constancia: string, actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!constancia?.trim()) throw new Error('Falta la constancia mínima: quién autorizó, con quién se habló y cuándo (spec §9.4).');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_incidencia
        SET om_aprobada_cliente = ?, om_constancia = ?, updated_at = ?,
            estado = ?, cerrada_por = ?, cerrada_por_nombre = ?, cerrada_at = ?, resolucion = ?
      WHERE id = ? AND naturaleza = 'OFENSIVA' AND om_planteada_cliente_at IS NOT NULL`,
    [aprobada ? 1 : 0, constancia.trim(),
     ahora, aprobada ? 'CERRADA' : 'CERRADA', aprobada ? actorId : actorId, aprobada ? actorNombre : actorNombre, ahora,
     aprobada ? 'Oportunidad de Mejora aprobada por el cliente.' : 'Oportunidad de Mejora rechazada por el cliente.',
     id],
  ) as any;
  if (!r?.affectedRows) throw new Error('Todavía no se le planteó esta Oportunidad de Mejora al cliente.');
  const [rows] = await pool.query(`SELECT negocio_id FROM compras_incidencia WHERE id = ?`, [id]) as any;
  await registrarEvento({
    tipo: 'COMPRAS_OPORTUNIDAD_MEJORA_RESUELTA', licitacionCodigo: await licitacionDeNegocio((rows as any[])[0]?.negocio_id), actorId, actorNombre,
    mensaje: `El cliente ${aprobada ? 'aprobó' : 'rechazó'} la Oportunidad de Mejora #${id}.`,
    metadata: { incidencia_id: id, aprobada },
  });
}
