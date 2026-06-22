// app/licitacion/[codigo]/sections/InteligenciaSection.tsx
// Sección "Inteligencia": chat IA sobre los documentos de la licitación,
// ahora a ancho completo.
'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Bot, Files, Upload, Zap, MessageSquare, ChevronRight, AlertCircle, User,
  Loader2, Send, BarChart3, Brain, BookOpen, AlertTriangle, ListChecks,
  TrendingUp, DollarSign, Calendar,
} from 'lucide-react';
import { DocumentoAdjunto } from '@/app/types/search.types';
import { getFileIcon, formatNegritas, SectionHeader } from '../utils';

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
// RESPUESTA FORMATEADA
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

// ======================================================
// ANÁLISIS ESTRUCTURADO
// ======================================================

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
// ANÁLISIS RÁPIDOS
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

// ======================================================
// PANEL CHAT IA
// ======================================================

export function InteligenciaSection({ documentosAnalizables, nombreLicitacion }: {
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

  const analizarDoc = async (doc: DocumentoAdjunto, tipo: TipoAnalisis, preguntaTexto?: string, historial?: Array<{ pregunta: string; respuesta: string }>) => {
    const body: any = { pdfUrl: doc.url, documentoNombre: doc.nombre, tipoAnalisis: tipo };
    if (tipo === 'pregunta' && preguntaTexto) body.pregunta = preguntaTexto;
    if (tipo === 'pregunta' && historial?.length) body.historial = historial;
    const res = await fetch('/api/analizar-documento', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  };

  // Últimos 3 turnos pregunta/respuesta del chat, para dar contexto al modelo en preguntas de seguimiento
  const construirHistorial = (): Array<{ pregunta: string; respuesta: string }> => {
    const turnos: Array<{ pregunta: string; respuesta: string }> = [];
    for (let i = 0; i < mensajes.length - 1; i++) {
      const actual = mensajes[i];
      const siguiente = mensajes[i + 1];
      if (actual.tipo === 'pregunta' && siguiente.tipo === 'respuesta') {
        turnos.push({ pregunta: actual.texto, respuesta: siguiente.texto });
      }
    }
    return turnos.slice(-3);
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
      if (modoTodos && tipo === 'pregunta') {
        const historial = construirHistorial();
        const res = await fetch('/api/analizar-documento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipoAnalisis: 'pregunta',
            pregunta: preguntaTexto,
            historial,
            documentos: documentosAnalizables.map(d => ({ url: d.url, nombre: d.nombre })),
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        agregarMensaje({ tipo: 'respuesta', texto: data.respuesta || 'Sin respuesta' });
      } else if (modoTodos) {
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
        const historial = tipo === 'pregunta' ? construirHistorial() : undefined;
        const respuesta = await analizarDoc(docActivo!, tipo, preguntaTexto, historial);
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
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<Brain size={18} />}
        title="Inteligencia"
        subtitle="Asistente IA para analizar los documentos de la licitación"
      />

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-100 bg-gradient-to-r from-purple-50 to-indigo-50">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 bg-purple-600 rounded-lg">
            <Bot size={13} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-zinc-800">Asistente IA · Documentos</span>
          <span className="text-xs text-zinc-400 truncate hidden sm:inline">{nombreLicitacion}</span>
          {hayDocs && (
            <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
              {documentosAnalizables.length} doc{documentosAnalizables.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {hayDocs && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <button onClick={() => setModoTodos(false)}
                className={`flex-1 sm:flex-none sm:w-40 text-xs py-1.5 rounded-lg font-medium transition-colors ${!modoTodos ? 'bg-purple-600 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'}`}>
                Un documento
              </button>
              <button onClick={() => setModoTodos(true)}
                className={`flex-1 sm:flex-none sm:w-40 text-xs py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${modoTodos ? 'bg-purple-600 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'}`}>
                <Files size={11} /> Todos ({documentosAnalizables.length})
              </button>
            </div>
            {!modoTodos && documentosAnalizables.length > 1 && (
              <select value={docActivo?.nombre || ''} onChange={e => setDocActivo(documentosAnalizables.find(d => d.nombre === e.target.value) || null)}
                className="w-full sm:w-80 text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 focus:ring-1 focus:ring-purple-500">
                {documentosAnalizables.map(d => <option key={d.nombre} value={d.nombre}>{getFileIcon(d.nombre)} {d.nombre}</option>)}
              </select>
            )}
            {!modoTodos && documentosAnalizables.length === 1 && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-lg border border-zinc-200">
                <span className="text-sm">{getFileIcon(documentosAnalizables[0].nombre)}</span>
                <span className="text-xs text-zinc-700 truncate">{documentosAnalizables[0].nombre}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px] max-h-[640px]">
        {!hayDocs ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center mb-3">
              <Upload size={18} className="text-purple-400" />
            </div>
            <p className="text-sm font-medium text-zinc-600">Sin documentos aún</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-[260px]">
              Descarga documentos de Mercado Público en la sección &quot;Documentos y Bases&quot; para analizarlos con IA
            </p>
          </div>
        ) : mensajes.length === 0 && mostrarPreguntas ? (
          <div className="max-w-2xl mx-auto">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
          <div className="max-w-3xl mx-auto w-full">
            {mensajes.map(msg => (
              <div key={msg.id} className={`flex gap-2 mb-3 ${msg.tipo === 'pregunta' ? 'flex-row-reverse' : 'flex-row'}`}>
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
          </div>
        )}
      </div>

      {/* Input */}
      {hayDocs && (
        <div className="border-t border-zinc-100 p-3">
          <div className="max-w-3xl mx-auto w-full">
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
        </div>
      )}
      </div>
    </div>
  );
}
