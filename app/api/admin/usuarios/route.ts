// app/api/admin/usuarios/route.ts
// Solo accesible para admins (el middleware verifica el rol)
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';

// GET — listar todos los usuarios
export async function GET() {
  try {
    const [rows] = await pool.query(
      `SELECT id, email, nombre, empresa, rol, activo, ultimo_login, created_at
       FROM usuarios ORDER BY created_at DESC`
    );
    return NextResponse.json({ success: true, usuarios: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — crear usuario (admin lo crea directamente, sin auto-registro)
export async function POST(request: NextRequest) {
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

// PATCH — actualizar usuario (activar/desactivar, cambiar rol)
export async function PATCH(request: NextRequest) {
  try {
    const { id, activo, rol, nombre, empresa } = await request.json();

    if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 });

    const updates: string[] = [];
    const values: any[] = [];

    if (activo !== undefined) { updates.push('activo = ?'); values.push(activo); }
    if (rol !== undefined)    { updates.push('rol = ?');    values.push(rol); }
    if (nombre !== undefined) { updates.push('nombre = ?'); values.push(nombre || null); }
    if (empresa !== undefined){ updates.push('empresa = ?');values.push(empresa || null); }

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
