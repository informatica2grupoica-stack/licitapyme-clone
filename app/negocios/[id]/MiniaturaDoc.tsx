'use client';

// Miniatura de un documento PDF: se ve la primera página chica y, al pinchar, se abre el visor grande.
// Para PDFs de Mercado Público/R2 (por /api/proxy) o de un blob ya cargado (src directo).
import { IconFileText as FileText } from '@tabler/icons-react';

export function MiniaturaDoc({ src, titulo, detalle, onAbrir, ancho = 112 }: {
  src: string | null; titulo: string; detalle?: string | null; onAbrir: () => void; ancho?: number;
}) {
  const alto = Math.round(ancho * 1.3);
  return (
    <button type="button" onClick={onAbrir} title={`Abrir ${titulo}`}
      className="group text-left flex-shrink-0 rounded-lg border border-zinc-200 bg-white hover:border-teal-400 hover:shadow-sm transition-all overflow-hidden" style={{ width: ancho + 2 }}>
      <div className="relative bg-zinc-50 overflow-hidden" style={{ width: ancho, height: alto }}>
        {src ? (
          <iframe src={`${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title={titulo} tabIndex={-1} loading="lazy"
            className="absolute top-0 left-0 border-0 pointer-events-none" style={{ width: ancho * 3, height: alto * 3, transform: 'scale(0.3333)', transformOrigin: 'top left' }} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300"><FileText size={28} /></div>
        )}
        <span className="absolute inset-0 bg-teal-600/0 group-hover:bg-teal-600/10 transition-colors" />
      </div>
      <div className="px-2 py-1.5 border-t border-zinc-100">
        <p className="text-[11px] font-semibold text-zinc-700 truncate">{titulo}</p>
        {detalle && <p className="text-[10.5px] text-zinc-400 truncate">{detalle}</p>}
      </div>
    </button>
  );
}

export const urlInline = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}&inline=1`;
