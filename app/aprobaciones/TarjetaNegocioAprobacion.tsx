'use client';

// TARJETA de un negocio dentro de la bandeja de aprobación transversal (/aprobaciones).
// Fila compacta por defecto (código, nombre, semáforo, chips de estado por bloque) + un botón
// "Aprobar" único que visa técnico y comercial de un clic. El detalle por bloque (rechazar con
// comentario, ver el desglose completo) queda en un panel que se abre solo si hace falta —
// la mayoría de las veces no hace falta, así que no se muestra por defecto.
import { useState } from 'react';
import Link from 'next/link';
import {
  Wrench, DollarSign, Check, X, Loader2, ArrowUpRight, Trash2,
  ChevronDown, AlertTriangle, CheckCircle2,
} from 'lucide-react';

export interface CausalBloqueo { codigo: string; descripcion: string; rutaDesbloqueo: string }

export interface NegocioAprobacion {
  negocioId: number;
  licitacionCodigo: string;
  licitacionNombre: string | null;
  licitacionOrganismo: string | null;
  asignadoNombre: string | null;
  cierre: { fecha: string | null; horasRestantes: number | null };
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
  causalesBloqueo: CausalBloqueo[];
  bloques: {
    TECNICO: { estado: string; total: number; aprobados: number; porAprobar: number; observados: number };
    COMERCIAL: { estado: string; total: number; aprobados: number; porAprobar: number; observados: number };
  };
  veredictoTecnico: { cumplen: number; noCumplen: number; conComplemento: number; sinEvaluar: number };
  comercial: { precioTotal: number | null; plazoOfertado: string | null };
  decisionesEstrategicas: { lineasNoOfertadas: number; especificacionesCorregidas: number };
  alertasMotorComercial: Array<{ codigo: string; descripcion: string; detalle: string }>;
}

// Semáforo del Auditor Técnico (spec §9.4) — verde >72h y sin bloqueantes, amarillo <72h o sin
// aprobación vigente, rojo <24h o algo bloqueante. Ver app/lib/semaforo-auditor.ts.
const SEMAFORO_STYLE: Record<string, { dot: string; text: string; label: (h: number | null) => string }> = {
  ROJO:     { dot: 'bg-rose-500',    text: 'text-rose-600 dark:text-rose-400',       label: h => h != null && h < 0 ? 'Vencida' : `${Math.max(1, Math.round(h ?? 0))}h` },
  AMARILLO: { dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     label: h => h == null ? '—' : `${Math.round((h ?? 0) / 24)}d` },
  VERDE:    { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: h => h == null ? '—' : `${Math.round((h ?? 0) / 24)}d` },
};

const ESTADO_BLOQUE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  SIN_ITEMS:   { bg: 'bg-zinc-100 dark:bg-white/5',        text: 'text-zinc-400 dark:text-zinc-600',     label: 'sin puntos' },
  PENDIENTE:   { bg: 'bg-zinc-100 dark:bg-white/5',        text: 'text-zinc-500 dark:text-zinc-400',     label: 'pendiente' },
  POR_APROBAR: { bg: 'bg-indigo-100 dark:bg-indigo-500/15', text: 'text-indigo-700 dark:text-indigo-300', label: 'por aprobar' },
  OBSERVADO:   { bg: 'bg-orange-100 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', label: 'observado' },
  APROBADO:    { bg: 'bg-emerald-100 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', label: 'aprobado' },
};

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

function BloqueChip({ label, estado }: { label: string; estado: string }) {
  const style = ESTADO_BLOQUE_STYLE[estado] || ESTADO_BLOQUE_STYLE.PENDIENTE;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
      {label} <span className="font-normal opacity-80">{style.label}</span>
    </span>
  );
}

function BloqueAprobacionCard({
  negocio, bloque, icon: Icon, label, onAprobar, onRechazar, cargando,
}: {
  negocio: NegocioAprobacion;
  bloque: 'TECNICO' | 'COMERCIAL';
  icon: React.ElementType;
  label: string;
  onAprobar: () => void;
  onRechazar: (comentario: string) => void;
  cargando: boolean;
}) {
  const [rechazando, setRechazando] = useState(false);
  const [comentario, setComentario] = useState('');
  const info = negocio.bloques[bloque];
  const style = ESTADO_BLOQUE_STYLE[info.estado] || ESTADO_BLOQUE_STYLE.PENDIENTE;
  const puedeAprobar = info.estado === 'POR_APROBAR';

  return (
    <div className="flex-1 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 bg-zinc-50/60 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-zinc-700 dark:text-zinc-300">
          <Icon size={12} className="text-zinc-400" /> {label}
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${style.bg} ${style.text}`}>{style.label}</span>
      </div>

      {info.total > 0 && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">
          {info.aprobados}/{info.total} aprobados
          {info.porAprobar > 0 && <span className="text-indigo-600 dark:text-indigo-400 font-semibold"> · {info.porAprobar} por aprobar</span>}
          {info.observados > 0 && <span className="text-orange-600 dark:text-orange-400 font-semibold"> · {info.observados} observado(s)</span>}
        </p>
      )}

      {bloque === 'TECNICO' && (negocio.veredictoTecnico.cumplen + negocio.veredictoTecnico.noCumplen + negocio.veredictoTecnico.conComplemento + negocio.veredictoTecnico.sinEvaluar > 0) && (
        <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 mb-1.5">
          {negocio.veredictoTecnico.cumplen} cumple
          {negocio.veredictoTecnico.noCumplen > 0 && <span className="text-rose-600 dark:text-rose-400 font-semibold"> · {negocio.veredictoTecnico.noCumplen} no cumple</span>}
          {negocio.veredictoTecnico.conComplemento > 0 && <span className="text-amber-600 dark:text-amber-400 font-semibold"> · {negocio.veredictoTecnico.conComplemento} con complemento</span>}
          {negocio.veredictoTecnico.sinEvaluar > 0 && <span> · {negocio.veredictoTecnico.sinEvaluar} sin evaluar</span>}
        </p>
      )}

      {bloque === 'COMERCIAL' && (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5 space-y-0.5">
          <p>Precio: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{fmtCLP(negocio.comercial.precioTotal)}</span></p>
          {negocio.comercial.plazoOfertado && <p>Plazo: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{negocio.comercial.plazoOfertado}</span></p>}
          {negocio.decisionesEstrategicas.lineasNoOfertadas > 0 && (
            <p className="text-amber-700 dark:text-amber-400 font-semibold">{negocio.decisionesEstrategicas.lineasNoOfertadas} línea(s) no ofertada(s)</p>
          )}
        </div>
      )}
      {bloque === 'TECNICO' && negocio.decisionesEstrategicas.especificacionesCorregidas > 0 && (
        <p className="text-[10.5px] text-amber-700 dark:text-amber-400 font-semibold mb-1.5">
          {negocio.decisionesEstrategicas.especificacionesCorregidas} especificación(es) corregida(s) por el asesor
        </p>
      )}

      {rechazando ? (
        <div className="space-y-1.5">
          <textarea
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            rows={2}
            placeholder="Motivo del rechazo (obligatorio)…"
            className="w-full border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-rose-400 resize-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => { onRechazar(comentario.trim()); setRechazando(false); setComentario(''); }}
              disabled={!comentario.trim() || cargando}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:bg-zinc-300 transition-colors"
            >
              {cargando ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Confirmar rechazo
            </button>
            <button onClick={() => { setRechazando(false); setComentario(''); }}
              className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/[0.06] transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            onClick={onAprobar}
            disabled={!puedeAprobar || cargando}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 transition-colors"
          >
            {cargando ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Aprobar bloque
          </button>
          <button
            onClick={() => setRechazando(true)}
            disabled={!puedeAprobar || cargando}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-rose-600 border border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-500/30 dark:hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Rechazar
          </button>
        </div>
      )}
    </div>
  );
}

export function TarjetaNegocioAprobacion({
  negocio, onAprobarBloque, onRechazarBloque, onAprobarTodo, aprobadoFlash, esAdmin, onEliminar,
}: {
  negocio: NegocioAprobacion;
  onAprobarBloque: (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL') => Promise<void>;
  onRechazarBloque: (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL', comentario: string) => Promise<void>;
  onAprobarTodo?: (negocioId: number) => Promise<void>;
  aprobadoFlash?: boolean;
  esAdmin?: boolean;
  onEliminar?: (negocioId: number, licitacionNombre: string | null) => Promise<void>;
}) {
  const [cargando, setCargando] = useState<'TECNICO' | 'COMERCIAL' | null>(null);
  const [aprobandoTodo, setAprobandoTodo] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const cierreStyle = SEMAFORO_STYLE[negocio.semaforo] || SEMAFORO_STYLE.AMARILLO;

  const aprobar = async (bloque: 'TECNICO' | 'COMERCIAL') => {
    setCargando(bloque);
    try { await onAprobarBloque(negocio.negocioId, bloque); }
    finally { setCargando(null); }
  };
  const rechazar = async (bloque: 'TECNICO' | 'COMERCIAL', comentario: string) => {
    setCargando(bloque);
    try { await onRechazarBloque(negocio.negocioId, bloque, comentario); }
    finally { setCargando(null); }
  };
  const aprobarTodo = async () => {
    if (!onAprobarTodo) return;
    setAprobandoTodo(true);
    try { await onAprobarTodo(negocio.negocioId); }
    finally { setAprobandoTodo(false); }
  };
  const eliminar = async () => {
    if (!onEliminar) return;
    setEliminando(true);
    try { await onEliminar(negocio.negocioId, negocio.licitacionNombre); }
    finally { setEliminando(false); }
  };

  const puedeAprobarTodo = negocio.bloques.TECNICO.estado === 'POR_APROBAR' || negocio.bloques.COMERCIAL.estado === 'POR_APROBAR';
  const alertas = [...negocio.alertasMotorComercial.map(a => a.descripcion), ...(negocio.semaforo === 'ROJO' ? negocio.causalesBloqueo.map(c => c.descripcion) : [])];

  if (aprobadoFlash) {
    return (
      <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/40 rounded-xl px-3 py-2.5 fade-in">
        <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <p className="text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300 truncate flex-1">
          {negocio.licitacionNombre || negocio.licitacionCodigo}
        </p>
        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex-shrink-0">Aprobado</span>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Fila compacta */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cierreStyle.dot}`} title={negocio.semaforo} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 flex-shrink-0">{negocio.licitacionCodigo}</span>
            <span className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">{negocio.licitacionNombre || negocio.licitacionCodigo}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-400 dark:text-zinc-500 truncate">
            {negocio.licitacionOrganismo && <span className="truncate">{negocio.licitacionOrganismo}</span>}
            {negocio.asignadoNombre && <span className="flex-shrink-0">· {negocio.asignadoNombre}</span>}
            <span className={`flex-shrink-0 font-semibold ${cierreStyle.text}`}>· cierra {cierreStyle.label(negocio.cierre.horasRestantes)}</span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1 flex-shrink-0">
          <BloqueChip label="Téc" estado={negocio.bloques.TECNICO.estado} />
          <BloqueChip label="Com" estado={negocio.bloques.COMERCIAL.estado} />
        </div>

        {alertas.length > 0 && (
          <span title={alertas.join(' · ')} className="hidden lg:flex items-center gap-1 text-[10.5px] font-semibold text-amber-600 dark:text-amber-400 flex-shrink-0">
            <AlertTriangle size={11} /> {alertas.length}
          </span>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {onAprobarTodo && (
            <button
              onClick={aprobarTodo}
              disabled={!puedeAprobarTodo || aprobandoTodo}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-100 disabled:text-zinc-300 dark:disabled:bg-white/5 dark:disabled:text-zinc-600 transition-colors"
            >
              {aprobandoTodo ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Aprobar
            </button>
          )}
          <button
            onClick={() => setDetalleAbierto(v => !v)}
            title="Detalle por bloque"
            className={`p-1.5 rounded-lg transition-colors ${detalleAbierto ? 'bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-200' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.06]'}`}
          >
            <ChevronDown size={14} className={`transition-transform ${detalleAbierto ? 'rotate-180' : ''}`} />
          </button>
          <Link
            href={`/negocios/${negocio.negocioId}?seccion=comercial`}
            title="Ver negocio"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-500/10 transition-colors"
          >
            <ArrowUpRight size={14} />
          </Link>
          {/* Sacar de esta bandeja: solo admin. NO toca el negocio (sigue activo en todo lo
              demás) — solo lo oculta de Aprobaciones. Ver migration-74-aprobaciones-ocultar. */}
          {esAdmin && onEliminar && (
            <button
              onClick={eliminar}
              disabled={eliminando}
              title="Sacar de esta bandeja (el negocio no se toca)"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:text-zinc-500 dark:hover:text-rose-400 dark:hover:bg-rose-500/10 transition-colors disabled:opacity-50"
            >
              {eliminando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Chips de bloque en pantallas chicas (no caben en la fila) */}
      <div className="flex md:hidden items-center gap-1 px-3 pb-2 -mt-1">
        <BloqueChip label="Téc" estado={negocio.bloques.TECNICO.estado} />
        <BloqueChip label="Com" estado={negocio.bloques.COMERCIAL.estado} />
      </div>

      {/* Detalle expandible: alertas completas + los dos bloques con su propio aprobar/rechazar */}
      {detalleAbierto && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-100 dark:border-white/[0.06] space-y-2.5">
          {negocio.alertasMotorComercial.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-lg px-3 py-2 space-y-1">
              {negocio.alertasMotorComercial.map(a => (
                <p key={a.codigo} className="text-[11px] text-amber-800 dark:text-amber-300 leading-snug">
                  <span className="font-semibold">{a.descripcion}.</span> {a.detalle}
                </p>
              ))}
            </div>
          )}
          {negocio.semaforo === 'ROJO' && negocio.causalesBloqueo.length > 0 && (
            <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 rounded-lg px-3 py-2 space-y-1">
              {negocio.causalesBloqueo.map(c => (
                <p key={c.codigo} className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
                  <span className="font-semibold">{c.descripcion}.</span> {c.rutaDesbloqueo}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <BloqueAprobacionCard
              negocio={negocio} bloque="TECNICO" icon={Wrench} label="Técnico"
              onAprobar={() => aprobar('TECNICO')} onRechazar={c => rechazar('TECNICO', c)}
              cargando={cargando === 'TECNICO'}
            />
            <BloqueAprobacionCard
              negocio={negocio} bloque="COMERCIAL" icon={DollarSign} label="Comercial"
              onAprobar={() => aprobar('COMERCIAL')} onRechazar={c => rechazar('COMERCIAL', c)}
              cargando={cargando === 'COMERCIAL'}
            />
          </div>
        </div>
      )}
    </div>
  );
}
