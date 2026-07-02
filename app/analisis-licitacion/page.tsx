'use client';

// Análisis de licitación (SOLO ADMIN): seguimiento que cada usuario hace a sus
// licitaciones asignadas. Muestra, por usuario (con su color consistente), en qué punto
// del FLUJO (pipeline) está cada licitación, más un embudo global de estados. Se nutre de
// /api/negocios (que para admin devuelve TODOS los negocios activos).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, Loader2, RefreshCw, ExternalLink, Building2, Calendar, MessageSquare, X } from 'lucide-react';
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
interface UsuarioLite { id: number; nombre: string | null; email: string; }

const fmtMonto = (n: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
};

function EstadoChip({ id }: { id: string }) {
  const e = getEstadoPipeline(id);
  const color = e?.color || '#64748b';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${color}18`, color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {e?.label || id}
    </span>
  );
}

export default function AnalisisLicitacionPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioLite[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null);

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
      setUsuarios(data.usuarios || []);
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  };
  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin]);

  // Embudo global: cantidad por estado, en el orden del pipeline.
  const funnel = useMemo(() => {
    const cont = new Map<string, number>();
    for (const n of negocios) cont.set(n.estado_pipeline, (cont.get(n.estado_pipeline) || 0) + 1);
    return ESTADOS_PIPELINE.map(e => ({ ...e, total: cont.get(e.id) || 0 })).filter(e => e.total > 0);
  }, [negocios]);

  // Negocios filtrados por estado (para las tarjetas por usuario).
  const visibles = useMemo(
    () => negocios.filter(n => filtroEstado == null || n.estado_pipeline === filtroEstado),
    [negocios, filtroEstado]);

  // Agrupación por usuario asignado.
  const porUsuario = useMemo(() => {
    const g = new Map<string, { key: string; nombre: string; email: string | null; negocios: Negocio[] }>();
    for (const n of visibles) {
      const key = n.usuario_email || n.usuario_nombre || 'sin';
      if (!g.has(key)) g.set(key, { key, nombre: n.usuario_nombre || n.usuario_email || 'Sin asignar', email: n.usuario_email, negocios: [] });
      g.get(key)!.negocios.push(n);
    }
    return [...g.values()].sort((a, b) => b.negocios.length - a.negocios.length);
  }, [visibles]);

  if (!cargandoSesion && usuario && !esAdmin) {
    return <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}><div className="p-10 text-center text-sm text-slate-500">Redirigiendo…</div></AppLayout>;
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Activity size={18} />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900">Análisis de licitación</h1>
              <p className="text-xs text-slate-500">Seguimiento por usuario y flujo de cada licitación en el pipeline</p>
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
            {/* Embudo global del pipeline (chips filtrables) */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-[13px] font-bold text-slate-800">Flujo global</h2>
                <span className="text-[11px] text-slate-400">{negocios.length} en gestión</span>
                {filtroEstado != null && (
                  <button onClick={() => setFiltroEstado(null)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition-colors">
                    <X size={12} /> Ver todos
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {funnel.map(e => {
                  const activo = filtroEstado === e.id;
                  return (
                    <button key={e.id} onClick={() => setFiltroEstado(activo ? null : e.id)}
                      className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-all"
                      style={activo
                        ? { background: e.color, borderColor: e.color, color: '#fff' }
                        : { background: `${e.color}12`, borderColor: `${e.color}40`, color: e.color }}>
                      {e.label}
                      <span className="text-[10.5px] font-bold tabular-nums">{e.total}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Por usuario: seguimiento de sus licitaciones */}
            <div className="space-y-3">
              {porUsuario.map(u => {
                const col = colorUsuario(u.email || u.key);
                // Distribución de estados de este usuario (mini-flujo)
                const dist = new Map<string, number>();
                for (const n of u.negocios) dist.set(n.estado_pipeline, (dist.get(n.estado_pipeline) || 0) + 1);
                const estadosU = ESTADOS_PIPELINE.filter(e => dist.has(e.id));
                return (
                  <div key={u.key} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100" style={{ background: `${col}0a` }}>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: col }}>
                        {inicialesUsuario(u.nombre, u.email)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-bold text-slate-800 truncate">{u.nombre}</p>
                        <p className="text-[11px] text-slate-400 truncate">{u.email}</p>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
                        {estadosU.map(e => (
                          <span key={e.id} className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: `${e.color}18`, color: e.color }} title={e.label}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.color }} />
                            {dist.get(e.id)}
                          </span>
                        ))}
                        <span className="text-[13px] font-bold text-slate-900 ml-1 tabular-nums">{u.negocios.length}</span>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-50">
                      {u.negocios.map(n => (
                        <div key={n.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10.5px] font-mono font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{n.licitacion_codigo}</span>
                              <EstadoChip id={n.estado_pipeline} />
                            </div>
                            <p className="text-[13px] font-semibold text-slate-800 mt-1 truncate">{n.licitacion_nombre || '(sin nombre)'}</p>
                            {n.licitacion_organismo && (
                              <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1 truncate"><Building2 size={10} /> {n.licitacion_organismo}</p>
                            )}
                          </div>
                          <div className="hidden sm:flex flex-col items-end text-[11px] text-slate-500 flex-shrink-0 gap-0.5">
                            <span className="font-semibold text-slate-700">{fmtMonto(n.monto_ofertado || n.licitacion_monto)}</span>
                            <span className="flex items-center gap-1"><Calendar size={10} /> {fmtFecha(n.licitacion_cierre)}</span>
                          </div>
                          {(n.comentarios_count ?? 0) > 0 && (
                            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400 flex-shrink-0" title="Comentarios">
                              <MessageSquare size={11} /> {n.comentarios_count}
                            </span>
                          )}
                          <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
                            className="flex-shrink-0 p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Ver detalle">
                            <ExternalLink size={14} />
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
