'use client';

// TARJETA de un negocio (licitación en preparación) dentro de la bandeja de aprobación transversal (/aprobaciones).
// Rediseñada el 19-oct-2026 porque la fila compacta era chica y poco clara: ahora la tarjeta muestra de entrada los dos bloques
// (Técnico y Comercial) con su avance y su propio Aprobar/Rechazar, las alertas a la vista, y un solo botón grande «Aprobar todo».
import { useState } from 'react';
import Link from 'next/link';
import { IconTool as Wrench, IconCurrencyDollar as DollarSign, IconCheck as Check, IconX as X, IconLoader2 as Loader2, IconArrowUpRight as ArrowUpRight, IconTrash as Trash2, IconAlertTriangle as AlertTriangle, IconCircleCheck as CheckCircle2 } from '@tabler/icons-react';

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

// Semáforo del Auditor Técnico (spec §9.4) — verde >72h y sin bloqueantes, amarillo <72h o sin aprobación vigente, rojo <24h o algo
// bloqueante. Ver app/lib/semaforo-auditor.ts.
const SEMAFORO_STYLE: Record<string, { chip: string; texto: (h: number | null) => string }> = {
  ROJO: { chip: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30', texto: h => h != null && h < 0 ? 'Cierre vencido' : `Cierra en ${Math.max(1, Math.round(h ?? 0))} h` },
  AMARILLO: { chip: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30', texto: h => h == null ? 'Sin fecha de cierre' : `Cierra en ${Math.max(1, Math.round((h ?? 0) / 24))} d` },
  VERDE: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30', texto: h => h == null ? 'Sin fecha de cierre' : `Cierra en ${Math.max(1, Math.round((h ?? 0) / 24))} d` },
};

const ESTADO_BLOQUE: Record<string, { chip: string; label: string }> = {
  SIN_ITEMS: { chip: 'bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-500', label: 'Sin puntos' },
  PENDIENTE: { chip: 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-400', label: 'En preparación' },
  POR_APROBAR: { chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300', label: 'Por aprobar' },
  OBSERVADO: { chip: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300', label: 'Observado' },
  APROBADO: { chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', label: 'Aprobado' },
};

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const iniciales = (n: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('');

function PanelBloque({
  negocio, bloque, icon: Icon, label, onAprobar, onRechazar, cargando,
}: {
  negocio: NegocioAprobacion; bloque: 'TECNICO' | 'COMERCIAL'; icon: React.ElementType; label: string;
  onAprobar: () => void; onRechazar: (comentario: string) => void; cargando: boolean;
}) {
  const [rechazando, setRechazando] = useState(false);
  const [comentario, setComentario] = useState('');
  const info = negocio.bloques[bloque];
  const est = ESTADO_BLOQUE[info.estado] || ESTADO_BLOQUE.PENDIENTE;
  const puedeAprobar = info.estado === 'POR_APROBAR';
  const pct = info.total > 0 ? Math.round((info.aprobados / info.total) * 100) : 0;
  const v = negocio.veredictoTecnico;

  return (
    <div className="flex-1 min-w-0 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 bg-zinc-50/60 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[14px] font-bold text-zinc-800 dark:text-zinc-100"><Icon size={16} className="text-zinc-400" /> {label}</div>
        <span className={`text-[11.5px] font-bold px-2.5 py-0.5 rounded-full ${est.chip}`}>{est.label}</span>
      </div>

      {info.total > 0 ? (
        <div className="mt-2.5">
          <div className="h-2 rounded-full bg-zinc-200 dark:bg-white/10 overflow-hidden" role="img" aria-label={`${info.aprobados} de ${info.total} aprobados`}>
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[12.5px] text-zinc-600 dark:text-zinc-300 mt-1.5">
            <b className="text-zinc-900 dark:text-zinc-100">{info.aprobados} de {info.total}</b> puntos aprobados
            {info.porAprobar > 0 && <span className="text-indigo-600 dark:text-indigo-400 font-semibold"> · {info.porAprobar} por aprobar</span>}
            {info.observados > 0 && <span className="text-orange-600 dark:text-orange-400 font-semibold"> · {info.observados} observado(s)</span>}
          </p>
        </div>
      ) : <p className="text-[12.5px] text-zinc-400 mt-2.5">Todavía no hay puntos cargados.</p>}

      {bloque === 'TECNICO' && (v.cumplen + v.noCumplen + v.conComplemento + v.sinEvaluar > 0) && (
        <p className="text-[12.5px] text-zinc-600 dark:text-zinc-300 mt-1">
          <b className="text-emerald-700 dark:text-emerald-400">{v.cumplen} cumple</b>
          {v.noCumplen > 0 && <span className="text-rose-600 dark:text-rose-400 font-semibold"> · {v.noCumplen} no cumple</span>}
          {v.conComplemento > 0 && <span className="text-amber-600 dark:text-amber-400 font-semibold"> · {v.conComplemento} con complemento</span>}
          {v.sinEvaluar > 0 && <span className="text-zinc-500"> · {v.sinEvaluar} sin evaluar</span>}
        </p>
      )}
      {bloque === 'TECNICO' && negocio.decisionesEstrategicas.especificacionesCorregidas > 0 && (
        <p className="text-[12.5px] text-amber-700 dark:text-amber-400 font-semibold mt-1">{negocio.decisionesEstrategicas.especificacionesCorregidas} especificación(es) corregida(s) por el asesor</p>
      )}
      {bloque === 'COMERCIAL' && (
        <div className="text-[12.5px] text-zinc-600 dark:text-zinc-300 mt-1 space-y-0.5">
          <p>Precio total: <b className="text-zinc-900 dark:text-zinc-100">{fmtCLP(negocio.comercial.precioTotal)}</b></p>
          {negocio.comercial.plazoOfertado && <p>Plazo: <b className="text-zinc-900 dark:text-zinc-100">{negocio.comercial.plazoOfertado}</b></p>}
          {negocio.decisionesEstrategicas.lineasNoOfertadas > 0 && <p className="text-amber-700 dark:text-amber-400 font-semibold">{negocio.decisionesEstrategicas.lineasNoOfertadas} línea(s) no ofertada(s)</p>}
        </div>
      )}

      <div className="mt-3">
        {rechazando ? (
          <div className="space-y-2">
            <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2} placeholder="Motivo del rechazo (obligatorio)…" autoFocus
              className="w-full border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { onRechazar(comentario.trim()); setRechazando(false); setComentario(''); }} disabled={!comentario.trim() || cargando}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:bg-zinc-300 transition-colors">
                {cargando ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Confirmar rechazo
              </button>
              <button onClick={() => { setRechazando(false); setComentario(''); }} className="px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06]">Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={onAprobar} disabled={!puedeAprobar || cargando}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 transition-colors">
              {cargando ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} Aprobar {label.toLowerCase()}
            </button>
            <button onClick={() => setRechazando(true)} disabled={!puedeAprobar || cargando}
              className="px-3 py-2 rounded-lg text-[13px] font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-500/30 dark:hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Rechazar
            </button>
          </div>
        )}
        {!puedeAprobar && !rechazando && <p className="text-[11.5px] text-zinc-400 mt-1.5">{info.estado === 'APROBADO' ? 'Este bloque ya está aprobado.' : 'Se puede aprobar cuando el asistente lo deje listo.'}</p>}
      </div>
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
  const sem = SEMAFORO_STYLE[negocio.semaforo] || SEMAFORO_STYLE.AMARILLO;

  const aprobar = async (bloque: 'TECNICO' | 'COMERCIAL') => { setCargando(bloque); try { await onAprobarBloque(negocio.negocioId, bloque); } finally { setCargando(null); } };
  const rechazar = async (bloque: 'TECNICO' | 'COMERCIAL', comentario: string) => { setCargando(bloque); try { await onRechazarBloque(negocio.negocioId, bloque, comentario); } finally { setCargando(null); } };
  const aprobarTodo = async () => { if (!onAprobarTodo) return; setAprobandoTodo(true); try { await onAprobarTodo(negocio.negocioId); } finally { setAprobandoTodo(false); } };
  const eliminar = async () => { if (!onEliminar) return; setEliminando(true); try { await onEliminar(negocio.negocioId, negocio.licitacionNombre); } finally { setEliminando(false); } };

  const puedeAprobarTodo = negocio.bloques.TECNICO.estado === 'POR_APROBAR' || negocio.bloques.COMERCIAL.estado === 'POR_APROBAR';
  const hayDosPorAprobar = negocio.bloques.TECNICO.estado === 'POR_APROBAR' && negocio.bloques.COMERCIAL.estado === 'POR_APROBAR';

  if (aprobadoFlash) {
    return (
      <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/40 rounded-2xl px-4 py-4 fade-in">
        <CheckCircle2 size={22} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <p className="text-[14px] font-semibold text-emerald-800 dark:text-emerald-300 truncate flex-1">{negocio.licitacionNombre || negocio.licitacionCodigo}</p>
        <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400 flex-shrink-0">Aprobado</span>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800" data-testid={`aprob-negocio-${negocio.negocioId}`}>
      <div className="px-4 py-4 space-y-3">
        {/* Encabezado: qué licitación es y cuánto falta para que cierre */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap text-[12px] text-zinc-500 dark:text-zinc-400">
              <span className="font-mono font-semibold bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 rounded-md">{negocio.licitacionCodigo}</span>
              {negocio.licitacionOrganismo && <span className="truncate">{negocio.licitacionOrganismo}</span>}
            </div>
            <Link href={`/negocios/${negocio.negocioId}?seccion=comercial`} className="group inline-flex items-start gap-1 mt-1">
              <span className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{negocio.licitacionNombre || negocio.licitacionCodigo}</span>
              <ArrowUpRight size={15} className="mt-0.5 flex-shrink-0 text-zinc-300 group-hover:text-indigo-500" />
            </Link>
          </div>
          <span className={`flex-shrink-0 text-[12.5px] font-bold px-3 py-1 rounded-full border ${sem.chip}`}>{sem.texto(negocio.cierre.horasRestantes)}</span>
        </div>

        {/* Alertas siempre a la vista */}
        {(negocio.alertasMotorComercial.length > 0 || (negocio.semaforo === 'ROJO' && negocio.causalesBloqueo.length > 0)) && (
          <div className="space-y-1.5">
            {negocio.alertasMotorComercial.length > 0 && (
              <div className="flex gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl px-3.5 py-2.5">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-600" />
                <div className="space-y-1">
                  {negocio.alertasMotorComercial.map(a => <p key={a.codigo} className="text-[12.5px] text-amber-900 dark:text-amber-200 leading-snug"><b>{a.descripcion}.</b> {a.detalle}</p>)}
                </div>
              </div>
            )}
            {negocio.semaforo === 'ROJO' && negocio.causalesBloqueo.length > 0 && (
              <div className="flex gap-2.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 rounded-xl px-3.5 py-2.5">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-rose-600" />
                <div className="space-y-1">
                  {negocio.causalesBloqueo.map(c => <p key={c.codigo} className="text-[12.5px] text-rose-800 dark:text-rose-200 leading-snug"><b>{c.descripcion}.</b> {c.rutaDesbloqueo}</p>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Los dos bloques, siempre visibles, cada uno con su decisión */}
        <div className="flex flex-col md:flex-row gap-3">
          <PanelBloque negocio={negocio} bloque="TECNICO" icon={Wrench} label="Técnico" onAprobar={() => aprobar('TECNICO')} onRechazar={c => rechazar('TECNICO', c)} cargando={cargando === 'TECNICO'} />
          <PanelBloque negocio={negocio} bloque="COMERCIAL" icon={DollarSign} label="Comercial" onAprobar={() => aprobar('COMERCIAL')} onRechazar={c => rechazar('COMERCIAL', c)} cargando={cargando === 'COMERCIAL'} />
        </div>

        {/* Pie: quién lo prepara y el atajo de aprobar todo */}
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 text-[11px] font-bold flex items-center justify-center" aria-hidden>{iniciales(negocio.asignadoNombre)}</span>
            <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 truncate">{negocio.asignadoNombre ? <>Lo prepara <b className="text-zinc-700 dark:text-zinc-200">{negocio.asignadoNombre}</b></> : 'Sin asistente asignado'}</p>
          </div>
          {esAdmin && onEliminar && (
            <button onClick={eliminar} disabled={eliminando} title="Sacar de esta bandeja (el negocio no se toca)"
              className="p-2 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-500/10 transition-colors disabled:opacity-50">
              {eliminando ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          )}
          {onAprobarTodo && (
            <button onClick={aprobarTodo} disabled={!puedeAprobarTodo || aprobandoTodo}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[14px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:bg-zinc-100 disabled:text-zinc-300 disabled:shadow-none dark:disabled:bg-white/5 dark:disabled:text-zinc-600 transition-colors">
              {aprobandoTodo ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />} {hayDosPorAprobar ? 'Aprobar técnico y comercial' : 'Aprobar todo lo pendiente'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
