// app/api/cron/whatsapp-cola/route.ts — reintenta los avisos de WhatsApp que quedaron pendientes (emisor desconectado, servicio caído).
// Protección igual que los demás cron: Bearer <CRON_SECRET> · x-cron-secret.
import { igualSecreto } from '@/app/lib/cron-secret';
import { NextRequest, NextResponse } from 'next/server';
import { drenarCola } from '@/app/lib/whatsapp-avisos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return igualSecreto(secret, process.env.CRON_SECRET);
}

async function correr(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  return NextResponse.json({ success: true, ...(await drenarCola()) });
}
export const GET = correr;
export const POST = correr;
