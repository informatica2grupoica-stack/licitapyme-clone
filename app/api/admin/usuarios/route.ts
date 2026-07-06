// app/api/admin/usuarios/route.ts
// Solo accesible para admins. El middleware (proxy.ts) ya bloquea /api/admin a no-admins,
// pero además verificamos el rol AQUÍ contra el JWT (defensa en profundidad: si el
// middleware se saltara, estas operaciones sensibles —crear/editar/resetear clave— no
// deben quedar expuestas).
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { esAdmin } from '@/app/lib/api-auth';

const NO_AUTORIZADO = () => NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 });

// GET — listar todos los usuarios
export async function GET(request: NextRequest) {
  if (!(await esAdmin(request))) return NO_AUTORIZADO();
  try {
    // Intentar con la columna permisos (migración 28); si no existe, sin ella.
    try {
      const [rows] = await pool.query(
        `SELECT id, email, nombre, empresa, rol, permisos, activo, ultimo_login, created_at
         FROM usuarios ORDER BY created_at DESC`
      );
      return NextResponse.json({ success: true, usuarios: rows });
    } catch (e: any) {
      if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;
      const [rows] = await pool.query(
        `SELECT id, email, nombre, empresa, rol, activo, ultimo_login, created_at
         FROM usuarios ORDER BY created_at DESC`
      );
      return NextResponse.json({ success: true, usuarios: rows });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — crear usuario (admin lo crea directamente, sin auto-registro)
export async function POST(request: NextRequest) {
  if (!(await esAdmin(request))) return NO_AUTORIZADO();
  try {
    const { email, password, nombre, empresa, rol } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 });
    }

    const emailLimpio = email.toLowerCase().trim();

    // Verificar duplicado
    const [existentes] = await pool.query(
      'SELECT id FROM usuarios WHERE email = ? LIMIT 1',
      [emailLimpio]
    );
    if ((existentes as any[]).length > 0) {
      return NextResponse.json({ error: 'El email ya está registrado' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [emailLimpio, passwordHash, nombre?.trim() || null, empresa?.trim() || null, rol || 'usuario']
    );

    return NextResponse.json({ success: true, id: (result as any).insertId }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — actualizar usuario (activar/desactivar, cambiar rol, editar datos,
// resetear contraseña). El admin puede fijar una clave nueva directamente (password).
export async function PATCH(request: NextRequest) {
  if (!(await esAdmin(request))) return NO_AUTORIZADO();
  try {
    const { id, activo, rol, nombre, empresa, permisos, email, password } = await request.json();

    if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 });

    const updates: string[] = [];
    const values: any[] = [];

    if (activo !== undefined) { updates.push('activo = ?'); values.push(activo); }
    if (rol !== undefined)    { updates.push('rol = ?');    values.push(rol); }
    if (nombre !== undefined) { updates.push('nombre = ?'); values.push(nombre || null); }
    if (empresa !== undefined){ updates.push('empresa = ?');values.push(empresa || null); }
    // Permisos granulares (JSON). Requiere migración 28.
    if (permisos !== undefined) { updates.push('permisos = ?'); values.push(permisos == null ? null : JSON.stringify(permisos)); }

    // Editar email (validar formato + unicidad).
    if (email !== undefined) {
      const emailLimpio = String(email).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpio)) {
        return NextResponse.json({ error: 'Email inválido' }, { status: 400 });
      }
      const [dup] = await pool.query('SELECT id FROM usuarios WHERE email = ? AND id <> ? LIMIT 1', [emailLimpio, id]);
      if ((dup as any[]).length > 0) {
        return NextResponse.json({ error: 'Ese email ya está en uso por otro usuario' }, { status: 409 });
      }
      updates.push('email = ?'); values.push(emailLimpio);
    }

    // Resetear contraseña (el admin fija una clave nueva).
    if (password !== undefined && password !== null && password !== '') {
      if (String(password).length < 8) {
        return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 });
      }
      const passwordHash = await bcrypt.hash(String(password), 12);
      updates.push('password_hash = ?'); values.push(passwordHash);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Sin campos para actualizar' }, { status: 400 });
    }

    values.push(id);
    await pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, values);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar usuario
export async function DELETE(request: NextRequest) {
  if (!(await esAdmin(request))) return NO_AUTORIZADO();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 });

    await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
