'use client';

// Sección "Resultado" — lo que en Mercado Público se habilita cuando la licitación
// cierra/adjudica: quién ganó cada línea y por cuánto. Usa el endpoint enriquecido
// /api/licitacion-adjudicacion (mismo que Postuladas): marca las líneas NUESTRAS.
//
// El "Cuadro de ofertas" completo (todos los oferentes con sus precios) NO viene en
// la API — solo el ganador por línea. Ese comparativo está en el PDF del ACTA
// (UrlActa), por eso lo ofrecemos como botón destacado.

import { useEffect, useState } from 'react';
import {
  Trophy, Award, Calendar, Users, FileCheck2, ExternalLink,
  CheckCircle2, Loader2, Hourglass, ChevronDown, ChevronUp, Table2,
} from 'lucide-react';

interface LineaAdjudicada {
  correlativo?: number;
  producto?: string;
  descripcion?: string;
  montoUnitario: number | null;
  rutProveedor: string | null;
  proveedor: string | null;
  esNuestra?: boolean;
}
interface Adjudicacion {
  success?: boolean;
  esAdjudicada: boolean;
  estado?: string | null;
  fechaAdjudicacion?: string | null;
  ganamos?: boolean;
  montoNuestro?: number | null;
  montoAdjudicadoTotal?: number | null;
  adjudicacion?: {
    numeroResolucion?: string | null;
    numeroOferentes?: number | null;
    urlActa?: string | null;
  } | null;
  lineasAdjudicadas?: LineaAdjudicada[];
}

function fmtCLP(n: number | null | undefined) {
  if (n == null || n === 0) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

export function ResultadoSection({ codigo, mpUrl }: { codigo: string; mpUrl: string }) {
  const [adj, setAdj] = useState<Adjudicacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verLineas, setVerLineas] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError(null);
    fetch(`/api/licitacion-adjudicacion/${encodeURIComponent(codigo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!vivo) return; if (d?.success) setAdj(d); else setError('No se pudo obtener el resultado de Mercado Público'); })
      .catch(() => { if (vivo) setError('Error de red al consultar el resultado'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [codigo]);

  if (cargando) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 flex items-center justify-center gap-2 text-slate-500 text-sm">
        <Loader2 size={16} className="animate-spin" /> Consultando el resultado en Mercado Público…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">
        {error}. <a href={mpUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-semibold hover:underline">Abrir en Mercado Público</a>
      </div>
    );
  }

  // Aún sin adjudicar → estado informativo.
  if (!adj?.esAdjudicada) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm font-medium">
          <Hourglass size={16} /> Aún sin resultado publicado{adj?.estado ? ` · Estado en MP: ${adj.estado}` : ''}
        </div>
        <p className="text-[13px] text-slate-500 mt-3">
          Cuando Mercado Público publique la adjudicación, aquí verás <b>quién ganó cada línea</b> (con las nuestras
          resaltadas) y el <b>acta con el cuadro comparativo</b> de todos los oferentes.
        </p>
        <a href={mpUrl} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-600 hover:text-indigo-700">
          <ExternalLink size={14} /> Ver ficha en Mercado Público
        </a>
      </div>
    );
  }

  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];
  const ganamos = !!adj.ganamos;
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const acc = ganamos ? '#059669' : '#dc2626';

  return (
    <div className="space-y-4">
      {/* Encabezado del resultado */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: acc + '40' }}>
        <div className="px-5 py-4 flex items-center gap-3 flex-wrap" style={{ background: acc + '0d' }}>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold px-3 py-1 rounded-full border"
            style={{ color: acc, background: acc + '18', borderColor: acc + '33' }}>
            {ganamos ? <Trophy size={14} /> : <Award size={14} />}
            {ganamos ? `Ganamos ${nuestras} línea${nuestras !== 1 ? 's' : ''}` : 'Adjudicada a terceros'}
          </span>
          {adj.fechaAdjudicacion && (
            <span className="inline-flex items-center gap-1 text-[12px] text-slate-600">
              <Calendar size={13} /> {new Date(adj.fechaAdjudicacion).toLocaleDateString('es-CL')}
            </span>
          )}
          {meta?.numeroOferentes != null && (
            <span className="inline-flex items-center gap-1 text-[12px] text-slate-600">
              <Users size={13} /> {meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}
            </span>
          )}
          {meta?.numeroResolucion && (
            <span className="text-[12px] text-slate-600">Res. N° {meta.numeroResolucion}</span>
          )}
          <span className="ml-auto text-[12px] font-bold" style={{ color: acc }}>
            {ganamos ? `Ganado: ${fmtCLP(adj.montoNuestro)}` : `Adjudicado: ${fmtCLP(adj.montoAdjudicadoTotal)}`}
          </span>
        </div>

        {/* Acta de adjudicación — cuadro comparativo completo */}
        {meta?.urlActa && (
          <a href={meta.urlActa} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-5 py-3.5 border-t transition-colors hover:bg-slate-50"
            style={{ borderColor: acc + '22' }}>
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: acc + '18', color: acc }}>
              <Table2 size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-slate-800">Ver acta de adjudicación</span>
              <span className="block text-[11.5px] text-slate-500">Incluye el cuadro comparativo de todos los oferentes y sus precios</span>
            </span>
            <FileCheck2 size={16} className="ml-auto flex-shrink-0" style={{ color: acc }} />
          </a>
        )}
      </div>

      {/* Ganadores por línea */}
      {lineas.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <button onClick={() => setVerLineas(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
            <span className="text-[13px] font-bold text-slate-700 inline-flex items-center gap-2">
              <Award size={15} className="text-slate-400" /> Adjudicación por línea ({lineas.length})
            </span>
            {verLineas ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </button>
          {verLineas && (
            <div className="px-4 pb-4 space-y-1.5">
              {lineas.map((l, i) => (
                <div key={i}
                  className={`flex items-start justify-between gap-3 rounded-xl px-3.5 py-2.5 border ${
                    l.esNuestra ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                  }`}>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-slate-800 truncate" title={l.producto || l.descripcion}>
                      {l.producto || l.descripcion || `Línea ${l.correlativo ?? i + 1}`}
                    </p>
                    <p className={`text-[11.5px] truncate ${l.esNuestra ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}
                      title={`${l.proveedor || ''} ${l.rutProveedor || ''}`}>
                      {l.esNuestra ? <CheckCircle2 size={11} className="inline mr-1 -mt-0.5" /> : <Award size={10} className="inline mr-1" />}
                      {l.proveedor || 'Proveedor adjudicado'}{l.rutProveedor ? ` · ${l.rutProveedor}` : ''}
                    </p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    {l.esNuestra && <span className="block text-[9px] font-black tracking-wide text-emerald-600 uppercase">Nosotros</span>}
                    <span className="text-[12.5px] font-bold text-slate-800">{fmtCLP(l.montoUnitario)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11.5px] text-slate-400 px-1">
        La API de Mercado Público entrega solo el <b>ganador</b> por línea. El detalle de <b>todos</b> los
        oferentes y sus precios (cuadro de ofertas) está en el acta de adjudicación.
      </p>
    </div>
  );
}
