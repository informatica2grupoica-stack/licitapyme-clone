// proxy.ts — Protección de rutas con JWT (Next.js 16: antes se llamaba middleware.ts)
// IMPORTANTE: Solo importar desde auth-edge.ts (Edge-compatible, sin next/headers)
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/app/lib/auth-edge';

// Rutas que NO requieren autenticación
const RUTAS_PUBLICAS = [
  '/login',
  '/registro',
  '/api/auth/login',
  '/api/auth/registro',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/cron/',   // cron job protegido con su propio secret
];

// Prefijos de rutas que NUNCA deben ser interceptados
const PREFIJOS_IGNORAR = [
  '/_next/',
  '/favicon.ico',
  '/public/',
  '/images/',
  '/icons/',
];

// Rutas solo para admin
const RUTAS_ADMIN = ['/admin', '/api/admin'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Ignorar assets y archivos estáticos
  if (PREFIJOS_IGNORAR.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Permitir rutas públicas
  if (RUTAS_PUBLICAS.some(r => pathname.startsWith(r))) {
    // Si ya tiene sesión e intenta ir a login/registro → redirigir al dashboard
    if (pathname === '/login' || pathname === '/registro') {
      const usuario = await getSessionFromRequest(request);
      if (usuario) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }
    return NextResponse.next();
  }

  // Verificar sesión para todas las demás rutas
  const usuario = await getSessionFromRequest(request);

  if (!usuario) {
    // API routes → responder 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'No autenticado. Inicia sesión para continuar.', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }
    // Páginas → redirigir a login conservando la URL de destino
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Rutas admin: verificar rol
  if (RUTAS_ADMIN.some(r => pathname.startsWith(r)) && usuario.rol !== 'admin') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Inyectar datos del usuario en headers para que las API routes los lean
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id',    String(usuario.id));
  requestHeaders.set('x-user-email', usuario.email);
  requestHeaders.set('x-user-rol',   usuario.rol);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
