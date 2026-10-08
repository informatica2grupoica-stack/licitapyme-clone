'use client';

// FRANJA FIJA del módulo de Compras: lo que el encargado necesita ver en TODOS los pasos sin
// buscarlo — el reloj de entrega (cuándo vence, cuántos días quedan o si falta confirmarlo) y las
// incidencias abiertas. Antes el reloj vivía enterrado en el paso "Tareas" y no era una tarea.
import { useEffect, useState } from 'react';
import { IconClock as Clock, IconAlertTriangle as AlertTriangle, IconSparkles as Sparkles, IconChevronRight as Chevron } from '@tabler/icons-react';

interface RelojMin { fijadoAt: string | null; fechaLimiteVigente: string | null; diasRestantes: number | null; color: 'VERDE' | 'AMARILLO' | 'ROJO' | 'VENCIDO' | 'ENTREGADO' | null; entregado: { aTiempo: boolean } | null }

const ESTILO: Record<string, string> = {
  VERDE: 'border-emerald-200 bg-emerald-50/60 text-emerald-800', AMARILLO: 'border-amber-300 bg-amber-50 text-amber-800',
  ROJO: 'border-rose-300 bg-rose-50 text-rose-800', VENCIDO: 'border-rose-400 bg-rose-100 text-rose-900', ENTREGADO: 'border-emerald-300 bg-emerald-50 text-emerald-800',
};
const dmy = (s: string) => s.split('-').reverse().join('-');

export function FranjaCompra({ negocioId, incidenciasAbiertas, onIrEntrega, onIrIncidencias, version }: {
  negocioId: number; incidenciasAbiertas: number; onIrEntrega: () => void; onIrIncidencias: () => void; version: number;
}) {
  const [reloj, setReloj] = useState<RelojMin | null>(null);
  const [haySugerido, setHaySugerido] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/reloj`).then(r => r.json()).then(d => {
      if (!vivo || !d?.success) return;
      setReloj(d.reloj); setHaySugerido(!!d.sugerido);
    }).catch(() => {});
    return () => { vivo = false; };
  }, [negocioId, version]);

  if (!reloj) return null;
  const fijado = !!reloj.fijadoAt && reloj.color;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="franja-compra">
      <button type="button" onClick={onIrEntrega}
        className={`inline-flex items-center gap-2 text-[13px] font-semibold px-3 py-2 rounded-lg border transition-colors hover:shadow-sm ${fijado ? ESTILO[reloj.color!] : haySugerido ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-zinc-200 bg-white text-zinc-500'}`}>
        {fijado ? <Clock size={15} /> : haySugerido ? <Sparkles size={15} /> : <Clock size={15} />}
        {fijado
          ? (reloj.color === 'ENTREGADO'
              ? (reloj.entregado?.aTiempo ? 'Entregado a tiempo' : 'Entregado con atraso')
              : reloj.color === 'VENCIDO'
                ? `Plazo de entrega vencido (${reloj.fechaLimiteVigente ? dmy(reloj.fechaLimiteVigente) : ''})`
                : `Entrega vence el ${dmy(reloj.fechaLimiteVigente!)} · quedan ${reloj.diasRestantes} día${reloj.diasRestantes === 1 ? '' : 's'}`)
          : haySugerido ? 'Plazo de entrega calculado: confírmalo' : 'Plazo de entrega: falta la OC aceptada'}
        <Chevron size={14} className="opacity-60" />
      </button>
      {incidenciasAbiertas > 0 && (
        <button type="button" onClick={onIrIncidencias}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 hover:shadow-sm transition-colors">
          <AlertTriangle size={15} /> {incidenciasAbiertas} incidencia{incidenciasAbiertas === 1 ? '' : 's'} abierta{incidenciasAbiertas === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
