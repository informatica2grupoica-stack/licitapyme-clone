'use client';

// POSTULACIÓN: SOLO los documentos que se suben a Mercado Público — los PDF de los anexos ya generados y cargados.
// Aquí no se genera ni se revisa nada: los anexos se generan en Pre-postulación («Generar anexo» en cada punto) y llegan solos a esta lista.
import { useEffect, useState } from 'react';
import { IconLoader2 as Loader2, IconFileTypePdf as Pdf, IconEye as Eye, IconDownload as Download } from '@tabler/icons-react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import type { DocumentoOfertaDTO } from '@/app/lib/auditor-prepostulacion';
import { pedirJson, ultimoJson } from '@/app/lib/pedir-json';

const ESTADO: Record<string, { label: string; cls: string }> = {
  APROBADO: { label: 'Aprobado', cls: 'text-emerald-700' }, CARGADO: { label: 'Por aprobar', cls: 'text-teal-700' },
  OBSERVADO: { label: 'Observado', cls: 'text-orange-700' }, PENDIENTE: { label: 'Pendiente', cls: 'text-zinc-500' },
};

const docsDeCache = (negocioId: number): DocumentoOfertaDTO[] | null => {
  const d = ultimoJson(`/api/negocios/${negocioId}/prepostulacion`);
  return d ? (d.migracionPendiente ? [] : (d.documentosOferta ?? [])) : null;
};

export function PostulacionPanel({ negocioId, onIrAPrePostulacion, documentosIniciales }: { negocioId: number; onIrAPrePostulacion: () => void; documentosIniciales?: DocumentoOfertaDTO[] }) {
  const [docs, setDocs] = useState<DocumentoOfertaDTO[] | null>(documentosIniciales ?? docsDeCache(negocioId));
  const [error, setError] = useState<string | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);

  useEffect(() => {
    if (documentosIniciales) return;
    let vivo = true;
    pedirJson(`/api/negocios/${negocioId}/prepostulacion`).then(d => {
      if (!vivo) return;
      if (!d?.success) throw new Error(d?.error || 'No se pudo cargar');
      setDocs(d.migracionPendiente ? [] : (d.documentosOferta ?? []));
    }).catch(e => { if (vivo) setError(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
  }, [negocioId, documentosIniciales]);

  if (error) return <p className="text-[12.5px] text-rose-600">{error}</p>;
  if (!docs) return <div className="flex items-center gap-2 text-[12.5px] text-zinc-400 py-10 justify-center"><Loader2 size={14} className="animate-spin" /> Cargando documentos…</div>;

  const archivos = docs.flatMap(x => x.documentos.map(d => ({ ...d, titulo: x.titulo, estado: x.estado, bloque: x.bloque })));
  const faltan = docs.filter(x => x.documentos.length === 0);

  const aprobados = archivos.filter(a => a.estado === 'APROBADO').length;
  const bloque = 'bg-white dark:bg-slate-900 rounded-2xl border border-linea shadow-tarjeta p-5';
  return (
    <div className="@container space-y-3">
    <div className="grid gap-3 @xl:grid-cols-3">
      <div className={bloque}>
        <p className="text-xs text-slate-600 flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500"><Pdf size={15} /></span>Archivos listos</p>
        <p className="mt-3 text-[28px] leading-none font-semibold tracking-tight tabular-nums text-zinc-900">{archivos.length}</p>
        <p className="mt-2 text-xs text-slate-600">para subir a Mercado Público</p>
      </div>
      <div className={bloque}>
        <p className="text-xs text-slate-600">Aprobados</p>
        <p className="mt-3 text-[28px] leading-none font-semibold tracking-tight tabular-nums text-zinc-900">{aprobados}<span className="text-base font-normal text-slate-500"> de {archivos.length}</span></p>
        <div className="mt-3 h-1.5 rounded-full bg-zinc-100 dark:bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{ width: `${archivos.length ? Math.round(aprobados / archivos.length * 100) : 0}%` }} /></div>
      </div>
      <div className={bloque}>
        <p className="text-xs text-slate-600">Falta el archivo</p>
        <p className={`mt-3 text-[28px] leading-none font-semibold tracking-tight tabular-nums ${faltan.length ? 'text-amber-700' : 'text-emerald-700'}`}>{faltan.length}</p>
        <p className="mt-2 text-xs text-slate-600">{faltan.length ? 'se generan en Pre-postulación' : 'no falta ninguno'}</p>
      </div>
    </div>
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-linea shadow-tarjeta overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <h3 className="text-[13.5px] font-semibold text-zinc-900">Documentos para subir a Mercado Público</h3>
        <span className="text-[11.5px] text-zinc-400">{archivos.length} {archivos.length === 1 ? 'archivo listo' : 'archivos listos'}</span>
      </div>
      {archivos.length === 0 ? (
        <p className="px-5 py-8 text-[12.5px] text-zinc-400 text-center">Todavía no hay archivos. Los anexos se generan o se adjuntan en Pre-postulación y quedan aquí.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {archivos.map(a => (
            <li key={a.id} className="px-5 py-2.5 flex items-center gap-3">
              <Pdf size={18} className="text-rose-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-zinc-800 truncate" title={a.nombre}>{a.nombre}</p>
                <p className="text-[11px] text-zinc-400 truncate">{a.titulo}</p>
              </div>
              <span className={`shrink-0 text-[10px] font-semibold ${(ESTADO[a.estado] || ESTADO.PENDIENTE).cls}`}>{(ESTADO[a.estado] || ESTADO.PENDIENTE).label}</span>
              <button onClick={() => setVisor({ nombre: a.nombre, url: a.url })} title="Ver" className="p-1.5 rounded text-zinc-400 hover:text-teal-600 hover:bg-teal-50"><Eye size={15} /></button>
              <a href={a.url} download={a.nombre} title="Descargar" className="p-1.5 rounded text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50"><Download size={15} /></a>
            </li>
          ))}
        </ul>
      )}
      {faltan.length > 0 && (
        <div className="px-5 py-3 border-t border-zinc-100 text-[12px] text-zinc-500">
          <b className="text-zinc-700">Falta el archivo:</b> {faltan.map(x => x.titulo).join(' · ')}.{' '}
          <button onClick={onIrAPrePostulacion} className="text-teal-600 font-semibold hover:underline">Ir a Pre-postulación</button>
        </div>
      )}
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
    </div>
  );
}
