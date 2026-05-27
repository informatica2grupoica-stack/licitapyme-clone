// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { respuestaConSession, type UsuarioSession } from '@/app/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      );
    }

    // Buscar usuario
    const [rows] = await pool.query(
      'SELECT id, email, password_hash, nombre, empresa, rol, activo FROM usuarios WHERE email = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    const usuarios = rows as any[];

    if (usuarios.length === 0) {
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
      return NextResponse.json(
        { error: 'Email o contraseña incorrectos' },
        { status: 401 }
      );
    }

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
