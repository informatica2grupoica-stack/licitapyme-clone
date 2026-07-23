'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutDashboard, Search, Users, LogOut, User,
  Menu as MenuIcon, X, Radar, ChevronRight,
  Briefcase, Bell, Tag, Layers, History, Settings, Command, Ban, Activity, Send, Building2, Trophy,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { LicitankIcon } from '@/app/components/LicitankLogo';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { CierreVencidoModal } from '@/app/components/CierreVencidoModal';

function tiempoRel(iso?: string) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

interface BreadcrumbItem { label: string; href?: string; }
interface AppLayoutProps { children: React.ReactNode; breadcrumb?: BreadcrumbItem[]; title?: string; }
interface NavItem { label: string; href: string; icon: React.ReactNode; adminOnly?: boolean; badge?: number | string; exact?: boolean; }
interface NavGroup { label: string; items: NavItem[]; }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'PRINCIPAL',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard size={17} />, exact: true },
      { label: 'Negocios',  href: '/negocios',  icon: <Briefcase size={17} /> },
      { label: 'Postuladas', href: '/postuladas', icon: <Send size={17} /> },
      { label: 'Ganadas/Perdidas', href: '/adjudicadas', icon: <Trophy size={17} /> },
    ],
  },
  {
    label: 'BÚSQUEDA',
    items: [
      { label: 'Buscador',   href: '/',          icon: <Search size={17} />, exact: true, adminOnly: true },
      { label: 'Radar',      href: '/radar',      icon: <Radar size={17} />, adminOnly: true },
      { label: 'Analizadas', href: '/analizadas', icon: <Layers size={17} />, adminOnly: true },
    ],
  },
  {
    label: 'GESTIÓN',
    items: [
      { label: 'Análisis de licitación', href: '/analisis-licitacion', icon: <Activity size={17} />, adminOnly: true },
      { label: 'Descartadas', href: '/descartadas', icon: <Ban size={17} />, adminOnly: true },
      { label: 'Historial', href: '/alertas', icon: <History size={17} />, adminOnly: true },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { label: 'Usuarios',       href: '/admin/usuarios',  icon: <Users size={17} />, adminOnly: true },
      { label: 'Empresas',       href: '/empresas',        icon: <Building2 size={17} />, adminOnly: true },
      { label: 'Líneas negocio', href: '/admin/etiquetas', icon: <Tag size={17} />, adminOnly: true },
    ],
  },
];

const AVATAR_BG: Record<string, string> = {
  indigo: 'bg-indigo-600', violet: 'bg-violet-600', cyan: 'bg-cyan-600',
  teal: 'bg-teal-600', grape: 'bg-purple-600', blue: 'bg-blue-600',
};
const AVATAR_SEEDS = ['indigo', 'violet', 'cyan', 'teal', 'grape', 'blue'];
function colorDe(seed: string) { return AVATAR_SEEDS[(seed?.charCodeAt(0) || 0) % AVATAR_SEEDS.length]; }

function AvatarIcon({ initials, color, size = 34 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      className={`rounded-lg flex items-center justify-center text-white font-semibold flex-shrink-0 ${AVATAR_BG[color] || 'bg-indigo-600'}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

function UserMenu({ dark = false, angosto = false }: { dark?: boolean; angosto?: boolean }) {
  const { usuario, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!usuario) return null;
  const initials = usuario.nombre
    ? usuario.nombre.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : usuario.email[0].toUpperCase();

  return (
    <div ref={ref} className="relative">
      <Tooltip label={usuario.nombre || usuario.email} disabled={!angosto}>
        <button
          onClick={() => setOpen(o => !o)}
          className={`w-full rounded-xl p-2 transition-colors text-left ${dark ? 'hover:bg-white/[0.06]' : 'hover:bg-slate-100'}`}
        >
          <div className={`flex items-center gap-2.5 ${angosto ? 'lg:justify-center lg:gap-0' : ''}`}>
            <AvatarIcon initials={initials} color={colorDe(usuario.email)} />
            <div className={`min-w-0 overflow-hidden flex-1 transition-all duration-300
              ${angosto ? 'lg:flex-none lg:w-0 lg:opacity-0' : 'opacity-100'}`}>
              <p className={`text-[12.5px] font-semibold truncate leading-tight ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
                {usuario.nombre?.split(' ')[0] || usuario.email.split('@')[0]}
              </p>
              <p className={`text-[11px] truncate leading-tight ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                {usuario.rol === 'admin' ? 'Administrador' : usuario.empresa || usuario.email}
              </p>
            </div>
          </div>
        </button>
      </Tooltip>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-[230px] bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-50">
          <p className="px-3 py-1.5 text-[11px] text-slate-400 font-medium truncate">{usuario.email}</p>
          <div className="h-px bg-slate-100 my-1" />
          <Link href="/perfil" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">
            <User size={15} className="text-slate-400" /> Mi perfil
          </Link>
          {usuario.rol === 'admin' && (
            <>
              <Link href="/admin/usuarios" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">
                <Users size={15} className="text-slate-400" /> Administrar usuarios
              </Link>
              <Link href="/admin/etiquetas" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">
                <Tag size={15} className="text-slate-400" /> Líneas de negocio
              </Link>
            </>
          )}
          <div className="h-px bg-slate-100 my-1" />
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors w-full text-left"
          >
            <LogOut size={15} /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

// Sidebar angostable.
//
// El colapso es SOLO de escritorio (>=1024px): en móvil es un cajón que se abre entero, donde
// una tira de iconos no tendría sentido y además no hay hover para los tooltips. Por eso todo
// lo que cambia al colapsar va con el prefijo `lg:` y el móvil ni se entera.
//
// La animación es CSS pura (transition-[width] en el <aside> + opacidad/ancho de las
// etiquetas), no framer-motion: animar el ancho con estilos en línea también encogería el
// cajón móvil. Los tooltips sí usan framer-motion — ver components/ui/Tooltip.
const CLAVE_COLAPSO = 'sidebar-colapsado';
const ANCHO_COLAPSADO = 'lg:w-[76px]';

// Recuerda la preferencia FUERA del componente.
//
// Cada página renderiza su propio <AppLayout> (no está en layout.tsx), así que al navegar el
// Sidebar se DESMONTA y se vuelve a montar — verificado: el <aside> es un nodo nuevo. Con el
// estado dentro del componente, cada cambio de menú lo devolvía a "expandido" y el efecto lo
// encogía después: se veía el menú abrirse a 256px y achicarse a 76px, animado, en cada clic.
// Al vivir en el módulo, el valor ya se conoce en el primer render tras remontar → sin salto.
//
// `null` = todavía no se ha leído localStorage (solo antes del primer montaje del cliente).
let colapsadoCache: boolean | null = null;

function Sidebar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const pathname = usePathname();
  const { usuario } = useSession();
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));

  // Si el módulo ya sabe la preferencia (o sea: no es la primera carga), se arranca con ella.
  // En la primera carga arranca en false para coincidir con el HTML del servidor, que no puede
  // leer localStorage; el efecto de abajo la corrige.
  const [colapsado, setColapsado] = useState(() => colapsadoCache ?? false);
  // Solo se anima el ancho cuando ya conocemos el valor. Así la corrección de la primera carga
  // (expandido → colapsado) es instantánea en vez de un barrido de 300ms.
  const [animarAncho, setAnimarAncho] = useState(colapsadoCache !== null);

  useEffect(() => {
    if (colapsadoCache === null) {
      try { colapsadoCache = localStorage.getItem(CLAVE_COLAPSO) === '1'; } catch { colapsadoCache = false; }
      setColapsado(colapsadoCache);
      // Al siguiente fotograma: que la corrección inicial no se anime, pero el botón sí.
      requestAnimationFrame(() => setAnimarAncho(true));
    }
  }, []);

  const alternar = () => setColapsado(v => {
    const next = !v;
    colapsadoCache = next;   // para que el próximo montaje ya nazca bien
    try { localStorage.setItem(CLAVE_COLAPSO, next ? '1' : '0'); } catch { /* no bloquear por storage */ }
    return next;
  });

  // Con el cajón móvil abierto SIEMPRE se ve completo, aunque en escritorio esté colapsado.
  const angosto = colapsado && !mobileOpen;
  // `trans`: se apaga durante la corrección de la primera carga para que nada se anime hasta
  // que sepamos el ancho real (si no, las etiquetas se desvanecían solas al abrir la app).
  const trans = animarAncho ? 'transition-all duration-300' : '';
  // Las etiquetas: ocupan su ancho normal, y al colapsar se desvanecen encogiendo a 0.
  const clsEtiqueta = `flex items-center gap-2 overflow-hidden flex-1 ${trans}
    ${angosto ? 'lg:flex-none lg:w-0 lg:opacity-0' : 'opacity-100'}`;

  const esExterno = usuario?.rol === 'externo';
  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(i => {
      if (esExterno) return i.href === '/negocios'; // externo: SOLO "Mis licitaciones"
      if (!i.adminOnly || usuario?.rol === 'admin') return true;
      if (i.href === '/radar' && usuario?.permisos?.acceso_radar) return true;
      return false;
    }),
  })).filter(g => g.items.length > 0);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" onClick={onCloseMobile} />}

      <aside className={`
        fixed top-0 left-0 h-full z-50 flex flex-col w-64
        bg-gradient-to-b from-[#1c2027] to-[#15181d]
        ${animarAncho ? 'transition-[transform,width]' : 'transition-transform'} duration-300 ease-out
        ${angosto ? ANCHO_COLAPSADO : 'lg:w-64'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:z-auto
      `}>
        {/* Cabecera: logo (oculto para EXTERNO, que no ve la marca de la app) */}
        <div className={`pt-5 pb-4 flex items-center justify-between flex-shrink-0 ${trans}
          ${angosto ? 'px-4 lg:px-0 lg:flex-col lg:gap-3' : 'px-4'}`}>
          {esExterno ? (
            <span className={`text-slate-300 font-semibold text-[13px] ${angosto ? 'lg:hidden' : ''}`}>Mis licitaciones</span>
          ) : (
            <Link href="/dashboard" onClick={onCloseMobile} className="flex items-center gap-2.5 group min-w-0">
              <div className="group-hover:scale-105 transition-transform flex-shrink-0"><LicitankIcon size={36} /></div>
              <div className={`flex flex-col leading-none ${clsEtiqueta}`}>
                <span className="text-white font-black text-[15px] tracking-tight">LICITANK</span>
                <span className="text-slate-500 text-[9.5px] font-semibold tracking-[0.14em] uppercase mt-0.5">Licitaciones</span>
              </div>
            </Link>
          )}
          {/* Angostar/ensanchar: solo escritorio. En móvil el cajón se cierra con la X. */}
          <Tooltip label={angosto ? 'Ensanchar menú' : 'Angostar menú'} disabled={!angosto}>
            <button
              onClick={alternar}
              className="hidden lg:flex p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
              aria-label={angosto ? 'Ensanchar menú' : 'Angostar menú'}
              aria-expanded={!angosto}
            >
              {angosto ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </Tooltip>
          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
            aria-label="Cerrar menú"
          >
            <X size={16} />
          </button>
        </div>

        {/* Búsqueda rápida: solo admin — el buscador "/" es admin-only, mostrarla a un
            usuario normal lo mandaba a un redirect confuso hacia /negocios. */}
        {usuario?.rol === 'admin' && (
        <div className={`pb-3 flex-shrink-0 ${trans} ${angosto ? 'px-3 lg:px-2' : 'px-3'}`}>
          <Tooltip label="Buscar licitaciones  ⌘K" disabled={!angosto}>
            <Link href="/" onClick={onCloseMobile}
              className={`flex items-center gap-2.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06]
                text-slate-400 hover:text-slate-200 hover:bg-white/[0.07] transition-colors
                ${angosto ? 'px-3 lg:px-0 lg:justify-center lg:gap-0' : 'px-3'}`}>
              <Search size={15} className="text-slate-500 flex-shrink-0" />
              <span className={`text-[12.5px] font-medium ${clsEtiqueta}`}>
                <span className="flex-1 truncate">Buscar licitaciones</span>
                <span className="flex items-center gap-0.5 text-[10px] text-slate-600 border border-white/10 rounded px-1 py-0.5 flex-shrink-0">
                  <Command size={9} /> K
                </span>
              </span>
            </Link>
          </Tooltip>
        </div>
        )}

        {/* Nav */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <nav className={`pb-2 space-y-5 ${trans} ${angosto ? 'px-3 lg:px-2' : 'px-3'}`}>
            {visibleGroups.map(group => (
              <div key={group.label}>
                {/* Colapsado, el título del grupo cede su sitio a un separador: la agrupación
                    se sigue leyendo sin gastar los 76px de ancho en texto. */}
                <p className={`px-2 mb-1.5 text-[9.5px] font-bold text-slate-600 tracking-[0.14em] uppercase
                  ${angosto ? 'lg:hidden' : ''}`}>{group.label}</p>
                {angosto && <div className="hidden lg:block h-px bg-white/[0.07] mx-2 mb-2" />}
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const active = isActive(item);
                    return (
                      <Tooltip key={item.href} label={item.label} disabled={!angosto}>
                        <Link href={item.href} onClick={onCloseMobile}
                          // OJO con la lista de propiedades: NO puede incluir `all`. La pestaña
                          // activa cambia margin-right (0 → -12px) y border-radius, y animarlos
                          // hacía que al cambiar de página la pestaña se deslizara y deformara
                          // mientras sus muescas curvas (::before/::after, que son pseudo-
                          // elementos y no heredan la transición) aparecían de golpe. El cambio
                          // de forma va instantáneo; solo se animan color y espaciado.
                          className={`group relative flex items-center gap-3 py-2.5 text-[13px]
                            transition-[color,background-color,padding,gap] duration-150
                            ${angosto ? 'px-3 lg:px-0 lg:justify-center lg:gap-0' : 'px-3'}
                            ${active
                              ? 'sidebar-tab-active -mr-3 rounded-l-2xl bg-slate-50 text-slate-900 font-semibold'
                              : 'rounded-xl font-medium text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'}`}>
                          <span className={`relative flex-shrink-0 ${active ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-300'}`}>
                            {item.icon}
                            {/* Colapsado no cabe el número: queda un punto sobre el icono para
                                que la alerta no desaparezca al angostar. */}
                            {item.badge != null && angosto && (
                              <span className="hidden lg:block absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[#1c2027]" />
                            )}
                          </span>
                          <span className={clsEtiqueta}>
                            <span className="flex-1 truncate text-left">{item.label}</span>
                            {item.badge != null && (
                              <span className="text-[10px] font-semibold bg-red-500 text-white px-1.5 py-0.5 rounded flex-shrink-0">{item.badge}</span>
                            )}
                          </span>
                        </Link>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Usuario */}
        <div className={`pb-4 pt-2 border-t border-white/[0.07] flex-shrink-0 ${trans}
          ${angosto ? 'px-2.5 lg:px-2' : 'px-2.5'}`}>
          <UserMenu dark angosto={angosto} />
        </div>
      </aside>
    </>
  );
}

interface Noti { id?: number; tipo?: string; mensaje: string; licitacion_codigo?: string | null; leido?: boolean; created_at?: string; }

function NotificacionesBell() {
  const { usuario } = useSession();
  const toast = useToast();
  // Ref para usar el toast dentro del efecto del SSE sin ponerlo en las deps:
  // así la conexión EventSource vive toda la sesión y no se reabre por re-renders.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [open, setOpen] = useState(false);
  const [eventos, setEventos] = useState<Noti[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch('/api/historial?limit=15').then(r => r.json());
      if (d.success) { setEventos(d.eventos || []); setNoLeidas(d.noLeidas || 0); }
    } catch { /* silencioso */ }
  }, []);

  // Se engancha al bus compartido en vez de abrir su propia conexión: el navegador solo
  // admite ~6 conexiones por dominio y un EventSource por componente las agotaba, dejando
  // el resto de las peticiones encoladas para siempre. Ver app/lib/use-realtime.
  useEffect(() => {
    if (!usuario) return;
    cargar();
    return suscribirRealtime(ev => {
      if (ev.tipo !== 'notificacion') return;   // los 'cambio' son para los tableros
      const data = ev.datos as Noti;
      setEventos(prev => [data, ...prev].slice(0, 20));
      setNoLeidas(n => n + 1);
      toastRef.current.info('Nueva notificación', data.mensaje);
    });
  }, [usuario, cargar]);

  const marcarLeidas = async () => {
    if (noLeidas === 0) return;
    setNoLeidas(0);
    setEventos(prev => prev.map(e => ({ ...e, leido: true })));
    try { await fetch('/api/historial', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }); } catch { /* silencioso */ }
  };

  const handleOpen = () => {
    setOpen(o => !o);
    if (!open) marcarLeidas();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        aria-label="Notificaciones"
      >
        <Bell size={18} />
        {noLeidas > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[350px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="text-[13px] font-bold text-slate-800">Notificaciones</p>
            <Link href="/alertas" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
              Ver historial
            </Link>
          </div>
          <div className="overflow-y-auto max-h-[360px]">
            {eventos.length === 0 ? (
              <p className="text-[13px] text-slate-400 text-center py-8">Sin notificaciones</p>
            ) : (
              eventos.map((e, i) => {
                const content = (
                  <div className="flex items-start gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${e.leido ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-600'}`}>
                      <Briefcase size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] leading-snug line-clamp-2 ${e.leido ? 'font-medium text-slate-600' : 'font-semibold text-slate-800'}`}>
                        {e.mensaje}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{tiempoRel(e.created_at)}</p>
                    </div>
                  </div>
                );
                return e.licitacion_codigo
                  ? <Link key={e.id || i} href={`/licitacion/${encodeURIComponent(e.licitacion_codigo)}`} onClick={() => setOpen(false)}>{content}</Link>
                  : <div key={e.id || i}>{content}</div>;
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({ breadcrumb, onOpenMobile }: { breadcrumb?: BreadcrumbItem[]; onOpenMobile: () => void }) {
  const { usuario } = useSession();
  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';

  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-slate-200/70 px-4 sm:px-6 h-14 flex items-center gap-3 flex-shrink-0">
      <button
        onClick={onOpenMobile}
        className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        aria-label="Abrir menú"
      >
        <MenuIcon size={18} />
      </button>

      <div className="flex-1 min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className="flex items-center gap-1 text-[13px]">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />}
                {item.href
                  ? <Link href={item.href} className="text-slate-400 hover:text-slate-700 transition-colors">{item.label}</Link>
                  : <span className="text-slate-800 font-semibold truncate">{item.label}</span>}
              </span>
            ))}
          </nav>
        ) : (
          <p className="text-[13px] font-semibold text-slate-700">{saludo}{nombre ? `, ${nombre}` : ''}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-[11px] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> API activa
        </div>
        <NotificacionesBell />
        <Link
          href="/perfil"
          title="Mi perfil"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Perfil"
        >
          <Settings size={18} />
        </Link>
      </div>
    </header>
  );
}

export function AppLayout({ children, breadcrumb }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { usuario } = useSession();
  const router = useRouter();

  // Atajo ⌘K / Ctrl+K → buscador (solo admin, que es quien tiene acceso a "/").
  // Hace real el hint que muestra la búsqueda rápida del sidebar.
  useEffect(() => {
    if (usuario?.rol !== 'admin') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        router.push('/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [usuario?.rol, router]);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar breadcrumb={breadcrumb} onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      {/* Bloqueante: licitaciones vencidas sin resolver (postulada/descartadas) */}
      <CierreVencidoModal />
    </div>
  );
}
