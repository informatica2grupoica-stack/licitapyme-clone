// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { respuestaConSession, type UsuarioSession } from '@/app/lib/auth';
import { ipDeRequest, estaBloqueado, registrarIntento } from '@/app/lib/login-rate-limit';
import { registrarActividad } from '@/app/lib/actividad';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      );
    }

    const emailLimpio = email.toLowerCase().trim();
    const ip = ipDeRequest(request);

    // ── Protección de fuerza bruta (MySQL, sin Redis) ──────────────────────────
    // Antes de tocar la BD de usuarios, verificar que este email/IP no haya superado
    // el umbral de intentos fallidos recientes. Bloqueo temporal → 429.
    const bloqueo = await estaBloqueado(emailLimpio, ip);
    if (bloqueo.bloqueado) {
      return NextResponse.json(
        {
          error: `Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.`,
          code: 'RATE_LIMITED',
        },
        { status: 429, headers: { 'Retry-After': String(bloqueo.esperaMin * 60) } }
      );
    }

    // Buscar usuario
    const [rows] = await pool.query(
      'SELECT id, email, password_hash, nombre, empresa, rol, activo FROM usuarios WHERE email = ? LIMIT 1',
      [emailLimpio]
    );
    const usuarios = rows as any[];

    if (usuarios.length === 0) {
      await registrarIntento(emailLimpio, ip, false);
      return NextResponse.json(
        { error: 'Email o contraseña incorrectos' },
        { status: 401 }
      );
    }

    const u = usuarios[0];

    if (!u.activo) {
      return NextResponse.json(
        { error: 'Cuenta desactivada. Contacta al administrador.' },
        { status: 403 }
      );
    }

    // Verificar contraseña
    const coincide = await bcrypt.compare(password, u.password_hash);
    if (!coincide) {
      await registrarIntento(emailLimpio, ip, false);
      return NextResponse.json(
        { error: 'Email o contraseña incorrectos' },
        { status: 401 }
      );
    }

    // Login correcto → registrar éxito (resetea el contador de fallos del email).
    await registrarIntento(emailLimpio, ip, true);

    // Bitácora: quién y cuándo inició sesión (best-effort, nunca bloquea el login).
    registrarActividad({
      usuarioId: u.id, accion: 'login',
      descripcion: `Inició sesión (${u.email})`,
      metadata: { ip },
    });

    // Actualizar último login
    await pool.query(
      'UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?',
      [u.id]
    );

    const usuario: UsuarioSession = {
      id:      u.id,
      email:   u.email,
      nombre:  u.nombre,
      empresa: u.empresa,
      rol:     u.rol,
    };

    return respuestaConSession(usuario, {});
  } catch (error) {
    console.error('Error en login:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
