// app/api/auth/restablecer/route.ts
// Paso 2 de la recuperación: valida el token del enlace y fija la contraseña nueva.
// GET  ?token=...  → { valido: boolean }  (para que la página muestre el form o el error).
// POST { token, password } → cambia la clave, marca el token como usado.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** Devuelve la fila del token si está viva (no usada, no vencida), o null. */
async function tokenVivo(token: string): Promise<{ id: number; usuario_id: number } | null> {
  if (!token || typeof token !== 'string') return null;
  const [rows] = await pool.query(
    `SELECT id, usuario_id FROM password_resets
     WHERE token_hash = ? AND usado_en IS NULL AND expira_en > NOW() LIMIT 1`,
    [hashToken(token)],
  );
  return (rows as any[])[0] || null;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const fila = await tokenVivo(token);
  return NextResponse.json({ valido: !!fila });
}

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 });
    }

    const fila = await tokenVivo(token);
    if (!fila) {
      return NextResponse.json({ error: 'El enlace no es válido o ya venció. Solicita uno nuevo.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Actualizar la clave y marcar el token como usado (un solo uso).
    await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, fila.usuario_id]);
    await pool.query('UPDATE password_resets SET usado_en = NOW() WHERE id = ?', [fila.id]);
    // Invalidar cualquier otro token pendiente del mismo usuario.
    await pool.query(
      'UPDATE password_resets SET usado_en = NOW() WHERE usuario_id = ? AND usado_en IS NULL',
      [fila.usuario_id],
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[restablecer] error:', String(e));
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
