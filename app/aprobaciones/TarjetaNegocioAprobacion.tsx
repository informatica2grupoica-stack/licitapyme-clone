'use client';

// TARJETA de un negocio dentro de la bandeja de aprobación transversal (/aprobaciones).
// Muestra los dos bloques aprobables (TÉCNICO / COMERCIAL) por separado — la aprobación NO es
// todo o nada, cada bloque se aprueba o rechaza de forma independiente. "Aprobar con
// modificación" redirige al detalle del negocio (pestaña Auditor Técnico) en vez de editar
// inline acá: evita duplicar la UI de edición de ítems que ya vive en InformacionComercialSection.
import { useState } from 'react';
import Link from 'next/link';
import { Building2, Clock, Wrench, DollarSign, Check, X, Loader2, ArrowUpRight } from 'lucide-react';

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
const SEMAFORO_STYLE: Record<string, { bg: string; text: string; label: (h: number | null) => string }> = {
  ROJO:     { bg: 'bg-rose-100',    text: 'text-rose-700',    label: h => h != null && h < 0 ? 'Cierre vencido' : `Cierra en ${Math.max(1, Math.round(h ?? 0))}h` },
  AMARILLO: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: h => h == null ? 'Sin fecha de cierre' : `Cierra en ${Math.round((h ?? 0) / 24)}d` },
  VERDE:    { bg: 'bg-emerald-100', text: 'text-emerald-700', label: h => h == null ? 'Sin fecha de cierre' : `Cierra en ${Math.round((h ?? 0) / 24)}d` },
};

const ESTADO_BLOQUE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  SIN_ITEMS:   { bg: 'bg-zinc-100',    text: 'text-zinc-400',    label: 'Sin puntos' },
  PENDIENTE:   { bg: 'bg-zinc-100',    text: 'text-zinc-500',    label: 'Pendiente' },
  POR_APROBAR: { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'Por aprobar' },
  OBSERVADO:   { bg: 'bg-orange-100',  text: 'text-orange-700',  label: 'Observado' },
  APROBADO:    { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Aprobado' },
};

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

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
    <div className="flex-1 border border-zinc-200 rounded-xl p-3 bg-zinc-50/60">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-zinc-700">
          <Icon size={13} className="text-zinc-400" /> {label}
        </div>
        <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>{style.label}</span>
      </div>

      {info.total > 0 && (
        <p className="text-[11.5px] text-zinc-500 mb-2">
          {info.aprobados} de {info.total} aprobados
          {info.porAprobar > 0 && <span className="text-indigo-600 font-semibold"> · {info.porAprobar} por aprobar</span>}
          {info.observados > 0 && <span className="text-orange-600 font-semibold"> · {info.observados} observado(s)</span>}
        </p>
      )}

      {bloque === 'TECNICO' && (negocio.veredictoTecnico.cumplen + negocio.veredictoTecnico.noCumplen + negocio.veredictoTecnico.conComplemento + negocio.veredictoTecnico.sinEvaluar > 0) && (
        <p className="text-[11px] text-zinc-500 mb-2">
          {negocio.veredictoTecnico.cumplen} cumple
          {negocio.veredictoTecnico.noCumplen > 0 && <span className="text-rose-600 font-semibold"> · {negocio.veredictoTecnico.noCumplen} no cumple</span>}
          {negocio.veredictoTecnico.conComplemento > 0 && <span className="text-amber-600 font-semibold"> · {negocio.veredictoTecnico.conComplemento} con complemento</span>}
          {negocio.veredictoTecnico.sinEvaluar > 0 && <span> · {negocio.veredictoTecnico.sinEvaluar} sin evaluar</span>}
        </p>
      )}

      {bloque === 'COMERCIAL' && (
        <div className="text-[11.5px] text-zinc-500 mb-2 space-y-0.5">
          <p>Precio: <span className="font-semibold text-zinc-700">{fmtCLP(negocio.comercial.precioTotal)}</span></p>
          {negocio.comercial.plazoOfertado && <p>Plazo: <span className="font-semibold text-zinc-700">{negocio.comercial.plazoOfertado}</span></p>}
          {negocio.decisionesEstrategicas.lineasNoOfertadas > 0 && (
            <p className="text-amber-700 font-semibold">{negocio.decisionesEstrategicas.lineasNoOfertadas} línea(s) no ofertada(s)</p>
          )}
        </div>
      )}
      {bloque === 'TECNICO' && negocio.decisionesEstrategicas.especificacionesCorregidas > 0 && (
        <p className="text-[11px] text-amber-700 font-semibold mb-2">
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
            className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-rose-400 resize-none"
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
              className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-zinc-500 hover:bg-zinc-100 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            onClick={onAprobar}
            disabled={!puedeAprobar || cargando}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-200 disabled:text-zinc-400 transition-colors"
          >
            {cargando ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Aprobar bloque
          </button>
          <button
            onClick={() => setRechazando(true)}
            disabled={!puedeAprobar || cargando}
            className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-rose-600 border border-rose-200 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Rechazar
          </button>
        </div>
      )}
    </div>
  );
}

export function TarjetaNegocioAprobacion({
  negocio, onAprobarBloque, onRechazarBloque,
}: {
  negocio: NegocioAprobacion;
  onAprobarBloque: (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL') => Promise<void>;
  onRechazarBloque: (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL', comentario: string) => Promise<void>;
}) {
  const [cargando, setCargando] = useState<'TECNICO' | 'COMERCIAL' | null>(null);
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

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[11px] font-mono text-zinc-400">{negocio.licitacionCodigo}</p>
            <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${cierreStyle.bg} ${cierreStyle.text}`}>
              <Clock size={10} /> {cierreStyle.label(negocio.cierre.horasRestantes)}
            </span>
          </div>
          <p className="text-[13.5px] font-bold text-zinc-800 leading-snug mt-0.5">{negocio.licitacionNombre || negocio.licitacionCodigo}</p>
          <div className="flex items-center gap-3 mt-1 text-[11.5px] text-zinc-500">
            {negocio.licitacionOrganismo && (
              <span className="flex items-center gap-1"><Building2 size={11} /> {negocio.licitacionOrganismo}</span>
            )}
            {negocio.asignadoNombre && <span>Asistente: {negocio.asignadoNombre}</span>}
          </div>
        </div>
        <Link
          href={`/negocios/${negocio.negocioId}?seccion=comercial`}
          className="flex-shrink-0 flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 whitespace-nowrap"
        >
          Ver detalle <ArrowUpRight size={13} />
        </Link>
      </div>

      {negocio.alertasMotorComercial.length > 0 && (
        <div className="mb-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
          {negocio.alertasMotorComercial.map(a => (
            <p key={a.codigo} className="text-[11.5px] text-amber-800 leading-snug">
              <span className="font-semibold">{a.descripcion}.</span> {a.detalle}
            </p>
          ))}
        </div>
      )}

      {negocio.semaforo === 'ROJO' && negocio.causalesBloqueo.length > 0 && (
        <div className="mb-2.5 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 space-y-1">
          {negocio.causalesBloqueo.map(c => (
            <p key={c.codigo} className="text-[11.5px] text-rose-700 leading-snug">
              <span className="font-semibold">{c.descripcion}.</span> {c.rutaDesbloqueo}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2.5">
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
  );
}
