'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Star, StarOff, ExternalLink, Copy, Check,
  Building2, MapPin, Calendar, DollarSign, Hash,
  FileText, Download, Eye, Loader2, AlertCircle, CheckCircle,
  XCircle, Package, Phone, Mail, Shield, Info, Tag,
  RefreshCw, ChevronDown, ChevronUp, MessageSquare,
  Upload, Sparkles, X, Send, Bot, User, Files, ChevronRight,
  BarChart3, TrendingUp, AlertTriangle, ListChecks,
  Brain, Zap, BookOpen, Briefcase,
} from 'lucide-react';
import { DocumentoAdjunto, Oportunidad } from '@/app/types/search.types';
import { TIPO_LICITACION_MAP, MODALIDAD_PAGO_MAP } from '@/app/types/mercado-publico.types';
import { TIPOS_LICITACION } from '@/app/types/search.types';
import { useFavorites } from '@/app/hooks/useFavorites';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { AppLayout } from '@/app/components/AppLayout';

// ======================================================
// TYPES
// ======================================================

interface MensajeChat {
  id: string;
  tipo: 'pregunta' | 'respuesta' | 'error' | 'sistema' | 'analisis_completo';
  texto: string;
  documento?: string;
  timestamp: Date;
  datosEstructurados?: any;
}

type TipoAnalisis = 'completo' | 'resumen' | 'pregunta';

interface UsuarioAsignacion {
  id: number;
  nombre: string;
  email: string;
}

// ======================================================
// UTILS
// ======================================================

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return null; }
}

function formatDateTime(d?: string | null) {
  if (!d) return null;
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return null; }
}

function formatCLP(n?: number | null) {
  if (!n || n === 0) return null;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

function formatFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDiasRestantes(fechaCierre?: string | null) {
  if (!fechaCierre) return null;
  const diff = new Date(fechaCierre).getTime() - Date.now();
  if (isNaN(diff)) return null;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getFileIcon(nombre: string) {
  const ext = nombre.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    pdf: '📄', zip: '📦', rar: '📦', doc: '📝', docx: '📝',
    xls: '📊', xlsx: '📊', png: '🖼', jpg: '🖼', dwg: '📐',
  };
  return icons[ext || ''] || '📎';
}

function esUrlAnalizable(url?: string) {
  if (!url) return false;
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext) && url.startsWith('https://');
}

function formatNegritas(texto: string) {
  return texto.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// ======================================================
// ESTADO CONFIG  (key = lic.Estado = string del CodigoEstado)
// ======================================================

const ESTADO_CONFIG: Record<string, { label: string; icon: React.ReactNode; badge: string }> = {
  '5':  { label: 'Publicada',   icon: <CheckCircle size={13} />, badge: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  '6':  { label: 'Cerrada',     icon: <XCircle     size={13} />, badge: 'bg-zinc-100 border-zinc-300 text-zinc-600' },
  '7':  { label: 'Desierta',    icon: <AlertCircle size={13} />, badge: 'bg-orange-50 border-orange-200 text-orange-700' },
  '8':  { label: 'Adjudicada',  icon: <CheckCircle size={13} />, badge: 'bg-blue-50 border-blue-200 text-blue-700' },
  '18': { label: 'Revocada',    icon: <XCircle     size={13} />, badge: 'bg-red-50 border-red-200 text-red-700' },
  '19': { label: 'Suspendida',  icon: <AlertCircle size={13} />, badge: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
};

// ======================================================
// FORMATEO IA
// ======================================================

function RespuestaFormateada({ texto }: { texto: string }) {
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

function AnalisisEstructurado({ datos }: { datos: any }) {
  if (!datos || datos.error) return <p className="text-red-500 text-sm">No se pudieron estructurar los datos del análisis.</p>;
  return (
    <div className="space-y-4">
      {datos.criteriosEvaluacion?.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 flex items-center gap-2 mb-2 text-sm">
            <BarChart3 size={13} className="text-purple-600" /> Criterios de Evaluación
          </h4>
          <div className="space-y-2">
            {datos.criteriosEvaluacion.map((c: any, i: number) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-gray-800 text-sm">{c.nombre}</span>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{c.ponderacion}%</span>
                </div>
                {c.formula && <code className="text-xs font-mono bg-white p-1.5 rounded border block mt-1">{c.formula}</code>}
              </div>
            ))}
          </div>
        </div>
      )}
      {datos.analisisExperto && (
        <div className="border-t pt-3">
          <h4 className="font-semibold text-gray-900 flex items-center gap-2 mb-2 text-sm">
            <Brain size={13} className="text-amber-600" /> Análisis Experto
          </h4>
          {datos.analisisExperto.complejidad && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              datos.analisisExperto.complejidad === 'alta' ? 'bg-red-100 text-red-700' :
              datos.analisisExperto.complejidad === 'media' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
            }`}>Complejidad: {datos.analisisExperto.complejidad}</span>
          )}
          {datos.analisisExperto.recomendaciones?.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {datos.analisisExperto.recomendaciones.map((r: string, i: number) => <li key={i}>✓ {r}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ======================================================
// LAYOUT HELPERS
// ======================================================

function InfoCard({ title, icon, children, defaultOpen = true }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden hover:-translate-y-px hover:shadow-md transition-all duration-200">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-600">{icon}</span>
          <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
        </div>
        {open ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex gap-3 py-2 border-b border-zinc-50 last:border-0">
      <span className="text-xs text-zinc-400 w-40 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-zinc-800 flex-1">{String(value)}</span>
    </div>
  );
}

// ======================================================
// SUBIR DOCUMENTOS
// ======================================================

function SubirDocumentos({ codigoLicitacion, onSubidos }: {
  codigoLicitacion: string;
  onSubidos: (docs: DocumentoAdjunto[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [progresoMsg, setProgresoMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [subidos, setSubidos] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const subirArchivos = useCallback(async (files: FileList | File[]) => {
    const lista = Array.from(files).filter(f => f.size > 0);
    if (lista.length === 0) return;
    setSubiendo(true);
    setError(null);
    try {
      const resultados: { nombre: string; url: string; size: number }[] = [];
      for (let i = 0; i < lista.length; i++) {
        const file = lista[i];
        const prefijo = lista.length > 1 ? `[${i + 1}/${lista.length}] ` : '';
        setProgresoMsg(`${prefijo}Preparando ${file.name}…`);

        const presignRes = await fetch('/api/documentos/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licitacionCodigo: codigoLicitacion,
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
          }),
        });
        if (!presignRes.ok) {
          const err = await presignRes.json().catch(() => ({}));
          throw new Error(err.error || `Error preparando subida de ${file.name}`);
        }
        const { uploadUrl, publicUrl } = await presignRes.json();

        setProgresoMsg(`${prefijo}Subiendo ${file.name}…`);
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!uploadRes.ok) throw new Error(`Error subiendo ${file.name} (${uploadRes.status})`);

        const guardarRes = await fetch('/api/documentos/guardar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licitacionCodigo: codigoLicitacion,
            documentoNombre: file.name,
            url: publicUrl,
            size: file.size,
          }),
        });
        if (!guardarRes.ok) {
          const err = await guardarRes.json().catch(() => ({}));
          throw new Error(err.error || `Error guardando ${file.name}`);
        }
        resultados.push({ nombre: file.name, url: publicUrl, size: file.size });
      }
      setSubidos(prev => prev + resultados.length);
      setProgresoMsg('');
      onSubidos(resultados.map(d => ({
        nombre: d.nombre, url: d.url, url_local: d.url, ya_descargado: true, size: d.size,
      })));
    } catch (e: any) {
      setError(e.message);
      setProgresoMsg('');
    } finally {
      setSubiendo(false);
    }
  }, [codigoLicitacion, onSubidos]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) subirArchivos(e.dataTransfer.files);
  }, [subirArchivos]);

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
          dragging ? 'border-blue-400 bg-blue-50 scale-[1.01]' : 'border-zinc-200 hover:border-blue-300 hover:bg-zinc-50'
        }`}
      >
        <input
          ref={inputRef} type="file" multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.zip,.rar"
          className="hidden"
          onChange={e => e.target.files && subirArchivos(e.target.files)}
        />
        {subiendo ? (
          <div className="flex flex-col items-center gap-1.5 py-2">
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <Loader2 size={15} className="animate-spin" /> Subiendo a la nube...
            </div>
            {progresoMsg && <p className="text-xs text-blue-500 max-w-[200px] truncate">{progresoMsg}</p>}
          </div>
        ) : (
          <div className="py-1">
            <Upload size={18} className="mx-auto text-zinc-400 mb-2" />
            <p className="text-xs font-medium text-zinc-600">Arrastra documentos de Mercado Público</p>
            <p className="text-xs text-zinc-400 mt-0.5">PDF, DOCX, XLSX • haz clic para seleccionar</p>
            {subidos > 0 && (
              <p className="text-xs text-green-600 mt-1.5 font-medium flex items-center justify-center gap-1">
                <CheckCircle size={11} /> {subidos} doc{subidos > 1 ? 's' : ''} subido{subidos > 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

// ======================================================
// DOCUMENT ROW
// ======================================================

function DocumentRow({ doc, analizable }: { doc: DocumentoAdjunto; analizable: boolean }) {
  return (
    <div className={`rounded-lg border transition-colors ${analizable ? 'bg-purple-50 border-purple-100' : 'bg-zinc-50 border-zinc-100'}`}>
      <div className="flex items-center gap-2.5 p-2.5">
        <span className="text-lg flex-shrink-0">{getFileIcon(doc.nombre)}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-zinc-800 truncate" title={doc.nombre}>{doc.nombre}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {doc.size && <span className="text-xs text-zinc-400">{formatFileSize(doc.size)}</span>}
            {analizable && (
              <span className="text-xs text-purple-600 flex items-center gap-0.5 font-medium">
                <Sparkles size={9} /> Listo para IA
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <a href={doc.url_local || doc.url} target="_blank" rel="noopener noreferrer"
            className="p-1.5 text-blue-500 hover:bg-blue-100 rounded-lg transition-colors" title="Ver">
            <Eye size={13} />
          </a>
          <a href={doc.url_local || doc.url} download={doc.nombre}
            className="p-1.5 text-green-600 hover:bg-green-100 rounded-lg transition-colors" title="Descargar">
            <Download size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}

// ======================================================
// PANEL CHAT IA
// ======================================================

const ANALISIS_RAPIDOS = [
  { emoji: '🔬', texto: 'Análisis completo de la licitación', tipo: 'completo', icon: <Brain size={13} /> },
  { emoji: '📋', texto: 'Resumen ejecutivo', tipo: 'resumen', icon: <BookOpen size={13} /> },
  { emoji: '📊', texto: 'Extraer criterios de evaluación', tipo: 'completo', icon: <BarChart3 size={13} /> },
  { emoji: '⚠️', texto: 'Identificar riesgos y oportunidades', tipo: 'completo', icon: <AlertTriangle size={13} /> },
  { emoji: '📝', texto: 'Requisitos para participar', tipo: 'pregunta', preguntaTexto: '¿Cuáles son todos los requisitos para participar en esta licitación?', icon: <ListChecks size={13} /> },
  { emoji: '💰', texto: 'Presupuesto y condiciones económicas', tipo: 'pregunta', preguntaTexto: '¿Cuál es el presupuesto disponible y las condiciones de pago?', icon: <DollarSign size={13} /> },
  { emoji: '📅', texto: 'Plazos y fechas clave', tipo: 'pregunta', preguntaTexto: '¿Cuáles son todos los plazos y fechas importantes del proceso?', icon: <Calendar size={13} /> },
  { emoji: '🏆', texto: 'Evaluación y puntajes', tipo: 'pregunta', preguntaTexto: '¿Cómo se evalúan las ofertas? ¿Cuáles son los criterios y ponderaciones?', icon: <TrendingUp size={13} /> },
];

function PanelChatIA({ documentosAnalizables, nombreLicitacion }: {
  documentosAnalizables: DocumentoAdjunto[];
  nombreLicitacion: string;
}) {
  const [docActivo, setDocActivo] = useState<DocumentoAdjunto | null>(null);
  const [modoTodos, setModoTodos] = useState(false);
  const [pregunta, setPregunta] = useState('');
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [cargando, setCargando] = useState(false);
  const [mostrarPreguntas, setMostrarPreguntas] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (documentosAnalizables.length > 0 && !docActivo) setDocActivo(documentosAnalizables[0]);
  }, [documentosAnalizables, docActivo]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, cargando]);

  const agregarMensaje = (msg: Omit<MensajeChat, 'id' | 'timestamp'>) => {
    const nuevo: MensajeChat = { ...msg, id: Math.random().toString(36).slice(2), timestamp: new Date() };
    setMensajes(prev => [...prev, nuevo]);
    return nuevo.id;
  };

  const analizarDoc = async (doc: DocumentoAdjunto, tipo: TipoAnalisis, preguntaTexto?: string) => {
    const body: any = { pdfUrl: doc.url, documentoNombre: doc.nombre, tipoAnalisis: tipo };
    if (tipo === 'pregunta' && preguntaTexto) body.pregunta = preguntaTexto;
    const res = await fetch('/api/analizar-documento', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  };

  const ejecutarAnalisis = async (tipo: TipoAnalisis, preguntaTexto?: string) => {
    if (cargando) return;
    if (!modoTodos && !docActivo) {
      agregarMensaje({ tipo: 'error', texto: 'No hay documento seleccionado para analizar' });
      return;
    }
    setCargando(true);
    setMostrarPreguntas(false);

    const textoPregunta = tipo === 'completo' ? '🔬 Analizando licitación en profundidad...' :
      tipo === 'resumen' ? '📋 Generando resumen ejecutivo...' : (preguntaTexto || 'Consultando...');
    agregarMensaje({ tipo: 'pregunta', texto: textoPregunta });

    try {
      if (modoTodos) {
        agregarMensaje({ tipo: 'sistema', texto: `Analizando ${documentosAnalizables.length} documento(s)...` });
        const resultados: { nombre: string; data: any }[] = [];
        for (const doc of documentosAnalizables) {
          try {
            const respuesta = await analizarDoc(doc, tipo, preguntaTexto);
            resultados.push({ nombre: doc.nombre, data: respuesta });
          } catch { resultados.push({ nombre: doc.nombre, data: { error: 'No se pudo analizar' } }); }
        }
        if (tipo === 'completo' && resultados[0]?.data?.analisis) {
          agregarMensaje({ tipo: 'analisis_completo', texto: `**Análisis de ${resultados.length} documento(s)**`, datosEstructurados: resultados[0].data.analisis });
        } else {
          const unified = resultados.map(r => `**📄 ${r.nombre}**\n${r.data.resumen || r.data.respuesta || ''}`).join('\n\n---\n\n');
          agregarMensaje({ tipo: 'respuesta', texto: unified });
        }
      } else {
        const respuesta = await analizarDoc(docActivo!, tipo, preguntaTexto);
        if (tipo === 'completo' && respuesta.analisis) {
          agregarMensaje({ tipo: 'analisis_completo', texto: `**Análisis:** ${docActivo!.nombre}`, documento: docActivo!.nombre, datosEstructurados: respuesta.analisis });
        } else {
          agregarMensaje({ tipo: 'respuesta', texto: respuesta.resumen || respuesta.respuesta || 'Sin respuesta', documento: docActivo!.nombre });
        }
      }
    } catch (e: any) {
      agregarMensaje({ tipo: 'error', texto: e.message || 'Error al analizar el documento' });
    } finally {
      setCargando(false);
      inputRef.current?.focus();
    }
  };

  const enviar = async (q?: string) => {
    const texto = (q || pregunta).trim();
    if (!texto || cargando) return;
    if (!modoTodos && !docActivo) return;
    const rapido = ANALISIS_RAPIDOS.find(a => a.texto === texto);
    if (rapido) {
      await ejecutarAnalisis(rapido.tipo as TipoAnalisis, (rapido as any).preguntaTexto);
      setPregunta('');
      return;
    }
    await ejecutarAnalisis('pregunta', texto);
    setPregunta('');
  };

  const hayDocs = documentosAnalizables.length > 0;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col hover:-translate-y-px hover:shadow-md transition-all duration-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-100 bg-gradient-to-r from-purple-50 to-indigo-50">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 bg-purple-600 rounded-lg">
            <Bot size={13} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-zinc-800">Asistente IA · Documentos</span>
          {hayDocs && (
            <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
              {documentosAnalizables.length} doc{documentosAnalizables.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {hayDocs && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <button onClick={() => setModoTodos(false)}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${!modoTodos ? 'bg-purple-600 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'}`}>
                Un documento
              </button>
              <button onClick={() => setModoTodos(true)}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${modoTodos ? 'bg-purple-600 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'}`}>
                <Files size={11} /> Todos ({documentosAnalizables.length})
              </button>
            </div>
            {!modoTodos && documentosAnalizables.length > 1 && (
              <select value={docActivo?.nombre || ''} onChange={e => setDocActivo(documentosAnalizables.find(d => d.nombre === e.target.value) || null)}
                className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 focus:ring-1 focus:ring-purple-500">
                {documentosAnalizables.map(d => <option key={d.nombre} value={d.nombre}>{getFileIcon(d.nombre)} {d.nombre}</option>)}
              </select>
            )}
            {!modoTodos && documentosAnalizables.length === 1 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-lg border border-zinc-200">
                <span className="text-sm">{getFileIcon(documentosAnalizables[0].nombre)}</span>
                <span className="text-xs text-zinc-700 truncate">{documentosAnalizables[0].nombre}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[240px] max-h-[420px]">
        {!hayDocs ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center">
            <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center mb-3">
              <Upload size={18} className="text-purple-400" />
            </div>
            <p className="text-sm font-medium text-zinc-600">Sin documentos aún</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-[200px]">
              Descarga documentos de Mercado Público y arrástralos arriba para analizarlos con IA
            </p>
          </div>
        ) : mensajes.length === 0 && mostrarPreguntas ? (
          <div>
            <p className="text-xs text-zinc-400 mb-2.5 text-center">
              {modoTodos ? `Analiza ${documentosAnalizables.length} documentos` : `Analizando: "${docActivo?.nombre || ''}"`}
            </p>
            <div className="mb-3">
              <p className="text-xs font-medium text-zinc-500 mb-1.5 flex items-center gap-1"><Zap size={10} /> Análisis inteligentes</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ANALISIS_RAPIDOS.slice(0, 4).map(p => (
                  <button key={p.texto} onClick={() => enviar(p.texto)}
                    className="flex items-center gap-1.5 text-left px-2 py-1.5 text-xs text-zinc-700 bg-zinc-50 hover:bg-purple-50 hover:text-purple-700 border border-zinc-100 hover:border-purple-200 rounded-lg transition-colors">
                    <span className="text-purple-500">{p.icon}</span>
                    <span className="truncate">{p.texto}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-1.5 flex items-center gap-1"><MessageSquare size={10} /> Consultas específicas</p>
              <div className="grid grid-cols-1 gap-1.5">
                {ANALISIS_RAPIDOS.slice(4).map(p => (
                  <button key={p.texto} onClick={() => enviar(p.texto)}
                    className="flex items-center gap-2 text-left px-3 py-2 text-xs text-zinc-700 bg-zinc-50 hover:bg-purple-50 hover:text-purple-700 border border-zinc-100 hover:border-purple-200 rounded-lg transition-colors group">
                    <span className="text-sm flex-shrink-0">{p.emoji}</span>
                    <span className="flex-1">{p.texto}</span>
                    <ChevronRight size={11} className="text-zinc-300 group-hover:text-purple-400" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {mensajes.map(msg => (
              <div key={msg.id} className={`flex gap-2 ${msg.tipo === 'pregunta' ? 'flex-row-reverse' : 'flex-row'}`}>
                {msg.tipo === 'pregunta' ? (
                  <div className="flex-shrink-0 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center">
                    <User size={13} className="text-white" />
                  </div>
                ) : msg.tipo === 'sistema' ? null : (
                  <div className="flex-shrink-0 w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center">
                    <Bot size={13} className="text-white" />
                  </div>
                )}
                {msg.tipo === 'sistema' ? (
                  <div className="w-full text-center">
                    <span className="inline-flex items-center gap-1.5 text-xs text-purple-600 bg-purple-50 px-3 py-1 rounded-full">
                      <Loader2 size={10} className="animate-spin" /> {msg.texto}
                    </span>
                  </div>
                ) : msg.tipo === 'pregunta' ? (
                  <div className="max-w-[85%] bg-blue-600 text-white text-sm px-3 py-2 rounded-xl rounded-tr-sm">{msg.texto}</div>
                ) : msg.tipo === 'error' ? (
                  <div className="max-w-[85%] bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-xl rounded-tl-sm flex items-start gap-1.5">
                    <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {msg.texto}
                  </div>
                ) : msg.tipo === 'analisis_completo' ? (
                  <div className="max-w-[95%] bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 px-4 py-3 rounded-xl rounded-tl-sm">
                    {msg.documento && <p className="text-xs text-purple-600 font-medium mb-2 flex items-center gap-1"><span>{getFileIcon(msg.documento)}</span>{msg.documento}</p>}
                    <AnalisisEstructurado datos={msg.datosEstructurados} />
                    <p className="text-xs text-zinc-400 mt-3 text-right">{msg.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                ) : (
                  <div className="max-w-[92%] bg-zinc-50 border border-zinc-100 px-3.5 py-3 rounded-xl rounded-tl-sm">
                    {msg.documento && <p className="text-xs text-purple-600 font-medium mb-1.5 flex items-center gap-1"><span>{getFileIcon(msg.documento)}</span>{msg.documento}</p>}
                    <RespuestaFormateada texto={msg.texto} />
                    <p className="text-xs text-zinc-400 mt-2 text-right">{msg.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                )}
              </div>
            ))}
            {cargando && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center">
                  <Bot size={13} className="text-white" />
                </div>
                <div className="bg-zinc-50 border border-zinc-100 px-4 py-3 rounded-xl rounded-tl-sm">
                  <div className="flex gap-1.5 items-center">
                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    <span className="text-xs text-zinc-500 ml-1">Analizando…</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      {hayDocs && (
        <div className="border-t border-zinc-100 p-3">
          {mensajes.length > 0 && (
            <div className="flex gap-1 mb-2 flex-wrap">
              {ANALISIS_RAPIDOS.slice(0, 3).map(p => (
                <button key={p.texto} onClick={() => enviar(p.texto)} disabled={cargando}
                  className="text-xs px-2.5 py-1 bg-zinc-100 hover:bg-purple-100 hover:text-purple-700 text-zinc-600 rounded-full transition-colors disabled:opacity-50 flex items-center gap-1">
                  {p.icon}
                  <span className="hidden sm:inline">{p.texto.length > 20 ? p.texto.slice(0, 20) + '…' : p.texto}</span>
                  <span className="sm:hidden">{p.emoji}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef} value={pregunta} onChange={e => setPregunta(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              placeholder="Escribe tu pregunta..." rows={2} disabled={cargando}
              className="flex-1 text-sm border border-zinc-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none disabled:bg-zinc-50 disabled:text-zinc-400"
            />
            <button onClick={() => enviar()} disabled={cargando || !pregunta.trim()}
              className="flex-shrink-0 p-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-300 text-white rounded-xl transition-colors">
              {cargando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          <p className="text-xs text-zinc-400 mt-1 text-center">Enter para enviar · Shift+Enter nueva línea</p>
        </div>
      )}
    </div>
  );
}

// ======================================================
// MODAL: ASIGNAR A NEGOCIO (admin only)
// ======================================================

function AsignarNegocioModal({
  licitacion,
  onClose,
  onAsignada,
}: {
  licitacion: Oportunidad;
  onClose: () => void;
  onAsignada: () => void;
}) {
  const [usuarios, setUsuarios] = useState<UsuarioAsignacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [asignandoA, setAsignandoA] = useState('');
  const [guardando, setGuardando] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetch('/api/usuarios')
      .then(r => r.json())
      .then(d => { if (d.success) setUsuarios(d.usuarios || []); })
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  const handleAsignar = async () => {
    if (!asignandoA) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/negocios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacion_codigo:    licitacion.codigo,
          licitacion_nombre:    licitacion.nombre,
          licitacion_organismo: licitacion.organismo,
          licitacion_monto:     licitacion.monto_total || licitacion.monto_estimado || null,
          licitacion_cierre:    licitacion.fecha_cierre || null,
          licitacion_estado:    licitacion.estado || null,
          licitacion_tipo:      licitacion.tipo_licitacion || null,
          licitacion_region:    licitacion.region || null,
          asignado_a:           parseInt(asignandoA),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const u = usuarios.find(u => String(u.id) === asignandoA);
        toastSuccess('Licitación asignada', `Asignada a ${u?.nombre || 'usuario'}`);
        onAsignada();
        onClose();
      } else {
        toastError('Error al asignar', data.error || 'Intenta de nuevo');
      }
    } catch {
      toastError('Error de conexión', 'No se pudo asignar la licitación');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md scale-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <Briefcase size={15} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-800">Asignar a Negocio</h3>
              <p className="text-xs text-zinc-500">Selecciona el responsable</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors">
            <X size={16} className="text-zinc-500" />
          </button>
        </div>

        {/* Licitación info */}
        <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-100">
          <p className="text-xs font-mono text-zinc-500 mb-0.5">{licitacion.codigo}</p>
          <p className="text-sm font-medium text-zinc-800 line-clamp-2">{licitacion.nombre}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{licitacion.organismo}</p>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {cargando ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-blue-500" />
            </div>
          ) : usuarios.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">No hay usuarios disponibles</p>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                Asignar a
              </label>
              <select
                value={asignandoA}
                onChange={e => setAsignandoA(e.target.value)}
                className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              >
                <option value="">— Selecciona un usuario —</option>
                {usuarios.map(u => (
                  <option key={u.id} value={String(u.id)}>
                    {u.nombre || u.email} {u.nombre ? `(${u.email})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-600 border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleAsignar}
            disabled={!asignandoA || guardando}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Briefcase size={14} />}
            {guardando ? 'Asignando...' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======================================================
// PÁGINA PRINCIPAL
// ======================================================

export default function LicitacionDetallePage() {
  const params   = useParams();
  const router   = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { usuario } = useSession();
  const { success: toastSuccess, error: toastError } = useToast();

  const [licitacion,      setLicitacion]      = useState<Oportunidad | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [toggling,        setToggling]        = useState(false);
  const [copiedCodigo,    setCopiedCodigo]    = useState(false);
  const [documentosCache, setDocumentosCache] = useState<DocumentoAdjunto[]>([]);
  const [cargandoDocs,    setCargandoDocs]    = useState(false);
  const [showItems,       setShowItems]       = useState(false);
  const [showFechas,      setShowFechas]      = useState(false);
  const [asignarOpen,     setAsignarOpen]     = useState(false);

  const codigo         = params.codigo as string;
  const codigoDecoded  = decodeURIComponent(codigo);
  const isAdmin        = usuario?.rol === 'admin';

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
            ya_descargado: true,
          })));
        }
      }
    } catch {}
    finally { setCargandoDocs(false); }
  }, [codigoDecoded]);

  useEffect(() => {
    if (codigoDecoded) {
      fetchLicitacion();
      fetchDocumentos();
    }
  }, [codigoDecoded, fetchLicitacion, fetchDocumentos]);

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

  const handleDocsSubidos = (nuevos: DocumentoAdjunto[]) => {
    setDocumentosCache(prev => {
      const merged = [...prev];
      nuevos.forEach(n => { if (!merged.some(m => m.nombre === n.nombre)) merged.push(n); });
      return merged;
    });
  };

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
  const estadoConfig = ESTADO_CONFIG[licitacion.estado] || {
    label: licitacion.estado,
    icon: <Info size={13} />,
    badge: 'bg-zinc-100 border-zinc-200 text-zinc-600',
  };

  const diasRestantes  = getDiasRestantes(licitacion.fecha_cierre);
  const isFav          = isFavorite(licitacion.codigo);
  const monto          = formatCLP(licitacion.monto_total || licitacion.monto_estimado);
  const tipoLabel      = licitacion.tipo_licitacion
    ? (TIPO_LICITACION_MAP[licitacion.tipo_licitacion] || TIPOS_LICITACION[licitacion.tipo_licitacion] || licitacion.tipo_licitacion)
    : null;

  const documentosAnalizables = documentosCache.filter(d => esUrlAnalizable(d.url_local || d.url));
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
      {/* Modal asignar negocio */}
      {asignarOpen && (
        <AsignarNegocioModal
          licitacion={licitacion}
          onClose={() => setAsignarOpen(false)}
          onAsignada={() => {}}
        />
      )}

      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col xl:flex-row gap-6">

          {/* ═══ COLUMNA PRINCIPAL ═══════════════════════════════════════════════ */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* HEADER CARD ─────────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden hover:-translate-y-px hover:shadow-md transition-all duration-200">
              {/* Dark banner */}
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Code + badges row */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <button
                        onClick={handleCopyCodigo}
                        className="flex items-center gap-1.5 font-mono text-sm text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg hover:bg-slate-700 transition-colors"
                        title="Copiar código"
                      >
                        <Hash size={11} />
                        {codigoDecoded}
                        {copiedCodigo
                          ? <Check size={12} className="text-green-400 ml-1" />
                          : <Copy size={11} className="text-slate-500 ml-1" />}
                      </button>
                      {tipoLabel && (
                        <span className="flex items-center gap-1 text-xs text-blue-300 bg-blue-900/40 border border-blue-700/40 px-2 py-0.5 rounded-full">
                          <Tag size={9} />
                          {licitacion.tipo_licitacion} · {tipoLabel}
                        </span>
                      )}
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${estadoConfig.badge}`}>
                        {estadoConfig.icon} {estadoConfig.label}
                      </span>
                    </div>

                    {/* Title */}
                    <h1 className="text-xl sm:text-2xl font-bold text-white leading-snug mb-2">
                      {licitacion.nombre}
                    </h1>

                    {/* Organismo */}
                    <div className="flex items-center gap-2 text-slate-400 text-sm flex-wrap">
                      <Building2 size={13} />
                      <span>{licitacion.organismo}</span>
                      {licitacion.region && (
                        <>
                          <span className="text-slate-600">·</span>
                          <MapPin size={12} />
                          <span>{licitacion.region}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Favorito */}
                    <button
                      onClick={handleToggleFavorite}
                      disabled={toggling}
                      title={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors border border-slate-700 disabled:opacity-50"
                    >
                      {toggling
                        ? <Loader2 size={16} className="text-slate-400 animate-spin" />
                        : isFav
                          ? <Star size={16} className="text-amber-400 fill-amber-400" />
                          : <StarOff size={16} className="text-slate-400" />}
                    </button>

                    {/* Asignar negocio (admin) */}
                    {isAdmin && (
                      <button
                        onClick={() => setAsignarOpen(true)}
                        title="Asignar a negocio"
                        className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                      >
                        <Briefcase size={13} /> Asignar
                      </button>
                    )}

                    {/* Ver en MP */}
                    <a
                      href={mpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-xl transition-colors"
                    >
                      <ExternalLink size={13} /> Mercado Público
                    </a>
                  </div>
                </div>
              </div>

              {/* KPIs */}
              {kpis.length > 0 && (
                <div className={`grid divide-x divide-y sm:divide-y-0 divide-zinc-100 ${
                  kpis.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
                  kpis.length === 3 ? 'grid-cols-1 sm:grid-cols-3' :
                  kpis.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
                }`}>
                  {kpis.map((kpi, i) => (
                    <div key={i} className="px-5 py-4">
                      <div className="flex items-center gap-1.5 mb-1">
                        {kpi.icon}
                        <span className="text-xs text-zinc-500">{kpi.label}</span>
                      </div>
                      <p className="text-sm font-semibold text-zinc-900 line-clamp-1">{kpi.value}</p>
                      {kpi.sub && <p className="text-xs text-zinc-400 mt-0.5 truncate">{kpi.sub}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* DESCRIPCIÓN ─────────────────────────────────────────────────── */}
            {licitacion.descripcion && (
              <InfoCard title="Descripción / Objeto" icon={<FileText size={15} />}>
                <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-line">{licitacion.descripcion}</p>
              </InfoCard>
            )}

            {/* ORGANISMO ───────────────────────────────────────────────────── */}
            <InfoCard title="Organismo comprador" icon={<Building2 size={15} />}>
              <div className="divide-y divide-zinc-50">
                <InfoRow label="Nombre organismo"   value={licitacion.organismo} />
                <InfoRow label="Unidad compradora"  value={licitacion.comprador} />
                <InfoRow label="RUT"                value={licitacion.rut_organismo} />
                <InfoRow label="Dirección"          value={licitacion.direccion} />
                <InfoRow label="Comuna"             value={licitacion.comuna_unidad} />
                <InfoRow label="Región"             value={licitacion.region} />
              </div>
            </InfoCard>

            {/* CARACTERÍSTICAS ─────────────────────────────────────────────── */}
            {(tipoLabel || licitacion.tipo_convocatoria || licitacion.caracteristicas?.modalidad_pago
              || licitacion.caracteristicas?.plazo_contrato_dias) && (
              <InfoCard title="Características del proceso" icon={<Shield size={15} />}>
                <div className="divide-y divide-zinc-50">
                  <InfoRow label="Tipo de licitación"  value={tipoLabel} />
                  <InfoRow label="Tipo convocatoria"   value={licitacion.tipo_convocatoria} />
                  <InfoRow label="Moneda"              value={licitacion.moneda} />
                  <InfoRow label="Modalidad de pago"
                    value={licitacion.caracteristicas?.modalidad_pago
                      ? MODALIDAD_PAGO_MAP[parseInt(licitacion.caracteristicas.modalidad_pago)] || licitacion.caracteristicas.modalidad_pago
                      : null} />
                  <InfoRow label="Duración contrato"
                    value={licitacion.caracteristicas?.plazo_contrato_dias
                      ? `${licitacion.caracteristicas.plazo_contrato_dias} días` : null} />
                  <InfoRow label="Subcontratación"
                    value={licitacion.caracteristicas?.subcontratacion === true ? 'Permitida'
                      : licitacion.caracteristicas?.subcontratacion === false ? 'No permitida' : null} />
                  <InfoRow label="Renovable"
                    value={licitacion.caracteristicas?.renovable === true ? 'Sí'
                      : licitacion.caracteristicas?.renovable === false ? 'No' : null} />
                </div>
              </InfoCard>
            )}

            {/* CONTACTO ────────────────────────────────────────────────────── */}
            {(licitacion.contacto?.nombre || licitacion.contacto?.email || licitacion.contacto?.telefono) && (
              <InfoCard title="Responsable del contrato" icon={<Phone size={15} />}>
                <div className="divide-y divide-zinc-50">
                  <InfoRow label="Nombre"  value={licitacion.contacto?.nombre} />
                  <InfoRow label="Cargo"   value={licitacion.contacto?.cargo} />
                  {licitacion.contacto?.email && (
                    <div className="flex gap-3 py-2 border-b border-zinc-50 last:border-0">
                      <span className="text-xs text-zinc-400 w-40 flex-shrink-0 pt-0.5">Email</span>
                      <a href={`mailto:${licitacion.contacto.email}`}
                        className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        <Mail size={12} /> {licitacion.contacto.email}
                      </a>
                    </div>
                  )}
                  {licitacion.contacto?.telefono && (
                    <div className="flex gap-3 py-2">
                      <span className="text-xs text-zinc-400 w-40 flex-shrink-0 pt-0.5">Teléfono</span>
                      <a href={`tel:${licitacion.contacto.telefono}`}
                        className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        <Phone size={12} /> {licitacion.contacto.telefono}
                      </a>
                    </div>
                  )}
                </div>
              </InfoCard>
            )}

            {/* ADJUDICACIÓN ────────────────────────────────────────────────── */}
            {(licitacion.url_acta || licitacion.numero_oferentes) && (
              <InfoCard title="Adjudicación" icon={<CheckCircle size={15} />}>
                <div className="space-y-2">
                  {licitacion.numero_oferentes !== undefined && licitacion.numero_oferentes > 0 && (
                    <p className="text-sm text-zinc-700">
                      <strong>{licitacion.numero_oferentes}</strong> proveedor{licitacion.numero_oferentes !== 1 ? 'es' : ''} participaron
                    </p>
                  )}
                  {licitacion.url_acta && (
                    <a href={licitacion.url_acta} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                      <ExternalLink size={13} /> Ver acta de adjudicación
                    </a>
                  )}
                </div>
              </InfoCard>
            )}

            {/* ITEMS ───────────────────────────────────────────────────────── */}
            {licitacion.items && licitacion.items.length > 0 && (
              <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden hover:-translate-y-px hover:shadow-md transition-all duration-200">
                <button
                  onClick={() => setShowItems(!showItems)}
                  className="w-full px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Package size={15} className="text-blue-600" />
                    <span className="text-sm font-semibold text-zinc-800">Productos / Servicios</span>
                    <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-xs rounded-full">
                      {licitacion.items.length}
                    </span>
                  </div>
                  {showItems
                    ? <ChevronUp size={14} className="text-zinc-400" />
                    : <ChevronDown size={14} className="text-zinc-400" />}
                </button>
                {showItems && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 text-left">
                          <th className="px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase w-10">#</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase">Producto / Servicio</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase hidden sm:table-cell">Categoría</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase text-right">Cant.</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase text-right hidden sm:table-cell">Monto unit.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {licitacion.items.map((item, i) => (
                          <tr key={i} className="hover:bg-zinc-50 transition-colors">
                            <td className="px-4 py-3 text-zinc-400 text-xs">{item.correlativo ?? i + 1}</td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-zinc-800">{item.nombre_producto}</p>
                              {item.descripcion && <p className="text-xs text-zinc-500 mt-0.5">{item.descripcion}</p>}
                            </td>
                            <td className="px-4 py-3 text-xs text-zinc-500 hidden sm:table-cell">{item.categoria || '—'}</td>
                            <td className="px-4 py-3 text-right text-sm">{item.cantidad} {item.unidad}</td>
                            <td className="px-4 py-3 text-right text-zinc-700 font-medium hidden sm:table-cell">
                              {item.monto_unitario ? formatCLP(item.monto_unitario) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* CRONOGRAMA ──────────────────────────────────────────────────── */}
            {fechasAdic.length > 0 && (
              <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden hover:-translate-y-px hover:shadow-md transition-all duration-200">
                <button
                  onClick={() => setShowFechas(!showFechas)}
                  className="w-full px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Calendar size={15} className="text-blue-600" />
                    <span className="text-sm font-semibold text-zinc-800">Cronograma del proceso</span>
                    <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-xs rounded-full">{fechasAdic.length} fechas</span>
                  </div>
                  {showFechas
                    ? <ChevronUp size={14} className="text-zinc-400" />
                    : <ChevronDown size={14} className="text-zinc-400" />}
                </button>
                {showFechas && (
                  <div className="p-5">
                    <div className="relative">
                      <div className="absolute left-2.5 top-0 bottom-0 w-px bg-zinc-200" />
                      <div className="space-y-4">
                        {fechasAdic.map((f, i) => {
                          const d = new Date(f.fecha!);
                          const pasada = d < new Date();
                          return (
                            <div key={i} className="flex gap-4 pl-8 relative">
                              <div className={`absolute left-0 top-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                pasada ? 'bg-blue-600 border-blue-600' : 'bg-white border-zinc-300'
                              }`}>
                                {pasada && <Check size={10} className="text-white" />}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{f.label}</p>
                                <p className="text-sm text-zinc-800 mt-0.5">{formatDateTime(f.fecha)}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Volver */}
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 py-2.5 text-zinc-500 hover:text-zinc-700 text-sm transition-colors"
            >
              <ArrowLeft size={14} /> Volver a resultados
            </button>
          </div>

          {/* ═══ SIDEBAR ══════════════════════════════════════════════════════ */}
          <div className="xl:w-[420px] flex-shrink-0 space-y-4">

            {/* DOCUMENTOS ──────────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden hover:-translate-y-px hover:shadow-md transition-all duration-200">
              <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-blue-600" />
                  <span className="text-sm font-semibold text-zinc-800">Documentos</span>
                  {!cargandoDocs && documentosCache.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                      {documentosCache.length}
                    </span>
                  )}
                  {documentosAnalizables.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium flex items-center gap-0.5">
                      <Sparkles size={9} /> {documentosAnalizables.length} IA
                    </span>
                  )}
                </div>
                <button onClick={fetchDocumentos} title="Recargar"
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors">
                  <RefreshCw size={13} />
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Instrucciones */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-4">
                  <p className="text-xs font-semibold text-blue-900 mb-3 flex items-center gap-1.5">
                    <Download size={11} /> Cómo agregar documentos
                  </p>
                  <div className="space-y-2.5">
                    {[
                      <>Abre la licitación en Mercado Público y ve a la pestaña <strong>"Adjuntos"</strong></>,
                      <>Descarga los archivos a tu computador</>,
                      <>Arrástralos al área de abajo — quedan guardados en la plataforma</>,
                    ].map((texto, i) => (
                      <div key={i} className="flex gap-2.5 items-start">
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                        <p className="text-xs text-zinc-600 leading-relaxed">{texto}</p>
                      </div>
                    ))}
                    <a href={mpUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors">
                      <ExternalLink size={11} /> Ir a Mercado Público
                    </a>
                  </div>
                </div>

                <SubirDocumentos codigoLicitacion={codigoDecoded} onSubidos={handleDocsSubidos} />

                {cargandoDocs ? (
                  <div className="flex items-center justify-center py-4 gap-2 text-sm text-zinc-500">
                    <Loader2 size={15} className="animate-spin text-blue-500" /> Cargando documentos...
                  </div>
                ) : documentosCache.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-500 flex items-center gap-1.5">
                      <CheckCircle size={11} className="text-green-500" />
                      {documentosCache.length} documento{documentosCache.length > 1 ? 's' : ''} guardado{documentosCache.length > 1 ? 's' : ''}
                    </p>
                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                      {documentosCache.map((doc, i) => (
                        <DocumentRow key={`${doc.nombre}-${i}`} doc={doc} analizable={esUrlAnalizable(doc.url_local || doc.url)} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-2">
                      <FileText size={17} className="text-zinc-300" />
                    </div>
                    <p className="text-xs text-zinc-500 font-medium">Sin documentos aún</p>
                    <p className="text-xs text-zinc-400 mt-0.5">Sigue los pasos de arriba</p>
                  </div>
                )}
              </div>
            </div>

            {/* PANEL CHAT IA ───────────────────────────────────────────────── */}
            <PanelChatIA documentosAnalizables={documentosAnalizables} nombreLicitacion={licitacion.nombre} />

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
