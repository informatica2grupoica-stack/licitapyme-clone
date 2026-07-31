'use client';
// app/components/DocumentosActa.tsx
// Anexos de la adjudicación dentro de la sección "Resultado": acta de evaluación, resolución que
// adjudica y declaraciones juradas.
//
// Antes acá solo había un link que sacaba al usuario a Mercado Público. El acta de evaluación es
// EL documento que explica por qué ganamos o perdimos, así que se lee con el mismo gesto que
// todo lo demás del sistema: ojo para verlo sin descargar (DocumentViewerModal, el mismo visor de
// los documentos propios) y flecha para bajarlo.
//
// El acta de evaluación va primero y destacada: el resto (declaraciones juradas de los
// evaluadores) es trámite; ésa es la que se lee.

import { useEffect, useState, useCallback } from 'react';
import {
  FileCheck2, Loader2, Download, Eye, AlertTriangle, RefreshCw, Star, FileText,
} from 'lucide-react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';

interface DocActa {
  id: number; nombre: string; tipo: string; esActaEvaluacion: boolean;
  descripcion: string | null; tamanoKb: number | null; fechaAdjunto: string | null;
  url: string | null; error: string | null;
}
interface Vista {
  codigo: string; tieneActa: boolean; urlActa: string | null;
  documentos: DocActa[]; descargados: number; leida: boolean;
}

const peso = (kb: number | null) =>
  kb == null ? '' : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

export default function DocumentosActa({ codigo, isAdmin, acento = '#4f46e5' }: {
  codigo: string; isAdmin: boolean; acento?: string;
}) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState<'leer' | 'bajar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/licitacion/acta?codigo=${encodeURIComponent(codigo)}`);
      const d = await r.json();
      if (!r.ok) { setError(d?.error || 'No se pudieron cargar los documentos del acta'); return; }
      setVista(d); setError(null);
    } catch {
      setError('No se pudieron cargar los documentos del acta');
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (descargar: boolean) => {
    setTrabajando(descargar ? 'bajar' : 'leer'); setError(null);
    try {
      const r = await fetch('/api/licitacion/acta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, descargar }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.error || 'No se pudo completar la operación'); return; }
      if (d.vista) setVista(d.vista);
      // Traer la lista y no encontrar nada NO es un error, pero hay que decirlo: si no, el
      // botón parece no haber hecho nada.
      if (!descargar && d.documentos === 0) setError('El acta no publica anexos descargables.');
    } catch {
      setError('No se pudo completar la operación');
    } finally {
      setTrabajando(null);
    }
  };

  // Sin acta en Mercado Público no hay nada que mostrar: la licitación no está adjudicada aún.
  if (cargando) {
    return (
      <p className="text-[12px] text-slate-400 inline-flex items-center gap-1.5 px-5 py-3">
        <Loader2 size={12} className="animate-spin" /> Cargando documentos del acta…
      </p>
    );
  }
  if (!vista?.tieneActa) return null;

  const docs = vista.documentos;
  const pendientes = docs.length - vista.descargados;

  return (
    <div className="px-5 py-4 border-t" style={{ borderColor: acento + '22' }}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[12px] font-bold text-slate-700 inline-flex items-center gap-1.5">
          <FileCheck2 size={13} style={{ color: acento }} /> Documentos del acta
          {docs.length > 0 && <span className="font-normal text-slate-400">· {vista.descargados}/{docs.length} disponibles</span>}
        </p>
        {isAdmin && (
          <div className="flex items-center gap-1.5">
            {pendientes > 0 && docs.length > 0 && (
              <button onClick={() => accion(true)} disabled={trabajando !== null}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:text-slate-300 disabled:border-slate-200 px-2.5 py-1 rounded-lg transition-colors">
                {trabajando === 'bajar'
                  ? <><Loader2 size={11} className="animate-spin" /> Descargando…</>
                  : <><Download size={11} /> Traer {pendientes} pendiente(s)</>}
              </button>
            )}
            <button onClick={() => accion(false)} disabled={trabajando !== null}
              title="Volver a leer el acta en Mercado Público"
              className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:text-slate-300 px-2.5 py-1 rounded-lg transition-colors">
              {trabajando === 'leer'
                ? <><Loader2 size={11} className="animate-spin" /> Leyendo…</>
                : <><RefreshCw size={11} /> {docs.length ? 'Releer' : 'Buscar documentos'}</>}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {docs.length === 0 ? (
        <p className="text-[11.5px] text-slate-500">
          {isAdmin
            ? 'Todavía no se han traído los documentos del acta. Usa "Buscar documentos".'
            : 'Todavía no se han traído los documentos del acta.'}
        </p>
      ) : (
        <div className="space-y-1">
          {docs.map(d => (
            <div key={d.id}
              className={`flex items-center gap-2 text-[12px] rounded-lg px-2 py-1.5 ${
                d.esActaEvaluacion ? 'bg-amber-50/70 border border-amber-200' : 'hover:bg-slate-50'}`}>
              {d.esActaEvaluacion
                ? <Star size={13} className="text-amber-500 flex-shrink-0" />
                : <FileText size={13} className="text-slate-300 flex-shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${d.esActaEvaluacion ? 'font-semibold text-amber-900' : 'text-slate-700'}`}
                  title={d.descripcion || d.nombre}>
                  {d.nombre}
                </span>
                <span className="block text-[10.5px] text-slate-400">
                  {d.tipo}{d.tamanoKb != null ? ` · ${peso(d.tamanoKb)}` : ''}{d.fechaAdjunto ? ` · ${d.fechaAdjunto}` : ''}
                </span>
              </span>
              {d.url ? (
                <>
                  <button onClick={() => setVisor({ nombre: d.nombre, url: d.url! })} title="Ver sin descargar"
                    className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-colors flex-shrink-0">
                    <Eye size={13} />
                  </button>
                  <a href={d.url} target="_blank" rel="noopener noreferrer" title="Descargar"
                    className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-colors flex-shrink-0">
                    <Download size={13} />
                  </a>
                </>
              ) : (
                // Detectado pero sin copia propia: se dice por qué en vez de esconderlo.
                <span className="text-[10.5px] text-amber-600 flex-shrink-0" title={d.error || 'Pendiente de descarga'}>
                  {d.error ? 'no se pudo bajar' : 'pendiente'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
