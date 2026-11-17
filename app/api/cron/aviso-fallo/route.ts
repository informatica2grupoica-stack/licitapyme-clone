// app/api/cron/aviso-fallo/route.ts — el scheduler avisa aquí cuando un job automático lleva varias corridas seguidas fallando.
// Deja una notificación en la campana de cada admin de Grupo ICA (quienes operan la plataforma). Antes un job caído solo escribía en el log.
// Protección igual que los demás cron: Bearer <CRON_SECRET> · x-cron-secret.
import { igualSecreto } from '@/app/lib/cron-secret';
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { CLIENTE_ICA } from '@/app/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function autorizado(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return igualSecreto(secret, process.env.CRON_SECRET);
}

const limpiar = (v: unknown, max: number) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const job = limpiar(body?.job, 80) || 'desconocido';
  const fallas = Math.max(1, Math.min(9999, Number(body?.fallas) || 1));
  const detalle = limpiar(body?.detalle, 200);

  const [admins] = await pool.query(
    `SELECT id, nombre FROM usuarios WHERE rol = 'admin' AND activo = 1 AND cliente_id = ?`, [CLIENTE_ICA],
  ) as any;
  const mensaje = `Automatización con problemas: «${job}» falló ${fallas} veces seguidas.${detalle ? ` Último error: ${detalle}` : ''}`;
  let avisados = 0;
  for (const a of admins as Array<{ id: number; nombre: string | null }>) {
    const id = await registrarEvento({
      tipo: 'FALLO_AUTOMATICO', usuarioId: a.id, usuarioNombre: a.nombre, mensaje,
      metadata: { job, fallas, url: '/admin' },
    });
    if (id) avisados++;
  }
  return NextResponse.json({ success: true, avisados });
}
