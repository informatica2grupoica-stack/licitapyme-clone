'use client';

// RELOJ DE ENTREGA, MULTAS Y PRÓRROGAS (spec §15). "El plazo ofertado es perentorio, de vida o
// muerte" (§9.7) — este bloque solo mide, avisa y deja registrada cualquier excepción, nunca
// suspende nada por su cuenta.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { Select } from '@/app/components/ui/Select';
import {
  Clock, Loader2, AlertTriangle, CalendarClock, FileWarning, Sparkles,
} from 'lucide-react';

type PlazoTipo = 'HABILES' | 'CORRIDOS';
type Color = 'VERDE' | 'AMARILLO' | 'ROJO' | 'VENCIDO';

interface Reloj {
  hitoInicio: string | null; fechaInicio: string | null; plazoDias: number | null; plazoTipo: PlazoTipo;
  fechaLimite: string | null; fijadoPorNombre: string | null; fijadoAt: string | null;
  prorroga: { fechaLimite: string | null; motivo: string | null; autorizadoPorNombre: string | null } | null;
  entregaConMulta: { motivo: string | null; autorizadoPorNombre: string | null } | null;
  fechaLimiteVigente: string | null; diasRestantes: number | null; color: Color | null; enVentanaProrroga: boolean;
}
interface EscenarioMulta { diasAtraso: number; costoEstimado: number | null; nota: string | null }

const COLOR_STYLE: Record<Color, string> = {
  VERDE: 'text-emerald-700 bg-emerald-50 border-emerald-200', AMARILLO: 'text-amber-700 bg-amber-50 border-amber-200',
  ROJO: 'text-rose-700 bg-rose-50 border-rose-200', VENCIDO: 'text-white bg-rose-700 border-rose-800',
};
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function RelojEntregaCard({ negocioId, esJefeDeVentas, puedeOperar }: { negocioId: number; esJefeDeVentas: boolean; puedeOperar: boolean }) {
  const toast = useToast();
  const [reloj, setReloj] = useState<Reloj | null>(null);
  const [escenariosMulta, setEscenariosMulta] = useState<EscenarioMulta[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [formAbierto, setFormAbierto] = useState(false);
  const [form, setForm] = useState({ hitoInicio: '', fechaInicio: '', plazoDias: '', plazoTipo: 'CORRIDOS' as PlazoTipo });
  const [guardando, setGuardando] = useState(false);
  const [cargandoMultas, setCargandoMultas] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/reloj`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setReloj(data.reloj);
    } catch (e: any) {
      toast.error('No se pudo cargar el reloj de entrega', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const fijar = async () => {
    if (!form.hitoInicio.trim() || !form.fechaInicio || !form.plazoDias) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/reloj`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hitoInicio: form.hitoInicio.trim(), fechaInicio: form.fechaInicio, plazoDias: Number(form.plazoDias), plazoTipo: form.plazoTipo }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo fijar');
      toast.success('Reloj fijado', 'Validación manual registrada (spec §15.1).');
      setReloj(data.reloj); setFormAbierto(false);
    } catch (e: any) {
      toast.error('No se pudo fijar el reloj', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const pedirProrroga = async () => {
    const nuevaFechaLimite = window.prompt('Nueva fecha límite (YYYY-MM-DD):', reloj?.fechaLimiteVigente || '');
    if (!nuevaFechaLimite) return;
    const motivo = window.prompt('Motivo de la prórroga:');
    if (!motivo?.trim()) return;
    try {
      const res = await fetch(`/api/compras/${negocioId}/reloj/prorroga`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nuevaFechaLimite, motivo }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Prórroga registrada');
      setReloj(data.reloj);
    } catch (e: any) {
      toast.error('No se pudo registrar la prórroga', e.message);
    }
  };

  const autorizarConMulta = async () => {
    const motivo = window.prompt('Decisión expresa: motivo para entregar con multa (spec §15.7 — nunca por silencio ni por atraso):');
    if (!motivo?.trim()) return;
    try {
      const res = await fetch(`/api/compras/${negocioId}/reloj/entrega-con-multa`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo autorizar');
      toast.success('Entrega con multa autorizada');
      setReloj(data.reloj);
    } catch (e: any) {
      toast.error('No se pudo autorizar', e.message);
    }
  };

  const verEscenariosMulta = async () => {
    setCargandoMultas(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/reloj?multas=1`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo calcular');
      setEscenariosMulta(data.escenariosMulta);
      if (!data.escenariosMulta) toast.error('Sin datos de multa', 'Esta licitación no trajo la fórmula de multa extraída por Viabilidad.');
    } catch (e: any) {
      toast.error('No se pudo calcular', e.message);
    } finally {
      setCargandoMultas(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5"><Clock size={14} /> Reloj de entrega</p>
        {!reloj?.fijadoAt && puedeOperar && (
          <button onClick={() => setFormAbierto(v => !v)} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-800">
            {formAbierto ? 'Cerrar' : 'Fijar reloj'}
          </button>
        )}
      </div>

      {formAbierto && (
        <div className="border-b border-zinc-100 px-4 py-3 space-y-2 bg-zinc-50/60">
          <input value={form.hitoInicio} onChange={e => setForm(f => ({ ...f, hitoInicio: e.target.value }))}
            placeholder="Hito desde el cual corre (ej. aceptación de la OC)"
            className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <div className="grid grid-cols-3 gap-2">
            <input type="date" value={form.fechaInicio} onChange={e => setForm(f => ({ ...f, fechaInicio: e.target.value }))}
              className="text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            <input inputMode="numeric" value={form.plazoDias} onChange={e => setForm(f => ({ ...f, plazoDias: e.target.value }))} placeholder="Días de plazo"
              className="text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            <Select value={form.plazoTipo} onChange={v => setForm(f => ({ ...f, plazoTipo: v as PlazoTipo }))}
              options={[{ value: 'CORRIDOS', label: 'Días corridos' }, { value: 'HABILES', label: 'Días hábiles' }]} minWidth={130} />
          </div>
          <button onClick={fijar} disabled={guardando} className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Fijar (validación manual)'}
          </button>
        </div>
      )}

      <div className="p-4 space-y-3">
        {!reloj?.fijadoAt ? (
          <p className="text-[12px] text-zinc-400">El reloj todavía no se ha fijado — requiere validación manual (spec §15.1).</p>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-[13px] font-bold px-2.5 py-1 rounded-lg border ${COLOR_STYLE[reloj.color!]}`}>
                {reloj.color === 'VENCIDO' ? 'Vencido' : `${reloj.diasRestantes} día(s) restante(s)`}
              </span>
              <span className="text-[11.5px] text-zinc-500">Vence {reloj.fechaLimiteVigente} — desde &ldquo;{reloj.hitoInicio}&rdquo;, {reloj.plazoDias} días {reloj.plazoTipo === 'HABILES' ? 'hábiles' : 'corridos'}</span>
            </div>

            {reloj.prorroga && (
              <Banner variante="info">Prórroga concedida por {reloj.prorroga.autorizadoPorNombre}: nuevo plazo {reloj.prorroga.fechaLimite} — {reloj.prorroga.motivo}</Banner>
            )}
            {reloj.entregaConMulta && (
              <Banner variante="warning">Entrega con multa autorizada por {reloj.entregaConMulta.autorizadoPorNombre}: {reloj.entregaConMulta.motivo}. Anula la bonificación (spec §15.5).</Banner>
            )}
            {reloj.enVentanaProrroga && !reloj.prorroga && (
              <Banner variante="warning">En ventana de prórroga (5-10 días antes del vencimiento) — spec §15.4.</Banner>
            )}

            {esJefeDeVentas && (
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={pedirProrroga} className="flex items-center gap-1 text-[11.5px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 px-2.5 py-1.5 rounded-lg">
                  <CalendarClock size={12} /> Registrar prórroga
                </button>
                {!reloj.entregaConMulta && (
                  <button onClick={autorizarConMulta} className="flex items-center gap-1 text-[11.5px] font-semibold text-white bg-rose-600 hover:bg-rose-700 px-2.5 py-1.5 rounded-lg">
                    <FileWarning size={12} /> Autorizar entrega con multa
                  </button>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-zinc-100">
              <button onClick={verEscenariosMulta} disabled={cargandoMultas} className="flex items-center gap-1 text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                {cargandoMultas ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Calcular escenarios de multa (spec §15.6)
              </button>
              {escenariosMulta && (
                <div className="mt-2 space-y-1">
                  {escenariosMulta.map(e => (
                    <div key={e.diasAtraso} className="flex items-center justify-between gap-2 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5">
                      <span className="text-[11.5px] text-zinc-600">{e.diasAtraso} día(s) de atraso{e.nota && <span className="text-zinc-400"> — {e.nota}</span>}</span>
                      <span className="text-[12.5px] font-bold text-zinc-800 flex-shrink-0">{fmtCLP(e.costoEstimado)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
