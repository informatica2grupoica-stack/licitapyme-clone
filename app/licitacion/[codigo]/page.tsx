'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Star, StarOff, ExternalLink, Copy, Check,
  Building2, MapPin, Calendar, DollarSign, Clock, Hash,
  FileText, Download, Eye, Loader2, AlertCircle, CheckCircle,
  XCircle, Package, Phone, Mail, Shield, Info, Tag,
  RefreshCw, ChevronDown, ChevronUp, MessageSquare,
  Upload, Sparkles, X, Send, Bot, User, Files, ChevronRight,
  BarChart3, FileSearch, TrendingUp, AlertTriangle, ListChecks,
  LayoutTemplate, Brain, Zap, BookOpen
} from 'lucide-react';
import { TIPOS_LICITACION, MODALIDADES_PAGO, DocumentoAdjunto, Oportunidad } from '@/app/types/search.types';
import { TIPO_LICITACION_MAP, MODALIDAD_PAGO_MAP, UNIDAD_TIEMPO_MAP, TIPO_ACTO_ADJUDICACION_MAP } from '@/app/types/mercado-publico.types';
import { useFavorites } from '@/app/hooks/useFavorites';
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

// ======================================================
// UTILS
// ======================================================

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return d; }
}

function formatDateTime(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return d; }
}

function formatCLP(n?: number | null) {
  if (!n) return null;
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
  return Math.ceil((new Date(fechaCierre).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const ESTADO_CONFIG: Record<string, { label: string; icon: React.ReactNode; cls: string; badge: string }> = {
  '5':  { label: 'Publicada / Activa', icon: <CheckCircle size={14} />, cls: 'text-emerald-700', badge: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  '6':  { label: 'Cerrada',            icon: <XCircle size={14} />,     cls: 'text-gray-600',    badge: 'bg-gray-100 border-gray-200 text-gray-600' },
  '7':  { label: 'Desierta',           icon: <AlertCircle size={14} />, cls: 'text-orange-700',  badge: 'bg-orange-50 border-orange-200 text-orange-700' },
  '8':  { label: 'Adjudicada',         icon: <CheckCircle size={14} />, cls: 'text-blue-700',    badge: 'bg-blue-50 border-blue-200 text-blue-700' },
  '18': { label: 'Revocada',           icon: <XCircle size={14} />,     cls: 'text-red-700',     badge: 'bg-red-50 border-red-200 text-red-700' },
  '19': { label: 'Suspendida',         icon: <AlertCircle size={14} />, cls: 'text-yellow-700',  badge: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
};

function getFileIcon(nombre: string) {
  const ext = nombre.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = { pdf: '📄', zip: '📦', rar: '📦', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', png: '🖼', jpg: '🖼', dwg: '📐' };
  return icons[ext || ''] || '📎';
}

function esUrlAnalizable(url?: string) {
  if (!url) return false;
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext) && url.startsWith('https://');
}

// Renderiza respuesta IA con formato básico (negritas, bullets)
function RespuestaFormateada({ texto }: { texto: string }) {
  const lineas = texto.split('\n');
  return (
    <div className="space-y-1.5 text-sm text-gray-800 leading-relaxed">
      {lineas.map((linea, i) => {
        if (!linea.trim()) return <div key={i} className="h-1" />;
        // Bullet points
        if (linea.trim().startsWith('- ') || linea.trim().startsWith('• ')) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-purple-400 mt-0.5 flex-shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: formatNegritas(linea.replace(/^[\-•]\s*/, '')) }} />
            </div>
          );
        }
        // Numerados
        if (/^\d+\.\s/.test(linea.trim())) {
          const num = linea.match(/^(\d+)\./)?.[1];
          return (
            <div key={i} className="flex gap-2">
              <span className="text-purple-600 font-semibold min-w-[1.2rem] flex-shrink-0">{num}.</span>
              <span dangerouslySetInnerHTML={{ __html: formatNegritas(linea.replace(/^\d+\.\s*/, '')) }} />
            </div>
          );
        }
        // Encabezados con **
        if (linea.trim().startsWith('**') && linea.trim().endsWith('**')) {
          return <p key={i} className="font-semibold text-gray-900 mt-2" dangerouslySetInnerHTML={{ __html: formatNegritas(linea) }} />;
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: formatNegritas(linea) }} />;
      })}
    </div>
  );
}

function formatNegritas(texto: string) {
  return texto.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Componente para mostrar análisis estructurado (criterios de evaluación, etc.)
function AnalisisEstructurado({ datos }: { datos: any }) {
  if (!datos || datos.error) {
    return <p className="text-red-500">No se pudieron estructurar los datos del análisis.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Criterios de Evaluación */}
      {datos.criteriosEvaluacion && datos.criteriosEvaluacion.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <BarChart3 size={14} className="text-purple-600" />
            Criterios de Evaluación
          </h4>
          <div className="space-y-2">
            {datos.criteriosEvaluacion.map((criterio: any, idx: number) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium text-gray-800 text-sm">{criterio.nombre}</span>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    {criterio.ponderacion}%
                  </span>
                </div>
                {criterio.subcriterios && criterio.subcriterios.map((sub: any, subIdx: number) => (
                  <div key={subIdx} className="mt-2 text-xs text-gray-600">
                    <span className="font-medium">{sub.nombre}:</span>
                    {sub.condiciones && sub.condiciones.length > 0 && (
                      <div className="ml-3 mt-1 space-y-0.5">
                        {sub.condiciones.map((cond: any, condIdx: number) => (
                          <div key={condIdx} className="flex justify-between">
                            <span>{cond.condicion}</span>
                            <span className="font-mono">{cond.puntaje} pts</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {criterio.formula && (
                  <div className="mt-2 text-xs font-mono bg-white p-2 rounded border">
                    {criterio.formula}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Requisitos */}
      {datos.requisitos && (
        <div>
          <h4 className="font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <ListChecks size={14} className="text-blue-600" />
            Requisitos de Participación
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {datos.requisitos.administrativos?.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-2">
                <span className="font-medium">Administrativos:</span>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {datos.requisitos.administrativos.map((req: string, i: number) => (
                    <li key={i}>• {req}</li>
                  ))}
                </ul>
              </div>
            )}
            {datos.requisitos.tecnicos?.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-2">
                <span className="font-medium">Técnicos:</span>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {datos.requisitos.tecnicos.map((req: string, i: number) => (
                    <li key={i}>• {req}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Análisis Experto */}
      {datos.analisisExperto && (
        <div className="border-t pt-3">
          <h4 className="font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Brain size={14} className="text-amber-600" />
            Análisis Experto
          </h4>
          <div className="space-y-2 text-xs">
            {datos.analisisExperto.complejidad && (
              <div className="flex gap-2">
                <span className="font-medium">Complejidad:</span>
                <span className={`px-2 py-0.5 rounded-full ${
                  datos.analisisExperto.complejidad === 'alta' ? 'bg-red-100 text-red-700' :
                  datos.analisisExperto.complejidad === 'media' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-green-100 text-green-700'
                }`}>
                  {datos.analisisExperto.complejidad}
                </span>
              </div>
            )}
            {datos.analisisExperto.recomendaciones?.length > 0 && (
              <div>
                <span className="font-medium">Recomendaciones:</span>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {datos.analisisExperto.recomendaciones.map((rec: string, i: number) => (
                    <li key={i}>✓ {rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fórmula de Puntaje Final */}
      {datos.formulaPuntajeFinal && (
        <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
          <span className="font-medium text-xs">Fórmula de Puntaje Final:</span>
          <code className="block text-xs font-mono mt-1 text-amber-800 break-all">
            {datos.formulaPuntajeFinal}
          </code>
        </div>
      )}
    </div>
  );
}

// ======================================================
// SUB-COMPONENTES
// ======================================================

function InfoCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-36 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{value}</span>
    </div>
  );
}

// ─── Subir documentos ──────────────────────────────────────────────────────
function SubirDocumentos({
  codigoLicitacion,
  onSubidos,
}: {
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

        setProgresoMsg(`${lista.length > 1 ? `[${i + 1}/${lista.length}] ` : ''}Subiendo ${file.name}…`);
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });

        if (!uploadRes.ok) {
          throw new Error(`Error subiendo ${file.name} (${uploadRes.status})`);
        }

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
          dragging ? 'border-blue-400 bg-blue-50 scale-[1.01]' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.zip,.rar"
          className="hidden"
          onChange={e => e.target.files && subirArchivos(e.target.files)}
        />
        {subiendo ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-2">
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <Loader2 size={16} className="animate-spin" />
              Subiendo a la nube...
            </div>
            {progresoMsg && (
              <p className="text-xs text-blue-500 max-w-[200px] truncate">{progresoMsg}</p>
            )}
          </div>
        ) : (
          <div className="py-1">
            <Upload size={20} className="mx-auto text-gray-400 mb-2" />
            <p className="text-xs font-medium text-gray-600">
              Arrastra los documentos descargados de Mercado Público
            </p>
            <p className="text-xs text-gray-400 mt-0.5">PDF, DOCX, XLSX • haz clic para seleccionar</p>
            {subidos > 0 && (
              <p className="text-xs text-green-600 mt-1.5 font-medium flex items-center justify-center gap-1">
                <CheckCircle size={11} /> {subidos} documento{subidos > 1 ? 's' : ''} subido{subidos > 1 ? 's' : ''}
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

// ─── Fila de documento ─────────────────────────────────────────────────────
function DocumentRow({ doc, analizable }: { doc: DocumentoAdjunto; analizable: boolean }) {
  return (
    <div className={`rounded-lg border transition-colors ${analizable ? 'bg-purple-50 border-purple-100' : 'bg-gray-50 border-gray-100'}`}>
      <div className="flex items-center gap-2.5 p-2.5">
        <span className="text-lg flex-shrink-0">{getFileIcon(doc.nombre)}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-800 truncate" title={doc.nombre}>{doc.nombre}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {doc.tipo && <span className="text-xs text-gray-500 bg-gray-100 px-1 rounded">{doc.tipo}</span>}
            {doc.size && <span className="text-xs text-gray-400">{formatFileSize(doc.size)}</span>}
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

// ─── Panel Chat IA MEJORADO ─────────────────────────────────────────────────────────
const ANALISIS_RAPIDOS = [
  { emoji: '🔬', texto: 'Análisis completo de la licitación', tipo: 'completo', icon: <Brain size={14} /> },
  { emoji: '📋', texto: 'Resumen ejecutivo', tipo: 'resumen', icon: <BookOpen size={14} /> },
  { emoji: '📊', texto: 'Extraer criterios de evaluación', tipo: 'completo', icon: <BarChart3 size={14} /> },
  { emoji: '⚠️', texto: 'Identificar riesgos y oportunidades', tipo: 'completo', icon: <AlertTriangle size={14} /> },
  { emoji: '📝', texto: 'Requisitos para participar', tipo: 'pregunta', preguntaTexto: '¿Cuáles son todos los requisitos para participar en esta licitación?', icon: <ListChecks size={14} /> },
  { emoji: '💰', texto: 'Presupuesto y condiciones económicas', tipo: 'pregunta', preguntaTexto: '¿Cuál es el presupuesto disponible y las condiciones de pago?', icon: <DollarSign size={14} /> },
  { emoji: '📅', texto: 'Plazos y fechas clave', tipo: 'pregunta', preguntaTexto: '¿Cuáles son todos los plazos y fechas importantes del proceso?', icon: <Calendar size={14} /> },
  { emoji: '🏆', texto: 'Evaluación y puntajes', tipo: 'pregunta', preguntaTexto: '¿Cómo se evalúan las ofertas? ¿Cuáles son los criterios y ponderaciones?', icon: <TrendingUp size={14} /> },
];

function PanelChatIA({
  documentosAnalizables,
  nombreLicitacion,
}: {
  documentosAnalizables: DocumentoAdjunto[];
  nombreLicitacion: string;
}) {
  const [docActivo, setDocActivo] = useState<DocumentoAdjunto | null>(null);
  const [modoTodos, setModoTodos] = useState(false);
  const [pregunta, setPregunta] = useState('');
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [cargando, setCargando] = useState(false);
  const [mostrarPreguntas, setMostrarPreguntas] = useState(true);
  const [tipoAnalisisActual, setTipoAnalisisActual] = useState<TipoAnalisis>('pregunta');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-seleccionar primer doc disponible
  useEffect(() => {
    if (documentosAnalizables.length > 0 && !docActivo) {
      setDocActivo(documentosAnalizables[0]);
    }
  }, [documentosAnalizables, docActivo]);

  // Auto-scroll al nuevo mensaje
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, cargando]);

  const agregarMensaje = (msg: Omit<MensajeChat, 'id' | 'timestamp'>) => {
    const nuevo: MensajeChat = { ...msg, id: Math.random().toString(36).slice(2), timestamp: new Date() };
    setMensajes(prev => [...prev, nuevo]);
    return nuevo.id;
  };

  const analizarDoc = async (doc: DocumentoAdjunto, tipo: TipoAnalisis, preguntaTexto?: string) => {
    const body: any = { 
      pdfUrl: doc.url, 
      documentoNombre: doc.nombre,
      tipoAnalisis: tipo
    };
    
    if (tipo === 'pregunta' && preguntaTexto) {
      body.pregunta = preguntaTexto;
    }
    
    const res = await fetch('/api/analizar-documento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    setTipoAnalisisActual(tipo);
    setMostrarPreguntas(false);

    // Mensaje de pregunta según el tipo
    let textoPregunta = '';
    if (tipo === 'completo') {
      textoPregunta = '🔬 Analizando licitación en profundidad...';
    } else if (tipo === 'resumen') {
      textoPregunta = '📋 Generando resumen ejecutivo...';
    } else {
      textoPregunta = preguntaTexto || 'Consultando información...';
    }
    
    agregarMensaje({ tipo: 'pregunta', texto: textoPregunta });

    try {
      if (modoTodos) {
        agregarMensaje({
          tipo: 'sistema',
          texto: `Analizando ${documentosAnalizables.length} documento${documentosAnalizables.length > 1 ? 's' : ''}...`,
        });

        const resultados: { nombre: string; data: any }[] = [];
        for (const doc of documentosAnalizables) {
          try {
            const respuesta = await analizarDoc(doc, tipo, preguntaTexto);
            resultados.push({ nombre: doc.nombre, data: respuesta });
          } catch {
            resultados.push({ nombre: doc.nombre, data: { error: 'No se pudo analizar' } });
          }
        }

        if (tipo === 'completo' && resultados[0]?.data?.analisis) {
          agregarMensaje({ 
            tipo: 'analisis_completo', 
            texto: `**Análisis completo de ${resultados.length} documento(s)**`,
            datosEstructurados: resultados[0].data.analisis
          });
        } else {
          const respuestaUnificada = resultados
            .map(r => `**📄 ${r.nombre}**\n${r.data.resumen || r.data.respuesta || JSON.stringify(r.data, null, 2)}`)
            .join('\n\n---\n\n');
          agregarMensaje({ tipo: 'respuesta', texto: respuestaUnificada });
        }
      } else {
        const respuesta = await analizarDoc(docActivo!, tipo, preguntaTexto);
        
        if (tipo === 'completo' && respuesta.analisis) {
          agregarMensaje({ 
            tipo: 'analisis_completo', 
            texto: `**Análisis completo de:** ${docActivo!.nombre}`,
            documento: docActivo!.nombre,
            datosEstructurados: respuesta.analisis
          });
        } else if (tipo === 'resumen' && respuesta.resumen) {
          agregarMensaje({ 
            tipo: 'respuesta', 
            texto: respuesta.resumen,
            documento: docActivo!.nombre
          });
        } else {
          agregarMensaje({ 
            tipo: 'respuesta', 
            texto: respuesta.respuesta || respuesta.resumen || 'No se pudo generar respuesta',
            documento: docActivo!.nombre
          });
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

    // Detectar si es un análisis rápido predefinido
    const analisisRapido = ANALISIS_RAPIDOS.find(a => a.texto === texto);
    if (analisisRapido) {
      if (analisisRapido.tipo === 'completo') {
        await ejecutarAnalisis('completo');
      } else if (analisisRapido.tipo === 'resumen') {
        await ejecutarAnalisis('resumen');
      } else if (analisisRapido.tipo === 'pregunta') {
        await ejecutarAnalisis('pregunta', analisisRapido.preguntaTexto);
      }
      setPregunta('');
      return;
    }

    // Pregunta libre
    await ejecutarAnalisis('pregunta', texto);
    setPregunta('');
  };

  const hayDocs = documentosAnalizables.length > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-indigo-50">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 bg-purple-600 rounded-lg">
            <Bot size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-gray-800">Asistente IA Experto en Licitaciones</span>
          {hayDocs && (
            <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
              {documentosAnalizables.length} doc{documentosAnalizables.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {hayDocs && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <button
                onClick={() => setModoTodos(false)}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                  !modoTodos ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                Un documento
              </button>
              <button
                onClick={() => setModoTodos(true)}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${
                  modoTodos ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                <Files size={11} />
                Todos ({documentosAnalizables.length})
              </button>
            </div>

            {!modoTodos && documentosAnalizables.length > 1 && (
              <select
                value={docActivo?.nombre || ''}
                onChange={e => setDocActivo(documentosAnalizables.find(d => d.nombre === e.target.value) || null)}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 bg-white text-gray-700"
              >
                {documentosAnalizables.map(d => (
                  <option key={d.nombre} value={d.nombre}>{getFileIcon(d.nombre)} {d.nombre}</option>
                ))}
              </select>
            )}
            {!modoTodos && documentosAnalizables.length === 1 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-lg border border-gray-200">
                <span className="text-sm">{getFileIcon(documentosAnalizables[0].nombre)}</span>
                <span className="text-xs text-gray-700 truncate">{documentosAnalizables[0].nombre}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Área de conversación */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[500px]">
        {!hayDocs ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center">
            <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center mb-3">
              <Upload size={20} className="text-purple-400" />
            </div>
            <p className="text-sm font-medium text-gray-600">Sin documentos aún</p>
            <p className="text-xs text-gray-400 mt-1 max-w-[200px]">
              Descarga documentos de Mercado Público y arrástralos arriba para analizarlos con IA
            </p>
          </div>
        ) : mensajes.length === 0 && mostrarPreguntas ? (
          <div>
            <p className="text-xs text-gray-400 mb-2.5 text-center">
              {modoTodos
                ? `Analiza ${documentosAnalizables.length} documentos a la vez`
                : `Analizando: "${docActivo?.nombre || ''}"`}
            </p>
            
            {/* Análisis Rápidos */}
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                <Zap size={10} /> Análisis inteligentes
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {ANALISIS_RAPIDOS.slice(0, 4).map(p => (
                  <button
                    key={p.texto}
                    onClick={() => enviar(p.texto)}
                    className="flex items-center gap-1.5 text-left px-2 py-1.5 text-xs text-gray-700 bg-gray-50 hover:bg-purple-50 hover:text-purple-700 border border-gray-100 hover:border-purple-200 rounded-lg transition-colors"
                  >
                    <span className="text-purple-500">{p.icon}</span>
                    <span className="truncate">{p.texto}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Preguntas rápidas */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                <MessageSquare size={10} /> Consultas específicas
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {ANALISIS_RAPIDOS.slice(4).map(p => (
                  <button
                    key={p.texto}
                    onClick={() => enviar(p.texto)}
                    className="flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-700 bg-gray-50 hover:bg-purple-50 hover:text-purple-700 border border-gray-100 hover:border-purple-200 rounded-lg transition-colors group"
                  >
                    <span className="text-sm flex-shrink-0">{p.emoji}</span>
                    <span className="flex-1">{p.texto}</span>
                    <ChevronRight size={12} className="text-gray-300 group-hover:text-purple-400" />
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
                    <User size={14} className="text-white" />
                  </div>
                ) : msg.tipo === 'sistema' ? null : (
                  <div className="flex-shrink-0 w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center">
                    <Bot size={14} className="text-white" />
                  </div>
                )}

                {msg.tipo === 'sistema' ? (
                  <div className="w-full text-center">
                    <span className="inline-flex items-center gap-1.5 text-xs text-purple-600 bg-purple-50 px-3 py-1 rounded-full">
                      <Loader2 size={10} className="animate-spin" />
                      {msg.texto}
                    </span>
                  </div>
                ) : msg.tipo === 'pregunta' ? (
                  <div className="max-w-[85%] bg-blue-600 text-white text-sm px-3 py-2 rounded-xl rounded-tr-sm">
                    {msg.texto}
                  </div>
                ) : msg.tipo === 'error' ? (
                  <div className="max-w-[85%] bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-xl rounded-tl-sm flex items-start gap-1.5">
                    <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                    {msg.texto}
                  </div>
                ) : msg.tipo === 'analisis_completo' ? (
                  <div className="max-w-[95%] bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 px-4 py-3 rounded-xl rounded-tl-sm">
                    {msg.documento && (
                      <p className="text-xs text-purple-600 font-medium mb-2 flex items-center gap-1">
                        <span>{getFileIcon(msg.documento)}</span>
                        {msg.documento}
                      </p>
                    )}
                    <AnalisisEstructurado datos={msg.datosEstructurados} />
                    <p className="text-xs text-gray-400 mt-3 text-right">
                      {msg.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ) : (
                  <div className="max-w-[92%] bg-gray-50 border border-gray-100 px-3.5 py-3 rounded-xl rounded-tl-sm">
                    {msg.documento && (
                      <p className="text-xs text-purple-600 font-medium mb-1.5 flex items-center gap-1">
                        <span>{getFileIcon(msg.documento)}</span>
                        {msg.documento}
                      </p>
                    )}
                    <RespuestaFormateada texto={msg.texto} />
                    <p className="text-xs text-gray-400 mt-2 text-right">
                      {msg.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {cargando && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center">
                  <Bot size={14} className="text-white" />
                </div>
                <div className="bg-gray-50 border border-gray-100 px-4 py-3 rounded-xl rounded-tl-sm">
                  <div className="flex gap-1.5 items-center">
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    <span className="text-xs text-gray-500 ml-1">Analizando documento...</span>
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
        <div className="border-t border-gray-100 p-3">
          {mensajes.length > 0 && (
            <div className="flex gap-1 mb-2 flex-wrap">
              {ANALISIS_RAPIDOS.slice(0, 3).map(p => (
                <button
                  key={p.texto}
                  onClick={() => enviar(p.texto)}
                  disabled={cargando}
                  className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-purple-100 hover:text-purple-700 text-gray-600 rounded-full transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {p.icon}
                  <span className="hidden sm:inline">{p.texto.length > 20 ? p.texto.slice(0, 20) + '…' : p.texto}</span>
                  <span className="sm:hidden">{p.emoji}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={pregunta}
              onChange={e => setPregunta(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
              }}
              placeholder="Escribe tu pregunta o selecciona un análisis rápido..."
              rows={2}
              disabled={cargando}
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              onClick={() => enviar()}
              disabled={cargando || !pregunta.trim()}
              className="flex-shrink-0 p-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white rounded-xl transition-colors"
            >
              {cargando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5 text-center">
            Enter para enviar · Shift+Enter nueva línea · Análisis profundo con IA experta
          </p>
        </div>
      )}
    </div>
  );
}

// ======================================================
// PÁGINA PRINCIPAL
// ======================================================

export default function LicitacionDetallePage() {
  const params = useParams();
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [licitacion, setLicitacion] = useState<Oportunidad | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [copiedCodigo, setCopiedCodigo] = useState(false);
  const [documentosCache, setDocumentosCache] = useState<DocumentoAdjunto[]>([]);
  const [urlAdjuntosMP, setUrlAdjuntosMP] = useState<string | null>(null);
  const [cargandoDocs, setCargandoDocs] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [showFechas, setShowFechas] = useState(false);

  const codigo = params.codigo as string;
  const codigoDecoded = decodeURIComponent(codigo);

  useEffect(() => {
    if (codigoDecoded) {
      fetchLicitacion();
      fetchDocumentos();
      setUrlAdjuntosMP(
        `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigoDecoded)}`
      );
    }
  }, [codigoDecoded]);

  const fetchLicitacion = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(codigoDecoded)}`);
      const data = await res.json();

      if (data.resultados?.length > 0) {
        setLicitacion(data.resultados[0]);
        return;
      }

      const res2 = await fetch(`/api/licitacion-detalle/${encodeURIComponent(codigoDecoded)}`);
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2.success && data2.licitacion) {
          setLicitacion(data2.licitacion);
          return;
        }
      }

      setError('No se encontró la licitación');
    } catch { setError('Error al cargar la licitación'); }
    finally { setLoading(false); }
  };

  const fetchDocumentos = async () => {
    setCargandoDocs(true);
    try {
      const res = await fetch(`/api/documentos/cache/${encodeURIComponent(codigoDecoded)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.documentos?.length > 0) {
          setDocumentosCache(data.documentos.map((d: any) => ({
            nombre: d.documento_nombre || d.nombre,
            url: d.documento_url_local || d.url_local || d.url,
            url_local: d.documento_url_local || d.url_local || d.url,
            size: d.size_bytes || d.size,
            ya_descargado: true,
          })));
        }
      }
    } catch { }
    finally { setCargandoDocs(false); }
  };

  const handleToggleFavorite = async () => {
  if (!licitacion) return;
  setToggling(true);
  await toggleFavorite({
    codigo: licitacion.codigo,
    nombre: licitacion.nombre,
    organismo: licitacion.organismo,
    monto_total: licitacion.monto_total,
    fecha_cierre: licitacion.fecha_cierre,
    estado: licitacion.estado,
  });
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

  if (loading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 size={36} className="animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Cargando licitación...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !licitacion) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Licitación no encontrada</h2>
            <p className="text-gray-500 text-sm mb-6">{error || 'No existe información para este código'}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => router.back()}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm">
                <ArrowLeft size={16} />Volver
              </button>
              <button onClick={fetchLicitacion}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                <RefreshCw size={16} />Reintentar
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const estado = ESTADO_CONFIG[licitacion.estado] || { label: licitacion.estado, icon: <Info size={14} />, cls: 'text-gray-600', badge: 'bg-gray-100 border-gray-200 text-gray-600' };
  const diasRestantes = getDiasRestantes(licitacion.fecha_cierre);
  const isFav = isFavorite(licitacion.codigo);
  const monto = formatCLP(licitacion.monto_total || licitacion.monto_estimado);
  const tipoLabel = licitacion.tipo_licitacion ? (TIPO_LICITACION_MAP[licitacion.tipo_licitacion] || TIPOS_LICITACION[licitacion.tipo_licitacion] || licitacion.tipo_licitacion) : null;

  const documentosAnalizables = documentosCache.filter(d => esUrlAnalizable(d.url_local || d.url));
  const fechasProceso = licitacion.fechas_proceso;
  const fechasAdic = [
    { label: 'Publicación', fecha: licitacion.fecha_publicacion },
    { label: 'Inicio preguntas', fecha: fechasProceso?.fecha_inicio_preguntas },
    { label: 'Fin preguntas', fecha: fechasProceso?.fecha_fin_preguntas },
    { label: 'Publicación respuestas', fecha: fechasProceso?.fecha_publicacion_respuestas },
    { label: 'Apertura técnica', fecha: fechasProceso?.fecha_apertura_tecnica },
    { label: 'Apertura económica', fecha: fechasProceso?.fecha_apertura_economica },
    { label: 'Cierre recepción', fecha: licitacion.fecha_cierre },
    { label: 'Adjudicación estimada', fecha: fechasProceso?.fecha_estimada_adjudicacion },
    { label: 'Adjudicación real', fecha: licitacion.fecha_adjudicacion },
  ].filter(f => f.fecha);

  return (
    <AppLayout breadcrumb={[
      { label: 'Inicio', href: '/' },
      { label: 'Licitaciones', href: '/' },
      { label: codigoDecoded },
    ]}>
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col xl:flex-row gap-6">

          {/* COLUMNA PRINCIPAL */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* HEADER CARD */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="flex items-center gap-1.5 font-mono text-sm text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg">
                        <Hash size={12} />{licitacion.codigo}
                      </span>
                      <button onClick={handleCopyCodigo}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors">
                        {copiedCodigo ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                      {tipoLabel && (
                        <span className="flex items-center gap-1 text-xs text-blue-300 bg-blue-900/40 border border-blue-700/40 px-2 py-0.5 rounded-full">
                          <Tag size={10} />{licitacion.tipo_licitacion} · {tipoLabel}
                        </span>
                      )}
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${estado.badge}`}>
                        {estado.icon}{estado.label}
                      </span>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-bold text-white leading-snug mb-2">{licitacion.nombre}</h1>
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                      <Building2 size={14} /><span>{licitacion.organismo}</span>
                      {licitacion.region && (
                        <><span className="text-slate-600">·</span><MapPin size={13} /><span>{licitacion.region}</span></>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={handleToggleFavorite} disabled={toggling}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700">
                      {isFav ? <Star size={18} className="text-amber-400 fill-amber-400" /> : <StarOff size={18} className="text-slate-400" />}
                    </button>
                    {licitacion.url && (
                      <a href={licitacion.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors">
                        <ExternalLink size={13} />Mercado Público
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-100">
                {[
                  { icon: <DollarSign size={16} className="text-green-600" />, label: 'Monto estimado', value: monto || 'No especificado', sub: licitacion.moneda || 'CLP' },
                  { icon: <Calendar size={16} className="text-blue-600" />, label: 'Fecha cierre', value: formatDate(licitacion.fecha_cierre) || '—', sub: diasRestantes !== null && diasRestantes > 0 ? `${diasRestantes} días restantes` : diasRestantes === 0 ? 'Cierra hoy' : 'Proceso finalizado' },
                  { icon: <Building2 size={16} className="text-purple-600" />, label: 'Unidad compradora', value: licitacion.comprador || licitacion.organismo, sub: licitacion.codigo_organismo },
                  { icon: <MapPin size={16} className="text-orange-600" />, label: 'Ubicación', value: licitacion.region || 'No especificada', sub: licitacion.comuna_unidad || licitacion.direccion || '' },
                ].map((kpi, i) => (
                  <div key={i} className="px-5 py-4">
                    <div className="flex items-center gap-1.5 mb-1">{kpi.icon}<span className="text-xs text-gray-500">{kpi.label}</span></div>
                    <p className="text-sm font-semibold text-gray-900 line-clamp-1">{kpi.value}</p>
                    {kpi.sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{kpi.sub}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* DESCRIPCIÓN */}
            {licitacion.descripcion && (
              <InfoCard title="Descripción / Objeto" icon={<FileText size={16} />}>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{licitacion.descripcion}</p>
              </InfoCard>
            )}

            {/* DATOS ORGANISMO */}
            <InfoCard title="Datos del organismo comprador" icon={<Building2 size={16} />}>
              <div className="divide-y divide-gray-50">
                <InfoRow label="Organismo" value={licitacion.organismo} />
                <InfoRow label="Unidad compradora" value={licitacion.comprador} />
                <InfoRow label="RUT organismo" value={licitacion.rut_organismo} />
                <InfoRow label="Dirección" value={licitacion.direccion} />
                <InfoRow label="Comuna" value={licitacion.comuna_unidad} />
                <InfoRow label="Región" value={licitacion.region} />
              </div>
            </InfoCard>

            {/* CARACTERÍSTICAS */}
            <InfoCard title="Características del proceso" icon={<Shield size={16} />}>
              <div className="divide-y divide-gray-50">
                <InfoRow label="Tipo de licitación" value={tipoLabel} />
                <InfoRow label="Tipo convocatoria" value={licitacion.tipo_convocatoria} />
                <InfoRow label="Modalidad de pago"
                  value={licitacion.caracteristicas?.modalidad_pago
                    ? MODALIDAD_PAGO_MAP[parseInt(licitacion.caracteristicas.modalidad_pago)] || licitacion.caracteristicas.modalidad_pago
                    : null} />
                <InfoRow label="Duración contrato"
                  value={licitacion.caracteristicas?.plazo_contrato_dias
                    ? `${licitacion.caracteristicas.plazo_contrato_dias} días` : null} />
                <InfoRow label="Subcontratación"
                  value={licitacion.caracteristicas?.subcontratacion ? 'Permitida' : licitacion.caracteristicas?.subcontratacion === false ? 'No permitida' : null} />
                <InfoRow label="Renovable"
                  value={licitacion.caracteristicas?.renovable ? 'Sí' : licitacion.caracteristicas?.renovable === false ? 'No' : null} />
              </div>
            </InfoCard>

            {/* CONTACTO */}
            {(licitacion.contacto?.nombre || licitacion.contacto?.email || licitacion.contacto?.telefono) && (
              <InfoCard title="Responsable del contrato" icon={<Phone size={16} />}>
                <div className="divide-y divide-gray-50">
                  <InfoRow label="Nombre" value={licitacion.contacto?.nombre} />
                  <InfoRow label="Cargo" value={licitacion.contacto?.cargo} />
                  {licitacion.contacto?.email && (
                    <div className="flex gap-3 py-1.5">
                      <span className="text-xs text-gray-400 w-36 flex-shrink-0 pt-0.5">Email</span>
                      <a href={`mailto:${licitacion.contacto.email}`} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        <Mail size={12} />{licitacion.contacto.email}
                      </a>
                    </div>
                  )}
                  {licitacion.contacto?.telefono && (
                    <div className="flex gap-3 py-1.5">
                      <span className="text-xs text-gray-400 w-36 flex-shrink-0 pt-0.5">Teléfono</span>
                      <a href={`tel:${licitacion.contacto.telefono}`} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        <Phone size={12} />{licitacion.contacto.telefono}
                      </a>
                    </div>
                  )}
                </div>
              </InfoCard>
            )}

            {/* ITEMS */}
            {licitacion.items && licitacion.items.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button onClick={() => setShowItems(!showItems)}
                  className="w-full px-5 py-3.5 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-gray-800">Productos / Servicios licitados</span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{licitacion.items.length}</span>
                  </div>
                  {showItems ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>
                {showItems && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">#</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Producto / Servicio</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Categoría</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase text-right">Cantidad</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase text-right">Monto unit.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {licitacion.items.map((item, i) => (
                          <tr key={i} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-400 text-xs">{item.correlativo ?? i + 1}</td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-800">{item.nombre_producto}</p>
                              {item.descripcion && <p className="text-xs text-gray-500 mt-0.5">{item.descripcion}</p>}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">{item.categoria || '—'}</td>
                            <td className="px-4 py-3 text-right">{item.cantidad} {item.unidad}</td>
                            <td className="px-4 py-3 text-right text-gray-700 font-medium">
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

            {/* TIMELINE */}
            {fechasAdic.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button onClick={() => setShowFechas(!showFechas)}
                  className="w-full px-5 py-3.5 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-gray-800">Cronograma del proceso</span>
                  </div>
                  {showFechas ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>
                {showFechas && (
                  <div className="p-5">
                    <div className="relative">
                      <div className="absolute left-2.5 top-0 bottom-0 w-px bg-gray-200" />
                      <div className="space-y-4">
                        {fechasAdic.map((f, i) => {
                          const d = new Date(f.fecha!);
                          const pasada = d < new Date();
                          return (
                            <div key={i} className="flex gap-4 pl-8 relative">
                              <div className={`absolute left-0 top-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${pasada ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                                {pasada && <Check size={10} className="text-white" />}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase">{f.label}</p>
                                <p className="text-sm text-gray-800">{formatDateTime(f.fecha)}</p>
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
          </div>

          {/* SIDEBAR */}
          <div className="xl:w-[450px] flex-shrink-0 space-y-5">

            {/* DOCUMENTOS */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-gray-800">Documentos</span>
                  {!cargandoDocs && documentosCache.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                      {documentosCache.length}
                    </span>
                  )}
                  {documentosAnalizables.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium flex items-center gap-0.5">
                      <Sparkles size={9} />{documentosAnalizables.length} IA
                    </span>
                  )}
                </div>
                <button onClick={fetchDocumentos} title="Recargar documentos"
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <RefreshCw size={14} />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-4">
                  <p className="text-xs font-semibold text-blue-900 mb-3 flex items-center gap-1.5">
                    <Download size={12} /> Cómo agregar documentos:
                  </p>
                  <div className="space-y-3">
                    <div className="flex gap-3 items-start">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 mb-1">Abre la licitación en Mercado Público</p>
                        <a
                          href={urlAdjuntosMP || `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigoDecoded)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
                        >
                          <ExternalLink size={11} />
                          Ir a Mercado Público
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-3 items-start">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                      <p className="text-xs text-gray-600 leading-relaxed">Ve a la pestaña <strong>"Adjuntos"</strong> y descarga los archivos a tu computador</p>
                    </div>
                    <div className="flex gap-3 items-start">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                      <p className="text-xs text-gray-600 leading-relaxed">Arrástralos al área de abajo — quedan guardados en la plataforma para siempre</p>
                    </div>
                  </div>
                </div>

                {codigoDecoded && (
                  <SubirDocumentos codigoLicitacion={codigoDecoded} onSubidos={handleDocsSubidos} />
                )}

                {cargandoDocs ? (
                  <div className="flex items-center justify-center py-4 gap-2 text-sm text-gray-500">
                    <Loader2 size={16} className="animate-spin text-blue-500" /> Cargando documentos...
                  </div>
                ) : documentosCache.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                      <CheckCircle size={11} className="text-green-500" />
                      {documentosCache.length} documento{documentosCache.length > 1 ? 's' : ''} guardado{documentosCache.length > 1 ? 's' : ''}
                    </p>
                    <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                      {documentosCache.map((doc, i) => (
                        <DocumentRow
                          key={`${doc.nombre}-${i}`}
                          doc={doc}
                          analizable={esUrlAnalizable(doc.url_local || doc.url)}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                      <FileText size={18} className="text-gray-300" />
                    </div>
                    <p className="text-xs text-gray-500 font-medium">Sin documentos aún</p>
                    <p className="text-xs text-gray-400 mt-0.5">Sigue los pasos de arriba</p>
                  </div>
                )}
              </div>
            </div>

            {/* PANEL CHAT IA MEJORADO */}
            <PanelChatIA
              documentosAnalizables={documentosAnalizables}
              nombreLicitacion={licitacion.nombre}
            />

            {/* ADJUDICACIÓN */}
            {licitacion.url_acta && (
              <InfoCard title="Adjudicación" icon={<CheckCircle size={16} />}>
                <div className="space-y-2">
                  {licitacion.numero_oferentes !== undefined && (
                    <p className="text-sm text-gray-700"><strong>{licitacion.numero_oferentes}</strong> proveedores participaron</p>
                  )}
                  <a href={licitacion.url_acta} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                    <ExternalLink size={14} />Ver acta de adjudicación
                  </a>
                </div>
              </InfoCard>
            )}

            {/* VOLVER */}
            <button onClick={() => router.back()}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm rounded-xl transition-colors">
              <ArrowLeft size={15} />Volver a resultados
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}