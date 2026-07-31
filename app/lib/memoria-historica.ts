// app/lib/memoria-historica.ts
// Frente F.3 — memoria histórica: casos de experiencia (OC ↔ factura) y su consulta.
//
// ADVERTENCIA DE DISEÑO DEL PLAN, GRABADA ACÁ PARA QUE NO SE PIERDA:
// el histórico ORIENTA, NO DECIDE. Que hayamos ganado un producto antes no significa que la
// nueva licitación convenga — el análisis de viabilidad manda siempre. Por eso este módulo
// expone consultas ("¿ya vendimos esto? ¿a cuánto? ¿a quién?") y NUNCA un veredicto.
//
// MULTI-CLIENTE: todas las consultas filtran por cliente_id desde la primera línea, aunque hoy
// haya un solo cliente. Ver el encabezado de docs/migration-60-memoria-historica.sql.

import pool from '@/app/lib/db';

/**
 * Cliente (tenant) al que pertenecen los datos de esta instancia.
 *
 * ÚNICA COSTURA del multi-cliente: hoy es una constante (1) porque hay un solo cliente y
 * resolverlo por usuario exigiría tocar `usuarios` en producción, que no toca a este módulo.
 * Cuando haya más de uno, esto pasa a leer el cliente de la sesión y NADA MÁS cambia: todas
 * las consultas de abajo ya reciben el id como parámetro.
 */
export function clienteActual(): number {
  const n = Number(process.env.CLIENTE_ID);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ItemExperiencia {
  id?: number;
  descripcion: string;
  categoria?: string | null;
  marca?: string | null;
  modelo?: string | null;
  cantidad?: number | null;
  unidad?: string | null;
  precioUnitario?: number | null;
  costoUnitario?: number | null;
  proveedor?: string | null;
}

export interface DocumentoExperiencia {
  id?: number;
  tipo: 'OC' | 'FACTURA' | 'OTRO';
  numero?: string | null;
  fecha?: string | null;
  monto?: number | null;
  url?: string | null;
  nombre?: string | null;
}

export interface CasoExperiencia {
  id?: number;
  empresaId?: number | null;
  empresaNombre?: string | null;
  ocNumero: string;
  ocFecha?: string | null;
  monto?: number | null;
  moneda?: string;
  entidadNombre: string;
  entidadRut?: string | null;
  licitacionCodigo?: string | null;
  categoria?: string | null;
  descripcion?: string | null;
  estado?: string;
  origen?: string;
  items?: ItemExperiencia[];
  documentos?: DocumentoExperiencia[];
}

// ── Alta / actualización de un caso ──────────────────────────────────────────

/**
 * Guarda un caso completo (cabecera + ítems + documentos) de forma atómica.
 * Si la OC ya existe para este cliente, se ACTUALIZA: cargar dos veces el mismo respaldo es lo
 * normal (primero llega la OC, después la factura) y no debe crear un caso duplicado.
 *
 * Los ítems se reemplazan en bloque en vez de fusionarse: intentar casar ítem por ítem entre dos
 * cargas del mismo documento produce duplicados silenciosos, que es peor que rehacer la lista.
 */
export async function guardarCaso(
  caso: CasoExperiencia,
  autor: { id: number | null; nombre: string | null },
  clienteId = clienteActual(),
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [res] = await conn.query(
      `INSERT INTO experiencia_caso
         (cliente_id, empresa_id, oc_numero, oc_fecha, monto, moneda, entidad_nombre, entidad_rut,
          licitacion_codigo, categoria, descripcion, estado, origen, creado_por, creado_por_nombre)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         empresa_id        = VALUES(empresa_id),
         oc_fecha          = COALESCE(VALUES(oc_fecha), oc_fecha),
         monto             = COALESCE(VALUES(monto), monto),
         moneda            = VALUES(moneda),
         entidad_nombre    = VALUES(entidad_nombre),
         entidad_rut       = COALESCE(VALUES(entidad_rut), entidad_rut),
         licitacion_codigo = COALESCE(VALUES(licitacion_codigo), licitacion_codigo),
         categoria         = COALESCE(VALUES(categoria), categoria),
         descripcion       = COALESCE(VALUES(descripcion), descripcion),
         estado            = VALUES(estado),
         -- Truco de MySQL: sin esto, insertId viene 0 cuando la fila YA existía y no habría
         -- forma de saber a qué caso colgar los ítems y documentos.
         id                = LAST_INSERT_ID(id)`,
      [clienteId, caso.empresaId ?? null, caso.ocNumero, caso.ocFecha ?? null,
       caso.monto ?? null, caso.moneda || 'CLP', caso.entidadNombre, caso.entidadRut ?? null,
       caso.licitacionCodigo ?? null, caso.categoria ?? null, caso.descripcion ?? null,
       caso.estado || 'CERRADO', caso.origen || 'MANUAL', autor.id, autor.nombre],
    ) as any;
    const casoId = Number(res.insertId);

    if (caso.items) {
      await conn.query(`DELETE FROM experiencia_item WHERE caso_id = ?`, [casoId]);
      for (const it of caso.items) {
        if (!it.descripcion?.trim()) continue;
        await conn.query(
          `INSERT INTO experiencia_item
             (caso_id, cliente_id, descripcion, categoria, marca, modelo, cantidad, unidad,
              precio_unitario, costo_unitario, proveedor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [casoId, clienteId, it.descripcion.trim().slice(0, 500), it.categoria ?? caso.categoria ?? null,
           it.marca ?? null, it.modelo ?? null, it.cantidad ?? null, it.unidad ?? null,
           it.precioUnitario ?? null, it.costoUnitario ?? null, it.proveedor ?? null],
        );
      }
    }

    // Los documentos SÍ se acumulan (no se borran): son el respaldo, y perder una factura ya
    // cargada por volver a guardar la cabecera sería destruir la prueba de experiencia.
    for (const d of caso.documentos || []) {
      await conn.query(
        `INSERT INTO experiencia_documento (caso_id, cliente_id, tipo, numero, fecha, monto, url, nombre, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [casoId, clienteId, d.tipo, d.numero ?? null, d.fecha ?? null, d.monto ?? null,
         d.url ?? null, d.nombre ?? null, autor.id],
      );
    }

    await conn.commit();
    return casoId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function borrarCaso(casoId: number, clienteId = clienteActual()): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // El filtro por cliente va en el DELETE de la cabecera: si el caso no es de este cliente, no
    // borra nada y las hijas tampoco (se borran por caso_id ya verificado).
    const [r] = await conn.query(
      `DELETE FROM experiencia_caso WHERE id = ? AND cliente_id = ?`, [casoId, clienteId],
    ) as any;
    if (!r.affectedRows) { await conn.rollback(); return false; }
    await conn.query(`DELETE FROM experiencia_item WHERE caso_id = ?`, [casoId]);
    await conn.query(`DELETE FROM experiencia_documento WHERE caso_id = ?`, [casoId]);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── Listado ──────────────────────────────────────────────────────────────────

export interface FiltroCasos {
  texto?: string;
  categoria?: string;
  entidad?: string;
  empresaId?: number;
  desde?: string;
  hasta?: string;
  limite?: number;
}

export async function listarCasos(f: FiltroCasos = {}, clienteId = clienteActual()): Promise<any[]> {
  const where: string[] = ['c.cliente_id = ?'];
  const params: any[] = [clienteId];

  if (f.texto) {
    where.push(`(c.oc_numero LIKE ? OR c.entidad_nombre LIKE ? OR c.descripcion LIKE ?)`);
    const like = `%${f.texto}%`;
    params.push(like, like, like);
  }
  if (f.categoria)  { where.push('c.categoria = ?');      params.push(f.categoria); }
  if (f.entidad)    { where.push('c.entidad_nombre LIKE ?'); params.push(`%${f.entidad}%`); }
  if (f.empresaId)  { where.push('c.empresa_id = ?');     params.push(f.empresaId); }
  if (f.desde)      { where.push('c.oc_fecha >= ?');      params.push(f.desde); }
  if (f.hasta)      { where.push('c.oc_fecha <= ?');      params.push(f.hasta); }

  const limite = Math.max(1, Math.min(f.limite || 200, 500));
  try {
    const [rows] = await pool.query(
      `SELECT c.*, e.razon_social AS empresa_nombre,
              (SELECT COUNT(*) FROM experiencia_item  i WHERE i.caso_id = c.id) AS n_items,
              (SELECT COUNT(*) FROM experiencia_documento d WHERE d.caso_id = c.id AND d.tipo = 'FACTURA') AS n_facturas,
              (SELECT COUNT(*) FROM experiencia_documento d WHERE d.caso_id = c.id AND d.tipo = 'OC') AS n_oc
         FROM experiencia_caso c
         LEFT JOIN empresas e ON e.id = c.empresa_id
        WHERE ${where.join(' AND ')}
        ORDER BY (c.oc_fecha IS NULL) ASC, c.oc_fecha DESC, c.id DESC
        LIMIT ${limite}`,
      params,
    ) as any;
    return rows as any[];
  } catch (e) {
    console.error('[memoria] listarCasos falló:', String(e).slice(0, 300));
    return [];
  }
}

export async function obtenerCaso(casoId: number, clienteId = clienteActual()): Promise<any | null> {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, e.razon_social AS empresa_nombre
         FROM experiencia_caso c LEFT JOIN empresas e ON e.id = c.empresa_id
        WHERE c.id = ? AND c.cliente_id = ? LIMIT 1`, [casoId, clienteId],
    ) as any;
    const caso = (rows as any[])[0];
    if (!caso) return null;
    const [items] = await pool.query(`SELECT * FROM experiencia_item WHERE caso_id = ? ORDER BY id`, [casoId]) as any;
    const [docs]  = await pool.query(`SELECT * FROM experiencia_documento WHERE caso_id = ? ORDER BY tipo, id`, [casoId]) as any;
    return { ...caso, items, documentos: docs };
  } catch (e) {
    console.error('[memoria] obtenerCaso falló:', String(e).slice(0, 300));
    return null;
  }
}

// ── LA consulta del módulo: "¿ya hicimos esto antes?" ────────────────────────

export interface CoincidenciaProducto {
  itemId: number;
  descripcion: string;
  categoria: string | null;
  marca: string | null;
  modelo: string | null;
  precioUnitario: number | null;
  costoUnitario: number | null;
  proveedor: string | null;
  unidad: string | null;
  casoId: number;
  ocNumero: string;
  ocFecha: string | null;
  entidadNombre: string;
  empresaNombre: string | null;
}

/**
 * Busca un producto en la memoria. Devuelve las veces que ya lo vendimos, más reciente primero.
 *
 * DOS PASADAS a propósito: FULLTEXT primero (ordena por relevancia real y aguanta que el texto
 * de la licitación no calce palabra por palabra), y LIKE como red de seguridad — el índice
 * FULLTEXT de MySQL ignora palabras muy cortas y las que aparecen en demasiadas filas, así que
 * "GPS" o un modelo tipo "X200" pueden no salir en la primera pasada. Sin el LIKE, el usuario
 * ve "sin experiencia previa" para un producto que sí está cargado.
 */
export async function buscarProductoEnMemoria(
  consulta: string, limite = 20, clienteId = clienteActual(),
): Promise<CoincidenciaProducto[]> {
  const q = consulta.trim();
  if (q.length < 3) return [];
  const lim = Math.max(1, Math.min(limite, 100));

  const SELECT = `
    SELECT i.id AS itemId, i.descripcion, i.categoria, i.marca, i.modelo,
           i.precio_unitario AS precioUnitario, i.costo_unitario AS costoUnitario,
           i.proveedor, i.unidad,
           c.id AS casoId, c.oc_numero AS ocNumero, c.oc_fecha AS ocFecha,
           c.entidad_nombre AS entidadNombre, e.razon_social AS empresaNombre
      FROM experiencia_item i
      JOIN experiencia_caso c ON c.id = i.caso_id
      LEFT JOIN empresas e ON e.id = c.empresa_id
     WHERE i.cliente_id = ?`;

  const vistos = new Set<number>();
  const salida: CoincidenciaProducto[] = [];

  const agregar = (rows: any[]) => {
    for (const r of rows) {
      if (vistos.has(Number(r.itemId))) continue;
      vistos.add(Number(r.itemId));
      salida.push({
        ...r,
        itemId: Number(r.itemId), casoId: Number(r.casoId),
        precioUnitario: r.precioUnitario == null ? null : Number(r.precioUnitario),
        costoUnitario: r.costoUnitario == null ? null : Number(r.costoUnitario),
        ocFecha: r.ocFecha ? String(r.ocFecha) : null,
      });
    }
  };

  try {
    const [rows] = await pool.query(
      `${SELECT} AND MATCH(i.descripcion) AGAINST (? IN NATURAL LANGUAGE MODE)
        ORDER BY c.oc_fecha DESC LIMIT ${lim}`,
      [clienteId, q],
    ) as any;
    agregar(rows as any[]);
  } catch (e) {
    // El índice FULLTEXT puede no existir (migración a medias). No es fatal: sigue el LIKE.
    console.error('[memoria] búsqueda FULLTEXT falló, se usa LIKE:', String(e).slice(0, 200));
  }

  if (salida.length < lim) {
    try {
      const [rows] = await pool.query(
        `${SELECT} AND (i.descripcion LIKE ? OR i.modelo LIKE ? OR i.marca LIKE ?)
          ORDER BY c.oc_fecha DESC LIMIT ${lim}`,
        [clienteId, `%${q}%`, `%${q}%`, `%${q}%`],
      ) as any;
      agregar(rows as any[]);
    } catch (e) {
      console.error('[memoria] búsqueda LIKE falló:', String(e).slice(0, 200));
    }
  }

  return salida.slice(0, lim);
}

// ── Resumen para el tablero ──────────────────────────────────────────────────

export interface ResumenMemoria {
  casos: number;
  items: number;
  montoTotal: number;
  entidades: number;
  conFactura: number;
  desde: string | null;
  hasta: string | null;
  topCategorias: { categoria: string; casos: number; monto: number }[];
  topEntidades: { entidad: string; casos: number; monto: number }[];
}

export async function resumenMemoria(clienteId = clienteActual()): Promise<ResumenMemoria> {
  const vacio: ResumenMemoria = {
    casos: 0, items: 0, montoTotal: 0, entidades: 0, conFactura: 0,
    desde: null, hasta: null, topCategorias: [], topEntidades: [],
  };
  try {
    const [[g]] = await pool.query(
      `SELECT COUNT(*) AS casos, COALESCE(SUM(monto),0) AS monto,
              COUNT(DISTINCT entidad_nombre) AS entidades,
              MIN(oc_fecha) AS desde, MAX(oc_fecha) AS hasta
         FROM experiencia_caso WHERE cliente_id = ?`, [clienteId],
    ) as any;
    const [[it]] = await pool.query(
      `SELECT COUNT(*) AS n FROM experiencia_item WHERE cliente_id = ?`, [clienteId],
    ) as any;
    const [[fa]] = await pool.query(
      `SELECT COUNT(DISTINCT caso_id) AS n FROM experiencia_documento
        WHERE cliente_id = ? AND tipo = 'FACTURA'`, [clienteId],
    ) as any;
    const [cats] = await pool.query(
      `SELECT COALESCE(categoria,'Sin categoría') AS categoria, COUNT(*) AS casos, COALESCE(SUM(monto),0) AS monto
         FROM experiencia_caso WHERE cliente_id = ?
        GROUP BY COALESCE(categoria,'Sin categoría') ORDER BY casos DESC LIMIT 8`, [clienteId],
    ) as any;
    const [ents] = await pool.query(
      `SELECT entidad_nombre AS entidad, COUNT(*) AS casos, COALESCE(SUM(monto),0) AS monto
         FROM experiencia_caso WHERE cliente_id = ?
        GROUP BY entidad_nombre ORDER BY casos DESC LIMIT 8`, [clienteId],
    ) as any;

    return {
      casos: Number(g.casos) || 0,
      items: Number(it.n) || 0,
      montoTotal: Number(g.monto) || 0,
      entidades: Number(g.entidades) || 0,
      conFactura: Number(fa.n) || 0,
      desde: g.desde ? String(g.desde) : null,
      hasta: g.hasta ? String(g.hasta) : null,
      topCategorias: (cats as any[]).map(c => ({ categoria: String(c.categoria), casos: Number(c.casos), monto: Number(c.monto) })),
      topEntidades: (ents as any[]).map(c => ({ entidad: String(c.entidad), casos: Number(c.casos), monto: Number(c.monto) })),
    };
  } catch (e) {
    console.error('[memoria] resumen falló:', String(e).slice(0, 300));
    return vacio;
  }
}
