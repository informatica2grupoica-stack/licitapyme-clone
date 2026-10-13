'use client';

// "PDF oficial": abre la ficha de la OC en Mercado Público para que la persona pinche el icono PDF
// (el reCAPTCHA de MP solo deja bajarlo con un clic humano) y, en la misma acción, abre una caja
// donde soltar el archivo descargado. Se guarda en R2 + Documentos de la licitación y reemplaza al
// PDF de la ficha impresa. Ver /api/ordenes-compra/pdf/subir.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { soportaCarpetaDescargas, carpetaDescargasAutorizada, autorizarCarpetaDescargas, esperarPdfEnCarpeta } from '@/app/lib/carpeta-descargas-cliente';
import { IconUpload as Upload, IconX as X, IconLoader2 as Loader2, IconExternalLink as ExternalLink, IconFileTypePdf as FilePdf } from '@tabler/icons-react';

export function SubirPdfOficialOC({
  codigoOC, urlFicha, onSubido, className, children,
}: {
  codigoOC: string;
  urlFicha: string;
  onSubido: (url: string) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Vigilancia de Descargas: 'sin-soporte' (Firefox/Safari) | 'sin-permiso' | 'vigilando'.
  const [vigilancia, setVigilancia] = useState<'sin-soporte' | 'sin-permiso' | 'vigilando'>('sin-permiso');
  const abortRef = useRef<AbortController | null>(null);
  const abiertoAtRef = useRef(0);

  const cerrar = useCallback(() => { abortRef.current?.abort(); setAbierto(false); setError(null); }, []);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto, cerrar]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const vigilar = (handle: any) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setVigilancia('vigilando');
    esperarPdfEnCarpeta(handle, codigoOC, abiertoAtRef.current, ac.signal).then(f => {
      if (f && !ac.signal.aborted) subir(f);
    });
  };

  const abrir = async () => {
    window.open(urlFicha, '_blank', 'noopener,noreferrer');
    abiertoAtRef.current = Date.now();
    setAbierto(true);
    if (!soportaCarpetaDescargas()) { setVigilancia('sin-soporte'); return; }
    const h = await carpetaDescargasAutorizada();
    if (h) vigilar(h); else setVigilancia('sin-permiso');
  };

  const activarAutomatico = async () => {
    try {
      const h = await autorizarCarpetaDescargas();
      if (h) vigilar(h);
    } catch { /* el usuario canceló el selector: queda el arrastre manual */ }
  };

  const subir = async (archivo: File | undefined) => {
    if (!archivo) return;
    setSubiendo(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('codigoOC', codigoOC);
      fd.append('archivo', archivo);
      const r = await fetch('/api/ordenes-compra/pdf/subir', { method: 'POST', body: fd });
      const d = await r.json().catch(() => null);
      if (!d?.success || !d.url) throw new Error(d?.error || 'No se pudo guardar el PDF');
      onSubido(d.url);
      cerrar();
    } catch (e: any) {
      setError(e.message || 'No se pudo guardar el PDF');
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <>
      <button type="button" onClick={abrir} className={className}
        title="Abre la OC en Mercado Público para descargar el PDF oficial y guardarlo aquí">
        {children ?? <><FilePdf size={12} /> PDF oficial</>}
      </button>
      {abierto && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={cerrar}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-bold text-slate-800">PDF oficial de la OC</h3>
                <p className="text-[11px] text-slate-500 font-mono">{codigoOC}</p>
              </div>
              <button onClick={cerrar} aria-label="Cerrar" className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} className="text-slate-500" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <ol className="text-[12px] text-slate-600 list-decimal pl-4 space-y-1">
                <li>En la pestaña de Mercado Público que se abrió, pincha el icono <b>PDF</b>.</li>
                <li>{vigilancia === 'vigilando'
                  ? 'Apenas se descargue, se sube solo. No tienes que hacer nada más.'
                  : 'Cuando se descargue, arrastra el archivo aquí (o elígelo).'}</li>
              </ol>
              {vigilancia === 'vigilando' && !subiendo && (
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                  <Loader2 size={13} className="animate-spin" /> Esperando el PDF en tu carpeta Descargas…
                </p>
              )}
              {vigilancia === 'sin-permiso' && (
                <button type="button" onClick={activarAutomatico}
                  className="w-full text-[12px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg px-3 py-2">
                  Subir automáticamente al descargar (elige tu carpeta Descargas, solo la primera vez)
                </button>
              )}
              <a href={urlFicha} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700">
                <ExternalLink size={12} /> Abrir de nuevo la OC en Mercado Público
              </a>
              <div
                onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={e => { e.preventDefault(); setArrastrando(false); subir(e.dataTransfer.files?.[0]); }}
                onClick={() => !subiendo && inputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${arrastrando ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-slate-50/60'}`}>
                {subiendo
                  ? <Loader2 size={20} className="animate-spin text-indigo-500 mx-auto" />
                  : <Upload size={20} className="text-slate-400 mx-auto" />}
                <p className="text-[12.5px] font-semibold text-slate-700 mt-2">{subiendo ? 'Guardando…' : 'Suelta el PDF aquí'}</p>
                <p className="text-[11px] text-slate-400">o haz clic para elegirlo</p>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden"
                  onChange={e => { subir(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
              {error && <p className="text-[12px] text-rose-600">{error}</p>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
