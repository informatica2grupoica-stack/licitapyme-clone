'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppLayout }  from '@/app/components/AppLayout';
import { useToast }   from '@/app/components/ui/toast';
import { useSession } from '@/app/lib/session-context';
import { ESTADOS_PIPELINE, getEstadoPipeline } from '@/app/lib/pipeline';
import { ViabilidadIAPanel } from '@/app/licitacion/[codigo]/sections/ViabilidadIAPanel';
import { InteligenciaSection } from '@/app/licitacion/[codigo]/sections/InteligenciaSection';
import { DocumentosSection } from '@/app/licitacion/[codigo]/sections/DocumentosSection';
import { esUrlAnalizable } from '@/app/licitacion/[codigo]/utils';
import {
  ArrowLeft, Building2, Calendar, DollarSign, MapPin, Tag,
  MessageSquare, Send, Trash2, Loader2, AlertCircle, ExternalLink,
  FileText, Check, X, ChevronDown, Package, Hash,
  Edit3, Clock, Globe, Users,
  Download, Bot, Brain, RefreshCw, Eye, FolderOpen,
  Sparkles, BarChart3, BookOpen, AlertTriangle, ListChecks,
  TrendingUp, CheckCircle, Upload, ChevronRight, Files,
  ShieldAlert, DollarSign as DollarSignIcon, Award, Wrench,
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
  asignado_a:           number;
  usuario_nombre:       string;
  usuario_email:        string;
  admin_nombre:         string | null;
  etiquetas:            Etiqueta[];
  created_at:           string;
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

type Seccion = 'resumen' | 'viabilidad' | 'fechas' | 'items' | 'documentos' | 'analisis' | 'comentarios';

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

// ── Pipeline Selector ─────────────────────────────────────────────────────────
function PipelineSelector({
  current,
  onChange,
}: {
  current:  string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const estado = getEstadoPipeline(current);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border border-zinc-200 rounded-xl bg-white hover:border-zinc-300 transition-colors"
      >
        {estado
          ? <span className="text-[13px] font-bold" style={{ color: estado.color }}>{estado.label}</span>
          : <span className="text-[13px] text-zinc-400">Sin etapa</span>
        }
        <ChevronDown size={13} className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 overflow-hidden scale-in max-h-72 overflow-y-auto">
          {ESTADOS_PIPELINE.map(est => (
            <button
              key={est.id}
              onClick={() => { onChange(est.id); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-50 transition-colors ${
                current === est.id ? 'bg-zinc-50' : ''
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: est.color }}
              />
              <span className="text-[13px] font-semibold" style={{ color: est.color }}>
                {est.label}
              </span>
              {current === est.id && <Check size={12} className="ml-auto text-zinc-400" />}
            </button>
          ))}
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-zinc-50 border-t border-zinc-100 text-[13px] text-zinc-400"
          >
            Sin etiqueta
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sección Resumen ────────────────────────────────────────────────────────────
function SeccionResumen({
  negocio,
  licitacion,
  onMontoChange,
  etiquetas,
  viabIA,
  onIrViabilidad,
}: {
  negocio:       Negocio;
  licitacion:    LicitacionRaw | null;
  onMontoChange: (m: number) => void;
  etiquetas:     Etiqueta[];
  viabIA?:       any;
  onIrViabilidad?: () => void;
}) {
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

  return (
    <div className="space-y-4">
      {viabIA && (
        <div className="bg-white border border-violet-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[12px] font-bold text-violet-500 uppercase tracking-wider flex items-center gap-1.5"><Sparkles size={13} /> Viabilidad (IA)</h3>
            {onIrViabilidad && <button onClick={onIrViabilidad} className="text-[12px] text-violet-600 hover:underline flex items-center gap-0.5">Ver análisis completo <ChevronRight size={13} /></button>}
          </div>
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl ${sSemColor} flex flex-col items-center justify-center text-white flex-shrink-0`}>
              <span className="text-lg font-black leading-none">{sScore}</span>
              <span className="text-[9px] opacity-80">/100</span>
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-zinc-800">{sGanaLabel}{viabIA?.veredicto?.nivel ? ` · ${String(viabIA.veredicto.nivel).replace(/_/g, ' ')}` : ''}</p>
              {viabIA?.veredicto?.por_que && <p className="text-[12.5px] text-zinc-500 leading-snug line-clamp-2 mt-0.5">{viabIA.veredicto.por_que}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            <div className="bg-zinc-50 rounded-lg px-3 py-2"><p className="text-[10px] text-zinc-400 uppercase font-bold">Presupuesto</p><p className="text-[13px] font-bold text-emerald-700">{fmtCLP(viabIA?.presupuesto?.neto ?? viabIA?.presupuesto?.bruto)}</p></div>
            <div className="bg-zinc-50 rounded-lg px-3 py-2"><p className="text-[10px] text-zinc-400 uppercase font-bold">Modalidad</p><p className="text-[13px] font-semibold text-zinc-700">{String(viabIA?.modalidad?.tipo || '—').replace(/_/g, ' ')}</p></div>
            <div className="bg-zinc-50 rounded-lg px-3 py-2"><p className="text-[10px] text-zinc-400 uppercase font-bold">Líneas</p><p className="text-[13px] font-bold text-zinc-700">{viabIA?.manifiesto_productos?.length || '—'}</p></div>
          </div>
        </div>
      )}
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
        </dl>
      </div>

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

// ── Sección Fechas ─────────────────────────────────────────────────────────────
function SeccionFechas({ licitacion }: { licitacion: LicitacionRaw | null }) {
  if (!licitacion) return <div className="text-[13px] text-zinc-400 py-8 text-center">Cargando datos de la API…</div>;

  const FECHAS = [
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

  return (
    <div className="bg-white border border-zinc-200/60 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-100">
        <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider">
          Fechas ({FECHAS.length})
        </h3>
      </div>
      <div className="divide-y divide-zinc-50">
        {FECHAS.map(f => (
          <div key={f.label} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2 text-[13px] text-zinc-600">
              <Calendar size={13} className="text-zinc-400 flex-shrink-0" />
              {f.label}
            </div>
            <span className="text-[13px] font-semibold text-zinc-800">{fmtFecha(f.value)}</span>
          </div>
        ))}
        {FECHAS.length === 0 && (
          <p className="px-5 py-6 text-[13px] text-zinc-400 text-center">Sin fechas disponibles</p>
        )}
      </div>
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
            Ítems y cantidades ({itemsMP.length})
          </h3>
          {hayMP && <span className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-full">Fuente: Mercado Público</span>}
        </div>
        {!hayMP ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Package size={24} className="text-zinc-300 mb-2" />
            <p className="text-[13px] text-zinc-400">Sin ítems en la API de Mercado Público</p>
            {hayIA && <p className="text-[12px] text-zinc-400 mt-1">Ver ítems extraídos por IA más abajo</p>}
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
              Ítems extraídos por IA ({itemsIA.length})
            </h3>
            <span className="text-[10px] text-violet-500 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">Fuente: Análisis IA</span>
          </div>
          <TablaItems items={itemsIA} />
        </div>
      )}

      {/* ── Ninguno disponible ── */}
      {!hayMP && !hayIA && (
        <div className="bg-white border border-zinc-200/60 rounded-xl py-10 text-center">
          <Package size={24} className="text-zinc-300 mb-2 mx-auto" />
          <p className="text-[13px] text-zinc-400">Sin ítems disponibles</p>
          <p className="text-[12px] text-zinc-400 mt-1">Descarga y analiza los documentos con IA para extraerlos</p>
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
      .then(d => { if (d.success && d.licitacion_raw) setLicitacion(d.licitacion_raw); })
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
          ya_descargado: true,
        })));
      }
    } catch { /* silencioso */ }
    finally { setLoadingDocs(false); }
  }, [negocio?.licitacion_codigo]);

  useEffect(() => {
    if (negocio?.licitacion_codigo) fetchDocumentos(negocio.licitacion_codigo);
  }, [negocio?.licitacion_codigo]); // eslint-disable-line

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
  const cambiarEstado = async (estadoId: string) => {
    if (!negocio) return;
    const estadoAnterior = negocio.estado_pipeline;
    setNegocio(prev => prev ? { ...prev, estado_pipeline: estadoId || null } : prev);
    try {
      const res = await fetch(`/api/negocios/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: estadoId || null }),
      });
      const data = await res.json();
      if (data.migration_needed) {
        toast.error('Falta ejecutar migration-4-pipeline.sql en Bluehost phpMyAdmin');
        setNegocio(prev => prev ? { ...prev, estado_pipeline: estadoAnterior } : prev);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Error');
      const estadoInfo = estadoId ? getEstadoPipeline(estadoId) : null;
      toast.success(estadoInfo ? `Etapa: ${estadoInfo.label}` : 'Etapa removida');
    } catch (e: any) {
      setNegocio(prev => prev ? { ...prev, estado_pipeline: estadoAnterior } : prev);
      toast.error('Error al actualizar etapa', e?.message);
    }
  };

  const guardarMonto = async (monto: number) => {
    await fetch(`/api/negocios/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monto_ofertado: monto }),
    });
    setNegocio(prev => prev ? { ...prev, monto_ofertado: monto } : prev);
    toast.success('Monto guardado');
  };

  const eliminar = async () => {
    if (!confirm('¿Quitar esta licitación de Negocios?')) return;
    await fetch(`/api/negocios/${id}`, { method: 'DELETE' });
    toast.info('Licitación removida');
    router.push('/negocios');
  };

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
  const mpUrl = licitacion?.Url || `https://www.mercadopublico.cl/Procurement/Modules/RFB/Details.aspx?qs=${negocio.licitacion_codigo}`;

  // Negocios = vista breve para el usuario asignado. El análisis profundo (viabilidad,
  // IA de documentos) vive SOLO en el Radar (admin). Aquí solo brief + ítems + comentarios.
  const documentosAnalizables = documentos.filter(d => esUrlAnalizable(d.url_local || d.url));

  const NAV_SECTIONS = [
    { key: 'resumen',      label: 'Resumen',           count: null },
    { key: 'viabilidad',   label: 'Viabilidad (IA)',   count: null },
    { key: 'items',        label: 'Ítems y Cantidades', count: (analisisIA?.especificacionesTecnicas?.length || licitacion?.Items?.length || null) },
    { key: 'documentos',   label: 'Documentos',        count: documentos.length || null },
    { key: 'analisis',     label: 'Chatbot',           count: null },
    { key: 'fechas',       label: 'Fechas',            count: licitacion ? Object.entries(licitacion).filter(([k,v]) => k.startsWith('Fecha') && v).length : null },
    { key: 'comentarios',  label: 'Comentarios',       count: null },
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
          <div className="p-5 sm:p-7 max-w-3xl">
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
                {negocio.licitacion_estado && (
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold border"
                    style={{ backgroundColor: '#dcfce7', color: '#15803d', borderColor: '#bbf7d0' }}>
                    {negocio.licitacion_estado}
                  </span>
                )}
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
                onMontoChange={guardarMonto}
                etiquetas={etiquetas}
                viabIA={viabIA}
                onIrViabilidad={() => setSeccion('viabilidad')}
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
              <InteligenciaSection documentosAnalizables={documentosAnalizables as any} nombreLicitacion={negocio.licitacion_nombre || negocio.licitacion_codigo} />
            )}
            {seccion === 'comentarios' && (
              <SeccionComentarios
                negocioId={negocio.id}
                onEstadoChanged={cambiarEstado}
              />
            )}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ──────────────────────────────────────────────── */}
        <aside className="hidden xl:flex flex-col w-56 border-l border-zinc-200/80 bg-white flex-shrink-0 overflow-y-auto p-4 gap-5">

          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Estado</p>
            <PipelineSelector current={negocio.estado_pipeline} onChange={cambiarEstado} />
          </div>

          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Responsable</p>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarGrad(negocio.asignado_a)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
                {iniciales(negocio.usuario_nombre, negocio.usuario_email)}
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-zinc-800 truncate">
                  {negocio.usuario_nombre || negocio.usuario_email.split('@')[0]}
                </p>
                <p className="text-[11px] text-zinc-400 truncate">{negocio.usuario_email}</p>
              </div>
            </div>
          </div>

          {negocio.etiquetas.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Líneas de negocio</p>
              <div className="flex flex-col gap-1">
                {negocio.etiquetas.map(et => (
                  <span
                    key={et.id}
                    style={{ backgroundColor: et.color + '18', color: et.color, borderColor: et.color + '50' }}
                    className="text-[11.5px] font-bold px-2.5 py-1 rounded-lg border w-fit"
                  >
                    {et.nombre}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Publicación</p>
            <p className="text-[12px] text-zinc-600 font-medium">
              {fmtFecha(licitacion?.FechaPublicacion || negocio.created_at)}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Cierre</p>
            <p className="text-[12px] text-zinc-600 font-medium">
              {fmtFecha(negocio.licitacion_cierre)}
            </p>
          </div>

          {/* Documentos quick-info (solo informativo — el análisis vive en el Radar) */}
          {documentos.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Documentos</p>
              <span className="flex items-center gap-2 text-[12px] text-zinc-600 font-semibold">
                <FolderOpen size={12} /> {documentos.length} archivo{documentos.length > 1 ? 's' : ''}
              </span>
            </div>
          )}

          <div className="mt-auto pt-4 border-t border-zinc-100 space-y-2">
            <a
              href={mpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 w-full px-3 py-2 border border-zinc-200 text-zinc-600 text-[12.5px] font-semibold rounded-xl hover:bg-zinc-50 transition-colors"
            >
              <ExternalLink size={13} /> Ver en Mercado Público
            </a>
            {isAdmin && (
              <button
                onClick={eliminar}
                className="flex items-center gap-2 w-full px-3 py-2 text-red-500 text-[12.5px] font-semibold rounded-xl hover:bg-red-50 transition-colors"
              >
                <Trash2 size={13} /> Quitar de Negocios
              </button>
            )}
          </div>
        </aside>

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
