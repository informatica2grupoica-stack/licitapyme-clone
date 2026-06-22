// app/api/auth/me/route.ts
// Retorna el usuario de la sesión actual (para el cliente)
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verificarToken } from '@/app/lib/auth-edge';

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
    return NextResponse.json({
      autenticado: true,
      usuario: {
        id:      payload.userId,
        email:   payload.email,
        nombre:  payload.nombre,
        empresa: payload.empresa,
        rol:     payload.rol,
      },
    });
  } catch {
    return NextResponse.json({ autenticado: false, usuario: null });
  }
}
