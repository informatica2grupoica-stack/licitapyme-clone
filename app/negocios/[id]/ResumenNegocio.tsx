'use client';

// ── Resumen del negocio ────────────────────────────────────────────────────────
// Misma lógica y datos que tenía SeccionResumen (page.tsx), con el lenguaje visual de las pestañas de
// viabilidad: tarjeta de viabilidad con el nivel, tarjetas de datos clave, recorrido, y los datos
// de la licitación en grillas (etiqueta arriba, valor abajo; los campos vacíos no se muestran).
import { diasCalendarioChile } from '@/app/lib/tz';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { IconTarget as Target, IconArrowUpRight as ArrowUpRight, IconCircleX as CircleX, IconClock as Clock, IconChevronRight as ChevronRight, IconBan as Ban, IconCheck as Check, IconX as X, IconEdit as Edit3, IconWallet as Wallet, IconGavel as Gavel, IconPackage as Package, IconFileText as FileText, IconBuilding as Building2, IconShield as Shield, IconListCheck as ListChecks, IconPhone as Phone, IconMail as Mail, IconExternalLink as ExternalLink, IconCircleCheck as CheckCircle, IconAlertTriangle as AlertTriangle, IconBulb as Lightbulb, IconThumbUp as ThumbsUp, IconTag as Tag } from '@tabler/icons-react';
import { Oportunidad } from '@/app/types/search.types';
import { TIPO_LICITACION_MAP, MONEDA_LABEL_MAP } from '@/app/types/mercado-publico.types';
import { IABadge } from '@/app/licitacion/[codigo]/utils';
import type { AnalisisIA } from '@/app/licitacion/[codigo]/utils';
import { NIVEL_VISTA, mayus, sinCA } from '@/app/licitacion/[codigo]/sections/viabilidad-v4-comun';
import { useContador } from '@/app/lib/use-contador';
import { FichaMPBases } from '@/app/components/FichaMPBases';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { EASE_LK, NORMAL } from '@/app/components/ui/kit/movimiento';
import { RecorridoNegocio } from './RecorridoNegocio';

// Estilo del sistema de diseño (skill licitank-ui): tarjeta con borde fino, sombra suave, esquinas xl.
const CAJA = 'bg-white border border-linea rounded-xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const ROTULO = 'text-[11px] text-slate-500 dark:text-slate-400';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtCLP = (n?: number | null) => n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : null;

// ── Movimiento ──
function Aparece({ i = 0, children, alto }: { i?: number; children: React.ReactNode; alto?: boolean }) {
  const reducido = useReducedMotion();
  return (
    <motion.div className={alto ? 'h-full min-w-0' : 'min-w-0'} initial={reducido ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: NORMAL, delay: Math.min(i, 10) * 0.04, ease: EASE_LK }}>
      {children}
    </motion.div>
  );
}

// ── Contenedores ──
function Panel({ i, icono, titulo, derecha, children }: { i: number; icono: React.ReactNode; titulo: string; derecha?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Aparece i={i}>
      <section className={`${CAJA} !rounded-2xl p-5 h-full`}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-100"><span className="text-slate-400 flex">{icono}</span>{titulo}</h3>
          {derecha}
        </div>
        {children}
      </section>
    </Aparece>
  );
}

function Campos({ items, cols = 2 }: { items: Array<[string, React.ReactNode]>; cols?: 1 | 2 }) {
  const visibles = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  if (visibles.length === 0) return null;
  return (
    <dl className={`grid grid-cols-1 ${cols === 2 ? 'sm:grid-cols-2' : ''} gap-x-8 gap-y-3.5`}>
      {visibles.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className={ROTULO}>{k}</dt>
          <dd className="text-[13.5px] font-medium text-tinta dark:text-slate-100 leading-snug break-words mt-0.5">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const enlace = (href: string, icono: React.ReactNode, texto: string) => (
  <a href={href} className="inline-flex items-center gap-1 text-marca hover:text-marca-fuerte hover:underline break-all">{icono} {texto}</a>
);

// ── Bento del resumen (skill licitank-ui): viabilidad, oferta vs. presupuesto, cierre y datos clave ──
const BLOQUE = 'bg-white border border-linea rounded-2xl shadow-tarjeta p-5 h-full dark:bg-slate-900 dark:border-slate-800';

function Rotulo({ icono, children, tono }: { icono: React.ReactNode; children?: React.ReactNode; tono?: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px] text-tinta-2 dark:text-slate-400">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${tono || 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{icono}</span>
      {children}
    </span>
  );
}

// Escala de atractivo de la v4 (de peor a mejor): el medidor pinta hasta el nivel actual.
const ESCALA_V4 = ['EXCLUIDO', 'BAJO', 'MEDIO_BAJO', 'MEDIO', 'MEDIO_ALTO', 'ALTO', 'MUY_ALTO'];
const TRAMOS_V3: Record<string, number> = { NO_VAMOS: 1, PUEDE_SER: 4, GANABLE: 7 };

// Lo que el análisis ya concluyó, con el mismo nivel de la pestaña Viabilidad.
function datosViabilidad(viabIA: any, montoMP: number) {
  const esV4 = viabIA?._schema === 'v4';
  const sc4 = viabIA?.score;
  const nv = esV4 && sc4 ? NIVEL_VISTA[sc4.nivel] : null;
  const esV3 = viabIA?._schema === 'v3';
  const t3 = viabIA?.tarjeta_decision;
  const VER3: Record<string, { label: string; cls: string }> = {
    GANABLE: { label: 'GANABLE', cls: 'bg-emerald-600' }, PUEDE_SER: { label: 'PUEDE SER', cls: 'bg-yellow-500' }, NO_VAMOS: { label: 'NO VAMOS', cls: 'bg-red-600' },
  };
  const ver3 = t3 ? VER3[t3.veredicto] : null;
  const adm = viabIA?.requisitos_admisibilidad || {};
  const nBloq3 = esV3 ? (Array.isArray(adm.bloqueantes) ? adm.bloqueantes.filter((b: any) => String(b?.item || '').trim()).length : 0) + (adm.cotizar_100?.aplica ? 1 : 0) + (adm.presupuesto?.tipo === 'excluyente' ? 1 : 0) : 0;
  const nReq = esV4 ? Number(adm.conteo) || 0 : nBloq3;
  const score = Math.round(Number(viabIA?.score_0_100) || 0);
  const semColor = viabIA?.semaforo === 'VERDE' ? 'bg-emerald-500' : viabIA?.semaforo === 'AMARILLO' ? 'bg-yellow-500' : viabIA?.semaforo === 'NARANJA' ? 'bg-orange-500' : (viabIA?.semaforo === 'ROJO' || viabIA?.semaforo === 'ROJO_DURO') ? 'bg-red-500' : 'bg-zinc-400';
  const gana = String(viabIA?.veredicto?.gana_probable || '').toLowerCase();
  const ganaLabel = gana === 'si' ? 'GANA' : gana === 'no' ? 'NO GANA' : gana ? 'CONDICIONAL' : '—';

  const accion = esV4 && sc4 ? mayus(sinCA(sc4.accion_texto)) : esV3 && ver3 ? null : `${ganaLabel}${viabIA?.veredicto?.nivel ? ` · ${String(viabIA.veredicto.nivel).replace(/_/g, ' ')}` : ''}`;
  const resumen = esV4 && sc4?.resumen_pantalla ? String(sc4.resumen_pantalla).replace(/^[A-ZÁÉÍÓÚ ]+ · /, '').split(' · ').map(mayus).join(' · ')
    : esV3 ? t3?.titular : viabIA?.veredicto?.por_que;
  const motivo = esV4 ? sc4?.motivo_exclusion?.texto : esV3 && t3?.veredicto === 'NO_VAMOS' ? t3?.porque_no : null;
  const sinReq = esV4 ? 'Sin requisitos que dejen fuera' : 'Sin bloqueantes detectados';

  const adjResultado = esV4
    ? (viabIA?.adjudicacion?.resultado === 'POR_LINEAS' ? 'Por línea' : viabIA?.adjudicacion?.resultado === 'GLOBAL' ? 'Global' : 'No está claro')
    : mayus(String(viabIA?.adjudicacion?.como_se_adjudica || viabIA?.modalidad?.general || viabIA?.modalidad?.tipo || '—').replace(/_/g, ' ').toLowerCase());
  const adjDudosa = viabIA?.adjudicacion?.estado === 'REVISION_HUMANA' || viabIA?.adjudicacion?.resultado === 'NO_CLARO';
  const adjTitulo = [viabIA?.adjudicacion?.fuente && `Fuente: ${viabIA.adjudicacion.fuente}`, viabIA?.adjudicacion?.evidencia, esV4 && viabIA?.adjudicacion?.motivo, 'Clic para ver la cita en Viabilidad'].filter(Boolean).join('\n');
  const presupuesto = montoMP > 0 ? montoMP : (viabIA?.presupuesto?.bruto ?? viabIA?.presupuesto?.neto);
  const presupuestoIvaIncl = !(montoMP > 0) && !!viabIA?.presupuesto?.bruto && !viabIA?.presupuesto?.regimen_fora;
  const nProductos = viabIA?.manifiesto_productos?.length || viabIA?.productos?.items?.length || viabIA?.costeo?.items?.length || null;

  // El color del nivel va en el texto, el medidor y el ícono; nunca en un bloque sólido.
  const tono = (cls?: string) => !cls ? '#64748b' : cls.includes('emerald') ? '#047857' : cls.includes('yellow') ? '#b45309'
    : cls.includes('orange') ? '#c2410c' : cls === 'bg-red-700' ? '#b91c1c' : cls.includes('red') ? '#dc2626' : '#64748b';
  const color = tono(nv?.cls ?? (esV3 && ver3 ? ver3.cls : semColor));
  const nivel = nv ? mayus(nv.label.toLowerCase()) : esV3 && ver3 ? mayus(ver3.label.toLowerCase()) : null;
  const tramos = nv ? ESCALA_V4.indexOf(sc4.nivel) + 1 : esV3 && ver3 ? TRAMOS_V3[t3.veredicto] : Math.max(1, Math.ceil(score / 100 * 7));

  return { nv, esV3, ver3, nReq, score, accion, resumen, motivo, sinReq, adjResultado, adjDudosa, adjTitulo, presupuesto, presupuestoIvaIncl, nProductos, color, nivel, tramos };
}

function BloqueViabilidad({ d, onIrViabilidad }: { d: ReturnType<typeof datosViabilidad>; onIrViabilidad?: () => void }) {
  const reducido = useReducedMotion();
  // El resumen y el motivo de exclusión suelen ser el mismo texto: se muestra una sola vez.
  const resumenDistinto = d.resumen && (!d.motivo || mayus(d.resumen).trim() !== mayus(d.motivo).trim());
  return (
    <section className={`${BLOQUE} flex flex-col gap-4`}>
      <div className="flex items-center justify-between gap-3">
        <Rotulo icono={<Target size={16} />}>Viabilidad</Rotulo>
        {onIrViabilidad && <button type="button" onClick={onIrViabilidad} className="inline-flex items-center gap-0.5 text-[13px] font-medium text-marca hover:text-marca-fuerte">Ver análisis <ArrowUpRight size={14} /></button>}
      </div>
      <div title={d.nv?.tip} className={d.nv ? 'cursor-help' : ''}>
        {d.nivel
          ? <p className="text-[30px] font-semibold tracking-tight leading-none" style={{ color: d.color }}>{d.nivel}</p>
          : <p className="text-[30px] font-semibold tracking-tight leading-none tabular-nums" style={{ color: d.color }}>{d.score}<span className="text-base font-medium text-slate-400">/100</span></p>}
        {d.accion && <p className="mt-2 text-sm font-medium text-tinta dark:text-slate-100">{d.accion}</p>}
      </div>
      <div>
        <div className="grid grid-cols-7 gap-1" aria-hidden>
          {Array.from({ length: 7 }, (_, k) => (
            <motion.span key={k} className="h-1.5 rounded-full" style={{ background: k < d.tramos ? d.color : undefined }}
              initial={reducido ? false : { opacity: 0, scaleX: 0.4 }} animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: NORMAL, delay: 0.15 + k * 0.04, ease: EASE_LK }}>
              {k >= d.tramos && <span className="block h-full rounded-full bg-slate-100 dark:bg-slate-800" />}
            </motion.span>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-slate-400"><span>{d.nv ? 'Excluido' : 'Bajo'}</span><span>Muy alto</span></div>
      </div>
      <ul className="mt-auto pt-4 border-t border-linea/80 dark:border-slate-800 space-y-2.5 text-[13px] leading-snug">
        {d.motivo && <li className="flex gap-2 text-tinta dark:text-slate-200"><CircleX size={16} className="text-urgente flex-shrink-0 mt-px" />{mayus(d.motivo)}</li>}
        {resumenDistinto && <li className="flex gap-2 text-tinta-2 dark:text-slate-300"><Lightbulb size={16} className="text-slate-400 flex-shrink-0 mt-px" /><span className="line-clamp-3">{mayus(d.resumen)}</span></li>}
        {(d.nv || d.esV3) && (d.nReq > 0
          ? <li><button type="button" onClick={onIrViabilidad} className="group w-full flex items-center gap-2 text-left text-tinta dark:text-slate-200 hover:text-marca">
              <Ban size={16} className="text-urgente flex-shrink-0" />{d.nReq} {d.nReq === 1 ? 'requisito puede' : 'requisitos pueden'} dejarte fuera
              <ChevronRight size={15} className="ml-auto text-slate-300 group-hover:text-marca transition-transform duration-150 group-hover:translate-x-0.5" />
            </button></li>
          : <li className="flex gap-2 text-exito"><Check size={16} className="flex-shrink-0" />{d.sinReq}</li>)}
      </ul>
    </section>
  );
}

function BloqueOferta({ ofertado, presupuesto, origen, tipo, editor, onEditar }: {
  ofertado: number; presupuesto: number; origen: string; tipo?: string | null; editor: React.ReactNode | null; onEditar: () => void;
}) {
  const reducido = useReducedMotion();
  const animado = Math.round(useContador(ofertado));
  const pct = presupuesto > 0 ? (ofertado / presupuesto) * 100 : 0;
  const excede = presupuesto > 0 && ofertado > presupuesto;
  return (
    <section className={BLOQUE}>
      <div className="flex items-center justify-between gap-3">
        <Rotulo icono={<Wallet size={16} />}>{presupuesto > 0 ? 'Oferta vs. presupuesto' : 'Monto ofertado'}</Rotulo>
        {!editor && <button type="button" onClick={onEditar} className="inline-flex items-center gap-1 text-[13px] font-medium text-marca hover:text-marca-fuerte"><Edit3 size={14} />{ofertado ? 'Editar oferta' : 'Ingresar oferta'}</button>}
      </div>
      {editor ? <div className="mt-4">{editor}</div> : (
        <div className="mt-4 flex items-baseline gap-2 flex-wrap">
          <span className="text-[28px] font-semibold tracking-tight leading-none tabular-nums text-tinta dark:text-slate-50">{ofertado ? fmtCLP(animado) : 'Sin ofertar'}</span>
          {presupuesto > 0 && <span className="text-[13px] text-tinta-2 dark:text-slate-400 tabular-nums" title={origen}>de {fmtCLP(presupuesto)}</span>}
        </div>
      )}
      {presupuesto > 0 && (
        <>
          <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <motion.div className={`h-full rounded-full ${excede ? 'bg-urgente' : 'bg-marca'}`}
              initial={reducido ? false : { width: 0 }} animate={{ width: `${Math.min(100, pct)}%` }}
              transition={{ duration: 0.9, delay: 0.1, ease: EASE_LK }} />
          </div>
          <div className="mt-2 flex justify-between gap-3 flex-wrap text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
            <span>{ofertado ? `${Math.round(pct)}% del presupuesto · ` : ''}{origen}{tipo ? ` · tipo ${tipo.toLowerCase()}` : ''}</span>
            {ofertado > 0 && (excede
              ? <span className="font-medium text-urgente">Excede el presupuesto por {fmtCLP(ofertado - presupuesto)}</span>
              : <span>Margen al tope {fmtCLP(presupuesto - ofertado)}</span>)}
          </div>
        </>
      )}
      {!(presupuesto > 0) && <p className="mt-2 text-xs text-tinta-2 dark:text-slate-400">Presupuesto no publicado{tipo ? ` · tipo ${tipo.toLowerCase()}` : ''}</p>}
    </section>
  );
}

function BloqueCierre({ cierre, dias }: { cierre?: string | null; dias: number | null }) {
  const fecha = cierre ? new Date(cierre) : null;
  const hora = fecha ? fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }) : null;
  const dia = fecha ? fecha.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago' }) : null;
  const urgente = dias !== null && dias >= 0 && dias <= 2;
  const proximo = dias !== null && dias > 2 && dias <= 7;
  const grande = dias === null ? '—' : dias < 0 ? 'Cerrada' : dias === 0 ? `Hoy, ${hora}` : dias === 1 ? `Mañana, ${hora}` : `En ${dias} días`;
  return (
    <section className={BLOQUE}>
      <Rotulo icono={<Clock size={16} />} tono={urgente ? 'bg-red-50 text-urgente dark:bg-red-950/50' : proximo ? 'bg-amber-50 text-alerta dark:bg-amber-950/40' : undefined}>Cierre</Rotulo>
      <p className={`mt-4 text-[24px] font-semibold tracking-tight leading-none tabular-nums ${urgente ? 'text-urgente' : proximo ? 'text-alerta' : 'text-tinta dark:text-slate-50'}`}>{grande}</p>
      {dia && <p className="mt-2 text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{dias !== null && dias > 1 ? `${dia}, ${hora}` : dia}</p>}
    </section>
  );
}

function BloqueClave({ d, onIrViabilidad }: { d: ReturnType<typeof datosViabilidad>; onIrViabilidad?: () => void }) {
  return (
    <section className={`${BLOQUE} grid grid-cols-2 gap-4`}>
      <button type="button" onClick={onIrViabilidad} title={d.adjTitulo} className="group text-left min-w-0">
        <Rotulo icono={<Gavel size={16} />} />
        <p className="mt-3 flex items-center gap-1.5 text-xl font-semibold tracking-tight text-tinta dark:text-slate-50 group-hover:text-marca">
          {d.adjResultado}{d.adjDudosa && <AlertTriangle size={15} className="text-alerta" />}
        </p>
        <p className="text-xs text-tinta-2 dark:text-slate-400">se adjudica</p>
      </button>
      <div className="min-w-0">
        <Rotulo icono={<Package size={16} />} />
        <p className="mt-3 text-xl font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{d.nProductos ?? '—'}</p>
        <p className="text-xs text-tinta-2 dark:text-slate-400">productos</p>
      </div>
    </section>
  );
}


export function ResumenNegocio({ negocio, licitacion, oportunidad, onMontoChange, viabIA, onIrViabilidad, analisisIA }: {
  negocio: any;
  licitacion: any | null;
  oportunidad?: Oportunidad | null;
  onMontoChange: (m: number) => void;
  viabIA?: any;
  onIrViabilidad?: () => void;
  analisisIA?: AnalisisIA | null;
}) {
  const car = oportunidad?.caracteristicas;
  const tipoLabel = oportunidad?.tipo_licitacion ? (TIPO_LICITACION_MAP[oportunidad.tipo_licitacion] || oportunidad.tipo_licitacion) : null;
  const monedaLabel = oportunidad?.moneda ? (MONEDA_LABEL_MAP[oportunidad.moneda] || oportunidad.moneda) : null;
  const tieneMontoMP = !!(oportunidad?.monto_total || oportunidad?.monto_estimado);
  // Datos que Mercado Público NO informa y que la IA extrajo de las bases: nunca deben perderse.
  const presupuestoIA = !tieneMontoMP ? analisisIA?.presupuesto : null;
  const plazoIA = !car?.plazo_contrato_dias ? analisisIA?.plazoEjecucionDias : null;
  const experto = analisisIA?.analisisExperto;
  const descripcion = licitacion?.Descripcion || negocio.licitacion_descripcion;
  // Monto oficial de MP (del negocio o de la ficha en vivo): si existe, manda sobre la IA.
  const montoMP = Number(negocio.licitacion_monto) || Number(oportunidad?.monto_total || oportunidad?.monto_estimado) || 0;

  const [editMonto, setEditMonto] = useState(false);
  const [montoTemp, setMontoTemp] = useState(String(negocio.monto_ofertado || ''));
  const guardar = () => { onMontoChange(parseInt(montoTemp.replace(/\D/g, '')) || 0); setEditMonto(false); };

  // Cierre: días que faltan (se calcula con la fecha del negocio).
  const [ahora] = useState(() => Date.now());
  const cierreMs = negocio.licitacion_cierre ? new Date(negocio.licitacion_cierre).getTime() : NaN;
  const dias = Number.isFinite(cierreMs) ? (cierreMs < ahora ? -1 : diasCalendarioChile(cierreMs, ahora)) : null;

  const d = viabIA ? datosViabilidad(viabIA, montoMP) : null;
  const presupuestoBarra = Number(d?.presupuesto) || montoMP;
  const origenPresupuesto = montoMP > 0 ? 'informado por Mercado Público' : d?.presupuestoIvaIncl ? 'estimado de las bases, IVA incl.' : 'estimado de las bases';
  const editorMonto = editMonto ? (
    <div className="flex items-center gap-1.5 max-w-sm">
      <input value={montoTemp} onChange={e => setMontoTemp(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditMonto(false); }}
        autoFocus aria-label="Monto ofertado" placeholder="4500000" className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-slate-300 text-[15px] tabular-nums focus:outline-none focus:border-marca focus:ring-2 focus:ring-marca/15 dark:bg-slate-950 dark:border-slate-700" />
      <button type="button" onClick={guardar} aria-label="Guardar monto" className="w-10 h-10 rounded-lg bg-marca text-white flex items-center justify-center hover:bg-marca-fuerte"><Check size={16} /></button>
      <button type="button" onClick={() => setEditMonto(false)} aria-label="Cancelar" className="w-10 h-10 rounded-lg border border-linea text-slate-500 flex items-center justify-center hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><X size={16} /></button>
    </div>
  ) : null;
  const oferta = (
    <BloqueOferta ofertado={Number(negocio.monto_ofertado) || 0} presupuesto={presupuestoBarra} origen={origenPresupuesto}
      tipo={licitacion?.TipoConvocatoria} editor={editorMonto}
      onEditar={() => { setMontoTemp(String(negocio.monto_ofertado || '')); setEditMonto(true); }} />
  );

  return (
    <div className="space-y-4">
      {d ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr_1fr] gap-3">
          <div className="lg:row-span-2 min-w-0"><Aparece i={0} alto><BloqueViabilidad d={d} onIrViabilidad={onIrViabilidad} /></Aparece></div>
          <div className="lg:col-span-2 min-w-0"><Aparece i={1} alto>{oferta}</Aparece></div>
          <Aparece i={2} alto><BloqueCierre cierre={negocio.licitacion_cierre} dias={dias} /></Aparece>
          <Aparece i={3} alto><BloqueClave d={d} onIrViabilidad={onIrViabilidad} /></Aparece>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 min-w-0"><Aparece i={0} alto>{oferta}</Aparece></div>
          <Aparece i={1} alto><BloqueCierre cierre={negocio.licitacion_cierre} dias={dias} /></Aparece>
        </div>
      )}

      {/* Izquierda lo que se lee (descripción y bases); derecha el recorrido, que es una columna larga y angosta. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Panel i={4} icono={<FileText size={16} />} titulo="Descripción">
            {descripcion
              ? <p className="text-sm text-tinta-2 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{descripcion}</p>
              : <p className="text-[13px] text-slate-400">Sin descripción disponible.</p>}
            {negocio.etiquetas?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-linea/80 dark:border-slate-800 flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><Tag size={13} />Líneas de negocio</span>
                {negocio.etiquetas.map((et: any) => (
                  <span key={et.id} className="text-[13px] font-medium text-tinta dark:text-slate-200"><Estado color={et.color}>{et.nombre}</Estado></span>
                ))}
              </div>
            )}
          </Panel>
          {/* Contenido de las bases (ficha oficial de MP): plazos, antecedentes, requisitos, criterios, garantías, cláusulas */}
          {negocio.licitacion_codigo && <FichaMPBases codigo={negocio.licitacion_codigo} />}
        </div>
        <div className="min-w-0 lg:sticky lg:top-4"><RecorridoNegocio negocioId={negocio.id} /></div>
      </div>

      {/* Columnas que se rellenan solas (sin los huecos que dejaba la grilla con paneles de distinto alto). */}
      <div className="columns-1 md:columns-2 2xl:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <Panel i={5} icono={<Building2 size={16} />} titulo="Información general">
          <Campos items={[
            ['Organismo', negocio.licitacion_organismo],
            ['Unidad / RUT', licitacion?.NombreUnidad || licitacion?.RutOrganismo],
            ['Región', negocio.licitacion_region],
            ['Dirección', [licitacion?.DireccionUnidad, licitacion?.ComunaUnidad].filter(Boolean).join(', ')],
            ['Operador de la compra', oportunidad?.operador_compra ? `${oportunidad.operador_compra}${oportunidad.operador_cargo ? ` · ${oportunidad.operador_cargo}` : ''}` : null],
            ['Reclamos del organismo (12 meses)', oportunidad?.reclamos_12m != null ? String(oportunidad.reclamos_12m) : null],
          ]} />
        </Panel>

        {oportunidad && (tipoLabel || car?.tipo_convocatoria || monedaLabel || car?.etapas || car?.contrato_texto || car?.publicidad_ofertas_texto
          || oportunidad.estado || car?.toma_razon !== undefined || car?.es_obras || car?.codigo_bip || car?.extension_plazo) && (
          <Panel i={6} icono={<Shield size={16} />} titulo="Características de la licitación">
            <Campos items={[
              ['Tipo de licitación', tipoLabel],
              ['Estado', oportunidad.estado],
              ['Tipo convocatoria', car?.tipo_convocatoria || oportunidad?.tipo_convocatoria],
              ['Moneda', monedaLabel],
              ['Etapas del proceso', car?.etapas],
              ['Toma de razón Contraloría', car?.toma_razon === true ? 'Requiere toma de razón por Contraloría' : car?.toma_razon === false ? 'No requiere toma de razón por Contraloría' : null],
              ['Contrato', car?.contrato_texto],
              ['Tipo de adquisición', car?.es_obras === true ? 'Licitación de obras' : null],
              ['Código BIP', car?.codigo_bip],
              ['Ampliación automática del plazo', car?.extension_plazo === true ? 'Sí: si hay 2 o menos ofertas, el cierre se amplía 2 días hábiles' : null],
              ['Publicidad de ofertas técnicas', car?.publicidad_ofertas_texto],
            ]} />
          </Panel>
        )}

        {oportunidad && (tieneMontoMP || car?.estimacion_monto || car?.fuente_financiamiento || car?.modalidad_pago || car?.duracion_contrato_texto || car?.renovable !== undefined
          || car?.observacion_contrato || car?.responsable_pago_nombre) && (
          <Panel i={7} icono={<Wallet size={16} />} titulo="Montos y duración del contrato">
            <Campos items={[
              ['Estimación en base a', car?.estimacion_monto],
              ['Fuente de financiamiento', car?.fuente_financiamiento],
              ['Monto total estimado', tieneMontoMP ? fmtCLP(oportunidad?.monto_total || oportunidad?.monto_estimado) : null],
              ['Contrato con renovación', car?.renovable === true ? 'Sí' : car?.renovable === false ? 'No' : null],
              ['Duración del contrato', car?.duracion_contrato_texto],
              ['Observaciones', car?.observacion_contrato],
              ['Plazos de pago', car?.modalidad_pago],
              ['Responsable de pago', car?.responsable_pago_nombre],
              ['E-mail responsable de pago', car?.responsable_pago_email ? enlace(`mailto:${car.responsable_pago_email}`, <Mail size={13} />, car.responsable_pago_email) : null],
            ]} />
          </Panel>
        )}

        {oportunidad && (car?.subcontratacion !== undefined || car?.prohibicion_contratacion || car?.direccion_visita || car?.direccion_entrega) && (
          <Panel i={8} icono={<ListChecks size={16} />} titulo="Requerimientos y otras cláusulas">
            {/* MP muestra "No permite subcontratación" cuando existe una cláusula de prohibición,
                independientemente del flag SubContratacion (que los organismos llenan de forma inconsistente). */}
            <Campos items={[
              ['Prohibición de subcontratación', car?.prohibicion_contratacion ? 'No permite subcontratación' : car?.subcontratacion === true ? 'Permite subcontratación' : car?.subcontratacion === false ? 'No permite subcontratación' : null],
              ['Cláusula de subcontratación / cesión', car?.prohibicion_contratacion],
              ['Dirección de visita a terreno', car?.direccion_visita],
              ['Dirección de entrega', car?.direccion_entrega],
            ]} />
          </Panel>
        )}

        {(oportunidad?.contacto?.nombre || oportunidad?.contacto?.email || oportunidad?.contacto?.telefono) && (
          <Panel i={9} icono={<Phone size={16} />} titulo="Responsable del contrato">
            <Campos items={[
              ['Nombre', oportunidad?.contacto?.nombre],
              ['Cargo', oportunidad?.contacto?.cargo],
              ['Email', oportunidad?.contacto?.email ? enlace(`mailto:${oportunidad.contacto.email}`, <Mail size={13} />, oportunidad.contacto.email) : null],
              ['Teléfono', oportunidad?.contacto?.telefono ? enlace(`tel:${oportunidad.contacto.telefono}`, <Phone size={13} />, oportunidad.contacto.telefono) : null],
            ]} />
          </Panel>
        )}

        {(oportunidad?.url_acta || oportunidad?.numero_oferentes) && (
          <Panel i={9} icono={<CheckCircle size={16} />} titulo="Adjudicación">
            <div className="space-y-2">
              {oportunidad?.numero_oferentes !== undefined && oportunidad.numero_oferentes > 0 && (
                <p className="text-[13.5px] text-tinta-2 dark:text-slate-300"><strong className="font-semibold text-tinta dark:text-slate-100">{oportunidad.numero_oferentes}</strong> proveedor{oportunidad.numero_oferentes !== 1 ? 'es' : ''} participaron</p>
              )}
              {oportunidad?.url_acta && (
                <a href={oportunidad.url_acta} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[13.5px] text-marca hover:text-marca-fuerte hover:underline"><ExternalLink size={14} /> Ver acta de adjudicación</a>
              )}
            </div>
          </Panel>
        )}

        {(presupuestoIA?.monto || plazoIA) && (
          <Panel i={9} icono={<Wallet size={16} />} titulo="Presupuesto y plazos de las bases" derecha={<IABadge />}>
            <p className="text-xs text-slate-500 mb-3">Mercado Público no informó este dato; se extrajo automáticamente de las bases.</p>
            <Campos items={[
              ['Presupuesto estimado', presupuestoIA?.monto ? (fmtCLP(Number(presupuestoIA.monto)) || `${presupuestoIA.monto} ${presupuestoIA.moneda || ''}`) : null],
              ['Plazo de ejecución', plazoIA ? `${plazoIA} Días` : null],
            ]} />
          </Panel>
        )}
      </div>

      {experto && (experto.puntosCriticos?.length || experto.oportunidades?.length || experto.riesgosDetectados?.length || experto.recomendaciones?.length) && (
        <Panel i={10} icono={<Lightbulb size={16} />} titulo="Análisis experto para el proveedor"
          derecha={<div className="flex items-center gap-2 flex-wrap justify-end"><IABadge />{experto.complejidad && <span className="text-xs text-tinta-2 dark:text-slate-400">Complejidad: <span className="font-medium text-tinta dark:text-slate-200">{experto.complejidad}</span></span>}{experto.atractivo && <span className="text-xs text-tinta-2 dark:text-slate-400">Atractivo: <span className="font-medium text-tinta dark:text-slate-200">{experto.atractivo}</span></span>}</div>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
            {([
              ['Puntos críticos', experto.puntosCriticos, <AlertTriangle key="a" size={15} />, 'text-amber-600', 'bg-amber-400'],
              ['Riesgos detectados', experto.riesgosDetectados, <AlertTriangle key="b" size={15} />, 'text-red-600', 'bg-red-400'],
              ['Oportunidades', experto.oportunidades, <ThumbsUp key="c" size={15} />, 'text-emerald-600', 'bg-emerald-400'],
              ['Recomendaciones', experto.recomendaciones, <ListChecks key="d" size={15} />, 'text-teal-700', 'bg-teal-500'],
            ] as Array<[string, string[] | undefined, React.ReactNode, string, string]>).filter(([, l]) => !!l?.length).map(([titulo, lista, icono, tono, punto]) => (
              <div key={titulo} className="rounded-lg bg-slate-50/80 p-4 h-full dark:bg-slate-800/40">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-tinta dark:text-slate-100 mb-2.5"><span className={`flex ${tono}`}>{icono}</span>{titulo}</p>
                <ul className="space-y-2">
                  {lista!.map((p, k) => <li key={k} className="flex items-start gap-2 text-[13px] text-tinta-2 dark:text-slate-300 leading-snug"><span className={`w-1.5 h-1.5 rounded-full mt-[7px] flex-shrink-0 ${punto}`} />{mayus(p)}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
