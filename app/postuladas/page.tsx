'use client';

// Apartado "Postuladas": licitaciones marcadas como POSTULADA (estado 'POSTULADA').
// Muestra el presupuesto REAL de la licitación vs el MONTO OFERTADO (lo que se postuló),
// y los documentos PROPIOS subidos (incluido el costeo).
//
// Roles: cada perfil ve SOLO sus postuladas; el admin ve TODAS y puede filtrarlas por
// perfil (igual que en Negocios) — el filtrado por rol ya lo hace /api/negocios.
//
// Adjudicación: al pinchar/cargar cada tarjeta se consulta EN VIVO la API de Mercado
// Público (/api/licitacion-adjudicacion). Si MP ya adjudicó (CodigoEstado 8) se muestra
// el "resultado aperturado": ganador por línea, monto, N° de oferentes y link al acta.

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { getEstadoPipeline, ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import {
  Send, ExternalLink, Building2, Calendar, Loader2, Inbox, FileText,
  Award, Trophy, Users, FileCheck2, ChevronDown, ChevronUp,
  Pencil, Trash2, Undo2, X, Save, Wallet, Clock4,
} from 'lucide-react';
import dayjs from 'dayjs';

const ESTADO_POSTULADA = 'POSTULADA';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  estado_pipeline: string | null;
  monto_ofertado?: number;
  usuario_nombre?: string;
  usuario_email?: string;
}
interface DocCache { documento_nombre: string; documento_url_local: string; categoria: string | null; }

interface LineaAdjudicada {
  correlativo?: number;
  producto?: string;
  descripcion?: string;
  cantidad?: number;
  unidad?: string;
  montoUnitario: number | null;
  rutProveedor: string | null;
  proveedor: string | null;
}
interface Adjudicacion {
  esAdjudicada: boolean;
  estado?: string;
  fechaAdjudicacion?: string | null;
  adjudicacion?: {
    tipo?: number;
    numeroResolucion?: string | null;
    numeroOferentes?: number | null;
    urlActa?: string | null;
  } | null;
  lineasAdjudicadas?: LineaAdjudicada[];
  montoAdjudicadoTotal?: number | null;
}

function fmtCLP(n: number | null | undefined) {
  if (n == null || n === 0) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

// ── Bloque "Resultado de adjudicación" ────────────────────────────────────────
function BloqueAdjudicacion({ adj }: { adj: Adjudicacion }) {
  const [abierto, setAbierto] = useState(false);
  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
            <Trophy size={11} /> Adjudicada
          </span>
          {adj.fechaAdjudicacion && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
              <Calendar size={11} /> {dayjs(adj.fechaAdjudicacion).format('DD/MM/YYYY')}
            </span>
          )}
          {meta?.numeroOferentes != null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
              <Users size={11} /> {meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}
            </span>
          )}
          {meta?.numeroResolucion && (
            <span className="text-[11px] text-emerald-700">Res. N° {meta.numeroResolucion}</span>
          )}
          {adj.montoAdjudicadoTotal ? (
            <span className="ml-auto text-[12px] font-bold text-emerald-800">
              Adjudicado: {fmtCLP(adj.montoAdjudicadoTotal)}
            </span>
          ) : null}
        </div>

        {/* Detalle por línea (aperturado): quién ganó y por cuánto */}
        {lineas.length > 0 && (
          <>
            <button
              onClick={() => setAbierto(o => !o)}
              className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700 hover:text-emerald-800"
            >
              {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {abierto ? 'Ocultar' : 'Ver'} adjudicación por línea ({lineas.length})
            </button>
            {abierto && (
              <div className="mt-2 space-y-1.5">
                {lineas.map((l, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 bg-white border border-emerald-100 rounded-lg px-2.5 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-medium text-slate-700 truncate" title={l.producto || l.descripcion}>
                        {l.producto || l.descripcion || `Línea ${l.correlativo ?? i + 1}`}
                      </p>
                      <p className="text-[10.5px] text-emerald-700 truncate" title={`${l.proveedor || ''} ${l.rutProveedor || ''}`}>
                        <Award size={9} className="inline mr-0.5" />
                        {l.proveedor || 'Proveedor adjudicado'}
                        {l.rutProveedor ? ` · ${l.rutProveedor}` : ''}
                      </p>
                    </div>
                    <span className="text-[11.5px] font-bold text-slate-800 whitespace-nowrap">
                      {fmtCLP(l.montoUnitario)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {meta?.urlActa && (
          <a href={meta.urlActa} target="_blank" rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700 hover:text-emerald-800">
            <FileCheck2 size={12} /> Ver acta de adjudicación <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

// Tarjeta: carga sus documentos PROPIOS y su estado de adjudicación de forma perezosa.
function PostuladaCard({ n, color, label, isAdmin, onRevertida, onActualizada, onAdj }: {
  n: Negocio; color: string; label: string; isAdmin: boolean;
  onRevertida: (id: number) => void;
  onActualizada: (id: number, patch: { monto_ofertado?: number; estado_pipeline?: string }) => void;
  onAdj: (id: number, esAdjudicada: boolean, montoAdjudicado: number | null) => void;
}) {
  const [docs, setDocs] = useState<DocCache[]>([]);
  const [adj, setAdj] = useState<Adjudicacion | null>(null);
  const [editando, setEditando] = useState(false);
  const [montoEdit, setMontoEdit] = useState<string>(n.monto_ofertado ? String(n.monto_ofertado) : '');
  const [estadoEdit, setEstadoEdit] = useState<string>(n.estado_pipeline || ESTADO_POSTULADA);
  const [guardando, setGuardando] = useState(false);
  const perfilCol = colorUsuario(n.usuario_email || n.usuario_nombre || '');
  const confirmar = useConfirm();
  const toast = useToast();

  useEffect(() => {
    fetch(`/api/documentos/cache/${encodeURIComponent(n.licitacion_codigo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const todos: DocCache[] = d?.documentos || d?.docs || [];
        setDocs(todos.filter(x => (x.categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS'));
      })
      .catch(() => {});
  }, [n.licitacion_codigo]);

  // Editar (solo admin): guarda monto ofertado y/o estado del pipeline.
  const guardarEdicion = async () => {
    setGuardando(true);
    try {
      const monto = parseInt(String(montoEdit).replace(/\D/g, ''), 10) || 0;
      const res = await fetch(`/api/negocios/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto_ofertado: monto, estado_pipeline: estadoEdit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Postulada actualizada');
      setEditando(false);
      onActualizada(n.id, { monto_ofertado: monto, estado_pipeline: estadoEdit });
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message);
    } finally {
      setGuardando(false);
    }
  };

  // Eliminar (solo admin): revierte la postulación → vuelve a EN PROCESO y sale del apartado.
  // No borra el negocio.
  const revertir = async () => {
    const ok = await confirmar({
      titulo: '¿Quitar de Postuladas?',
      mensaje: 'La licitación volverá a "En proceso" y saldrá de este apartado. No se elimina el negocio.',
      confirmarLabel: 'Quitar', peligro: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/negocios/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: 'EN_PROCESO' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo revertir');
      toast.success('Devuelta a En proceso');
      onRevertida(n.id);
    } catch (e: any) {
      toast.error('No se pudo revertir', e?.message);
    }
  };

  // Eliminar un documento propio (lo puede hacer el perfil, no requiere admin).
  const borrarDoc = async (d: DocCache) => {
    const ok = await confirmar({
      titulo: '¿Eliminar documento?',
      mensaje: `"${d.documento_nombre}" se eliminará de forma permanente.`,
      confirmarLabel: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    const prev = docs;
    setDocs(ds => ds.filter(x => x !== d));
    try {
      const res = await fetch(`/api/documentos/${encodeURIComponent(n.licitacion_codigo)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: d.documento_url_local, nombre: d.documento_nombre }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Documento eliminado');
    } catch (e: any) {
      setDocs(prev);
      toast.error('No se pudo eliminar', e?.message);
    }
  };

  // Sondeo de adjudicación en vivo contra Mercado Público.
  useEffect(() => {
    fetch(`/api/licitacion-adjudicacion/${encodeURIComponent(n.licitacion_codigo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.success && d.esAdjudicada) {
          setAdj(d);
          onAdj(n.id, true, d.montoAdjudicadoTotal ?? null);
        }
      })
      .catch(() => {});
    // onAdj es estable (viene de un useCallback en el padre); no lo incluimos para no re-sondear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.licitacion_codigo, n.id]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-all"
      style={isAdmin ? { borderLeftColor: perfilCol, borderLeftWidth: 3 } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[11px] font-mono font-semibold text-slate-500">{n.licitacion_codigo}</span>
            {adj?.esAdjudicada ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                <Trophy size={10} /> Adjudicada
              </span>
            ) : (
              <span style={{ backgroundColor: color + '18', color, borderColor: color + '40' }}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border">
                <span style={{ backgroundColor: color }} className="w-1 h-1 rounded-full" />{label}
              </span>
            )}
            {isAdmin && (n.usuario_nombre || n.usuario_email) && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                <span style={{ background: perfilCol }} className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
                  {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
                </span>
                {n.usuario_nombre || n.usuario_email}
              </span>
            )}
          </div>
          <h3 className="text-[14px] font-semibold text-slate-800 truncate">{n.licitacion_nombre || 'Sin nombre'}</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[12px] text-slate-500">
            <span className="inline-flex items-center gap-1"><Building2 size={12} />{n.licitacion_organismo || '—'}</span>
            {n.licitacion_cierre && <span className="inline-flex items-center gap-1"><Calendar size={12} />{dayjs(n.licitacion_cierre).format('DD/MM/YYYY')}</span>}
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          {isAdmin && !editando && (
            <>
              <button onClick={() => setEditando(true)}
                title="Editar monto y estado"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-indigo-600 px-1.5 py-1 rounded-md hover:bg-indigo-50 transition-colors">
                <Pencil size={13} />
              </button>
              <button onClick={revertir}
                title="Quitar de Postuladas (vuelve a En proceso)"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-red-600 px-1.5 py-1 rounded-md hover:bg-red-50 transition-colors">
                <Undo2 size={13} />
              </button>
            </>
          )}
          <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
            Ver <ExternalLink size={12} />
          </Link>
        </div>
      </div>

      {/* Edición inline (solo admin) */}
      {editando && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">Monto ofertado</span>
              <input type="text" inputMode="numeric" value={montoEdit}
                onChange={e => setMontoEdit(e.target.value)}
                placeholder="$"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">Estado</span>
              <select value={estadoEdit} onChange={e => setEstadoEdit(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                {ESTADOS_PIPELINE.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Si cambias el estado a uno distinto de <b>Postulada</b>, saldrá de este apartado.</p>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={() => { setEditando(false); setMontoEdit(n.monto_ofertado ? String(n.monto_ofertado) : ''); setEstadoEdit(n.estado_pipeline || ESTADO_POSTULADA); }}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-200/60 px-3 py-1.5 rounded-lg transition-colors">
              <X size={13} /> Cancelar
            </button>
            <button onClick={guardarEdicion} disabled={guardando}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-3.5 py-1.5 rounded-lg transition-colors">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
            </button>
          </div>
        </div>
      )}

      {/* Presupuesto real vs monto ofertado */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Presupuesto real</p>
          <p className="text-[14px] font-bold text-slate-800">{fmtCLP(n.licitacion_monto)}</p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <p className="text-[10.5px] text-amber-700">Postulamos con</p>
          <p className="text-[14px] font-bold text-amber-800">{fmtCLP(n.monto_ofertado)}</p>
        </div>
      </div>

      {/* Resultado de adjudicación (si MP ya adjudicó) */}
      {adj?.esAdjudicada && <BloqueAdjudicacion adj={adj} />}

      {/* Documentos propios subidos (incluido el costeo) */}
      {docs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Documentos propios ({docs.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {docs.map((d, i) => (
              <span key={i}
                className="group inline-flex items-center gap-1 text-[11.5px] text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md pl-2 pr-1 py-1 transition-colors max-w-[240px]">
                <a href={d.documento_url_local} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 min-w-0">
                  <FileText size={11} className="flex-shrink-0 text-slate-400" />
                  <span className="truncate">{d.documento_nombre}</span>
                </a>
                <button onClick={() => borrarDoc(d)} title="Eliminar documento"
                  className="flex-shrink-0 p-0.5 text-slate-400 hover:text-red-600 rounded transition-colors">
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// KPI tile — mismo lenguaje visual que el dashboard (StatCard).
function KpiCard({ icon, label, value, sub, color = 'indigo' }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string;
}) {
  const ICON_BG: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', violet: 'bg-violet-50 text-violet-600',
    teal: 'bg-teal-50 text-teal-600', emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600', orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1">{label}</p>
          <p className="text-[26px] font-black leading-none tabular-nums text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1 truncate">{sub}</p>}
        </div>
        <div className={`w-[42px] h-[42px] rounded-xl flex items-center justify-center flex-shrink-0 ${ICON_BG[color] || ICON_BG.indigo}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function PostuladasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfilSel, setPerfilSel] = useState<string>(''); // email del perfil (solo admin)
  // Adjudicación por negocio (la reportan las tarjetas al sondear MP) → alimenta los KPIs.
  const [adjMap, setAdjMap] = useState<Record<number, { esAdjudicada: boolean; monto: number | null }>>({});
  const reportarAdj = useCallback((id: number, esAdjudicada: boolean, monto: number | null) => {
    setAdjMap(prev => (prev[id]?.esAdjudicada === esAdjudicada && prev[id]?.monto === monto ? prev : { ...prev, [id]: { esAdjudicada, monto } }));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/negocios');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
        const todas: Negocio[] = data.negocios || [];
        setNegocios(todas.filter(n => n.estado_pipeline === ESTADO_POSTULADA));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const badge = getEstadoPipeline(ESTADO_POSTULADA);
  const color = badge?.color ?? '#B45309';
  const label = badge?.label ?? 'POSTULADA';

  // Perfiles presentes (para el filtro del admin), con su conteo.
  const perfiles = useMemo(() => {
    const m = new Map<string, { email: string; nombre: string; total: number }>();
    for (const n of negocios) {
      const email = n.usuario_email || n.usuario_nombre || '—';
      const e = m.get(email) || { email, nombre: n.usuario_nombre || n.usuario_email || '—', total: 0 };
      e.total++;
      m.set(email, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [negocios]);

  const visibles = useMemo(
    () => (perfilSel ? negocios.filter(n => (n.usuario_email || n.usuario_nombre) === perfilSel) : negocios),
    [negocios, perfilSel],
  );

  // KPIs sobre el conjunto VISIBLE (respeta el filtro por perfil).
  const stats = useMemo(() => {
    const total = visibles.length;
    let adjudicadas = 0, montoAdjudicado = 0;
    for (const n of visibles) {
      const a = adjMap[n.id];
      if (a?.esAdjudicada) { adjudicadas++; if (a.monto) montoAdjudicado += a.monto; }
    }
    return { total, adjudicadas, enEvaluacion: total - adjudicadas, montoAdjudicado };
  }, [visibles, adjMap]);

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Postuladas' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header — mismo estilo que Negocios */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Send size={24} className="text-amber-600" /> Postuladas
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {cargando
                ? 'Cargando…'
                : `${visibles.length} licitación${visibles.length !== 1 ? 'es' : ''} postulada${visibles.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* KPIs */}
        {!cargando && !error && visibles.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <KpiCard icon={<Send size={22} />} label="Postuladas" value={stats.total} sub="Ofertas presentadas" color="amber" />
            <KpiCard icon={<Trophy size={22} />} label="Adjudicadas" value={stats.adjudicadas} sub={stats.total ? `${Math.round((stats.adjudicadas / stats.total) * 100)}% de éxito` : '—'} color="emerald" />
            <KpiCard icon={<Clock4 size={22} />} label="En evaluación" value={stats.enEvaluacion} sub="Aún sin resultado" color="orange" />
            <KpiCard icon={<Wallet size={22} />} label="Monto adjudicado" value={fmtCLP(stats.montoAdjudicado || null)} sub="Suma de lo ganado" color="violet" />
          </div>
        )}

        {/* Filtro por perfil (solo admin) */}
        {isAdmin && perfiles.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            <button onClick={() => setPerfilSel('')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                perfilSel === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>
              Todos <span className="opacity-70">({negocios.length})</span>
            </button>
            {perfiles.map(p => {
              const activo = perfilSel === p.email;
              const col = colorUsuario(p.email);
              return (
                <button key={p.email} onClick={() => setPerfilSel(activo ? '' : p.email)}
                  style={activo ? { backgroundColor: col, borderColor: col } : { borderColor: col + '55' }}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                    activo ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  <span style={{ background: activo ? 'rgba(255,255,255,.35)' : col }}
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
                    {inicialesUsuario(p.nombre, p.email)}
                  </span>
                  {p.nombre} <span className="opacity-70">({p.total})</span>
                </button>
              );
            })}
          </div>
        )}

        {cargando ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-20 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : error ? (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        ) : visibles.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-slate-100">
            <Inbox size={36} className="text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Todavía no hay licitaciones postuladas</h3>
            <p className="text-sm text-gray-400">Marca una licitación como <b>Postulada</b> en su estado y aparecerá aquí.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {visibles.map(n => (
              <PostuladaCard key={n.id} n={n} color={color} label={label} isAdmin={!!isAdmin}
                onRevertida={id => setNegocios(prev => prev.filter(x => x.id !== id))}
                onActualizada={(id, patch) => setNegocios(prev =>
                  patch.estado_pipeline && patch.estado_pipeline !== ESTADO_POSTULADA
                    ? prev.filter(x => x.id !== id)
                    : prev.map(x => x.id === id ? { ...x, ...patch } : x)
                )}
                onAdj={reportarAdj}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
