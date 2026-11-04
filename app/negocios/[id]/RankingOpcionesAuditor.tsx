'use client';
// «¿Qué ficha cumple más?» dentro de la línea del Auditor: una fila por opción con ficha (de la que más cumple a la que menos) y la ganadora marcada.
import { rankearFichas, type OpcionParaRanking } from '@/app/lib/auditor-ranking-fichas';

export default function RankingOpcionesAuditor({ opciones }: { opciones: OpcionParaRanking[] }) {
  const r = rankearFichas(opciones);
  const conFicha = r.filas.length + r.sinComparar.length;
  if (conFicha < 2) return null;
  const nombre = (id: number) => r.filas.find(f => f.id === id)?.nombre ?? '';
  return (
    <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3" data-testid="ranking-fichas-auditor">
      <p className="text-[13px] font-semibold text-slate-900">
        {r.filas.length === 0 ? `${conFicha} fichas cargadas: falta compararlas con las bases`
          : r.ganadoraId != null ? `La ficha que más cumple: ${nombre(r.ganadoraId)}`
          : r.empatan.length > 1 ? `Empatan: ${r.empatan.map(nombre).join(' y ')}`
          : 'Resultado de la ficha'}
      </p>
      {r.filas.length > 0 && r.ningunaCumple && (
        <p className="mt-0.5 text-xs text-amber-800">Ninguna ficha cumple todas las bases todavía{r.filas.length > 1 ? ': la de arriba es la más cercana' : ''}. Sube otra ficha o completa los datos que faltan.</p>
      )}
      {r.filas.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {r.filas.map((f, i) => (
            <li key={f.id} className="flex items-center gap-3 text-[13px]">
              <span className="w-5 text-right tabular-nums text-slate-400">{i + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-slate-900">{f.nombre}</span>
                {f.proveedor ? <span className="text-slate-500"> · {f.proveedor}</span> : null}
                {r.ganadoraId === f.id && <span className="ml-1.5 text-xs font-semibold text-amber-700">Mejor</span>}
                <span className="block truncate text-xs text-slate-500" title={f.fichas.join(', ')}>{f.fichas.length === 1 ? 'Ficha' : `${f.fichas.length} fichas`}: {f.fichas.join(', ')}</span>
              </span>
              <span className="w-28 h-2 rounded-full bg-zinc-200 overflow-hidden shrink-0" role="img" aria-label={`${f.pct} % de los requisitos cumplen`}>
                <span className={`block h-full ${f.pct === 100 ? 'bg-emerald-500' : f.pct >= 70 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${f.pct}%` }} />
              </span>
              <span className="w-32 text-right tabular-nums text-slate-700 shrink-0">{f.cumple} de {f.total} cumplen</span>
            </li>
          ))}
        </ol>
      )}
      {r.sinComparar.length > 0 && r.filas.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">Sin comparar todavía: {r.sinComparar.map(o => o.nombre).join(', ')}. Usa «Comparar la línea» para incluirlas.</p>
      )}
    </div>
  );
}
