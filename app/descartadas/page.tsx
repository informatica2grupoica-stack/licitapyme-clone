'use client';

// Apartado "Descartadas" (solo admin): todas las licitaciones descartadas con quién las
// descartó, el motivo, la fecha y acceso al detalle. Se nutre de /api/negocios/descartadas.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Ban, Loader2, ExternalLink, Building2, Calendar, User, RefreshCw, RotateCcw, BarChart3, X, Filter, Users, Tag } from 'lucide-react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';

// El motivo se persiste como "<motivo del catálogo> — <comentario libre>". Para el KPI
// agrupamos por el motivo base (lo anterior al " — ").
const motivoBase = (m: string | null): string => {
  const s = (m || '').trim();
  if (!s) return '(sin motivo)';
  return s.split(' — ')[0].trim() || '(sin motivo)';
};

interface UsuarioLite { id: number; nombre: string | null; email: string; }

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

const fmtMonto = (n: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function DescartadasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Descartada[]>([]);
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
  const hayFiltro = filtroUsuario.length > 0 || filtroMotivo.length > 0 || filtroTipo.length > 0;
  const limpiarFiltros = () => { setFiltroUsuario([]); setFiltroMotivo([]); setFiltroTipo([]); };

  const esAdmin = usuario?.rol === 'admin';

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
  const itemsFiltrados = useMemo(() => items.filter(d =>
    (filtroUsuario.length === 0 || filtroUsuario.includes(String(d.asignado_a))) &&
    (filtroMotivo.length === 0 || filtroMotivo.includes(motivoBase(d.descarte_motivo))) &&
    (filtroTipo.length === 0 || (!!d.licitacion_tipo && filtroTipo.includes(d.licitacion_tipo))),
  ), [items, filtroUsuario, filtroMotivo, filtroTipo]);

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

  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin]);

  if (!cargandoSesion && usuario && !esAdmin) {
    return <AppLayout breadcrumb={[{ label: 'Descartadas' }]}><div className="p-10 text-center text-sm text-slate-500">Redirigiendo…</div></AppLayout>;
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Descartadas' }]}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
              <Ban size={18} />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900">Licitaciones descartadas</h1>
              <p className="text-xs text-slate-500">Quién la descartó, el motivo y el detalle de cada una</p>
            </div>
          </div>
          <button onClick={cargar} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

        {/* ── Barra de filtros (selección múltiple) ── */}
        {!cargando && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
            <MultiSelect
              label={filtroUsuario.length ? 'Perfiles' : 'Todos los perfiles'}
              icon={<Users size={13} />}
              options={kpi.usuarios.map(u => ({ value: String(u.id), label: u.nombre, color: colorUsuario(u.email || u.id), count: u.total }))}
              selected={filtroUsuario}
              onChange={setFiltroUsuario}
            />
            <MultiSelect
              label={filtroMotivo.length ? 'Motivos' : 'Todos los motivos'}
              icon={<Ban size={13} />}
              options={kpi.motivos.map(m => ({ value: m.motivo, label: m.motivo, count: m.total }))}
              selected={filtroMotivo}
              onChange={setFiltroMotivo}
            />
            {tiposPresentes.length > 0 && (
              <MultiSelect
                label={filtroTipo.length ? 'Tipos' : 'Todos los tipos'}
                icon={<Tag size={13} />}
                options={tiposPresentes.map(t => ({ value: t, label: t }))}
                selected={filtroTipo}
                onChange={setFiltroTipo}
              />
            )}
            {hayFiltro && (
              <button onClick={limpiarFiltros}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-2 rounded-lg transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
            <span className="ml-auto text-[12px] text-slate-400 tabular-nums">
              {itemsFiltrados.length}{hayFiltro ? ` de ${items.length}` : ''} descartada{itemsFiltrados.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* ── KPI de descartadas: por usuario (cantidad) + motivos, con colores consistentes ── */}
        {!cargando && items.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={15} className="text-slate-500" />
              <h2 className="text-[13px] font-bold text-slate-800">Descartadas por usuario</h2>
              {hayFiltro && (
                <button onClick={limpiarFiltros}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition-colors">
                  <X size={12} /> Limpiar filtros
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
              {kpi.usuarios.map(u => {
                const col = colorUsuario(u.email || u.id);
                const activo = filtroUsuario.includes(String(u.id));
                return (
                  <button key={u.id}
                    onClick={() => setFiltroUsuario(activo ? filtroUsuario.filter(x => x !== String(u.id)) : [...filtroUsuario, String(u.id)])}
                    className={`text-left rounded-lg px-2 py-1.5 transition-colors ${activo ? 'bg-slate-100 ring-1 ring-slate-300' : 'hover:bg-slate-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: col }}>
                        {inicialesUsuario(u.nombre, u.email)}
                      </span>
                      <span className="text-[12.5px] font-semibold text-slate-700 truncate flex-1">{u.nombre}</span>
                      <span className="text-[13px] font-bold text-slate-900 tabular-nums">{u.total}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(u.total / kpi.max) * 100}%`, background: col }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Motivos (chips filtrables): cantidad por motivo base sobre todas las descartadas */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Motivos</p>
              <div className="flex flex-wrap gap-1.5">
                {kpi.motivos.map(m => {
                  const activo = filtroMotivo.includes(m.motivo);
                  return (
                    <button key={m.motivo}
                      onClick={() => setFiltroMotivo(activo ? filtroMotivo.filter(x => x !== m.motivo) : [...filtroMotivo, m.motivo])}
                      className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1 rounded-full border transition-colors ${activo ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-red-300 hover:bg-red-50'}`}>
                      {m.motivo}
                      <span className={`text-[10.5px] font-bold tabular-nums ${activo ? 'text-white' : 'text-red-600'}`}>{m.total}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-red-500" /> Cargando descartadas…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Ban size={20} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">No hay licitaciones descartadas</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-400 font-medium">
              {itemsFiltrados.length} descartada{itemsFiltrados.length !== 1 ? 's' : ''}
              {hayFiltro && ` de ${items.length}`}
            </p>
            {itemsFiltrados.length === 0 && (
              <p className="text-sm text-slate-500 py-6 text-center">Ninguna descartada coincide con el filtro.</p>
            )}
            {itemsFiltrados.map(d => (
              <div key={d.id} className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-red-500 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded">{d.licitacion_codigo}</span>
                      {d.licitacion_tipo && <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{d.licitacion_tipo}</span>}
                    </div>
                    <p className="text-[13.5px] font-semibold text-slate-800 mt-1 leading-snug">{d.licitacion_nombre || '(sin nombre)'}</p>
                    {d.licitacion_organismo && (
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><Building2 size={11} /> {d.licitacion_organismo}</p>
                    )}
                  </div>
                  <Link href={`/licitacion/${encodeURIComponent(d.licitacion_codigo)}`}
                    className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors">
                    <ExternalLink size={13} /> Ver detalle
                  </Link>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                  <div>
                    <p className="text-slate-400">Monto</p>
                    <p className="font-semibold text-slate-700">{fmtMonto(d.licitacion_monto)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 flex items-center gap-1"><Calendar size={10} /> Cierre</p>
                    <p className="font-semibold text-slate-700">{fmtFecha(d.licitacion_cierre)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 flex items-center gap-1"><User size={10} /> Asignada a</p>
                    <p className="font-semibold text-slate-700 truncate">{d.asignado_nombre || d.asignado_email || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Descartó</p>
                    <p className="font-semibold text-slate-700 truncate">{d.descarte_por_nombre || d.descarte_por_email || '—'} · {fmtFecha(d.descarte_at)}</p>
                  </div>
                </div>

                <div className="mt-2.5 px-3 py-2 bg-red-50/70 border border-red-100 rounded-lg">
                  <p className="text-[11px] font-semibold text-red-700 mb-0.5">Motivo del descarte</p>
                  <p className="text-[12.5px] text-slate-700">{d.descarte_motivo || '(sin motivo registrado)'}</p>
                </div>

                {/* Recuperar: reactivar (a ASIGNADO) y opcionalmente reasignar a otro usuario. */}
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-medium">Volver a trabajar:</span>
                  <select
                    value={reasignarSel[d.id] ?? d.asignado_a}
                    onChange={e => setReasignarSel(prev => ({ ...prev, [d.id]: Number(e.target.value) }))}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:ring-1 focus:ring-emerald-500 outline-none"
                  >
                    {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.email}</option>)}
                  </select>
                  <button
                    onClick={() => reactivar(d)}
                    disabled={procesando === d.id}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {procesando === d.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    Reactivar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
