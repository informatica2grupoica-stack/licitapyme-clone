// src/app/components/DocumentosList.tsx
'use client';

import { useState } from 'react';
import { 
  FileText, Download, ChevronDown, ChevronUp, 
  FileArchive, FileImage, File, FileJson, 
  Loader2, DownloadCloud
} from 'lucide-react';
import { DocumentoAdjunto } from '@/app/types/search.types';
import { descargarDocumento, formatFileSize, getIconForDocument } from '@/app/services/documentosService';

interface DocumentosListProps {
  documentos: DocumentoAdjunto[];
  codigoLicitacion: string;
  loading?: boolean;
}

export function DocumentosList({ documentos, codigoLicitacion, loading = false }: DocumentosListProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [descargandoTodos, setDescargandoTodos] = useState(false);

  const handleDescargar = async (documento: DocumentoAdjunto) => {
    setDescargando(documento.nombre);
    await descargarDocumento(documento.url, documento.nombre);
    setDescargando(null);
  };

  const handleDescargarTodos = async () => {
    setDescargandoTodos(true);
    for (const doc of documentos) {
      await descargarDocumento(doc.url, doc.nombre);
      await new Promise(r => setTimeout(r, 500));
    }
    setDescargandoTodos(false);
  };

  const getIconoPorTipo = (nombre: string) => {
    const ext = nombre.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf': return <FileText size={18} className="text-red-500" />;
      case 'zip': case 'rar': return <FileArchive size={18} className="text-yellow-600" />;
      case 'jpg': case 'png': case 'gif': return <FileImage size={18} className="text-green-500" />;
      case 'json': return <FileJson size={18} className="text-blue-500" />;
      default: return <File size={18} className="text-gray-500" />;
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
          <div className="h-5 bg-gray-200 rounded w-32 animate-pulse"></div>
        </div>
        <div className="p-4 space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-48"></div>
              </div>
              <div className="w-20 h-4 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!documentos || documentos.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-5 py-3 bg-gray-50 flex justify-between items-center hover:bg-gray-100 transition-colors"
        >
          <span className="font-semibold text-gray-900 flex items-center gap-2">
            <FileText size={18} />
            Documentos adjuntos
            <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">0</span>
          </span>
          {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {isOpen && (
          <div className="p-8 text-center text-gray-500">
            <FileText size={40} className="mx-auto mb-2 text-gray-300" />
            <p>No hay documentos adjuntos disponibles</p>
            <p className="text-xs mt-1">Los documentos se pueden ver en Mercado Público</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-3 bg-gray-50 flex justify-between items-center hover:bg-gray-100 transition-colors"
      >
        <span className="font-semibold text-gray-900 flex items-center gap-2">
          <FileText size={18} />
          Documentos adjuntos
          <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">{documentos.length}</span>
        </span>
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {isOpen && (
        <div className="p-4">
          {/* Botón descargar todo */}
          {documentos.length > 1 && (
            <button
              onClick={handleDescargarTodos}
              disabled={descargandoTodos}
              className="mb-4 flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {descargandoTodos ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <DownloadCloud size={16} />
              )}
              {descargandoTodos ? 'Descargando...' : 'Descargar todos los documentos'}
            </button>
          )}

          {/* Lista de documentos */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {documentos.map((doc, index) => (
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
                  onClick={() => handleDescargar(doc)}
                  disabled={descargando === doc.nombre}
                  className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                  title="Descargar"
                >
                  {descargando === doc.nombre ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Download size={18} />
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* Nota informativa */}
          <p className="text-xs text-gray-400 mt-4 text-center">
            📄 Los documentos se descargan directamente desde Mercado Público
          </p>
        </div>
      )}
    </div>
  );
}