// app/lib/busqueda-global.ts
//
// Universo del BUSCADOR GLOBAL. A diferencia del radar (que está acotado a las
// keywords de cada perfil, y que este módulo NO toca), acá el usuario busca
// libremente sobre todo Mercado Público.
//
// El problema que resuelve: el listado de la API de MP solo entrega
// { CodigoExterno, Nombre, CodigoEstado, FechaCierre }. Buscando contra eso,
// solo se puede matchear el TÍTULO — y en la práctica ~60% de las coincidencias
// reales viven en los ítems, no en el nombre ("CONVENIO SUMINISTRO DE FIERROS"
// no dice "materiales de construcción" en ninguna parte del título).
//
// La tabla `licitaciones_cache` ya tiene descripción + ítems + categoría de
// decenas de miles de licitaciones (la llena el cron). Este módulo la usa como
// índice de búsqueda: prefiltra en SQL y puntúa en Node con el mismo matcher
// que usa el radar (text-match.ts, importado sin modificar).
//
// Restricción de negocio: solo licitaciones ABIERTAS. La lista autoritativa de
// qué está abierto la da la API en vivo (`estado=activas`); el caché solo aporta
// el contenido. Así una licitación cacheada como "Publicada" que ya cerró no se
// cuela.

import pool from '@/app/lib/db';
import { indexarLicitacion, evaluarKeyword, tokenizar, stemLite } from '@/app/lib/text-match';
import type { Licitacion, LicitacionItem } from '@/app/types/mercado-publico.types';

/** Tolerancia sobre `fecha_cierre` del caché: puede estar desactualizada si MP
 *  extendió el plazo. Solo acota el prefiltro SQL — quién está realmente abierto
 *  lo decide `codigosAbiertos`. */
const VENTANA_CIERRE_DIAS = 30;

/** Techo del prefiltro SQL. Como después intersectamos con las abiertas (~4.500),
 *  este límite solo evita traer basura de estados terminales en consultas muy
 *  genéricas ("servicio"). */
const LIMITE_PREFILTRO = 20000;

export interface CandidatoGlobal {
  lic: Licitacion;
  score: number;
  /** Campos donde se detectó la consulta: 'titulo' | 'descripcion' | 'items' | 'categoria' */
  fuentes: string[];
}

/** Escapa los comodines de LIKE para que la consulta del usuario sea literal. */
function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m);
}

/**
 * Radical que se usa en el LIKE del prefiltro SQL.
 *
 * Tiene que ser MÁS PERMISIVO que el gate de text-match, nunca más estricto:
 * lo que el SQL descarte, Node ya no lo puede recuperar. Usar el stem
 * ("materiales" → "material") cubre las cuatro reglas de `tokenEnCampo`:
 * exacto, mismo radical, prefijo y substring — todas contienen el radical.
 */
function radicalParaSQL(token: string): string {
  return escaparLike(stemLite(token));
}

interface FilaCache {
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  organismo: string | null;
  region: string | null;
  monto: number | null;
  estado: string | null;
  tipo: string | null;
  fecha_cierre: Date | null;
  fecha_publicacion: Date | null;
  items_json: string | null;
}

function parsearItems(raw: string | null): LicitacionItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((it: any) => ({
      CodigoProducto: String(it.CodigoProducto || ''),
      NombreProducto: it.NombreProducto || '',
      Descripcion: it.Descripcion || '',
      Categoria: it.Categoria || '',
      Cantidad: it.Cantidad || 0,
      Unidad: it.UnidadMedida || it.Unidad || 'Unidad',
      UnidadMedida: it.UnidadMedida || '',
    }));
  } catch {
    return [];
  }
}

function filaALicitacion(row: FilaCache, items: LicitacionItem[]): Licitacion {
  return {
    Codigo: row.codigo,
    Nombre: row.nombre || '',
    Descripcion: row.descripcion || '',
    Estado: row.estado || 'Publicada',
    EstadoNombre: row.estado || 'Publicada',
    Organismo: row.organismo || '',
    CodigoOrganismo: '',
    Region: row.region || '',
    MontoEstimado: row.monto != null ? Number(row.monto) : undefined,
    MontoTotal: row.monto != null ? Number(row.monto) : undefined,
    Tipo: row.tipo || '',
    FechaCierre: row.fecha_cierre ? new Date(row.fecha_cierre).toISOString() : '',
    FechaPublicacion: row.fecha_publicacion ? new Date(row.fecha_publicacion).toISOString() : '',
    Items: items,
  } as Licitacion;
}

/**
 * Busca en el caché enriquecido (nombre + descripción + ítems + categoría),
 * acotado a los códigos que hoy están abiertos.
 *
 * @param consulta        texto libre del usuario
 * @param codigosAbiertos códigos que la API reporta como abiertos ahora
 */
export async function buscarEnCache(
  consulta: string,
  codigosAbiertos: Set<string>,
): Promise<CandidatoGlobal[]> {
  const tokens = tokenizar(consulta);
  if (tokens.length === 0 || codigosAbiertos.size === 0) return [];

  // Prefiltro SQL: cada token debe aparecer en ALGÚN campo (mismo gate que
  // `evaluarKeyword`), sin exigir que sea el mismo campo para todos.
  const condiciones: string[] = [];
  const params: string[] = [];
  for (const token of tokens) {
    const like = `%${radicalParaSQL(token)}%`;
    condiciones.push(
      // El backslash ya es el carácter de escape por defecto de LIKE en MySQL,
      // así que `escaparLike` basta y no hace falta cláusula ESCAPE explícita.
      `(nombre LIKE ? OR descripcion LIKE ? OR items_json LIKE ? OR organismo LIKE ?)`,
    );
    params.push(like, like, like, like);
  }

  // Fase 1 — solo los CÓDIGOS que pasan el prefiltro. `items_json` es mediumtext
  // y la base es remota: traerlo para todo el prefiltro costaba segundos de red.
  // Pidiendo la clave primero, el peso se transfiere solo por lo que sobrevive.
  const sqlCodigos =
    `SELECT codigo
       FROM licitaciones_cache
      WHERE enriquecido = 1
        AND (fecha_cierre IS NULL OR fecha_cierre >= DATE_SUB(NOW(), INTERVAL ${VENTANA_CIERRE_DIAS} DAY))
        AND ${condiciones.join(' AND ')}
      LIMIT ${LIMITE_PREFILTRO}`;

  const [filasCodigo] = (await pool.query(sqlCodigos, params)) as any[];

  // La API en vivo manda: si no está abierta ahora, no entra.
  const codigos = (filasCodigo as { codigo: string }[])
    .map(f => f.codigo)
    .filter(c => codigosAbiertos.has(c));
  if (codigos.length === 0) return [];

  // Fase 2 — el detalle completo, solo de los que quedaron.
  const rows: FilaCache[] = [];
  for (let i = 0; i < codigos.length; i += 500) {
    const chunk = codigos.slice(i, i + 500);
    const [detalle] = (await pool.query(
      `SELECT codigo, nombre, descripcion, organismo, region, monto, estado, tipo,
              fecha_cierre, fecha_publicacion, items_json
         FROM licitaciones_cache
        WHERE codigo IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    )) as any[];
    rows.push(...(detalle as FilaCache[]));
  }

  const salida: CandidatoGlobal[] = [];
  for (const row of rows) {
    const items = parsearItems(row.items_json);
    const idx = indexarLicitacion({
      nombre: row.nombre || '',
      descripcion: row.descripcion || '',
      items: items.map(i => `${i.NombreProducto} ${i.Descripcion || ''}`).join(' '),
      categoria: items.map(i => i.Categoria || '').join(' '),
    });

    const r = evaluarKeyword(idx, consulta);
    if (!r.match) continue;

    salida.push({ lic: filaALicitacion(row, items), score: r.score, fuentes: r.fuentes });
  }

  return salida;
}

/**
 * Puntúa por TÍTULO las licitaciones abiertas que todavía no están en el caché
 * (recién publicadas que el cron no alcanzó a enriquecer). Es el mismo matcher,
 * con los campos que la API de listado sí entrega.
 */
export function buscarPorTitulo(consulta: string, licitaciones: Licitacion[]): CandidatoGlobal[] {
  const tokens = tokenizar(consulta);
  if (tokens.length === 0) return [];

  const salida: CandidatoGlobal[] = [];
  for (const lic of licitaciones) {
    const idx = indexarLicitacion({ nombre: lic.Nombre || '', descripcion: '', items: '', categoria: '' });
    const r = evaluarKeyword(idx, consulta);
    if (!r.match) continue;
    salida.push({ lic, score: r.score, fuentes: r.fuentes });
  }
  return salida;
}
