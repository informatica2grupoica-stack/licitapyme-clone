'use client';

// Apartado "Descartadas" (solo admin): todas las licitaciones descartadas con quién las
// descartó, el motivo, la fecha y acceso al detalle. Se nutre de /api/negocios/descartadas.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconBan as Ban, IconLoader2 as Loader2, IconExternalLink as ExternalLink, IconBuilding as Building2, IconCalendar as Calendar, IconUser as User, IconRefresh as RefreshCw, IconRotate2 as RotateCcw, IconChartBar as BarChart3, IconX as X, IconFilter as Filter, IconUsers as Users, IconTag as Tag, IconSearch as Search } from '@tabler/icons-react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Datos, Dato } from '@/app/components/ui/kit/Tarjeta';
import { Banner } from '@/app/components/ui/Banner';

// El motivo se persiste como "<motivo del catálogo> — <comentario libre>". Para el KPI
// agrupamos por el motivo base (lo anterior al " — ").
const motivoBase = (m: string | null): string => {
  const s = (m || '').trim();
  if (!s) return '(sin motivo)';
  return s.split(' — ')[0].trim() || '(sin motivo)';
};

interface UsuarioLite { id: number; nombre: string | null; email: string; }

// Descarte hecho desde el RADAR (tabla licitaciones_descartadas): nunca llegó a Negocios.
interface DescartadaRadar {
  licitacion_codigo: string;
  motivo: string | null;
  created_at: string | null;
  descartada_por_nombre: string | null;
  descartada_por_email: string | null;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_tipo: string | null;
}

interface Descartada {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_tipo: string | null;
  asignado_a: number;
  descarte_motivo: string | null;
  descarte_at: string | null;
  asignado_nombre: string | null;
  asignado_email: string | null;
  descarte_por_nombre: string | null;
  descarte_por_email: string | null;
}

// ¿Una fecha cae dentro del rango [desde, hasta]? (ambos opcionales, formato yyyy-mm-dd)
const enRango = (fecha: string | null, desde: string, hasta: string): boolean => {
  if (!desde && !hasta) return true;
  if (!fecha) return false;
  const t = new Date(fecha).getTime();
  if (isNaN(t)) return false;
  if (desde && t < new Date(`${desde}T00:00:00`).getTime()) return false;
  if (hasta && t > new Date(`${hasta}T23:59:59`).getTime()) return false;
  return true;
};

const fmtMonto = (n: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';

export default function DescartadasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Descartada[]>([]);
  const [radarItems, setRadarItems] = useState<DescartadaRadar[]>([]);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioLite[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Usuario elegido para reasignar al reactivar (por negocio) + fila en proceso.
  const [reasignarSel, setReasignarSel] = useState<Record<number, number>>({});
  const [procesando, setProcesando] = useState<number | null>(null);
  // Filtros de SELECCIÓN MÚLTIPLE: por usuario asignado, por motivo base y por tipo.
  const [filtroUsuario, setFiltroUsuario] = useState<string[]>([]);
  const [filtroMotivo, setFiltroMotivo] = useState<string[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<string[]>([]);
  // Buscador (nombre, código u organismo) + rango de la FECHA DE DESCARTE.
  const [busqueda, setBusqueda] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const hayFiltro = filtroUsuario.length > 0 || filtroMotivo.length > 0 || filtroTipo.length > 0
    || busqueda.trim() !== '' || fechaDesde !== '' || fechaHasta !== '';
  const limpiarFiltros = () => {
    setFiltroUsuario([]); setFiltroMotivo([]); setFiltroTipo([]);
    setBusqueda(''); setFechaDesde(''); setFechaHasta('');
  };

  const esAdmin = !!usuario?.permisos?.ver_descartadas;   // casilla «Ver Descartadas» (admin la tiene siempre)

  // Agregados del KPI: por usuario (cantidad) y matriz usuario × motivo. Se calcula sobre
  // TODAS las descartadas (no sobre la lista filtrada), para que los totales no bailen.
  const kpi = useMemo(() => {
    const porUsuario = new Map<number, { id: number; nombre: string; email: string | null; total: number; motivos: Map<string, number> }>();
    const motivosGlobal = new Map<string, number>();
    for (const d of items) {
      const uid = d.asignado_a;
      if (!porUsuario.has(uid)) porUsuario.set(uid, { id: uid, nombre: d.asignado_nombre || d.asignado_email || `Usuario ${uid}`, email: d.asignado_email, total: 0, motivos: new Map() });
      const u = porUsuario.get(uid)!;
      u.total++;
      const mb = motivoBase(d.descarte_motivo);
      u.motivos.set(mb, (u.motivos.get(mb) || 0) + 1);
      motivosGlobal.set(mb, (motivosGlobal.get(mb) || 0) + 1);
    }
    const usuarios = [...porUsuario.values()].sort((a, b) => b.total - a.total);
    const motivos = [...motivosGlobal.entries()].map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total);
    return { usuarios, motivos, max: usuarios[0]?.total || 1 };
  }, [items]);

  // Tipos presentes (para el filtro).
  const tiposPresentes = useMemo(() => {
    const s = new Set<string>();
    for (const d of items) if (d.licitacion_tipo) s.add(d.licitacion_tipo);
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [items]);

  // Lista filtrada (selección múltiple: si un filtro está vacío no restringe).
  const q = busqueda.trim().toLowerCase();
  const itemsFiltrados = useMemo(() => items.filter(d =>
    (filtroUsuario.length === 0 || filtroUsuario.includes(String(d.asignado_a))) &&
    (filtroMotivo.length === 0 || filtroMotivo.includes(motivoBase(d.descarte_motivo))) &&
    (filtroTipo.length === 0 || (!!d.licitacion_tipo && filtroTipo.includes(d.licitacion_tipo))) &&
    (!q || d.licitacion_codigo.toLowerCase().includes(q)
        || (d.licitacion_nombre || '').toLowerCase().includes(q)
        || (d.licitacion_organismo || '').toLowerCase().includes(q)) &&
    enRango(d.descarte_at, fechaDesde, fechaHasta),
  ), [items, filtroUsuario, filtroMotivo, filtroTipo, q, fechaDesde, fechaHasta]);

  // La sección del radar comparte buscador, rango de fechas y tipo. Los filtros de
  // usuario/motivo son propios de Negocios (los descartes del radar no tienen perfil asignado).
  const radarFiltrados = useMemo(() => radarItems.filter(r =>
    (filtroTipo.length === 0 || (!!r.licitacion_tipo && filtroTipo.includes(r.licitacion_tipo))) &&
    (!q || r.licitacion_codigo.toLowerCase().includes(q)
        || (r.licitacion_nombre || '').toLowerCase().includes(q)
        || (r.licitacion_organismo || '').toLowerCase().includes(q)) &&
    enRango(r.created_at, fechaDesde, fechaHasta),
  ), [radarItems, filtroTipo, q, fechaDesde, fechaHasta]);

  useEffect(() => {
    if (!cargandoSesion && usuario && !esAdmin) router.replace('/negocios');
  }, [cargandoSesion, usuario, esAdmin, router]);

  const cargar = async () => {
    setCargando(true); setError(null);
    try {
      const res = await fetch('/api/negocios/descartadas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar');
      setItems(data.descartadas || []);
      setRadarItems(data.radar || []);
      setUsuarios(data.usuarios || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  // Reactivar: vuelve a estado ASIGNADO (limpia el descarte) y, si se eligió otro usuario,
  // reasigna. Al revisarla puede volver a trabajarse.
  const reactivar = async (d: Descartada) => {
    setProcesando(d.id);
    try {
      const destino = reasignarSel[d.id] ?? d.asignado_a;
      const res = await fetch(`/api/negocios/${d.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: 'ASIGNADO', asignado_a: destino }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al reactivar');
      setItems(prev => prev.filter(x => x.id !== d.id));
      toast.success('Licitación reactivada', 'Volvió a Negocios como asignada');
    } catch (e: any) {
      toast.error('No se pudo reactivar', e?.message);
    } finally {
      setProcesando(null);
    }
  };

  // Restaurar un descarte del radar: vuelve a la vista base del radar.
  const restaurarRadar = async (codigo: string) => {
    setRestaurando(codigo);
    try {
      const res = await fetch('/api/radar/descartar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos: [codigo], descartar: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al restaurar');
      setRadarItems(prev => prev.filter(r => r.licitacion_codigo !== codigo));
      toast.success('Restaurada al radar', 'Vuelve a aparecer entre las activas');
    } catch (e: any) {
      toast.error('No se pudo restaurar', e?.message);
    } finally {
      setRestaurando(null);
    }
  };

  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin]);

  if (!cargandoSesion && usuario && !esAdmin) {
    return <AppLayout breadcrumb={[{ label: 'Descartadas' }]}><div className="@container p-10 text-center text-sm text-tinta-2 dark:text-slate-400">Redirigiendo…</div></AppLayout>;
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Descartadas' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-4">
        <Encabezado
          titulo="Licitaciones descartadas"
          descripcion="Los descartes de Negocios (con responsable) y los del Radar, con quién, cuándo y por qué."
          acciones={
            <Boton onClick={cargar} disabled={cargando} aria-label="Recargar la lista" title="Recargar la lista" className="!px-0 w-9">
              <RefreshCw size={16} stroke={1.75} className={cargando ? 'animate-spin text-slate-400' : 'text-slate-400'} />
            </Boton>
          }
        />

        {error && <Banner variante="error">{error}</Banner>}

        {/* ── Barra de filtros (buscador + fechas + selección múltiple) ── */}
        {!cargando && (items.length > 0 || radarItems.length > 0) && (
          <div className={`flex flex-wrap items-center gap-2 p-3 ${SUPERFICIE}`}>
            <span className="text-[13px] font-medium text-tinta-2 dark:text-slate-400 flex items-center gap-1.5 mr-1"><Filter size={16} stroke={1.75} className="text-slate-400" /> Filtros</span>
            <div className="relative flex-1 min-w-[210px]">
              <Search size={16} stroke={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, código u organismo…"
                aria-label="Buscar descartadas"
                title="Busca en el nombre de la licitación, su código (ej: 1499887-11-LE26) y el organismo. Aplica a ambas secciones."
                className="h-9 w-full pl-9 pr-8 border border-linea dark:border-slate-700 rounded-lg text-[13px] text-tinta dark:text-slate-100 placeholder:text-tinta-3 bg-white dark:bg-slate-900 focus-visible:ring-2 focus-visible:ring-marca/60 outline-none"
              />
              {busqueda && (
                <button onClick={() => setBusqueda('')} title="Limpiar búsqueda" aria-label="Limpiar búsqueda"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-tinta"><X size={16} stroke={1.75} /></button>
              )}
            </div>
            <div className="inline-flex h-9 items-center gap-1.5 border border-linea dark:border-slate-700 rounded-lg px-2.5 bg-white dark:bg-slate-900"
              title="Rango de la FECHA DEL DESCARTE (cuándo se descartó, no cuándo cierra la licitación)">
              <Calendar size={16} stroke={1.75} className="text-slate-400 flex-shrink-0" />
              <input type="date" value={fechaDesde} max={fechaHasta || undefined} aria-label="Descartada desde"
                onChange={e => setFechaDesde(e.target.value)}
                className="text-[13px] text-tinta dark:text-slate-100 outline-none bg-transparent w-[118px]" />
              <span className="text-tinta-3 text-xs">→</span>
              <input type="date" value={fechaHasta} min={fechaDesde || undefined} aria-label="Descartada hasta"
                onChange={e => setFechaHasta(e.target.value)}
                className="text-[13px] text-tinta dark:text-slate-100 outline-none bg-transparent w-[118px]" />
              {(fechaDesde || fechaHasta) && (
                <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                  title="Limpiar fechas" aria-label="Limpiar fechas" className="text-slate-400 hover:text-urgente"><X size={16} stroke={1.75} /></button>
              )}
            </div>
            <MultiSelect
              label={filtroUsuario.length ? 'Perfiles' : 'Todos los perfiles'}
              icon={<Users size={14} />}
              options={kpi.usuarios.map(u => ({ value: String(u.id), label: u.nombre, color: colorUsuario(u.email || u.id), count: u.total }))}
              selected={filtroUsuario}
              onChange={setFiltroUsuario}
            />
            <MultiSelect
              label={filtroMotivo.length ? 'Motivos' : 'Todos los motivos'}
              icon={<Ban size={14} />}
              options={kpi.motivos.map(m => ({ value: m.motivo, label: m.motivo, count: m.total }))}
              selected={filtroMotivo}
              onChange={setFiltroMotivo}
            />
            {tiposPresentes.length > 0 && (
              <MultiSelect
                label={filtroTipo.length ? 'Tipos' : 'Todos los tipos'}
                icon={<Tag size={14} />}
                options={tiposPresentes.map(t => ({ value: t, label: t }))}
                selected={filtroTipo}
                onChange={setFiltroTipo}
              />
            )}
            {hayFiltro && (
              <Boton variante="fantasma" onClick={limpiarFiltros} icono={<X size={16} stroke={1.75} />}>Limpiar</Boton>
            )}
            <span className="ml-auto text-xs text-tinta-2 dark:text-slate-400 tabular-nums"
              title="Descartes de Negocios + descartes del Radar que pasan los filtros actuales">
              {itemsFiltrados.length + radarFiltrados.length}
              {hayFiltro ? ` de ${items.length + radarItems.length}` : ''} descartada{(itemsFiltrados.length + radarFiltrados.length) !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* ── Descartadas por usuario (cantidad) + motivos: se tocan para filtrar ── */}
        {!cargando && items.length > 0 && (
          <div className={`${SUPERFICIE} p-5`}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={18} stroke={1.75} className="text-slate-400" />
              <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Descartadas por usuario</h2>
              {hayFiltro && (
                <Boton variante="fantasma" tamano="sm" onClick={limpiarFiltros} className="ml-auto" icono={<X size={16} stroke={1.75} />}>Limpiar filtros</Boton>
              )}
            </div>

            <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-x-6 gap-y-2">
              {kpi.usuarios.map(u => {
                const col = colorUsuario(u.email || u.id);
                const activo = filtroUsuario.includes(String(u.id));
                return (
                  <button key={u.id} aria-pressed={activo}
                    onClick={() => setFiltroUsuario(activo ? filtroUsuario.filter(x => x !== String(u.id)) : [...filtroUsuario, String(u.id)])}
                    className={`text-left rounded-lg px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${activo ? 'bg-marca-suave ring-1 ring-teal-300' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0" style={{ background: col }}>
                        {inicialesUsuario(u.nombre, u.email)}
                      </span>
                      <span className="text-[13px] font-medium text-tinta dark:text-slate-200 truncate flex-1">{u.nombre}</span>
                      <span className="text-[13px] font-semibold text-tinta dark:text-slate-100 tabular-nums">{u.total}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(u.total / kpi.max) * 100}%`, background: col }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Motivos (filtrables): cantidad por motivo base sobre todas las descartadas */}
            <div className="mt-4 pt-4 border-t border-linea dark:border-slate-800">
              <p className="text-[13px] font-medium text-tinta dark:text-slate-100 mb-2">Motivos</p>
              <div className="flex flex-wrap gap-1.5">
                {kpi.motivos.map(m => {
                  const activo = filtroMotivo.includes(m.motivo);
                  return (
                    <button key={m.motivo} aria-pressed={activo}
                      onClick={() => setFiltroMotivo(activo ? filtroMotivo.filter(x => x !== m.motivo) : [...filtroMotivo, m.motivo])}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${activo ? 'border-marca bg-marca-suave text-marca' : 'border-linea bg-white text-tinta-2 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                      {m.motivo}
                      <span className="text-xs font-semibold tabular-nums">{m.total}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="space-y-2.5">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-40 rounded-xl" />)}</div>
        ) : items.length === 0 ? (
          <Vacio icono={<Ban size={28} stroke={1.75} />} titulo="No hay licitaciones descartadas" texto="Cuando alguien descarte una licitación de Negocios, aparecerá aquí con su motivo." />
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
              {itemsFiltrados.length} descartada{itemsFiltrados.length !== 1 ? 's' : ''}
              {hayFiltro && ` de ${items.length}`}
            </p>
            {itemsFiltrados.length === 0 && (
              <p className="text-sm text-tinta-2 dark:text-slate-400 py-6 text-center">Ninguna descartada coincide con el filtro.</p>
            )}
            {itemsFiltrados.map(d => (
              <div key={d.id} className={`${SUPERFICIE} px-4 py-3.5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 flex-wrap text-xs text-tinta-2 dark:text-slate-400">
                      <span className="font-mono">{d.licitacion_codigo}</span>
                      {d.licitacion_tipo && <span>· {d.licitacion_tipo}</span>}
                    </p>
                    <p className="text-[15px] font-semibold text-tinta dark:text-slate-100 mt-0.5 leading-snug">{d.licitacion_nombre || '(sin nombre)'}</p>
                    {d.licitacion_organismo && (
                      <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5 flex items-center gap-1"><Building2 size={14} stroke={1.75} /> {d.licitacion_organismo}</p>
                    )}
                  </div>
                  <Link href={`/licitacion/${encodeURIComponent(d.licitacion_codigo)}`}
                    className="flex-shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                    <ExternalLink size={16} stroke={1.75} /> Ver detalle
                  </Link>
                </div>

                <Datos columnas={4}>
                  <Dato rotulo="Monto">{fmtMonto(d.licitacion_monto)}</Dato>
                  <Dato rotulo="Cierre">{fmtFecha(d.licitacion_cierre)}</Dato>
                  <Dato rotulo="Asignada a">{d.asignado_nombre || d.asignado_email || undefined}</Dato>
                  <Dato rotulo="Descartó">{`${d.descarte_por_nombre || d.descarte_por_email || '—'} · ${fmtFecha(d.descarte_at)}`}</Dato>
                </Datos>

                <div className="mt-3 pt-3 border-t border-linea dark:border-slate-800">
                  <p className="text-[11px] text-tinta-2 dark:text-slate-400">Motivo del descarte</p>
                  <p className="mt-0.5 text-[13px] text-tinta dark:text-slate-100">{d.descarte_motivo || '(sin motivo registrado)'}</p>
                </div>

                {/* Recuperar: reactivar (a ASIGNADO) y opcionalmente reasignar a otro usuario. */}
                <div className="mt-3 pt-3 border-t border-linea dark:border-slate-800 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-tinta-2 dark:text-slate-400">Volver a trabajar con</span>
                  <Select
                    value={String(reasignarSel[d.id] ?? d.asignado_a)}
                    onChange={v => setReasignarSel(prev => ({ ...prev, [d.id]: Number(v) }))}
                    minWidth={190}
                    options={usuarios.map(u => ({ value: String(u.id), label: u.nombre || u.email }))} />
                  <Boton variante="primario" tamano="sm" onClick={() => reactivar(d)} disabled={procesando === d.id}
                    icono={procesando === d.id ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} stroke={1.75} />}>
                    {procesando === d.id ? 'Reactivando…' : 'Reactivar'}
                  </Boton>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Descartadas desde el RADAR (nunca llegaron a Negocios) ── */}
        {!cargando && radarFiltrados.length > 0 && (
          <div className="pt-2">
            <div className="flex items-baseline gap-2 flex-wrap mb-3">
              <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Descartadas desde el Radar</h2>
              <span className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
                {radarFiltrados.length}{hayFiltro && radarFiltrados.length !== radarItems.length ? ` de ${radarItems.length}` : ''} · sacadas del radar antes de asignarse a un perfil; se pueden restaurar
              </span>
            </div>
            <div className="space-y-2">
              {radarFiltrados.map(r => (
                <div key={r.licitacion_codigo} className={`${SUPERFICIE} px-4 py-3.5`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 flex-wrap text-xs text-tinta-2 dark:text-slate-400">
                        <span className="font-mono">{r.licitacion_codigo}</span>
                        {r.licitacion_tipo && <span>· {r.licitacion_tipo}</span>}
                      </p>
                      <p className="text-[15px] font-semibold text-tinta dark:text-slate-100 mt-0.5 leading-snug">{r.licitacion_nombre || '(sin nombre en el radar)'}</p>
                      <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                        {r.licitacion_organismo && <span className="inline-flex items-center gap-1"><Building2 size={14} stroke={1.75} /> {r.licitacion_organismo}</span>}
                        <span className="tabular-nums">{fmtMonto(r.licitacion_monto)}</span>
                        {r.licitacion_cierre && <span className="inline-flex items-center gap-1"><Calendar size={14} stroke={1.75} /> Cierre {fmtFecha(r.licitacion_cierre)}</span>}
                      </p>
                      <p className="text-xs text-tinta-2 dark:text-slate-400 mt-1">
                        <span className="font-medium text-tinta dark:text-slate-200">{r.descartada_por_nombre || r.descartada_por_email || '—'}</span>
                        {' '}la descartó el {fmtFecha(r.created_at)}{r.motivo ? ` · Motivo: ${r.motivo}` : ' · (sin motivo)'}
                      </p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1.5">
                      <Link href={`/licitacion/${encodeURIComponent(r.licitacion_codigo)}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                        <ExternalLink size={16} stroke={1.75} /> Ver
                      </Link>
                      <Boton variante="primario" tamano="sm" onClick={() => restaurarRadar(r.licitacion_codigo)} disabled={restaurando === r.licitacion_codigo}
                        title="Devolverla a la vista base del radar"
                        icono={restaurando === r.licitacion_codigo ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} stroke={1.75} />}>
                        {restaurando === r.licitacion_codigo ? 'Restaurando…' : 'Restaurar'}
                      </Boton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
