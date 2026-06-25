'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Search, Users, LogOut, User,
  Menu as MenuIcon, X, Radar, ChevronRight,
  Briefcase, Bell, Tag, Layers, History, Settings, Command,
} from 'lucide-react';
import {
  Avatar, Menu, Indicator, ActionIcon, Tooltip, Badge, ScrollArea, Box, UnstyledButton,
  Text, Group, Anchor, ThemeIcon,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IcaLogoIcon } from '@/app/components/IcaLogo';
import { useSession } from '@/app/lib/session-context';

// Tiempo relativo corto (ahora, 5m, 2h, 3d).
function tiempoRel(iso?: string) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Tipos ────────────────────────────────────────────────────────────────────────
interface BreadcrumbItem { label: string; href?: string; }
interface AppLayoutProps { children: React.ReactNode; breadcrumb?: BreadcrumbItem[]; title?: string; }
interface NavItem { label: string; href: string; icon: React.ReactNode; adminOnly?: boolean; badge?: number | string; exact?: boolean; }
interface NavGroup { label: string; items: NavItem[]; }

// ── Estructura de navegación ───────────────────────────────────────────────────────
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'PRINCIPAL',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard size={17} />, exact: true },
      { label: 'Negocios',  href: '/negocios',  icon: <Briefcase size={17} /> },
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
      { label: 'Historial', href: '/alertas', icon: <History size={17} />, adminOnly: true },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { label: 'Usuarios',       href: '/admin/usuarios',  icon: <Users size={17} />, adminOnly: true },
      { label: 'Líneas negocio', href: '/admin/etiquetas', icon: <Tag size={17} />, adminOnly: true },
    ],
  },
];

const AVATAR_COLORS = ['indigo', 'violet', 'cyan', 'teal', 'grape', 'blue'];
function colorDe(seed: string) { return AVATAR_COLORS[(seed?.charCodeAt(0) || 0) % AVATAR_COLORS.length]; }

// ── Menú de usuario (Mantine Menu) ──────────────────────────────────────────────────
function UserMenu({ dark = false }: { dark?: boolean }) {
  const { usuario, logout } = useSession();
  if (!usuario) return null;
  const initials = usuario.nombre
    ? usuario.nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : usuario.email[0].toUpperCase();

  return (
    <Menu position="top-start" width={230} shadow="lg" radius="md" withArrow>
      <Menu.Target>
        <UnstyledButton
          className={`w-full rounded-xl p-2 transition-colors ${dark ? 'hover:bg-white/[0.06]' : 'hover:bg-slate-100'}`}
        >
          <div className="flex items-center gap-2.5">
            <Avatar color={colorDe(usuario.email)} radius="md" size={34}>{initials}</Avatar>
            <div className="flex-1 min-w-0 text-left">
              <p className={`text-[12.5px] font-semibold truncate leading-tight ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
                {usuario.nombre?.split(' ')[0] || usuario.email.split('@')[0]}
              </p>
              <p className={`text-[11px] truncate leading-tight ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                {usuario.rol === 'admin' ? 'Administrador' : usuario.empresa || usuario.email}
              </p>
            </div>
          </div>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{usuario.email}</Menu.Label>
        <Menu.Item component={Link} href="/perfil" leftSection={<User size={15} />}>Mi perfil</Menu.Item>
        {usuario.rol === 'admin' && (
          <>
            <Menu.Item component={Link} href="/admin/usuarios" leftSection={<Users size={15} />}>Administrar usuarios</Menu.Item>
            <Menu.Item component={Link} href="/admin/etiquetas" leftSection={<Tag size={15} />}>Líneas de negocio</Menu.Item>
          </>
        )}
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<LogOut size={15} />} onClick={() => logout()}>Cerrar sesión</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────────
function Sidebar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const pathname = usePathname();
  const { usuario } = useSession();
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));

  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(i => {
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
        transition-transform duration-300 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:z-auto
      `}>
        {/* Logo */}
        <div className="px-4 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <Link href="/dashboard" onClick={onCloseMobile} className="flex items-center gap-2.5 group">
            <div className="group-hover:scale-105 transition-transform"><IcaLogoIcon size={36} /></div>
            <div className="flex flex-col leading-none">
              <span className="text-white font-bold text-[14px] tracking-tight">ICA</span>
              <span className="text-slate-500 text-[9.5px] font-semibold tracking-[0.14em] uppercase mt-0.5">Licitaciones</span>
            </div>
          </Link>
          <ActionIcon variant="subtle" color="gray" onClick={onCloseMobile} className="lg:hidden" aria-label="Cerrar menú">
            <X size={16} />
          </ActionIcon>
        </div>

        {/* Búsqueda rápida */}
        <div className="px-3 pb-3 flex-shrink-0">
          <Link href="/" onClick={onCloseMobile}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.07] transition-colors">
            <Search size={15} className="text-slate-500" />
            <span className="text-[12.5px] font-medium flex-1">Buscar licitaciones</span>
            <span className="flex items-center gap-0.5 text-[10px] text-slate-600 border border-white/10 rounded px-1 py-0.5">
              <Command size={9} /> K
            </span>
          </Link>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1" scrollbarSize={6} type="hover">
          <nav className="px-3 pb-2 space-y-5">
            {visibleGroups.map(group => (
              <div key={group.label}>
                <p className="px-2 mb-1.5 text-[9.5px] font-bold text-slate-600 tracking-[0.14em] uppercase">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const active = isActive(item);
                    return (
                      <Link key={item.href} href={item.href} onClick={onCloseMobile}
                        className={`group relative flex items-center gap-3 px-3 py-2.5 text-[13px] transition-all duration-150
                          ${active
                            ? 'sidebar-tab-active -mr-3 rounded-l-2xl bg-white/[0.09] text-white font-semibold'
                            : 'rounded-xl font-medium text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'}`}>
                        <span className={active ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300'}>{item.icon}</span>
                        <span className="flex-1">{item.label}</span>
                        {item.badge != null && (
                          <Badge size="xs" variant="filled" color="red" radius="sm">{item.badge}</Badge>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Usuario */}
        <div className="px-2.5 pb-4 pt-2 border-t border-white/[0.07] flex-shrink-0">
          <UserMenu dark />
        </div>
      </aside>
    </>
  );
}

// ── Campana de notificaciones (tiempo real por SSE) ───────────────────────────────
interface Noti { id?: number; tipo?: string; mensaje: string; licitacion_codigo?: string | null; leido?: boolean; created_at?: string; }

function NotificacionesBell() {
  const { usuario } = useSession();
  const [eventos, setEventos] = useState<Noti[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch('/api/historial?limit=15').then(r => r.json());
      if (d.success) { setEventos(d.eventos || []); setNoLeidas(d.noLeidas || 0); }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    if (!usuario) return;
    cargar();
    // Conexión SSE: el servidor empuja las notificaciones al instante.
    const es = new EventSource('/api/historial/stream');
    es.addEventListener('notificacion', (ev: MessageEvent) => {
      try {
        const data: Noti = JSON.parse(ev.data);
        setEventos(prev => [data, ...prev].slice(0, 20));
        setNoLeidas(n => n + 1);
        notifications.show({ title: 'Nueva notificación', message: data.mensaje, color: 'indigo', icon: <Bell size={16} />, autoClose: 6000 });
      } catch { /* ignore */ }
    });
    es.onerror = () => { /* EventSource reconecta solo (retry) */ };
    return () => es.close();
  }, [usuario, cargar]);

  const marcarLeidas = async () => {
    if (noLeidas === 0) return;
    setNoLeidas(0);
    setEventos(prev => prev.map(e => ({ ...e, leido: true })));
    try { await fetch('/api/historial', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }); } catch { /* silencioso */ }
  };

  return (
    <Menu position="bottom-end" width={350} shadow="lg" radius="md" onChange={(o) => { if (o) marcarLeidas(); }}>
      <Menu.Target>
        <Indicator color="red" size={16} offset={6} disabled={noLeidas === 0} label={noLeidas > 9 ? '9+' : noLeidas}>
          <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="Notificaciones">
            <Bell size={18} />
          </ActionIcon>
        </Indicator>
      </Menu.Target>
      <Menu.Dropdown>
        <Group justify="space-between" px="xs" py={4}>
          <Text fw={700} size="sm">Notificaciones</Text>
          <Anchor component={Link} href="/alertas" size="xs" fw={600}>Ver historial</Anchor>
        </Group>
        <Menu.Divider />
        {eventos.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" py="lg">Sin notificaciones</Text>
        ) : (
          <ScrollArea.Autosize mah={360} scrollbarSize={6}>
            {eventos.map((e, i) => {
              const item = (
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color={e.leido ? 'gray' : 'indigo'} size={32} radius="md"><Briefcase size={15} /></ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="xs" fw={e.leido ? 500 : 700} lineClamp={2}>{e.mensaje}</Text>
                    <Text size="10" c="dimmed" mt={2}>{tiempoRel(e.created_at)}</Text>
                  </div>
                </Group>
              );
              return e.licitacion_codigo
                ? <Menu.Item key={e.id || i} component={Link} href={`/licitacion/${encodeURIComponent(e.licitacion_codigo)}`}>{item}</Menu.Item>
                : <Menu.Item key={e.id || i}>{item}</Menu.Item>;
            })}
          </ScrollArea.Autosize>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────────
function TopBar({ breadcrumb, onOpenMobile }: { breadcrumb?: BreadcrumbItem[]; onOpenMobile: () => void }) {
  const { usuario } = useSession();
  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';

  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-slate-200/70 px-4 sm:px-6 h-14 flex items-center gap-3 flex-shrink-0">
      <ActionIcon variant="subtle" color="gray" onClick={onOpenMobile} className="lg:hidden" aria-label="Abrir menú">
        <MenuIcon size={18} />
      </ActionIcon>

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
        <Tooltip label="Mi perfil" withArrow>
          <ActionIcon component={Link} href="/perfil" variant="subtle" color="gray" size="lg" radius="md" aria-label="Perfil">
            <Settings size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
    </header>
  );
}

// ── AppLayout ───────────────────────────────────────────────────────────────────
export function AppLayout({ children, breadcrumb }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar breadcrumb={breadcrumb} onOpenMobile={() => setMobileOpen(true)} />
        <Box component="main" className="flex-1 overflow-y-auto">{children}</Box>
      </div>
    </div>
  );
}
