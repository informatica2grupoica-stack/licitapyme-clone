'use client';

// Paso previo al relleno de un anexo desde el Auditor Técnico: el checklist solo tiene un
// TÍTULO ("Anexo N°2-A - Declaración jurada simple"), nunca supo cuál de los Word reales de la
// licitación es ese anexo. Este selector lista los .doc/.docx de la licitación, los ordena por
// coincidencia con el título (anexos-match.ts) y deja elegir con un clic — el match automático
// es una sugerencia, nunca una decisión silenciosa.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FileText, AlertTriangle, Wand2 } from 'lucide-react';
import { ordenarPorCoincidencia } from '@/app/lib/anexos-match';
import type { AnexoDoc } from '@/app/components/AnexoRellenoModal';

interface DocCache { id: number; documento_nombre: string; documento_url_local: string; categoria?: string | null }

// Cuando la licitación no publicó ningún Word, los anexos suelen venir impresos DENTRO del PDF de
// bases (ver anexos-en-bases.ts). Sin esto el modal decía "descárgalos en la pestaña Documentos",
// mandando a buscar un archivo que no existe — pasa en 30 de las licitaciones ya descargadas.
interface AnexosEnBases {
  documento: { id: number; nombre: string; url: string };
  paginaInicio: number | null;
  anexos: { titulo: string; pagina: number | null }[];
}

export function SelectorDocumentoAnexo({
  codigo, tituloItem, onSeleccionar, onClose,
}: {
  codigo: string | null;
  tituloItem: string | null;
  onSeleccionar: (doc: AnexoDoc) => void;
  onClose: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<(DocCache & { puntaje: number })[]>([]);
  const [enBases, setEnBases] = useState<AnexosEnBases | null>(null);

  useEffect(() => {
    if (!codigo || !tituloItem) return;
    setCargando(true);
    setError(null);
    setEnBases(null);
    fetch(`/api/documentos/cache/${encodeURIComponent(codigo)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) { setError(d.error || 'No se pudo listar los documentos'); return; }
        // Solo Word reales de la licitación — nunca los que ya generamos nosotros (Documentos
        // Propios), que son el RESULTADO de este mismo flujo, no la fuente.
        const docs: DocCache[] = (d.documentos || []).filter((doc: DocCache) =>
          doc.id != null
          && /\.docx?$/i.test(doc.documento_nombre || '')
          && String(doc.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS',
        );
        const ordenados = ordenarPorCoincidencia(tituloItem, docs.map(doc => ({ id: doc.id, nombre: doc.documento_nombre })));
        setCandidatos(docs.map(doc => ({
          ...doc,
          puntaje: ordenados.find(o => o.id === doc.id)?.puntaje ?? 0,
        })).sort((a, b) => b.puntaje - a.puntaje));
        // Sin ningún Word que ofrecer, hay que averiguar si los anexos están dentro del PDF de
        // bases antes de decirle nada al usuario. Nunca bloquea la lista: si falla, se cae al
        // mensaje de siempre.
        if (docs.length === 0) {
          fetch(`/api/anexos/en-bases?codigo=${encodeURIComponent(codigo)}`)
            .then(r => r.json())
            .then(res => { if (res?.success && res.hay) setEnBases(res); })
            .catch(() => {});
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setCargando(false));
  }, [codigo, tituloItem]);

  if (!codigo || !tituloItem) return null;

  const mejorPuntaje = candidatos[0]?.puntaje ?? 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Elegir documento del anexo"
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <Wand2 size={15} className="text-indigo-600 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-slate-800 truncate" title={tituloItem}>{tituloItem}</p>
            <p className="text-[10.5px] text-slate-400">¿Cuál de estos Word es este anexo?</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {cargando && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 size={15} className="animate-spin text-indigo-500" /> Buscando documentos…
            </div>
          )}
          {!cargando && error && (
            <div className="flex items-start gap-2 px-3 py-2.5 m-1 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800">{error}</p>
            </div>
          )}
          {/* Los anexos vienen impresos dentro del PDF de bases: no hay Word que rellenar, pero sí
              se puede decir exactamente dónde están en vez de mandar a buscar a ciegas. */}
          {!cargando && !error && candidatos.length === 0 && enBases && (
            <div className="p-1">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-amber-900">
                    Esta licitación no publicó los anexos como archivos aparte
                  </p>
                  <p className="text-[11.5px] text-amber-800 mt-0.5">
                    Sus {enBases.anexos.length} anexos vienen dentro de{' '}
                    <span className="font-medium">{enBases.documento.nombre}</span>
                    {enBases.paginaInicio != null && <>, desde la página {enBases.paginaInicio}</>}.
                    Como es un PDF, hay que llenarlos a mano — el relleno automático solo funciona sobre Word.
                  </p>
                </div>
              </div>

              <ul className="mt-1.5 max-h-[30vh] overflow-y-auto">
                {enBases.anexos.map((a, i) => (
                  <li key={`${a.titulo}-${i}`}>
                    <a
                      href={a.pagina != null ? `${enBases.documento.url}#page=${a.pagina}` : enBases.documento.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors group"
                    >
                      <FileText size={14} className="text-slate-400 group-hover:text-indigo-500 flex-shrink-0" />
                      <span className="flex-1 min-w-0 text-[12.5px] text-slate-700 truncate" title={a.titulo}>{a.titulo}</span>
                      {a.pagina != null && (
                        <span className="flex-shrink-0 text-[10px] font-medium text-slate-400 group-hover:text-indigo-500">
                          pág. {a.pagina}
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!cargando && !error && candidatos.length === 0 && !enBases && (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center px-4">
              <FileText size={20} className="text-slate-300" />
              <p className="text-[12.5px] text-slate-500">Esta licitación no tiene documentos Word descargados todavía.</p>
              <p className="text-[11px] text-slate-400">Descárgalos en la pestaña Documentos y vuelve a intentar.</p>
            </div>
          )}
          {!cargando && !error && candidatos.map((c, i) => (
            <button
              key={c.id}
              onClick={() => onSeleccionar({ id: c.id, nombre: c.documento_nombre, url: c.documento_url_local })}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-indigo-50 text-left transition-colors group"
            >
              <FileText size={15} className="text-slate-400 group-hover:text-indigo-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 text-[12.5px] font-medium text-slate-700 truncate" title={c.documento_nombre}>
                {c.documento_nombre}
              </span>
              {i === 0 && mejorPuntaje > 0 && (
                <span className="flex-shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  Sugerido
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
