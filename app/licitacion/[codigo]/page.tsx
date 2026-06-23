'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Star, StarOff, ExternalLink, Copy, Check,
  Building2, MapPin, Calendar, DollarSign, Hash,
  Loader2, AlertCircle, Tag, RefreshCw, Briefcase,
} from 'lucide-react';
import { DocumentoAdjunto, Oportunidad } from '@/app/types/search.types';
import { TIPO_LICITACION_MAP } from '@/app/types/mercado-publico.types';
import { TIPOS_LICITACION } from '@/app/types/search.types';
import { useFavorites } from '@/app/hooks/useFavorites';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { AppLayout } from '@/app/components/AppLayout';
import { formatDate, formatCLP, getDiasRestantes, esUrlAnalizable, formatDateTime, estadoConfigFor, AnalisisIA } from './utils';
import { SectionNav, SeccionLicitacion } from './SectionNav';
import { AUTOMATIZACION_PAUSADA } from '@/app/lib/automatizacion';
import { ResumenSection } from './sections/ResumenSection';
import { FechasSection } from './sections/FechasSection';
import { ItemsSection } from './sections/ItemsSection';
import { DocumentosSection } from './sections/DocumentosSection';
import { PreguntasSection } from './sections/PreguntasSection';
import { CriteriosSection } from './sections/CriteriosSection';
import { ComentariosSection } from './sections/ComentariosSection';
import { Viabilidad } from './sections/ViabilidadSection';
import { ViabilidadIAPanel } from './sections/ViabilidadIAPanel';
import { InteligenciaSection } from './sections/InteligenciaSection';
import { PostulacionSection } from './sections/PostulacionSection';
import { GestionSection } from './sections/GestionSection';
import { Resaltar } from '@/app/components/Resaltar';

// ======================================================
// PÁGINA PRINCIPAL
// ======================================================

export default function LicitacionDetallePage() {
  const params   = useParams();
  const router   = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { usuario } = useSession();
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast();

  const [licitacion,      setLicitacion]      = useState<Oportunidad | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [toggling,        setToggling]        = useState(false);
  const [copiedCodigo,    setCopiedCodigo]    = useState(false);
  const [documentosCache, setDocumentosCache] = useState<DocumentoAdjunto[]>([]);
  const [cargandoDocs,    setCargandoDocs]    = useState(false);
  const [activeSection,   setActiveSection]   = useState<SeccionLicitacion>('resumen');
  const [keywords,        setKeywords]        = useState<string[]>([]); // palabras clave activas del usuario, para resaltar

  // --- ESTADO PARA DESCARGA AUTOMÁTICA ---
  const [descargandoAuto, setDescargandoAuto] = useState(false);

  // --- ESTADO PARA ANÁLISIS AUTOMÁTICO CON IA (Gemini) ---
  const [analisisIA,       setAnalisisIA]       = useState<AnalisisIA | null>(null);
  const [analisisIACargado, setAnalisisIACargado] = useState(false);
  const [analizandoIA,     setAnalizandoIA]     = useState(false);
  const analisisIADisparado = useRef(false);

  // --- ESTADO PARA VIABILIDAD (Fase 2) ---
  const [viabilidad,        setViabilidad]        = useState<Viabilidad | null>(null);
  const [viabilidadCargada, setViabilidadCargada] = useState(false);
  const [analizandoViab,    setAnalizandoViab]    = useState(false);
  const viabilidadDisparada = useRef(false);

  // --- ESTADO PARA CLASIFICACIÓN AUTOMÁTICA DE DOCUMENTOS ---
  const [clasificando,         setClasificando]         = useState(false);
  const [resumenClasificacion, setResumenClasificacion] = useState<{estado:'completo'|'incompleto';falta:string[]} | null>(null);
  const clasificacionDisparada = useRef(false);

  const codigo         = params.codigo as string;
  const codigoDecoded  = decodeURIComponent(codigo);
  const isAdmin        = usuario?.rol === 'admin';

  const documentosAnalizables = documentosCache.filter(d => esUrlAnalizable(d.url_local || d.url));

  // --- DESCARGA AUTOMÁTICA ---
  const handleAutoDescargar = async () => {
    setDescargandoAuto(true);
    try {
      const res = await fetch('/api/documentos/auto-descargar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ licitacionCodigo: codigoDecoded }),
      });

      const data = await res.json();

      if (data.success) {
        toastSuccess(
          data.nuevos > 0 ? `${data.nuevos} documento(s) descargado(s)` : 'Ya estaban guardados',
          data.mensaje || 'Documentos procesados',
        );
        if (data.revisarManual && data.mensajeRevision) {
          toastWarning('Revisar las bases manualmente', data.mensajeRevision);
        }
        fetchDocumentos();
      } else {
        // Mostrar el paso específico que falló para facilitar el diagnóstico
        const detalle = data.pasos?.paso1_listar || data.pasos?.paso3_browser || data.error || 'Fallo en la descarga';
        toastError('Error al descargar', detalle);
        console.error('[auto-descarga] pasos de fallo:', data.pasos);
      }
    } catch (e: any) {
      toastError('Error de red', 'No se pudo conectar con el servidor de descarga');
    } finally {
      setDescargandoAuto(false);
    }
  };

  // ── Cargar licitación ───────────────────────────────────────────────────────
  const fetchLicitacion = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/licitacion-detalle/${encodeURIComponent(codigoDecoded)}`);
      const data = await res.json();
      if (data.success && data.licitacion) {
        setLicitacion(data.licitacion);
      } else {
        setError(data.error || 'No se encontró la licitación');
      }
    } catch {
      setError('Error de conexión al cargar la licitación');
    } finally {
      setLoading(false);
    }
  }, [codigoDecoded]);

  // ── Cargar documentos guardados ─────────────────────────────────────────────
  const fetchDocumentos = useCallback(async () => {
    setCargandoDocs(true);
    try {
      const res = await fetch(`/api/documentos/cache/${encodeURIComponent(codigoDecoded)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.documentos?.length > 0) {
          setDocumentosCache(data.documentos.map((d: any) => ({
            nombre:    d.documento_nombre || d.nombre,
            url:       d.documento_url_local || d.url_local || d.url,
            url_local: d.documento_url_local || d.url_local || d.url,
            size:      d.size_bytes || d.size,
            categoria: d.categoria ?? null,
            ya_descargado: true,
          })));
        }
      }
    } catch {}
    finally { setCargandoDocs(false); }
  }, [codigoDecoded]);

  // ── Análisis IA (Gemini) — cargar resultado guardado ────────────────────────
  const fetchAnalisisIA = useCallback(async () => {
    try {
      const res = await fetch(`/api/licitacion-ia/${encodeURIComponent(codigoDecoded)}`);
      const data = await res.json();
      if (data.success) setAnalisisIA(data.analisis);
    } catch {}
    finally { setAnalisisIACargado(true); }
  }, [codigoDecoded]);

  // ── Viabilidad (Fase 2) — cargar resultado guardado ─────────────────────────
  const fetchViabilidad = useCallback(async () => {
    try {
      const res = await fetch(`/api/licitacion-viabilidad/${encodeURIComponent(codigoDecoded)}`);
      const data = await res.json();
      if (data.success) setViabilidad(data.viabilidad);
    } catch {}
    finally { setViabilidadCargada(true); }
  }, [codigoDecoded]);

  // ── Recalcular viabilidad (manual o auto) ───────────────────────────────────
  const calcularViabilidad = useCallback(async () => {
    setAnalizandoViab(true);
    try {
      const res = await fetch(`/api/licitacion-viabilidad/${encodeURIComponent(codigoDecoded)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentos: documentosAnalizables.map(d => ({ url: d.url_local || d.url, nombre: d.nombre })),
        }),
      });
      const data = await res.json();
      if (data.success) setViabilidad(data.viabilidad);
      else toastError('No se pudo calcular la viabilidad', data.error || 'Intenta de nuevo');
    } catch {
      toastError('Error de red', 'No se pudo calcular la viabilidad');
    } finally { setAnalizandoViab(false); }
  }, [codigoDecoded, documentosAnalizables, toastError]);

  useEffect(() => {
    if (codigoDecoded) {
      fetchLicitacion();
      fetchDocumentos();
      fetchAnalisisIA();
      fetchViabilidad();
    }
  }, [codigoDecoded, fetchLicitacion, fetchDocumentos, fetchAnalisisIA, fetchViabilidad]);

  // Palabras clave activas del usuario → para resaltarlas en el detalle
  useEffect(() => {
    fetch('/api/palabras-clave')
      .then(r => r.json())
      .then(d => {
        if (d?.success) {
          setKeywords((d.keywords || []).filter((k: { activo: boolean }) => k.activo).map((k: { keyword: string }) => k.keyword));
        }
      })
      .catch(() => { /* silencioso: si falla, no se resalta */ });
  }, []);

  // ── Auto-disparar viabilidad si no hay datos guardados y hay documentos ──────
  useEffect(() => {
    if (AUTOMATIZACION_PAUSADA) return; // modo manual: el usuario pulsa "Calcular viabilidad"
    if (!viabilidadCargada || viabilidad || viabilidadDisparada.current) return;
    if (documentosAnalizables.length === 0) return;
    viabilidadDisparada.current = true;
    calcularViabilidad();
  }, [viabilidadCargada, viabilidad, documentosAnalizables, calcularViabilidad]);

  // ── Análisis IA (Gemini) — disparar automáticamente si no hay datos guardados
  useEffect(() => {
    if (AUTOMATIZACION_PAUSADA) return; // modo manual: el análisis IA se genera al calcular viabilidad o desde su botón
    if (!analisisIACargado || analisisIA || analisisIADisparado.current) return;
    if (documentosAnalizables.length === 0) return;

    analisisIADisparado.current = true;
    setAnalizandoIA(true);
    fetch(`/api/licitacion-ia/${encodeURIComponent(codigoDecoded)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentos: documentosAnalizables.map(d => ({ url: d.url_local || d.url, nombre: d.nombre })),
      }),
    })
      .then(r => r.json())
      .then(data => { if (data.success) setAnalisisIA(data.analisis); })
      .catch(() => {})
      .finally(() => setAnalizandoIA(false));
  }, [analisisIACargado, analisisIA, documentosAnalizables, codigoDecoded]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleToggleFavorite = async () => {
    if (!licitacion) return;
    setToggling(true);
    const wasFav = isFavorite(licitacion.codigo);
    const ok = await toggleFavorite({
      codigo:       licitacion.codigo,
      nombre:       licitacion.nombre,
      organismo:    licitacion.organismo,
      monto_total:  licitacion.monto_total,
      fecha_cierre: licitacion.fecha_cierre,
      estado:       licitacion.estado,
    });
    if (ok !== false) {
      toastSuccess(wasFav ? 'Eliminado de favoritos' : 'Agregado a favoritos');
    }
    setToggling(false);
  };

  const handleCopyCodigo = async () => {
    await navigator.clipboard.writeText(codigoDecoded);
    setCopiedCodigo(true);
    setTimeout(() => setCopiedCodigo(false), 2000);
  };

  // --- CLASIFICACIÓN DE DOCUMENTOS CON GEMINI ---
  const handleClasificar = useCallback(async () => {
    setClasificando(true);
    try {
      const res = await fetch('/api/documentos/clasificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigoDecoded }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.resumen_licitacion) setResumenClasificacion(data.resumen_licitacion);
        fetchDocumentos();
      }
    } catch {}
    finally { setClasificando(false); }
  }, [codigoDecoded, fetchDocumentos]);

  // Auto-clasificar cuando los docs cargan y no tienen categoría aún
  useEffect(() => {
    if (AUTOMATIZACION_PAUSADA) return; // modo manual: la clasificación se dispara con su botón
    if (cargandoDocs) return;
    if (clasificacionDisparada.current) return;
    if (documentosCache.length === 0) return;
    if (documentosCache.some(d => (d as any).categoria)) return;

    clasificacionDisparada.current = true;
    handleClasificar();
  }, [cargandoDocs, documentosCache, handleClasificar]);

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 size={36} className="animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">Consultando Mercado Público...</p>
            <p className="text-zinc-400 text-xs mt-1">{codigoDecoded}</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !licitacion) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center py-24">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-800 mb-2">Licitación no encontrada</h2>
            <p className="text-zinc-500 text-sm mb-2">{error || 'No existe información para este código en la API'}</p>
            <p className="font-mono text-xs text-zinc-400 mb-6">{codigoDecoded}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => router.back()}
                className="flex items-center gap-2 px-4 py-2 border border-zinc-200 text-zinc-700 rounded-xl hover:bg-zinc-50 text-sm transition-colors">
                <ArrowLeft size={15} /> Volver
              </button>
              <button onClick={fetchLicitacion}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm transition-colors">
                <RefreshCw size={15} /> Reintentar
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Derivados ────────────────────────────────────────────────────────────────
  const estadoConfig = estadoConfigFor(licitacion.estado);

  const diasRestantes  = getDiasRestantes(licitacion.fecha_cierre);
  const isFav          = isFavorite(licitacion.codigo);
  const monto          = formatCLP(licitacion.monto_total || licitacion.monto_estimado);
  const tipoLabel      = licitacion.tipo_licitacion
    ? (TIPO_LICITACION_MAP[licitacion.tipo_licitacion] || TIPOS_LICITACION[licitacion.tipo_licitacion] || licitacion.tipo_licitacion)
    : null;

  const fechasProceso          = licitacion.fechas_proceso;
  const mpUrl                  = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigoDecoded)}`;

  // Timeline: solo fechas presentes
  const fechasAdic = [
    { label: 'Publicación',             fecha: licitacion.fecha_publicacion },
    { label: 'Inicio preguntas',         fecha: fechasProceso?.fecha_inicio_preguntas },
    { label: 'Fin preguntas',            fecha: fechasProceso?.fecha_fin_preguntas },
    { label: 'Pub. respuestas',          fecha: fechasProceso?.fecha_publicacion_respuestas },
    { label: 'Apertura técnica',         fecha: fechasProceso?.fecha_apertura_tecnica },
    { label: 'Apertura económica',       fecha: fechasProceso?.fecha_apertura_economica },
    { label: 'Cierre recepción',         fecha: licitacion.fecha_cierre },
    { label: 'Adjudicación estimada',    fecha: fechasProceso?.fecha_estimada_adjudicacion },
    { label: 'Adjudicación',             fecha: licitacion.fecha_adjudicacion },
  ].filter(f => f.fecha && formatDateTime(f.fecha));

  // KPIs: solo los que tienen valor
  const kpis = [
    monto && {
      icon:  <DollarSign size={15} className="text-green-600" />,
      label: 'Monto estimado',
      value: monto,
      sub:   licitacion.moneda || 'CLP',
    },
    licitacion.fecha_cierre && {
      icon:  <Calendar size={15} className="text-blue-600" />,
      label: 'Fecha cierre',
      value: formatDate(licitacion.fecha_cierre) || '—',
      sub:   diasRestantes !== null
        ? diasRestantes > 0  ? `${diasRestantes} días restantes`
        : diasRestantes === 0 ? 'Cierra hoy'
        : 'Proceso finalizado'
        : undefined,
    },
    (licitacion.comprador || licitacion.organismo) && {
      icon:  <Building2 size={15} className="text-purple-600" />,
      label: 'Unidad compradora',
      value: licitacion.comprador || licitacion.organismo,
      sub:   licitacion.codigo_organismo || undefined,
    },
    licitacion.region && {
      icon:  <MapPin size={15} className="text-orange-600" />,
      label: 'Región',
      value: licitacion.region,
      sub:   licitacion.comuna_unidad || undefined,
    },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string; sub?: string }[];

  return (
    <AppLayout breadcrumb={[
      { label: 'Buscador', href: '/' },
      { label: 'Licitaciones' },
      { label: codigoDecoded },
    ]}>
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">

        {/* HEADER CARD ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Banner indigo */}
          <div className="bg-gradient-to-r from-[#1e1b4b] via-[#312e81] to-[#1e3a8a] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Code + badges */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <button
                    onClick={handleCopyCodigo}
                    className="flex items-center gap-1.5 font-mono text-[12px] text-indigo-200 bg-white/10 border border-white/20 px-2.5 py-1 rounded-lg hover:bg-white/20 transition-colors"
                    title="Copiar código"
                  >
                    <Hash size={10} />
                    {codigoDecoded}
                    {copiedCodigo
                      ? <Check size={11} className="text-emerald-400 ml-1" />
                      : <Copy size={10} className="text-indigo-300/50 ml-1" />}
                  </button>
                  {tipoLabel && (
                    <span className="flex items-center gap-1 text-[11px] text-indigo-300 bg-white/10 border border-white/15 px-2 py-0.5 rounded-full font-medium">
                      <Tag size={9} />
                      {licitacion.tipo_licitacion} · {tipoLabel}
                    </span>
                  )}
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${estadoConfig.badge}`}>
                    {estadoConfig.icon} {estadoConfig.label}
                  </span>
                </div>

                {/* Title */}
                <h1 className="text-xl sm:text-2xl font-bold text-white leading-snug mb-2.5 tracking-tight">
                  <Resaltar texto={licitacion.nombre} keywords={keywords} className="bg-blue-400/30 text-white rounded-[3px] px-0.5 font-bold underline decoration-blue-300/60" />
                </h1>

                {/* Organismo */}
                <div className="flex items-center gap-2 text-indigo-300 text-sm flex-wrap">
                  <Building2 size={13} />
                  <span>{licitacion.organismo}</span>
                  {licitacion.region && (
                    <>
                      <span className="text-indigo-500">·</span>
                      <MapPin size={12} />
                      <span>{licitacion.region}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 flex-shrink-0">
                {/* Favorito */}
                <button
                  onClick={handleToggleFavorite}
                  disabled={toggling}
                  title={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  className="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl transition-colors border border-white/20 disabled:opacity-50"
                >
                  {toggling
                    ? <Loader2 size={16} className="text-indigo-300 animate-spin" />
                    : isFav
                      ? <Star size={16} className="text-amber-400 fill-amber-400" />
                      : <StarOff size={16} className="text-indigo-300" />}
                </button>

                {/* Asignar negocio (admin) */}
                {isAdmin && (
                  <button
                    onClick={() => setActiveSection('gestion')}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl border border-white/20 text-indigo-200 hover:text-white text-xs font-semibold transition-colors"
                  >
                    <Briefcase size={13} /> Asignar
                  </button>
                )}

                {/* Descargar documentos */}
                <button
                  onClick={() => setActiveSection('documentos')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl border border-white/20 text-indigo-200 hover:text-white text-xs font-semibold transition-colors"
                  title="Ir a documentos"
                >
                  <RefreshCw size={13} /> Documentos
                </button>

                {/* Ver en MP */}
                <a
                  href={mpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-indigo-900/40"
                >
                  <ExternalLink size={13} /> Mercado Público
                </a>
              </div>
            </div>
          </div>

          {/* KPIs */}
          {kpis.length > 0 && (
            <div className={`grid divide-x divide-y sm:divide-y-0 divide-slate-100 ${
              kpis.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
              kpis.length === 3 ? 'grid-cols-1 sm:grid-cols-3' :
              kpis.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
            }`}>
              {kpis.map((kpi, i) => (
                <div key={i} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-1.5 mb-1">
                    {kpi.icon}
                    <span className="text-[11px] text-slate-500 font-medium">{kpi.label}</span>
                  </div>
                  <p className="text-[13.5px] font-bold text-slate-900 line-clamp-1">{kpi.value}</p>
                  {kpi.sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{kpi.sub}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ NAV + CONTENIDO ═══════════════════════════════════════════════ */}
        <div className="flex flex-col lg:flex-row gap-6">
          <SectionNav
            active={activeSection}
            onChange={setActiveSection}
            counts={{
              documentos: documentosCache.length || undefined,
              items: licitacion.items?.length || undefined,
              fechas: fechasAdic.length || undefined,
              ia: documentosAnalizables.length > 0,
              viabilidad: viabilidad?.score_viabilidad?.semaforo ?? null,
            }}
          />

          <div key={activeSection} className="flex-1 min-w-0 fade-in">
            {activeSection === 'resumen' && (
              <ResumenSection
                licitacion={licitacion}
                tipoLabel={tipoLabel}
                diasRestantes={diasRestantes}
                analisisIA={analisisIA}
                analizandoIA={analizandoIA}
                keywords={keywords}
              />
            )}
            {activeSection === 'fechas' && (
              <FechasSection fechas={fechasAdic} />
            )}
            {activeSection === 'items' && (
              <ItemsSection items={licitacion.items} keywords={keywords} />
            )}
            {activeSection === 'documentos' && (
              <DocumentosSection
                codigoDecoded={codigoDecoded}
                mpUrl={mpUrl}
                documentosCache={documentosCache}
                cargandoDocs={cargandoDocs}
                descargandoAuto={descargandoAuto}
                handleAutoDescargar={handleAutoDescargar}
                fetchDocumentos={fetchDocumentos}
                clasificando={clasificando}
                onReClasificar={handleClasificar}
                resumenClasificacion={resumenClasificacion}
              />
            )}
            {activeSection === 'preguntas' && (
              <PreguntasSection mpUrl={mpUrl} />
            )}
            {activeSection === 'criterios' && (
              <CriteriosSection
                criterios={licitacion.criterios_evaluacion}
                analisisIA={analisisIA}
                analizandoIA={analizandoIA}
                onIrAInteligencia={() => setActiveSection('inteligencia')}
              />
            )}
            {activeSection === 'comentarios' && (
              <ComentariosSection codigoDecoded={codigoDecoded} />
            )}
            {activeSection === 'viabilidad' && (
              // La IA es la fuente ÚNICA de la viabilidad: entrega el score, el veredicto
              // y todo el análisis. Un solo panel, un solo botón.
              <ViabilidadIAPanel codigo={codigoDecoded} />
            )}
            {activeSection === 'inteligencia' && (
              <InteligenciaSection documentosAnalizables={documentosAnalizables} nombreLicitacion={licitacion.nombre} />
            )}
            {activeSection === 'postulacion' && (
              <PostulacionSection />
            )}
            {activeSection === 'gestion' && (
              <GestionSection
                licitacion={licitacion}
                isAdmin={isAdmin}
                isFav={isFav}
                toggling={toggling}
                handleToggleFavorite={handleToggleFavorite}
                mpUrl={mpUrl}
              />
            )}
          </div>
        </div>

        {/* Volver */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 py-2.5 text-zinc-500 hover:text-zinc-700 text-sm transition-colors"
        >
          <ArrowLeft size={14} /> Volver a resultados
        </button>
      </div>
    </AppLayout>
  );
}



