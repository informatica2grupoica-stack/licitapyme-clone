'use client';

import {
  Gauge, RefreshCw, Loader2, AlertTriangle, ShieldCheck, TrendingUp,
  DollarSign, ListOrdered, Scale, ClipboardCheck, Package, CheckCircle2, XCircle, Info,
  FileText, Wrench, FileWarning, Brain, ShieldAlert, FileCheck2, Ban, Lightbulb, Mail,
} from 'lucide-react';
import { SectionHeader, InfoCard, AnalisisIA } from '../utils';

// Forma flexible: tanto el objeto del POST como el reconstruido del GET.
export interface Viabilidad {
  area_negocio?: string;
  score_viabilidad?: {
    total: number;
    semaforo: string;
    descalificacion_automatica?: boolean;
    motivo_descalificacion?: string | null;
    desglose?: {
      presupuesto?: { valor_extraido?: string; valor_neto?: number | null; puntos?: number; notas?: string };
      lineas?: { cantidad?: number | null; puntos_final?: number; notas?: string; fuente?: 'mp' | 'pdf' | null; items?: Array<{ nombre?: string; descripcion?: string; categoria?: string; cantidad?: number | null; unidad?: string | null; requisitos?: string | null }> };
      modalidad_adjudicacion?: { modalidad?: string; modalidad_texto?: string | null; es_por_linea?: boolean; puntos?: number; notas?: string };
      criterios_evaluacion?: { peso_precio_pct?: number; puntos?: number; notas?: string };
      tipo_producto?: { descripcion?: string; puntos?: number; importable?: boolean; especificacion_dirigida?: boolean; notas?: string };
    } | null;
    penalizaciones?: Array<{ motivo: string; puntos_restados: number }>;
  };
  informe_ejecutivo?: {
    resumen?: string;
    presupuesto_display?: string;
    plazo_presentacion?: string | null;
    ventaja_competitiva?: string;
    riesgos?: string[];
    alertas?: string[];
    campos_faltantes?: string[];
    recomendacion?: string;
  } | null;
  confianza_analisis?: number;
  actualizado?: string;
  riesgo_comercial?: {
    monto_neto_calculado_clp?: number | null;
    score_viabilidad?: number;
    decision_sugerida?: 'POSTULAR' | 'EVALUAR_CON_PROVEEDOR' | 'DESCARTAR';
    motivo_principal_decision?: string;
    analisis_criterios?: {
      modalidad_adjudicacion?: { tipo?: string; nivel_riesgo?: string; justificacion_texto?: string };
      experiencia_requerida?: { exige_experiencia_publica?: boolean; monto_minimo_exigido?: string | null; alerta_bloqueo?: string | null };
      garantias_y_seguros?: { seriedad_oferta?: string; fiel_cumplimiento?: string; seguro_daños_terceros?: string };
      logistica_y_plazos?: { plazo_ejecucion_dias?: number | null; zona_geografica?: string; impacto_flete_y_operaciones?: string; justificacion_logistica?: string };
    };
  };
}

const SEMAFORO: Record<string, { label: string; emoji: string; ring: string; bg: string; text: string; bar: string }> = {
  VERDE:     { label: 'Viabilidad ALTA',        emoji: '🟢', ring: 'ring-emerald-300', bg: 'bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-500' },
  AMARILLO:  { label: 'Viabilidad MEDIA-ALTA',  emoji: '🟡', ring: 'ring-yellow-300',  bg: 'bg-yellow-50',  text: 'text-yellow-700',  bar: 'bg-yellow-500' },
  NARANJA:   { label: 'Viabilidad MEDIA',       emoji: '🟠', ring: 'ring-orange-300',  bg: 'bg-orange-50',  text: 'text-orange-700',  bar: 'bg-orange-500' },
  ROJO:      { label: 'Viabilidad BAJA',        emoji: '🔴', ring: 'ring-red-300',     bg: 'bg-red-50',     text: 'text-red-700',     bar: 'bg-red-500' },
  ROJO_DURO: { label: 'Descarte',               emoji: '⛔', ring: 'ring-red-400',     bg: 'bg-red-100',    text: 'text-red-800',     bar: 'bg-red-700' },
};

const CRITERIOS_META: Array<{ key: string; label: string; max: number; icon: React.ReactNode }> = [
  { key: 'presupuesto',            label: 'Presupuesto',  max: 25, icon: <DollarSign size={13} /> },
  { key: 'lineas',                 label: 'Líneas',       max: 20, icon: <ListOrdered size={13} /> },
  { key: 'modalidad_adjudicacion', label: 'Modalidad',    max: 15, icon: <Scale size={13} /> },
  { key: 'criterios_evaluacion',   label: 'Criterios',    max: 20, icon: <ClipboardCheck size={13} /> },
  { key: 'tipo_producto',          label: 'Producto',     max: 20, icon: <Package size={13} /> },
];

function Lista({ items, tipo }: { items?: string[]; tipo: 'riesgo' | 'alerta' | 'falta' }) {
  if (!items || items.length === 0) return null;
  const cfg = {
    riesgo: { icon: <AlertTriangle size={13} className="text-amber-500" />, },
    alerta: { icon: <Info size={13} className="text-blue-500" />, },
    falta:  { icon: <XCircle size={13} className="text-slate-400" />, },
  }[tipo];
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] text-slate-700">
          <span className="flex-shrink-0 mt-0.5">{cfg.icon}</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Chips({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <span key={i} className="text-[11.5px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">{t}</span>
      ))}
    </div>
  );
}

function Campo({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-[11.5px] text-slate-400 w-36 flex-shrink-0 font-medium">{label}</span>
      <span className="text-[12.5px] text-slate-800 flex-1">{value}</span>
    </div>
  );
}

export function ViabilidadSection({
  viabilidad, analizando, onRecalcular, hayDocumentos, analisis, documentosNoLegibles, ocultarBoton,
}: {
  viabilidad: Viabilidad | null;
  analizando: boolean;
  onRecalcular: () => void;
  hayDocumentos: boolean;
  analisis?: AnalisisIA | null;
  documentosNoLegibles?: string[];
  ocultarBoton?: boolean;
}) {
  const sv = viabilidad?.score_viabilidad;
  const cfg = sv?.semaforo ? SEMAFORO[sv.semaforo] : null;
  const informe = viabilidad?.informe_ejecutivo;
  const desglose = sv?.desglose;

  const items   = analisis?.especificacionesTecnicas || [];
  const criterios = analisis?.criteriosEvaluacion || [];
  const rbt     = analisis?.resumenBasesTecnicas;
  const rba     = analisis?.resumenBasesAdmin;
  const exp     = analisis?.analisisExperto;
  const req     = analisis?.requisitos;
  const docsPres = analisis?.documentosAPresenter || [];
  const garantias = analisis?.garantias || [];
  const multas  = analisis?.multas || [];
  const contacto = analisis?.contacto;
  const hayReq  = req && Object.values(req).some(v => Array.isArray(v) && v.length > 0);
  const hayExperto = exp && (exp.resumenEjecutivo || (exp.recomendaciones?.length ?? 0) > 0 || (exp.puntosCriticos?.length ?? 0) > 0
    || (exp.riesgosDetectados?.length ?? 0) > 0 || (exp.oportunidades?.length ?? 0) > 0
    || (exp.ventajasCompetitivas?.length ?? 0) > 0 || (exp.aspectosNegociables?.length ?? 0) > 0);

  const REQ_LABELS: Record<string, string> = {
    habilitantes: 'Habilitantes', administrativos: 'Administrativos', tecnicos: 'Técnicos', economicos: 'Económicos', prohibiciones: 'Prohibiciones',
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={<Gauge size={18} />}
        title="Score de control (determinista)"
        subtitle="Respaldo numérico 0–100 — el análisis IA de arriba es el principal"
        action={ocultarBoton ? undefined : (
          <button
            onClick={onRecalcular}
            disabled={analizando}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {analizando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {analizando ? 'Analizando…' : 'Recalcular'}
          </button>
        )}
      />

      {/* Detalle por documento: cuáles se analizaron y cuáles quedaron pendientes (y por qué) */}
      {(() => {
        const detalle = analisis?.documentosDetalle;
        if (!detalle || detalle.length === 0) return null;
        const analizados = detalle.filter(d => d.analizado);
        const pendientes = detalle.filter(d => !d.analizado);
        return (
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-[13.5px] font-bold text-slate-800 flex items-center gap-2">
                <FileCheck2 size={15} className="text-indigo-500" /> Documentos analizados
              </h3>
              <span className="text-[12px] font-bold tabular-nums text-slate-500">
                {analizados.length}<span className="text-slate-300"> / {detalle.length}</span>
              </span>
            </div>
            <ul className="space-y-1.5">
              {detalle.map((d, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[12.5px] border-b border-slate-50 pb-1.5 last:border-0">
                  {d.analizado
                    ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                    : <XCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 font-medium break-words">{d.nombre}</p>
                    <p className={`text-[11.5px] mt-0.5 ${d.analizado ? 'text-slate-400' : 'text-amber-700'}`}>
                      {d.motivo}
                      {d.analizado && d.metodo && <span className="text-slate-400"> · {d.metodo}</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {pendientes.length > 0 && (
              <p className="text-[11.5px] text-amber-700 mt-3 flex items-start gap-1.5">
                <FileWarning size={13} className="flex-shrink-0 mt-0.5" />
                {pendientes.length} documento{pendientes.length === 1 ? '' : 's'} no analizado{pendientes.length === 1 ? '' : 's'}.
                Si contienen las bases (presupuesto, criterios, modalidad), esos datos pueden faltar en el análisis.
              </p>
            )}
          </div>
        );
      })()}

      {/* Fallback: documentos no legibles por heurística, solo si aún no hay detalle del análisis */}
      {(!analisis?.documentosDetalle || analisis.documentosDetalle.length === 0) && documentosNoLegibles && documentosNoLegibles.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <FileWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-amber-800">
            <p className="font-semibold mb-0.5">Documentos no analizados ({documentosNoLegibles.length})</p>
            <p className="text-amber-700">
              No se pudo leer el contenido de: {documentosNoLegibles.join(', ')}. Si contienen las bases
              administrativas (presupuesto, criterios, modalidad), esos datos pueden faltar en el análisis.
              Los <strong>.rar/.zip</strong> y planos/imágenes no son legibles automáticamente.
            </p>
          </div>
        </div>
      )}

      {/* Estado vacío / cargando */}
      {!viabilidad && analizando && (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-slate-200">
          <Loader2 size={28} className="animate-spin text-indigo-500 mb-3" />
          <p className="text-[14px] font-semibold text-slate-700">Calculando viabilidad…</p>
          <p className="text-[12px] text-slate-400 mt-1">Analizando bases con IA</p>
        </div>
      )}

      {!viabilidad && !analizando && (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-slate-200 text-center">
          <Gauge size={28} className="text-slate-300 mb-3" />
          <p className="text-[14px] font-semibold text-slate-700 mb-1">Sin análisis de viabilidad</p>
          <p className="text-[12px] text-slate-400 max-w-xs mb-4">
            {ocultarBoton
              ? 'Pulsa “Analizar con IA” arriba: se calculará también este score de control.'
              : hayDocumentos
                ? 'Pulsa "Recalcular" para analizar la viabilidad de esta licitación.'
                : 'Primero descarga los documentos de la licitación; luego se calculará la viabilidad automáticamente.'}
          </p>
          {hayDocumentos && !ocultarBoton && (
            <button onClick={onRecalcular}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-500">
              <Gauge size={14} /> Calcular viabilidad
            </button>
          )}
        </div>
      )}

      {/* Resultado */}
      {viabilidad && sv && cfg && (
        <>
          {/* Tarjeta score + semáforo */}
          <div className={`rounded-2xl border ring-1 ${cfg.ring} ${cfg.bg} p-5`}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="text-5xl leading-none">{cfg.emoji}</div>
                <div>
                  <p className={`text-[15px] font-bold ${cfg.text}`}>{cfg.label}</p>
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    {viabilidad.area_negocio && <>Área: <strong>{viabilidad.area_negocio}</strong> · </>}
                    {viabilidad.confianza_analisis != null && <>Confianza: {Math.round(viabilidad.confianza_analisis * 100)}%</>}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-4xl font-black tabular-nums ${cfg.text}`}>{sv.total}<span className="text-lg text-slate-400">/100</span></div>
                <p className="text-[11px] text-slate-400">Score de viabilidad</p>
              </div>
            </div>

            {sv.descalificacion_automatica && sv.motivo_descalificacion && (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-100 border border-red-200 px-3 py-2 text-[12.5px] text-red-800">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span><strong>Descalificación automática:</strong> {sv.motivo_descalificacion}</span>
              </div>
            )}
          </div>

          {/* Desglose de criterios */}
          {desglose && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-[13.5px] font-bold text-slate-800 mb-4 flex items-center gap-2">
                <TrendingUp size={15} className="text-indigo-500" /> Desglose por criterio
              </h3>
              <div className="space-y-3.5">
                {CRITERIOS_META.map(c => {
                  const d: any = (desglose as any)[c.key];
                  if (!d) return null;
                  const pts = (c.key === 'lineas' ? d.puntos_final : d.puntos) ?? 0;
                  const pct = Math.max(0, Math.min(100, (pts / c.max) * 100));
                  return (
                    <div key={c.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                          <span className="text-slate-400">{c.icon}</span> {c.label}
                        </span>
                        <span className="text-[12px] font-bold tabular-nums text-slate-600">{pts}<span className="text-slate-300">/{c.max}</span></span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
                      </div>
                      {d.notas && <p className="text-[11px] text-slate-400 mt-1">{d.notas}</p>}
                    </div>
                  );
                })}
              </div>

              {/* Penalizaciones */}
              {sv.penalizaciones && sv.penalizaciones.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[12px] font-bold text-red-600 mb-2 flex items-center gap-1.5"><AlertTriangle size={13} /> Penalizaciones</p>
                  <ul className="space-y-1">
                    {sv.penalizaciones.map((p, i) => (
                      <li key={i} className="flex items-center justify-between text-[12.5px] text-slate-600">
                        <span>{p.motivo}</span>
                        <span className="font-bold text-red-500 tabular-nums">−{p.puntos_restados}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Productos y modalidad — datos clave de la licitación (fuente fiable: API MP) */}
          {desglose && (() => {
            const ln = desglose.lineas;
            const mod = desglose.modalidad_adjudicacion;
            const prods = ln?.items || [];
            const porLinea = mod?.es_por_linea;
            const modLabel = porLinea ? 'Por línea'
              : mod?.modalidad === 'suma_alzada' ? 'Suma alzada'
              : mod?.modalidad === 'suma_alzada_items_obligatorios' ? 'Suma alzada (ítems obligatorios)'
              : 'No especificada';
            return (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-[13.5px] font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Package size={15} className="text-indigo-500" /> Productos y modalidad
                </h3>

                {/* Resumen: cantidad de ítems + modalidad */}
                <div className="flex flex-wrap gap-2.5 mb-4">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100">
                    <ListOrdered size={13} /> {ln?.cantidad ?? prods.length ?? 0} ítem{(ln?.cantidad ?? prods.length) === 1 ? '' : 's'}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-xl border ${
                    porLinea ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'
                  }`}>
                    <Scale size={13} /> {modLabel}
                  </span>
                  {ln?.fuente === 'mp' && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-xl bg-slate-50 text-slate-500 border border-slate-100">
                      <Info size={11} /> Datos de Mercado Público
                    </span>
                  )}
                </div>
                {mod?.modalidad_texto && (
                  <p className="text-[11.5px] text-slate-400 mb-3 -mt-1">Modalidad declarada: «{mod.modalidad_texto}»</p>
                )}

                {/* Tabla de productos */}
                {prods.length > 0 ? (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left text-slate-400 border-b border-slate-100">
                          <th className="py-2 pr-2 font-semibold w-8">#</th>
                          <th className="py-2 pr-2 font-semibold">Producto / descripción</th>
                          <th className="py-2 pr-2 font-semibold">Categoría</th>
                          <th className="py-2 pr-2 font-semibold text-right w-16">Cant.</th>
                          <th className="py-2 font-semibold w-16">Unidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prods.slice(0, 120).map((p, i) => (
                          <tr key={i} className="border-b border-slate-50 align-top">
                            <td className="py-1.5 pr-2 text-slate-400 tabular-nums">{i + 1}</td>
                            <td className="py-1.5 pr-2 text-slate-800">
                              <span className="font-medium">{p.nombre || p.descripcion || '—'}</span>
                              {p.nombre && p.descripcion && p.descripcion !== p.nombre && (
                                <span className="block text-[11.5px] text-slate-500 mt-0.5">{p.descripcion}</span>
                              )}
                              {p.requisitos && (
                                <span className="block text-[11px] text-slate-500 mt-1 leading-snug">
                                  <span className="font-semibold text-slate-400">Requisitos: </span>{p.requisitos}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-slate-500 text-[11.5px]">{p.categoria || ''}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700 font-semibold">{p.cantidad ?? '—'}</td>
                            <td className="py-1.5 text-slate-500">{p.unidad || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {prods.length > 120 && <p className="text-[11px] text-slate-400 mt-2">… y {prods.length - 120} ítems más</p>}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-slate-400">No se detectaron productos/líneas individuales para esta licitación.</p>
                )}
              </div>
            );
          })()}

          {/* Análisis de Riesgo Comercial (PROMPT 3) */}
          {viabilidad.riesgo_comercial && (() => {
            const rc = viabilidad.riesgo_comercial!;
            const ac = rc.analisis_criterios || {};
            const dec = rc.decision_sugerida;
            const decCfg = dec === 'POSTULAR' ? { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'POSTULAR' }
              : dec === 'DESCARTAR' ? { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'DESCARTAR' }
              : { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'EVALUAR CON PROVEEDOR' };
            const riesgoColor = (n?: string) => n === 'Alto' || n === 'Crítico' ? 'bg-red-100 text-red-700'
              : n === 'Medio' || n === 'Moderado' ? 'bg-amber-100 text-amber-700'
              : 'bg-emerald-100 text-emerald-700';
            const mod = ac.modalidad_adjudicacion; const exp = ac.experiencia_requerida;
            const gar = ac.garantias_y_seguros; const log = ac.logistica_y_plazos;
            return (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h3 className="text-[13.5px] font-bold text-slate-800 flex items-center gap-2">
                  <Scale size={15} className="text-indigo-500" /> Análisis de riesgo comercial
                </h3>

                {/* Decisión + score comercial */}
                <div className={`rounded-xl border ${decCfg.border} ${decCfg.bg} px-4 py-3 flex items-center justify-between gap-3 flex-wrap`}>
                  <div>
                    <p className={`text-[14px] font-black ${decCfg.text}`}>{decCfg.label}</p>
                    {rc.motivo_principal_decision && <p className="text-[12px] text-slate-600 mt-0.5">{rc.motivo_principal_decision}</p>}
                  </div>
                  {rc.score_viabilidad != null && (
                    <div className="text-right">
                      <div className={`text-2xl font-black tabular-nums ${decCfg.text}`}>{Math.round(rc.score_viabilidad * 100)}<span className="text-sm text-slate-400">/100</span></div>
                      <p className="text-[10px] text-slate-400">Score comercial</p>
                    </div>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {/* Modalidad */}
                  {mod && (
                    <div className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5"><Scale size={13} className="text-slate-400" /> Modalidad: {mod.tipo}</p>
                        {mod.nivel_riesgo && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${riesgoColor(mod.nivel_riesgo)}`}>Riesgo {mod.nivel_riesgo}</span>}
                      </div>
                      {mod.justificacion_texto && <p className="text-[11.5px] text-slate-500 leading-snug">{mod.justificacion_texto}</p>}
                    </div>
                  )}

                  {/* Experiencia */}
                  {exp && (
                    <div className="rounded-xl border border-slate-100 p-3">
                      <p className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5 mb-1"><ClipboardCheck size={13} className="text-slate-400" /> Experiencia exigida</p>
                      <p className="text-[11.5px] text-slate-600">{exp.exige_experiencia_publica ? (exp.monto_minimo_exigido || 'Sí exige experiencia con el Estado') : 'No exige experiencia pública específica'}</p>
                      {exp.alerta_bloqueo && (
                        <p className="text-[11.5px] text-red-600 font-semibold mt-1 flex items-start gap-1"><AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> {exp.alerta_bloqueo}</p>
                      )}
                    </div>
                  )}

                  {/* Garantías y seguros */}
                  {gar && (
                    <div className="rounded-xl border border-slate-100 p-3">
                      <p className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5 mb-1.5"><ShieldCheck size={13} className="text-slate-400" /> Garantías y seguros</p>
                      <Campo label="Seriedad oferta" value={gar.seriedad_oferta} />
                      <Campo label="Fiel cumplimiento" value={gar.fiel_cumplimiento} />
                      <Campo label="Seguro daños 3os" value={gar.seguro_daños_terceros} />
                    </div>
                  )}

                  {/* Logística y plazos */}
                  {log && (
                    <div className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5"><FileText size={13} className="text-slate-400" /> Logística y plazos</p>
                        {log.impacto_flete_y_operaciones && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${riesgoColor(log.impacto_flete_y_operaciones)}`}>Flete {log.impacto_flete_y_operaciones}</span>}
                      </div>
                      <Campo label="Plazo ejecución" value={log.plazo_ejecucion_dias != null ? `${log.plazo_ejecucion_dias} días` : null} />
                      <Campo label="Zona" value={log.zona_geografica} />
                      {log.justificacion_logistica && <p className="text-[11.5px] text-slate-500 leading-snug mt-1">{log.justificacion_logistica}</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Informe ejecutivo */}
          {informe && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-[13.5px] font-bold text-slate-800 flex items-center gap-2">
                <ShieldCheck size={15} className="text-indigo-500" /> Informe ejecutivo
              </h3>

              {informe.resumen && <p className="text-[13px] text-slate-700 leading-relaxed">{informe.resumen}</p>}

              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
                {informe.presupuesto_display && (
                  <div className="flex gap-2"><span className="text-slate-400 font-medium w-28 flex-shrink-0">Presupuesto</span><span className="text-slate-800 font-semibold">{informe.presupuesto_display}</span></div>
                )}
                {informe.plazo_presentacion && (
                  <div className="flex gap-2"><span className="text-slate-400 font-medium w-28 flex-shrink-0">Plazo</span><span className="text-slate-800">{informe.plazo_presentacion}</span></div>
                )}
              </div>

              {informe.ventaja_competitiva && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3.5 py-2.5">
                  <p className="text-[11px] font-bold text-emerald-700 mb-0.5 flex items-center gap-1"><CheckCircle2 size={12} /> Ventaja competitiva</p>
                  <p className="text-[12.5px] text-emerald-900">{informe.ventaja_competitiva}</p>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-5">
                {informe.riesgos && informe.riesgos.length > 0 && (
                  <div><p className="text-[12px] font-bold text-slate-700 mb-2">Riesgos</p><Lista items={informe.riesgos} tipo="riesgo" /></div>
                )}
                {informe.alertas && informe.alertas.length > 0 && (
                  <div><p className="text-[12px] font-bold text-slate-700 mb-2">Alertas</p><Lista items={informe.alertas} tipo="alerta" /></div>
                )}
              </div>

              {informe.campos_faltantes && informe.campos_faltantes.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-700 mb-2">Información faltante</p>
                  <Lista items={informe.campos_faltantes} tipo="falta" />
                </div>
              )}

              {informe.recomendacion && (
                <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3.5 py-3">
                  <p className="text-[11px] font-bold text-indigo-700 mb-0.5">Recomendación</p>
                  <p className="text-[13px] text-indigo-900 leading-relaxed">{informe.recomendacion}</p>
                </div>
              )}
            </div>
          )}

          {viabilidad.actualizado && (
            <p className="text-[11px] text-slate-400 text-center">
              Actualizado: {new Date(viabilidad.actualizado).toLocaleString('es-CL')}
            </p>
          )}
        </>
      )}

      {/* ═══ DETALLE DEL ANÁLISIS (datos extraídos de las bases) ═══ */}
      {analisis && (items.length > 0 || criterios.length > 0 || rbt || rba || hayExperto || hayReq || docsPres.length > 0 || garantias.length > 0 || multas.length > 0) && (
        <div className="space-y-4 pt-1">
          <h3 className="text-[13px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-2">
            <FileText size={14} /> Detalle de la licitación
          </h3>

          {/* Bases administrativas */}
          {rba && (rba.objeto || rba.plazo_contrato || rba.modalidad_pago || (rba.garantias_exigidas?.length ?? 0) > 0 || (rba.cronograma?.length ?? 0) > 0) && (
            <InfoCard title="Bases administrativas" icon={<ClipboardCheck size={15} />}>
              <Campo label="Objeto" value={rba.objeto} />
              <Campo label="Plazo de contrato" value={rba.plazo_contrato} />
              <Campo label="Modalidad de pago" value={rba.modalidad_pago} />
              <Campo label="Forma de pago" value={rba.forma_pago} />
              <Campo label="Penalidades" value={rba.penalidades_resumen} />
              {(rba.garantias_exigidas?.length ?? 0) > 0 && (
                <div className="pt-2"><p className="text-[11.5px] text-slate-400 font-medium mb-1.5">Garantías exigidas</p><Chips items={rba.garantias_exigidas} /></div>
              )}
              {(rba.condiciones_contrato?.length ?? 0) > 0 && (
                <div className="pt-2"><p className="text-[11.5px] text-slate-400 font-medium mb-1.5">Condiciones del contrato</p><Chips items={rba.condiciones_contrato} /></div>
              )}
              {(rba.cronograma?.length ?? 0) > 0 && (
                <div className="pt-3">
                  <p className="text-[11.5px] text-slate-400 font-medium mb-1.5">Cronograma</p>
                  <ul className="space-y-1">
                    {rba.cronograma!.map((c, i) => (
                      <li key={i} className="flex justify-between text-[12.5px] text-slate-700 border-b border-slate-50 py-1">
                        <span>{c.etapa}</span><span className="font-medium text-slate-500">{c.fecha}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </InfoCard>
          )}

          {/* Bases técnicas */}
          {rbt && (rbt.descripcion_general || rbt.alcance || (rbt.entregables?.length ?? 0) > 0 || (rbt.requisitos_tecnicos_oferente?.length ?? 0) > 0) && (
            <InfoCard title="Bases técnicas" icon={<Wrench size={15} />}>
              <Campo label="Descripción general" value={rbt.descripcion_general} />
              <Campo label="Alcance" value={rbt.alcance} />
              <Campo label="Lugar de ejecución" value={rbt.lugar_ejecucion} />
              <Campo label="Condiciones de entrega" value={rbt.condiciones_entrega} />
              {(rbt.entregables?.length ?? 0) > 0 && (
                <div className="pt-2"><p className="text-[11.5px] text-slate-400 font-medium mb-1.5">Entregables</p><Chips items={rbt.entregables} /></div>
              )}
              {(rbt.requisitos_tecnicos_oferente?.length ?? 0) > 0 && (
                <div className="pt-2"><p className="text-[11.5px] text-slate-400 font-medium mb-1.5">Requisitos técnicos del oferente</p><Chips items={rbt.requisitos_tecnicos_oferente} /></div>
              )}
              {(rbt.estandares_calidad?.length ?? 0) > 0 && (
                <div className="pt-2"><p className="text-[11.5px] text-slate-400 font-medium mb-1.5">Estándares de calidad</p><Chips items={rbt.estandares_calidad} /></div>
              )}
            </InfoCard>
          )}

          {/* Ítems / Líneas */}
          {items.length > 0 && (
            <InfoCard title={`Ítems / líneas (${items.length})`} icon={<ListOrdered size={15} />} defaultOpen={false}>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-100">
                      <th className="py-2 pr-2 font-semibold w-12">#</th>
                      <th className="py-2 pr-2 font-semibold">Descripción</th>
                      <th className="py-2 pr-2 font-semibold text-right w-20">Cant.</th>
                      <th className="py-2 font-semibold w-16">Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 80).map((it, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5 pr-2 text-slate-400 tabular-nums">{it.item || i + 1}</td>
                        <td className="py-1.5 pr-2 text-slate-800">{it.descripcion}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{it.cantidad ?? '—'}</td>
                        <td className="py-1.5 text-slate-500">{it.unidad || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {items.length > 80 && <p className="text-[11px] text-slate-400 mt-2">… y {items.length - 80} ítems más</p>}
              </div>
            </InfoCard>
          )}

          {/* Criterios de evaluación */}
          {criterios.length > 0 && (
            <InfoCard title="Criterios de evaluación" icon={<Scale size={15} />}>
              <ul className="space-y-2">
                {criterios.map((c, i) => (
                  <li key={i}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[12.5px] font-medium text-slate-700">{c.nombre}{c.descripcion ? <span className="text-slate-400 font-normal"> — {c.descripcion}</span> : null}</span>
                      <span className="text-[12px] font-bold text-indigo-600 tabular-nums">{c.ponderacion}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, c.ponderacion)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </InfoCard>
          )}

          {/* Requisitos del oferente */}
          {hayReq && (
            <InfoCard title="Requisitos del oferente" icon={<FileCheck2 size={15} />}>
              <div className="space-y-3">
                {(['habilitantes', 'administrativos', 'tecnicos', 'economicos', 'prohibiciones'] as const).map(k => {
                  const arr = req?.[k];
                  if (!arr || arr.length === 0) return null;
                  return (
                    <div key={k}>
                      <p className={`text-[11.5px] font-bold mb-1 ${k === 'prohibiciones' ? 'text-red-600' : 'text-slate-500'}`}>{REQ_LABELS[k]}</p>
                      <ul className="space-y-1">
                        {arr.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-[12.5px] text-slate-700">
                            <span className={`flex-shrink-0 mt-1 w-1.5 h-1.5 rounded-full ${k === 'prohibiciones' ? 'bg-red-400' : 'bg-indigo-400'}`} />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </InfoCard>
          )}

          {/* Documentos a presentar */}
          {docsPres.length > 0 && (
            <InfoCard title={`Documentos a presentar (${docsPres.length})`} icon={<FileText size={15} />} defaultOpen={false}>
              <ol className="space-y-1.5 list-decimal list-inside">
                {docsPres.map((d, i) => (
                  <li key={i} className="text-[12.5px] text-slate-700">{d}</li>
                ))}
              </ol>
            </InfoCard>
          )}

          {/* Garantías */}
          {garantias.length > 0 && (
            <InfoCard title="Garantías" icon={<ShieldAlert size={15} />}>
              <div className="space-y-2.5">
                {garantias.map((g, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2 last:border-0">
                    <div>
                      <p className="text-[12.5px] font-semibold text-slate-800">{g.tipo}</p>
                      {g.momento && <p className="text-[11px] text-slate-400">{g.momento}{g.devolucion ? ` · ${g.devolucion}` : ''}</p>}
                    </div>
                    <span className="text-[12px] font-bold text-slate-600 whitespace-nowrap">
                      {g.porcentaje != null ? `${g.porcentaje}%` : g.montoFijo != null ? new Intl.NumberFormat('es-CL').format(g.montoFijo) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </InfoCard>
          )}

          {/* Multas y penalidades */}
          {multas.length > 0 && (
            <InfoCard title="Multas y penalidades" icon={<Ban size={15} />} defaultOpen={false}>
              <ul className="space-y-1.5">
                {multas.map((m, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 text-[12.5px]">
                    <span className="text-slate-700">{m.concepto}</span>
                    <span className="font-semibold text-amber-700 whitespace-nowrap">{m.valor}{m.unidad ? ` ${m.unidad}` : ''}</span>
                  </li>
                ))}
              </ul>
            </InfoCard>
          )}

          {/* Análisis experto */}
          {hayExperto && (
            <InfoCard title="Análisis experto" icon={<Brain size={15} />}>
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {exp!.complejidad && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                      exp!.complejidad === 'alta' ? 'bg-red-50 text-red-700 border-red-200'
                      : exp!.complejidad === 'media' ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                      Complejidad {exp!.complejidad}
                    </span>
                  )}
                  {exp!.atractivo && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200">
                      Atractivo: {exp!.atractivo}
                    </span>
                  )}
                </div>

                {exp!.resumenEjecutivo && (
                  <div>
                    <p className="text-[11.5px] font-bold text-slate-500 mb-1">Resumen ejecutivo</p>
                    <p className="text-[13px] text-slate-700 leading-relaxed">{exp!.resumenEjecutivo}</p>
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-4">
                  {(exp!.recomendaciones?.length ?? 0) > 0 && (
                    <div><p className="text-[11.5px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1"><Lightbulb size={12} /> Recomendaciones</p><Lista items={exp!.recomendaciones} tipo="alerta" /></div>
                  )}
                  {(exp!.ventajasCompetitivas?.length ?? 0) > 0 && (
                    <div><p className="text-[11.5px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1"><CheckCircle2 size={12} /> Ventajas competitivas</p><Lista items={exp!.ventajasCompetitivas} tipo="alerta" /></div>
                  )}
                  {(exp!.puntosCriticos?.length ?? 0) > 0 && (
                    <div><p className="text-[11.5px] font-bold text-slate-700 mb-1.5">Puntos críticos</p><Lista items={exp!.puntosCriticos} tipo="riesgo" /></div>
                  )}
                  {(exp!.riesgosDetectados?.length ?? 0) > 0 && (
                    <div><p className="text-[11.5px] font-bold text-red-700 mb-1.5">Riesgos detectados</p><Lista items={exp!.riesgosDetectados} tipo="riesgo" /></div>
                  )}
                  {(exp!.oportunidades?.length ?? 0) > 0 && (
                    <div><p className="text-[11.5px] font-bold text-indigo-700 mb-1.5">Oportunidades</p><Lista items={exp!.oportunidades} tipo="alerta" /></div>
                  )}
                  {(exp!.aspectosNegociables?.length ?? 0) > 0 && (
                    <div><p className="text-[11.5px] font-bold text-slate-700 mb-1.5">Aspectos negociables</p><Lista items={exp!.aspectosNegociables} tipo="alerta" /></div>
                  )}
                </div>
              </div>
            </InfoCard>
          )}

          {/* Contacto */}
          {contacto && Object.values(contacto).some(Boolean) && (
            <InfoCard title="Contacto" icon={<Mail size={15} />} defaultOpen={false}>
              <Campo label="Nombre" value={contacto.nombre} />
              <Campo label="Cargo" value={contacto.cargo} />
              <Campo label="Email" value={contacto.email} />
              <Campo label="Teléfono" value={contacto.telefono} />
            </InfoCard>
          )}
        </div>
      )}
    </div>
  );
}
