// src/app/api/test-db/route.ts
import { NextRequest, NextResponse } from 'next/server';
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

// Migración one-time: corregir URLs de R2 en documentos_cache
export async function POST(request: NextRequest) {
  const { secret } = await request.json();
  if (secret !== process.env.MIGRATION_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const oldPrefix = 'https://pub-f711e02bdfc1781b1b52bd57c9bca9ed.r2.dev';
  const newPrefix = process.env.R2_PUBLIC_URL || 'https://pub-722f3e1c29d74bcb8ee49776fe8a2c0d.r2.dev';
  const [result]: any = await pool.query(
    `UPDATE documentos_cache SET documento_url_local = REPLACE(documento_url_local, ?, ?) WHERE documento_url_local LIKE ?`,
    [oldPrefix, newPrefix, `${oldPrefix}%`]
  );
  return NextResponse.json({ updated: result.affectedRows, newPrefix });
}