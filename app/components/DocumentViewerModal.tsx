'use client';

// Visor de documentos EN EL APP (sin descargar). Los archivos viven en Cloudflare R2
// con Content-Type correcto y sin X-Frame-Options, así que se incrustan directo:
//   - PDF   → <iframe> (visor nativo del navegador)
//   - Imagen→ <img>
//   - Office (Word/Excel/PPT) → visor online de Microsoft (no se puede incrustar nativo)
//   - Otros (zip, etc.) → sin previsualización, se ofrece abrir/descargar
// Se usa desde DocumentosSection, que aparece tanto en el detalle de licitación
// (Radar) como en el detalle de Negocios.

import { useEffect, useState } from 'react';
import { X, Download, ExternalLink, FileText, FileQuestion, Loader2 } from 'lucide-react';

export interface VisorDoc { nombre: string; url: string }

export function extDe(nombre: string, url: string): string {
  const fromName = (nombre.split('.').pop() || '').toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  return (url.split('?')[0].split('.').pop() || '').toLowerCase();
}

export type Tipo = 'pdf' | 'img' | 'office' | 'otro';
export function tipoDe(nombre: string, url: string): Tipo {
  const ext = extDe(nombre, url);
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'img';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'office';
  return 'otro';
}

export function DocumentViewerModal({ doc, onClose }: { doc: VisorDoc | null; onClose: () => void }) {
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!doc) return;
    setCargando(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose]);

  if (!doc) return null;
  const tipo = tipoDe(doc.nombre, doc.url);
  // PDF e imágenes se sirven por el proxy con inline=1: fuerza el Content-Type
  // correcto y la previsualización (los archivos en R2 tienen MIME malo de origen).
  const proxyInline = `/api/proxy?url=${encodeURIComponent(doc.url)}&inline=1`;
  // El visor de Office descarga el archivo desde los servidores de Microsoft, así
  // que necesita la URL pública directa (no el proxy local).
  const officeSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(doc.url)}`;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/70 backdrop-blur-sm p-2 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Visor: ${doc.nombre}`}
    >
      <div
        className="flex flex-col w-full max-w-[95rem] mx-auto flex-1 min-h-0 bg-white rounded-2xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <FileText size={16} className="text-indigo-600 flex-shrink-0" />
          <p className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate" title={doc.nombre}>
            {doc.nombre}
          </p>
          <a
            href={doc.url} target="_blank" rel="noopener noreferrer"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Abrir en pestaña nueva"
          >
            <ExternalLink size={15} />
          </a>
          <a
            href={doc.url} download={doc.nombre}
            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
            title="Descargar"
          >
            <Download size={15} />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            aria-label="Cerrar visor"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 min-h-0 bg-slate-100 relative">
          {(tipo === 'pdf' || tipo === 'office') && cargando && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-500 pointer-events-none">
              <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando documento…
            </div>
          )}

          {tipo === 'pdf' && (
            <iframe
              src={`${proxyInline}#zoom=page-width&view=FitH`}
              title={doc.nombre}
              className="w-full h-full border-0"
              onLoad={() => setCargando(false)}
            />
          )}

          {tipo === 'img' && (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxyInline} alt={doc.nombre} className="max-w-full max-h-full object-contain" />
            </div>
          )}

          {tipo === 'office' && (
            <iframe
              src={officeSrc}
              title={doc.nombre}
              className="w-full h-full border-0"
              onLoad={() => setCargando(false)}
            />
          )}

          {tipo === 'otro' && (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-6">
              <div className="w-14 h-14 bg-slate-200 rounded-2xl flex items-center justify-center mb-3">
                <FileQuestion size={26} className="text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-700">Este tipo de archivo no se puede previsualizar</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">Ábrelo en una pestaña nueva o descárgalo.</p>
              <div className="flex items-center gap-2">
                <a href={doc.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
                  <ExternalLink size={14} /> Abrir
                </a>
                <a href={doc.url} download={doc.nombre}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[13px] font-semibold rounded-lg transition-colors">
                  <Download size={14} /> Descargar
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
