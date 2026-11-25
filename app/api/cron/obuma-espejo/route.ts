// app/api/cron/obuma-espejo/route.ts
// Cron diario: actualiza el espejo de Obuma (obuma_registro) en modo RÁPIDO: solo lo nuevo o cambiado (un día tranquilo ≈ 10 llamadas). Sin IA.
// body.completo = true baja los listados enteros (~100 llamadas): solo para reconciliar a mano.
// Protección igual que los demás cron: x-vercel-cron:1 · Bearer <CRON_SECRET> · x-cron-secret.
// GET → estado por entidad (filas propias vs total de Obuma). POST → corre la sincronización (opcional body.entidades = ['venta', ...]).
import { igualSecreto } from '@/app/lib/cron-secret';
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { ENTIDADES_OBUMA, sincronizarEntidadObuma } from '@/app/lib/obuma-espejo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ORDEN = ['cliente', 'cobro_venta', 'producto', 'proveedor', 'gasto', 'compra_oc', 'venta', 'compra_dte', 'compra', 'pago_compra'];

function autorizado(req: NextRequest): boolean {
  if (process.env.VERCEL && req.headers.get('x-vercel-cron') === '1') return true;
  const secret = req.headers.get('x-cron-secret') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return igualSecreto(secret, process.env.CRON_SECRET);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const [rows] = await pool.query('SELECT entidad, total_obuma, filas_local, llamadas, ultima_sync, ultimo_error FROM obuma_sync_estado WHERE cliente_id = 1 ORDER BY entidad');
  return NextResponse.json({ entidades: rows });
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const pedidas: string[] | null = Array.isArray(body?.entidades) ? body.entidades : null;
  const t0 = Date.now();
  const resultados = [];
  for (const e of ORDEN.filter(x => ENTIDADES_OBUMA[x] && (!pedidas || pedidas.includes(x)))) {
    const r = await sincronizarEntidadObuma(e, 1, body?.completo === true ? 'completo' : 'rapido');
    resultados.push(r);
    if (r.error) break; // si Obuma falla o corta por límite, se reintenta en la próxima corrida
  }
  console.log(`[cron/obuma-espejo] ${resultados.map(r => `${r.entidad}:${r.filasLocal}/${r.totalObuma ?? '?'}`).join(' ')} en ${Date.now() - t0}ms`);
  return NextResponse.json({ success: !resultados.some(r => r.error), resultados, duracionMs: Date.now() - t0 });
}
