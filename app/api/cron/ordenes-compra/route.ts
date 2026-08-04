// app/api/cron/ordenes-compra/route.ts
// Cron diario: busca las órdenes de compra de las licitaciones que ya ofertamos, las guarda y
// avisa (campana + correo). Toda la lógica vive en app/lib/ordenes-compra.ts — acá solo va la
// autorización y el presupuesto de la corrida.
//
// POR QUÉ DIARIO Y NO CADA HORA: el barrido descarga el listado completo de un día (~16.000
// órdenes de todo Chile) porque la API no permite preguntar por una licitación concreta. Una orden
// de compra no aparece "en minutos": el organismo la emite cuando le toca, días o semanas después
// de la adjudicación. Correrlo una vez al día, con 3 días de ventana, cubre fines de semana y
// cualquier corrida caída sin descargar medio mes de listados al pedo.
//
// Protección igual que los demás cron: x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET  → estado (cuántas órdenes hay guardadas y de cuándo es la última).
// POST → corre la sincronización. Body/query: { dias?: number } (default 3, máximo 15).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { sincronizarOrdenesCompra } from '@/app/lib/ordenes-compra';
import { publicarCambio } from '@/app/lib/sse-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total, MAX(updated_at) AS ultima FROM ordenes_compra`,
    ) as any[];
    return NextResponse.json({ total: Number(rows[0]?.total || 0), ultima: rows[0]?.ultima || null });
  } catch (e: any) {
    return NextResponse.json({ total: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dias = Math.min(Math.max(Number(body.dias ?? req.nextUrl.searchParams.get('dias')) || 3, 1), 15);

  const t0 = Date.now();
  try {
    const r = await sincronizarOrdenesCompra({ dias });
    if (r.nuevas > 0 || r.cambiosEstado > 0) {
      console.log(`[cron/ordenes-compra] ${r.nuevas} nueva(s) · ${r.cambiosEstado} cambio(s) de estado · ${r.eventos} evento(s) · ${r.correos} correo(s)`);
      publicarCambio('orden-compra');   // la ficha de la licitación repinta el bloque al instante
    }
    return NextResponse.json({ success: true, ...r, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
