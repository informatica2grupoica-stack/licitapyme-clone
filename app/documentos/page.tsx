'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import {
  FileText, FolderOpen, ExternalLink, Download, Search,
  RefreshCw, AlertCircle, Building2, File, Paperclip,
} from 'lucide-react';

interface DocumentoItem {
  licitacion_codigo: string;
  documento_nombre: string;
  documento_url_local: string;
  size_bytes: number | null;
  created_at: string;
}

interface Proyecto {
  codigo: string;
  documentos: DocumentoItem[];
  totalSize: number;
  ultimoUpdate: string;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(nombre: string): string {
  const ext = nombre.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return '📄';
  if (['doc', 'docx'].includes(ext || '')) return '📝';
  if (['xls', 'xlsx'].includes(ext || '')) return '📊';
  if (['zip', 'rar'].includes(ext || '')) return '📦';
  return '📎';
}

export default function DocumentosPage() {
  const [documentos, setDocumentos] = useState<DocumentoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);

  const cargarDocumentos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/documentos/mis-docs');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Error al cargar');
      setDocumentos(data.documentos || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar documentos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarDocumentos(); }, [cargarDocumentos]);

  // Agrupar por licitación → proyectos
  const proyectos: Proyecto[] = Object.values(
    documentos.reduce<Record<string, Proyecto>>((acc, doc) => {
      if (!acc[doc.licitacion_codigo]) {
        acc[doc.licitacion_codigo] = {
          codigo: doc.licitacion_codigo,
          documentos: [],
          totalSize: 0,
          ultimoUpdate: doc.created_at,
        };
      }
      acc[doc.licitacion_codigo].documentos.push(doc);
      acc[doc.licitacion_codigo].totalSize += doc.size_bytes || 0;
      if (doc.created_at > acc[doc.licitacion_codigo].ultimoUpdate) {
        acc[doc.licitacion_codigo].ultimoUpdate = doc.created_at;
      }
      return acc;
    }, {})
  ).sort((a, b) => b.ultimoUpdate.localeCompare(a.ultimoUpdate));

  const proyectosFiltrados = proyectos.filter(p =>
    search === '' ||
    p.codigo.toLowerCase().includes(search.toLowerCase()) ||
    p.documentos.some(d => d.documento_nombre.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Mis documentos' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FolderOpen size={24} className="text-blue-600" />
              Mis documentos
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading
                ? 'Cargando...'
                : `${proyectos.length} proyecto${proyectos.length !== 1 ? 's' : ''} · ${documentos.length} archivo${documentos.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>
          <button
            onClick={cargarDocumentos}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors self-start"
            title="Actualizar"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Info de cómo subir docs */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <Paperclip size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-0.5">¿Cómo agregar documentos?</p>
            <p className="text-blue-700">
              Abre el detalle de cualquier licitación → sección &quot;Documentos&quot; → arrastra o selecciona archivos PDF/Word descargados desde Mercado Público.
            </p>
          </div>
        </div>

        {/* Buscador */}
        {proyectos.length > 0 && (
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por código o nombre de archivo..."
              className="w-full max-w-md pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
            <AlertCircle size={16} /> {error}
            <button onClick={cargarDocumentos} className="ml-auto text-red-600 hover:underline">Reintentar</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Proyectos */}
        {!loading && !error && (
          <>
            {proyectosFiltrados.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FolderOpen size={28} className="text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  {search ? 'Sin resultados' : 'No hay documentos aún'}
                </h3>
                <p className="text-gray-500 text-sm mb-4">
                  {search
                    ? 'Prueba con otro término de búsqueda'
                    : 'Abre una licitación y sube los documentos desde la sección de documentos'
                  }
                </p>
                {!search && (
                  <Link
                    href="/"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Search size={15} /> Buscar licitaciones
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {proyectosFiltrados.map(proyecto => {
                  const abierto = expandido === proyecto.codigo;
                  return (
                    <div
                      key={proyecto.codigo}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
                    >
                      {/* Cabecera del proyecto */}
                      <button
                        onClick={() => setExpandido(abierto ? null : proyecto.codigo)}
                        className="w-full flex items-center gap-4 p-4 sm:p-5 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <FolderOpen size={20} className={`transition-colors ${abierto ? 'text-blue-600' : 'text-blue-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-800 font-mono">{proyecto.codigo}</p>
                            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                              {proyecto.documentos.length} archivo{proyecto.documentos.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatSize(proyecto.totalSize)} · Actualizado {new Date(proyecto.ultimoUpdate).toLocaleDateString('es-CL')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Link
                            href={`/licitacion/${encodeURIComponent(proyecto.codigo)}`}
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                          >
                            <ExternalLink size={12} /> Ver licitación
                          </Link>
                          <span className={`text-gray-400 transition-transform duration-200 ${abierto ? 'rotate-90' : ''}`}>▶</span>
                        </div>
                      </button>

                      {/* Lista de archivos */}
                      {abierto && (
                        <div className="border-t border-gray-100 divide-y divide-gray-50">
                          {proyecto.documentos.map((doc, idx) => (
                            <div key={idx} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                              <span className="text-lg flex-shrink-0">{fileIcon(doc.documento_nombre)}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-700 truncate font-medium">{doc.documento_nombre}</p>
                                <p className="text-xs text-gray-400">
                                  {formatSize(doc.size_bytes)}
                                  {doc.size_bytes ? ' · ' : ''}
                                  {new Date(doc.created_at).toLocaleDateString('es-CL')}
                                </p>
                              </div>
                              <a
                                href={doc.documento_url_local}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium flex-shrink-0"
                              >
                                <Download size={12} /> Descargar
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
