// app/api/push/registrar/route.ts
// App móvil: registra (POST) o quita (DELETE) el «Expo push token» de un teléfono para la persona que inició sesión.
// El usuario y la empresa salen de la sesión, nunca del body. Un token es de un solo teléfono: si otra persona
// entra en ese teléfono, el token pasa a ella.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { mensajeSeguro } from '@/app/lib/errores-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_VALIDO = /^Expo(nent)?PushToken\[[^\]]{10,200}\]$/;

export async function POST(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({} as { token?: string; plataforma?: string }));
    const token = String(body.token ?? '').trim();
    if (!TOKEN_VALIDO.test(token)) return NextResponse.json({ error: 'Token de aviso inválido' }, { status: 400 });
    const plataforma = String(body.plataforma ?? '').slice(0, 16) || null;
    const ahora = ahoraChileSQL();
    await pool.query(
      `INSERT INTO push_tokens (cliente_id, usuario_id, token, plataforma, created_at, updated_at)
       VALUES (COALESCE((SELECT cliente_id FROM usuarios WHERE id = ?), 1), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), cliente_id = VALUES(cliente_id), plataforma = VALUES(plataforma), updated_at = VALUES(updated_at)`,
      [u.id, u.id, token, plataforma, ahora, ahora],
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo registrar el teléfono.') }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({} as { token?: string }));
    const token = String(body.token ?? '').trim();
    if (!token) return NextResponse.json({ error: 'Falta el token' }, { status: 400 });
    // Solo borra el token si es de quien lo pide: nadie puede desregistrar el teléfono de otro.
    await pool.query('DELETE FROM push_tokens WHERE token = ? AND usuario_id = ?', [token, u.id]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo quitar el teléfono.') }, { status: 500 });
  }
}
