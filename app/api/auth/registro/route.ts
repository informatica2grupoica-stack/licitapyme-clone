// app/api/auth/registro/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { respuestaConSession, type UsuarioSession } from '@/app/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password, nombre, empresa } = await request.json();

    // Validaciones
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      );
    }

    const emailLimpio = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLimpio)) {
      return NextResponse.json({ error: 'Email inválido' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 8 caracteres' },
        { status: 400 }
      );
    }

    // Verificar si el email ya existe
    const [existentes] = await pool.query(
      'SELECT id FROM usuarios WHERE email = ? LIMIT 1',
      [emailLimpio]
    );
    if ((existentes as any[]).length > 0) {
      return NextResponse.json(
        { error: 'Ya existe una cuenta con ese email' },
        { status: 409 }
      );
    }

    // Hash de contraseña (12 rounds = seguro y aceptablemente rápido)
    const passwordHash = await bcrypt.hash(password, 12);

    // Insertar usuario
    const [result] = await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo)
       VALUES (?, ?, ?, ?, 'usuario', TRUE)`,
      [emailLimpio, passwordHash, nombre?.trim() || null, empresa?.trim() || null]
    );

    const insertId = (result as any).insertId;

    const usuario: UsuarioSession = {
      id:      insertId,
      email:   emailLimpio,
      nombre:  nombre?.trim() || null,
      empresa: empresa?.trim() || null,
      rol:     'usuario',
    };

    return respuestaConSession(usuario, {}, 201);
  } catch (error) {
    console.error('Error en registro:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
