'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Star, StarOff, ExternalLink, Copy, Check,
  Loader2, AlertCircle, Tag, RefreshCw, Briefcase, UserCheck, FolderOpen, History,
} from 'lucide-react';
import { DocumentoAdjunto, Oportunidad } from '@/app/types/search.types';
import { TIPO_LICITACION_MAP } from '@/app/types/mercado-publico.types';
import { TIPOS_LICITACION } from '@/app/types/search.types';
import { useFavorites } from '@/app/hooks/useFavorites';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { AppLayout } from '@/app/components/AppLayout';
import { getDiasRestantes, esUrlAnalizable, formatDateTime, estadoConfigFor, AnalisisIA } from './utils';
import { AUTOMATIZACION_PAUSADA } from '@/app/lib/automatizacion';
import { AsignarNegocioModal } from '@/app/components/AsignarNegocioModal';
import { GestionAside, HistorialLicitacion, fmtFecha, type NegocioGestion, type EventoLic } from '@/app/negocios/[id]/GestionAside';
import { registrarVerSeccion } from '@/app/lib/actividad-cliente';
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
import { ResultadoSection } from './sections/ResultadoSection';
import { Resaltar } from '@/app/components/Resaltar';

// Menú unificado con /negocios/[id] (mismo aside angosto, mismo orden de tabs).
// 'inteligencia' NO aparece en NAV_SECTIONS (queda oculta, como en negocio): solo se
// llega por el link "Ver análisis completo" dentro de CriteriosSection.
type SeccionLicitacion =
  | 'resumen' | 'resultado' | 'documentos' | 'viabilidad' | 'criterios'
  | 'items' | 'fechas' | 'preguntas' | 'comentarios' | 'inteligencia';

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
  const [asignadoNombre,  setAsignadoNombre]  = useState<string | null>(null); // ¿a qué perfil está asignada?
  const [asignarOpen,     setAsignarOpen]     = useState(false); // modal Asignar/Reasignar a negocio
  // Columna derecha de gestión: idéntica a /negocios/[id] (GestionAside) cuando la licitación
  // YA está asignada a un negocio; si no, una versión ligera de solo lectura (ver más abajo).
  const [negocioGestion, setNegocioGestion] = useState<NegocioGestion | null>(null);
  const [negocioGestionCargado, setNegocioGestionCargado] = useState(false);
  const [historialLigero, setHistorialLigero] = useState<EventoLic[]>([]);

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

  // Informe de Viabilidad IA (el corazón) — su lista de criterios alimenta la pestaña Criterios
  const [informeViabIA, setInformeViabIA] = useState<any>(null);

  // --- ESTADO PARA CLASIFICACIÓN AUTOMÁTICA DE DOCUMENTOS ---
  const [clasificando,         setClasificando]         = useState(false);
  const [resumenClasificacion, setResumenClasificacion] = useState<{estado:'completo'|'incompleto';falta:string[]} | null>(null);
  const clasificacionDisparada = useRef(false);

  const codigo         = params.codigo as string;
  const codigoDecoded  = decodeURIComponent(codigo);
  const isAdmin        = usuario?.rol === 'admin';

  // useMemo: es dependencia de efectos de auto-disparo y de calcularViabilidad; sin
  // identidad estable esos efectos se re-ejecutaban en cada render.
  const documentosAnalizables = useMemo(
    () => documentosCache.filter(d => esUrlAnalizable(d.url_local || d.url)),
    [documentosCache],
  );

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
        await fetchDocumentos();
        // Clasificación automática inmediata tras descargar (no depende del botón ni del effect).
        // Apagamos la fase de descarga primero para que el banner muestre la fase "clasificando".
        setDescargandoAuto(false);
        clasificacionDisparada.current = true; // evita doble disparo desde el useEffect
        await handleClasificar();
      } else {
        // Mostrar el paso específico que falló para facilitar el diagnóstico
        const detalle = data.error
          || data.pasos?.paso4_subir || data.pasos?.paso3_browser
          || data.pasos?.paso1_listar || 'Fallo en la descarga';
        toastError('Error al descargar', detalle);
        if (data.pasos) console.error('[auto-descarga] pasos de fallo:', data.pasos);
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
            subcategoria: d.subcategoria ?? null,
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

  // ¿A qué perfil está asignada esta licitación? (regla: un solo perfil por licitación).
  const fetchAsignacion = useCallback(async () => {
    if (!codigoDecoded) return;
    try {
      const res = await fetch('/api/negocios/asignaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos: [codigoDecoded] }),
      });
      const data = await res.json();
      setAsignadoNombre(data?.asignaciones?.[codigoDecoded]?.asignado_nombre ?? null);
    } catch { /* silencioso */ }
  }, [codigoDecoded]);

  // Columna de gestión (GestionAside): trae el negocio COMPLETO por código — la misma columna
  // derecha que /negocios/[id], para que sea igual en ambas vistas cuando ya está asignada.
  const fetchNegocioGestion = useCallback(async () => {
    if (!codigoDecoded) return;
    setNegocioGestionCargado(false);
    try {
      const res = await fetch(`/api/negocios/por-codigo/${encodeURIComponent(codigoDecoded)}`);
      const data = await res.json();
      setNegocioGestion(data?.success ? (data.negocio ?? null) : null);
    } catch { setNegocioGestion(null); }
    finally { setNegocioGestionCargado(true); }
  }, [codigoDecoded]);

  // Historial (solo lectura) para cuando la licitación AÚN NO está asignada — GestionAside trae
  // el suyo propio una vez asignada, así que esto solo importa en el caso "sin negocio".
  useEffect(() => {
    if (!codigoDecoded) return;
    fetch(`/api/historial?codigo=${encodeURIComponent(codigoDecoded)}&limit=100`)
      .then(r => r.json())
      .then(d => { if (d.success) setHistorialLigero(d.eventos || []); })
      .catch(() => { /* silencioso */ });
  }, [codigoDecoded]);

  // Bitácora: qué sección revisó cada perfil (mismo mecanismo que /negocios/[id], deduplicado por
  // día en el servidor). Deja constancia de quién miró una licitación aunque no esté asignada —
  // parte del control de acceso: ver puedeVerLicitacion() en app/lib/api-auth.ts.
  useEffect(() => {
    if (codigoDecoded && licitacion) registrarVerSeccion(codigoDecoded, activeSection);
  }, [codigoDecoded, activeSection, licitacion]);

  useEffect(() => {
    if (codigoDecoded) {
      fetchLicitacion();
      fetchDocumentos();
      fetchAnalisisIA();
      fetchViabilidad();
      fetchAsignacion();
      fetchNegocioGestion();
    }
  }, [codigoDecoded, fetchLicitacion, fetchDocumentos, fetchAnalisisIA, fetchViabilidad, fetchAsignacion, fetchNegocioGestion]);

  // Cargar el informe de Viabilidad IA (para alimentar la pestaña Criterios con sus criterios + fuentes)
  useEffect(() => {
    if (!codigoDecoded) return;
    fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigoDecoded)}`)
      .then(r => r.json())
      .then(d => { if (d?.informeIA) setInformeViabIA(d.informeIA); })
      .catch(() => { /* silencioso */ });
  }, [codigoDecoded]);

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
        await fetchDocumentos();
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
    // "Sin acceso" (403 de puedeVerLicitacion) es un caso distinto de "no existe": está asignada
    // a otro perfil, no un dato faltante. Se avisa claro y no se ofrece "Reintentar" (no ayuda).
    const sinAcceso = /sin acceso/i.test(error || '');
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center py-24">
          <div className="text-center max-w-md">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${sinAcceso ? 'bg-amber-50' : 'bg-red-50'}`}>
              <AlertCircle size={28} className={sinAcceso ? 'text-amber-500' : 'text-red-400'} />
            </div>
            <h2 className="text-xl font-semibold text-zinc-800 mb-2">
              {sinAcceso ? 'Acceso restringido' : 'Licitación no encontrada'}
            </h2>
            <p className="text-zinc-500 text-sm mb-2">
              {sinAcceso
                ? 'Esta licitación ya está asignada a otro perfil como negocio. No puedes verla.'
                : (error || 'No existe información para este código en la API')}
            </p>
            <p className="font-mono text-xs text-zinc-400 mb-6">{codigoDecoded}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => router.back()}
                className="flex items-center gap-2 px-4 py-2 border border-zinc-200 text-zinc-700 rounded-xl hover:bg-zinc-50 text-sm transition-colors">
                <ArrowLeft size={15} /> Volver
              </button>
              {!sinAcceso && (
                <button onClick={fetchLicitacion}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm transition-colors">
                  <RefreshCw size={15} /> Reintentar
                </button>
              )}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Derivados ────────────────────────────────────────────────────────────────
  const estadoConfig = estadoConfigFor(licitacion.estado, licitacion.fecha_cierre);

  const diasRestantes  = getDiasRestantes(licitacion.fecha_cierre);
  const isFav          = isFavorite(licitacion.codigo);
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

  // Menú unificado con /negocios/[id]: mismo orden y mismo criterio de badges de conteo.
  const NAV_SECTIONS: { key: SeccionLicitacion; label: string; count: number | null }[] = [
    { key: 'resumen',     label: 'Resumen',     count: null },
    { key: 'resultado',   label: 'Resultado',   count: null },
    { key: 'documentos',  label: 'Documentos',  count: documentosCache.length || null },
    { key: 'viabilidad',  label: 'Viabilidad',  count: null },
    { key: 'criterios',   label: 'Criterios',   count: licitacion.criterios_evaluacion?.length || analisisIA?.criteriosEvaluacion?.length || null },
    { key: 'items',       label: 'Ítems',       count: licitacion.items?.length || null },
    { key: 'fechas',      label: 'Fechas',      count: fechasAdic.length || null },
    { key: 'preguntas',   label: 'Preguntas',   count: null },
    { key: 'comentarios', label: 'Comentarios', count: null },
  ];

  return (
    <AppLayout breadcrumb={[
      { label: 'Buscador', href: '/' },
      { label: 'Licitaciones' },
      { label: codigoDecoded },
    ]}>
      <div className="flex h-full overflow-hidden">

        {/* ── LEFT NAV — mismo shell que /negocios/[id] ─────────────────── */}
        <aside className="hidden lg:flex flex-col w-44 border-r border-zinc-200/80 bg-white flex-shrink-0 overflow-y-auto">
          <div className="px-3 pt-4 pb-3">
            <button onClick={() => router.back()} className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900 transition-colors font-medium">
              <ArrowLeft size={13} /> Volver
            </button>
          </div>

          <div className="px-3 pb-2">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-2 pb-1.5">
              La licitación
            </p>
            <nav className="space-y-0.5">
              {NAV_SECTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] transition-all ${
                    activeSection === s.key
                      ? 'bg-indigo-50 text-indigo-700 font-bold'
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 font-medium'
                  }`}
                >
                  <span>{s.label}</span>
                  {s.count != null && s.count > 0 && (
                    <span className={`text-[10px] px-1.5 py-px rounded-full font-bold ${
                      activeSection === s.key ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-400'
                    }`}>
                      {s.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className={`p-5 sm:p-7 mx-auto w-full ${activeSection === 'documentos' ? 'max-w-6xl' : 'max-w-3xl'}`}>
            {asignarOpen && (
              <AsignarNegocioModal
                licitacion={licitacion}
                asignadoNombre={asignadoNombre}
                onClose={() => setAsignarOpen(false)}
                onAsignada={() => { fetchAsignacion(); fetchNegocioGestion(); }}
              />
            )}

            {/* Header */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3 lg:hidden">
                <button onClick={() => router.back()} className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-800">
                  <ArrowLeft size={12} /> Volver
                </button>
              </div>

              <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider mb-1">
                Detalle Licitación · <span className="text-zinc-600 font-mono">{codigoDecoded}</span>
              </p>

              <div className="flex items-start gap-2 flex-wrap mb-1.5">
                {tipoLabel && (
                  <span className="flex items-center gap-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full font-bold">
                    <Tag size={10} /> {licitacion.tipo_licitacion} · {tipoLabel}
                  </span>
                )}
                <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${estadoConfig.badge}`}>
                  {estadoConfig.icon} {estadoConfig.label}
                </span>
              </div>

              <h1 className="text-[18px] font-bold text-zinc-900 leading-snug">
                <Resaltar texto={licitacion.nombre} keywords={keywords} className="bg-yellow-200/70 rounded px-0.5 font-bold" />
              </h1>
              <p className="text-[12px] text-zinc-400 uppercase tracking-wide mt-0.5">
                {licitacion.organismo}
              </p>

              {/* Fila de acciones — antes vivían en la tab "Gestión" (eliminada) */}
              <div className="flex items-center gap-2 flex-wrap mt-3">
                <button
                  onClick={handleCopyCodigo}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 px-2.5 py-1.5 rounded-lg transition-colors"
                  title="Copiar código"
                >
                  {copiedCodigo ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  Copiar código
                </button>

                <button
                  onClick={handleToggleFavorite}
                  disabled={toggling}
                  className={`flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                    isFav ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100'
                  }`}
                >
                  {toggling ? <Loader2 size={12} className="animate-spin" /> : isFav ? <Star size={12} className="fill-amber-500 text-amber-500" /> : <StarOff size={12} />}
                  {isFav ? 'En favoritos' : 'Favorito'}
                </button>

                {asignadoNombre && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg" title={`Asignada a ${asignadoNombre}`}>
                    <UserCheck size={11} /> {asignadoNombre}
                  </span>
                )}
                {isAdmin && (
                  <button
                    onClick={() => setAsignarOpen(true)}
                    className={`flex items-center gap-1.5 text-white text-[12px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                      asignadoNombre ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    <Briefcase size={12} /> {asignadoNombre ? 'Reasignar' : 'Asignar'}
                  </button>
                )}

                <a
                  href={mpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <ExternalLink size={12} /> Mercado Público
                </a>
              </div>
            </div>

            {/* Mobile tabs */}
            <div className="flex gap-1 mb-5 lg:hidden overflow-x-auto pb-1">
              {NAV_SECTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                    activeSection === s.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {s.label}
                  {s.count != null && s.count > 0 && <span className="ml-1 opacity-60">{s.count}</span>}
                </button>
              ))}
            </div>

            {/* Sections */}
            <div key={activeSection} className="fade-in">
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
              {activeSection === 'resultado' && (
                <ResultadoSection codigo={codigoDecoded} mpUrl={mpUrl} />
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
                <PreguntasSection codigoDecoded={codigoDecoded} mpUrl={mpUrl} />
              )}
              {activeSection === 'criterios' && (
                <CriteriosSection
                  criterios={licitacion.criterios_evaluacion}
                  analisisIA={analisisIA}
                  criteriosViabilidad={informeViabIA?.criterios_evaluacion?.criterios}
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
                <ViabilidadIAPanel codigo={codigoDecoded} onComplete={fetchDocumentos} />
              )}
              {activeSection === 'inteligencia' && (
                <InteligenciaSection codigo={codigoDecoded} documentosAnalizables={documentosAnalizables} nombreLicitacion={licitacion.nombre} />
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT SIDEBAR — igual que /negocios/[id] cuando ya está asignada; si no,
            versión de solo lectura con un CTA para asignarla. ─────────────────── */}
        {negocioGestionCargado && (
          negocioGestion ? (
            <GestionAside
              negocio={negocioGestion}
              onNegocioChange={patch => setNegocioGestion(prev => prev ? { ...prev, ...patch } : prev)}
              viabIA={informeViabIA}
              isAdmin={isAdmin}
              fechaPublicacion={licitacion.fecha_publicacion}
              documentosCount={documentosCache.length}
              mpUrl={mpUrl}
              onDocumentosRefrescar={fetchDocumentos}
              onEliminado={() => { setNegocioGestion(null); fetchAsignacion(); }}
              onIrAViabilidad={() => setActiveSection('viabilidad')}
            />
          ) : (
            <aside className="hidden xl:flex flex-col w-56 border-l border-zinc-200/80 bg-white flex-shrink-0 overflow-y-auto p-4 gap-5">
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Publicación</p>
                <p className="text-[12px] text-zinc-600 font-medium">{fmtFecha(licitacion.fecha_publicacion)}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Cierre</p>
                <p className="text-[12px] text-zinc-600 font-medium">{fmtFecha(licitacion.fecha_cierre)}</p>
              </div>
              {documentosCache.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Documentos</p>
                  <span className="flex items-center gap-2 text-[12px] text-zinc-600 font-semibold">
                    <FolderOpen size={12} /> {documentosCache.length} archivo{documentosCache.length > 1 ? 's' : ''}
                  </span>
                </div>
              )}
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <History size={11} /> Historial
                </p>
                <HistorialLicitacion eventos={historialLigero} />
              </div>
              <div className="mt-auto pt-4 border-t border-zinc-100 space-y-2">
                <button
                  onClick={() => setAsignarOpen(true)}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold rounded-xl transition-colors"
                >
                  <Briefcase size={13} /> Asignar a negocio
                </button>
                <a href={mpUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 w-full px-3 py-2 border border-zinc-200 text-zinc-600 text-[12.5px] font-semibold rounded-xl hover:bg-zinc-50 transition-colors">
                  <ExternalLink size={13} /> Ver en Mercado Público
                </a>
              </div>
            </aside>
          )
        )}
      </div>
    </AppLayout>
  );
}



