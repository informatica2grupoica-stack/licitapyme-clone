// app/api/auth/perfil/route.ts
// Actualizar nombre, empresa y/o contraseña del usuario en sesión
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { SignJWT } from 'jose';

const EXPIRY_SECONDS = 60 * 60 * 24 * 7;

export async function PATCH(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const id = parseInt(userId, 10);

    const { nombre, empresa, passwordActual, passwordNuevo } = await request.json();

    const updates: string[] = [];
    const values: any[] = [];

    if (nombre !== undefined) { updates.push('nombre = ?'); values.push(nombre?.trim() || null); }
    if (empresa !== undefined) { updates.push('empresa = ?'); values.push(empresa?.trim() || null); }

    if (passwordNuevo) {
      if (!passwordActual) return NextResponse.json({ error: 'Se requiere la contraseña actual' }, { status: 400 });
      if (passwordNuevo.length < 8) return NextResponse.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' }, { status: 400 });

      const [rows] = await pool.query('SELECT password_hash FROM usuarios WHERE id = ? LIMIT 1', [id]);
      const u = (rows as any[])[0];
      if (!u || !await bcrypt.compare(passwordActual, u.password_hash)) {
        return NextResponse.json({ error: 'Contraseña actual incorrecta' }, { status: 400 });
      }

      const nuevoHash = await bcrypt.hash(passwordNuevo, 12);
      updates.push('password_hash = ?');
      values.push(nuevoHash);
    }

    if (updates.length === 0) return NextResponse.json({ error: 'Sin cambios para guardar' }, { status: 400 });

    values.push(id);
    await pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, values);

    // Obtener usuario actualizado para renovar el token
    const [rows] = await pool.query('SELECT id, email, nombre, empresa, rol FROM usuarios WHERE id = ? LIMIT 1', [id]);
    const u = (rows as any[])[0];
    if (!u) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const token = await new SignJWT({ userId: u.id, email: u.email, nombre: u.nombre, empresa: u.empresa, rol: u.rol })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${EXPIRY_SECONDS}s`).sign(secret);
    const response = NextResponse.json({ success: true, usuario: { id: u.id, email: u.email, nombre: u.nombre, empresa: u.empresa, rol: u.rol }, mensaje: 'Perfil actualizado' });
    response.cookies.set('licitapyme_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: EXPIRY_SECONDS,
      path: '/',
    });
    return response;
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
