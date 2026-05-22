// src/app/hooks/useFavorites.ts
import { useState, useEffect, useCallback } from 'react';

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
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesData, setFavoritesData] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const response = await fetch('/api/favorites');
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
  };

  const addFavorite = useCallback(async (licitacion: Favorite) => {
    try {
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(licitacion)
      });
      
      if (response.ok) {
        setFavorites(prev => new Set([...prev, licitacion.codigo]));
        await loadFavorites(); // Recargar datos completos
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error al agregar favorito:', error);
      return false;
    }
  }, []);

  const removeFavorite = useCallback(async (codigo: string) => {
    try {
      const response = await fetch(`/api/favorites?codigo=${codigo}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setFavorites(prev => {
          const newSet = new Set(prev);
          newSet.delete(codigo);
          return newSet;
        });
        await loadFavorites();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error al eliminar favorito:', error);
      return false;
    }
  }, []);

  const toggleFavorite = useCallback(async (licitacion: Favorite) => {
    if (favorites.has(licitacion.codigo)) {
      return await removeFavorite(licitacion.codigo);
    } else {
      return await addFavorite(licitacion);
    }
  }, [favorites, addFavorite, removeFavorite]);

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