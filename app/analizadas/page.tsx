'use client';

// Página "Licitaciones analizadas" — lista las licitaciones que ya pasaron por el
// análisis de viabilidad con IA (PROMPT 2), para encontrarlas sin buscar en el radar.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { Sparkles, Loader2, ChevronRight, Building2, Calendar, Search, Filter, X, Gauge, Trophy, Layers } from 'lucide-react';
import { MultiSelect } from '@/app/components/ui/MultiSelect';

interface Analizada {
  codigo: string; nombre: string; organismo: string; cierre: string | null; analizado_at: string;
  score: number | null; semaforo: string | null; area: string | null;
  gana: string | null; nivel: string | null; presupuesto_neto: number | null;
  modalidad: string | null; n_lineas: number | null;
}

const SEM: Record<string, { bg: string; text: string; label: string }> = {
  VERDE:     { bg: 'bg-emerald-500', text: 'text-emerald-700', label: 'Muy conveniente' },
  AMARILLO:  { bg: 'bg-yellow-500',  text: 'text-yellow-700',  label: 'Conveniente' },
  NARANJA:   { bg: 'bg-orange-500',  text: 'text-orange-700',  label: 'Media' },
  ROJO:      { bg: 'bg-red-500',     text: 'text-red-700',     label: 'Baja' },
  ROJO_DURO: { bg: 'bg-red-700',     text: 'text-red-800',     label: 'Descartar' },
};
const fmt = (n?: number | null) => n != null ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fecha = (s?: string | null) => s ? new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const ganaLabel = (g?: string | null) => { const x = (g || '').toLowerCase(); return x === 'si' ? 'GANA' : x === 'no' ? 'NO GANA' : x ? 'CONDICIONAL' : '—'; };
const SEM_HEX: Record<string, string> = { VERDE: '#10b981', AMARILLO: '#eab308', NARANJA: '#f97316', ROJO: '#ef4444', ROJO_DURO: '#b91c1c' };
const GANA_HEX: Record<string, string> = { GANA: '#16a34a', 'NO GANA': '#dc2626', CONDICIONAL: '#d97706' };
const modalidadLabel = (m?: string | null) => (m ? String(m).replace(/_/g, ' ') : '—');

export default function AnalizadasPage() {
  const [lics, setLics] = useState<Analizada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');
  // Filtros de SELECCIÓN MÚLTIPLE.
  const [fSemaforo, setFSemaforo] = useState<string[]>([]);
  const [fGana, setFGana]         = useState<string[]>([]);
  const [fModalidad, setFModalidad] = useState<string[]>([]);
  const hayFiltro = fSemaforo.length > 0 || fGana.length > 0 || fModalidad.length > 0;
  const limpiar = () => { setFSemaforo([]); setFGana([]); setFModalidad([]); };

  useEffect(() => {
    fetch('/api/analizadas').then(r => r.json())
      .then(d => { if (d.success) setLics(d.licitaciones || []); })
      .catch(() => { /* noop */ })
      .finally(() => setCargando(false));
  }, []);

  // Opciones presentes (con conteo) para cada filtro.
  const opciones = useMemo(() => {
    const sem = new Map<string, number>(), gana = new Map<string, number>(), mod = new Map<string, number>();
    for (const l of lics) {
      if (l.semaforo) sem.set(l.semaforo, (sem.get(l.semaforo) || 0) + 1);
      const g = ganaLabel(l.gana); if (g !== '—') gana.set(g, (gana.get(g) || 0) + 1);
      if (l.modalidad) mod.set(l.modalidad, (mod.get(l.modalidad) || 0) + 1);
    }
    const ordenSem = ['VERDE', 'AMARILLO', 'NARANJA', 'ROJO', 'ROJO_DURO'];
    return {
      semaforo: [...sem.entries()].sort((a, b) => ordenSem.indexOf(a[0]) - ordenSem.indexOf(b[0]))
        .map(([v, c]) => ({ value: v, label: SEM[v]?.label || v, color: SEM_HEX[v], count: c })),
      gana: [...gana.entries()].map(([v, c]) => ({ value: v, label: v, color: GANA_HEX[v], count: c })),
      modalidad: [...mod.entries()].sort().map(([v, c]) => ({ value: v, label: modalidadLabel(v), count: c })),
    };
  }, [lics]);

  const filtradas = lics.filter(l =>
    (!q || l.nombre.toLowerCase().includes(q.toLowerCase()) || l.codigo.toLowerCase().includes(q.toLowerCase()) || (l.organismo || '').toLowerCase().includes(q.toLowerCase())) &&
    (fSemaforo.length === 0 || (!!l.semaforo && fSemaforo.includes(l.semaforo))) &&
    (fGana.length === 0 || fGana.includes(ganaLabel(l.gana))) &&
    (fModalidad.length === 0 || (!!l.modalidad && fModalidad.includes(l.modalidad))));

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Licitaciones analizadas' }]}>
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center"><Sparkles size={18} className="text-white" /></div>
            <div>
              <h1 className="text-[18px] font-bold text-slate-900 leading-tight">Licitaciones analizadas</h1>
              <p className="text-[12px] text-slate-400">
                {hayFiltro ? `${filtradas.length} de ${lics.length}` : lics.length} con análisis de viabilidad completado
              </p>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…"
              className="pl-8 pr-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:ring-1 focus:ring-violet-500 outline-none w-56" />
          </div>
        </div>

        {/* Barra de filtros (selección múltiple) */}
        {!cargando && lics.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-[12px] text-slate-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
            <MultiSelect
              label={fSemaforo.length ? 'Semáforo' : 'Todo el semáforo'}
              icon={<Gauge size={13} />}
              options={opciones.semaforo}
              selected={fSemaforo}
              onChange={setFSemaforo}
            />
            <MultiSelect
              label={fGana.length ? 'Resultado IA' : '¿Gana?'}
              icon={<Trophy size={13} />}
              options={opciones.gana}
              selected={fGana}
              onChange={setFGana}
            />
            {opciones.modalidad.length > 0 && (
              <MultiSelect
                label={fModalidad.length ? 'Modalidad' : 'Toda modalidad'}
                icon={<Layers size={13} />}
                options={opciones.modalidad}
                selected={fModalidad}
                onChange={setFModalidad}
              />
            )}
            {hayFiltro && (
              <button onClick={limpiar}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-2 rounded-lg transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
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
              return (
                <Link key={l.codigo} href={`/licitacion/${encodeURIComponent(l.codigo)}`}
                  style={{ '--stagger-i': Math.min(i, 12) } as React.CSSProperties}
                  className="stagger-item flex items-center gap-4 bg-white border border-slate-200 rounded-xl p-3.5 hover:border-violet-300 hover:shadow-sm transition-all group">
                  <div className={`w-12 h-12 rounded-xl ${sem.bg} flex flex-col items-center justify-center text-white flex-shrink-0`}>
                    <span className="text-[15px] font-black leading-none">{l.score ?? '—'}</span>
                    <span className="text-[8px] opacity-80">/100</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-slate-800 truncate group-hover:text-violet-700">{l.nombre}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[11.5px] text-slate-400">
                      <span className="font-mono">{l.codigo}</span>
                      {l.organismo && <span className="flex items-center gap-1 truncate max-w-[200px]"><Building2 size={11} />{l.organismo}</span>}
                      <span className="flex items-center gap-1"><Calendar size={11} />Cierre {fecha(l.cierre)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1.5">
                      <span className={`text-[10px] font-black text-white px-1.5 py-0.5 rounded ${sem.bg}`}>{ganaLabel(l.gana)}</span>
                      <span className={`text-[11px] font-semibold ${sem.text}`}>{sem.label}</span>
                      {l.presupuesto_neto != null && <span className="text-[11px] text-emerald-700 font-semibold">{fmt(l.presupuesto_neto)}</span>}
                      {l.modalidad && <span className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-full">{String(l.modalidad).replace(/_/g, ' ')}</span>}
                      {l.n_lineas != null && <span className="text-[10px] text-slate-500">{l.n_lineas} líneas</span>}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-violet-500 flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
