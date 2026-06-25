// app/api/auth/me/route.ts
// Retorna el usuario de la sesión actual (para el cliente)
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verificarToken } from '@/app/lib/auth-edge';
import { permisosDeUsuario } from '@/app/lib/api-auth';

export const runtime = 'nodejs';

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
    const permisos = await permisosDeUsuario(payload.userId as number, payload.rol as string);
    return NextResponse.json({
      autenticado: true,
      usuario: {
        id:      payload.userId,
        email:   payload.email,
        nombre:  payload.nombre,
        empresa: payload.empresa,
        rol:     payload.rol,
        permisos,
      },
    });
  } catch {
    return NextResponse.json({ autenticado: false, usuario: null });
  }
}
