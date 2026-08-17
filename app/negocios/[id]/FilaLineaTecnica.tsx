'use client';

// AUDITOR TÉCNICO (Fase 1) — fila del bloque TECNICO para un item tipo='linea_tecnica'.
// InformacionComercialSection.tsx renderiza esto en vez de FilaItem para esas filas.
//
// La fila es solo el resumen (para poder escanear 100+ líneas de un vistazo, ver la barra de
// InformacionComercialSection.tsx): estado, título, criticidad y "N de M cumple". El detalle —
// comparación por característica exigido/ofertado, precio y plazo de la línea, documento fuente —
// vive en ModalAuditorLineaTecnica.tsx, que se abre con "Ver comparación".
import { useState } from 'react';
import { Check, X, Wrench, Undo2, Loader2 } from 'lucide-react';
import { ModalAuditorLineaTecnica } from '@/app/components/ModalAuditorLineaTecnica';

interface ResumenTecnico { total: number; cumplen: number; noCumplen: number; conComplemento: number; sinEvaluar: number; pendientesProveedor: number }

interface ItemLineaTecnica {
  id: number;
  titulo: string;
  descripcion: string | null;
  criticidad: string;
  estado: 'PENDIENTE' | 'CARGADO' | 'APROBADO' | 'OBSERVADO';
  resumen_tecnico: ResumenTecnico | null;
}

const CRIT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  ADMISIBILIDAD_DURA:    { bg: 'bg-rose-100',  text: 'text-rose-700',  label: 'Admisibilidad' },
  PUNTAJE_CONDICIONANTE: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Puntaje' },
  COMPROMISO_EJECUCION:  { bg: 'bg-sky-100',   text: 'text-sky-700',   label: 'Ejecución' },
  INFORMATIVO:           { bg: 'bg-zinc-100',  text: 'text-zinc-500',  label: 'Informativo' },
};

// ════════════════════════════════════════════════════════════════════════════════
export function FilaLineaTecnica({ item, negocioId, licitacionCodigo, puedeAprobar, bloqueado, ocupado, onAccion }: {
  item: ItemLineaTecnica;
  negocioId: number;
  licitacionCodigo: string;
  puedeAprobar: boolean;
  bloqueado: boolean;
  ocupado: boolean;
  onAccion: (itemId: number, accion: string, extra?: Record<string, unknown>) => Promise<boolean>;
}) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const crit = CRIT_STYLE[item.criticidad] || CRIT_STYLE.INFORMATIVO;
  const resumen = item.resumen_tecnico;

  return (
    <div className={`px-4 py-3 ${item.estado === 'OBSERVADO' ? 'bg-orange-50/40' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          {item.estado === 'APROBADO'
            ? <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><Check size={12} className="text-white" /></div>
            : item.estado === 'OBSERVADO'
              ? <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center"><X size={12} className="text-white" /></div>
              : <div className={`w-5 h-5 rounded-full border-2 ${item.estado === 'CARGADO' ? 'border-indigo-400 bg-indigo-50' : 'border-zinc-200'}`} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 flex-wrap">
            <Wrench size={12} className="text-zinc-400 mt-0.5 flex-shrink-0" />
            <p className="text-[13px] font-semibold text-zinc-800 leading-snug">{item.titulo}</p>
            <span className={`text-[9.5px] font-bold px-1.5 py-px rounded ${crit.bg} ${crit.text}`}>{crit.label}</span>
            {resumen && resumen.total > 0 ? (
              <span className={`text-[11px] font-bold ${resumen.noCumplen > 0 ? 'text-rose-600' : 'text-zinc-500'}`}>
                {resumen.cumplen} de {resumen.total} cumple
                {resumen.noCumplen > 0 && <span className="ml-1">· {resumen.noCumplen} no cumple</span>}
                {resumen.conComplemento > 0 && <span className="ml-1">· {resumen.conComplemento} con complemento</span>}
                {resumen.pendientesProveedor > 0 && <span className="ml-1 text-amber-600">· {resumen.pendientesProveedor} por confirmar</span>}
              </span>
            ) : (
              <span className="text-[11px] text-zinc-400">Sin validar todavía</span>
            )}
          </div>
          {item.descripcion && <p className="text-[11.5px] text-zinc-500 leading-snug mt-0.5">{item.descripcion}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 ml-8 flex-wrap">
        <button onClick={() => setModalAbierto(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors">
          Ver comparación
        </button>

        {puedeAprobar && item.estado === 'CARGADO' && (
          <button onClick={() => onAccion(item.id, 'APROBAR')} disabled={ocupado}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50 transition-colors">
            {ocupado ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Aprobar línea
          </button>
        )}
        {puedeAprobar && item.estado === 'APROBADO' && (
          <button onClick={() => onAccion(item.id, 'REABRIR')} title="Reabrir esta línea"
            className="p-1.5 text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">
            <Undo2 size={13} />
          </button>
        )}
      </div>

      {modalAbierto && (
        <ModalAuditorLineaTecnica
          negocioId={negocioId}
          itemId={item.id}
          licitacionCodigo={licitacionCodigo}
          puedeAprobar={puedeAprobar}
          bloqueado={bloqueado}
          onClose={() => setModalAbierto(false)}
          onAccion={onAccion}
        />
      )}
    </div>
  );
}
