// proxy.ts — Protección de rutas con JWT (Next.js 16: antes se llamaba middleware.ts)
// IMPORTANTE: Solo importar desde auth-edge.ts (Edge-compatible, sin next/headers)
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/app/lib/auth-edge';
import { estadoVigente } from '@/app/lib/rol-vigente';
import { sesionRevocada } from '@/app/lib/sesiones-revocadas';
import { fichaCliente, negocioEsDeCliente } from '@/app/lib/tenant';
import { rutaPermitida, moduloDeRuta } from '@/app/lib/modulos';
import { permisosDeUsuario, type Permiso } from '@/app/lib/api-auth';
import { publicarCambio } from '@/app/lib/sse-bus';

// Rutas que NO requieren autenticación
const RUTAS_PUBLICAS = [
  '/bienvenida',                // landing pública de presentación (antes del login)
  '/privacidad',                // política de privacidad (Ley 21.719): pública
  '/terminos',                  // términos y condiciones: públicos
  '/login',
  '/recuperar',               // solicitar recuperación de contraseña
  '/restablecer',               // fijar la contraseña nueva con el token del correo
  '/api/health',                // healthcheck de Docker y deploy.sh: solo ok/db, sin datos
  '/api/auth/login',
  '/api/auth/recuperar',        // envía el enlace de reseteo
  '/api/auth/restablecer',      // valida el token y cambia la clave
  '/api/auth/me',
  '/api/auth/logout',
  '/api/cron/',          // cron job protegido con su propio secret
  '/api/admin/prefiltro', // prefiltro masivo protegido con CRON_SECRET
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

// Rutas de administración que un perfil NO admin puede usar si tiene el permiso (23-nov-2026, menú de privilegios).
// Lo que no figura aquí (clientes, prefiltro…) sigue siendo solo para admin.
const PERMISO_DE_RUTA_ADMIN: Array<[RegExp, Permiso]> = [
  [/^\/(api\/)?admin\/usuarios(\/|$)/, 'admin_usuarios'],
  [/^\/api\/admin\/whatsapp\/avisos(\/|$)/, 'admin_usuarios'],
  [/^\/admin\/etiquetas(\/|$)/, 'admin_etiquetas'],
  [/^\/(api\/)?admin\/(errores|reportes-error|gasto-ia|test-email|whatsapp)(\/|$)/, 'soporte_tecnico'],
];

// Rol EXTERNO (trabajador externo): acceso MUY restringido.
//  · Páginas permitidas: solo "Mis licitaciones" y el detalle de una licitación (+ su perfil).
//  · APIs bloqueadas: las agregadas/administrativas (radar, dashboard, buscador, historial global…).
// El resto de APIs (negocios, licitación, documentos, chat, notificaciones propias) pasa, y la
// autorización POR LICITACIÓN se reverifica en cada endpoint con puedeVerLicitacion().
const EXTERNO_PAGINAS_OK = ['/negocios', '/licitacion/', '/perfil', '/mis-reportes'];
const EXTERNO_API_BLOQUEADAS = [
  '/api/dashboard', '/api/alertas', '/api/radar', '/api/analizadas',
  '/api/search', '/api/palabras-clave', '/api/prefiltro', '/api/favorites',
  '/api/puente',  // reparto de trabajo del equipo: nada que hacer para un externo
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
    // Sin sesión no hay identidad: se borran los headers de identidad que pudiera mandar el navegador (el medidor y los topes
    // por cliente de medidor-cliente.ts confían en x-cliente-id).
    const sinIdentidad = new Headers(request.headers);
    for (const h of ['x-user-id', 'x-user-email', 'x-user-rol', 'x-user-nombre', 'x-cliente-id']) sinIdentidad.delete(h);
    return NextResponse.next({ request: { headers: sinIdentidad } });
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
    // Entrada "en frío" a la raíz → mostrar la landing de presentación (no el login directo).
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/bienvenida', request.url));
    }
    // Resto de páginas → login conservando la URL de destino (returnUrl).
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Sesión cerrada (logout): el token todavía no vence, pero ya no vale.
  if (await sesionRevocada(usuario.jti)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sesión cerrada. Inicia sesión para continuar.', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // El rol del JWT puede estar viejo (7 días): se toma el vigente de la BD.
  const vigente = await estadoVigente(usuario.id, usuario.rol);
  usuario.rol = vigente.rol;

  // Cuenta desactivada después de emitido el JWT: se corta el acceso al tiro.
  if (!vigente.activo) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Cuenta desactivada. Contacta al administrador.', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Multi-cliente: empresa vigente + módulos contratados. Grupo ICA (1) pasa siempre; los demás solo a lo que contrataron.
  // Lista blanca: una ruta que no está clasificada en app/lib/modulos.ts queda NEGADA para clientes.
  const clienteId = vigente.clienteId;
  if (clienteId !== 1) {
    const ficha = await fichaCliente(clienteId);
    const veredicto = ficha.vigente ? rutaPermitida(pathname, clienteId, ficha.modulos) : { ok: false as const, modulo: null };
    if (!veredicto.ok) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          ficha.vigente
            ? { error: 'Este módulo no está incluido en tu plan.', code: 'MODULO_BLOQUEADO', modulo: veredicto.modulo }
            : { error: 'El servicio de tu empresa está suspendido o vencido.', code: 'CLIENTE_NO_VIGENTE' },
          { status: 403 }
        );
      }
      const destino = new URL('/modulo-bloqueado', request.url);
      const m = moduloDeRuta(pathname);
      if (m && m !== 'comun' && m !== 'interno') destino.searchParams.set('m', m);
      if (!ficha.vigente) destino.searchParams.set('suspendido', '1');
      return NextResponse.redirect(destino);
    }
    // Defensa en profundidad: aunque Compras hoy no se pueda activar a otras empresas (MODULOS_ACTIVABLES), el día que se active ningún
    // /compras/<id> ni /api/compras/<id>/… puede entregar un negocio que no sea de esa empresa.
    // Lo mismo para Costeo: todas sus rutas cuelgan de /api/negocios/<id>/(comercial|lineas-oferta)/… (el itemId se valida contra ese negocio).
    const idNegocio = pathname.match(/^\/(?:api\/)?compras\/(\d+)(?:\/|$)/)?.[1]
      ?? pathname.match(/^\/api\/negocios\/(\d+)\/(?:comercial|lineas-oferta)(?:\/|$)/)?.[1];
    if (idNegocio && !(await negocioEsDeCliente(Number(idNegocio), clienteId))) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Rutas admin: verificar rol
  const permisoAdmin = PERMISO_DE_RUTA_ADMIN.find(([re]) => re.test(pathname))?.[1];
  if (RUTAS_ADMIN.some(r => pathname.startsWith(r)) && usuario.rol !== 'admin'
      && !(permisoAdmin && usuario.rol === 'usuario' && (await permisosDeUsuario(usuario.id, usuario.rol))[permisoAdmin])) {
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
  requestHeaders.set('x-cliente-id', String(clienteId)); // siempre pisado desde la sesión, nunca del navegador
  // x-user-nombre lo leen varias rutas para atribuir acciones: NUNCA debe venir del cliente.
  // Se fija desde el JWT verificado (solo Latin-1: Headers.set revienta con otros caracteres).
  if (usuario.nombre && /^[ -ÿ]+$/.test(usuario.nombre)) requestHeaders.set('x-user-nombre', usuario.nombre);
  else requestHeaders.delete('x-user-nombre');

  // Trabajo en equipo: si alguien modifica algo bajo /api/negocios/<id>/…, las fichas abiertas de ese negocio avisan
  // «hubo cambios». Hay decenas de rutas de escritura; en vez de tocar cada una se avisa desde aquí, con un pequeño
  // retraso para que el guardado ya esté hecho. Un aviso de más solo muestra el botón «Actualizar».
  const ruta = pathname.match(/^\/api\/negocios\/(\d+)\//);
  if (ruta && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const negocioId = Number(ruta[1]);
    const actorId = usuario.id;
    setTimeout(() => { try { publicarCambio('negocio_ficha', { negocioId, actorId }); } catch { /* sin aviso */ } }, 2500);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
