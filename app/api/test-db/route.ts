// src/app/api/test-db/route.ts
import { NextResponse } from 'next/server';
import pool, { testConnection } from '@/app/lib/db';
import { saveSearchHistory, getSearchHistory, getFavorites, addFavorite } from '@/app/services/dbService';

export async function GET() {
  const results: any = {};

  // Probar conexión básica
  results.connection = await testConnection();

  if (results.connection) {
    // Probar guardar historial
    const historyId = await saveSearchHistory({
      query: 'prueba',
      results_count: 5,
      ip_address: '127.0.0.1'
    });
    results.historySaved = historyId;

    // Probar obtener historial
    const history = await getSearchHistory(5);
    results.history = history;

    // Probar favoritos
    await addFavorite({
      codigo: 'TEST-123',
      nombre: 'Licitación de prueba',
      organismo: 'Bluehost Test',
      monto_total: 1000000,
      fecha_cierre: new Date().toISOString(),
      estado: '5'
    });
    
    results.favorites = await getFavorites();
  }

  return NextResponse.json(results);
}