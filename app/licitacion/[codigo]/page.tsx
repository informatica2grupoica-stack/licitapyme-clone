// src/app/licitacion/[codigo]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    Calendar, Building2, DollarSign, Clock, MapPin, ArrowLeft,
    Star, StarOff, ExternalLink, Package, Copy, Check,
    Tag, FileText, GraduationCap, Award,
    TrendingUp, BarChart3, Globe, Phone, Mail, MapPinned,
    Clock8, Shield, Truck, Wallet, Link as LinkIcon,
    Info, Layers, Hash, Briefcase, Users, CalendarDays,
    CreditCard, Landmark, FileCheck, AlertTriangle, CheckCircle,
    XCircle, Clock as ClockIcon, Download, Eye, MessageCircle,
    FileArchive, FileImage, FileJson, DownloadCloud, Loader2
} from 'lucide-react';
import { ESTADOS_LICITACION, TIPOS_LICITACION, MONEDAS, DocumentoAdjunto } from '@/app/types/search.types';
import { useFavorites } from '@/app/hooks/useFavorites';
import { descargarDocumento, formatFileSize, getIconForDocument, getMockDocumentos } from '@/app/services/documentosService';
import { ChatDocumentos } from '@/app/components/ChatDocumentos';

// Interfaces completas
interface LicitacionDetalle {
    // Identificación
    codigo: string;
    id?: string;
    nombre: string;
    titulo?: string;

    // Descripción
    descripcion?: string;
    objeto_licitacion?: string;
    resumen_ia?: string;

    // Organismo
    organismo: string;
    comprador?: string;
    unidad_compra?: string;
    codigo_organismo: string;
    rut_organismo?: string;
    direccion?: string;
    comuna_unidad?: string;

    // Ubicación
    region?: string;
    comuna?: string;
    ubicacion?: string;

    // Estado
    estado: string;
    codigo_estado?: number;

    // Fechas
    fecha_publicacion: string;
    fecha_cierre: string;
    fecha_adjudicacion?: string;
    fecha_creacion?: string;
    fecha_inicio?: string;
    fecha_final?: string;
    fecha_apertura_tecnica?: string;
    fecha_apertura_economica?: string;
    fecha_estimada_adjudicacion?: string;
    fecha_publicacion_respuestas?: string;
    fecha_inicio_preguntas?: string;
    fecha_fin_preguntas?: string;
    fecha_visita_terreno?: string;

    // Montos
    monto_total?: number;
    monto_estimado?: number;
    moneda?: string;

    // Tipos
    tipo_licitacion?: string;
    tipo_convocatoria?: string;
    tipo_fuente?: string;
    source?: string;

    // Items
    items: ItemDetalle[];

    // Documentos adjuntos
    documentos?: DocumentoAdjunto[];

    // URLs
    url?: string;
    detail_url?: string;
    search_url?: string;

    // Scores
    semantic_score?: number;
    final_score?: number;
    rerank_score?: number;
    rerank_reason?: string | null;

    // IA
    ia_enriched?: boolean;

    // Metadata adicional
    reclamos?: number;
    cantidad_ofertas?: number;
    numero_oferentes?: number;
    url_acta?: string;
    url_json?: string;
    url_csv?: string;
    url_ocds?: string;

    // Características
    etapas?: number;
    toma_razon?: boolean;
    publicidad_ofertas?: boolean;
    subcontratacion?: boolean;
    renovable?: boolean;
    contrato?: boolean;
    obras?: boolean;
    informada?: boolean;

    // Plazos
    plazo_contrato_dias?: number;
    unidad_tiempo_contrato?: string;
    modalidad_pago?: string;

    // Garantías
    garantia_seriedad_monto?: number;
    garantia_cumplimiento_porcentaje?: number;

    // Criterios de evaluación
    criterios_evaluacion?: CriterioEvaluacion[];

    // Contacto
    email_responsable?: string;
    nombre_responsable?: string;
    telefono_responsable?: string;
}

interface ItemDetalle {
    licitacion_id?: string;
    correlativo?: number;
    codigo_producto: string;
    nombre_producto: string;
    cantidad: number;
    unidad: string;
    monto_total?: number;
    monto_unitario?: number;
    descripcion?: string;
    categoria?: string;
    codigo_categoria?: string;
}

interface CriterioEvaluacion {
    nombre: string;
    ponderacion: number;
    descripcion?: string;
}

export default function LicitacionDetallePage() {
    const params = useParams();
    const router = useRouter();
    const { isFavorite, toggleFavorite, addFavorite } = useFavorites();
    const [licitacion, setLicitacion] = useState<LicitacionDetalle | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toggling, setToggling] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [descargando, setDescargando] = useState<string | null>(null);
    const [descargandoTodos, setDescargandoTodos] = useState(false);

    const codigo = params.codigo as string;

    useEffect(() => {
        if (codigo) {
            fetchLicitacion();
        }
    }, [codigo]);

    const fetchLicitacion = async () => {
        setLoading(true);
        setError(null);

        try {
            // 1. Obtener datos básicos de la API
            const response = await fetch(`/api/search?q=${codigo}`);
            const data = await response.json();

            if (data.resultados && data.resultados.length > 0) {
                const lic = data.resultados[0];

                // 2. Obtener documentos REALES desde Mercado Público
                let documentos: DocumentoAdjunto[] = [];
                try {
                    const docsResponse = await fetch(`/api/documentos/${codigo}`);
                    const docsData = await docsResponse.json();
                    if (docsData.success && docsData.documentos.length > 0) {
                        documentos = docsData.documentos.map((doc: any) => ({
                            nombre: doc.nombre,
                            url: doc.url,
                            size: doc.size ? parseInt(doc.size) : undefined,
                        }));
                        console.log(`📄 Documentos reales obtenidos: ${documentos.length}`);
                    }
                } catch (docsError) {
                    console.error('Error obteniendo documentos reales:', docsError);
                }

                // Si no hay documentos reales, usar mock
                if (documentos.length === 0) {
                    documentos = getMockDocumentos(lic.codigo);
                }

                // 3. Criterios de evaluación mock
                const criteriosEvaluacion: CriterioEvaluacion[] = [
                    { nombre: 'Precio', ponderacion: 70, descripcion: 'Oferta económica más baja' },
                    { nombre: 'Plazo de ejecución', ponderacion: 15, descripcion: 'Menor plazo de entrega' },
                    { nombre: 'Experiencia', ponderacion: 10, descripcion: 'Experiencia en obras similares' },
                    { nombre: 'Mano de obra local', ponderacion: 5, descripcion: 'Contratación de personal de la comuna' }
                ];

                setLicitacion({ ...lic, documentos, criterios_evaluacion: criteriosEvaluacion });

                // Guardar en favoritos si el usuario ya la tiene
                if (isFavorite(lic.codigo)) {
                    await addFavorite({
                        codigo: lic.codigo,
                        nombre: lic.nombre,
                        organismo: lic.organismo,
                        monto_total: lic.monto_total,
                        monto_estimado: lic.monto_estimado,
                        moneda: lic.moneda,
                        fecha_cierre: lic.fecha_cierre,
                        fecha_adjudicacion: lic.fecha_adjudicacion,
                        estado: lic.estado,
                        tipo_licitacion: lic.tipo_licitacion,
                        region: lic.region,
                        comuna: lic.comuna,
                        descripcion: lic.descripcion || lic.objeto_licitacion,
                        resumen_ia: lic.resumen_ia,
                        detail_url: lic.detail_url,
                        search_url: lic.search_url,
                        semantic_score: lic.semantic_score,
                        final_score: lic.final_score
                    });
                }
            } else {
                setError('No se encontró la licitación');
            }
        } catch (err) {
            setError('Error al cargar la licitación');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleFavorite = async () => {
        if (!licitacion) return;

        setToggling(true);
        await toggleFavorite({
            codigo: licitacion.codigo,
            nombre: licitacion.nombre,
            organismo: licitacion.organismo,
            monto_total: licitacion.monto_total,
            monto_estimado: licitacion.monto_estimado,
            moneda: licitacion.moneda,
            fecha_cierre: licitacion.fecha_cierre,
            fecha_adjudicacion: licitacion.fecha_adjudicacion,
            estado: licitacion.estado,
            tipo_licitacion: licitacion.tipo_licitacion,
            region: licitacion.region,
            comuna: licitacion.comuna,
            descripcion: licitacion.descripcion || licitacion.objeto_licitacion,
            resumen_ia: licitacion.resumen_ia,
            detail_url: licitacion.detail_url,
            search_url: licitacion.search_url,
            semantic_score: licitacion.semantic_score,
            final_score: licitacion.final_score
        });
        setToggling(false);
    };

    const handleDescargarDocumento = async (documento: DocumentoAdjunto) => {
        setDescargando(documento.nombre);
        await descargarDocumento(documento.url, documento.nombre);
        setDescargando(null);
    };

    const handleDescargarTodos = async () => {
        if (!licitacion?.documentos) return;
        setDescargandoTodos(true);
        for (const doc of licitacion.documentos) {
            await descargarDocumento(doc.url, doc.nombre);
            await new Promise(r => setTimeout(r, 500));
        }
        setDescargandoTodos(false);
    };

    const handleCopyCodigo = async () => {
        await navigator.clipboard.writeText(licitacion?.codigo || '');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyUrl = async () => {
        await navigator.clipboard.writeText(window.location.href);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
    };

    const handleVerDocumento = (url: string) => {
        window.open(url, '_blank');
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return 'No disponible';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Fecha inválida';
        return date.toLocaleDateString('es-CL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatCurrency = (amount?: number, moneda?: string) => {
        if (!amount) return 'No especificado';
        const currency = moneda === 'USD' ? 'USD' : moneda === 'EUR' ? 'EUR' : 'CLP';
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: currency,
            maximumFractionDigits: 0
        }).format(amount);
    };

    const formatNumber = (num?: number) => {
        if (!num) return '0';
        return num.toLocaleString('es-CL');
    };

    const getDiasRestantes = (fechaCierre: string) => {
        const cierre = new Date(fechaCierre);
        const hoy = new Date();
        const diffTime = cierre.getTime() - hoy.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const getEstadoInfo = (estado: string) => {
        const label = ESTADOS_LICITACION[estado] || 'Estado desconocido';
        let color = 'bg-gray-100 text-gray-800';
        let icon = <Info size={14} />;

        if (estado === '5') {
            color = 'bg-green-100 text-green-800';
            icon = <CheckCircle size={14} />;
        } else if (estado === '6') {
            color = 'bg-gray-100 text-gray-800';
            icon = <XCircle size={14} />;
        } else if (estado === '7') {
            color = 'bg-red-100 text-red-800';
            icon = <AlertTriangle size={14} />;
        } else if (estado === '8') {
            color = 'bg-blue-100 text-blue-800';
            icon = <Award size={14} />;
        }
        return { label, color, icon };
    };

    const getTipoLicitacionLabel = (tipo?: string) => {
        if (!tipo) return 'No especificado';
        return TIPOS_LICITACION[tipo] || tipo;
    };

    const getIconoPorTipo = (nombre: string) => {
        const ext = nombre.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'pdf': return <FileText size={18} className="text-red-500" />;
            case 'zip': case 'rar': return <FileArchive size={18} className="text-yellow-600" />;
            case 'jpg': case 'png': case 'gif': return <FileImage size={18} className="text-green-500" />;
            case 'json': return <FileJson size={18} className="text-blue-500" />;
            default: return <FileText size={18} className="text-gray-500" />;
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 py-8">
                <div className="container mx-auto px-4 max-w-5xl">
                    <div className="bg-white rounded-lg shadow p-8 animate-pulse">
                        <div className="h-8 bg-gray-200 rounded w-3/4 mb-4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/3 mb-6"></div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-lg"></div>)}
                        </div>
                        <div className="space-y-3">
                            <div className="h-4 bg-gray-200 rounded w-full"></div>
                            <div className="h-4 bg-gray-200 rounded w-full"></div>
                            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !licitacion) {
        return (
            <div className="min-h-screen bg-gray-50 py-8">
                <div className="container mx-auto px-4 max-w-4xl">
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-6xl mb-4">🔍</div>
                        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Licitación no encontrada</h2>
                        <p className="text-gray-600 mb-6">{error || 'No se pudo encontrar la licitación solicitada'}</p>
                        <button
                            onClick={() => router.back()}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                        >
                            <ArrowLeft size={18} />
                            Volver
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const estadoInfo = getEstadoInfo(licitacion.estado);
    const diasRestantes = getDiasRestantes(licitacion.fecha_cierre);
    const isFav = isFavorite(licitacion.codigo);
    const tituloMostrar = licitacion.titulo || licitacion.nombre;

    // Agrupar fechas adicionales
    const fechasAdicionales = [
        { label: 'Creación', fecha: licitacion.fecha_creacion, icon: <CalendarDays size={14} /> },
        { label: 'Inicio preguntas', fecha: licitacion.fecha_inicio_preguntas, icon: <MessageCircle size={14} /> },
        { label: 'Fin preguntas', fecha: licitacion.fecha_fin_preguntas, icon: <MessageCircle size={14} /> },
        { label: 'Publicación respuestas', fecha: licitacion.fecha_publicacion_respuestas, icon: <FileText size={14} /> },
        { label: 'Apertura técnica', fecha: licitacion.fecha_apertura_tecnica, icon: <Eye size={14} /> },
        { label: 'Apertura económica', fecha: licitacion.fecha_apertura_economica, icon: <Eye size={14} /> },
        { label: 'Adjudicación estimada', fecha: licitacion.fecha_estimada_adjudicacion, icon: <Award size={14} /> },
    ].filter(f => f.fecha);

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="container mx-auto px-4 max-w-6xl">
                {/* Botones de navegación */}
                <div className="flex justify-between items-center mb-4">
                    <button
                        onClick={() => router.back()}
                        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft size={18} />
                        Volver a resultados
                    </button>
                    <button
                        onClick={handleCopyUrl}
                        className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm transition-colors"
                    >
                        {copiedUrl ? <Check size={16} className="text-green-600" /> : <LinkIcon size={16} />}
                        {copiedUrl ? 'Copiado' : 'Copiar enlace'}
                    </button>
                </div>

                {/* Tarjeta principal */}
                <div className="bg-white rounded-lg shadow-xl overflow-hidden">
                    {/* Header con gradiente */}
                    <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-6 py-5">
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <h1 className="text-2xl md:text-3xl font-bold text-white">
                                        {tituloMostrar}
                                    </h1>
                                    <button
                                        onClick={handleToggleFavorite}
                                        disabled={toggling}
                                        className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                                        title={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                                    >
                                        {isFav ? (
                                            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                                        ) : (
                                            <StarOff className="w-5 h-5 text-white" />
                                        )}
                                    </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1">
                                        <Hash size={14} className="text-blue-200" />
                                        <span className="text-sm text-blue-100 font-mono">{licitacion.codigo}</span>
                                        <button
                                            onClick={handleCopyCodigo}
                                            className="p-0.5 hover:bg-white/20 rounded transition-colors"
                                            title="Copiar código"
                                        >
                                            {copied ? (
                                                <Check size={14} className="text-green-300" />
                                            ) : (
                                                <Copy size={14} className="text-blue-200" />
                                            )}
                                        </button>
                                    </div>
                                    <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full ${estadoInfo.color}`}>
                                        {estadoInfo.icon}
                                        {estadoInfo.label}
                                    </span>
                                    {licitacion.ia_enriched && (
                                        <span className="px-2 py-1 text-xs bg-purple-500/30 text-purple-100 rounded-full flex items-center gap-1">
                                            <GraduationCap size={12} />
                                            IA Enriquecido
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Contenido */}
                    <div className="p-6">
                        {/* === SECCIÓN 1: INFORMACIÓN PRINCIPAL === */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                            <div className="flex items-start gap-3 p-3 bg-gradient-to-r from-blue-50 to-white rounded-xl border border-blue-100">
                                <Building2 size={20} className="text-blue-600 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-500 uppercase tracking-wide">Organismo</p>
                                    <p className="text-gray-900 font-semibold text-sm truncate" title={licitacion.organismo}>
                                        {licitacion.organismo}
                                    </p>
                                    {licitacion.rut_organismo && (
                                        <p className="text-xs text-gray-400 mt-1">RUT: {licitacion.rut_organismo}</p>
                                    )}
                                    {licitacion.unidad_compra && (
                                        <p className="text-xs text-gray-400">Unidad: {licitacion.unidad_compra}</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-start gap-3 p-3 bg-gradient-to-r from-green-50 to-white rounded-xl border border-green-100">
                                <DollarSign size={20} className="text-green-600 mt-0.5" />
                                <div>
                                    <p className="text-xs text-gray-500 uppercase tracking-wide">Monto</p>
                                    <p className="text-xl font-bold text-gray-900">
                                        {formatCurrency(licitacion.monto_total || licitacion.monto_estimado, licitacion.moneda)}
                                    </p>
                                    {licitacion.monto_estimado && licitacion.monto_total !== licitacion.monto_estimado && (
                                        <p className="text-xs text-gray-500">Estimado: {formatCurrency(licitacion.monto_estimado, licitacion.moneda)}</p>
                                    )}
                                    {licitacion.moneda && (
                                        <p className="text-xs text-gray-400">{MONEDAS[licitacion.moneda] || licitacion.moneda}</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-start gap-3 p-3 bg-gradient-to-r from-orange-50 to-white rounded-xl border border-orange-100">
                                <Clock size={20} className="text-orange-600 mt-0.5" />
                                <div>
                                    <p className="text-xs text-gray-500 uppercase tracking-wide">Cierre</p>
                                    <p className="text-gray-900 font-semibold text-sm">{formatDate(licitacion.fecha_cierre)}</p>
                                    {diasRestantes > 0 && (
                                        <p className="text-xs text-orange-600 font-medium mt-1 flex items-center gap-1">
                                            <ClockIcon size={12} />
                                            {diasRestantes} días restantes
                                        </p>
                                    )}
                                    {diasRestantes <= 0 && diasRestantes > -30 && (
                                        <p className="text-xs text-red-600 font-medium mt-1">Cerrada hace {Math.abs(diasRestantes)} días</p>
                                    )}
                                </div>
                            </div>

                            {licitacion.tipo_licitacion && (
                                <div className="flex items-start gap-3 p-3 bg-gradient-to-r from-purple-50 to-white rounded-xl border border-purple-100">
                                    <FileText size={20} className="text-purple-600 mt-0.5" />
                                    <div>
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Tipo</p>
                                        <p className="text-gray-900 font-semibold text-sm">{licitacion.tipo_licitacion}</p>
                                        <p className="text-xs text-gray-400">{getTipoLicitacionLabel(licitacion.tipo_licitacion)}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* === SECCIÓN 2: UBICACIÓN Y PUBLICACIÓN === */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                            {licitacion.region && (
                                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                    <MapPin size={18} className="text-gray-500 mt-0.5" />
                                    <div>
                                        <p className="text-xs text-gray-500 uppercase">Ubicación</p>
                                        <p className="text-gray-900 text-sm font-medium">{licitacion.region}</p>
                                        {licitacion.comuna && <p className="text-xs text-gray-500">Comuna: {licitacion.comuna}</p>}
                                        {licitacion.ubicacion && <p className="text-xs text-gray-500">{licitacion.ubicacion}</p>}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                <Calendar size={18} className="text-gray-500 mt-0.5" />
                                <div>
                                    <p className="text-xs text-gray-500 uppercase">Publicación</p>
                                    <p className="text-gray-900 text-sm">{formatDate(licitacion.fecha_publicacion)}</p>
                                </div>
                            </div>

                            {licitacion.fecha_adjudicacion && (
                                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                    <Award size={18} className="text-gray-500 mt-0.5" />
                                    <div>
                                        <p className="text-xs text-gray-500 uppercase">Adjudicación</p>
                                        <p className="text-gray-900 text-sm">{formatDate(licitacion.fecha_adjudicacion)}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* === SECCIÓN 3: FECHAS ADICIONALES === */}
                        {fechasAdicionales.length > 0 && (
                            <div className="mb-8">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 border-b pb-2">
                                    <CalendarDays size={18} className="text-gray-500" />
                                    Cronograma del proceso
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {fechasAdicionales.map((item, idx) => (
                                        <div key={idx} className="flex items-center gap-2 text-sm p-2 bg-gray-50 rounded-lg">
                                            {item.icon}
                                            <div>
                                                <p className="text-xs text-gray-500">{item.label}</p>
                                                <p className="text-gray-700">{formatDate(item.fecha!)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* === SECCIÓN 4: RESÚMEN IA === */}
                        {licitacion.resumen_ia && (
                            <div className="mb-8 p-5 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <GraduationCap size={20} className="text-purple-600" />
                                    Resumen generado por IA
                                </h3>
                                <p className="text-gray-700 text-base leading-relaxed">{licitacion.resumen_ia}</p>
                                {licitacion.semantic_score && (
                                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                                        <TrendingUp size={14} />
                                        <span>Score semántico: {Math.round(licitacion.semantic_score * 100)}%</span>
                                        <div className="flex-1 h-1.5 bg-gray-200 rounded-full max-w-32">
                                            <div className="h-full bg-purple-600 rounded-full" style={{ width: `${(licitacion.semantic_score || 0) * 100}%` }}></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* === SECCIÓN 5: DESCRIPCIÓN === */}
                        {(licitacion.descripcion || licitacion.objeto_licitacion) && (
                            <div className="mb-8 p-5 bg-gray-50 rounded-xl">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <FileText size={18} />
                                    Descripción de la licitación
                                </h3>
                                <p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">
                                    {licitacion.descripcion || licitacion.objeto_licitacion}
                                </p>
                            </div>
                        )}


                        {licitacion.items && licitacion.items.length > 0 && (
                            <div className="mb-8">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 border-b pb-2">
                                    <Package size={18} className="text-gray-500" />
                                    Productos y servicios solicitados
                                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full ml-2">{licitacion.items.length} items</span>
                                </h3>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 border rounded-lg">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Código</th>
                                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unidad</th>
                                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {licitacion.items.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                                                        {item.nombre_producto}
                                                        {item.descripcion && <p className="text-xs text-gray-500 mt-1">{item.descripcion}</p>}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{item.codigo_producto}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-700 text-center">{formatNumber(item.cantidad)}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-700">{item.unidad}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-700 text-right font-medium">
                                                        {formatCurrency(item.monto_total || item.monto_unitario, licitacion.moneda)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        {licitacion.monto_total !== undefined && licitacion.monto_total !== null && licitacion.monto_total > 0 && (
                                            <tfoot className="bg-gray-50">
                                                <tr>
                                                    <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                                                        Monto total:
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-sm font-bold text-blue-600">
                                                        {formatCurrency(licitacion.monto_total, licitacion.moneda)}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* === SECCIÓN 7: CRITERIOS DE EVALUACIÓN === */}
                        {licitacion.criterios_evaluacion && licitacion.criterios_evaluacion.length > 0 && (
                            <div className="mb-8 p-5 bg-blue-50 rounded-xl border border-blue-200">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <BarChart3 size={18} className="text-blue-600" />
                                    Criterios de evaluación
                                </h3>
                                <div className="space-y-3">
                                    {licitacion.criterios_evaluacion.map((criterio, idx) => (
                                        <div key={idx}>
                                            <div className="flex justify-between items-center text-sm mb-1">
                                                <span className="font-medium text-gray-700">{criterio.nombre}</span>
                                                <span className="text-blue-600 font-semibold">{criterio.ponderacion}%</span>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2">
                                                <div
                                                    className="bg-blue-600 rounded-full h-2"
                                                    style={{ width: `${criterio.ponderacion}%` }}
                                                />
                                            </div>
                                            {criterio.descripcion && (
                                                <p className="text-xs text-gray-500 mt-1">{criterio.descripcion}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* === SECCIÓN 8: DOCUMENTOS ADJUNTOS === */}
                        {/* === SECCIÓN 8: DOCUMENTOS ADJUNTOS === */}
                        {licitacion.documentos && licitacion.documentos.length > 0 && (
                            <div className="mb-8 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                                {/* Cabecera */}
                                <div className="px-5 py-3 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                        <FileText size={18} className="text-blue-600" />
                                        Documentos de la licitación
                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-2">
                                            {licitacion.documentos.length} documentos
                                        </span>
                                    </h3>
                                </div>

                                {/* Contenido */}
                                <div className="p-4 space-y-3">
                                    {/* Mensaje informativo */}
                                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm">
                                        <p className="flex items-start gap-2 text-blue-800">
                                            <Info size={16} className="mt-0.5 flex-shrink-0" />
                                            <span>
                                                Los documentos están disponibles en Mercado Público.
                                                Haz clic en el 👁️ para ver cada documento (requiere resolver captcha).
                                            </span>
                                        </p>
                                    </div>

                                    {/* Lista de documentos con botones individuales */}
                                    <div className="space-y-2">
                                        {licitacion.documentos.map((doc, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                                            >
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    {getIconoPorTipo(doc.nombre)}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 truncate" title={doc.nombre}>
                                                            {doc.nombre}
                                                        </p>
                                                        {doc.size && (
                                                            <p className="text-xs text-gray-400">{formatFileSize(doc.size)}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleVerDocumento(doc.url)}
                                                    className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                                                    title="Ver documento en Mercado Público"
                                                >
                                                    <Eye size={18} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-5 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 text-center flex items-center justify-center gap-2">
                                    <span>🔗</span>
                                    <span>Al hacer clic en 👁️, serás redirigido a Mercado Público (deberás resolver un captcha)</span>
                                </div>
                            </div>
                        )}

                        {/* === SECCIÓN 9: SCORES Y MÉTRICAS === */}
                        {(licitacion.semantic_score || licitacion.final_score || licitacion.rerank_score) && (
                            <div className="mb-8 p-5 bg-blue-50 rounded-xl border border-blue-200">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <BarChart3 size={18} className="text-blue-600" />
                                    Métricas de relevancia
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    {licitacion.semantic_score && (
                                        <div>
                                            <p className="text-xs text-gray-500">Score semántico</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <div className="flex-1 h-2 bg-gray-200 rounded-full">
                                                    <div className="h-full bg-blue-600 rounded-full" style={{ width: `${(licitacion.semantic_score || 0) * 100}%` }}></div>
                                                </div>
                                                <span className="text-sm font-semibold">{Math.round(licitacion.semantic_score * 100)}%</span>
                                            </div>
                                        </div>
                                    )}
                                    {licitacion.final_score && (
                                        <div>
                                            <p className="text-xs text-gray-500">Score final</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <div className="flex-1 h-2 bg-gray-200 rounded-full">
                                                    <div className="h-full bg-green-600 rounded-full" style={{ width: `${(licitacion.final_score || 0) * 100}%` }}></div>
                                                </div>
                                                <span className="text-sm font-semibold">{Math.round(licitacion.final_score * 100)}%</span>
                                            </div>
                                        </div>
                                    )}
                                    {licitacion.rerank_reason && (
                                        <div className="col-span-full mt-2 pt-2 border-t border-blue-200">
                                            <p className="text-xs text-gray-500">Rerank reason</p>
                                            <p className="text-xs text-gray-600">{licitacion.rerank_reason}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* === SECCIÓN 10: CARACTERÍSTICAS ADICIONALES === */}
                        {(licitacion.subcontratacion !== undefined || licitacion.renovable !== undefined ||
                            licitacion.toma_razon !== undefined || licitacion.publicidad_ofertas !== undefined) && (
                                <div className="mb-8 p-5 bg-gray-50 rounded-xl">
                                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                        <Shield size={18} className="text-gray-500" />
                                        Características del proceso
                                    </h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {licitacion.subcontratacion !== undefined && (
                                            <div className="flex items-center gap-2">
                                                {licitacion.subcontratacion ? <CheckCircle size={16} className="text-green-600" /> : <XCircle size={16} className="text-red-500" />}
                                                <span className="text-sm">Subcontratación permitida</span>
                                            </div>
                                        )}
                                        {licitacion.renovable !== undefined && (
                                            <div className="flex items-center gap-2">
                                                {licitacion.renovable ? <CheckCircle size={16} className="text-green-600" /> : <XCircle size={16} className="text-red-500" />}
                                                <span className="text-sm">Contrato renovable</span>
                                            </div>
                                        )}
                                        {licitacion.toma_razon !== undefined && (
                                            <div className="flex items-center gap-2">
                                                {licitacion.toma_razon ? <CheckCircle size={16} className="text-green-600" /> : <XCircle size={16} className="text-red-500" />}
                                                <span className="text-sm">Requiere toma de razón</span>
                                            </div>
                                        )}
                                        {licitacion.publicidad_ofertas !== undefined && (
                                            <div className="flex items-center gap-2">
                                                {licitacion.publicidad_ofertas ? <CheckCircle size={16} className="text-green-600" /> : <XCircle size={16} className="text-red-500" />}
                                                <span className="text-sm">Ofertas públicas</span>
                                            </div>
                                        )}
                                    </div>
                                    {licitacion.modalidad_pago && (
                                        <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-2 text-sm">
                                            <CreditCard size={16} className="text-gray-500" />
                                            <span>Modalidad de pago: {licitacion.modalidad_pago}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                        {/* === SECCIÓN 11: GARANTÍAS === */}
                        {(licitacion.garantia_seriedad_monto || licitacion.garantia_cumplimiento_porcentaje) && (
                            <div className="mb-8 p-5 bg-gray-50 rounded-xl">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <Wallet size={18} className="text-gray-500" />
                                    Garantías requeridas
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                    {licitacion.garantia_seriedad_monto && (
                                        <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                                            <span>🔒</span>
                                            <div>
                                                <p className="text-xs text-gray-500">Seriedad de oferta</p>
                                                <p className="font-medium">{formatCurrency(licitacion.garantia_seriedad_monto, licitacion.moneda)}</p>
                                            </div>
                                        </div>
                                    )}
                                    {licitacion.garantia_cumplimiento_porcentaje && (
                                        <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                                            <span>📜</span>
                                            <div>
                                                <p className="text-xs text-gray-500">Cumplimiento de contrato</p>
                                                <p className="font-medium">{licitacion.garantia_cumplimiento_porcentaje}% del contrato</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* === SECCIÓN 12: INFORMACIÓN DE CONTACTO === */}
                        {(licitacion.nombre_responsable || licitacion.email_responsable || licitacion.telefono_responsable) && (
                            <div className="mb-8 p-5 bg-gray-50 rounded-xl">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <Users size={18} className="text-gray-500" />
                                    Contacto responsable
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                    {licitacion.nombre_responsable && (
                                        <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                                            <span>👤</span>
                                            <span>{licitacion.nombre_responsable}</span>
                                        </div>
                                    )}
                                    {licitacion.email_responsable && (
                                        <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                                            <Mail size={14} className="text-gray-400" />
                                            <a href={`mailto:${licitacion.email_responsable}`} className="text-blue-600 hover:underline truncate">
                                                {licitacion.email_responsable}
                                            </a>
                                        </div>
                                    )}
                                    {licitacion.telefono_responsable && (
                                        <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                                            <Phone size={14} className="text-gray-400" />
                                            <span>{licitacion.telefono_responsable}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* === SECCIÓN 13: ENLACES A MERCADO PÚBLICO === */}
                        <div className="mb-8 p-5 bg-gradient-to-r from-yellow-50 to-amber-50 rounded-xl border border-yellow-200">
                            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <ExternalLink size={18} className="text-yellow-600" />
                                Acceso a Mercado Público
                            </h3>
                            <div className="space-y-3">
                                <a
                                    href={`https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${licitacion.codigo}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 text-blue-700 hover:text-blue-900 hover:underline break-all text-sm font-medium p-2 bg-white rounded-lg border border-yellow-100 hover:shadow-sm transition-all"
                                >
                                    <span className="text-xl">🔗</span>
                                    <span>Ver ficha completa en Mercado Público (Enlace oficial)</span>
                                </a>

                                {licitacion.detail_url && licitacion.detail_url !== `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${licitacion.codigo}` && (
                                    <a
                                        href={licitacion.detail_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-3 text-blue-600 hover:text-blue-800 hover:underline break-all text-sm p-2 bg-white rounded-lg border border-gray-100"
                                    >
                                        <span>📄</span>
                                        <span>Ver ficha detallada (alternativa)</span>
                                    </a>
                                )}

                                {licitacion.search_url && (
                                    <a
                                        href={licitacion.search_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-3 text-blue-600 hover:text-blue-800 hover:underline break-all text-sm p-2 bg-white rounded-lg border border-gray-100"
                                    >
                                        <span>🔍</span>
                                        <span>Buscar en Mercado Público</span>
                                    </a>
                                )}

                                <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-gray-600">
                                    <div className="flex items-center gap-1">
                                        <span>📋</span>
                                        <span>Código:</span>
                                        <code className="bg-yellow-100 px-2 py-0.5 rounded font-mono text-sm">{licitacion.codigo}</code>
                                        <button onClick={handleCopyCodigo} className="text-gray-500 hover:text-gray-700">
                                            {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span>🔗</span>
                                        <span>Compartir:</span>
                                        <button onClick={handleCopyUrl} className="text-gray-500 hover:text-gray-700">
                                            {copiedUrl ? 'Copiado' : 'Copiar enlace'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* === FOOTER === */}
                        <div className="pt-5 border-t border-gray-200 text-xs text-gray-400 flex flex-wrap justify-between items-center gap-3">
                            <div className="flex items-center gap-2">
                                <span>📡</span>
                                <span>Datos obtenidos de la API de Mercado Público de Chile</span>
                            </div>
                            {licitacion.source && (
                                <div className="flex items-center gap-1">
                                    <Globe size={12} />
                                    <span>Fuente: {licitacion.source}</span>
                                </div>
                            )}
                            {licitacion.tipo_fuente && (
                                <div className="flex items-center gap-1">
                                    <Layers size={12} />
                                    <span>Tipo: {licitacion.tipo_fuente}</span>
                                </div>
                            )}
                            {licitacion.id && (
                                <div className="flex items-center gap-1">
                                    <Hash size={12} />
                                    <span>ID: {licitacion.id.substring(0, 8)}...</span>
                                </div>
                            )}
                        </div>
                        <ChatDocumentos
                            documentos={licitacion.documentos || []}
                            licitacionCodigo={licitacion.codigo}
                        />
                    </div>
                </div>
            </div>
        </div>

    );

}
