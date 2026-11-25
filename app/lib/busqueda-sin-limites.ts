// app/lib/busqueda-sin-limites.ts
//
// BUSCADOR SIN LÍMITES (estilo Mercado Público).
//
// Antes el buscador solo miraba lo ABIERTO (`estado=activas`) y aplicaba los filtros
// sobre el listado crudo de la API, que no trae organismo, región ni monto: filtrar por
// esos campos dejaba cero resultados, y las Cerradas/Adjudicadas no existían.
// Ahora el universo es TODO `licitaciones_cache` (cualquier estado, tipo, región) y los
// filtros se aplican en SQL. Lo que la API marca abierto y el caché aún no tiene se suma
// por título (solo si no se pidió un filtro que necesite datos enriquecidos).

import pool from '@/app/lib/db';
import { indexarLicitacion, evaluarKeyword, tokenizar } from '@/app/lib/text-match';
import type { Licitacion } from '@/app/types/mercado-publico.types';
import {
  escaparLike, radicalParaSQL, parsearItems, filaALicitacion, type FilaCache,
} from '@/app/lib/busqueda-global';

const NOMBRE_ESTADO: Record<string, string> = {
  '5': 'Publicada', '6': 'Cerrada', '7': 'Desierta', '8': 'Adjudicada', '18': 'Revocada', '19': 'Suspendida',
};

export interface FiltrosGlobal {
  consulta?: string;
  estados?: string[];        // códigos MP ('5','6',…). Vacío = todos
  tipos?: string[];          // 'LE','LP','B2',…
  regiones?: string[];
  organismo?: string;
  montoMin?: number;
  montoMax?: number;
  cierreDesde?: string;      // YYYY-MM-DD
  cierreHasta?: string;
  publicacionDesde?: string;
  publicacionHasta?: string;
  codigos?: string[];        // si viene, solo estos códigos (vacío = ninguno)
  orden?: string;
  pagina: number;
  porPagina: number;
}

export interface ResultadoGlobal {
  total: number;
  licitaciones: { lic: Licitacion; score: number; fuentes: string[] }[];
}

const TECHO_FILAS = 60_000;
const COLS_DETALLE =
  'codigo, nombre, descripcion, organismo, region, monto, estado, tipo, fecha_cierre, fecha_publicacion, items_json';

function fechaValida(s?: string): string | null {
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** ¿Parece un pedazo de código de licitación? (ej. "2495-17", "2495-17-B2") */
function pareceFragmentoDeCodigo(q: string): boolean {
  return /^\d{2,8}-\d{1,4}(-[A-Za-z0-9]{0,6})?$/.test(q.trim());
}

interface FilaLigera {
  codigo: string; estado: string | null; fecha_cierre: Date | null;
  fecha_publicacion: Date | null; monto: number | null;
}

interface Cand {
  codigo: string; estado: string; cierre: number; publ: number; monto: number;
  enCache: boolean; score: number; fuentes: string[]; vivo?: Licitacion;
}

export async function buscarSinLimites(f: FiltrosGlobal, abiertas: Licitacion[] | null): Promise<ResultadoGlobal> {
  const consulta = (f.consulta || '').trim();
  const porCodigoTexto = consulta !== '' && pareceFragmentoDeCodigo(consulta);
  const tokens = consulta && !porCodigoTexto ? tokenizar(consulta) : [];
  if (consulta && !porCodigoTexto && tokens.length === 0) return { total: 0, licitaciones: [] };

  if (f.codigos && f.codigos.length === 0) return { total: 0, licitaciones: [] };
  const soloCodigos = f.codigos ? new Set(f.codigos.map(c => c.toUpperCase())) : null;
  const nombresSel = (f.estados || []).filter(e => NOMBRE_ESTADO[e]).map(e => NOMBRE_ESTADO[e]);
  // abiertas = null → la API en vivo no respondió: no se reclasifica nada.
  const sinApi = abiertas === null;
  const vivas = new Map((abiertas || []).map(l => [l.Codigo, l]));

  // ── SQL: todos los filtros que el caché sabe responder ────────────────────
  const where: string[] = [];
  const params: any[] = [];

  if (nombresSel.length) {
    // 'Publicada' del caché puede estar ya cerrada: se trae para reclasificarla después.
    const lista = new Set(nombresSel);
    if (lista.has('Cerrada')) lista.add('Publicada');
    where.push(`estado IN (${[...lista].map(() => '?').join(',')})`);
    params.push(...lista);
  }
  const tipos = (f.tipos || []).map(t => t.toUpperCase()).filter(t => /^[A-Z0-9]{1,4}$/.test(t));
  if (tipos.length) {
    where.push('codigo REGEXP ?');
    params.push(`-(${tipos.join('|')})[0-9]{2}[a-z]?$`);
  }
  const regiones = (f.regiones || []).filter(Boolean);
  if (regiones.length) {
    where.push(`(${regiones.map(() => 'region LIKE ?').join(' OR ')})`);
    params.push(...regiones.map(r => `%${escaparLike(r)}%`));
  }
  if (f.organismo?.trim()) {
    where.push('organismo LIKE ?');
    params.push(`%${escaparLike(f.organismo.trim())}%`);
  }
  if (f.montoMin) { where.push('monto >= ?'); params.push(f.montoMin); }
  if (f.montoMax) { where.push('monto <= ?'); params.push(f.montoMax); }
  const cd = fechaValida(f.cierreDesde), ch = fechaValida(f.cierreHasta);
  const pd = fechaValida(f.publicacionDesde), ph = fechaValida(f.publicacionHasta);
  if (cd) { where.push('fecha_cierre >= ?'); params.push(`${cd} 00:00:00`); }
  if (ch) { where.push('fecha_cierre <= ?'); params.push(`${ch} 23:59:59`); }
  if (pd) { where.push('fecha_publicacion >= ?'); params.push(`${pd} 00:00:00`); }
  if (ph) { where.push('fecha_publicacion <= ?'); params.push(`${ph} 23:59:59`); }

  if (f.codigos?.length) {
    where.push(`codigo IN (${f.codigos.map(() => '?').join(',')})`);
    params.push(...f.codigos);
  }
  if (porCodigoTexto) {
    where.push('codigo LIKE ?');
    params.push(`%${escaparLike(consulta.toUpperCase())}%`);
  }
  for (const token of tokens) {
    const like = `%${radicalParaSQL(token)}%`;
    where.push('(nombre LIKE ? OR descripcion LIKE ? OR items_json LIKE ? OR organismo LIKE ? OR codigo LIKE ?)');
    params.push(like, like, like, like, like);
  }

  const [filas] = (await pool.query(
    `SELECT codigo, estado, fecha_cierre, fecha_publicacion, monto
       FROM licitaciones_cache
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      LIMIT ${TECHO_FILAS}`,
    params,
  )) as any[];

  // ── Estado efectivo: lo que la API dice abierto manda sobre el caché ───────
  const cands: Cand[] = [];
  const enCache = new Set<string>();
  for (const r of filas as FilaLigera[]) {
    enCache.add(r.codigo);
    let estado = r.estado || 'Publicada';
    const viva = vivas.get(r.codigo);
    if (!sinApi && estado === 'Publicada' && !viva) estado = 'Cerrada';
    if (nombresSel.length && !nombresSel.includes(estado)) continue;
    cands.push({
      codigo: r.codigo, estado, enCache: true, score: 1, fuentes: [],
      cierre: viva?.FechaCierre ? new Date(viva.FechaCierre).getTime()
        : (r.fecha_cierre ? new Date(r.fecha_cierre).getTime() : 0),
      publ: r.fecha_publicacion ? new Date(r.fecha_publicacion).getTime() : 0,
      monto: r.monto != null ? Number(r.monto) : 0,
    });
  }

  // ── Abiertas que el caché aún no conoce (solo título, sin datos enriquecidos) ─
  const pideEnriquecido = regiones.length || f.organismo?.trim() || f.montoMin || f.montoMax || pd || ph;
  if ((!nombresSel.length || nombresSel.includes('Publicada')) && !pideEnriquecido) {
    for (const lic of abiertas || []) {
      if (enCache.has(lic.Codigo)) continue;
      if (soloCodigos && !soloCodigos.has(lic.Codigo.toUpperCase())) continue;
      if (tipos.length) {
        const m = lic.Codigo.match(/-([A-Za-z]{1,2}[0-9]?)\d{2}[a-z]?$/i);
        if (!m || !tipos.includes(m[1].toUpperCase())) continue;
      }
      const cierre = lic.FechaCierre ? new Date(lic.FechaCierre).getTime() : 0;
      if (cd && cierre < new Date(`${cd}T00:00:00`).getTime()) continue;
      if (ch && cierre > new Date(`${ch}T23:59:59`).getTime()) continue;
      let score = 1; let fuentes: string[] = [];
      if (porCodigoTexto) {
        if (!lic.Codigo.toUpperCase().includes(consulta.toUpperCase())) continue;
      } else if (tokens.length) {
        const r = evaluarKeyword(
          indexarLicitacion({ nombre: lic.Nombre || '', descripcion: '', items: '', categoria: '' }), consulta);
        if (!r.match) continue;
        score = r.score; fuentes = r.fuentes;
      }
      cands.push({ codigo: lic.Codigo, estado: 'Publicada', enCache: false, score, fuentes, vivo: lic, cierre, publ: 0, monto: 0 });
    }
  }

  const detalle = new Map<string, FilaCache>();
  const traerDetalle = async (codigos: string[]) => {
    for (let i = 0; i < codigos.length; i += 500) {
      const chunk = codigos.slice(i, i + 500);
      const [det] = (await pool.query(
        `SELECT ${COLS_DETALLE} FROM licitaciones_cache WHERE codigo IN (${chunk.map(() => '?').join(',')})`,
        chunk)) as any[];
      for (const row of det as FilaCache[]) detalle.set(row.codigo, row);
    }
  };

  // ── Texto libre: puntuar contra nombre + descripción + ítems + categoría ──
  let finales = cands;
  if (tokens.length) {
    await traerDetalle(cands.filter(c => c.enCache).map(c => c.codigo));
    finales = [];
    for (const c of cands) {
      if (!c.enCache) { finales.push(c); continue; }
      const row = detalle.get(c.codigo);
      if (!row) continue;
      const items = parsearItems(row.items_json);
      const idx = indexarLicitacion({
        nombre: row.nombre || '', descripcion: row.descripcion || '',
        items: items.map(i => `${i.NombreProducto} ${i.Descripcion || ''}`).join(' '),
        categoria: items.map(i => i.Categoria || '').join(' '),
      });
      const r = evaluarKeyword(idx, consulta);
      if (!r.match) continue;
      c.score = r.score; c.fuentes = r.fuentes;
      finales.push(c);
    }
  }

  // ── Orden ─────────────────────────────────────────────────────────────────
  const orden = f.orden || (tokens.length ? 'relevancia' : 'fecha_publicacion_desc');
  const cmp: Record<string, (a: Cand, b: Cand) => number> = {
    relevancia: (a, b) => b.score - a.score || b.publ - a.publ,
    fecha_cierre_asc: (a, b) => (a.cierre || Infinity) - (b.cierre || Infinity),
    fecha_cierre_desc: (a, b) => b.cierre - a.cierre,
    fecha_publicacion_desc: (a, b) => b.publ - a.publ || b.cierre - a.cierre,
    monto_desc: (a, b) => b.monto - a.monto,
    monto_asc: (a, b) => a.monto - b.monto,
  };
  finales.sort(cmp[orden] || cmp.fecha_publicacion_desc);

  const total = finales.length;
  const pagina = finales.slice((f.pagina - 1) * f.porPagina, f.pagina * f.porPagina);

  // ── Detalle solo de la página ───────────────────────────────────────────
  await traerDetalle(pagina.filter(c => c.enCache && !detalle.has(c.codigo)).map(c => c.codigo));

  const licitaciones = pagina.map(c => {
    let lic: Licitacion;
    if (c.vivo) lic = c.vivo;
    else {
      const row = detalle.get(c.codigo)!;
      lic = filaALicitacion(row, parsearItems(row.items_json));
      const viva = vivas.get(c.codigo);
      if (viva?.FechaCierre) lic.FechaCierre = viva.FechaCierre;
    }
    return { lic: { ...lic, Estado: c.estado, EstadoNombre: c.estado } as Licitacion, score: c.score, fuentes: c.fuentes };
  });

  return { total, licitaciones };
}
