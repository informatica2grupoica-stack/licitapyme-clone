// src/app/hooks/useFavorites.ts
import { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/app/lib/session-context';

interface Favorite {
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

export function useFavorites() {
  const { usuario } = useSession();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesData, setFavoritesData] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  // Función corregida que siempre retorna un objeto válido para headers
  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (usuario?.id) {
      headers['x-user-id'] = String(usuario.id);
      headers['x-user-rol'] = usuario.rol || 'usuario';
    }
    return headers;
  }, [usuario?.id, usuario?.rol]);

  const loadFavorites = useCallback(async () => {
    if (!usuario?.id) {
      setFavorites(new Set());
      setFavoritesData([]);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/favorites', {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success && data.favorites) {
        const favSet = new Set<string>(data.favorites.map((f: Favorite) => f.codigo));
        setFavorites(favSet);
        setFavoritesData(data.favorites);
      }
    } catch (error) {
      console.error('Error al cargar favoritos:', error);
    } finally {
      setLoading(false);
    }
  }, [usuario?.id, getAuthHeaders]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const addFavorite = useCallback(async (licitacion: Favorite) => {
    if (!usuario?.id) {
      console.warn('Usuario no autenticado');
      return false;
    }

    try {
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(licitacion)
      });
      
      if (response.ok) {
        setFavorites(prev => new Set([...prev, licitacion.codigo]));
        loadFavorites();
        return true;
      }
      
      const error = await response.json();
      console.error('Error response:', error);
      return false;
    } catch (error) {
      console.error('Error al agregar favorito:', error);
      return false;
    }
  }, [usuario?.id, getAuthHeaders, loadFavorites]);

  const removeFavorite = useCallback(async (codigo: string) => {
    if (!usuario?.id) {
      console.warn('Usuario no autenticado');
      return false;
    }

    try {
      const response = await fetch(`/api/favorites?codigo=${encodeURIComponent(codigo)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      
      if (response.ok) {
        setFavorites(prev => {
          const newSet = new Set(prev);
          newSet.delete(codigo);
          return newSet;
        });
        setFavoritesData(prev => prev.filter(f => f.codigo !== codigo));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error al eliminar favorito:', error);
      return false;
    }
  }, [usuario?.id, getAuthHeaders]);

  const toggleFavorite = useCallback(async (licitacion: Favorite) => {
    if (!usuario?.id) {
      console.warn('Usuario no autenticado');
      return false;
    }

    if (favorites.has(licitacion.codigo)) {
      return await removeFavorite(licitacion.codigo);
    } else {
      return await addFavorite(licitacion);
    }
  }, [favorites, addFavorite, removeFavorite, usuario?.id]);

  const isFavorite = useCallback((codigo: string) => {
    return favorites.has(codigo);
  }, [favorites]);

  const getFavoriteData = useCallback((codigo: string) => {
    return favoritesData.find(f => f.codigo === codigo);
  }, [favoritesData]);

  return {
    favorites,
    favoritesData,
    loading,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
    getFavoriteData,
    reloadFavorites: loadFavorites
  };
}