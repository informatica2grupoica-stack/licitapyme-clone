// app/api/cron/evaluar-empresas/route.ts — mueve la cola de evaluaciones por RUT de las empresas-cliente (migration-197).
// La llama el scheduler cada 5 min. Cada pasada trabaja hasta ~4 min y deja el avance guardado: si la app se reinicia a mitad,
// la próxima pasada sigue desde ahí. Responde { pendientes } para que el scheduler sepa si hay que dar otra pasada.
// Protección igual que los demás cron: Bearer <CRON_SECRET> · x-cron-secret.
import { igualSecreto } from '@/app/lib/cron-secret';
import { NextRequest, NextResponse } from 'next/server';
import { procesarColaEvaluaciones } from '@/app/lib/evaluar-empresa-rut';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return igualSecreto(secret, process.env.CRON_SECRET);
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const r = await procesarColaEvaluaciones();
  return NextResponse.json({ success: true, ...r, completado: r.pendientes === 0 });
}
