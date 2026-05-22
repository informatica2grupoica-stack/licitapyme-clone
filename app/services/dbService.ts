// src/services/dbService.ts
import pool from '@/app/lib/db';

export interface SearchHistory {
  id?: number;
  query: string;
  filters?: string;
  results_count: number;
  ip_address?: string;
  created_at?: Date;
}

export interface Favorite {
  id?: number;
  codigo: string;
  nombre: string;
  organismo: string;
  monto_total?: number;
  monto_estimado?: number;
  moneda?: string;
  fecha_cierre?: string;
  fecha_adjudicacion?: string;
  estado?: string;
  tipo_licitacion?: string;
  tipo_convocatoria?: string;
  region?: string;
  comuna?: string;
  descripcion?: string;
  resumen_ia?: string;
  detail_url?: string;
  search_url?: string;
  semantic_score?: number;
  final_score?: number;
  created_at?: Date;
}

// Guardar historial de búsqueda
export async function saveSearchHistory(history: SearchHistory): Promise<number> {
  const [result] = await pool.query(
    `INSERT INTO search_history (query, filters, results_count, ip_address) 
     VALUES (?, ?, ?, ?)`,
    [history.query, history.filters || null, history.results_count, history.ip_address || null]
  );
  return (result as any).insertId;
}

// Obtener historial de búsquedas
export async function getSearchHistory(limit: number = 10): Promise<SearchHistory[]> {
  const [rows] = await pool.query(
    `SELECT * FROM search_history ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows as SearchHistory[];
}

// Guardar favorito (versión completa con todos los campos)
export async function addFavorite(licitacion: Favorite): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO favorites (
        codigo, nombre, organismo, monto_total, monto_estimado, moneda,
        fecha_cierre, fecha_adjudicacion, estado, tipo_licitacion, 
        tipo_convocatoria, region, comuna, descripcion, resumen_ia,
        detail_url, search_url, semantic_score, final_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        nombre = VALUES(nombre),
        organismo = VALUES(organismo),
        monto_total = VALUES(monto_total),
        monto_estimado = VALUES(monto_estimado),
        moneda = VALUES(moneda),
        estado = VALUES(estado),
        fecha_adjudicacion = VALUES(fecha_adjudicacion),
        tipo_licitacion = VALUES(tipo_licitacion),
        tipo_convocatoria = VALUES(tipo_convocatoria),
        region = VALUES(region),
        comuna = VALUES(comuna),
        descripcion = VALUES(descripcion),
        resumen_ia = VALUES(resumen_ia),
        detail_url = VALUES(detail_url),
        search_url = VALUES(search_url),
        semantic_score = VALUES(semantic_score),
        final_score = VALUES(final_score)`,
      [
        licitacion.codigo, 
        licitacion.nombre, 
        licitacion.organismo,
        licitacion.monto_total || null, 
        licitacion.monto_estimado || null, 
        licitacion.moneda || 'CLP',
        licitacion.fecha_cierre || null, 
        licitacion.fecha_adjudicacion || null, 
        licitacion.estado || null,
        licitacion.tipo_licitacion || null, 
        licitacion.tipo_convocatoria || null,
        licitacion.region || null, 
        licitacion.comuna || null, 
        licitacion.descripcion || null, 
        licitacion.resumen_ia || null,
        licitacion.detail_url || null, 
        licitacion.search_url || null, 
        licitacion.semantic_score || null, 
        licitacion.final_score || null
      ]
    );
    return true;
  } catch (error) {
    console.error('Error al guardar favorito:', error);
    return false;
  }
}

// Eliminar favorito
export async function removeFavorite(codigo: string): Promise<boolean> {
  try {
    await pool.query(`DELETE FROM favorites WHERE codigo = ?`, [codigo]);
    return true;
  } catch (error) {
    console.error('Error al eliminar favorito:', error);
    return false;
  }
}

// Obtener favoritos
export async function getFavorites(): Promise<Favorite[]> {
  const [rows] = await pool.query(
    `SELECT * FROM favorites ORDER BY created_at DESC`
  );
  return rows as Favorite[];
}

// Verificar si es favorito
export async function isFavorite(codigo: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1 FROM favorites WHERE codigo = ? LIMIT 1`,
    [codigo]
  );
  return (rows as any[]).length > 0;
}