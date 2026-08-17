'use client';

// Camino inverso al de SelectorDocumentoAnexo: acá el documento YA EXISTE (se subió a mano, o
// lo generó otra pantalla — costeo, informe, un anexo llenado fuera de la app) y lo que falta
// es decidir a QUÉ PUNTO del checklist del Auditor Técnico corresponde. Mismo motor de
// coincidencia por texto (anexos-match.ts), pero comparando el nombre del archivo contra el
// título de CADA punto tipo "documento" O "linea_tecnica" del negocio — administrativo, técnico
// (anexos genéricos) o comercial, más las líneas técnicas del Agente Técnico (fichas de producto).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Send, AlertTriangle, FileText, Wrench } from 'lucide-react';
import { ordenarPorCoincidencia } from '@/app/lib/anexos-match';

interface ResumenTecnico { total: number; cumplen: number; noCumplen: number; conComplemento: number; sinEvaluar: number; pendientesProveedor: number }
interface ItemChecklist {
  id: number; bloque: 'ADMINISTRATIVO' | 'TECNICO' | 'COMERCIAL'; tipo: string; titulo: string; estado: string;
  resumen_tecnico?: ResumenTecnico | null;
}

const BLOQUE_LABEL: Record<string, string> = { ADMINISTRATIVO: 'Administrativo', TECNICO: 'Técnico', COMERCIAL: 'Comercial' };
const ESTADO_LABEL: Record<string, { label: string; cls: string }> = {
  PENDIENTE: { label: 'Sin cargar', cls: 'bg-zinc-100 text-zinc-500' },
  CARGADO:   { label: 'Por aprobar', cls: 'bg-indigo-100 text-indigo-700' },
  APROBADO:  { label: 'Aprobado', cls: 'bg-emerald-100 text-emerald-700' },
  OBSERVADO: { label: 'Observado', cls: 'bg-orange-100 text-orange-700' },
};

export function SelectorPuntoAuditor({
  negocioId, nombreArchivo, onSeleccionar, onClose,
}: {
  negocioId: number | null;
  nombreArchivo: string | null;
  onSeleccionar: (item: { id: number; tipo: string }) => void;
  onClose: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<(ItemChecklist & { puntaje: number })[]>([]);

  useEffect(() => {
    if (!negocioId || !nombreArchivo) return;
    setCargando(true);
    setError(null);
    fetch(`/api/negocios/${negocioId}/comercial`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) { setError(d.error || 'No se pudo cargar el Auditor Técnico'); return; }
        if (d.migracionPendiente || !d.activo) { setError('El Auditor Técnico todavía no está activo para este negocio.'); return; }
        const items: ItemChecklist[] = (d.items || []).filter((i: ItemChecklist) => i.tipo === 'documento' || i.tipo === 'linea_tecnica');
        const ordenados = ordenarPorCoincidencia(nombreArchivo, items.map(i => ({ id: i.id, nombre: i.titulo })));
        setCandidatos(items.map(i => ({
          ...i,
          puntaje: ordenados.find(o => o.id === i.id)?.puntaje ?? 0,
        })).sort((a, b) => b.puntaje - a.puntaje));
      })
      .catch(e => setError(String(e)))
      .finally(() => setCargando(false));
  }, [negocioId, nombreArchivo]);

  if (!negocioId || !nombreArchivo) return null;

  const mejorPuntaje = candidatos[0]?.puntaje ?? 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enviar documento al Auditor Técnico"
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <Send size={15} className="text-emerald-600 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-slate-800 truncate" title={nombreArchivo}>{nombreArchivo}</p>
            <p className="text-[10.5px] text-slate-400">¿A qué punto del Auditor Técnico corresponde?</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {cargando && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 size={15} className="animate-spin text-emerald-500" /> Cargando checklist…
            </div>
          )}
          {!cargando && error && (
            <div className="flex items-start gap-2 px-3 py-2.5 m-1 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800">{error}</p>
            </div>
          )}
          {!cargando && !error && candidatos.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center px-4">
              <FileText size={20} className="text-slate-300" />
              <p className="text-[12.5px] text-slate-500">Este negocio no tiene puntos de tipo documento en el checklist.</p>
            </div>
          )}
          {!cargando && !error && candidatos.map((c, i) => {
            const esTecnica = c.tipo === 'linea_tecnica';
            const est = ESTADO_LABEL[c.estado] || ESTADO_LABEL.PENDIENTE;
            const r = c.resumen_tecnico;
            return (
              <button
                key={c.id}
                onClick={() => onSeleccionar({ id: c.id, tipo: c.tipo })}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-emerald-50 text-left transition-colors group"
              >
                {esTecnica
                  ? <Wrench size={15} className="text-slate-400 group-hover:text-emerald-500 flex-shrink-0" />
                  : <FileText size={15} className="text-slate-400 group-hover:text-emerald-500 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium text-slate-700 truncate" title={c.titulo}>{c.titulo}</p>
                  <p className="text-[10px] text-slate-400">
                    {BLOQUE_LABEL[c.bloque] || c.bloque}
                    {esTecnica && r && r.total > 0 && ` · ${r.cumplen} de ${r.total} cumple`}
                    {esTecnica && (!r || r.total === 0) && ' · sin validar'}
                  </p>
                </div>
                {esTecnica ? (
                  <span className="flex-shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                    Comparar ficha
                  </span>
                ) : (
                  <span className={`flex-shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>
                )}
                {i === 0 && mejorPuntaje > 0 && (
                  <span className="flex-shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                    Sugerido
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
