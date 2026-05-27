// middleware.ts — Protección de rutas con JWT
// Rutas públicas: /login, /registro, /api/auth/*
// Todo lo demás requiere sesión válida

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/app/lib/auth';

// Rutas que NO requieren autenticación
const RUTAS_PUBLICAS = [
  '/login',
  '/registro',
  '/api/auth/login',
  '/api/auth/registro',
  '/api/auth/me',
  '/_next',
  '/favicon.ico',
  '/public',
];

// Rutas solo para admin
const RUTAS_ADMIN = [
  '/admin',
  '/api/admin',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Permitir rutas públicas y assets
  if (RUTAS_PUBLICAS.some(r => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Verificar sesión
  const usuario = await getSessionFromRequest(request);

  if (!usuario) {
    // API routes: responder 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'No autenticado. Inicia sesión para continuar.' },
        { status: 401 }
      );
    }
    // Páginas: redirigir a login con returnUrl
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Rutas admin: verificar rol
  if (RUTAS_ADMIN.some(r => pathname.startsWith(r)) && usuario.rol !== 'admin') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Si está logueado y va a /login o /registro, redirigir al inicio
  if (pathname === '/login' || pathname === '/registro') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Inyectar userId en headers para que las API routes lo lean
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', String(usuario.id));
  requestHeaders.set('x-user-email', usuario.email);
  requestHeaders.set('x-user-rol', usuario.rol);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Ejecutar en todas las rutas EXCEPTO:
     * - _next/static (archivos estáticos)
     * - _next/image (optimización de imágenes)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
