// proxy.ts — Protección de rutas con JWT (Next.js 16: antes se llamaba middleware.ts)
// IMPORTANTE: Solo importar desde auth-edge.ts (Edge-compatible, sin next/headers)
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/app/lib/auth-edge';

// Rutas que NO requieren autenticación
const RUTAS_PUBLICAS = [
  '/login',
  '/recuperar',                 // solicitar recuperación de contraseña
  '/restablecer',               // fijar la contraseña nueva con el token del correo
  '/api/auth/login',
  '/api/auth/recuperar',        // envía el enlace de reseteo
  '/api/auth/restablecer',      // valida el token y cambia la clave
  '/api/auth/me',
  '/api/auth/logout',
  '/api/pdf-pagina',     // render de una página a PNG; solo PDFs ya públicos en R2/MercadoPúblico (anti-SSRF propio)
  '/api/cron/',          // cron job protegido con su propio secret
  '/api/admin/prefiltro', // prefiltro masivo protegido con CRON_SECRET
  '/api/admin/clasificar-test', // TEMPORAL: prueba clasificador, protegido con CRON_SECRET
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

// Rol EXTERNO (trabajador externo): acceso MUY restringido.
//  · Páginas permitidas: solo "Mis licitaciones" y el detalle de una licitación (+ su perfil).
//  · APIs bloqueadas: las agregadas/administrativas (radar, dashboard, buscador, historial global…).
// El resto de APIs (negocios, licitación, documentos, chat, notificaciones propias) pasa, y la
// autorización POR LICITACIÓN se reverifica en cada endpoint con puedeVerLicitacion().
const EXTERNO_PAGINAS_OK = ['/negocios', '/licitacion/', '/perfil'];
const EXTERNO_API_BLOQUEADAS = [
  '/api/dashboard', '/api/alertas', '/api/radar', '/api/analizadas',
  '/api/search', '/api/palabras-clave', '/api/prefiltro', '/api/favorites',
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Ignorar assets y archivos estáticos
  if (PREFIJOS_IGNORAR.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Permitir rutas públicas
  if (RUTAS_PUBLICAS.some(r => pathname.startsWith(r))) {
    // Si ya tiene sesión e intenta ir al login → redirigir al dashboard
    if (pathname === '/login') {
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

  // Rol EXTERNO: encerrar en "Mis licitaciones" + su detalle.
  if (usuario.rol === 'externo') {
    if (pathname.startsWith('/api/')) {
      if (EXTERNO_API_BLOQUEADAS.some(r => pathname.startsWith(r))) {
        return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
      }
    } else if (!EXTERNO_PAGINAS_OK.some(r => pathname.startsWith(r))) {
      // Cualquier página fuera del whitelist (dashboard, radar, buscador…) → sus licitaciones.
      return NextResponse.redirect(new URL('/negocios', request.url));
    }
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
