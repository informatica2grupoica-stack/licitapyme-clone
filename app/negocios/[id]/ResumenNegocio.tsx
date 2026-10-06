'use client';

// ── Resumen del negocio ────────────────────────────────────────────────────────
// Misma lógica y datos que tenía SeccionResumen (page.tsx), con el lenguaje visual de las pestañas de
// viabilidad: tarjeta de viabilidad con el nivel, tarjetas de datos clave, recorrido, y los datos
// de la licitación en grillas (etiqueta arriba, valor abajo; los campos vacíos no se muestran).
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { IconSparkles as Sparkles, IconChevronRight as ChevronRight, IconBan as Ban, IconCheck as Check, IconX as X, IconEdit as Edit3, IconWallet as Wallet, IconCalendarEvent as CalendarEvent, IconGavel as Gavel, IconPackage as Package, IconEye as Eye, IconFileText as FileText, IconBuilding as Building2, IconShield as Shield, IconListCheck as ListChecks, IconPhone as Phone, IconMail as Mail, IconExternalLink as ExternalLink, IconCircleCheck as CheckCircle, IconAlertTriangle as AlertTriangle, IconBulb as Lightbulb, IconThumbUp as ThumbsUp, IconTag as Tag, IconHelpCircle as HelpCircle } from '@tabler/icons-react';
import { Oportunidad } from '@/app/types/search.types';
import { TIPO_LICITACION_MAP, MONEDA_LABEL_MAP } from '@/app/types/mercado-publico.types';
import { IABadge } from '@/app/licitacion/[codigo]/utils';
import type { AnalisisIA } from '@/app/licitacion/[codigo]/utils';
import { NIVEL_VISTA, mayus, sinCA } from '@/app/licitacion/[codigo]/sections/viabilidad-v4-comun';
import { useContador } from '@/app/lib/use-contador';
import { FichaMPBases } from '@/app/components/FichaMPBases';
import { Badge } from '@/app/components/ui/Badge';
import { RecorridoNegocio } from './RecorridoNegocio';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtCLP = (n?: number | null) => n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : null;
const fmtFecha = (s?: string | null) => {
  if (!s) return null;
  try { return new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }); } catch { return s; }
};

// ── Movimiento ──
function Aparece({ i = 0, children, alto }: { i?: number; children: React.ReactNode; alto?: boolean }) {
  const reducido = useReducedMotion();
  return (
    <motion.div className={alto ? 'h-full min-w-0' : 'min-w-0'} initial={reducido ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: Math.min(i, 10) * 0.055, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

// ── Contenedores ──
function Panel({ i, icono, titulo, derecha, children }: { i: number; icono: React.ReactNode; titulo: string; derecha?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Aparece i={i}>
      <section className="bg-white border border-zinc-200/70 rounded-2xl p-5 h-full">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="flex items-center gap-2.5 text-[15px] font-black text-zinc-900"><span className="w-8 h-8 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center">{icono}</span>{titulo}</h3>
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
          <dt className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-400">{k}</dt>
          <dd className="text-[13.5px] font-medium text-zinc-800 leading-snug break-words mt-0.5">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const enlace = (href: string, icono: React.ReactNode, texto: string) => (
  <a href={href} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline break-all">{icono} {texto}</a>
);

// ── Tarjeta de dato clave ──
function Tile({ i, etiqueta, icono, color, valor, numero, formato, pastilla, texto, alerta, extra, onClick, titulo }: {
  i: number; etiqueta: string; icono: React.ReactNode; color: string; valor: string; numero?: number; formato?: (n: number) => string;
  pastilla?: React.ReactNode; texto?: React.ReactNode; alerta?: boolean; extra?: React.ReactNode; onClick?: () => void; titulo?: string;
}) {
  const animado = useContador(numero ?? 0);
  const visible = numero != null && formato ? formato(Math.round(animado)) : valor;
  const fz = valor.length > 16 ? 'text-[18px]' : valor.length > 11 ? 'text-[22px]' : 'text-[26px]';
  const cuerpo = (
    <div title={titulo} className={`min-w-0 border rounded-2xl p-4 h-full flex flex-col gap-2 break-words text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${alerta ? 'border-red-300 bg-red-50/30' : 'bg-white border-zinc-200/70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wide mb-1.5">{etiqueta}</p>
          <p className={`${fz} font-black leading-tight tabular-nums text-zinc-900`}>{visible}</p>
        </div>
        <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: color + '18', color }}>{icono}</div>
      </div>
      {pastilla && <div>{pastilla}</div>}
      {texto && <p className="text-[12px] text-zinc-500 leading-snug">{texto}</p>}
      {extra}
    </div>
  );
  return (
    <Aparece i={i} alto>
      {onClick ? <button type="button" onClick={onClick} className="block w-full h-full">{cuerpo}</button> : cuerpo}
    </Aparece>
  );
}

// ── Tarjeta de viabilidad: lo que el análisis ya concluyó, con el mismo nivel de la pestaña Viabilidad ──
function TarjetaViabilidad({ viabIA, montoMP, onIrViabilidad }: { viabIA: any; montoMP: number; onIrViabilidad?: () => void }) {
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

  const accion = esV4 && sc4 ? mayus(sinCA(sc4.accion_texto)) : esV3 && ver3 ? ver3.label : `${ganaLabel}${viabIA?.veredicto?.nivel ? ` · ${String(viabIA.veredicto.nivel).replace(/_/g, ' ')}` : ''}`;
  const resumen = esV4 && sc4?.resumen_pantalla ? String(sc4.resumen_pantalla).replace(/^[A-ZÁÉÍÓÚ ]+ · /, '').split(' · ').map(mayus).join(' · ')
    : esV3 ? t3?.titular : viabIA?.veredicto?.por_que;
  const motivo = esV4 ? sc4?.motivo_exclusion?.texto : esV3 && t3?.veredicto === 'NO_VAMOS' ? t3?.porque_no : null;
  const sinReq = esV4 ? 'Sin requisitos que dejen fuera' : 'Sin bloqueantes detectados';

  const adjResultado = esV4
    ? (viabIA?.adjudicacion?.resultado === 'POR_LINEAS' ? 'Por línea' : viabIA?.adjudicacion?.resultado === 'GLOBAL' ? 'Global' : 'No está claro')
    : mayus(String(viabIA?.adjudicacion?.como_se_adjudica || viabIA?.modalidad?.general || viabIA?.modalidad?.tipo || '—').replace(/_/g, ' ').toLowerCase());
  const adjDudosa = viabIA?.adjudicacion?.estado === 'REVISION_HUMANA' || viabIA?.adjudicacion?.resultado === 'NO_CLARO';
  const presupuesto = montoMP > 0 ? montoMP : (viabIA?.presupuesto?.bruto ?? viabIA?.presupuesto?.neto);
  const nProductos = viabIA?.manifiesto_productos?.length || viabIA?.productos?.items?.length || viabIA?.costeo?.items?.length || null;
  const accionColor = esV4 && sc4 ? (nv?.cls === 'bg-red-700' || nv?.cls === 'bg-red-500' ? 'text-red-800 bg-red-100 border-red-300' : nv?.cls?.includes('emerald') ? 'text-emerald-800 bg-emerald-100 border-emerald-300' : nv?.cls?.includes('orange') ? 'text-orange-800 bg-orange-100 border-orange-300' : 'text-yellow-800 bg-yellow-100 border-yellow-300') : 'text-zinc-700 bg-white border-zinc-200';

  return (
    <Aparece>
      <section className={`rounded-2xl border p-5 ${nv ? nv.soft : 'bg-white border-violet-200'}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-violet-600"><Sparkles size={15} /> Viabilidad</h3>
          {onIrViabilidad && <button type="button" onClick={onIrViabilidad} className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-violet-700 hover:underline">Ver análisis completo <ChevronRight size={14} /></button>}
        </div>
        <div className="flex items-stretch gap-4 flex-wrap">
          {nv ? (
            <div title={nv.tip} className={`rounded-xl text-white px-5 py-3 flex flex-col items-center justify-center min-w-[150px] cursor-help ${nv.cls}`}>
              <span className="text-[10.5px] font-bold uppercase tracking-widest opacity-80">Nivel de atractivo</span>
              <span className="text-[22px] font-black leading-tight">{nv.label}</span>
            </div>
          ) : esV3 && ver3 ? (
            <div className={`rounded-xl text-white px-5 py-3 flex items-center justify-center min-w-[150px] ${ver3.cls}`}><span className="text-[18px] font-black">{ver3.label}</span></div>
          ) : (
            <div className={`rounded-xl text-white w-[88px] flex flex-col items-center justify-center ${semColor}`}><span className="text-[26px] font-black leading-none">{score}</span><span className="text-[10px] opacity-80">/100</span></div>
          )}
          <div className="flex-1 min-w-[240px] flex flex-col justify-center gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {nv && <span className={`inline-flex items-center gap-1.5 text-[13px] font-bold px-3 py-1 rounded-lg border ${accionColor}`}><HelpCircle size={14} />{accion}</span>}
              {!nv && !(esV3 && ver3) && <span className="text-[14px] font-bold text-zinc-800">{accion}</span>}
              {(nv || esV3) && (nReq > 0
                ? <span className="inline-flex items-center gap-1 text-[12px] font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg"><Ban size={13} />{nReq} {nReq === 1 ? 'requisito puede' : 'requisitos pueden'} dejarte fuera</span>
                : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><Check size={14} />{sinReq}</span>)}
            </div>
            {resumen && <p className="text-[14px] font-bold text-zinc-800 leading-snug line-clamp-2">{mayus(resumen)}</p>}
            {motivo && <p className="text-[12.5px] text-red-700 leading-snug line-clamp-2">{mayus(motivo)}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-4">
          <div className="bg-white/80 border border-zinc-200/70 rounded-xl px-3.5 py-2.5" title={montoMP > 0 ? 'Monto informado por Mercado Público (manda sobre el estimado de la IA)' : 'Estimado por la IA desde las bases (Mercado Público no informó el monto)'}>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-400 flex items-center gap-1.5"><Wallet size={12} />Presupuesto {montoMP > 0 ? '(MP)' : viabIA?.presupuesto?.bruto && !viabIA?.presupuesto?.regimen_fora ? '(IVA incl.)' : ''}</p>
            <p className="text-[16px] font-black text-emerald-700 tabular-nums mt-0.5">{fmtCLP(presupuesto) || '—'}</p>
          </div>
          <button type="button" onClick={onIrViabilidad} className="bg-white/80 hover:bg-white border border-zinc-200/70 rounded-xl px-3.5 py-2.5 text-left transition-colors group"
            title={[viabIA?.adjudicacion?.fuente && `Fuente: ${viabIA.adjudicacion.fuente}`, viabIA?.adjudicacion?.evidencia, esV4 && viabIA?.adjudicacion?.motivo, 'Clic para ver la cita en Viabilidad'].filter(Boolean).join('\n')}>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-400 flex items-center gap-1.5"><Gavel size={12} />Cómo se adjudica<Eye size={11} className="text-violet-400 group-hover:text-violet-600" /></p>
            <p className="text-[16px] font-black text-zinc-800 mt-0.5">{adjResultado}{adjDudosa && <span className="text-amber-500" title="Sin certeza: confírmalo en las bases"> <AlertTriangle size={14} className="inline -mt-0.5" /></span>}</p>
          </button>
          <div className="bg-white/80 border border-zinc-200/70 rounded-xl px-3.5 py-2.5">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-400 flex items-center gap-1.5"><Package size={12} />Productos</p>
            <p className="text-[16px] font-black text-zinc-800 tabular-nums mt-0.5">{nProductos ?? '—'}</p>
          </div>
        </div>
      </section>
    </Aparece>
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
  const dias = Number.isFinite(cierreMs) ? Math.ceil((cierreMs - ahora) / 86400000) : null;
  const cierrePastilla = dias === null ? null : dias < 0 ? <Badge>Proceso finalizado</Badge> : dias === 0 ? <Badge variant="danger" dot>Cierra hoy</Badge>
    : dias <= 2 ? <Badge variant="danger" dot>Cierre muy próximo</Badge> : dias <= 7 ? <Badge variant="warning" dot>Cierre próximo</Badge> : <Badge variant="success" dot>Plazo vigente</Badge>;

  return (
    <div className="space-y-4">
      {viabIA && <TarjetaViabilidad viabIA={viabIA} montoMP={montoMP} onIrViabilidad={onIrViabilidad} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
        <Tile i={1} etiqueta="Monto disponible" icono={<Wallet size={20} />} color="#059669"
          valor={fmtCLP(negocio.licitacion_monto) || 'No publicado'} numero={negocio.licitacion_monto ? Number(negocio.licitacion_monto) : undefined} formato={n => fmtCLP(n) || ''}
          texto={licitacion?.TipoConvocatoria ? `Tipo: ${licitacion.TipoConvocatoria}` : undefined} />
        <Tile i={2} etiqueta="Monto ofertado" icono={<Edit3 size={20} />} color="#7c3aed"
          valor={fmtCLP(negocio.monto_ofertado) || 'Sin ofertar'} numero={!editMonto && negocio.monto_ofertado ? Number(negocio.monto_ofertado) : undefined} formato={n => fmtCLP(n) || ''}
          extra={editMonto ? (
            <div className="flex items-center gap-1.5">
              <input value={montoTemp} onChange={e => setMontoTemp(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditMonto(false); }}
                autoFocus aria-label="Monto ofertado" placeholder="Ej: 4500000" className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-violet-300 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-violet-100" />
              <button type="button" onClick={guardar} aria-label="Guardar monto" className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700"><Check size={16} /></button>
              <button type="button" onClick={() => setEditMonto(false)} aria-label="Cancelar" className="w-9 h-9 rounded-lg border border-zinc-200 text-zinc-500 flex items-center justify-center hover:bg-zinc-50"><X size={16} /></button>
            </div>
          ) : <button type="button" onClick={() => { setMontoTemp(String(negocio.monto_ofertado || '')); setEditMonto(true); }} className="self-start text-[12px] font-semibold text-violet-700 hover:underline">{negocio.monto_ofertado ? 'Editar monto' : 'Ingresar monto'}</button>} />
        <Tile i={3} etiqueta="Fecha de cierre" icono={<CalendarEvent size={20} />} color={dias !== null && dias >= 0 && dias <= 2 ? '#dc2626' : '#0284c7'} alerta={dias !== null && dias >= 0 && dias <= 2}
          valor={dias !== null && dias >= 0 ? (dias === 0 ? 'Hoy' : `${dias} ${dias === 1 ? 'Día' : 'Días'}`) : fmtFecha(negocio.licitacion_cierre) || '—'}
          numero={dias !== null && dias > 0 ? dias : undefined} formato={n => `${n} ${n === 1 ? 'Día' : 'Días'}`}
          pastilla={cierrePastilla} texto={dias !== null && dias >= 0 ? fmtFecha(negocio.licitacion_cierre) : undefined} />
      </div>

      <RecorridoNegocio negocioId={negocio.id} />

      <Panel i={4} icono={<FileText size={17} />} titulo="Descripción">
        {descripcion
          ? <p className="text-[14px] text-zinc-700 leading-relaxed whitespace-pre-wrap">{descripcion}</p>
          : <p className="text-[13px] text-zinc-400 italic">Sin descripción disponible.</p>}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Panel i={5} icono={<Building2 size={17} />} titulo="Información general">
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
          <Panel i={6} icono={<Shield size={17} />} titulo="Características de la licitación">
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
          <Panel i={7} icono={<Wallet size={17} />} titulo="Montos y duración del contrato">
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
          <Panel i={8} icono={<ListChecks size={17} />} titulo="Requerimientos y otras cláusulas">
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
          <Panel i={9} icono={<Phone size={17} />} titulo="Responsable del contrato">
            <Campos items={[
              ['Nombre', oportunidad?.contacto?.nombre],
              ['Cargo', oportunidad?.contacto?.cargo],
              ['Email', oportunidad?.contacto?.email ? enlace(`mailto:${oportunidad.contacto.email}`, <Mail size={13} />, oportunidad.contacto.email) : null],
              ['Teléfono', oportunidad?.contacto?.telefono ? enlace(`tel:${oportunidad.contacto.telefono}`, <Phone size={13} />, oportunidad.contacto.telefono) : null],
            ]} />
          </Panel>
        )}

        {(oportunidad?.url_acta || oportunidad?.numero_oferentes) && (
          <Panel i={9} icono={<CheckCircle size={17} />} titulo="Adjudicación">
            <div className="space-y-2">
              {oportunidad?.numero_oferentes !== undefined && oportunidad.numero_oferentes > 0 && (
                <p className="text-[13.5px] text-zinc-700"><strong className="text-zinc-900">{oportunidad.numero_oferentes}</strong> proveedor{oportunidad.numero_oferentes !== 1 ? 'es' : ''} participaron</p>
              )}
              {oportunidad?.url_acta && (
                <a href={oportunidad.url_acta} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[13.5px] text-indigo-600 hover:text-indigo-800 hover:underline"><ExternalLink size={14} /> Ver acta de adjudicación</a>
              )}
            </div>
          </Panel>
        )}

        {(presupuestoIA?.monto || plazoIA) && (
          <Panel i={9} icono={<Wallet size={17} />} titulo="Presupuesto y plazos de las bases" derecha={<IABadge />}>
            <p className="text-[12px] text-zinc-400 mb-3">Mercado Público no informó este dato; se extrajo automáticamente de las bases.</p>
            <Campos items={[
              ['Presupuesto estimado', presupuestoIA?.monto ? (fmtCLP(Number(presupuestoIA.monto)) || `${presupuestoIA.monto} ${presupuestoIA.moneda || ''}`) : null],
              ['Plazo de ejecución', plazoIA ? `${plazoIA} Días` : null],
            ]} />
          </Panel>
        )}
      </div>

      {/* Contenido de las bases (ficha oficial de MP): plazos, antecedentes, requisitos, criterios, garantías, cláusulas */}
      {negocio.licitacion_codigo && <FichaMPBases codigo={negocio.licitacion_codigo} />}

      {experto && (experto.puntosCriticos?.length || experto.oportunidades?.length || experto.riesgosDetectados?.length || experto.recomendaciones?.length) && (
        <Panel i={10} icono={<Lightbulb size={17} />} titulo="Análisis experto para el proveedor"
          derecha={<div className="flex items-center gap-2 flex-wrap justify-end"><IABadge />{experto.complejidad && <Badge>Complejidad: {experto.complejidad}</Badge>}{experto.atractivo && <Badge>Atractivo: {experto.atractivo}</Badge>}</div>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
            {([
              ['Puntos críticos', experto.puntosCriticos, <AlertTriangle key="a" size={16} />, 'bg-amber-100 text-amber-700', 'bg-amber-400'],
              ['Riesgos detectados', experto.riesgosDetectados, <AlertTriangle key="b" size={16} />, 'bg-red-100 text-red-700', 'bg-red-400'],
              ['Oportunidades', experto.oportunidades, <ThumbsUp key="c" size={16} />, 'bg-emerald-100 text-emerald-700', 'bg-emerald-400'],
              ['Recomendaciones', experto.recomendaciones, <ListChecks key="d" size={16} />, 'bg-indigo-100 text-indigo-700', 'bg-indigo-400'],
            ] as Array<[string, string[] | undefined, React.ReactNode, string, string]>).filter(([, l]) => !!l?.length).map(([titulo, lista, icono, tono, punto]) => (
              <div key={titulo} className="rounded-xl border border-zinc-200/70 bg-white p-4 h-full">
                <p className="flex items-center gap-2 text-[13px] font-bold text-zinc-900 mb-2.5"><span className={`w-7 h-7 rounded-full flex items-center justify-center ${tono}`}>{icono}</span>{titulo}</p>
                <ul className="space-y-2">
                  {lista!.map((p, k) => <li key={k} className="flex items-start gap-2 text-[13px] text-zinc-700 leading-snug"><span className={`w-1.5 h-1.5 rounded-full mt-[7px] flex-shrink-0 ${punto}`} />{mayus(p)}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {negocio.etiquetas?.length > 0 && (
        <Panel i={11} icono={<Tag size={17} />} titulo="Líneas de negocio">
          <div className="flex flex-wrap gap-1.5">
            {negocio.etiquetas.map((et: any) => (
              <span key={et.id} style={{ backgroundColor: et.color + '18', color: et.color, borderColor: et.color + '50' }} className="text-[12.5px] font-bold px-3 py-1 rounded-full border">{et.nombre}</span>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
