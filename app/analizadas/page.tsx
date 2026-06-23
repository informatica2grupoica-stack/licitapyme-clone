'use client';

// Página "Licitaciones analizadas" — lista las licitaciones que ya pasaron por el
// análisis de viabilidad con IA (PROMPT 2), para encontrarlas sin buscar en el radar.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { Sparkles, Loader2, ChevronRight, Building2, Calendar, Search } from 'lucide-react';

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

export default function AnalizadasPage() {
  const [lics, setLics] = useState<Analizada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/analizadas').then(r => r.json())
      .then(d => { if (d.success) setLics(d.licitaciones || []); })
      .catch(() => { /* noop */ })
      .finally(() => setCargando(false));
  }, []);

  const filtradas = lics.filter(l =>
    !q || l.nombre.toLowerCase().includes(q.toLowerCase()) || l.codigo.toLowerCase().includes(q.toLowerCase()) || (l.organismo || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Licitaciones analizadas' }]}>
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center"><Sparkles size={18} className="text-white" /></div>
            <div>
              <h1 className="text-[18px] font-bold text-slate-900 leading-tight">Licitaciones analizadas</h1>
              <p className="text-[12px] text-slate-400">{lics.length} analizadas con IA (viabilidad PROMPT 2)</p>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…"
              className="pl-8 pr-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:ring-1 focus:ring-violet-500 outline-none w-56" />
          </div>
        </div>

        {cargando ? (
          <div className="flex flex-col items-center py-20 text-slate-400"><Loader2 size={26} className="animate-spin mb-2" /><p className="text-[13px]">Cargando…</p></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-20 bg-white rounded-2xl border border-slate-200 text-center">
            <Sparkles size={26} className="text-slate-300 mb-2" />
            <p className="text-[14px] font-semibold text-slate-700">Aún no hay licitaciones analizadas</p>
            <p className="text-[12px] text-slate-400 mt-1 max-w-sm">Entra a una licitación del radar → Viabilidad → “Analizar con IA”. Aparecerán aquí.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtradas.map(l => {
              const sem = SEM[l.semaforo || ''] || { bg: 'bg-zinc-400', text: 'text-zinc-600', label: '—' };
              return (
                <Link key={l.codigo} href={`/licitacion/${encodeURIComponent(l.codigo)}`}
                  className="flex items-center gap-4 bg-white border border-slate-200 rounded-xl p-3.5 hover:border-violet-300 hover:shadow-sm transition-all group">
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
