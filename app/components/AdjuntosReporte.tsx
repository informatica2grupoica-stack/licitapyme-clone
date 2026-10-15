'use client';

// Lista de archivos de respaldo de la solución de un error reportado (reportes_error_adjuntos,
// migration-148). Cada archivo tiene un ícono de ojo que lo abre en un visor (imagen, PDF y texto
// se ven en el navegador; Word/Excel no se pueden previsualizar → botón de descarga) y un acceso
// de descarga. Lo usan /admin/errores y /mis-reportes. `onQuitar` solo lo pasa el admin al editar.
import { useEffect, useState } from 'react';
import { IconEye as Eye, IconDownload as Download, IconFile as File, IconPhoto as Photo, IconX as X } from '@tabler/icons-react';

export interface AdjuntoReporte { id: number; nombre: string; url: string; mime: string | null; tamano: number | null }

type Tipo = 'imagen' | 'pdf' | 'texto' | 'otro';
const extDe = (n: string) => (n.split('.').pop() || '').toLowerCase();
const tipoDe = (n: string): Tipo => {
  const e = extDe(n);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return 'imagen';
  if (e === 'pdf') return 'pdf';
  if (['txt', 'csv'].includes(e)) return 'texto';
  return 'otro';
};
export const pesoLegible = (b: number | null) =>
  b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

export function AdjuntosReporte({ adjuntos, onQuitar }: { adjuntos: AdjuntoReporte[]; onQuitar?: (a: AdjuntoReporte) => void }) {
  const [viendo, setViendo] = useState<AdjuntoReporte | null>(null);
  useEffect(() => {
    if (!viendo) return;
    const cerrar = (e: KeyboardEvent) => { if (e.key === 'Escape') setViendo(null); };
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [viendo]);
  if (!adjuntos.length) return null;
  const tipo = viendo ? tipoDe(viendo.nombre) : null;

  return (
    <>
      <ul className="space-y-1.5">
        {adjuntos.map(a => (
          <li key={a.id} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] px-2.5 py-1.5">
            {tipoDe(a.nombre) === 'imagen' ? <Photo size={16} className="text-indigo-500 flex-shrink-0" /> : <File size={16} className="text-slate-400 flex-shrink-0" />}
            <span className="flex-1 min-w-0 text-[12.5px] text-slate-700 dark:text-slate-200 truncate" title={a.nombre}>{a.nombre}</span>
            <span className="text-[11px] text-slate-400 flex-shrink-0">{pesoLegible(a.tamano)}</span>
            <button type="button" onClick={() => setViendo(a)} title="Ver" aria-label={`Ver ${a.nombre}`}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-indigo-600">
              <Eye size={16} />
            </button>
            <a href={a.url} target="_blank" rel="noreferrer" download={a.nombre} title="Descargar" aria-label={`Descargar ${a.nombre}`}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-indigo-600">
              <Download size={16} />
            </a>
            {onQuitar && (
              <button type="button" onClick={() => onQuitar(a)} title="Quitar" aria-label={`Quitar ${a.nombre}`}
                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600">
                <X size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {viendo && (
        <div className="fixed inset-0 z-[400] bg-black/70 flex items-center justify-center p-4" onClick={() => setViendo(null)} role="dialog" aria-label={viendo.nombre}>
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-white/10">
              <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{viendo.nombre}</span>
              <a href={viendo.url} target="_blank" rel="noreferrer" download={viendo.nombre}
                className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"><Download size={14} /> Descargar</a>
              <button type="button" onClick={() => setViendo(null)} aria-label="Cerrar" className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"><X size={16} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-100 dark:bg-black/30 flex items-center justify-center">
              {tipo === 'imagen' && <img src={viendo.url} alt={viendo.nombre} className="max-w-full max-h-[80vh] object-contain" />}
              {(tipo === 'pdf' || tipo === 'texto') && <iframe src={viendo.url} title={viendo.nombre} className="w-full h-[80vh] bg-white" />}
              {tipo === 'otro' && (
                <div className="p-10 text-center text-[13px] text-slate-600 dark:text-slate-300">
                  Este tipo de archivo (.{extDe(viendo.nombre)}) no se puede previsualizar en el navegador.
                  <div className="mt-3"><a href={viendo.url} target="_blank" rel="noreferrer" download={viendo.nombre} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2"><Download size={15} /> Descargar</a></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
