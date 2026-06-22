'use client';

import { useState } from 'react';
import { MessageCircle, Send, Loader2, FileText, X } from 'lucide-react';

interface ChatDocumentosProps {
  documentos: Array<{ nombre: string; url: string }>;
  licitacionCodigo: string;
}

const TODOS_LOS_DOCUMENTOS = '__TODOS__';

export function ChatDocumentos({ documentos, licitacionCodigo }: ChatDocumentosProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState('');
  const [pregunta, setPregunta] = useState('');
  const [loading, setLoading] = useState(false);
  const [respuesta, setRespuesta] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<Array<{ pregunta: string; respuesta: string }>>([]);

  const esTodos = selectedValue === TODOS_LOS_DOCUMENTOS;
  const selectedDocumento = esTodos ? null : documentos.find(d => d.nombre === selectedValue) || null;
  const haySeleccion = esTodos || !!selectedDocumento;

  const handleAnalizar = async () => {
    if (!haySeleccion || !pregunta.trim()) return;

    setLoading(true);
    setRespuesta(null);

    const preguntaActual = pregunta;
    const historial = chatHistory.slice(-3);

    try {
      const response = await fetch('/api/analizar-documento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipoAnalisis: 'pregunta',
          pregunta: preguntaActual,
          historial,
          ...(esTodos
            ? { documentos: documentos.map(d => ({ url: d.url, nombre: d.nombre })) }
            : { pdfUrl: selectedDocumento!.url, documentoNombre: selectedDocumento!.nombre }),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setRespuesta(data.respuesta);
        setChatHistory(prev => [...prev, { pregunta: preguntaActual, respuesta: data.respuesta }]);
        setPregunta('');
      } else {
        setRespuesta(`Error: ${data.error || 'No se pudo analizar el documento'}`);
      }
    } catch (error) {
      setRespuesta('Error al conectar con el servicio de análisis');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 transition-colors z-50"
      >
        <MessageCircle size={24} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 flex flex-col max-h-[600px]">
      {/* Header */}
      <div className="flex justify-between items-center p-4 bg-blue-600 text-white rounded-t-xl">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} />
          <h3 className="font-semibold">Analizar documentos con IA</h3>
        </div>
        <button onClick={() => setIsOpen(false)} className="hover:bg-blue-700 rounded-full p-1">
          <X size={18} />
        </button>
      </div>

      {/* Selección de documento */}
      <div className="p-4 border-b border-gray-200">
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          Selecciona un documento para analizar:
        </label>
        <select
          className="w-full p-2 border border-gray-300 rounded-lg text-sm"
          value={selectedValue}
          onChange={(e) => {
            setSelectedValue(e.target.value);
            setRespuesta(null);
          }}
        >
          <option value="">-- Seleccionar documento --</option>
          {documentos.length > 1 && (
            <option value={TODOS_LOS_DOCUMENTOS}>📚 Todos los documentos</option>
          )}
          {documentos.map((doc, idx) => (
            <option key={idx} value={doc.nombre}>
              {doc.nombre}
            </option>
          ))}
        </select>
      </div>

      {/* Historial del chat */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[300px]">
        {chatHistory.length === 0 && !respuesta && (
          <div className="text-center text-gray-400 text-sm py-8">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            <p>Selecciona un documento y hazle preguntas</p>
            <p className="text-xs mt-1">Ej: ¿Cuál es el plazo de ejecución?</p>
          </div>
        )}
        
        {chatHistory.map((item, idx) => (
          <div key={idx} className="space-y-2">
            <div className="bg-blue-100 p-3 rounded-lg rounded-br-none text-sm">
              <span className="font-medium text-blue-800">👤 Tú:</span>
              <p className="text-gray-800">{item.pregunta}</p>
            </div>
            <div className="bg-gray-100 p-3 rounded-lg rounded-bl-none text-sm">
              <span className="font-medium text-green-800">🤖 IA:</span>
              <p className="text-gray-700 whitespace-pre-wrap">{item.respuesta}</p>
            </div>
          </div>
        ))}
        
        {respuesta && chatHistory.length > 0 && (
          <div className="bg-gray-100 p-3 rounded-lg rounded-bl-none text-sm">
            <span className="font-medium text-green-800">🤖 IA:</span>
            <p className="text-gray-700 whitespace-pre-wrap">{respuesta}</p>
          </div>
        )}
        
        {loading && (
          <div className="bg-gray-100 p-3 rounded-lg text-center">
            <Loader2 size={16} className="animate-spin inline mr-2" />
            <span className="text-sm text-gray-500">Analizando documento...</span>
          </div>
        )}
      </div>

      {/* Input de pregunta */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAnalizar()}
            placeholder="Escribe tu pregunta sobre el documento..."
            className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={!haySeleccion || loading}
          />
          <button
            onClick={handleAnalizar}
            disabled={!haySeleccion || !pregunta.trim() || loading}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          💡 Preguntas sugeridas: ¿Cuál es el plazo? ¿Cuáles son los requisitos? ¿Monto de garantía?
        </p>
      </div>
    </div>
  );
}