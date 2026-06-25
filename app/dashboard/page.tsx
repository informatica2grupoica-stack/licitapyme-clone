'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  Card, SimpleGrid, Group, Stack, Text, Title, Badge, ThemeIcon, Paper,
  RingProgress, Center, Loader, Box, Anchor, Divider, Avatar, Tooltip,
} from '@mantine/core';
import { DonutChart, AreaChart, BarChart } from '@mantine/charts';
import {
  Search, Building2, Users, Wallet, CalendarClock, ArrowUpRight, Layers3,
  Gauge, ListChecks, TriangleAlert, Clock4, ChevronRight, FolderClock,
} from 'lucide-react';

// ── Tipos ───────────────────────────────────────────────────────────────────────
interface DashData {
  success: boolean; rol: string;
  admin: null | {
    usuarios: { total: number; activos: number; nuevosSemana: number; ultimosAccesos: any[] };
    radar: { totalLicitaciones: number; conViabilidad: number };
    viabilidad: { semaforo: string; n: number }[];
    prefiltro: { decision: string; n: number }[];
    pipeline: { etapa: string; n: number }[];
    montoPipeline: number;
    porDia: { dia: string; n: number }[];
  };
  usuario: {
    asignadas: number; montoAsignadas: number;
    pipeline: { etapa: string; n: number }[];
    proximosCierres: { codigo: string; nombre: string; organismo: string; cierre: string; monto: number | null }[];
  };
  favoritosRecientes: any[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────────
const fmtMonto = (n: number) =>
  n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(1)}B`
  : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(0)}M`
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtMontoFull = (n?: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtFecha = (f?: string | null) => {
  if (!f) return '—';
  try { return new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }); } catch { return f; }
};
const diasAl = (f?: string | null) => f ? Math.ceil((new Date(f).getTime() - Date.now()) / 86400000) : null;

const SEMAFORO = {
  VERDE:     { label: 'Viable',     color: 'teal.6' },
  AMARILLO:  { label: 'Media-alta', color: 'yellow.6' },
  NARANJA:   { label: 'Media',      color: 'orange.6' },
  ROJO:      { label: 'Baja',       color: 'red.6' },
  ROJO_DURO: { label: 'Descartar',  color: 'red.9' },
} as const;
const PREFILTRO = {
  PASA:            { label: 'Pasa',     color: 'teal.6' },
  REVISION_HUMANA: { label: 'Revisar',  color: 'yellow.6' },
  EXCLUIDO:        { label: 'Excluida', color: 'gray.5' },
} as const;
const ETAPA: Record<string, string> = {
  '1ASIGNADO': 'Asignado', '2CARPETA_OK': 'Carpeta OK', '3REVISION': 'En revisión',
  '4ANEXOS': 'Anexos', '5OFERTA': 'Oferta', '6ENVIADA': 'Enviada', '7GANADA': 'Ganada', '8PERDIDA': 'Perdida',
};

// ── Tarjeta de estadística ────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color = 'indigo', href }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string; href?: string;
}) {
  const inner = (
    <Card withBorder radius="lg" padding="lg" className="transition-shadow hover:shadow-md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: 0.4 }}>{label}</Text>
          <Text fz={28} fw={800} lh={1.1} className="tabular-nums">{value}</Text>
          {sub && <Text size="xs" c="dimmed">{sub}</Text>}
        </Stack>
        <ThemeIcon variant="light" color={color} size={42} radius="md">{icon}</ThemeIcon>
      </Group>
      {href && (
        <Anchor component={Link} href={href} size="xs" fw={600} mt="sm" className="inline-flex items-center gap-1">
          Ver detalle <ArrowUpRight size={12} />
        </Anchor>
      )}
    </Card>
  );
  return inner;
}

function PanelCard({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card withBorder radius="lg" padding={0}>
      <Group justify="space-between" px="lg" py="md" className="border-b border-slate-100">
        <Group gap={8}>{icon}<Text fw={700} size="sm">{title}</Text></Group>
        {right}
      </Group>
      <Box p="lg">{children}</Box>
    </Card>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { usuario } = useSession();
  const [data, setData] = useState<DashData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard').then(r => r.json())
      .then(d => { if (d.success) setData(d); else setError(d.error); })
      .catch(() => setError('Error al cargar el dashboard'))
      .finally(() => setCargando(false));
  }, []);

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';
  const esAdmin = data?.rol === 'admin' && !!data.admin;

  return (
    <AppLayout>
      <Box className="p-5 sm:p-7 max-w-7xl mx-auto">
        {/* Header */}
        <Group justify="space-between" align="flex-end" mb="lg" wrap="nowrap">
          <Stack gap={2}>
            <Title order={2} fw={800} className="tracking-tight">{saludo}{nombre ? `, ${nombre}` : ''}</Title>
            <Text size="sm" c="dimmed" tt="capitalize">
              {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </Stack>
          {esAdmin && (
            <Anchor component={Link} href="/radar" underline="never">
              <Badge size="lg" radius="md" variant="light" color="indigo" leftSection={<Search size={13} />} className="cursor-pointer">
                Ir al radar
              </Badge>
            </Anchor>
          )}
        </Group>

        {cargando ? (
          <Center py={80}><Loader color="indigo" /></Center>
        ) : error ? (
          <Paper withBorder p="lg" radius="lg" className="border-red-200 bg-red-50">
            <Group gap={8}><TriangleAlert size={18} className="text-red-600" /><Text c="red.7" size="sm">{error}</Text></Group>
          </Paper>
        ) : data ? (
          esAdmin ? <VistaAdmin data={data} /> : <VistaUsuario data={data} />
        ) : null}
      </Box>
    </AppLayout>
  );
}

// ── Vista ADMIN ───────────────────────────────────────────────────────────────────
function VistaAdmin({ data }: { data: DashData }) {
  const a = data.admin!;
  const viabData = a.viabilidad.map(v => ({ name: SEMAFORO[v.semaforo as keyof typeof SEMAFORO]?.label || v.semaforo, value: v.n, color: SEMAFORO[v.semaforo as keyof typeof SEMAFORO]?.color || 'gray.5' }));
  const prefData = a.prefiltro.map(p => ({ etapa: PREFILTRO[p.decision as keyof typeof PREFILTRO]?.label || p.decision, n: p.n, color: PREFILTRO[p.decision as keyof typeof PREFILTRO]?.color || 'gray.5' }));
  const pipeData = a.pipeline.map(p => ({ etapa: ETAPA[p.etapa] || p.etapa, n: p.n }));
  const tendencia = a.porDia.map(d => ({ dia: fmtFecha(d.dia), n: Number(d.n) }));
  const totalViab = viabData.reduce((s, v) => s + v.value, 0);

  return (
    <Stack gap="lg">
      {/* KPIs */}
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatCard icon={<Building2 size={22} />} label="Licitaciones en radar" value={a.radar.totalLicitaciones.toLocaleString('es-CL')} sub={`${a.radar.conViabilidad} con viabilidad`} color="indigo" href="/radar" />
        <StatCard icon={<Layers3 size={22} />} label="En pipeline" value={a.pipeline.reduce((s, p) => s + p.n, 0)} sub={fmtMonto(a.montoPipeline)} color="violet" href="/negocios" />
        <StatCard icon={<Users size={22} />} label="Usuarios activos" value={a.usuarios.activos} sub={`${a.usuarios.total} en total · +${a.usuarios.nuevosSemana} esta semana`} color="teal" href="/admin/usuarios" />
        <StatCard icon={<ListChecks size={22} />} label="Pasan el prefiltro" value={(a.prefiltro.find(p => p.decision === 'PASA')?.n || 0).toLocaleString('es-CL')} sub={`${a.prefiltro.find(p => p.decision === 'EXCLUIDO')?.n || 0} excluidas`} color="cyan" />
      </SimpleGrid>

      {/* Charts */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <PanelCard title="Tendencia de detección (14 días)" icon={<CalendarClock size={15} className="text-indigo-500" />}>
          {tendencia.length > 0 ? (
            <AreaChart h={220} data={tendencia} dataKey="dia" series={[{ name: 'n', label: 'Licitaciones', color: 'indigo.6' }]} curveType="natural" withGradient withDots={false} gridAxis="y" />
          ) : <Text size="sm" c="dimmed" ta="center" py="xl">Sin datos recientes</Text>}
        </PanelCard>

        <PanelCard title="Distribución de viabilidad" icon={<Gauge size={15} className="text-indigo-500" />}>
          {totalViab > 0 ? (
            <Group justify="center" gap="xl">
              <DonutChart data={viabData} size={170} thickness={26} withLabelsLine={false} chartLabel={`${totalViab}`} />
              <Stack gap={6}>
                {viabData.map(v => (
                  <Group key={v.name} gap={8}>
                    <Box w={10} h={10} style={{ borderRadius: 3, background: `var(--mantine-color-${v.color.replace('.', '-')})` }} />
                    <Text size="xs" fw={500}>{v.name}</Text>
                    <Text size="xs" c="dimmed" className="tabular-nums">{v.value}</Text>
                  </Group>
                ))}
              </Stack>
            </Group>
          ) : <Text size="sm" c="dimmed" ta="center" py="xl">Aún sin análisis de viabilidad</Text>}
        </PanelCard>

        <PanelCard title="Prefiltro de perfil" icon={<ListChecks size={15} className="text-indigo-500" />}>
          {prefData.length > 0 ? (
            <BarChart h={200} data={prefData} dataKey="etapa" series={[{ name: 'n', label: 'Licitaciones', color: 'indigo.6' }]} barProps={{ radius: 6 }} gridAxis="y" />
          ) : <Text size="sm" c="dimmed" ta="center" py="xl">Sin prefiltro</Text>}
        </PanelCard>

        <PanelCard title="Pipeline de negocios" icon={<Layers3 size={15} className="text-indigo-500" />} right={<Anchor component={Link} href="/negocios" size="xs" fw={600}>Ver todo</Anchor>}>
          {pipeData.length > 0 ? (
            <BarChart h={200} data={pipeData} dataKey="etapa" orientation="vertical" series={[{ name: 'n', label: 'Negocios', color: 'violet.6' }]} barProps={{ radius: 6 }} gridAxis="x" />
          ) : <Text size="sm" c="dimmed" ta="center" py="xl">Sin negocios en pipeline</Text>}
        </PanelCard>
      </SimpleGrid>

      {/* Listas */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <ProximosCierres items={data.usuario.proximosCierres} titulo="Próximos cierres (empresa)" />
        <PanelCard title="Últimos accesos" icon={<Clock4 size={15} className="text-indigo-500" />} right={<Anchor component={Link} href="/admin/usuarios" size="xs" fw={600}>Gestionar</Anchor>}>
          <Stack gap="sm">
            {a.usuarios.ultimosAccesos.map((u: any) => (
              <Group key={u.id} justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap">
                  <Avatar radius="md" size={32} color="indigo">{(u.nombre || u.email)[0]?.toUpperCase()}</Avatar>
                  <Stack gap={0}>
                    <Text size="sm" fw={600} lineClamp={1}>{u.nombre || u.email}</Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>{u.email}</Text>
                  </Stack>
                </Group>
                <Group gap={6} wrap="nowrap">
                  {u.rol === 'admin' && <Badge size="xs" variant="light" color="amber">Admin</Badge>}
                  <Text size="xs" c="dimmed">{fmtFecha(u.ultimo_login)}</Text>
                </Group>
              </Group>
            ))}
          </Stack>
        </PanelCard>
      </SimpleGrid>
    </Stack>
  );
}

// ── Vista USUARIO ─────────────────────────────────────────────────────────────────
function VistaUsuario({ data }: { data: DashData }) {
  const u = data.usuario;
  const pipeData = u.pipeline.map(p => ({ name: ETAPA[p.etapa] || p.etapa, value: p.n, color: 'indigo.6' }));
  const totalPipe = pipeData.reduce((s, p) => s + p.value, 0);
  const colores = ['indigo.6', 'violet.5', 'teal.5', 'cyan.5', 'grape.5', 'blue.5', 'green.6', 'red.5'];
  pipeData.forEach((p, i) => (p.color = colores[i % colores.length]));

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, md: 3 }} spacing="md">
        <StatCard icon={<Building2 size={22} />} label="Mis licitaciones" value={u.asignadas} sub="Asignadas a mí" color="indigo" href="/negocios" />
        <StatCard icon={<Wallet size={22} />} label="Monto en gestión" value={fmtMonto(u.montoAsignadas)} sub="Suma de mis licitaciones" color="teal" />
        <StatCard icon={<CalendarClock size={22} />} label="Próximos cierres" value={u.proximosCierres.length} sub="En adelante" color="orange" />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <PanelCard title="Mi pipeline" icon={<Layers3 size={15} className="text-indigo-500" />} right={<Anchor component={Link} href="/negocios" size="xs" fw={600}>Ver negocios</Anchor>}>
          {totalPipe > 0 ? (
            <Group justify="center" gap="xl">
              <DonutChart data={pipeData} size={170} thickness={26} withLabelsLine={false} chartLabel={`${totalPipe}`} />
              <Stack gap={6}>
                {pipeData.map(p => (
                  <Group key={p.name} gap={8}>
                    <Box w={10} h={10} style={{ borderRadius: 3, background: `var(--mantine-color-${p.color.replace('.', '-')})` }} />
                    <Text size="xs" fw={500}>{p.name}</Text>
                    <Text size="xs" c="dimmed" className="tabular-nums">{p.value}</Text>
                  </Group>
                ))}
              </Stack>
            </Group>
          ) : (
            <Stack align="center" gap={6} py="xl">
              <FolderClock size={28} className="text-slate-300" />
              <Text size="sm" c="dimmed">Aún no tienes licitaciones asignadas</Text>
            </Stack>
          )}
        </PanelCard>

        <ProximosCierres items={u.proximosCierres} titulo="Mis próximos cierres" />
      </SimpleGrid>
    </Stack>
  );
}

// ── Lista de próximos cierres ──────────────────────────────────────────────────────
function ProximosCierres({ items, titulo }: { items: DashData['usuario']['proximosCierres']; titulo: string }) {
  return (
    <PanelCard title={titulo} icon={<CalendarClock size={15} className="text-indigo-500" />}>
      {items.length > 0 ? (
        <Stack gap={4}>
          {items.map((it, i) => {
            const d = diasAl(it.cierre);
            return (
              <Anchor key={`${it.codigo}-${i}`} component={Link} href={`/licitacion/${encodeURIComponent(it.codigo)}`} underline="never">
                <Group justify="space-between" wrap="nowrap" className="rounded-lg px-2 py-2 hover:bg-slate-50 transition-colors">
                  <Stack gap={0} className="min-w-0">
                    <Text size="sm" fw={600} lineClamp={1}>{it.nombre || it.codigo}</Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>{it.organismo || '—'}</Text>
                  </Stack>
                  <Group gap={10} wrap="nowrap">
                    {it.monto ? <Text size="xs" fw={600} c="dimmed" className="whitespace-nowrap">{fmtMontoFull(it.monto)}</Text> : null}
                    <Badge size="sm" variant="light" color={d != null && d <= 3 ? 'red' : d != null && d <= 7 ? 'orange' : 'gray'}>
                      {d === 0 ? 'Hoy' : `${d}d`}
                    </Badge>
                    <ChevronRight size={14} className="text-slate-300" />
                  </Group>
                </Group>
              </Anchor>
            );
          })}
        </Stack>
      ) : (
        <Stack align="center" gap={6} py="xl"><Clock4 size={26} className="text-slate-300" /><Text size="sm" c="dimmed">Sin cierres próximos</Text></Stack>
      )}
    </PanelCard>
  );
}
