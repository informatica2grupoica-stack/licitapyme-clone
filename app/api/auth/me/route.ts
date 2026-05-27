// app/api/auth/me/route.ts
// Retorna el usuario de la sesión actual (para el cliente)
import { NextResponse } from 'next/server';
import { getSession } from '@/app/lib/auth';

export async function GET() {
  const usuario = await getSession();
  if (!usuario) {
    return NextResponse.json({ autenticado: false, usuario: null });
  }
  return NextResponse.json({ autenticado: true, usuario });
}
