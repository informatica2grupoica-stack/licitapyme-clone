'use client';

// TARJETA de un negocio (licitación en preparación) dentro de la bandeja de aprobación transversal (/aprobaciones).
// 13-nov-2026 (skill licitank-ui): la tarjeta dice arriba QUÉ hay que aprobar («Falta tu visto bueno en Comercial»), los dos bloques
// son filas dentro de la misma tarjeta (sin cajas dentro de cajas) y solo el bloque listo muestra Aprobar/Rechazar — el que aún
// prepara el asistente queda como una línea tenue, sin botones grises deshabilitados. El botón «Aprobar técnico y comercial» aparece
// solo cuando los DOS están listos (con uno solo era el mismo botón repetido).
import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { IconTool as Wrench, IconCurrencyDollar as DollarSign, IconCheck as Check, IconX as X, IconLoader2 as Loader2, IconArrowUpRight as ArrowUpRight, IconTrash as Trash2, IconAlertTriangle as AlertTriangle, IconCircleCheck as CheckCircle2 } from '@tabler/icons-react';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { item } from '@/app/components/ui/kit/movimiento';

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

const COLOR = { rojo: '#dc2626', ambar: '#d97706', verde: '#16a34a', gris: '#94a3b8', marca: '#0f766e', naranja: '#ea580c' };
// Semáforo del Auditor Técnico (spec §9.4, app/lib/semaforo-auditor.ts): el color sale del semáforo, el texto en días de calendario.
const COLOR_SEMAFORO: Record<string, string> = { ROJO: COLOR.rojo, AMARILLO: COLOR.ambar, VERDE: COLOR.verde };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «Cierra hoy 15:00», «Cierra mañana 15:00», «Cierra el lunes 17», «Cierra el 2 dic». Calculado desde las horas que faltan. */
function textoCierre(h: number | null): string {
  if (h == null) return 'Sin fecha de cierre';
  if (h < 0) return 'Cierre vencido';
  const cierre = new Date(Date.now() + h * 3_600_000);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dia = new Date(cierre); dia.setHours(0, 0, 0, 0);
  const dias = Math.round((dia.getTime() - hoy.getTime()) / 86_400_000);
  const hora = cierre.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  if (dias === 0) return `Cierra hoy ${hora}`;
  if (dias === 1) return `Cierra mañana ${hora}`;
  if (dias < 7) return `Cierra el ${DIAS[cierre.getDay()]} ${cierre.getDate()}`;
  return `Cierra el ${cierre.getDate()} ${MESES[cierre.getMonth()]}`;
}

const ESTADO_BLOQUE: Record<string, { color: string; label: string }> = {
  SIN_ITEMS: { color: COLOR.gris, label: 'Sin puntos cargados' },
  PENDIENTE: { color: COLOR.gris, label: 'El asistente lo está preparando' },
  POR_APROBAR: { color: COLOR.marca, label: 'Listo para tu aprobación' },
  OBSERVADO: { color: COLOR.naranja, label: 'Observado, vuelve al asistente' },
  APROBADO: { color: COLOR.verde, label: 'Aprobado' },
};

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const iniciales = (n: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('');

function Dato({ rotulo, children, tono }: { rotulo: string; children: React.ReactNode; tono?: 'alerta' | 'urgente' | 'exito' }) {
  const color = tono === 'alerta' ? 'text-alerta dark:text-amber-400' : tono === 'urgente' ? 'text-urgente dark:text-red-400' : tono === 'exito' ? 'text-exito dark:text-green-400' : 'text-tinta dark:text-slate-100';
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-tinta-2/80 dark:text-slate-400">{rotulo}</dt>
      <dd className={`mt-0.5 text-[13px] font-semibold tabular-nums ${color}`}>{children}</dd>
    </div>
  );
}

function FilaBloque({
  negocio, bloque, icon: Icon, label, onAprobar, onRechazar, cargando,
}: {
  negocio: NegocioAprobacion; bloque: 'TECNICO' | 'COMERCIAL'; icon: React.ElementType; label: string;
  onAprobar: () => void; onRechazar: (comentario: string) => void; cargando: boolean;
}) {
  const [rechazando, setRechazando] = useState(false);
  const [comentario, setComentario] = useState('');
  const info = negocio.bloques[bloque];
  const est = ESTADO_BLOQUE[info.estado] || ESTADO_BLOQUE.PENDIENTE;
  const listo = info.estado === 'POR_APROBAR';
  const pct = info.total > 0 ? Math.round((info.aprobados / info.total) * 100) : 0;
  const v = negocio.veredictoTecnico;
  const hayVeredicto = v.cumplen + v.noCumplen + v.conComplemento + v.sinEvaluar > 0;

  return (
    <div className={`px-4 py-3.5 border-t border-linea dark:border-slate-800 ${listo ? '' : 'opacity-80'}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${listo ? 'bg-marca-suave text-marca dark:bg-teal-500/10 dark:text-teal-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap">
            <p className="text-[14px] font-semibold text-tinta dark:text-slate-100">{label}</p>
            <span className={`text-[12.5px] ${listo ? 'font-medium text-marca dark:text-teal-300' : 'text-tinta-2 dark:text-slate-400'}`}><Estado color={est.color}>{est.label}</Estado></span>
          </div>

          {info.total > 0 && (
            <div className="mt-2 flex items-center gap-3 max-w-md">
              <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="img" aria-label={`${info.aprobados} de ${info.total} puntos aprobados`}>
                <motion.div className="h-full rounded-full bg-exito" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums whitespace-nowrap">
                <b className="font-semibold text-tinta dark:text-slate-200">{info.aprobados}/{info.total}</b> puntos
                {info.porAprobar > 0 && <> · <span className="text-marca dark:text-teal-300 font-medium">{info.porAprobar} por aprobar</span></>}
                {info.observados > 0 && <> · <span className="text-orange-600 dark:text-orange-400 font-medium">{info.observados} observado{info.observados === 1 ? '' : 's'}</span></>}
              </p>
            </div>
          )}

          {(bloque === 'COMERCIAL' || (bloque === 'TECNICO' && (hayVeredicto || negocio.decisionesEstrategicas.especificacionesCorregidas > 0))) && (
            <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
              {bloque === 'COMERCIAL' && <>
                <Dato rotulo="Precio total">{fmtCLP(negocio.comercial.precioTotal)}</Dato>
                {negocio.comercial.plazoOfertado && <Dato rotulo="Plazo de entrega">{negocio.comercial.plazoOfertado}</Dato>}
                {negocio.decisionesEstrategicas.lineasNoOfertadas > 0 && <Dato rotulo="Líneas no ofertadas" tono="alerta">{negocio.decisionesEstrategicas.lineasNoOfertadas}</Dato>}
              </>}
              {bloque === 'TECNICO' && <>
                {hayVeredicto && <Dato rotulo="Cumplen" tono="exito">{v.cumplen}</Dato>}
                {v.noCumplen > 0 && <Dato rotulo="No cumplen" tono="urgente">{v.noCumplen}</Dato>}
                {v.conComplemento > 0 && <Dato rotulo="Con complemento" tono="alerta">{v.conComplemento}</Dato>}
                {v.sinEvaluar > 0 && <Dato rotulo="Sin evaluar">{v.sinEvaluar}</Dato>}
                {negocio.decisionesEstrategicas.especificacionesCorregidas > 0 && <Dato rotulo="Especificaciones corregidas" tono="alerta">{negocio.decisionesEstrategicas.especificacionesCorregidas}</Dato>}
              </>}
            </dl>
          )}
        </div>

        {/* Solo el bloque listo tiene botones: nada de botones grises que no se pueden usar */}
        {listo && !rechazando && (
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            <Boton variante="fantasma" tamano="sm" onClick={() => setRechazando(true)} disabled={cargando} icono={<X size={14} />}>Rechazar</Boton>
            <Boton variante="primario" tamano="sm" onClick={onAprobar} disabled={cargando}
              icono={cargando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}>Aprobar {label.toLowerCase()}</Boton>
          </div>
        )}
      </div>

      {rechazando && (
        <div className="mt-3 ml-11 space-y-2">
          <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2} autoFocus
            placeholder={`¿Qué debe corregir el asistente en ${label.toLowerCase()}? (obligatorio)`}
            className="w-full border border-linea dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-slate-100 rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-red-300 resize-none" />
          <div className="flex items-center gap-2">
            <Boton variante="peligro" tamano="sm" disabled={!comentario.trim() || cargando}
              onClick={() => { onRechazar(comentario.trim()); setRechazando(false); setComentario(''); }}
              icono={cargando ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}>Rechazar y devolver al asistente</Boton>
            <Boton variante="fantasma" tamano="sm" onClick={() => { setRechazando(false); setComentario(''); }}>Cancelar</Boton>
          </div>
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

  const aprobar = async (bloque: 'TECNICO' | 'COMERCIAL') => { setCargando(bloque); try { await onAprobarBloque(negocio.negocioId, bloque); } finally { setCargando(null); } };
  const rechazar = async (bloque: 'TECNICO' | 'COMERCIAL', comentario: string) => { setCargando(bloque); try { await onRechazarBloque(negocio.negocioId, bloque, comentario); } finally { setCargando(null); } };
  const aprobarTodo = async () => { if (!onAprobarTodo) return; setAprobandoTodo(true); try { await onAprobarTodo(negocio.negocioId); } finally { setAprobandoTodo(false); } };
  const eliminar = async () => { if (!onEliminar) return; setEliminando(true); try { await onEliminar(negocio.negocioId, negocio.licitacionNombre); } finally { setEliminando(false); } };

  const tecListo = negocio.bloques.TECNICO.estado === 'POR_APROBAR';
  const comListo = negocio.bloques.COMERCIAL.estado === 'POR_APROBAR';
  const listos = [tecListo && 'Técnico', comListo && 'Comercial'].filter(Boolean) as string[];
  const colorCierre = COLOR_SEMAFORO[negocio.semaforo] || COLOR.ambar;
  const hayAlertas = negocio.alertasMotorComercial.length > 0 || (negocio.semaforo === 'ROJO' && negocio.causalesBloqueo.length > 0);
  // El bloque listo va primero: es lo que hay que mirar.
  const orden: Array<'TECNICO' | 'COMERCIAL'> = !tecListo && comListo ? ['COMERCIAL', 'TECNICO'] : ['TECNICO', 'COMERCIAL'];

  if (aprobadoFlash) {
    return (
      <div className="flex items-center gap-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl px-4 py-4 fade-in">
        <CheckCircle2 size={22} className="text-exito dark:text-green-400 flex-shrink-0" />
        <p className="text-[14px] font-semibold text-green-900 dark:text-green-200 truncate flex-1">{negocio.licitacionNombre || negocio.licitacionCodigo}</p>
        <span className="text-[13px] font-semibold text-exito dark:text-green-400 flex-shrink-0">Aprobado</span>
      </div>
    );
  }

  return (
    <motion.div variants={item} layout className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta overflow-hidden" data-testid={`aprob-negocio-${negocio.negocioId}`}>
      {/* Encabezado: qué licitación es, cuándo cierra y qué te toca aprobar */}
      <div className="px-4 pt-4 pb-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">
              <span className="font-mono font-medium text-tinta dark:text-slate-300">{negocio.licitacionCodigo}</span>
              {negocio.licitacionOrganismo && <> · {negocio.licitacionOrganismo}</>}
            </p>
            <Link href={`/negocios/${negocio.negocioId}?seccion=comercial`} className="group inline-flex items-start gap-1 mt-1">
              <span className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug group-hover:text-marca dark:group-hover:text-teal-300">{negocio.licitacionNombre || negocio.licitacionCodigo}</span>
              <ArrowUpRight size={15} className="mt-0.5 flex-shrink-0 text-slate-300 group-hover:text-marca" />
            </Link>
          </div>
          <span className="flex-shrink-0 text-[12.5px] font-medium text-tinta dark:text-slate-200 mt-0.5"><Estado color={colorCierre}>{textoCierre(negocio.cierre.horasRestantes)}</Estado></span>
        </div>

        <p className="mt-2.5 text-[13px] text-tinta-2 dark:text-slate-400">
          {listos.length === 0 ? 'Nada listo para aprobar todavía.'
            : <>Falta tu visto bueno en <b className="font-semibold text-tinta dark:text-slate-100">{listos.join(' y ')}</b>.</>}
        </p>

        {hayAlertas && (
          <div className="mt-3 space-y-1.5">
            {negocio.alertasMotorComercial.map(a => (
              <p key={a.codigo} className="flex gap-2 text-[12.5px] leading-snug text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="flex-shrink-0 mt-px text-alerta" /><span><b className="font-semibold">{a.descripcion}.</b> {a.detalle}</span>
              </p>
            ))}
            {negocio.semaforo === 'ROJO' && negocio.causalesBloqueo.map(c => (
              <p key={c.codigo} className="flex gap-2 text-[12.5px] leading-snug text-red-900 dark:text-red-200 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="flex-shrink-0 mt-px text-urgente" /><span><b className="font-semibold">{c.descripcion}.</b> {c.rutaDesbloqueo}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {orden.map(b => b === 'TECNICO'
        ? <FilaBloque key={b} negocio={negocio} bloque="TECNICO" icon={Wrench} label="Técnico" onAprobar={() => aprobar('TECNICO')} onRechazar={c => rechazar('TECNICO', c)} cargando={cargando === 'TECNICO' || aprobandoTodo} />
        : <FilaBloque key={b} negocio={negocio} bloque="COMERCIAL" icon={DollarSign} label="Comercial" onAprobar={() => aprobar('COMERCIAL')} onRechazar={c => rechazar('COMERCIAL', c)} cargando={cargando === 'COMERCIAL' || aprobandoTodo} />)}

      {/* Pie: quién lo prepara; el atajo «aprobar los dos» solo cuando los dos están listos */}
      <div className="px-4 py-3 border-t border-linea dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/30 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold flex items-center justify-center" aria-hidden>{iniciales(negocio.asignadoNombre)}</span>
          <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">{negocio.asignadoNombre ? <>Lo prepara <b className="font-medium text-tinta dark:text-slate-200">{negocio.asignadoNombre}</b></> : 'Sin asistente asignado'}</p>
        </div>
        {esAdmin && onEliminar && (
          <button onClick={eliminar} disabled={eliminando} title="Sacar de esta bandeja (el negocio no se toca)" aria-label="Sacar de esta bandeja"
            className="p-1.5 rounded-lg text-slate-400 hover:text-urgente hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50">
            {eliminando ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        )}
        {onAprobarTodo && tecListo && comListo && (
          <Boton variante="primario" onClick={aprobarTodo} disabled={aprobandoTodo || cargando != null}
            icono={aprobandoTodo ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}>Aprobar técnico y comercial</Boton>
        )}
      </div>
    </motion.div>
  );
}
