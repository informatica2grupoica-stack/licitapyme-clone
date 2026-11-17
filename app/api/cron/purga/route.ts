// app/api/cron/purga/route.ts — retención de tablas que crecen sin límite (ver app/lib/purga.ts). El scheduler la llama 1×/día.
// Sin PURGA_ACTIVA=1 solo simula (cuenta lo que borraría). Protección igual que los demás cron: Bearer <CRON_SECRET> · x-cron-secret.
import { igualSecreto } from '@/app/lib/cron-secret';
import { NextRequest, NextResponse } from 'next/server';
import { ejecutarPurga } from '@/app/lib/purga';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return igualSecreto(secret, process.env.CRON_SECRET);
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const resultado = await ejecutarPurga();
  console.log('[purga]', JSON.stringify(resultado));
  return NextResponse.json({ success: true, completado: true, resultado });
}
