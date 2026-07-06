'use client';

// Análisis de licitación (SOLO ADMIN): tablero tipo Kanban del pipeline. Las columnas son
// las etapas (Asignado → En proceso → … → Postulada → Adjudicada) y cada licitación es una
// tarjeta en la etapa donde está, con el perfil (avatar) responsable. Arriba, KPIs del estado
// general; y un filtro por perfil. Se nutre de /api/negocios (admin = todos los negocios).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity, Loader2, RefreshCw, Building2, Calendar, MessageSquare,
  DollarSign, Send, Clock, Layers, Users,
} from 'lucide-react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { ESTADOS_PIPELINE, getEstadoPipeline } from '@/app/lib/pipeline';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  monto_ofertado: number | null;
  estado_pipeline: string;
  updated_at: string | null;
  usuario_nombre: string | null;
  usuario_email: string | null;
  comentarios_count?: number | null;
}

const fmtMonto = (n: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtMontoCorto = (n: number) => {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}MM`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
};
const diasHasta = (s: string | null): number | null => {
  if (!s) return null;
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
};

// Orden de columnas del tablero (por LABEL, así los estados legado caen en su columna).
const BOARD_LABELS = ['ASIGNADO', 'EN PROCESO', 'ANEXOS', 'ANEXO LISTO', 'VISADO', 'POSTULADA', 'POSIBLE ADJ', 'ADJUDICADA', 'PERDIDA', 'DESCARTADA'];
const colorDeLabel = (label: string) => ESTADOS_PIPELINE.find(e => e.label === label)?.color || '#64748b';
const labelDe = (estado: string) => getEstadoPipeline(estado)?.label || estado || 'ASIGNADO';
const TERMINALES = new Set(['DESCARTADA', 'PERDIDA', 'ADJUDICADA']);

export default function AnalisisLicitacionPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<string | null>(null); // filtro por email de usuario

  const esAdmin = usuario?.rol === 'admin';

  useEffect(() => {
    if (!cargandoSesion && usuario && !esAdmin) router.replace('/negocios');
  }, [cargandoSesion, usuario, esAdmin, router]);

  const cargar = async () => {
    setCargando(true); setError(null);
    try {
      const res = await fetch('/api/negocios');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar');
      setNegocios(data.negocios || []);
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  };
  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin]);

  const visibles = useMemo(
    () => negocios.filter(n => perfil == null || (n.usuario_email || n.usuario_nombre) === perfil),
    [negocios, perfil]);

  // KPIs sobre lo visible.
  const kpis = useMemo(() => {
    let monto = 0, postuladas = 0, adjudicadas = 0, cierran = 0;
    for (const n of visibles) {
      monto += n.monto_ofertado || n.licitacion_monto || 0;
      const label = labelDe(n.estado_pipeline);
      if (label === 'POSTULADA') postuladas++;
      if (label === 'ADJUDICADA') adjudicadas++;
      const d = diasHasta(n.licitacion_cierre);
      if (d != null && d >= 0 && d <= 7 && !TERMINALES.has(label)) cierran++;
    }
    return { total: visibles.length, monto, postuladas, adjudicadas, cierran };
  }, [visibles]);

  // Estados presentes en TODO el conjunto (para las columnas del dashboard, estables).
  const estadosPresentes = useMemo(() => {
    const s = new Set(negocios.map(n => labelDe(n.estado_pipeline)));
    return BOARD_LABELS.filter(l => s.has(l));
  }, [negocios]);

  // Dashboard por perfil: por cada usuario, cuántas licitaciones tiene en cada etapa + total + monto.
  const matriz = useMemo(() => {
    const g = new Map<string, { key: string; nombre: string; email: string | null; porEstado: Map<string, number>; total: number; monto: number }>();
    for (const n of negocios) {
      const key = n.usuario_email || n.usuario_nombre || 'sin';
      let e = g.get(key);
      if (!e) { e = { key, nombre: n.usuario_nombre || n.usuario_email || 'Sin asignar', email: n.usuario_email, porEstado: new Map(), total: 0, monto: 0 }; g.set(key, e); }
      const label = labelDe(n.estado_pipeline);
      e.porEstado.set(label, (e.porEstado.get(label) || 0) + 1);
      e.total++; e.monto += n.monto_ofertado || n.licitacion_monto || 0;
    }
    return [...g.values()].sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Fila de totales del dashboard.
  const totales = useMemo(() => {
    const porEstado = new Map<string, number>(); let total = 0, monto = 0;
    for (const n of negocios) {
      const l = labelDe(n.estado_pipeline);
      porEstado.set(l, (porEstado.get(l) || 0) + 1);
      total++; monto += n.monto_ofertado || n.licitacion_monto || 0;
    }
    return { porEstado, total, monto };
  }, [negocios]);

  // Columnas del tablero: label → negocios. Solo columnas con al menos 1 (o siempre las núcleo).
  const columnas = useMemo(() => {
    const g = new Map<string, Negocio[]>();
    for (const n of visibles) {
      const label = labelDe(n.estado_pipeline);
      if (!g.has(label)) g.set(label, []);
      g.get(label)!.push(n);
    }
    // Orden fijo del pipeline; se muestran solo las que tienen negocios.
    const ordenadas = BOARD_LABELS.filter(l => g.has(l)).map(l => ({ label: l, color: colorDeLabel(l), negocios: g.get(l)! }));
    // Etiquetas fuera del orden conocido (por si acaso), al final.
    for (const [l, arr] of g) if (!BOARD_LABELS.includes(l)) ordenadas.push({ label: l, color: '#64748b', negocios: arr });
    return ordenadas;
  }, [visibles]);

  if (!cargandoSesion && usuario && !esAdmin) {
    return <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}><div className="p-10 text-center text-sm text-slate-500">Redirigiendo…</div></AppLayout>;
  }

  const KPI = ({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: string; tint: string }) => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${tint}14`, color: tint }}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[17px] font-bold text-slate-900 leading-none tabular-nums">{value}</p>
        <p className="text-[11px] text-slate-400 mt-1 truncate">{label}</p>
      </div>
    </div>
  );

  return (
    <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}>
      <div className="max-w-full space-y-4">
        {/* Encabezado */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Activity size={18} />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900">Análisis de licitación</h1>
              <p className="text-xs text-slate-500">Tablero del pipeline: cada licitación en su etapa</p>
            </div>
          </div>
          <button onClick={cargar} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

        {cargando ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando…
          </div>
        ) : negocios.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Activity size={20} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">No hay licitaciones en gestión</p>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPI icon={<Layers size={17} />} label="Licitaciones en gestión" value={String(kpis.total)} tint="#4f46e5" />
              <KPI icon={<DollarSign size={17} />} label="Monto ofertado / estimado" value={fmtMontoCorto(kpis.monto)} tint="#0d9488" />
              <KPI icon={<Send size={17} />} label="Postuladas" value={String(kpis.postuladas)} tint="#b45309" />
              <KPI icon={<Clock size={17} />} label="Cierran en ≤ 7 días" value={String(kpis.cierran)} tint={kpis.cierran > 0 ? '#dc2626' : '#64748b'} />
            </div>

            {/* Dashboard por perfil: cuántas licitaciones tiene cada uno en cada etapa.
                La fila es clickeable → filtra el tablero por ese perfil. */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
                <Users size={13} className="text-slate-400" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Licitaciones por perfil y etapa</span>
                {perfil != null && (
                  <button onClick={() => setPerfil(null)}
                    className="ml-auto text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">Ver todos</button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-max">
                  <thead>
                    <tr className="text-[10.5px] text-slate-400 uppercase tracking-wide">
                      <th className="font-semibold px-4 py-2 sticky left-0 bg-white">Perfil</th>
                      {estadosPresentes.map(l => (
                        <th key={l} className="font-semibold px-2.5 py-2 text-center whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: colorDeLabel(l) }} />{l}
                          </span>
                        </th>
                      ))}
                      <th className="font-bold px-3 py-2 text-center">Total</th>
                      <th className="font-semibold px-4 py-2 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {matriz.map(p => {
                      const col = colorUsuario(p.email || p.key);
                      const activo = perfil === p.key;
                      return (
                        <tr key={p.key} onClick={() => setPerfil(activo ? null : p.key)}
                          className={`cursor-pointer transition-colors ${activo ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                          <td className={`px-4 py-2 sticky left-0 ${activo ? 'bg-indigo-50' : 'bg-white'}`}>
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ background: col }}>
                                {inicialesUsuario(p.nombre, p.email)}
                              </span>
                              <span className="text-[12.5px] font-semibold text-slate-700 truncate max-w-[140px]">{p.nombre}</span>
                            </div>
                          </td>
                          {estadosPresentes.map(l => {
                            const c = p.porEstado.get(l) || 0;
                            return (
                              <td key={l} className="px-2.5 py-2 text-center">
                                {c > 0
                                  ? <span className="inline-flex items-center justify-center min-w-[22px] text-[12px] font-bold tabular-nums px-1.5 py-0.5 rounded-md" style={{ background: `${colorDeLabel(l)}14`, color: colorDeLabel(l) }}>{c}</span>
                                  : <span className="text-slate-200">·</span>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center text-[13px] font-bold text-slate-900 tabular-nums">{p.total}</td>
                          <td className="px-4 py-2 text-right text-[12px] font-semibold text-slate-600 tabular-nums whitespace-nowrap">{fmtMontoCorto(p.monto)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/60">
                      <td className="px-4 py-2 text-[11px] font-bold text-slate-500 uppercase sticky left-0 bg-slate-50/60">Total</td>
                      {estadosPresentes.map(l => (
                        <td key={l} className="px-2.5 py-2 text-center text-[12px] font-bold text-slate-700 tabular-nums">{totales.porEstado.get(l) || 0}</td>
                      ))}
                      <td className="px-3 py-2 text-center text-[13px] font-extrabold text-slate-900 tabular-nums">{totales.total}</td>
                      <td className="px-4 py-2 text-right text-[12px] font-bold text-slate-700 tabular-nums whitespace-nowrap">{fmtMontoCorto(totales.monto)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Tablero Kanban */}
            <div className="overflow-x-auto pb-3 -mx-1 px-1">
              <div className="flex gap-3 min-w-max">
                {columnas.map(col => (
                  <div key={col.label} className="w-[264px] flex-shrink-0 flex flex-col">
                    {/* Cabecera de columna */}
                    <div className="flex items-center gap-2 px-1 mb-2 sticky top-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.color }} />
                      <span className="text-[12px] font-bold text-slate-700 uppercase tracking-wide truncate">{col.label}</span>
                      <span className="ml-auto text-[11px] font-bold text-slate-400 tabular-nums bg-slate-100 px-1.5 py-0.5 rounded-md">{col.negocios.length}</span>
                    </div>
                    {/* Tarjetas */}
                    <div className="space-y-2 rounded-xl p-1.5" style={{ background: `${col.color}0a` }}>
                      {col.negocios.map(n => {
                        const col2 = colorUsuario(n.usuario_email || n.usuario_nombre || 'sin');
                        const d = diasHasta(n.licitacion_cierre);
                        const cierreTint = d != null && d >= 0 ? (d <= 3 ? '#dc2626' : d <= 7 ? '#d97706' : '#64748b') : '#64748b';
                        return (
                          <Link key={n.id} href={`/negocios/${n.id}`}
                            className="block bg-white rounded-lg border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all p-3 group">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[10px] font-mono font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded truncate">{n.licitacion_codigo}</span>
                              {(n.comentarios_count ?? 0) > 0 && (
                                <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-slate-400" title="Comentarios">
                                  <MessageSquare size={10} /> {n.comentarios_count}
                                </span>
                              )}
                            </div>
                            <p className="text-[12.5px] font-semibold text-slate-800 leading-snug line-clamp-2 group-hover:text-indigo-700 transition-colors">
                              {n.licitacion_nombre || '(sin nombre)'}
                            </p>
                            {n.licitacion_organismo && (
                              <p className="text-[10.5px] text-slate-400 mt-1 flex items-center gap-1 truncate"><Building2 size={9} /> {n.licitacion_organismo}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-50">
                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                                style={{ background: col2 }} title={n.usuario_nombre || n.usuario_email || ''}>
                                {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-700 tabular-nums">{fmtMontoCorto(n.monto_ofertado || n.licitacion_monto || 0)}</span>
                              <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-medium tabular-nums" style={{ color: cierreTint }}>
                                <Calendar size={9} /> {fmtFecha(n.licitacion_cierre)}
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
