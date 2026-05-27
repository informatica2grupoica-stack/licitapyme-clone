// app/api/auth/perfil/route.ts
// Actualizar nombre, empresa y/o contraseña del usuario en sesión
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { getSession, respuestaConSession, type UsuarioSession } from '@/app/lib/auth';

export async function PATCH(request: NextRequest) {
  try {
    const sesion = await getSession();
    if (!sesion) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { nombre, empresa, passwordActual, passwordNuevo } = await request.json();

    const updates: string[] = [];
    const values: any[] = [];

    if (nombre !== undefined) { updates.push('nombre = ?'); values.push(nombre?.trim() || null); }
    if (empresa !== undefined){ updates.push('empresa = ?');values.push(empresa?.trim() || null); }

    // Cambio de contraseña
    if (passwordNuevo) {
      if (!passwordActual) {
        return NextResponse.json({ error: 'Se requiere la contraseña actual' }, { status: 400 });
      }
      if (passwordNuevo.length < 8) {
        return NextResponse.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' }, { status: 400 });
      }

      // Verificar contraseña actual
      const [rows] = await pool.query(
        'SELECT password_hash FROM usuarios WHERE id = ? LIMIT 1',
        [sesion.id]
      );
      const u = (rows as any[])[0];
      if (!u || !await bcrypt.compare(passwordActual, u.password_hash)) {
        return NextResponse.json({ error: 'Contraseña actual incorrecta' }, { status: 400 });
      }

      const nuevoHash = await bcrypt.hash(passwordNuevo, 12);
      updates.push('password_hash = ?');
      values.push(nuevoHash);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Sin cambios para guardar' }, { status: 400 });
    }

    values.push(sesion.id);
    await pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, values);

    // Actualizar la sesión con los nuevos datos
    const usuarioActualizado: UsuarioSession = {
      ...sesion,
      nombre: nombre?.trim() || sesion.nombre,
      empresa: empresa?.trim() || sesion.empresa,
    };

    return respuestaConSession(usuarioActualizado, { mensaje: 'Perfil actualizado' });
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
