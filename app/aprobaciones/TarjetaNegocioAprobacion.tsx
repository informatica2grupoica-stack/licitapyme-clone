'use client';

// TARJETA de un negocio (licitación en preparación) dentro de la bandeja de aprobación transversal (/aprobaciones).
// 13-nov-2026 (skill licitank-ui): la tarjeta dice arriba QUÉ hay que aprobar; los bloques son filas; solo el bloque listo tiene
// botones; «Aprobar técnico y comercial» solo si los DOS están listos.
// 16-nov-2026: pedido del dueño «que entregue información relevante para saber de qué se trata»: franja de datos (presupuesto
// publicado, nuestra oferta con barra contra el presupuesto, cierre con fecha y hora, quién lo prepara) y la lista de puntos que se
// aprueban (título y valor) en cada bloque. Se ocultan las causales «bloque sin aprobar»: son justo lo que se resuelve en esta tarjeta.
import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { IconTool as Wrench, IconCurrencyDollar as DollarSign, IconCheck as Check, IconX as X, IconLoader2 as Loader2, IconArrowUpRight as ArrowUpRight, IconTrash as Trash2, IconAlertTriangle as AlertTriangle, IconCircleCheck as CheckCircle2, IconChevronDown as ChevronDown } from '@tabler/icons-react';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { item } from '@/app/components/ui/kit/movimiento';

export interface CausalBloqueo { codigo: string; descripcion: string; rutaDesbloqueo: string }

export interface PuntoBloque {
  id: number; titulo: string; tipo: string; estado: string; ofertamos: boolean | null;
  valorNumero: number | null; valorTexto: string | null;
}
interface InfoBloque { estado: string; total: number; aprobados: number; porAprobar: number; observados: number; puntos?: PuntoBloque[] }

export interface NegocioAprobacion {
  negocioId: number;
  licitacionCodigo: string;
  licitacionNombre: string | null;
  licitacionOrganismo: string | null;
  licitacionMonto?: number | null;
  asignadoNombre: string | null;
  cierre: { fecha: string | null; horasRestantes: number | null };
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
  causalesBloqueo: CausalBloqueo[];
  bloques: { TECNICO: InfoBloque; COMERCIAL: InfoBloque };
  veredictoTecnico: { cumplen: number; noCumplen: number; conComplemento: number; sinEvaluar: number };
  comercial: { precioTotal: number | null; plazoOfertado: string | null };
  decisionesEstrategicas: { lineasNoOfertadas: number; especificacionesCorregidas: number };
  alertasMotorComercial: Array<{ codigo: string; descripcion: string; detalle: string }>;
}

const COLOR = { rojo: '#dc2626', ambar: '#d97706', verde: '#16a34a', gris: '#94a3b8', marca: '#0f766e', naranja: '#ea580c' };
// Semáforo del Auditor Técnico (spec §9.4, app/lib/semaforo-auditor.ts): el color sale del semáforo, el texto en días de calendario.
const COLOR_SEMAFORO: Record<string, string> = { ROJO: COLOR.rojo, AMARILLO: COLOR.ambar, VERDE: COLOR.verde };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Causales que esta misma tarjeta resuelve con sus botones: mostrarlas aquí sería decir «apruébalo en Aprobaciones» dentro de Aprobaciones.
const CAUSALES_DE_ESTA_BANDEJA = new Set(['BLOQUE_TECNICO_SIN_APROBAR', 'BLOQUE_COMERCIAL_SIN_APROBAR']);

const fechaCierre = (h: number) => new Date(Date.now() + h * 3_600_000);
const diasCalendario = (d: Date) => {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  return Math.round((dia.getTime() - hoy.getTime()) / 86_400_000);
};
const hora = (d: Date) => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

/** «Cierra hoy 15:00», «Cierra mañana 15:00», «Cierra el lunes 17», «Cierra el 2 dic». Calculado desde las horas que faltan. */
function textoCierre(h: number | null): string {
  if (h == null) return 'Sin fecha de cierre';
  if (h < 0) return 'Cierre vencido';
  const c = fechaCierre(h);
  const dias = diasCalendario(c);
  if (dias === 0) return `Cierra hoy ${hora(c)}`;
  if (dias === 1) return `Cierra mañana ${hora(c)}`;
  if (dias < 7) return `Cierra el ${DIAS[c.getDay()]} ${c.getDate()}`;
  return `Cierra el ${c.getDate()} ${MESES[c.getMonth()]}`;
}
/** Fecha para la franja de datos: «lun 17 nov». La hora va debajo. */
function fechaExacta(h: number | null): string | null {
  if (h == null) return null;
  const c = fechaCierre(h);
  return `${DIAS_CORTOS[c.getDay()]} ${c.getDate()} ${MESES[c.getMonth()]}`;
}

const ESTADO_BLOQUE: Record<string, { color: string; label: string }> = {
  SIN_ITEMS: { color: COLOR.gris, label: 'Sin puntos cargados' },
  PENDIENTE: { color: COLOR.gris, label: 'El asistente lo está preparando' },
  POR_APROBAR: { color: COLOR.marca, label: 'Listo para tu aprobación' },
  OBSERVADO: { color: COLOR.naranja, label: 'Observado, vuelve al asistente' },
  APROBADO: { color: COLOR.verde, label: 'Aprobado' },
};
const ESTADO_PUNTO: Record<string, { color: string; label: string }> = {
  CARGADO: { color: COLOR.marca, label: 'Por aprobar' },
  APROBADO: { color: COLOR.verde, label: 'Aprobado' },
  OBSERVADO: { color: COLOR.naranja, label: 'Observado' },
  PENDIENTE: { color: COLOR.gris, label: 'Sin cargar' },
};

const fmtCLP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const iniciales = (n: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('');

/** Valor que se muestra a la derecha de cada punto. */
function valorPunto(p: PuntoBloque): { texto: string; tenue?: boolean } {
  if (p.tipo === 'precio' && p.ofertamos === false) return { texto: 'No se oferta', tenue: true };
  if (p.tipo === 'precio') return p.valorNumero != null ? { texto: fmtCLP(p.valorNumero) } : { texto: 'Sin precio', tenue: true };
  if (p.tipo === 'documento') return p.valorTexto ? { texto: 'Adjunto' } : { texto: 'Sin adjunto', tenue: true };
  const t = (p.valorTexto ?? (p.valorNumero != null ? String(p.valorNumero) : '')).trim();
  return t ? { texto: t } : { texto: '—', tenue: true };
}

const MAX_PUNTOS = 5;

function FilaBloque({
  negocio, bloque, icon: Icon, label, onAprobar, onRechazar, cargando,
}: {
  negocio: NegocioAprobacion; bloque: 'TECNICO' | 'COMERCIAL'; icon: React.ElementType; label: string;
  onAprobar: () => void; onRechazar: (comentario: string) => void; cargando: boolean;
}) {
  const [rechazando, setRechazando] = useState(false);
  const [comentario, setComentario] = useState('');
  const [verTodos, setVerTodos] = useState(false);
  const info = negocio.bloques[bloque];
  const est = ESTADO_BLOQUE[info.estado] || ESTADO_BLOQUE.PENDIENTE;
  const listo = info.estado === 'POR_APROBAR';
  const pct = info.total > 0 ? Math.round((info.aprobados / info.total) * 100) : 0;
  const v = negocio.veredictoTecnico;
  const hayVeredicto = v.cumplen + v.noCumplen + v.conComplemento + v.sinEvaluar > 0;
  // Lo por aprobar primero: es lo que se mira.
  const puntos = [...(info.puntos ?? [])].sort((a, b) => (a.estado === 'CARGADO' ? 0 : 1) - (b.estado === 'CARGADO' ? 0 : 1));
  const visibles = verTodos ? puntos : puntos.slice(0, MAX_PUNTOS);

  return (
    <div className="px-4 py-4 border-t border-linea dark:border-slate-800">
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
            <div className="mt-2 flex items-center gap-3 max-w-sm">
              <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="img" aria-label={`${info.aprobados} de ${info.total} puntos aprobados`}>
                <motion.div className="h-full rounded-full bg-exito" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums whitespace-nowrap">
                <b className="font-semibold text-tinta dark:text-slate-200">{info.aprobados} de {info.total}</b> aprobados
              </p>
            </div>
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

      {/* Qué se aprueba: cada punto con su valor */}
      {/* Solo cuando hay algo que decidir; un bloque que el asistente aún prepara solo tendría puntos vacíos */}
      {puntos.length > 0 && (listo || info.estado === 'OBSERVADO') && (
        <div className="mt-3 sm:ml-11">
          <ul className="rounded-lg border border-linea dark:border-slate-800 divide-y divide-linea dark:divide-slate-800">
            {visibles.map(p => {
              const ep = ESTADO_PUNTO[p.estado] || ESTADO_PUNTO.PENDIENTE;
              const val = valorPunto(p);
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span aria-hidden title={ep.label} style={{ backgroundColor: ep.color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-tinta dark:text-slate-200" title={p.titulo}>{p.titulo}</span>
                  <span className={`flex-shrink-0 max-w-[45%] truncate text-right tabular-nums ${val.tenue ? 'text-tinta-3 dark:text-slate-500' : 'font-semibold text-tinta dark:text-slate-100'}`} title={val.texto}>{val.texto}</span>
                </li>
              );
            })}
          </ul>
          {puntos.length > MAX_PUNTOS && (
            <button type="button" onClick={() => setVerTodos(x => !x)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-marca hover:text-marca-fuerte dark:text-teal-300">
              {verTodos ? 'Ver menos' : `Ver los ${puntos.length} puntos`}
              <ChevronDown size={13} className={`transition-transform duration-150 ${verTodos ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      )}

      {bloque === 'TECNICO' && (hayVeredicto || negocio.decisionesEstrategicas.especificacionesCorregidas > 0) && (
        <p className="mt-2 sm:ml-11 text-xs text-tinta-2 dark:text-slate-400">
          {hayVeredicto && <><b className="font-semibold text-exito dark:text-green-400">{v.cumplen} cumplen</b></>}
          {v.noCumplen > 0 && <> · <b className="font-semibold text-urgente dark:text-red-400">{v.noCumplen} no cumplen</b></>}
          {v.conComplemento > 0 && <> · <b className="font-semibold text-alerta dark:text-amber-400">{v.conComplemento} con complemento</b></>}
          {v.sinEvaluar > 0 && <> · {v.sinEvaluar} sin evaluar</>}
          {negocio.decisionesEstrategicas.especificacionesCorregidas > 0 && <> · {negocio.decisionesEstrategicas.especificacionesCorregidas} especificación(es) corregida(s)</>}
        </p>
      )}

      {rechazando && (
        <div className="mt-3 sm:ml-11 space-y-2">
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

/** Celda de la franja de datos: rótulo arriba, valor grande abajo, contexto debajo. */
function Celda({ rotulo, valor, contexto, tono, children }: {
  rotulo: string; valor: React.ReactNode; contexto?: React.ReactNode; tono?: 'urgente' | 'tenue'; children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
      <p className="text-[11px] text-tinta-2/80 dark:text-slate-400">{rotulo}</p>
      <p className={`mt-0.5 text-[15px] font-semibold tracking-tight tabular-nums truncate ${tono === 'urgente' ? 'text-urgente dark:text-red-400' : tono === 'tenue' ? 'text-tinta-3 dark:text-slate-500' : 'text-tinta dark:text-slate-50'}`}>{valor}</p>
      {children}
      {contexto && <p className="mt-1 text-[11.5px] text-tinta-2 dark:text-slate-400 truncate">{contexto}</p>}
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
  const causales = negocio.semaforo === 'ROJO' ? negocio.causalesBloqueo.filter(c => !CAUSALES_DE_ESTA_BANDEJA.has(c.codigo)) : [];
  const hayAlertas = negocio.alertasMotorComercial.length > 0 || causales.length > 0;
  // El bloque listo va primero: es lo que hay que mirar.
  const orden: Array<'TECNICO' | 'COMERCIAL'> = !tecListo && comListo ? ['COMERCIAL', 'TECNICO'] : ['TECNICO', 'COMERCIAL'];

  // Oferta contra presupuesto publicado (barra que se llena; rojo si se pasa).
  const presupuesto = negocio.licitacionMonto ?? null;
  const oferta = negocio.comercial.precioTotal;
  const pctOferta = presupuesto && oferta != null ? Math.round((oferta / presupuesto) * 1000) / 10 : null;
  const sePasa = pctOferta != null && pctOferta > 100;
  const h = negocio.cierre.horasRestantes;
  const vencido = h != null && h < 0;

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
    <motion.div variants={item} layout className="@container bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta overflow-hidden" data-testid={`aprob-negocio-${negocio.negocioId}`}>
      <div className="px-4 pt-4 pb-4">
        {/* Qué licitación es y cuándo cierra */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">
              <span className="font-mono font-medium text-tinta dark:text-slate-300">{negocio.licitacionCodigo}</span>
              {negocio.licitacionOrganismo && <> · {negocio.licitacionOrganismo}</>}
            </p>
            <Link href={`/negocios/${negocio.negocioId}?seccion=comercial`} className="group inline-flex items-start gap-1 mt-1">
              <span className="text-[16px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug group-hover:text-marca dark:group-hover:text-teal-300">{negocio.licitacionNombre || negocio.licitacionCodigo}</span>
              <ArrowUpRight size={15} className="mt-1 flex-shrink-0 text-slate-300 group-hover:text-marca" />
            </Link>
          </div>
          <span className="flex-shrink-0 text-[12.5px] font-medium text-tinta dark:text-slate-200 mt-0.5"><Estado color={colorCierre}>{textoCierre(h)}</Estado></span>
        </div>

        {/* Franja de datos: de qué se trata, en números */}
        <div className="mt-3.5 grid grid-cols-2 @2xl:grid-cols-4 gap-2">
          <Celda rotulo="Presupuesto publicado" valor={presupuesto != null ? fmtCLP(presupuesto) : 'No publicado'} tono={presupuesto == null ? 'tenue' : undefined} />
          <Celda rotulo="Nuestra oferta" valor={fmtCLP(oferta)} tono={oferta == null ? 'tenue' : undefined}
            contexto={pctOferta != null ? (sePasa ? <span className="text-urgente dark:text-red-400 font-medium">{fmtCLP(oferta! - presupuesto!)} sobre el presupuesto</span> : `${pctOferta}% del presupuesto`)
              : negocio.comercial.plazoOfertado ? `Plazo: ${negocio.comercial.plazoOfertado}` : undefined}>
            {pctOferta != null && (
              <div className="mt-1.5 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" role="img" aria-label={`${pctOferta}% del presupuesto`}>
                <motion.div className={`h-full rounded-full ${sePasa ? 'bg-urgente' : 'bg-marca'}`} initial={{ width: 0 }} animate={{ width: `${Math.min(100, pctOferta)}%` }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            )}
          </Celda>
          <Celda rotulo={vencido ? 'Cerró' : 'Cierre'} valor={fechaExacta(h) ?? 'Sin fecha'} tono={vencido ? 'urgente' : h == null ? 'tenue' : undefined}
            contexto={h == null ? undefined : `a las ${hora(fechaCierre(h))}${!vencido && diasCalendario(fechaCierre(h)) <= 1 ? ' · revisa hoy' : ''}`} />
          <Celda rotulo="Lo prepara" valor={negocio.asignadoNombre ?? 'Sin asignar'} tono={negocio.asignadoNombre ? undefined : 'tenue'}
            contexto={negocio.decisionesEstrategicas.lineasNoOfertadas > 0 ? `${negocio.decisionesEstrategicas.lineasNoOfertadas} línea(s) no ofertada(s)` : negocio.comercial.plazoOfertado && pctOferta != null ? `Plazo: ${negocio.comercial.plazoOfertado}` : undefined} />
        </div>

        {hayAlertas && (
          <div className="mt-3 space-y-1.5">
            {negocio.alertasMotorComercial.map(a => (
              <p key={a.codigo} className="flex gap-2 text-[12.5px] leading-snug text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="flex-shrink-0 mt-px text-alerta" /><span><b className="font-semibold">{a.descripcion}.</b> {a.detalle}</span>
              </p>
            ))}
            {causales.map(c => (
              <p key={c.codigo} className="flex gap-2 text-[12.5px] leading-snug text-red-900 dark:text-red-200 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="flex-shrink-0 mt-px text-urgente" /><span><b className="font-semibold">{c.descripcion}.</b> {c.rutaDesbloqueo}</span>
              </p>
            ))}
          </div>
        )}

        <p className="mt-3.5 text-[13px] text-tinta-2 dark:text-slate-400">
          {listos.length === 0 ? 'Nada listo para aprobar todavía.'
            : <>Falta tu visto bueno en <b className="font-semibold text-tinta dark:text-slate-100">{listos.join(' y ')}</b>. Revisa los puntos y decide.</>}
        </p>
      </div>

      {orden.map(b => b === 'TECNICO'
        ? <FilaBloque key={b} negocio={negocio} bloque="TECNICO" icon={Wrench} label="Técnico" onAprobar={() => aprobar('TECNICO')} onRechazar={c => rechazar('TECNICO', c)} cargando={cargando === 'TECNICO' || aprobandoTodo} />
        : <FilaBloque key={b} negocio={negocio} bloque="COMERCIAL" icon={DollarSign} label="Comercial" onAprobar={() => aprobar('COMERCIAL')} onRechazar={c => rechazar('COMERCIAL', c)} cargando={cargando === 'COMERCIAL' || aprobandoTodo} />)}

      {/* Pie: abrir el negocio completo; el atajo «aprobar los dos» solo cuando los dos están listos */}
      <div className="px-4 py-3 border-t border-linea dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/30 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold flex items-center justify-center" aria-hidden>{iniciales(negocio.asignadoNombre)}</span>
          <Link href={`/negocios/${negocio.negocioId}?seccion=comercial`} className="text-xs font-medium text-marca hover:text-marca-fuerte dark:text-teal-300 truncate">Abrir el negocio completo</Link>
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
