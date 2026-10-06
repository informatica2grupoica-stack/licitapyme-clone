'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppLayout }  from '@/app/components/AppLayout';
import { useToast }   from '@/app/components/ui/toast';
import { useSession } from '@/app/lib/session-context';
import { getEstadoPipeline, esGanado, tieneResultado } from '@/app/lib/pipeline';
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
import { ComentariosSection } from '@/app/licitacion/[codigo]/sections/ComentariosSection';
import { esUrlAnalizable } from '@/app/licitacion/[codigo]/utils';
import { Oportunidad } from '@/app/types/search.types';
import { ResumenNegocio } from './ResumenNegocio';
import { FechasNegocio } from './FechasNegocio';
import { GestionAside } from './GestionAside';
import { MenuNegocioLateral, construirNavSeccionesNegocio, useFlujoNegocio, SeccionTabs } from '@/app/components/MenuNegocioLateral';
import OfertasCompetencia from '@/app/components/OfertasCompetencia';
import { InformacionComercialSection } from './InformacionComercialSection';
import { useCosteoFlotante } from '@/app/components/CosteoFlotanteContext';
import { AuditorOpcionesPanel } from './AuditorOpcionesPanel';
import { PrePostulacionPanel } from './PrePostulacionPanel';
import { EmpresaPostulacionCard } from './EmpresaPostulacionCard';
import { PostulacionPanel } from './PostulacionPanel';
import { ResumenAuditorPanel } from './ResumenAuditorPanel';
import { SelectorLineasOferta } from './SelectorLineasOferta';
import { tieneInformacionComercial } from '@/app/lib/checklist-comercial';
import { registrarVerSeccion } from '@/app/lib/actividad-cliente';
import { IconArrowLeft as ArrowLeft, IconCalendar as Calendar, IconCurrencyDollar as DollarSign, IconTag as Tag, IconLoader2 as Loader2, IconAlertCircle as AlertCircle, IconFileText as FileText, IconX as X, IconPackage as Package, IconHash as Hash, IconClock as Clock, IconDownload as Download, IconRobot as Bot, IconBrain as Brain, IconRefresh as RefreshCw, IconChartBar as BarChart3, IconBook2 as BookOpen, IconTrendingUp as TrendingUp, IconCircleCheck as CheckCircle, IconUpload as Upload, IconFiles as Files, IconShieldExclamation as ShieldAlert, IconAward as Award, IconTool as Wrench, IconShoppingCart as ShoppingCart, IconArrowUpRight as ArrowUpRight } from '@tabler/icons-react';

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

interface DocumentoLocal {
  nombre: string;
  url: string;
  url_local?: string;
  size?: number;
  ya_descargado?: boolean;
  fecha?: string;
  categoria?: string;
  subcategoria?: string;
  origen_manual?: boolean;
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

type Seccion = 'resumen' | 'resultado' | 'viabilidad' | 'criterios' | 'fechas' | 'items' | 'documentos' | 'analisis' | 'preguntas' | 'competencia' | 'comentarios' | 'costeo' | 'comercial' | 'auditor_compra' | 'prepostulacion' | 'postulacion' | 'resumen_auditor' | 'auditor_anexos' | 'compras';

// ── Helpers ────────────────────────────────────────────────────────────────────
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


// ── Página principal ───────────────────────────────────────────────────────────
function DetalleContent() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const searchParams = useSearchParams();
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
  // La bandeja de aprobación transversal (/aprobaciones) deep-linkea acá con ?seccion=comercial
  // para llevar directo a la pestaña Auditor Técnico. Cualquier valor fuera del catálogo cae al
  // default en vez de dejar la pantalla en un estado inválido.
  const SECCIONES_VALIDAS = new Set<Seccion>(['resumen', 'resultado', 'viabilidad', 'criterios', 'fechas', 'items', 'documentos', 'analisis', 'preguntas', 'competencia', 'comentarios', 'costeo', 'comercial', 'auditor_compra', 'prepostulacion', 'postulacion', 'resumen_auditor', 'auditor_anexos', 'compras']);
  const flot = useCosteoFlotante();
  const seccionInicial = searchParams.get('seccion') as Seccion | null;
  const [seccion, setSeccion]       = useState<Seccion>(seccionInicial && seccionInicial !== 'compras' && SECCIONES_VALIDAS.has(seccionInicial) ? seccionInicial : 'resumen');

  // Compras dejó de ser una pestaña de la licitación (es su propio módulo, spec §1.4: el módulo
  // arranca donde termina la postulación). Los links viejos con ?seccion=compras se redirigen ahí.
  useEffect(() => {
    if (seccionInicial === 'compras' && negocio?.id) router.replace(`/compras/${negocio.id}`);
  }, [seccionInicial, negocio?.id, router]);

  // Resultado/Competencia/Preguntas se ocultan del menú hasta que hay resultado (ver
  // tieneResultado): si un link viejo (o un cambio de estado en vivo) deja la pantalla parada en
  // una de esas pestañas sin que ya corresponda, se vuelve a Resumen en vez de quedar en blanco.
  // El costeo ya no es pestaña: un link viejo ?seccion=costeo abre el Auditor y la burbuja del costeo.
  useEffect(() => {
    if (seccion !== 'costeo' || !negocio) return;
    setSeccion('comercial');
    flot.abrir(negocio.id, negocio.licitacion_codigo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccion, negocio?.id]);

  useEffect(() => {
    if (!negocio) return;
    const gated = seccion === 'resultado' || seccion === 'competencia' || seccion === 'preguntas';
    if (gated && !tieneResultado(negocio.estado_pipeline)) setSeccion('resumen');
  }, [negocio, seccion]);

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

  // Información Comercial — solo el contador para el menú (la sección carga lo suyo).
  const [comercialPorAprobar, setComercialPorAprobar] = useState<number>(0);

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
          id:        d.id,
          nombre:    d.documento_nombre || d.nombre,
          url:       d.documento_url_local || d.url_local || d.url || '',
          url_local: d.documento_url_local || d.url_local || d.url,
          size:      d.size_bytes || d.size,
          categoria: d.categoria ?? undefined,
          subcategoria: d.subcategoria ?? undefined,
          origen_manual: !!d.origen_manual,
          generado_separar: !!d.generado_separar,
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

  // Cargar el informe de viabilidad IA (para el bloque de resumen y el gate de "En proceso").
  // fetchViabIA se re-expone como onComplete al panel de Viabilidad: si no se refresca ahí,
  // terminar un (re)análisis dentro de esta misma sesión deja viabIA con el valor viejo (null en
  // la primera vez) y el botón "En proceso" queda bloqueado aunque el informe YA esté guardado —
  // solo se destrababa recargando la página (que sí vuelve a correr este efecto desde cero).
  const fetchViabIA = useCallback(async () => {
    const cod = negocio?.licitacion_codigo;
    if (!cod) return;
    try {
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(cod)}`);
      const d = await r.json();
      if (d?.informeIA) setViabIA(d.informeIA);
    } catch { /* silencioso */ }
  }, [negocio?.licitacion_codigo]);
  useEffect(() => { fetchViabIA(); }, [fetchViabIA]);
  // Un (re)análisis puede terminar con el panel de Viabilidad desmontado (u otra pestaña/usuario):
  // al entrar a Resumen/Criterios se vuelve a leer el informe para mostrar siempre los criterios actuales.
  useEffect(() => {
    if (seccion === 'criterios' || seccion === 'resumen') fetchViabIA();
  }, [seccion, fetchViabIA]);

  // Contador del menú: cuántos puntos comerciales esperan visto bueno. Solo se pide cuando
  // la etapa lo amerita, para no generar el checklist en licitaciones que aún están en análisis.
  // Se consulta para quien trabaje el Auditor (admin, Técnico o de Compra) — 05-oct-2026, antes solo admin.
  const veAuditor = isAdmin || !!usuario?.permisos?.auditor_tecnico || !!usuario?.permisos?.auditor_compra;
  useEffect(() => {
    if (!veAuditor || !negocio?.id || !tieneInformacionComercial(negocio.estado_pipeline)) { setComercialPorAprobar(0); return; }
    fetch(`/api/negocios/${negocio.id}/comercial`)
      .then(r => r.json())
      .then(d => setComercialPorAprobar(Number(d?.resumen?.porAprobar) || 0))
      .catch(() => { /* silencioso */ });
  }, [veAuditor, negocio?.id, negocio?.estado_pipeline]);

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

  // Costeo y Auditor Técnico eran 100% admin-only "mientras se seguía trabajando" (24-jul-2026).
  // 28-sep-2026, pedido explícito: en vez de abrirlos a todos, cada uno se habilita por separado a
  // un asistente puntual con su propio permiso (otorgado desde /admin/usuarios) — mismo patrón que
  // `hayCompras` más abajo. El resto del flujo (subir docs, avanzar de etapa, postular) no depende
  // de esto en ningún punto, así que restringirlos no bloquea nada más.
  //
  // Este bloque va ANTES del guard de loading/error (aunque `negocio` pueda ser null acá) porque
  // useFlujoNegocio es un hook: llamarlo después de un `return` condicional violaría las reglas de
  // hooks (se llamarían menos hooks mientras carga que una vez cargado el negocio).
  const infoComercialLista = tieneInformacionComercial(negocio?.estado_pipeline);
  const hayCosteo = (isAdmin || !!usuario?.permisos?.costeo_editor) && infoComercialLista;
  const hayAuditorTecnico = (isAdmin || !!usuario?.permisos?.auditor_tecnico) && infoComercialLista;
  // "Compras" solo aparece cuando el negocio ganó (Módulo de Compras, spec §3.1: "solo las líneas
  // efectivamente adjudicadas") y para quien puede operarlo: jefe de ventas (aprobar_comercial),
  // un Encargado de Compras (permiso compras), o `compras_todo` real — "ser admin" YA NO alcanza
  // solo (pedido explícito, 10-sep-2026, ver ComprasSection.tsx/AppLayout.tsx). El propio encargado
  // asignado a ESTE negocio entra igual aunque no tenga ninguno de estos (lo resuelve la API).
  const hayGanado   = esGanado(negocio?.estado_pipeline);
  const hayCompras  = hayGanado && (!!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial);
  // Auditor de Compra es un ítem DISTINTO de Auditor Técnico (pedido explícito, 28-sep-2026: "son
  // distintos, que no estén juntos"), pero activo en todo momento igual que él (pedido explícito,
  // 29-sep-2026: "eso no se debe de activar [recién al ganar]... se activa en todo momento al igual
  // que el auditor técnico" — más adelante se verá si se lo condiciona a algún estado puntual).
  const puedeVerAuditorCompra = (isAdmin || !!usuario?.permisos?.auditor_compra) && infoComercialLista;
  const hayAuditorCompra = puedeVerAuditorCompra;
  // PRE-POSTULACIÓN (30-sep-2026, reemplaza a ANEXOS): certificado de admisibilidad + bloque técnico-administrativo sobre las opciones aprobadas del Auditor.
  // Pre-postulación reemplaza a Anexos (1-oct-2026): siempre visible, sin esperar a la etapa «ANEXOS» del pipeline.
  const hayPrePostulacion = hayAuditorCompra || hayAuditorTecnico;
  // Resultado/Competencia/Preguntas quedan ocultas hasta que el negocio pase a Ganada o Perdida
  // (antes de eso no hay nada real que mostrar ahí). Fechas, Criterios y Comentarios ya no son
  // ítems propios del menú: son pestañas DENTRO de "Resumen" (ver más abajo, sección de render).
  const hayResultado = tieneResultado(negocio?.estado_pipeline);
  const NAV_SECTIONS = construirNavSeccionesNegocio({
    documentosCount: documentos.length,
    hayResultado,
    itemsCount: analisisIA?.especificacionesTecnicas?.length || licitacion?.Items?.length,
    hayCosteo,
    hayAuditorTecnico,
    auditorCount: comercialPorAprobar,
    auditorAlerta: comercialPorAprobar > 0,
    hayGanado,
    puedeVerAuditorCompra,
    hayPostulacion: isAdmin && hayPrePostulacion, // Postulación: solo admin (05-oct-2026, pedido explícito)
  });
  // El sidebar solo tiene "resumen"/"resultado" como ítems clickeables cuyo grupo incluye otras
  // pestañas: Fechas/Criterios/Comentarios y Competencia son pestañas internas de Resumen/Resultado.
  // Auditor Técnico y Auditor de Compra son ítems propios (no agrupados).
  // Pestaña activa dentro del ítem "Auditor": si solo tiene permiso de Compra, cae ahí aunque la
  // sección pedida sea 'comercial' (deep-links de /aprobaciones).
  // El ítem «Auditor» del menú abre la sección de compra si existe; si no, cae en la que el usuario pueda ver.
  const primeraTabAuditor: 'auditor_compra' | 'comercial' = hayAuditorCompra ? 'auditor_compra' : 'comercial';
  const grupoActivo: Seccion = (seccion === 'fechas' || seccion === 'criterios' || seccion === 'comentarios') ? 'resumen'
    : seccion === 'competencia' ? 'resultado'
    : seccion === 'postulacion' || seccion === 'resumen_auditor' ? 'postulacion'
    : seccion === 'auditor_compra' || seccion === 'costeo' || seccion === 'prepostulacion' || seccion === 'auditor_anexos' ? 'comercial'
    : seccion;
  // Línea de avance del negocio: qué pasos del menú ya se vieron (persistido por licitación) y
  // aviso suave si se entra a uno habiéndose saltado otro anterior sin ver.
  const visitados = useFlujoNegocio({
    negocioKey: negocio?.licitacion_codigo,
    items: NAV_SECTIONS,
    seccionActual: grupoActivo,
    toast,
  });

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
          <Link href="/negocios" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-600 hover:underline">
            <ArrowLeft size={14} /> Volver a Negocios
          </Link>
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

  // "Información Comercial" (Costeo/Auditor Técnico), hayGanado/hayCompras, hayResultado,
  // NAV_SECTIONS, grupoActivo y visitados ya se calcularon ANTES del guard de loading/error
  // (useFlujoNegocio es un hook: ver el comentario ahí arriba).

  return (
    <AppLayout breadcrumb={[
      { label: 'Negocios', href: '/negocios' },
      { label: negocio.licitacion_codigo },
    ]}>
      <div className="flex h-full overflow-hidden">

        {/* ── LEFT NAV — menú único compartido con /licitacion/[codigo] ── */}
        <MenuNegocioLateral
          items={NAV_SECTIONS.map(x => ({ ...x }))}
          activa={grupoActivo}
          onSelect={k => setSeccion(k === 'comercial' ? primeraTabAuditor : k as Seccion)}
          volverHref="/negocios"
          cargandoContadores={loadingLic}
          visitados={visitados}
          accesoRapido={hayCosteo ? { label: 'Costeo', onClick: () => flot.abrir(negocio.id, negocio.licitacion_codigo) } : undefined}
        />

        {/* ── MAIN CONTENT ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {/* Sin max-w: cada módulo ocupa todo el ancho disponible entre los dos sidebars (pedido
              del usuario, 28-sep-2026) — el propio grid/flex de cada sección se encarga de
              reacomodarse en pantallas chicas, así que no rompe el responsive. */}
          <div className="p-5 sm:p-7 w-full">
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
            {hayCosteo && (
              <button onClick={() => flot.abrir(negocio.id, negocio.licitacion_codigo)}
                className="lg:hidden mb-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200">
                Costeo
              </button>
            )}
            <div className="flex gap-1 mb-5 lg:hidden overflow-x-auto pb-1">
              {NAV_SECTIONS.map(s => s.disabled ? (
                <span
                  key={s.key}
                  title="Se habilita cuando el negocio gane"
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold text-zinc-300 cursor-not-allowed"
                >
                  {s.label}
                </span>
              ) : (
                <button
                  key={s.key}
                  onClick={() => setSeccion(s.key as Seccion)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                    grupoActivo === s.key
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {s.label}
                  {s.count != null && s.count > 0 && <span className="ml-1 opacity-60">{s.count}</span>}
                </button>
              ))}
            </div>

            {/* SELECTOR DE LÍNEAS A OFERTAR — solo en Viabilidad y plegable (la franja resume el estado y
                se despliega a pedido). La decisión la consumen el Auditor Técnico, el costeo y el Motor
                Comercial, pero ya no se pinta sobre todas las secciones. Solo aparece en licitaciones por
                línea; en suma alzada el componente no renderiza nada. */}
            {/* No hace falta pasar un onGuardado que recargue el checklist: el PUT publica
                `publicarCambio('negocio')` y la sección comercial ya escucha con useRealtime. */}
            {seccion === 'viabilidad' && <SelectorLineasOferta negocioId={negocio.id} />}

            {/* Compras es su propio módulo (menú lateral), no una pestaña de la licitación —
                este es solo el puente de salida para quien viene de acá. */}
            {seccion === 'resumen' && hayCompras && (
              <Link href={`/compras/${negocio.id}`}
                className="flex items-center justify-between gap-3 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 hover:bg-teal-100 transition-colors">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-teal-800">
                  <ShoppingCart size={16} /> Este negocio ganó — ir al Módulo de Compras
                </span>
                <ArrowUpRight size={15} className="text-teal-600 flex-shrink-0" />
              </Link>
            )}

            {/* Sections */}
            {/* Resumen agrupa Resumen/Fechas/Criterios/Comentarios en pestañas internas (línea de
                avance del negocio: primero el resumen, luego cuándo pasa cada hito, luego con qué
                se evalúa, y la conversación del equipo sobre esta licitación). */}
            {(seccion === 'resumen' || seccion === 'fechas' || seccion === 'criterios' || seccion === 'comentarios') && (
              <>
                <SeccionTabs
                  items={[
                    { key: 'resumen', label: 'Resumen' },
                    { key: 'fechas', label: 'Fechas', count: licitacion ? Object.entries(licitacion).filter(([k, v]) => k.startsWith('Fecha') && v).length : null },
                    { key: 'criterios', label: 'Criterios', count: (oportunidad?.criterios_evaluacion?.length || viabIA?.criterios_evaluacion?.criterios?.length || analisisIA?.criteriosEvaluacion?.length) },
                    { key: 'comentarios', label: 'Comentarios' },
                  ]}
                  activo={seccion}
                  onSelect={k => setSeccion(k as Seccion)}
                />
                {seccion === 'resumen' && (
                  <ResumenNegocio
                    negocio={negocio}
                    licitacion={licitacion}
                    oportunidad={oportunidad}
                    onMontoChange={guardarMonto}
                    viabIA={viabIA}
                    onIrViabilidad={() => setSeccion('viabilidad')}
                    analisisIA={analisisIA}
                  />
                )}
                {seccion === 'fechas' && <FechasNegocio licitacion={licitacion} />}
                {seccion === 'criterios' && (
                  <CriteriosSection
                    criterios={oportunidad?.criterios_evaluacion}
                    analisisIA={analisisIA as any}
                    criteriosViabilidad={viabIA?.criterios_evaluacion?.criterios}
                    analizandoIA={false}
                    onIrAInteligencia={() => setSeccion('analisis')}
                  />
                )}
                {seccion === 'comentarios' && (
                  <ComentariosSection
                    codigoDecoded={negocio.licitacion_codigo}
                    negocioId={negocio.id}
                    estadoActual={negocio.estado_pipeline}
                    isAdmin={isAdmin}
                    onEstadoChanged={sincronizarEstadoPipeline}
                  />
                )}
              </>
            )}
            {/* Resultado agrupa Resultado/Competencia; solo existe una vez que el negocio ya
                Ganó o Perdió (hayResultado, ver arriba). */}
            {hayResultado && (seccion === 'resultado' || seccion === 'competencia') && (
              <>
                <SeccionTabs
                  items={[
                    { key: 'resultado', label: 'Resultado' },
                    { key: 'competencia', label: 'Competencia' },
                  ]}
                  activo={seccion}
                  onSelect={k => setSeccion(k as Seccion)}
                />
                {seccion === 'resultado' && (
                  <ResultadoSection codigo={negocio.licitacion_codigo} mpUrl={mpUrl} />
                )}
                {seccion === 'competencia' && (
                  <OfertasCompetencia codigo={negocio.licitacion_codigo} isAdmin={isAdmin} />
                )}
              </>
            )}
            {seccion === 'items' && <SeccionItems licitacion={licitacion} analisisIA={analisisIA} />}
            {seccion === 'viabilidad' && <ViabilidadIAPanel codigo={negocio.licitacion_codigo} onComplete={fetchViabIA} />}
            {seccion === 'documentos' && (
              <div className="space-y-4">
              {/* Quien revisa los documentos sabe a qué empresa corresponden: la elige aquí, una vez, y los anexos se llenan con sus datos. */}
              <EmpresaPostulacionCard negocioId={negocio.id} empresaId={negocio.empresa_id} onChange={empresa_id => setNegocio(prev => prev ? { ...prev, empresa_id } : prev)} />
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
                empresaId={negocio.empresa_id}
                negocioId={negocio.id}
              />
              </div>
            )}
            {seccion === 'analisis' && (
              <InteligenciaSection codigo={negocio.licitacion_codigo} documentosAnalizables={documentosAnalizables as any} nombreLicitacion={negocio.licitacion_nombre || negocio.licitacion_codigo} />
            )}
            {hayResultado && seccion === 'preguntas' && (
              <PreguntasSection codigoDecoded={negocio.licitacion_codigo} mpUrl={mpUrl} />
            )}
            {/* AUDITOR unificado (29-sep-2026): un solo módulo con el flujo en pestañas ARRIBA: Auditor (compra y técnico juntos, cada opción con sus dos
                verificadores) → Costeo → Checklist → Anexos. El checklist y los anexos salen del Auditor Técnico anterior (mismo componente, dos vistas). */}
            {(seccion === 'comercial' || seccion === 'auditor_compra' || seccion === 'costeo' || seccion === 'prepostulacion' || seccion === 'auditor_anexos') && (hayAuditorTecnico || hayAuditorCompra || hayCosteo) && (() => {
              const tab = seccion === 'auditor_compra' && hayAuditorCompra ? 'auditor_compra'
                : (seccion === 'prepostulacion' || seccion === 'auditor_anexos') && hayPrePostulacion ? 'prepostulacion'
                : seccion === 'comercial' && hayAuditorTecnico ? 'comercial'
                : primeraTabAuditor;
              return (
                <div className="space-y-4">
                  <SeccionTabs
                    items={[
                      ...(hayAuditorCompra ? [{ key: 'auditor_compra', label: 'Auditor · compra y técnico' }] : []),
                      ...(hayAuditorTecnico ? [{ key: 'comercial', label: 'Checklist', count: comercialPorAprobar }] : []),
                      ...(hayPrePostulacion ? [{ key: 'prepostulacion', label: 'Pre-postulación' }] : []),
                    ]}
                    activo={tab}
                    onSelect={k => setSeccion(k as Seccion)}
                  />
                  {tab === 'auditor_compra' && hayAuditorCompra && (
                    <AuditorOpcionesPanel negocioId={negocio.id} licitacionCodigo={negocio.licitacion_codigo} puedeAprobar={isAdmin || !!usuario?.permisos?.aprobar_comercial || !!usuario?.permisos?.auditor_aprobar} />
                  )}
                  {tab === 'prepostulacion' && hayPrePostulacion && (
                    <PrePostulacionPanel negocioId={negocio.id} empresaId={negocio.empresa_id} onIrAlAuditor={() => setSeccion('auditor_compra')}
                      documentosSlot={hayAuditorTecnico ? (
                        <InformacionComercialSection key="oferta" vista="oferta" negocioId={negocio.id} licitacionCodigo={negocio.licitacion_codigo} empresaId={negocio.empresa_id}
                          estadoPipeline={negocio.estado_pipeline} onEmpresaChange={empresa_id => setNegocio(prev => prev ? { ...prev, empresa_id } : prev)} />
                      ) : undefined} />
                  )}
                  {tab === 'comercial' && hayAuditorTecnico && (
                    <InformacionComercialSection
                      key={tab}
                      vista="checklist"
                      negocioId={negocio.id}
                      licitacionCodigo={negocio.licitacion_codigo}
                      empresaId={negocio.empresa_id}
                      estadoPipeline={negocio.estado_pipeline}
                      onEmpresaChange={empresa_id => setNegocio(prev => prev ? { ...prev, empresa_id } : prev)}
                    />
                  )}
                </div>
              );
            })()}
            {(seccion === 'postulacion' || seccion === 'resumen_auditor') && isAdmin && hayPrePostulacion && (
              <div className="space-y-4">
                <PostulacionPanel negocioId={negocio.id} onIrAPrePostulacion={() => setSeccion('prepostulacion')} />
                <ResumenAuditorPanel negocioId={negocio.id} onIrAlAuditor={() => setSeccion('auditor_compra')} />
              </div>
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
