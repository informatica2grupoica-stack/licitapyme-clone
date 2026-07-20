'use client';

// Página "Licitaciones analizadas" — lista las licitaciones que ya pasaron por el análisis
// de viabilidad con IA (PROMPT 2). Rediseño profesional: fecha+hora del análisis, DE QUIÉN
// es la licitación (perfil asignado), toda la info del análisis, orden y filtros completos.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { Sparkles, Loader2, ChevronRight, Building2, Calendar, Search, Filter, X, Gauge, Trophy, Layers, Users, ArrowUpDown, Clock, RefreshCw, Wallet } from 'lucide-react';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';

interface Analizada {
  codigo: string; nombre: string; organismo: string; cierre: string | null;
  analizado_at: string; creado_at: string | null; reanalizada: boolean;
  score: number | null; semaforo: string | null; area: string | null;
  resultado: string | null; titular: string | null;
  presupuesto: number | null; modalidad: string | null; n_lineas: number | null;
  confianza: number | null; esquema: string;
  owner_nombre: string | null; owner_email: string | null; estado_pipeline: string | null;
}

const SEM: Record<string, { bg: string; text: string; label: string }> = {
  VERDE:     { bg: 'bg-emerald-500', text: 'text-emerald-700', label: 'Muy conveniente' },
  AMARILLO:  { bg: 'bg-yellow-500',  text: 'text-yellow-700',  label: 'Conveniente' },
  NARANJA:   { bg: 'bg-orange-500',  text: 'text-orange-700',  label: 'Media' },
  ROJO:      { bg: 'bg-red-500',     text: 'text-red-700',     label: 'Baja' },
  ROJO_DURO: { bg: 'bg-red-700',     text: 'text-red-800',     label: 'Descartar' },
};
const SEM_HEX: Record<string, string> = { VERDE: '#10b981', AMARILLO: '#eab308', NARANJA: '#f97316', ROJO: '#ef4444', ROJO_DURO: '#b91c1c' };
// Veredicto de negocio unificado (lo entrega ya normalizado la API).
const RES: Record<string, { label: string; bg: string; hex: string }> = {
  GANABLE:   { label: 'GANABLE',   bg: 'bg-emerald-600', hex: '#16a34a' },
  PUEDE_SER: { label: 'PUEDE SER', bg: 'bg-yellow-500',  hex: '#d97706' },
  NO_VAMOS:  { label: 'NO VAMOS',  bg: 'bg-red-600',     hex: '#dc2626' },
};
const fmt = (n?: number | null) => n != null ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const soloFecha = (s?: string | null) => s ? new Date(s).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fechaHora = (s?: string | null) => s ? new Date(s).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const modalidadLabel = (m?: string | null) => (m ? String(m).replace(/_/g, ' ') : '—');

type Orden = 'reciente' | 'antiguo' | 'score_desc' | 'score_asc' | 'cierre' | 'presupuesto';

export default function AnalizadasPage() {
  const [lics, setLics] = useState<Analizada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');
  const [fSemaforo, setFSemaforo]   = useState<string[]>([]);
  const [fResultado, setFResultado] = useState<string[]>([]);
  const [fModalidad, setFModalidad] = useState<string[]>([]);
  const [fOwner, setFOwner]         = useState<string[]>([]);
  const [orden, setOrden] = useState<Orden>('reciente');
  const hayFiltro = fSemaforo.length > 0 || fResultado.length > 0 || fModalidad.length > 0 || fOwner.length > 0;
  const limpiar = () => { setFSemaforo([]); setFResultado([]); setFModalidad([]); setFOwner([]); };

  useEffect(() => {
    fetch('/api/analizadas').then(r => r.json())
      .then(d => { if (d.success) setLics(d.licitaciones || []); })
      .catch(() => { /* noop */ })
      .finally(() => setCargando(false));
  }, []);

  // Opciones (con conteo) presentes en los datos, para cada filtro.
  const opciones = useMemo(() => {
    const sem = new Map<string, number>(), res = new Map<string, number>(), mod = new Map<string, number>(), own = new Map<string, { nombre: string; n: number }>();
    for (const l of lics) {
      if (l.semaforo) sem.set(l.semaforo, (sem.get(l.semaforo) || 0) + 1);
      if (l.resultado) res.set(l.resultado, (res.get(l.resultado) || 0) + 1);
      if (l.modalidad) mod.set(l.modalidad, (mod.get(l.modalidad) || 0) + 1);
      const key = l.owner_email || (l.owner_nombre ? l.owner_nombre : null);
      if (key) { const cur = own.get(key) || { nombre: l.owner_nombre || l.owner_email || key, n: 0 }; cur.n++; own.set(key, cur); }
    }
    const ordenSem = ['VERDE', 'AMARILLO', 'NARANJA', 'ROJO', 'ROJO_DURO'];
    const ordenRes = ['GANABLE', 'PUEDE_SER', 'NO_VAMOS'];
    return {
      semaforo: [...sem.entries()].sort((a, b) => ordenSem.indexOf(a[0]) - ordenSem.indexOf(b[0]))
        .map(([v, c]) => ({ value: v, label: SEM[v]?.label || v, color: SEM_HEX[v], count: c })),
      resultado: [...res.entries()].sort((a, b) => ordenRes.indexOf(a[0]) - ordenRes.indexOf(b[0]))
        .map(([v, c]) => ({ value: v, label: RES[v]?.label || v, color: RES[v]?.hex, count: c })),
      modalidad: [...mod.entries()].sort().map(([v, c]) => ({ value: v, label: modalidadLabel(v), count: c })),
      owner: [...own.entries()].sort((a, b) => b[1].n - a[1].n)
        .map(([v, o]) => ({ value: v, label: o.nombre, color: colorUsuario(v), count: o.n })),
    };
  }, [lics]);

  const filtradas = useMemo(() => {
    const arr = lics.filter(l =>
      (!q || l.nombre.toLowerCase().includes(q.toLowerCase()) || l.codigo.toLowerCase().includes(q.toLowerCase()) || (l.organismo || '').toLowerCase().includes(q.toLowerCase()) || (l.owner_nombre || '').toLowerCase().includes(q.toLowerCase())) &&
      (fSemaforo.length === 0 || (!!l.semaforo && fSemaforo.includes(l.semaforo))) &&
      (fResultado.length === 0 || (!!l.resultado && fResultado.includes(l.resultado))) &&
      (fModalidad.length === 0 || (!!l.modalidad && fModalidad.includes(l.modalidad))) &&
      (fOwner.length === 0 || fOwner.includes(l.owner_email || l.owner_nombre || '')));
    const t = (s?: string | null) => (s ? new Date(s).getTime() : 0);
    const arrSorted = [...arr];
    arrSorted.sort((a, b) => {
      switch (orden) {
        case 'antiguo':     return t(a.analizado_at) - t(b.analizado_at);
        case 'score_desc':  return (b.score ?? -1) - (a.score ?? -1);
        case 'score_asc':   return (a.score ?? 999) - (b.score ?? 999);
        case 'cierre': {    // cierre más cercano primero; sin cierre al final
          const ca = a.cierre ? t(a.cierre) : Infinity, cb = b.cierre ? t(b.cierre) : Infinity;
          return ca - cb;
        }
        case 'presupuesto': return (b.presupuesto ?? -1) - (a.presupuesto ?? -1);
        default:            return t(b.analizado_at) - t(a.analizado_at); // reciente
      }
    });
    return arrSorted;
  }, [lics, q, fSemaforo, fResultado, fModalidad, fOwner, orden]);

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Licitaciones analizadas' }]}>
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center"><Sparkles size={18} className="text-white" /></div>
            <div>
              <h1 className="text-[18px] font-bold text-slate-900 leading-tight">Licitaciones analizadas</h1>
              <p className="text-[12px] text-slate-400">
                {hayFiltro || q ? `${filtradas.length} de ${lics.length}` : lics.length} con análisis de viabilidad completado
              </p>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, código, organismo o perfil…"
              className="pl-8 pr-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:ring-1 focus:ring-violet-500 outline-none w-72" />
          </div>
        </div>

        {/* Barra de filtros + orden */}
        {!cargando && lics.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-[12px] text-slate-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
            <MultiSelect label={fSemaforo.length ? 'Semáforo' : 'Semáforo'} icon={<Gauge size={13} />} options={opciones.semaforo} selected={fSemaforo} onChange={setFSemaforo} />
            <MultiSelect label={fResultado.length ? 'Veredicto' : 'Veredicto'} icon={<Trophy size={13} />} options={opciones.resultado} selected={fResultado} onChange={setFResultado} />
            {opciones.modalidad.length > 0 && (
              <MultiSelect label={fModalidad.length ? 'Modalidad' : 'Modalidad'} icon={<Layers size={13} />} options={opciones.modalidad} selected={fModalidad} onChange={setFModalidad} />
            )}
            {opciones.owner.length > 0 && (
              <MultiSelect label={fOwner.length ? 'Perfil' : 'Perfil'} icon={<Users size={13} />} options={opciones.owner} selected={fOwner} onChange={setFOwner} minWidth={220} />
            )}
            {hayFiltro && (
              <button onClick={limpiar}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-2 rounded-lg transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
            <div className="inline-flex items-center gap-1.5 ml-auto">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><ArrowUpDown size={12} /> Ordenar</span>
              <Select value={orden} onChange={v => setOrden(v as Orden)}
                options={[
                  { value: 'reciente', label: 'Análisis reciente' },
                  { value: 'antiguo', label: 'Análisis más antiguo' },
                  { value: 'score_desc', label: 'Score (mayor)' },
                  { value: 'score_asc', label: 'Score (menor)' },
                  { value: 'cierre', label: 'Cierre más cercano' },
                  { value: 'presupuesto', label: 'Presupuesto (mayor)' },
                ]} />
            </div>
          </div>
        )}

        {cargando ? (
          <div className="flex flex-col items-center py-20 text-slate-400"><Loader2 size={26} className="animate-spin mb-2" /><p className="text-[13px]">Cargando…</p></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-20 bg-white rounded-2xl border border-slate-200 text-center">
            <Sparkles size={26} className="text-slate-300 mb-2" />
            {hayFiltro || q ? (
              <>
                <p className="text-[14px] font-semibold text-slate-700">Sin resultados</p>
                <p className="text-[12px] text-slate-400 mt-1 max-w-sm">Ninguna analizada coincide con la búsqueda o los filtros.</p>
              </>
            ) : (
              <>
                <p className="text-[14px] font-semibold text-slate-700">Aún no hay licitaciones analizadas</p>
                <p className="text-[12px] text-slate-400 mt-1 max-w-sm">Entra a una licitación del radar → Viabilidad → “Analizar”. Aparecerán aquí.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtradas.map((l, i) => {
              const sem = SEM[l.semaforo || ''] || { bg: 'bg-zinc-400', text: 'text-zinc-600', label: '—' };
              const res = l.resultado ? RES[l.resultado] : null;
              const ownerKey = l.owner_email || l.owner_nombre || '';
              return (
                <Link key={l.codigo} href={`/licitacion/${encodeURIComponent(l.codigo)}`}
                  style={{ '--stagger-i': Math.min(i, 12) } as React.CSSProperties}
                  className="stagger-item flex items-stretch gap-3.5 bg-white border border-slate-200 rounded-xl p-3.5 hover:border-violet-300 hover:shadow-sm transition-all group">
                  {/* Score */}
                  <div className={`w-12 h-12 rounded-xl ${sem.bg} flex flex-col items-center justify-center text-white flex-shrink-0 self-center`}>
                    <span className="text-[15px] font-black leading-none">{l.score ?? '—'}</span>
                    <span className="text-[8px] opacity-80">/100</span>
                  </div>

                  {/* Identidad + análisis */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-slate-800 truncate group-hover:text-violet-700">{l.nombre}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[11.5px] text-slate-400">
                      <span className="font-mono">{l.codigo}</span>
                      {l.organismo && <span className="flex items-center gap-1 truncate max-w-[220px]"><Building2 size={11} />{l.organismo}</span>}
                      <span className="flex items-center gap-1" title="Cierre de recepción de ofertas"><Calendar size={11} />Cierre {soloFecha(l.cierre)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1.5">
                      {res
                        ? <span className={`text-[10px] font-black text-white px-1.5 py-0.5 rounded ${res.bg}`}>{res.label}</span>
                        : <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">SIN VEREDICTO</span>}
                      <span className={`text-[11px] font-semibold ${sem.text}`}>{sem.label}</span>
                      {l.presupuesto != null && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold"><Wallet size={11} />{fmt(l.presupuesto)}</span>}
                      {l.modalidad && <span className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-full">{modalidadLabel(l.modalidad)}</span>}
                      {l.n_lineas != null && <span className="text-[10px] text-slate-500">{l.n_lineas} línea{l.n_lineas === 1 ? '' : 's'}</span>}
                      {l.confianza != null && <span className="text-[10px] text-slate-400" title="Confianza del análisis">conf. {Math.round(l.confianza * 100)}%</span>}
                    </div>
                  </div>

                  {/* Dueño + fecha/hora de análisis (columna derecha) */}
                  <div className="hidden md:flex flex-col items-end justify-center gap-1 flex-shrink-0 w-[190px] border-l border-slate-100 pl-3">
                    {ownerKey ? (
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
                        <span style={{ background: colorUsuario(ownerKey) }} className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[8px] font-bold flex-shrink-0">
                          {inicialesUsuario(l.owner_nombre, l.owner_email)}
                        </span>
                        <span className="truncate max-w-[140px]">{l.owner_nombre || l.owner_email}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300 italic">Sin asignar</span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500" title={`Analizada el ${fechaHora(l.analizado_at)}`}>
                      {l.reanalizada ? <RefreshCw size={11} className="text-violet-400" /> : <Clock size={11} className="text-slate-400" />}
                      {fechaHora(l.analizado_at)}
                    </span>
                    <span className="text-[9.5px] text-slate-300">{l.reanalizada ? 're-analizada' : 'analizada'} · {l.esquema}</span>
                  </div>

                  <ChevronRight size={18} className="text-slate-300 group-hover:text-violet-500 flex-shrink-0 self-center" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
