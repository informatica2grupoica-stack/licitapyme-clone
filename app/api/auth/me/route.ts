// app/api/auth/me/route.ts
// Retorna el usuario de la sesión actual (para el cliente)
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verificarToken } from '@/app/lib/auth-edge';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';

// Frente C.1: ¿este perfil ve la vista resumida de viabilidad por defecto? Tolerante a que
// la migración 56 aún no esté aplicada (columna ausente) — en ese caso, false (vista completa,
// el comportamiento de siempre).
async function leerModoPrincipiante(userId: number): Promise<boolean> {
  try {
    const [rows] = await pool.query('SELECT modo_principiante FROM usuarios WHERE id = ? LIMIT 1', [userId]);
    return !!(rows as any[])[0]?.modo_principiante;
  } catch {
    return false;
  }
}

// Datos de contacto para el aviso "completa tu perfil" y el avatar. Tolerante a que la
// migración 125 aún no esté aplicada (columnas ausentes): en ese caso no hay aviso.
async function leerContacto(userId: number) {
  try {
    const [rows] = await pool.query('SELECT telefono, cargo, foto IS NOT NULL AS tiene_foto FROM usuarios WHERE id = ? LIMIT 1', [userId]);
    const r = (rows as any[])[0];
    return { telefono: r?.telefono ?? null, cargo: r?.cargo ?? null, tieneFoto: !!r?.tiene_foto, perfilPendiente: !r?.telefono };
  } catch {
    return { telefono: null, cargo: null, tieneFoto: false, perfilPendiente: false };
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('licitapyme_session')?.value;
    if (!token) {
      return NextResponse.json({ autenticado: false, usuario: null });
    }
    const payload = await verificarToken(token);
    if (!payload) {
      return NextResponse.json({ autenticado: false, usuario: null });
    }
    // Permisos efectivos: admin → todos; usuario → los que el admin le otorgó.
    const [permisos, modoPrincipiante, contacto] = await Promise.all([
      permisosDeUsuario(payload.userId as number, payload.rol as string),
      leerModoPrincipiante(payload.userId as number),
      leerContacto(payload.userId as number),
    ]);
    return NextResponse.json({
      autenticado: true,
      usuario: {
        id:      payload.userId,
        email:   payload.email,
        nombre:  payload.nombre,
        empresa: payload.empresa,
        rol:     payload.rol,
        permisos,
        modoPrincipiante,
        ...contacto,
      },
    });
  } catch {
    return NextResponse.json({ autenticado: false, usuario: null });
  }
}
