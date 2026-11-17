// app/api/health/route.ts — «¿la app está viva y llega a su base de datos?». Pública a propósito (la usan el healthcheck de Docker y deploy.sh).
// Solo devuelve dos booleanos: nada de versiones, hosts ni errores.
import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let db = false;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    db = true;
  } catch { /* db = false */ }
  return NextResponse.json({ ok: db, db }, { status: db ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
