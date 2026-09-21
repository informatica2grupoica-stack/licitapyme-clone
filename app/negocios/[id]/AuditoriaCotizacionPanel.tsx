'use client';

// INFORME DEL AUDITOR por cotización × producto (compras-auditoria-cotizacion.ts). Responde lo que
// pidió el usuario (21-sep-2026): "si el producto no es el que corresponde debe decirme que no, y por
// qué". Cada punto muestra lo exigido, lo que dice la cotización y la cita literal que lo respalda
// (con la marca de si el CÓDIGO pudo verificarla). Una persona puede decidir distinto al auditor,
// pero con motivo obligatorio y a su nombre.
import { useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { IconLoader2 as Loader2, IconShieldCheck as ShieldCheck, IconRefresh as Refresh, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconCheck as Check, IconAlertTriangle as AlertTriangle, IconQuote as Quote } from '@tabler/icons-react';

type Cumple = 'CUMPLE' | 'MEJORA' | 'INFERIOR_NEGOCIABLE' | 'INFERIOR_INSALVABLE' | 'NO_ES_EL_PRODUCTO';
type Dictamen = 'APTA' | 'CON_OBSERVACIONES' | 'NO_APTA' | 'NO_ES_EL_PRODUCTO' | 'NO_VERIFICABLE';

export interface RevisionUI {
  area: string; criterio: string; requerido: string | null; cotizado: string | null;
  resultado: 'CUMPLE' | 'NO_CUMPLE' | 'NO_VERIFICABLE'; gravedad: 'critico' | 'aviso' | 'info'; explicacion: string; origen: 'codigo' | 'ia';
  citaCotizacion: string | null; citaCotizacionVerificada: boolean; citaRequisito: string | null; citaRequisitoVerificada: boolean;
}
export interface AuditoriaUI {
  cotizacionId: number; productoId: number; dictamen: Dictamen; resumen: string | null; revisiones: RevisionUI[];
  generadoAt: string; generadoPorNombre: string | null; cumpleAplicado: Cumple | null;
  override: { cumple: Cumple; motivo: string; porNombre: string | null; at: string } | null;
}

const DICTAMEN: Record<Dictamen, { label: string; cls: string }> = {
  APTA: { label: 'Apta', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  CON_OBSERVACIONES: { label: 'Con observaciones', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  NO_APTA: { label: 'No apta', cls: 'text-rose-700 bg-rose-50 border-rose-200' },
  NO_ES_EL_PRODUCTO: { label: 'No es el producto', cls: 'text-white bg-rose-600 border-rose-700' },
  NO_VERIFICABLE: { label: 'No verificable', cls: 'text-zinc-700 bg-zinc-100 border-zinc-300' },
};
const CUMPLE_LABEL: Record<Cumple, string> = {
  CUMPLE: 'Cumple', MEJORA: 'Mejora', INFERIOR_NEGOCIABLE: 'Inferior (negociable)', INFERIOR_INSALVABLE: 'Inferior (insalvable)', NO_ES_EL_PRODUCTO: 'No es el producto',
};
const RESULTADO: Record<RevisionUI['resultado'], { label: string; cls: string; borde: string }> = {
  NO_CUMPLE: { label: 'No cumple', cls: 'text-rose-700 bg-rose-50', borde: 'border-l-rose-400' },
  NO_VERIFICABLE: { label: 'No verificable', cls: 'text-amber-700 bg-amber-50', borde: 'border-l-amber-400' },
  CUMPLE: { label: 'Cumple', cls: 'text-emerald-700 bg-emerald-50', borde: 'border-l-emerald-400' },
};
const ORDEN_RESULTADO: RevisionUI['resultado'][] = ['NO_CUMPLE', 'NO_VERIFICABLE', 'CUMPLE'];

function BadgeDictamen({ d }: { d: Dictamen }) {
  return <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full border ${DICTAMEN[d].cls}`}><ShieldCheck size={11} /> {DICTAMEN[d].label}</span>;
}

function FilaRevision({ r }: { r: RevisionUI }) {
  const est = RESULTADO[r.resultado];
  return (
    <div className={`border-l-[3px] ${est.borde} bg-white rounded-r-lg px-2.5 py-1.5`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${est.cls}`}>{est.label}</span>
        <span className="text-[11.5px] font-semibold text-zinc-800">{r.criterio}</span>
        <span className="text-[9.5px] font-semibold text-zinc-400 uppercase">{r.origen === 'codigo' ? 'Regla' : 'IA'} · {r.area}</span>
        {r.gravedad === 'critico' && r.resultado !== 'CUMPLE' && <span className="text-[9.5px] font-bold text-rose-600">CRÍTICO</span>}
      </div>
      {(r.requerido || r.cotizado) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 mt-1 text-[11px]">
          <p className="text-zinc-500"><span className="font-semibold text-zinc-600">Se exige:</span> {r.requerido || '—'}</p>
          <p className="text-zinc-500"><span className="font-semibold text-zinc-600">Cotización dice:</span> {r.cotizado || '—'}</p>
        </div>
      )}
      <p className="text-[11.5px] text-zinc-700 mt-0.5">{r.explicacion}</p>
      {(r.citaCotizacion || r.citaRequisito) && (
        <div className="mt-1 space-y-0.5">
          {r.citaCotizacion && (
            <p className="text-[10.5px] text-zinc-500 flex items-start gap-1">
              <Quote size={10} className="mt-0.5 flex-shrink-0" />
              <span><span className="italic">“{r.citaCotizacion}”</span> <span className="font-semibold">— cotización</span>{' '}
                {r.citaCotizacionVerificada
                  ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold"><Check size={10} /> verificada</span>
                  : <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold"><AlertTriangle size={10} /> no se pudo verificar</span>}</span>
            </p>
          )}
          {r.citaRequisito && (
            <p className="text-[10.5px] text-zinc-500 flex items-start gap-1">
              <Quote size={10} className="mt-0.5 flex-shrink-0" />
              <span><span className="italic">“{r.citaRequisito}”</span> <span className="font-semibold">— lo exigido</span>{' '}
                {r.citaRequisitoVerificada
                  ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold"><Check size={10} /> verificada</span>
                  : <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold"><AlertTriangle size={10} /> no se pudo verificar</span>}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditoriaCotizacionPanel({ negocioId, cotizacionId, productoId, productoNombre, auditoria, puedeOperar, onCambio }: {
  negocioId: number; cotizacionId: number; productoId: number; productoNombre: string;
  auditoria: AuditoriaUI | undefined; puedeOperar: boolean; onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [auditando, setAuditando] = useState(false);
  const [decidiendo, setDecidiendo] = useState(false);
  const [veredicto, setVeredicto] = useState<Cumple>('CUMPLE');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const auditar = async () => {
    setAuditando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${cotizacionId}/auditar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo auditar');
      await onCambio();
      setAbierto(true);
    } catch (e: any) {
      toast.error('No se pudo auditar la cotización', e.message);
    } finally { setAuditando(false); }
  };

  const decidir = async (cumple: Cumple | null) => {
    setEnviando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${cotizacionId}/auditoria-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId, cumple, motivo }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      setDecidiendo(false); setMotivo('');
      await onCambio();
    } catch (e: any) {
      toast.error('No se pudo registrar la decisión', e.message);
    } finally { setEnviando(false); }
  };

  if (!auditoria) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-zinc-500 bg-zinc-50 border border-dashed border-zinc-300 rounded-lg px-2.5 py-1.5">
        <span className="font-semibold text-zinc-700 truncate">{productoNombre}:</span>
        <span>{auditando ? 'El auditor está revisando…' : 'Sin auditar todavía — el veredicto no está respaldado.'}</span>
        {puedeOperar && (
          <button onClick={auditar} disabled={auditando} className="ml-auto flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 flex-shrink-0">
            {auditando ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Auditar ahora
          </button>
        )}
      </div>
    );
  }

  const revs = [...auditoria.revisiones].sort((a, b) => ORDEN_RESULTADO.indexOf(a.resultado) - ORDEN_RESULTADO.indexOf(b.resultado));
  const discrepa = auditoria.override && auditoria.cumpleAplicado && auditoria.override.cumple !== auditoria.cumpleAplicado;

  return (
    <div className="border border-zinc-200 rounded-lg bg-zinc-50/60">
      <div className="flex items-start gap-2 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <BadgeDictamen d={auditoria.dictamen} />
            <span className="text-[11.5px] font-semibold text-zinc-700">{productoNombre}</span>
            {auditoria.override && <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full">Decisión manual: {CUMPLE_LABEL[auditoria.override.cumple]}</span>}
          </div>
          {auditoria.resumen && <p className={`text-[11px] text-zinc-600 mt-0.5 ${abierto ? '' : 'line-clamp-2'}`}>{auditoria.resumen}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {puedeOperar && (
            <button onClick={auditar} disabled={auditando} title="Volver a auditar" className="text-zinc-400 hover:text-teal-700 disabled:opacity-50">
              {auditando ? <Loader2 size={13} className="animate-spin" /> : <Refresh size={13} />}
            </button>
          )}
          <button onClick={() => setAbierto(a => !a)} className="flex items-center gap-0.5 text-[11px] font-semibold text-teal-700 hover:text-teal-800">
            {abierto ? <>Ocultar <ChevronUp size={12} /></> : <>Ver informe <ChevronDown size={12} /></>}
          </button>
        </div>
      </div>

      {abierto && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-zinc-200 pt-2">
          <div className="space-y-1.5">{revs.map((r, i) => <FilaRevision key={i} r={r} />)}</div>
          <p className="text-[10px] text-zinc-400">Auditado {auditoria.generadoAt}{auditoria.generadoPorNombre ? ` · ${auditoria.generadoPorNombre}` : ' · automático'}. Un “cumple” solo aparece cuando la cotización lo dice con una cita literal.</p>

          {auditoria.override && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5">
              <p className="text-[11px] font-bold text-indigo-800">
                {auditoria.override.porNombre || 'Un usuario'} decidió “{CUMPLE_LABEL[auditoria.override.cumple]}” ({auditoria.override.at})
                {discrepa && <> · el auditor había dictaminado <span className="underline">{DICTAMEN[auditoria.dictamen].label}</span></>}
              </p>
              <p className="text-[11px] text-indigo-900 mt-0.5">Motivo: {auditoria.override.motivo}</p>
              {puedeOperar && (
                <button onClick={() => decidir(null)} disabled={enviando} className="mt-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline disabled:opacity-50">
                  Volver al dictamen del auditor
                </button>
              )}
            </div>
          )}

          {puedeOperar && !auditoria.override && (
            decidiendo ? (
              <div className="rounded-lg border border-zinc-300 bg-white p-2 space-y-1.5">
                <p className="text-[11px] text-zinc-600">Vas a decidir distinto al auditor. Queda registrado a tu nombre.</p>
                <Select value={veredicto} minWidth={190} onChange={v => setVeredicto(v as Cumple)}
                  options={(Object.keys(CUMPLE_LABEL) as Cumple[]).map(k => ({ value: k, label: CUMPLE_LABEL[k] }))} />
                <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (obligatorio, mínimo 15 caracteres): por qué decides distinto al auditor…"
                  className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
                <div className="flex items-center gap-2">
                  <button onClick={() => decidir(veredicto)} disabled={enviando || motivo.trim().length < 15}
                    className="text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                    {enviando ? <Loader2 size={12} className="animate-spin" /> : 'Registrar decisión'}
                  </button>
                  <button onClick={() => { setDecidiendo(false); setMotivo(''); }} className="text-[11.5px] text-zinc-500 hover:text-zinc-700">Cancelar</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setDecidiendo(true)} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800 underline">Decidir distinto al auditor…</button>
            )
          )}
        </div>
      )}
    </div>
  );
}
