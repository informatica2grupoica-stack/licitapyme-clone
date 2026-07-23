'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppLayout }  from '@/app/components/AppLayout';
import { useToast }   from '@/app/components/ui/toast';
import { useSession } from '@/app/lib/session-context';
import { ESTADOS_PIPELINE, getEstadoPipeline } from '@/app/lib/pipeline';
import { estadoEfectivoCodigo, estadoEfectivoNombre } from '@/app/lib/estado-mp';

// Colores del badge de estado de Mercado Público (por código efectivo).
const ESTADO_MP_STYLE: Record<number, { bg: string; color: string; border: string }> = {
  5:  { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' }, // Publicada
  6:  { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' }, // Cerrada
  7:  { bg: '#ffedd5', color: '#c2410c', border: '#fed7aa' }, // Desierta
  8:  { bg: '#e0e7ff', color: '#4338ca', border: '#c7d2fe' }, // Adjudicada
  18: { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca' }, // Revocada
  19: { bg: '#fef9c3', color: '#a16207', border: '#fde68a' }, // Suspendida
};
import { ViabilidadIAPanel } from '@/app/licitacion/[codigo]/sections/ViabilidadIAPanel';
import { InteligenciaSection } from '@/app/licitacion/[codigo]/sections/InteligenciaSection';
import { DocumentosSection } from '@/app/licitacion/[codigo]/sections/DocumentosSection';
import { CriteriosSection } from '@/app/licitacion/[codigo]/sections/CriteriosSection';
import { PreguntasSection } from '@/app/licitacion/[codigo]/sections/PreguntasSection';
import { ResultadoSection } from '@/app/licitacion/[codigo]/sections/ResultadoSection';
import { esUrlAnalizable, IABadge } from '@/app/licitacion/[codigo]/utils';
import { Oportunidad } from '@/app/types/search.types';
import { TIPO_LICITACION_MAP, MONEDA_LABEL_MAP } from '@/app/types/mercado-publico.types';
import { RecorridoNegocio } from './RecorridoNegocio';
import { GestionAside } from './GestionAside';
import { registrarVerSeccion } from '@/app/lib/actividad-cliente';
import {
  ArrowLeft, Building2, Calendar, DollarSign, MapPin, Tag,
  MessageSquare, Send, Trash2, Loader2, AlertCircle, ExternalLink,
  FileText, Check, X, Package, Hash,
  Edit3, Clock, Globe, Users, Mail, Phone, ThumbsUp,
  Download, Bot, Brain, RefreshCw, Eye,
  Sparkles, BarChart3, BookOpen, AlertTriangle, ListChecks,
  TrendingUp, CheckCircle, Upload, ChevronRight, Files,
  ShieldAlert, Award, Wrench,
} from 'lucide-react';

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface Etiqueta { id: number; nombre: string; color: string; }

interface Negocio {
  id:                   number;
  licitacion_codigo:    string;
  licitacion_nombre:    string;
  licitacion_organismo: string;
  licitacion_monto:     number | null;
  licitacion_cierre:    string | null;
  licitacion_estado:    string | null;
  licitacion_tipo:      string | null;
  licitacion_region:    string | null;
  licitacion_descripcion: string | null;
  estado_pipeline:      string | null;
  monto_ofertado:       number;
  empresa_id:           number | null;
  empresa_nombre:       string | null;
  asignado_a:           number;
  usuario_nombre:       string;
  usuario_email:        string;
  admin_nombre:         string | null;
  etiquetas:            Etiqueta[];
  created_at:           string;
  updated_at:           string;
}

interface LicitacionRaw {
  Codigo:                  string;
  Nombre:                  string;
  Descripcion:             string;
  Estado:                  string;
  EstadoNombre:            string;
  FechaPublicacion:        string;
  FechaCierre:             string;
  FechaCreacion?:          string;
  FechaAdjudicacion?:      string;
  FechaInicioPreguntas?:   string;
  FechaFinPreguntas?:      string;
  FechaPublicacionRespuestas?: string;
  FechaAperturaTecnica?:   string;
  FechaAperturaEconomica?: string;
  FechaEstimadaAdjudicacion?: string;
  FechaVisitaTerreno?:     string;
  FechaEntregaAntecedentes?: string;
  Organismo:               string;
  NombreUnidad?:           string;
  RutOrganismo?:           string;
  DireccionUnidad?:        string;
  ComunaUnidad?:           string;
  Region:                  string;
  MontoEstimado?:          number;
  Moneda?:                 string;
  Tipo?:                   string;
  TipoConvocatoria?:       string;
  DiasCierreLicitacion?:   number;
  Items:  Array<{
    CodigoProducto:   string;
    NombreProducto:   string;
    Descripcion?:     string;
    Cantidad:         number;
    Unidad:           string;
  }>;
  Url: string;
}

interface Comentario {
  id:              number;
  comentario:      string;
  created_at:      string;
  usuario_id:      number;
  usuario_nombre:  string;
  usuario_email:   string;
  etiqueta_id:     number | null;
  etiqueta_nombre: string | null;
  etiqueta_color:  string | null;
  pipeline_estado: string | null;
}

interface DocumentoLocal {
  nombre: string;
  url: string;
  url_local?: string;
  size?: number;
  ya_descargado?: boolean;
  fecha?: string;
  categoria?: string;
  subcategoria?: string;
}

interface AnalisisIA {
  presupuesto: { monto: number; moneda: string } | null;
  plazoEjecucionDias: number | null;
  plazoEntregaDias?: number | null;
  modalidadAdjudicacion?: string | null;
  tipoContrato?: string | null;
  lugarEntrega?: string | null;
  criteriosEvaluacion: Array<{ nombre: string; ponderacion: number; tipo?: string; descripcion?: string; formula?: string }>;
  especificacionesTecnicas?: Array<{ item: string; descripcion: string; cantidad?: number; unidad?: string; requisitosMinimos?: string }>;
  documentosAPresenter?: string[];
  requisitos: {
    administrativos?: string[];
    tecnicos?: string[];
    economicos?: string[];
    habilitantes?: string[];
    prohibiciones?: string[];
  } | null;
  garantias: Array<{ tipo: string; porcentaje?: number; montoFijo?: number; momento?: string; devolucion?: string; plazo?: string }>;
  multas: Array<{ concepto: string; valor: string; unidad?: string }>;
  contacto?: { nombre?: string; cargo?: string; email?: string; telefono?: string } | null;
  resumenBasesAdmin?: {
    objeto: string;
    plazo_contrato: string | null;
    modalidad_pago: string | null;
    forma_pago: string | null;
    garantias_exigidas: string[];
    causales_rechazo: string[];
    cronograma: Array<{ etapa: string; fecha: string }>;
    condiciones_contrato: string[];
    penalidades_resumen: string | null;
  } | null;
  resumenBasesTecnicas?: {
    descripcion_general: string;
    alcance: string;
    entregables: string[];
    estandares_calidad: string[];
    condiciones_entrega: string | null;
    requisitos_tecnicos_oferente: string[];
    lugar_ejecucion: string | null;
  } | null;
  analisisExperto: {
    resumenEjecutivo?: string;
    puntosCriticos?: string[];
    oportunidades?: string[];
    riesgosDetectados?: string[];
    recomendaciones?: string[];
    ventajasCompetitivas?: string[];
    aspectosNegociables?: string[];
    complejidad?: string;
    atractivo?: string;
  } | null;
  documentoAnalizado: string | null;
  modelo: string | null;
  actualizado: string;
}

type Seccion = 'resumen' | 'resultado' | 'viabilidad' | 'criterios' | 'fechas' | 'items' | 'documentos' | 'analisis' | 'preguntas' | 'comentarios';

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (!n) return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(n);
}

function fmtFecha(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('es-CL', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return s; }
}

function getFileIcon(nombre: string) {
  const ext = nombre.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    pdf: '📄', zip: '📦', rar: '📦', doc: '📝', docx: '📝',
    xls: '📊', xlsx: '📊', png: '🖼', jpg: '🖼', dwg: '📐',
  };
  return icons[ext || ''] || '📎';
}

function formatFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function avatarGrad(id: number): string {
  const grads = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-purple-500 to-pink-600',
    'from-orange-500 to-amber-600',
    'from-cyan-500 to-sky-600',
  ];
  return grads[id % grads.length];
}

function iniciales(nombre: string | null, email: string): string {
  if (nombre) return nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email[0].toUpperCase();
}

const TIPO_COLORS: Record<string, string> = {
  LE: '#EF4444', LP: '#3B82F6', LQ: '#A855F7',
  CO: '#10B981', L1: '#F97316', SU: '#14B8A6',
};

function getTipo(codigo: string): string | null {
  const m = codigo.match(/-([A-Z]{1,2})\d+$/i);
  return m ? m[1].toUpperCase().slice(0, 2) : null;
}

// ── Pipeline Badge ─────────────────────────────────────────────────────────────
function PipelineBadge({ estadoId }: { estadoId: string | null }) {
  const estado = getEstadoPipeline(estadoId);
  if (!estado) return null;
  return (
    <span
      className="inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full border"
      style={{
        backgroundColor: estado.color + '18',
        color:           estado.color,
        borderColor:     estado.color + '50',
      }}
    >
      {estado.label}
    </span>
  );
}

// ── Sección Resumen ────────────────────────────────────────────────────────────
function SeccionResumen({
  negocio,
  licitacion,
  oportunidad,
  onMontoChange,
  etiquetas,
  viabIA,
  onIrViabilidad,
  analisisIA,
}: {
  negocio:       Negocio;
  licitacion:    LicitacionRaw | null;
  oportunidad?:  Oportunidad | null;
  onMontoChange: (m: number) => void;
  etiquetas:     Etiqueta[];
  viabIA?:       any;
  onIrViabilidad?: () => void;
  analisisIA?:   AnalisisIA | null;
}) {
  const car = oportunidad?.caracteristicas;
  const tipoLabel = oportunidad?.tipo_licitacion
    ? (TIPO_LICITACION_MAP[oportunidad.tipo_licitacion] || oportunidad.tipo_licitacion)
    : null;
  const monedaLabel = oportunidad?.moneda
    ? (MONEDA_LABEL_MAP[oportunidad.moneda] || oportunidad.moneda)
    : null;
  const tieneMontoMP = !!(oportunidad?.monto_total || oportunidad?.monto_estimado);
  // Datos que Mercado Público NO informa y que la IA extrajo de las bases — información
  // privilegiada que nunca debe perderse: espejo del mismo cálculo en ResumenSection.tsx
  // (vista pública /licitacion/[codigo]) para que ambas vistas muestren siempre lo mismo.
  const presupuestoIA = !tieneMontoMP ? analisisIA?.presupuesto : null;
  const tienePlazoMP = !!car?.plazo_contrato_dias;
  const plazoIA = !tienePlazoMP ? analisisIA?.plazoEjecucionDias : null;
  const experto = analisisIA?.analisisExperto;

  // Fila compacta — se oculta sola si no hay valor.
  const Row = ({ label, value }: { label: string; value?: string | number | null }) =>
    (value === null || value === undefined || value === '') ? null : (
      <div className="flex justify-between gap-3 py-2 border-b border-zinc-50 last:border-0">
        <span className="text-[12px] text-zinc-400 flex-shrink-0">{label}</span>
        <span className="text-[12.5px] font-semibold text-zinc-700 text-right">{value}</span>
      </div>
    );
  const [editMonto, setEditMonto] = useState(false);
  const [montoTemp, setMontoTemp] = useState(String(negocio.monto_ofertado || ''));

  const guardar = () => {
    const m = parseInt(montoTemp.replace(/\D/g, '')) || 0;
    onMontoChange(m);
    setEditMonto(false);
  };

  const descripcion = licitacion?.Descripcion || negocio.licitacion_descripcion;

  // Resumen de la viabilidad IA (lo que el corazón ya analizó).
  const fmtCLP = (n?: number | null) => n != null ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
  const sScore = Math.round(Number(viabIA?.score_0_100) || 0);
  const sSemColor = (viabIA?.semaforo === 'VERDE') ? 'bg-emerald-500' : (viabIA?.semaforo === 'AMARILLO') ? 'bg-yellow-500' : (viabIA?.semaforo === 'NARANJA') ? 'bg-orange-500' : (viabIA?.semaforo === 'ROJO' || viabIA?.semaforo === 'ROJO_DURO') ? 'bg-red-500' : 'bg-zinc-400';
  const sGana = (viabIA?.veredicto?.gana_probable || '').toLowerCase();
  const sGanaLabel = sGana === 'si' ? 'GANA' : sGana === 'no' ? 'NO GANA' : sGana ? 'CONDICIONAL' : '—';
  // v3: esta tarjeta ESPEJA la tarjeta de decisión del análisis (mismo lenguaje en toda la
  // app: GANABLE / PUEDE SER / NO VAMOS + titular + bloqueantes), en vez de la escala vieja.
  const esV3 = viabIA?._schema === 'v3';
  const tarjeta3 = viabIA?.tarjeta_decision;
  const VER3: Record<string, { label: string; cls: string }> = {
    GANABLE:   { label: 'GANABLE',   cls: 'bg-emerald-600' },
    PUEDE_SER: { label: 'PUEDE SER', cls: 'bg-yellow-500' },
    NO_VAMOS:  { label: 'NO VAMOS',  cls: 'bg-red-600' },
  };
  const ver3 = tarjeta3 ? VER3[tarjeta3.veredicto] : null;
  // Monto oficial de MP (del negocio o de la ficha en vivo): si existe, manda sobre la IA.
  const montoMP = Number(negocio.licitacion_monto) || Number(oportunidad?.monto_total || oportunidad?.monto_estimado) || 0;
  const adm3 = viabIA?.requisitos_admisibilidad || {};
  const nBloq3 = esV3
    ? (Array.isArray(adm3.bloqueantes) ? adm3.bloqueantes.filter((b: any) => String(b?.item || '').trim()).length : 0)
      + (adm3.cotizar_100?.aplica ? 1 : 0) + (adm3.presupuesto?.tipo === 'excluyente' ? 1 : 0)
    : 0;

  return (
    <div className="space-y-4">
      {viabIA && (
        <div className="bg-white border border-violet-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[12px] font-bold text-violet-500 uppercase tracking-wider flex items-center gap-1.5"><Sparkles size={13} /> Viabilidad</h3>
            {onIrViabilidad && <button onClick={onIrViabilidad} className="text-[12px] text-violet-600 hover:underline flex items-center gap-0.5">Ver análisis completo <ChevronRight size={13} /></button>}
          </div>
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl ${sSemColor} flex flex-col items-center justify-center text-white flex-shrink-0`}>
              <span className="text-lg font-black leading-none">{sScore}</span>
              <span className="text-[9px] opacity-80">/100</span>
            </div>
            <div className="min-w-0">
              {esV3 && ver3 ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-black text-white px-2 py-0.5 rounded ${ver3.cls}`}>{ver3.label}</span>
                    {nBloq3 > 0
                      ? <span className="text-[11px] font-bold text-red-600">⛔ {nBloq3} requisito{nBloq3 > 1 ? 's' : ''} puede{nBloq3 > 1 ? 'n' : ''} dejarte fuera</span>
                      : <span className="text-[11px] text-emerald-600">sin bloqueantes detectados</span>}
                  </div>
                  {tarjeta3?.titular && <p className="text-[13px] font-semibold text-zinc-800 leading-snug line-clamp-2 mt-1">{tarjeta3.titular}</p>}
                  {tarjeta3?.veredicto === 'NO_VAMOS' && tarjeta3?.porque_no && <p className="text-[12px] text-red-600 leading-snug line-clamp-2 mt-0.5">{tarjeta3.porque_no}</p>}
                </>
              ) : (
                <>
                  <p className="text-[14px] font-bold text-zinc-800">{sGanaLabel}{viabIA?.veredicto?.nivel ? ` · ${String(viabIA.veredicto.nivel).replace(/_/g, ' ')}` : ''}</p>
                  {viabIA?.veredicto?.por_que && <p className="text-[12.5px] text-zinc-500 leading-snug line-clamp-2 mt-0.5">{viabIA.veredicto.por_que}</p>}
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            {/* Presupuesto: cuando Mercado Público INFORMA el monto, ese manda; el estimado
                por la IA desde las bases queda solo como respaldo cuando MP no lo trae. */}
            <div className="bg-zinc-50 rounded-lg px-3 py-2" title={montoMP > 0 ? 'Monto informado por Mercado Público (manda sobre el estimado de la IA)' : 'Estimado por la IA desde las bases (MP no informó monto)'}>
              <p className="text-[10px] text-zinc-400 uppercase font-bold">Presupuesto {montoMP > 0 ? '(MP)' : (viabIA?.presupuesto?.bruto && !viabIA?.presupuesto?.regimen_fora ? '(IVA incl.)' : '')}</p>
              <p className="text-[13px] font-bold text-emerald-700">{fmtCLP(montoMP > 0 ? montoMP : (viabIA?.presupuesto?.bruto ?? viabIA?.presupuesto?.neto))}</p>
            </div>
            <div className="bg-zinc-50 rounded-lg px-3 py-2"><p className="text-[10px] text-zinc-400 uppercase font-bold">Cómo se adjudica</p><p className="text-[13px] font-semibold text-zinc-700">{String(viabIA?.adjudicacion?.como_se_adjudica || viabIA?.modalidad?.general || viabIA?.modalidad?.tipo || '—').replace(/_/g, ' ')}</p></div>
            <div className="bg-zinc-50 rounded-lg px-3 py-2"><p className="text-[10px] text-zinc-400 uppercase font-bold">Productos</p><p className="text-[13px] font-bold text-zinc-700">{viabIA?.manifiesto_productos?.length || viabIA?.productos?.items?.length || viabIA?.costeo?.items?.length || '—'}</p></div>
          </div>
        </div>
      )}
      {/* Recorrido del negocio: historia completa (radar → prefiltro → asignación →
          viabilidad → etapas → postulación → resultado) con fechas y tiempos por tramo. */}
      <RecorridoNegocio negocioId={negocio.id} />

      {descripcion ? (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-2.5">Descripción</h3>
          <p className="text-[13.5px] text-zinc-700 leading-relaxed whitespace-pre-wrap">{descripcion}</p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5 text-[13px] text-zinc-400 italic">
          Sin descripción disponible
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-zinc-200/60 rounded-xl p-4">
          <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider mb-1">Monto disponible</p>
          <p className="text-[15px] font-bold text-zinc-900">{fmt(negocio.licitacion_monto)}</p>
          {licitacion?.TipoConvocatoria && (
            <p className="text-[11px] text-zinc-400 mt-0.5">Tipo: {licitacion.TipoConvocatoria}</p>
          )}
        </div>

        <div className="bg-white border border-zinc-200/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Monto ofertado</p>
            <button onClick={() => setEditMonto(!editMonto)} className="text-zinc-300 hover:text-indigo-500 transition-colors">
              <Edit3 size={11} />
            </button>
          </div>
          {editMonto ? (
            <div className="flex items-center gap-1">
              <input
                value={montoTemp}
                onChange={e => setMontoTemp(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && guardar()}
                className="flex-1 text-sm border-b border-indigo-400 outline-none py-0.5 bg-transparent"
                autoFocus
              />
              <button onClick={guardar} className="text-emerald-500"><Check size={12} /></button>
              <button onClick={() => setEditMonto(false)} className="text-zinc-400"><X size={12} /></button>
            </div>
          ) : (
            <p className="text-[15px] font-bold text-zinc-700">{fmt(negocio.monto_ofertado || null)}</p>
          )}
        </div>

        <div className="bg-white border border-zinc-200/60 rounded-xl p-4">
          <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider mb-1">Fecha cierre</p>
          <p className="text-[13px] font-semibold text-zinc-800">{fmtFecha(negocio.licitacion_cierre)}</p>
        </div>
      </div>

      <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
        <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Información general</h3>
        <dl className="grid sm:grid-cols-2 gap-3">
          {negocio.licitacion_organismo && (
            <div className="flex items-start gap-2.5">
              <Building2 size={13} className="text-zinc-400 mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-[11px] text-zinc-400">Organismo</dt>
                <dd className="text-[13px] font-semibold text-zinc-800">{negocio.licitacion_organismo}</dd>
              </div>
            </div>
          )}
          {(licitacion?.NombreUnidad || licitacion?.RutOrganismo) && (
            <div className="flex items-start gap-2.5">
              <Hash size={13} className="text-zinc-400 mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-[11px] text-zinc-400">Unidad / RUT</dt>
                <dd className="text-[13px] font-semibold text-zinc-800">
                  {licitacion?.NombreUnidad || licitacion?.RutOrganismo || '—'}
                </dd>
              </div>
            </div>
          )}
          {negocio.licitacion_region && (
            <div className="flex items-start gap-2.5">
              <MapPin size={13} className="text-zinc-400 mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-[11px] text-zinc-400">Región</dt>
                <dd className="text-[13px] font-semibold text-zinc-800">{negocio.licitacion_region}</dd>
              </div>
            </div>
          )}
          {(licitacion?.ComunaUnidad || licitacion?.DireccionUnidad) && (
            <div className="flex items-start gap-2.5">
              <Globe size={13} className="text-zinc-400 mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-[11px] text-zinc-400">Dirección</dt>
                <dd className="text-[13px] font-semibold text-zinc-800">
                  {[licitacion?.DireccionUnidad, licitacion?.ComunaUnidad].filter(Boolean).join(', ')}
                </dd>
              </div>
            </div>
          )}
          {oportunidad?.operador_compra && (
            <div className="flex items-start gap-2.5">
              <Users size={13} className="text-zinc-400 mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-[11px] text-zinc-400">Operador de la compra</dt>
                <dd className="text-[13px] font-semibold text-zinc-800">
                  {oportunidad.operador_compra}{oportunidad.operador_cargo ? ` · ${oportunidad.operador_cargo}` : ''}
                </dd>
              </div>
            </div>
          )}
          {oportunidad?.reclamos_12m != null && (
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={13} className="text-zinc-400 mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-[11px] text-zinc-400">Reclamos del organismo (12m)</dt>
                <dd className="text-[13px] font-semibold text-zinc-800">{oportunidad.reclamos_12m}</dd>
              </div>
            </div>
          )}
        </dl>
      </div>

      {/* Características de la licitación (datos API MP) — espejo del radar */}
      {oportunidad && (tipoLabel || car?.tipo_convocatoria || monedaLabel || car?.etapas || car?.contrato_texto || car?.publicidad_ofertas_texto
        || oportunidad.estado || car?.toma_razon !== undefined || car?.es_obras || car?.codigo_bip || car?.extension_plazo) && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Características de la licitación</h3>
          <div>
            <Row label="Tipo de licitación"  value={tipoLabel} />
            <Row label="Estado"              value={oportunidad.estado} />
            <Row label="Tipo convocatoria"   value={car?.tipo_convocatoria || oportunidad?.tipo_convocatoria} />
            <Row label="Moneda"              value={monedaLabel} />
            <Row label="Etapas del proceso"  value={car?.etapas} />
            <Row label="Toma de razón Contraloría"
              value={car?.toma_razon === true ? 'Requiere Toma de Razón por Contraloría'
                : car?.toma_razon === false ? 'No requiere Toma de Razón por Contraloría' : null} />
            <Row label="Contrato"            value={car?.contrato_texto} />
            <Row label="Tipo de adquisición" value={car?.es_obras === true ? 'Licitación de obras' : null} />
            <Row label="Código BIP"          value={car?.codigo_bip} />
            <Row label="Ampliación automática del plazo"
              value={car?.extension_plazo === true
                ? 'Sí — si hay 2 o menos ofertas, el cierre se amplía 2 días hábiles' : null} />
            <Row label="Publicidad de ofertas técnicas" value={car?.publicidad_ofertas_texto} />
          </div>
        </div>
      )}

      {/* Montos y duración del contrato — espejo del radar */}
      {oportunidad && (tieneMontoMP || car?.estimacion_monto || car?.fuente_financiamiento || car?.modalidad_pago || car?.duracion_contrato_texto || car?.renovable !== undefined
        || car?.observacion_contrato || car?.responsable_pago_nombre) && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Montos y duración del contrato</h3>
          <div>
            <Row label="Estimación en base a"     value={car?.estimacion_monto} />
            <Row label="Fuente de financiamiento" value={car?.fuente_financiamiento} />
            <Row label="Monto total estimado"     value={tieneMontoMP ? fmt(oportunidad?.monto_total || oportunidad?.monto_estimado) : null} />
            <Row label="Contrato con renovación"
              value={car?.renovable === true ? 'Sí' : car?.renovable === false ? 'No' : null} />
            <Row label="Duración del contrato"    value={car?.duracion_contrato_texto} />
            <Row label="Observaciones"            value={car?.observacion_contrato} />
            <Row label="Plazos de pago"           value={car?.modalidad_pago} />
            <Row label="Responsable de pago"      value={car?.responsable_pago_nombre} />
          </div>
          {car?.responsable_pago_email && (
            <div className="flex gap-3 py-2 border-t border-zinc-50 mt-1 pt-2.5">
              <span className="text-[12px] text-zinc-400 flex-shrink-0">e-mail responsable de pago</span>
              <a href={`mailto:${car.responsable_pago_email}`}
                className="text-[12.5px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1">
                <Mail size={12} /> {car.responsable_pago_email}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Requerimientos y otras cláusulas — espejo del radar */}
      {oportunidad && (car?.subcontratacion !== undefined || car?.prohibicion_contratacion || car?.direccion_visita || car?.direccion_entrega) && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Requerimientos y otras cláusulas</h3>
          <div>
            <Row label="Prohibición de subcontratación"
              value={car?.prohibicion_contratacion ? 'No permite subcontratación'
                : car?.subcontratacion === true ? 'Permite subcontratación'
                : car?.subcontratacion === false ? 'No permite subcontratación' : null} />
            <Row label="Cláusula de subcontratación / cesión" value={car?.prohibicion_contratacion} />
            <Row label="Dirección de visita a terreno" value={car?.direccion_visita} />
            <Row label="Dirección de entrega"          value={car?.direccion_entrega} />
          </div>
        </div>
      )}

      {/* Responsable del contrato — espejo del radar */}
      {(oportunidad?.contacto?.nombre || oportunidad?.contacto?.email || oportunidad?.contacto?.telefono) && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Responsable del contrato</h3>
          <div>
            <Row label="Nombre" value={oportunidad?.contacto?.nombre} />
            <Row label="Cargo"  value={oportunidad?.contacto?.cargo} />
          </div>
          {oportunidad?.contacto?.email && (
            <div className="flex gap-3 py-2 border-t border-zinc-50 mt-1 pt-2.5">
              <span className="text-[12px] text-zinc-400 flex-shrink-0">Email</span>
              <a href={`mailto:${oportunidad.contacto.email}`}
                className="text-[12.5px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1">
                <Mail size={12} /> {oportunidad.contacto.email}
              </a>
            </div>
          )}
          {oportunidad?.contacto?.telefono && (
            <div className="flex gap-3 py-2">
              <span className="text-[12px] text-zinc-400 flex-shrink-0">Teléfono</span>
              <a href={`tel:${oportunidad.contacto.telefono}`}
                className="text-[12.5px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1">
                <Phone size={12} /> {oportunidad.contacto.telefono}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Presupuesto y plazos que Mercado Público NO informó, extraídos por la IA de las bases —
          información privilegiada: nunca se pierde, se muestra en ambas vistas (aquí y en
          /licitacion/[codigo]). */}
      {(presupuestoIA?.monto || plazoIA) && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <IABadge />
            <span className="text-[11px] text-zinc-400">Mercado Público no informó este dato; se extrajo automáticamente de las bases.</span>
          </div>
          <div>
            {presupuestoIA?.monto && (
              <Row label="Presupuesto estimado" value={fmt(presupuestoIA.monto) || `${presupuestoIA.monto} ${presupuestoIA.moneda || ''}`} />
            )}
            {plazoIA && <Row label="Plazo de ejecución" value={`${plazoIA} días`} />}
          </div>
        </div>
      )}

      {/* Análisis experto para el proveedor (IA) — espejo del radar */}
      {experto && (experto.puntosCriticos?.length || experto.oportunidades?.length || experto.riesgosDetectados?.length || experto.recomendaciones?.length) && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <IABadge />
            {experto.complejidad && (
              <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[11px] rounded-full font-medium">Complejidad: {experto.complejidad}</span>
            )}
            {experto.atractivo && (
              <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[11px] rounded-full font-medium">Atractivo: {experto.atractivo}</span>
            )}
          </div>
          <div className="space-y-4">
            {!!experto.puntosCriticos?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700 mb-2">
                  <AlertTriangle size={12} className="text-amber-500" /> Puntos críticos
                </p>
                <ul className="space-y-1.5">
                  {experto.puntosCriticos.map((p, i) => (
                    <li key={i} className="text-[12.5px] text-zinc-700 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-amber-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!experto.riesgosDetectados?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700 mb-2">
                  <AlertTriangle size={12} className="text-red-500" /> Riesgos detectados
                </p>
                <ul className="space-y-1.5">
                  {experto.riesgosDetectados.map((p, i) => (
                    <li key={i} className="text-[12.5px] text-zinc-700 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-red-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!experto.oportunidades?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700 mb-2">
                  <ThumbsUp size={12} className="text-emerald-500" /> Oportunidades
                </p>
                <ul className="space-y-1.5">
                  {experto.oportunidades.map((p, i) => (
                    <li key={i} className="text-[12.5px] text-zinc-700 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-emerald-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!experto.recomendaciones?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700 mb-2">
                  <ListChecks size={12} className="text-indigo-500" /> Recomendaciones
                </p>
                <ul className="space-y-1.5">
                  {experto.recomendaciones.map((p, i) => (
                    <li key={i} className="text-[12.5px] text-zinc-700 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-indigo-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Adjudicación — espejo del radar */}
      {(oportunidad?.url_acta || oportunidad?.numero_oferentes) && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Adjudicación</h3>
          <div className="space-y-2">
            {oportunidad?.numero_oferentes !== undefined && oportunidad.numero_oferentes > 0 && (
              <p className="text-[13px] text-zinc-700">
                <strong className="text-zinc-900">{oportunidad.numero_oferentes}</strong> proveedor{oportunidad.numero_oferentes !== 1 ? 'es' : ''} participaron
              </p>
            )}
            {oportunidad?.url_acta && (
              <a href={oportunidad.url_acta} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-[13px] text-indigo-600 hover:text-indigo-800 hover:underline">
                <ExternalLink size={13} /> Ver acta de adjudicación
              </a>
            )}
          </div>
        </div>
      )}

      {negocio.etiquetas.length > 0 && (
        <div className="bg-white border border-zinc-200/60 rounded-xl p-4">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-2.5">Líneas de negocio</h3>
          <div className="flex flex-wrap gap-1.5">
            {negocio.etiquetas.map(et => (
              <span
                key={et.id}
                style={{ backgroundColor: et.color + '18', color: et.color, borderColor: et.color + '50' }}
                className="text-[12px] font-bold px-3 py-1 rounded-full border"
              >
                {et.nombre}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sección Fechas (timeline) ──────────────────────────────────────────────────
// Ordena los hitos cronológicamente y marca en cuál vamos: las cumplidas quedan en
// verde con ✓, el próximo hito (el primero aún no vencido) se resalta con una animación
// para saber "de un vistazo" en qué etapa del proceso estamos.
function SeccionFechas({ licitacion }: { licitacion: LicitacionRaw | null }) {
  if (!licitacion) return <div className="text-[13px] text-zinc-400 py-8 text-center">Cargando datos de la API…</div>;

  const RAW = [
    { label: 'Publicación',              value: licitacion.FechaPublicacion },
    { label: 'Cierre',                   value: licitacion.FechaCierre },
    { label: 'Creación',                 value: licitacion.FechaCreacion },
    { label: 'Adjudicación',             value: licitacion.FechaAdjudicacion },
    { label: 'Inicio preguntas',         value: licitacion.FechaInicioPreguntas },
    { label: 'Fin preguntas',            value: licitacion.FechaFinPreguntas },
    { label: 'Pub. respuestas',          value: licitacion.FechaPublicacionRespuestas },
    { label: 'Apertura técnica',         value: licitacion.FechaAperturaTecnica },
    { label: 'Apertura económica',       value: licitacion.FechaAperturaEconomica },
    { label: 'Estimada adjudicación',    value: licitacion.FechaEstimadaAdjudicacion },
    { label: 'Visita terreno',           value: licitacion.FechaVisitaTerreno },
    { label: 'Entrega antecedentes',     value: licitacion.FechaEntregaAntecedentes },
  ].filter(f => f.value);

  // Parsear + ordenar cronológicamente (se descartan las que no parsean).
  const items = RAW
    .map(f => ({ ...f, t: new Date(f.value as string).getTime() }))
    .filter(f => !Number.isNaN(f.t))
    .sort((a, b) => a.t - b.t);

  const ahora = Date.now();
  // "Vamos aquí" = primer hito aún no cumplido (fecha >= ahora). -1 si todo ya pasó.
  const idxProxima = items.findIndex(f => f.t >= ahora);

  const fmtRel = (t: number) => {
    const d = Math.round((t - ahora) / 86_400_000);
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    if (d === -1) return 'ayer';
    return d > 0 ? `en ${d} días` : `hace ${-d} días`;
  };

  return (
    <div className="bg-white border border-zinc-200/60 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-100">
        <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider">
          Fechas ({items.length})
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-zinc-400 text-center">Sin fechas disponibles</p>
      ) : (
        <ol className="px-5 py-4">
          {items.map((f, i) => {
            const pasada  = f.t < ahora;
            const proxima = i === idxProxima;
            const ultimo  = i === items.length - 1;
            return (
              <li key={f.label} className="relative flex gap-3 pb-4 last:pb-0">
                {/* Línea conectora entre hitos */}
                {!ultimo && (
                  <span className={`absolute left-[7px] top-4 bottom-0 w-px ${pasada ? 'bg-emerald-200' : 'bg-zinc-200'}`} />
                )}
                {/* Punto del hito */}
                <span className="relative flex-shrink-0 mt-0.5">
                  {proxima && <span className="absolute -inset-1 rounded-full bg-violet-400/40 animate-ping" />}
                  <span className={`relative flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 ${
                    proxima ? 'bg-violet-600 border-violet-600'
                    : pasada ? 'bg-emerald-500 border-emerald-500'
                    : 'bg-white border-zinc-300'
                  }`}>
                    {pasada && <Check size={8} className="text-white" strokeWidth={3} />}
                  </span>
                </span>
                {/* Contenido */}
                <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-[13px] leading-tight ${
                      proxima ? 'font-bold text-violet-700' : pasada ? 'text-zinc-400' : 'font-medium text-zinc-700'
                    }`}>
                      {f.label}
                      {proxima && (
                        <span className="ml-2 inline-flex items-center text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full align-middle">
                          Vamos aquí · {fmtRel(f.t)}
                        </span>
                      )}
                    </p>
                    <p className={`text-[11.5px] mt-0.5 ${pasada ? 'text-zinc-300' : 'text-zinc-500'}`}>{fmtFecha(f.value)}</p>
                  </div>
                  {pasada && <span className="flex-shrink-0 text-[10px] font-semibold text-emerald-600">Cumplida</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ── Sección Ítems ──────────────────────────────────────────────────────────────
function SeccionItems({ licitacion, analisisIA }: { licitacion: LicitacionRaw | null; analisisIA?: AnalisisIA | null }) {
  const itemsMP  = licitacion?.Items || [];
  const itemsIA  = analisisIA?.especificacionesTecnicas ?? [];
  // Solo esperamos si NO hay nada que mostrar todavía (ni API ni IA).
  if (!licitacion && itemsIA.length === 0) {
    return <div className="text-[13px] text-zinc-400 py-8 text-center">Cargando datos…</div>;
  }
  const hayMP    = itemsMP.length > 0;
  const hayIA    = itemsIA.length > 0;
  const total    = itemsMP.length + (hayMP ? 0 : itemsIA.length); // si hay MP no sumamos IA al conteo de título

  return (
    <div className="space-y-3">
      {/* ── Ítems de Mercado Público (fuente oficial) ── */}
      <div className="bg-white border border-zinc-200/60 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider">
            Líneas y cantidades ({itemsMP.length})
          </h3>
          {hayMP && <span className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-full">Fuente: Mercado Público</span>}
        </div>
        {!hayMP ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Package size={24} className="text-zinc-300 mb-2" />
            <p className="text-[13px] text-zinc-400">Sin ítems en la API de Mercado Público</p>
            {hayIA && <p className="text-[12px] text-zinc-400 mt-1">Ver ítems extraídos de las bases más abajo</p>}
          </div>
        ) : (
          <div className="divide-y divide-zinc-50">
            {itemsMP.map((item, i) => (
              <div key={i} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-zinc-900 leading-snug">{item.NombreProducto}</p>
                    {item.Descripcion && <p className="text-[12px] text-zinc-500 mt-0.5">{item.Descripcion}</p>}
                    {item.CodigoProducto && <p className="text-[11px] text-zinc-400 mt-1 font-mono">Cód: {item.CodigoProducto}</p>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-[14px] font-bold text-zinc-800">{item.Cantidad}</p>
                    <p className="text-[11px] text-zinc-400">{item.Unidad || 'Unidad'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Ítems extraídos por IA (de documentos/bases) ── */}
      {hayIA && (
        <div className="bg-white border border-violet-200/60 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-violet-100 flex items-center justify-between">
            <h3 className="text-[12px] font-bold text-violet-500 uppercase tracking-wider">
              Ítems extraídos de las bases ({itemsIA.length})
            </h3>
            <span className="text-[10px] text-violet-500 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">Fuente: Análisis de documentos</span>
          </div>
          <TablaItems items={itemsIA} />
        </div>
      )}

      {/* ── Ninguno disponible ── */}
      {!hayMP && !hayIA && (
        <div className="bg-white border border-zinc-200/60 rounded-xl py-10 text-center">
          <Package size={24} className="text-zinc-300 mb-2 mx-auto" />
          <p className="text-[13px] text-zinc-400">Sin ítems disponibles</p>
          <p className="text-[12px] text-zinc-400 mt-1">Descarga y analiza los documentos para extraerlos</p>
        </div>
      )}
    </div>
  );
}

// ── Tabla de ítems / especificaciones técnicas ────────────────────────────────
type ItemEspec = {
  item: string;
  descripcion: string;
  cantidad?: number | null;
  unidad?: string | null;
  requisitosMinimos?: string | null;
};

function TablaItems({ items }: { items: ItemEspec[] }) {
  const [busqueda, setBusqueda] = useState('');
  const [expandido, setExpandido] = useState<number | null>(null);

  const filtrados = busqueda.trim()
    ? items.filter(it =>
        it.item.toLowerCase().includes(busqueda.toLowerCase()) ||
        it.descripcion.toLowerCase().includes(busqueda.toLowerCase())
      )
    : items;

  const conCantidad  = items.filter(it => it.cantidad != null).length;
  const sinCantidad  = items.length - conCantidad;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-teal-50 to-cyan-50 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-2">
          <Package size={13} className="text-teal-600" />
          <h3 className="text-[12px] font-bold text-slate-700 uppercase tracking-wider">
            Ítems / Especificaciones Técnicas
          </h3>
          <span className="ml-auto text-[11px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-bold">
            {items.length} ítems
          </span>
        </div>
        {/* Stats */}
        <div className="flex gap-3 mb-2">
          {conCantidad > 0 && (
            <span className="text-[10px] text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
              {conCantidad} con cantidad
            </span>
          )}
          {sinCantidad > 0 && (
            <span className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
              {sinCantidad} sin cantidad definida
            </span>
          )}
        </div>
        {/* Buscador — aparece si hay más de 8 ítems */}
        {items.length > 8 && (
          <div className="relative">
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder={`Buscar entre ${items.length} ítems...`}
              className="w-full text-[12px] px-3 py-1.5 pl-7 rounded-lg border border-teal-200 bg-white focus:outline-none focus:ring-1 focus:ring-teal-300"
            />
            <Hash size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            {busqueda && (
              <button
                onClick={() => setBusqueda('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabla */}
      {filtrados.length === 0 ? (
        <p className="text-[12px] text-slate-400 text-center py-6">Sin resultados para "{busqueda}"</p>
      ) : (
        <>
          {/* Cabecera de columnas */}
          <div className="grid grid-cols-[2rem_1fr_5rem] sm:grid-cols-[2rem_1fr_6rem_5rem] gap-0 px-4 py-1.5 bg-slate-50 border-b border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase">#</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase">Ítem / Descripción</span>
            <span className="hidden sm:block text-[10px] font-bold text-slate-400 uppercase text-right">Unidad</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase text-right">Cant.</span>
          </div>

          <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
            {filtrados.map((it, i) => {
              const idx      = items.indexOf(it);
              const abierto  = expandido === idx;
              const descCorta = it.descripcion.length > 80;

              return (
                <div
                  key={idx}
                  className={`px-4 py-2.5 hover:bg-slate-50/60 transition-colors ${abierto ? 'bg-teal-50/40' : ''}`}
                >
                  <div className="grid grid-cols-[2rem_1fr_5rem] sm:grid-cols-[2rem_1fr_6rem_5rem] gap-0 items-start">
                    {/* Número */}
                    <span className="text-[11px] font-mono text-slate-400 pt-0.5">{i + 1}</span>

                    {/* Nombre + descripción */}
                    <div className="min-w-0 pr-2">
                      <p className="text-[13px] font-semibold text-slate-800 leading-tight">{it.item}</p>
                      {it.descripcion && it.descripcion !== it.item && (
                        <div>
                          <p className={`text-[11px] text-slate-500 mt-0.5 leading-relaxed ${!abierto && descCorta ? 'line-clamp-2' : ''}`}>
                            {it.descripcion}
                          </p>
                          {descCorta && (
                            <button
                              onClick={() => setExpandido(abierto ? null : idx)}
                              className="text-[10px] text-teal-600 hover:text-teal-800 font-semibold mt-0.5"
                            >
                              {abierto ? '▲ menos' : '▼ ver más'}
                            </button>
                          )}
                        </div>
                      )}
                      {abierto && it.requisitosMinimos && (
                        <div className="mt-1.5 p-2 bg-amber-50 rounded-lg border border-amber-100">
                          <p className="text-[10px] font-bold text-amber-600 uppercase mb-0.5">Requisitos mínimos</p>
                          <p className="text-[11px] text-amber-800 leading-relaxed">{it.requisitosMinimos}</p>
                        </div>
                      )}
                    </div>

                    {/* Unidad */}
                    <span className="hidden sm:block text-[12px] text-slate-500 text-right pt-0.5">
                      {it.unidad ?? <span className="text-slate-300">—</span>}
                    </span>

                    {/* Cantidad */}
                    <div className="text-right pt-0.5">
                      {it.cantidad != null ? (
                        <span className="inline-block text-[13px] font-bold text-teal-700 bg-teal-50 border border-teal-100 px-1.5 py-0 rounded">
                          {it.cantidad.toLocaleString('es-CL')}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-300">s/d</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {busqueda && filtrados.length < items.length && (
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-center">
              <span className="text-[11px] text-slate-500">
                Mostrando {filtrados.length} de {items.length} ítems
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ── Sección Comentarios ────────────────────────────────────────────────────────
function SeccionComentarios({
  negocioId,
  onEstadoChanged,
}: {
  negocioId:       number;
  onEstadoChanged: (estadoId: string) => void;
}) {
  const { usuario } = useSession();
  const toast = useToast();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState('');
  const [pipelineSel, setPipelineSel] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/negocios/${negocioId}/comentarios`).then(r => r.json());
      if (d.success) setComentarios(d.comentarios || []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/negocios/${negocioId}/comentarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comentario:      texto.trim(),
          pipeline_estado: pipelineSel || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error('Error al enviar'); return; }
      setTexto('');
      if (data.nuevo_estado) {
        onEstadoChanged(data.nuevo_estado);
        const info = getEstadoPipeline(data.nuevo_estado);
        toast.success(`Estado actualizado: ${info?.label ?? data.nuevo_estado}`);
      }
      setPipelineSel(null);
      await cargar();
    } catch { toast.error('Error de conexión'); }
    finally { setEnviando(false); }
  };

  const eliminar = async (cid: number) => {
    await fetch(`/api/negocios/${negocioId}/comentarios?comentarioId=${cid}`, { method: 'DELETE' });
    setComentarios(prev => prev.filter(c => c.id !== cid));
  };

  return (
    <div className="bg-white border border-zinc-200/60 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2">
        <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider">Comentarios</h3>
        <span className="text-[11px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded-full font-bold">
          {comentarios.length}
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map(i => (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-zinc-200 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-zinc-100 rounded w-28" />
                  <div className="h-4 bg-zinc-100 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : comentarios.length === 0 ? (
          <p className="text-[13px] text-zinc-400 text-center py-5">Sé el primero en comentar</p>
        ) : (
          <div className="space-y-4">
            {comentarios.map(c => {
              const pipelineInfo = c.pipeline_estado ? getEstadoPipeline(c.pipeline_estado) : null;
              return (
                <div key={c.id} className="flex gap-3 group">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGrad(c.usuario_id)} flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0`}>
                    {iniciales(c.usuario_nombre, c.usuario_email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[13px] font-bold text-zinc-800">
                        {c.usuario_nombre || c.usuario_email.split('@')[0]}
                      </span>
                      {pipelineInfo && (
                        <span
                          style={{
                            backgroundColor: pipelineInfo.color + '18',
                            color:           pipelineInfo.color,
                            borderColor:     pipelineInfo.color + '50',
                          }}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-px rounded-full font-bold border"
                        >
                          <span
                            style={{ backgroundColor: pipelineInfo.color }}
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          />
                          {pipelineInfo.label}
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-400">{fmtFecha(c.created_at)}</span>
                    </div>
                    <p className="text-[13px] text-zinc-700 leading-relaxed">{c.comentario}</p>
                  </div>
                  {(c.usuario_id === usuario?.id || usuario?.rol === 'admin') && (
                    <button
                      onClick={() => eliminar(c.id)}
                      className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-zinc-300 hover:text-red-500 transition-all flex-shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={enviar} className="border-t border-zinc-100 pt-4 space-y-2.5">
          <div>
            <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Cambiar etapa al comentar
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPipelineSel(null)}
                className={`text-[11px] px-2.5 py-1 rounded-full border font-bold transition-all ${
                  pipelineSel === null
                    ? 'bg-zinc-800 text-white border-zinc-800'
                    : 'border-zinc-200 text-zinc-400 hover:border-zinc-400 hover:text-zinc-600'
                }`}
              >
                Sin cambio
              </button>
              {ESTADOS_PIPELINE.map(est => {
                const sel = pipelineSel === est.id;
                return (
                  <button
                    key={est.id}
                    type="button"
                    onClick={() => setPipelineSel(sel ? null : est.id)}
                    style={sel ? {
                      backgroundColor: est.color + '20',
                      color:           est.color,
                      borderColor:     est.color + '60',
                    } : {}}
                    className={`text-[11px] px-2.5 py-1 rounded-full border font-bold transition-all ${
                      sel ? '' : 'border-zinc-200 text-zinc-500 hover:border-zinc-400'
                    }`}
                  >
                    {sel && <span className="mr-1">✓</span>}
                    {est.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(e as any); } }}
              placeholder={pipelineSel
                ? `Comentario al pasar a "${getEstadoPipeline(pipelineSel)?.label}"…`
                : 'Agrega un comentario… (Enter para enviar)'
              }
              className="flex-1 px-3.5 py-2.5 border border-zinc-200 rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all"
            />
            <button
              type="submit"
              disabled={enviando || !texto.trim()}
              className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-200 text-white rounded-xl transition-colors"
            >
              {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
function DetalleContent() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const { usuario } = useSession();
  const toast    = useToast();
  const isAdmin  = usuario?.rol === 'admin';

  const [negocio, setNegocio]       = useState<Negocio | null>(null);
  const [licitacion, setLicitacion] = useState<LicitacionRaw | null>(null);
  const [oportunidad, setOportunidad] = useState<Oportunidad | null>(null);
  const [etiquetas, setEtiquetas]   = useState<Etiqueta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadingLic, setLoadingLic] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [seccion, setSeccion]       = useState<Seccion>('resumen');

  // Documentos
  const [documentos, setDocumentos]           = useState<DocumentoLocal[]>([]);
  const [loadingDocs, setLoadingDocs]         = useState(false);
  const [descargandoAuto, setDescargandoAuto] = useState(false);
  const [clasificando, setClasificando]       = useState(false);
  const [resumenClasificacion, setResumenClasificacion] = useState<{ estado: 'completo' | 'incompleto'; falta: string[] } | null>(null);
  const clasificacionDisparada = useRef(false);

  // Análisis IA
  const [analisisIA, setAnalisisIA]   = useState<AnalisisIA | null>(null);
  const [analisisCargado, setAnalisisCargado] = useState(false); // GET cacheado resuelto
  const analisisYaIntentado           = useRef(false);

  // Viabilidad IA (el corazón) — para enriquecer el resumen
  const [viabIA, setViabIA] = useState<any>(null);

  // ── Carga ─────────────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    try {
      const [negRes, etRes] = await Promise.all([
        fetch(`/api/negocios/${id}`),
        fetch('/api/etiquetas'),
      ]);
      const negData = await negRes.json();
      const etData  = await etRes.json();
      if (!negRes.ok) throw new Error(negData.error || 'No encontrado');
      setNegocio(negData.negocio);
      if (etData.success) setEtiquetas(etData.etiquetas || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  // Cargar datos completos de MP
  useEffect(() => {
    if (!negocio?.licitacion_codigo) return;
    setLoadingLic(true);
    fetch(`/api/licitacion-detalle/${encodeURIComponent(negocio.licitacion_codigo)}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.licitacion_raw) setLicitacion(d.licitacion_raw);
        if (d.success && d.licitacion) setOportunidad(d.licitacion);
      })
      .catch(() => { /* silencioso */ })
      .finally(() => setLoadingLic(false));
  }, [negocio?.licitacion_codigo]);

  // Cargar documentos desde el cache (incluye campo categoria)
  const fetchDocumentos = useCallback(async (codigo?: string) => {
    const cod = codigo || negocio?.licitacion_codigo;
    if (!cod) return;
    setLoadingDocs(true);
    try {
      const res = await fetch(`/api/documentos/cache/${encodeURIComponent(cod)}`);
      const data = await res.json();
      if (data.documentos) {
        setDocumentos(data.documentos.map((d: any) => ({
          nombre:    d.documento_nombre || d.nombre,
          url:       d.documento_url_local || d.url_local || d.url || '',
          url_local: d.documento_url_local || d.url_local || d.url,
          size:      d.size_bytes || d.size,
          categoria: d.categoria ?? undefined,
          subcategoria: d.subcategoria ?? undefined,
          ya_descargado: true,
        })));
      }
    } catch { /* silencioso */ }
    finally { setLoadingDocs(false); }
  }, [negocio?.licitacion_codigo]);

  useEffect(() => {
    if (negocio?.licitacion_codigo) fetchDocumentos(negocio.licitacion_codigo);
  }, [negocio?.licitacion_codigo]); // eslint-disable-line

  // Bitácora: qué SECCIÓN de la licitación revisó cada perfil (resumen, documentos, viabilidad,
  // criterios, ítems, fechas…). Se registra una vez por sección y día — el helper deduplica en
  // memoria y el servidor de nuevo por día, así que ir y volver entre pestañas no ensucia nada.
  useEffect(() => {
    const cod = negocio?.licitacion_codigo;
    if (cod) registrarVerSeccion(cod, seccion);
  }, [negocio?.licitacion_codigo, seccion]);

  // Cargar análisis IA cacheado
  const fetchAnalisisIA = useCallback(async (codigo?: string) => {
    const cod = codigo || negocio?.licitacion_codigo;
    if (!cod) return;
    try {
      const res = await fetch(`/api/licitacion-ia/${encodeURIComponent(cod)}`);
      const data = await res.json();
      if (data.success && data.analisis) setAnalisisIA(data.analisis);
    } catch { /* silencioso */ }
    finally { setAnalisisCargado(true); }
  }, [negocio?.licitacion_codigo]);

  useEffect(() => {
    if (negocio?.licitacion_codigo) fetchAnalisisIA(negocio.licitacion_codigo);
  }, [negocio?.licitacion_codigo]); // eslint-disable-line

  // Cargar el informe de viabilidad IA (para el bloque de resumen)
  useEffect(() => {
    const cod = negocio?.licitacion_codigo;
    if (!cod) return;
    fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(cod)}`)
      .then(r => r.json())
      .then(d => { if (d?.informeIA) setViabIA(d.informeIA); })
      .catch(() => { /* silencioso */ });
  }, [negocio?.licitacion_codigo]);

  // Clasificar documentos con Gemini
  const handleClasificar = useCallback(async () => {
    const cod = negocio?.licitacion_codigo;
    if (!cod) return;
    setClasificando(true);
    try {
      const res = await fetch('/api/documentos/clasificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: cod }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.resumen_licitacion) setResumenClasificacion(data.resumen_licitacion);
        fetchDocumentos(cod);
      }
    } catch { /* silencioso */ }
    finally { setClasificando(false); }
  }, [negocio?.licitacion_codigo, fetchDocumentos]);

  // Auto-clasificar cuando los docs cargan y ninguno tiene categoría
  useEffect(() => {
    if (loadingDocs) return;
    if (clasificacionDisparada.current) return;
    if (documentos.length === 0) return;
    if (documentos.some(d => d.categoria)) return;
    clasificacionDisparada.current = true;
    handleClasificar();
  }, [loadingDocs, documentos, handleClasificar]);

  // Negocios NO analiza: solo muestra el análisis que ya hizo el Radar (lectura cacheada).
  // Si no existe, simplemente no se muestra (no se dispara cómputo aquí).


  // ── Descarga automática — NO MODIFICAR LÓGICA ────────────────────────────────
  const handleAutoDescargar = useCallback(async () => {
    if (!negocio?.licitacion_codigo) return;
    setDescargandoAuto(true);
    try {
      const res = await fetch('/api/documentos/auto-descargar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licitacionCodigo: negocio.licitacion_codigo }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Error', data.error || 'No se pudo iniciar la descarga');
      } else {
        toast.success(data.message || 'Descarga iniciada');
        setTimeout(() => fetchDocumentos(negocio.licitacion_codigo), 3000);
      }
    } catch {
      toast.error('Error de red');
    } finally {
      setDescargandoAuto(false);
    }
  }, [negocio?.licitacion_codigo, fetchDocumentos, toast]);

  // ── Acciones ─────────────────────────────────────────────────────────────────
  const guardarMonto = async (monto: number) => {
    await fetch(`/api/negocios/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monto_ofertado: monto }),
    });
    setNegocio(prev => prev ? { ...prev, monto_ofertado: monto } : prev);
    toast.success('Monto guardado');
  };

  // Sincroniza estado_pipeline en pantalla tras un cambio hecho DESDE otro flujo (comentario con
  // cambio de etapa adjunto). El PATCH real ya lo hizo /api/negocios/[id]/comentarios.
  const sincronizarEstadoPipeline = (estadoId: string) =>
    setNegocio(prev => prev ? { ...prev, estado_pipeline: estadoId } : prev);

  // ── Loading / Error ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout breadcrumb={[{ label: 'Negocios', href: '/negocios' }, { label: '…' }]}>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      </AppLayout>
    );
  }

  if (error || !negocio) {
    return (
      <AppLayout breadcrumb={[{ label: 'Negocios', href: '/negocios' }, { label: 'Error' }]}>
        <div className="p-8">
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-[13px]">
            <AlertCircle size={14} /> {error || 'No encontrado'}
          </div>
        </div>
      </AppLayout>
    );
  }

  const tipo = getTipo(negocio.licitacion_codigo);
  const tipoColor = tipo ? (TIPO_COLORS[tipo] || '#6B7280') : null;
  // Ficha pública en MP. SIEMPRE por código (idlicitacion): el formato Details.aspx?qs= exige un
  // querystring encriptado y lleva a una página vacía. Deterministic desde el código → inmune a un
  // licitacion.Url viejo con el formato roto.
  const mpUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(negocio.licitacion_codigo)}`;

  // Negocios = vista breve para el usuario asignado. El análisis profundo (viabilidad,
  // IA de documentos) vive SOLO en el Radar (admin). Aquí solo brief + ítems + comentarios.
  const documentosAnalizables = documentos.filter(d => esUrlAnalizable(d.url_local || d.url));

  // Orden definido por el equipo (negocio, sin Postulación ni Asistente):
  // Resumen · Documentos · Viabilidad · Criterios · Ítems · Fechas · Preguntas · Comentarios.
  const NAV_SECTIONS = [
    { key: 'resumen',      label: 'Resumen',            count: null },
    { key: 'resultado',    label: 'Resultado',          count: null },
    { key: 'documentos',   label: 'Documentos',         count: documentos.length || null },
    { key: 'viabilidad',   label: 'Viabilidad',         count: null },
    { key: 'criterios',    label: 'Criterios',          count: analisisIA?.criteriosEvaluacion?.length || null },
    { key: 'items',        label: 'Líneas',              count: (analisisIA?.especificacionesTecnicas?.length || licitacion?.Items?.length || null) },
    { key: 'fechas',       label: 'Fechas',             count: licitacion ? Object.entries(licitacion).filter(([k,v]) => k.startsWith('Fecha') && v).length : null },
    { key: 'preguntas',    label: 'Preguntas',          count: null },
    { key: 'comentarios',  label: 'Comentarios',        count: null },
  ] as const;

  return (
    <AppLayout breadcrumb={[
      { label: 'Negocios', href: '/negocios' },
      { label: negocio.licitacion_codigo },
    ]}>
      <div className="flex h-full overflow-hidden">

        {/* ── LEFT NAV ───────────────────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col w-44 border-r border-zinc-200/80 bg-white flex-shrink-0 overflow-y-auto">
          <div className="px-3 pt-4 pb-3">
            <Link href="/negocios" className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900 transition-colors font-medium">
              <ArrowLeft size={13} /> Volver
            </Link>
          </div>

          <div className="px-3 pb-2">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-2 pb-1.5">
              El negocio
            </p>
            <nav className="space-y-0.5">
              {NAV_SECTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSeccion(s.key)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] transition-all ${
                    seccion === s.key
                      ? 'bg-indigo-50 text-indigo-700 font-bold'
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 font-medium'
                  }`}
                >
                  <span>{s.label}</span>
                  {s.count != null && s.count > 0 && (
                    <span className={`text-[10px] px-1.5 py-px rounded-full font-bold ${
                      seccion === s.key ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-400'
                    }`}>
                      {loadingLic ? '…' : s.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className={`p-5 sm:p-7 mx-auto w-full ${seccion === 'documentos' ? 'max-w-6xl' : 'max-w-3xl'}`}>
            {/* Header */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3 lg:hidden">
                <Link href="/negocios" className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-800">
                  <ArrowLeft size={12} /> Volver
                </Link>
              </div>

              <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider mb-1">
                Detalle Licitación · <span className="text-zinc-600 font-mono">{negocio.licitacion_codigo}</span>
              </p>

              <div className="flex items-start gap-2 flex-wrap mb-1.5">
                {tipo && (
                  <span
                    className="text-white text-[11px] font-black px-2 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: tipoColor! }}
                  >
                    {tipo}
                  </span>
                )}
                {negocio.licitacion_estado && (() => {
                  // Estado EFECTIVO de MP: si figura "Publicada" pero su cierre ya pasó → "Cerrada".
                  const cod = estadoEfectivoCodigo(negocio.licitacion_estado, negocio.licitacion_cierre);
                  const st = ESTADO_MP_STYLE[cod ?? -1] || { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
                  return (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold border"
                      style={{ backgroundColor: st.bg, color: st.color, borderColor: st.border }}>
                      {estadoEfectivoNombre(negocio.licitacion_estado, negocio.licitacion_cierre)}
                    </span>
                  );
                })()}
                {loadingLic && (
                  <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Cargando desde MP…
                  </span>
                )}
              </div>

              <h1 className="text-[18px] font-bold text-zinc-900 leading-snug">
                {negocio.licitacion_nombre || 'Sin nombre'}
              </h1>
              <p className="text-[12px] text-zinc-400 uppercase tracking-wide mt-0.5">
                {negocio.licitacion_organismo}
              </p>
            </div>

            {/* Mobile tabs */}
            <div className="flex gap-1 mb-5 lg:hidden overflow-x-auto pb-1">
              {NAV_SECTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSeccion(s.key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                    seccion === s.key
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {s.label}
                  {s.count != null && s.count > 0 && <span className="ml-1 opacity-60">{s.count}</span>}
                </button>
              ))}
            </div>

            {/* Sections */}
            {seccion === 'resumen' && (
              <SeccionResumen
                negocio={negocio}
                licitacion={licitacion}
                oportunidad={oportunidad}
                onMontoChange={guardarMonto}
                etiquetas={etiquetas}
                viabIA={viabIA}
                onIrViabilidad={() => setSeccion('viabilidad')}
                analisisIA={analisisIA}
              />
            )}
            {seccion === 'resultado' && (
              <ResultadoSection codigo={negocio.licitacion_codigo} mpUrl={mpUrl} />
            )}
            {seccion === 'criterios' && (
              <CriteriosSection
                criterios={oportunidad?.criterios_evaluacion}
                analisisIA={analisisIA as any}
                criteriosViabilidad={viabIA?.criterios_evaluacion?.criterios}
                analizandoIA={false}
                onIrAInteligencia={() => setSeccion('analisis')}
              />
            )}
            {seccion === 'fechas' && <SeccionFechas licitacion={licitacion} />}
            {seccion === 'items' && <SeccionItems licitacion={licitacion} analisisIA={analisisIA} />}
            {seccion === 'viabilidad' && <ViabilidadIAPanel codigo={negocio.licitacion_codigo} />}
            {seccion === 'documentos' && (
              <DocumentosSection
                codigoDecoded={negocio.licitacion_codigo}
                mpUrl={`https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${negocio.licitacion_codigo}`}
                documentosCache={documentos as any}
                cargandoDocs={loadingDocs}
                descargandoAuto={descargandoAuto}
                handleAutoDescargar={handleAutoDescargar}
                fetchDocumentos={fetchDocumentos}
                clasificando={clasificando}
                onReClasificar={handleClasificar}
                resumenClasificacion={resumenClasificacion}
              />
            )}
            {seccion === 'analisis' && (
              <InteligenciaSection codigo={negocio.licitacion_codigo} documentosAnalizables={documentosAnalizables as any} nombreLicitacion={negocio.licitacion_nombre || negocio.licitacion_codigo} />
            )}
            {seccion === 'preguntas' && (
              <PreguntasSection codigoDecoded={negocio.licitacion_codigo} mpUrl={mpUrl} />
            )}
            {seccion === 'comentarios' && (
              <SeccionComentarios
                negocioId={negocio.id}
                onEstadoChanged={sincronizarEstadoPipeline}
              />
            )}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR — componente compartido con /licitacion/[codigo] ──── */}
        <GestionAside
          negocio={negocio}
          onNegocioChange={patch => setNegocio(prev => prev ? { ...prev, ...patch } : prev)}
          viabIA={viabIA}
          isAdmin={isAdmin}
          fechaPublicacion={licitacion?.FechaPublicacion}
          documentosCount={documentos.length}
          mpUrl={mpUrl}
          onDocumentosRefrescar={() => fetchDocumentos(negocio.licitacion_codigo)}
          onEliminado={() => router.push('/negocios')}
          onIrAViabilidad={() => setSeccion('viabilidad')}
        />

      </div>
    </AppLayout>
  );
}

export default function DetalleNegocioPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    }>
      <DetalleContent />
    </Suspense>
  );
}
