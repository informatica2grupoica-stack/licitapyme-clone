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
import { createPortal } from 'react-dom';
import { IconX as X, IconDownload as Download, IconExternalLink as ExternalLink, IconFileText as FileText, IconFileUnknown as FileQuestion, IconLoader2 as Loader2 } from '@tabler/icons-react';
import { urlDescarga } from '@/app/lib/descargas-cliente';

/** `titulo`/`detalle` solo se usan en la lista lateral cuando el visor muestra varios documentos juntos. */
export interface VisorDoc { nombre: string; url: string; titulo?: string; detalle?: string }

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

// Excel: el visor de Microsoft no puede leer archivos que no sean públicos en internet
// (R2 privado, localhost), y queda en blanco. Se lee el archivo vía proxy y se dibuja aquí.
// sheet_to_html escapa el texto de las celdas pero NO el destino de los hipervínculos: un Excel de un tercero con un enlace
// `javascript:…` quedaba como <a href="javascript:…"> y, al hacer clic, corría con la sesión del usuario. Solo se dejan enlaces http(s),
// y siempre en pestaña nueva y sin referrer.
export function sanearHtmlExcel(html: string): string {
  return html.replace(/<a\s+href="([^"]*)"/gi, (_m, href: string) => {
    const real = href.replace(/&amp;/g, '&').trim();
    return /^https?:\/\//i.test(real) ? `<a href="${href}" target="_blank" rel="noopener noreferrer"` : '<a';
  });
}

function VisorExcel({ url }: { url: string }) {
  const [hojas, setHojas] = useState<{ nombre: string; html: string }[] | null>(null);
  const [activa, setActiva] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    setHojas(null); setError(''); setActiva(0);
    (async () => {
      try {
        const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}&inline=1`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const out = wb.SheetNames.map(n => ({ nombre: n, html: sanearHtmlExcel(XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })) }));
        if (vivo) setHojas(out);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo leer el archivo');
      }
    })();
    return () => { vivo = false; };
  }, [url]);

  if (error) return <div className="w-full h-full flex items-center justify-center text-sm text-red-600">No se pudo previsualizar el Excel ({error}). Usa Descargar.</div>;
  if (!hojas) return <div className="w-full h-full flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando hoja…</div>;
  return (
    <div className="w-full h-full flex flex-col">
      {hojas.length > 1 && (
        <div className="flex gap-1 px-3 pt-2 overflow-x-auto flex-shrink-0">
          {hojas.map((h, i) => (
            <button key={h.nombre} onClick={() => setActiva(i)}
              className={`px-3 py-1 text-xs font-semibold rounded-t-lg whitespace-nowrap ${i === activa ? 'bg-white text-indigo-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>
              {h.nombre}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto bg-white p-2 text-[12px] text-slate-800 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_td]:whitespace-nowrap"
        dangerouslySetInnerHTML={{ __html: hojas[activa].html }} />
    </div>
  );
}

/** Con `lista` + `onElegir` el visor muestra todos los documentos juntos: lista lateral (tira arriba en pantallas chicas), ‹ › y las flechas del teclado. */
export function DocumentViewerModal({ doc, onClose, lista, onElegir }: { doc: VisorDoc | null; onClose: () => void; lista?: VisorDoc[]; onElegir?: (d: VisorDoc) => void }) {
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!doc) return;
    setCargando(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (lista && lista.length > 1 && onElegir && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const i = lista.findIndex(d => d.url === doc.url);
        const sig = lista[(i + (e.key === 'ArrowRight' ? 1 : -1) + lista.length) % lista.length];
        if (sig) onElegir(sig);
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose, lista, onElegir]);

  if (!doc) return null;
  const tipo = tipoDe(doc.nombre, doc.url);
  // PDF e imágenes se sirven por el proxy con inline=1: fuerza el Content-Type
  // correcto y la previsualización (los archivos en R2 tienen MIME malo de origen).
  const proxyInline = `/api/proxy?url=${encodeURIComponent(doc.url)}&inline=1`;
  // El visor de Office descarga el archivo desde los servidores de Microsoft, así
  // que necesita la URL pública directa (no el proxy local).
  const varios = !!lista && lista.length > 1 && !!onElegir;
  const idx = varios ? lista!.findIndex(d => d.url === doc.url) : -1;
  const mover = (paso: number) => { if (varios) onElegir!(lista![(idx + paso + lista!.length) % lista!.length]); };
  const officeSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(doc.url)}`;
  // El visor de Microsoft muestra el Excel con su formato (colores, bordes, anchos); el VisorExcel
  // propio es solo una tabla plana. Se usa el propio únicamente cuando Microsoft no puede llegar al
  // archivo (no es una URL pública: localhost, ruta relativa).
  const excelSinVisorOffice = ['xls', 'xlsx'].includes(extDe(doc.nombre, doc.url))
    && !/^https:\/\/(?!localhost|127\.|\[::1\])[^/]+\//i.test(doc.url);

  // createPortal a body: los contenedores con animación .fade-in (fill-mode both) dejan
  // un transform residual que crea un containing block y confinaba este `fixed` al área
  // de la sección — el PDF no ocupaba toda la pantalla. Portaleado, siempre es fullscreen.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/70 backdrop-blur-sm p-0 sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-label={`Visor: ${doc.nombre}`}
    >
      <div
        className="flex flex-col w-full max-w-none mx-auto flex-1 min-h-0 bg-white rounded-none sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <FileText size={16} className="text-indigo-600 flex-shrink-0" />
          <p className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate" title={doc.nombre}>
            {doc.nombre}
          </p>
          {varios && (
            <div className="flex items-center gap-0.5 text-[12px] text-slate-500 tabular-nums">
              <button onClick={() => mover(-1)} className="px-2 py-1 rounded-lg hover:bg-slate-200 font-semibold" aria-label="Anterior" title="Anterior (←)">‹</button>
              {idx + 1} / {lista!.length}
              <button onClick={() => mover(1)} className="px-2 py-1 rounded-lg hover:bg-slate-200 font-semibold" aria-label="Siguiente" title="Siguiente (→)">›</button>
            </div>
          )}
          <a
            href={doc.url} target="_blank" rel="noopener noreferrer"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Abrir en pestaña nueva"
          >
            <ExternalLink size={15} />
          </a>
          <a
            href={urlDescarga(doc.url)} download={doc.nombre}
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
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {varios && (<>
          <div className="md:hidden flex gap-1.5 overflow-x-auto px-2 py-1.5 border-b border-slate-200 bg-white flex-shrink-0">
            {lista!.map(d => (
              <button key={d.url} onClick={() => onElegir!(d)} className={`flex-shrink-0 max-w-[200px] truncate text-[12px] px-2.5 py-1 rounded-lg border ${d.url === doc.url ? 'border-teal-500 bg-teal-50 text-teal-800 font-semibold' : 'border-slate-200 text-slate-600'}`}>{d.titulo || d.nombre}</button>
            ))}
          </div>
          <aside className="hidden md:flex w-72 flex-shrink-0 flex-col border-r border-slate-200 bg-white overflow-y-auto">
            <p className="px-3 py-2 text-[11px] font-medium text-slate-500 border-b border-slate-100 sticky top-0 bg-white">{lista!.length} documentos</p>
            {lista!.map(d => (
              <button key={d.url} onClick={() => onElegir!(d)} title={d.nombre}
                className={`text-left px-3 py-2 border-b border-slate-100 border-l-2 ${d.url === doc.url ? 'border-l-teal-500 bg-teal-50' : 'border-l-transparent hover:bg-slate-50'}`}>
                <span className={`block text-[12.5px] truncate ${d.url === doc.url ? 'font-semibold text-teal-900' : 'font-medium text-slate-800'}`}>{d.titulo || d.nombre}</span>
                <span className="block text-[11px] text-slate-500 truncate">{d.detalle || d.nombre}</span>
              </button>
            ))}
          </aside>
        </>)}
        <div className="flex-1 min-h-0 min-w-0 bg-slate-100 relative">
          {tipo === 'pdf' && cargando && (
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

          {tipo === 'office' && excelSinVisorOffice && <VisorExcel url={doc.url} />}

          {tipo === 'office' && !excelSinVisorOffice && (
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
                <a href={urlDescarga(doc.url)} download={doc.nombre}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[13px] font-semibold rounded-lg transition-colors">
                  <Download size={14} /> Descargar
                </a>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
