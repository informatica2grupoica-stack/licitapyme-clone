// app/licitacion/[codigo]/utils.tsx
// Helpers y componentes compartidos entre las secciones de la ficha de licitación.
import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, XCircle, AlertCircle, Info, Sparkles } from 'lucide-react';

// ======================================================
// ANÁLISIS IA (Gemini) — campos extraídos automáticamente de las bases
// ======================================================

export interface AnalisisIA {
  presupuesto: { monto: number; moneda: string } | null;
  plazoEjecucionDias: number | null;
  plazoEntregaDias?: number | null;
  modalidadAdjudicacion?: string | null;
  tipoContrato?: string | null;
  lugarEntrega?: string | null;
  criteriosEvaluacion: Array<{ nombre: string; ponderacion: number; tipo?: string; descripcion?: string }>;
  especificacionesTecnicas?: Array<{ item?: string; descripcion?: string; cantidad?: number | null; unidad?: string | null; requisitosMinimos?: string | null }>;
  documentosAPresenter?: string[];
  requisitos: {
    administrativos?: string[];
    tecnicos?: string[];
    economicos?: string[];
    habilitantes?: string[];
    prohibiciones?: string[];
  } | null;
  garantias: Array<{ tipo: string; porcentaje?: number; montoFijo?: number; momento?: string; devolucion?: string }>;
  multas: Array<{ concepto: string; valor: string; unidad?: string }>;
  contacto?: { nombre?: string | null; cargo?: string | null; email?: string | null; telefono?: string | null } | null;
  resumenBasesAdmin?: {
    objeto?: string | null;
    plazo_contrato?: string | null;
    modalidad_pago?: string | null;
    forma_pago?: string | null;
    garantias_exigidas?: string[];
    causales_rechazo?: string[];
    cronograma?: Array<{ etapa: string; fecha: string }>;
    condiciones_contrato?: string[];
    penalidades_resumen?: string | null;
  } | null;
  resumenBasesTecnicas?: {
    descripcion_general?: string | null;
    alcance?: string | null;
    entregables?: string[];
    estandares_calidad?: string[];
    condiciones_entrega?: string | null;
    requisitos_tecnicos_oferente?: string[];
    lugar_ejecucion?: string | null;
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
  // Detalle por documento: cuáles se analizaron y cuáles quedaron pendientes (y por qué).
  documentosDetalle?: Array<{ nombre: string; analizado: boolean; motivo: string; metodo: string | null; chars: number }> | null;
  modelo: string | null;
  actualizado: string;
}

export function IABadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-600 border border-purple-200 text-xs rounded-full font-medium">
      <Sparkles size={10} /> Extraído por IA
    </span>
  );
}

// ======================================================
// FORMATEO
// ======================================================

export function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return null; }
}

export function formatDateTime(d?: string | null) {
  if (!d) return null;
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return null; }
}

export function formatCLP(n?: number | null) {
  if (!n || n === 0) return null;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

export function formatFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDiasRestantes(fechaCierre?: string | null) {
  if (!fechaCierre) return null;
  const diff = new Date(fechaCierre).getTime() - Date.now();
  if (isNaN(diff)) return null;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getFileIcon(nombre: string) {
  const ext = nombre.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    pdf: '📄', zip: '📦', rar: '📦', doc: '📝', docx: '📝',
    xls: '📊', xlsx: '📊', png: '🖼', jpg: '🖼', dwg: '📐',
  };
  return icons[ext || ''] || '📎';
}

export function esUrlAnalizable(url?: string) {
  if (!url) return false;
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext) && url.startsWith('https://');
}

export function formatNegritas(texto: string) {
  return texto.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// ======================================================
// RESPUESTA FORMATEADA (render de respuestas del chat IA)
// Compartido por InteligenciaSection (corpus completo) y DocumentoIAModal (un doc).
// ======================================================

export function RespuestaFormateada({ texto }: { texto: string }) {
  const lineas = texto.split('\n');
  return (
    <div className="space-y-1.5 text-sm text-gray-800 leading-relaxed">
      {lineas.map((linea, i) => {
        if (!linea.trim()) return <div key={i} className="h-1" />;
        if (linea.trim().startsWith('- ') || linea.trim().startsWith('• ')) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-purple-400 mt-0.5 flex-shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: formatNegritas(linea.replace(/^[\-•]\s*/, '')) }} />
            </div>
          );
        }
        if (/^\d+\.\s/.test(linea.trim())) {
          const num = linea.match(/^(\d+)\./)?.[1];
          return (
            <div key={i} className="flex gap-2">
              <span className="text-purple-600 font-semibold min-w-[1.2rem] flex-shrink-0">{num}.</span>
              <span dangerouslySetInnerHTML={{ __html: formatNegritas(linea.replace(/^\d+\.\s*/, '')) }} />
            </div>
          );
        }
        if (linea.trim().startsWith('**') && linea.trim().endsWith('**')) {
          return <p key={i} className="font-semibold text-gray-900 mt-2" dangerouslySetInnerHTML={{ __html: formatNegritas(linea) }} />;
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: formatNegritas(linea) }} />;
      })}
    </div>
  );
}

// ======================================================
// ESTADO CONFIG  (key = lic.Estado = string del CodigoEstado)
// ======================================================

export const ESTADO_CONFIG: Record<string, { label: string; icon: React.ReactNode; badge: string }> = {
  '5':  { label: 'Publicada',   icon: <CheckCircle size={13} />, badge: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  '6':  { label: 'Cerrada',     icon: <XCircle     size={13} />, badge: 'bg-zinc-100 border-zinc-300 text-zinc-600' },
  '7':  { label: 'Desierta',    icon: <AlertCircle size={13} />, badge: 'bg-orange-50 border-orange-200 text-orange-700' },
  '8':  { label: 'Adjudicada',  icon: <CheckCircle size={13} />, badge: 'bg-blue-50 border-blue-200 text-blue-700' },
  '18': { label: 'Revocada',    icon: <XCircle     size={13} />, badge: 'bg-red-50 border-red-200 text-red-700' },
  '19': { label: 'Suspendida',  icon: <AlertCircle size={13} />, badge: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
};

export function estadoConfigFor(estado: string) {
  return ESTADO_CONFIG[estado] || {
    label: estado,
    icon: <Info size={13} />,
    badge: 'bg-zinc-100 border-zinc-200 text-zinc-600',
  };
}

// ======================================================
// LAYOUT HELPERS
// ======================================================

export function InfoCard({ title, icon, children, defaultOpen = true }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden card-hover">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3.5 border-b border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-indigo-500">{icon}</span>
          <h3 className="text-[13.5px] font-semibold text-slate-800">{title}</h3>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-[11.5px] text-slate-400 w-40 flex-shrink-0 pt-0.5 font-medium">{label}</span>
      <span className="text-[13px] text-slate-800 flex-1">{String(value)}</span>
    </div>
  );
}

// ======================================================
// ALERTAS
// ======================================================

const ALERT_STYLES: Record<'info' | 'warning' | 'danger' | 'success', { bg: string; icon: React.ReactNode }> = {
  info:    { bg: 'bg-blue-50 border-blue-200 text-blue-800',       icon: <Info size={16} className="text-blue-500" /> },
  warning: { bg: 'bg-amber-50 border-amber-200 text-amber-800',    icon: <AlertCircle size={16} className="text-amber-500" /> },
  danger:  { bg: 'bg-red-50 border-red-200 text-red-800',          icon: <AlertCircle size={16} className="text-red-500" /> },
  success: { bg: 'bg-emerald-50 border-emerald-200 text-emerald-800', icon: <CheckCircle size={16} className="text-emerald-500" /> },
};

// ======================================================
// ENCABEZADO DE SECCIÓN (sinergia visual con SectionNav)
// ======================================================

export function SectionHeader({ icon, title, subtitle, badge, action }: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap sm:flex-nowrap fade-in">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
            {badge}
          </div>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export function AlertBanner({ tipo = 'info', titulo, children, pulse = false }: {
  tipo?: 'info' | 'warning' | 'danger' | 'success';
  titulo?: string;
  children: React.ReactNode;
  pulse?: boolean;
}) {
  const style = ALERT_STYLES[tipo];
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm slide-in-up ${style.bg} ${pulse ? 'animate-pulse' : ''}`}>
      <span className="flex-shrink-0 mt-0.5">{style.icon}</span>
      <div className="flex-1 min-w-0">
        {titulo && <p className="font-semibold mb-0.5">{titulo}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
