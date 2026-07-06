// app/api/auth/recuperar/route.ts
// Paso 1 de la recuperación de contraseña (autoservicio desde el login).
// El usuario envía su email → si existe una cuenta activa, se genera un token de un
// solo uso (se guarda su HASH), y se envía el enlace por correo. La respuesta es
// SIEMPRE la misma (éxito genérico) para no revelar qué emails existen.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import pool from '@/app/lib/db';
import { enviarCorreoRecuperacion } from '@/app/lib/email';
import { ipDeRequest, estaBloqueado, registrarIntento } from '@/app/lib/login-rate-limit';

export const runtime = 'nodejs';

const VIGENCIA_MIN = 30; // minutos de validez del enlace

export async function POST(request: NextRequest) {
  // Respuesta genérica: nunca revela si el email existe (anti-enumeración).
  const ok = () => NextResponse.json({
    success: true,
    message: 'Si el correo corresponde a una cuenta, te enviamos un enlace para restablecer tu contraseña.',
  });

  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') return ok();

    const emailLimpio = email.toLowerCase().trim();
    const ip = ipDeRequest(request);

    // Reusar el rate-limit del login para frenar abuso del envío de correos.
    const bloqueo = await estaBloqueado(emailLimpio, ip);
    if (bloqueo.bloqueado) return ok(); // silencioso: misma respuesta genérica

    const [rows] = await pool.query(
      'SELECT id, email, nombre, activo FROM usuarios WHERE email = ? LIMIT 1',
      [emailLimpio],
    );
    const u = (rows as any[])[0];

    // Cuenta inexistente o desactivada → respuesta genérica, sin enviar nada.
    if (!u || !u.activo) {
      await registrarIntento(emailLimpio, ip, false);
      return ok();
    }

    // Token aleatorio: se envía en claro por correo; en BD solo su hash.
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Invalidar tokens previos sin usar de este usuario (un enlace vivo a la vez).
    await pool.query(
      'UPDATE password_resets SET usado_en = NOW() WHERE usuario_id = ? AND usado_en IS NULL',
      [u.id],
    );
    await pool.query(
      `INSERT INTO password_resets (usuario_id, token_hash, expira_en, ip)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
      [u.id, tokenHash, VIGENCIA_MIN, ip],
    );

    const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    const url = `${base}/restablecer?token=${token}`;

    await enviarCorreoRecuperacion({
      to: u.email, nombre: u.nombre, url, vigenciaMin: VIGENCIA_MIN,
    });

    return ok();
  } catch (e) {
    console.error('[recuperar] error:', String(e));
    return ok(); // aun ante error, respuesta genérica (no filtrar estado interno)
  }
}
