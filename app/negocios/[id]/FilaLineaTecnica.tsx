'use client';

// AUDITOR TÉCNICO (Fase 1) — fila del bloque TECNICO para un item tipo='linea_tecnica'.
// InformacionComercialSection.tsx renderiza esto en vez de FilaItem para esas filas.
//
// Tres niveles (spec del Auditor Técnico, sección 5.11):
//   Nivel 1 (siempre visible): resumen "12 de 14 cumple" + acciones (Validar / Subir ficha).
//   Nivel 2 (clic en la cabecera): solo las características problemáticas, con respuesta inline.
//   Nivel 3 ("Ver tabla completa"): todas las características, con corrección para el asesor.
import { useState, useRef, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import {
  Check, X, AlertTriangle, Loader2, Upload, RefreshCw, ChevronDown, ChevronUp,
  Wrench, Undo2, HelpCircle,
} from 'lucide-react';

interface Caracteristica {
  id: number;
  descripcion: string;
  tipo: 'PISO' | 'TECHO' | 'EXACTO' | 'RANGO';
  valor_requerido_texto: string | null;
  valor_requerido_numero: number | null;
  valor_requerido_numero_max: number | null;
  unidad_requerida: string | null;
  valor_ofertado_texto: string | null;
  valor_ofertado_numero: number | null;
  unidad_ofertada_original: string | null;
  valor_convertido_numero: number | null;
  veredicto: 'CUMPLE' | 'NO_CUMPLE' | 'CUMPLE_CON_COMPLEMENTO' | null;
  pendiente_confirmacion_proveedor: boolean;
  fundamento_documento: string | null;
  fundamento_cita: string | null;
  confianza: number | null;
  origen: 'interrogatorio' | 'ficha' | 'manual';
}

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

const VEREDICTO_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  CUMPLE:                 { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Cumple' },
  NO_CUMPLE:               { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'No cumple' },
  CUMPLE_CON_COMPLEMENTO:  { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Con complemento' },
};

function requeridoDe(c: Caracteristica): string {
  if (c.tipo === 'RANGO' && c.valor_requerido_numero != null)
    return `${c.valor_requerido_numero} a ${c.valor_requerido_numero_max ?? c.valor_requerido_numero}${c.unidad_requerida ? ` ${c.unidad_requerida}` : ''}`;
  if (c.valor_requerido_numero != null) return `${c.valor_requerido_numero}${c.unidad_requerida ? ` ${c.unidad_requerida}` : ''}`;
  return c.valor_requerido_texto || '—';
}

function ofertadoDe(c: Caracteristica): string {
  if (c.valor_ofertado_numero != null)
    return `${c.valor_convertido_numero ?? c.valor_ofertado_numero}${c.unidad_ofertada_original ? ` ${c.unidad_ofertada_original}` : ''}`;
  return c.valor_ofertado_texto || '—';
}

const esProblematica = (c: Caracteristica) => c.veredicto !== 'CUMPLE' || c.pendiente_confirmacion_proveedor;

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
  const toast = useToast();
  const [expandido, setExpandido] = useState(false);
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [caracteristicas, setCaracteristicas] = useState<Caracteristica[] | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [validando, setValidando] = useState(false);
  const [subiendoFicha, setSubiendoFicha] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = `/api/negocios/${negocioId}/comercial/${item.id}/caracteristicas`;

  const cargarDetalle = useCallback(async () => {
    setCargandoDetalle(true);
    try {
      const r = await fetch(base);
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo cargar el detalle'); return; }
      setCaracteristicas(d.caracteristicas || []);
    } finally {
      setCargandoDetalle(false);
    }
  }, [base, toast]);

  const alternarExpandido = () => {
    if (!expandido && caracteristicas === null) cargarDetalle();
    setExpandido(v => !v);
  };

  const validar = async () => {
    setValidando(true);
    try {
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'validar' }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo validar la línea'); return; }
      setCaracteristicas(d.caracteristicas || []);
      setExpandido(true);
      toast.success(d.nuevas ? `${d.nuevas} característica${d.nuevas === 1 ? '' : 's'} clasificada${d.nuevas === 1 ? '' : 's'}` : 'Ya estaba clasificada');
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally {
      setValidando(false);
    }
  };

  const subirFicha = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendoFicha(true);
    try {
      const fd = new FormData();
      fd.append('licitacionCodigo', licitacionCodigo);
      fd.append('files', files[0]);
      const rSubida = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
      const dSubida = await rSubida.json();
      if (!rSubida.ok || !dSubida.documentos?.length) { toast.error(dSubida.error || 'No se pudo subir la ficha'); return; }
      const doc = dSubida.documentos[0];
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'comparar_ficha', documentoUrl: doc.url, documentoNombre: doc.nombre }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo comparar la ficha'); return; }
      setCaracteristicas(d.caracteristicas || []);
      setExpandido(true);
      toast.success('Ficha comparada');
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally {
      setSubiendoFicha(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const responder = async (caracteristicaId: number, extra: Record<string, unknown>) => {
    const r = await fetch(base, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'responder', caracteristicaId, ...extra }),
    });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error || 'No se pudo guardar la respuesta'); return; }
    setCaracteristicas(d.caracteristicas || []);
  };

  const corregir = async (caracteristicaId: number, veredicto: string) => {
    const r = await fetch(base, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'corregir', caracteristicaId, veredicto }),
    });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error || 'No se pudo corregir'); return; }
    setCaracteristicas(d.caracteristicas || []);
  };

  const crit = CRIT_STYLE[item.criticidad] || CRIT_STYLE.INFORMATIVO;
  const resumen = item.resumen_tecnico;
  const filas = caracteristicas || [];
  const filasAMostrar = mostrarTodas ? filas : filas.filter(esProblematica);

  return (
    <div className={`px-4 py-3 ${item.estado === 'OBSERVADO' ? 'bg-orange-50/40' : ''}`}>
      <button onClick={alternarExpandido} className="w-full flex items-start gap-3 text-left">
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
            {resumen && resumen.total > 0 && (
              <span className={`text-[11px] font-bold ${resumen.noCumplen > 0 ? 'text-rose-600' : 'text-zinc-500'}`}>
                {resumen.cumplen} de {resumen.total} cumple
                {resumen.noCumplen > 0 && <span className="ml-1">· {resumen.noCumplen} no cumple</span>}
                {resumen.conComplemento > 0 && <span className="ml-1">· {resumen.conComplemento} con complemento</span>}
                {resumen.pendientesProveedor > 0 && <span className="ml-1 text-amber-600">· {resumen.pendientesProveedor} por confirmar</span>}
              </span>
            )}
          </div>
          {item.descripcion && <p className="text-[11.5px] text-zinc-500 leading-snug mt-0.5">{item.descripcion}</p>}
        </div>
        <div className="pt-0.5 text-zinc-300">{expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>
      </button>

      <div className="flex items-center gap-2 mt-2 ml-8 flex-wrap">
        <button onClick={validar} disabled={validando || bloqueado}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-50">
          {validando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {resumen && resumen.total > 0 ? 'Re-validar línea' : 'Validar línea'}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={e => subirFicha(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendoFicha || bloqueado}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-zinc-500 hover:bg-zinc-50 rounded-lg border border-zinc-200 transition-colors disabled:opacity-50">
          {subiendoFicha ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Subir ficha técnica
        </button>

        {puedeAprobar && item.estado === 'CARGADO' && (
          <>
            <button onClick={() => onAccion(item.id, 'APROBAR')} disabled={ocupado}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50 transition-colors">
              {ocupado ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Aprobar línea
            </button>
          </>
        )}
        {puedeAprobar && item.estado === 'APROBADO' && (
          <button onClick={() => onAccion(item.id, 'REABRIR')} title="Reabrir esta línea"
            className="p-1.5 text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">
            <Undo2 size={13} />
          </button>
        )}
      </div>

      {expandido && (
        <div className="mt-3 ml-8 space-y-2">
          {cargandoDetalle ? (
            <div className="flex items-center gap-2 text-[11.5px] text-zinc-400 py-3"><Loader2 size={12} className="animate-spin" /> Cargando características…</div>
          ) : filas.length === 0 ? (
            <p className="text-[11.5px] text-zinc-400">Sin características clasificadas todavía. Pulsa "Validar línea".</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-zinc-400">
                  {mostrarTodas ? `${filas.length} característica${filas.length === 1 ? '' : 's'} en total` : `${filasAMostrar.length} pendiente${filasAMostrar.length === 1 ? '' : 's'} de revisar`}
                </span>
                <button onClick={() => setMostrarTodas(v => !v)} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">
                  {mostrarTodas ? 'Ver solo pendientes' : 'Ver tabla completa'}
                </button>
              </div>
              {filasAMostrar.length === 0 ? (
                <p className="text-[11.5px] text-emerald-600 font-medium">Todas las características cumplen.</p>
              ) : (
                <div className="space-y-1.5">
                  {filasAMostrar.map(c => (
                    <FilaCaracteristica key={c.id} c={c} puedeAprobar={puedeAprobar} bloqueado={bloqueado}
                      onResponder={responder} onCorregir={corregir} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
function FilaCaracteristica({ c, puedeAprobar, bloqueado, onResponder, onCorregir }: {
  c: Caracteristica;
  puedeAprobar: boolean;
  bloqueado: boolean;
  onResponder: (caracteristicaId: number, extra: Record<string, unknown>) => Promise<void>;
  onCorregir: (caracteristicaId: number, veredicto: string) => Promise<void>;
}) {
  const [respondiendo, setRespondiendo] = useState(false);
  const [valorNumero, setValorNumero] = useState('');
  const [unidad, setUnidad] = useState(c.unidad_requerida || '');
  const [valorTexto, setValorTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const est = c.veredicto ? VEREDICTO_STYLE[c.veredicto] : { bg: 'bg-zinc-100', text: 'text-zinc-400', label: 'Sin evaluar' };
  const esNumerica = c.valor_requerido_numero != null;

  const guardar = async () => {
    if (!valorNumero.trim() && !valorTexto.trim()) return;
    setGuardando(true);
    try {
      await onResponder(c.id, {
        valorOfertadoNumero: valorNumero.trim() ? Number(valorNumero) : null,
        unidadOfertadaOriginal: unidad.trim() || null,
        valorOfertadoTexto: valorTexto.trim() || null,
      });
      setRespondiendo(false);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="px-3 py-2 bg-zinc-50 rounded-lg border border-zinc-100">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-zinc-800 leading-snug">{c.descripcion}</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            <span className="font-semibold">{c.tipo}</span> · Exigido: {requeridoDe(c)} · Ofertado: {ofertadoDe(c)}
          </p>
          {c.pendiente_confirmacion_proveedor && (
            <p className="text-[10.5px] text-amber-600 flex items-center gap-1 mt-0.5"><HelpCircle size={11} /> Pendiente de confirmación del proveedor</p>
          )}
          {c.fundamento_cita && <p className="text-[10px] text-zinc-400 mt-0.5 truncate" title={c.fundamento_cita}>Fuente: {c.fundamento_cita}</p>}
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${est.bg} ${est.text}`}>{est.label}</span>
      </div>

      {respondiendo ? (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {esNumerica ? (
            <>
              <input type="text" inputMode="decimal" autoFocus value={valorNumero} onChange={e => setValorNumero(e.target.value)}
                placeholder="Valor ofertado" className="w-28 px-2 py-1 text-[12px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300" />
              <input type="text" value={unidad} onChange={e => setUnidad(e.target.value)}
                placeholder="Unidad" className="w-20 px-2 py-1 text-[12px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300" />
            </>
          ) : (
            <input type="text" autoFocus value={valorTexto} onChange={e => setValorTexto(e.target.value)}
              placeholder="Descripción de lo ofertado" className="flex-1 min-w-[10rem] px-2 py-1 text-[12px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300" />
          )}
          <button onClick={guardar} disabled={guardando} className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold rounded disabled:opacity-50">
            {guardando ? <Loader2 size={11} className="animate-spin" /> : 'Guardar'}
          </button>
          <button onClick={() => setRespondiendo(false)} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {!bloqueado && (
            <button onClick={() => setRespondiendo(true)} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">
              {c.veredicto ? 'Corregir respuesta' : 'Responder'}
            </button>
          )}
          {puedeAprobar && (
            <div className="flex items-center gap-1">
              {(['CUMPLE', 'NO_CUMPLE', 'CUMPLE_CON_COMPLEMENTO'] as const).filter(v => v !== c.veredicto).map(v => (
                <button key={v} onClick={() => onCorregir(c.id, v)}
                  className="text-[10.5px] font-semibold text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 px-1.5 py-0.5 rounded">
                  → {VEREDICTO_STYLE[v].label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
