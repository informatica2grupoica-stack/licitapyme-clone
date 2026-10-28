'use client';

// «Traer desde Documentos» (28-oct-2026): el anexo se hizo fuera de la app (firma a puño y letra) y
// se subió a Documentos, pero no quedó en ninguna casilla de Pre-postulación — y Postulación salía
// vacía (4022-19-LE26). Este modal lo enlaza: no vuelve a subir nada, usa la misma acción CARGAR que
// «Enviar al Auditor» de Documentos, así que el punto queda «Por aprobar» con la firma de quien cargó.
// Dos modos: elegir el archivo de UN punto, o repartir todos los sueltos de una vez (propuesta por
// número de anexo que la persona revisa antes de cargar; ver anexos-traer.ts).
import { useMemo, useState } from 'react';
import { Modal } from '@/app/components/ui/Modal';
import { IconLoader2 as Loader2, IconFileText as FileText, IconExternalLink as ExternalLink } from '@tabler/icons-react';
import { ordenarPorCoincidencia } from '@/app/lib/anexos-match';
import { proponerReparto, tituloDesdeArchivo, type DocPropio, type PuntoAnexo } from '@/app/lib/anexos-traer';

const NUEVO = 'nuevo';

export type ModoTraer = { tipo: 'punto'; punto: PuntoAnexo } | { tipo: 'repartir' };

export function TraerDocumentosModal({ modo, docs, sueltos, puntos, puntoDeUrl, onCargar, onCrearPunto, onClose }: {
  modo: ModoTraer | null;
  /** Archivos propios que pueden ir en la oferta (documentosPropiosDeOferta). */
  docs: DocPropio[];
  /** Los que no están en ninguna casilla. */
  sueltos: DocPropio[];
  puntos: PuntoAnexo[];
  /** url → punto donde ya está cargado. */
  puntoDeUrl: Map<string, { id: number; titulo: string }>;
  onCargar: (itemId: number, docs: Array<{ nombre: string; url: string }>) => Promise<boolean>;
  onCrearPunto: (titulo: string) => Promise<number | null>;
  onClose: () => void;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const cerrar = () => { if (!trabajando) onClose(); };

  return (
    <Modal open={modo != null} onClose={cerrar} size="md"
      title={modo?.tipo === 'punto' ? 'Traer desde Documentos' : 'Repartir archivos de Documentos'}
      subtitle={modo?.tipo === 'punto' ? modo.punto.titulo : 'Revisa a qué punto va cada archivo antes de cargarlos.'}>
      {modo?.tipo === 'punto' && (
        <ElegirParaPunto punto={modo.punto} docs={docs} sueltos={sueltos} puntoDeUrl={puntoDeUrl} trabajando={trabajando}
          onElegir={async d => {
            setTrabajando(true);
            try { if (await onCargar(modo.punto.id, [{ nombre: d.documento_nombre, url: d.documento_url_local }])) onClose(); }
            finally { setTrabajando(false); }
          }} />
      )}
      {modo?.tipo === 'repartir' && (
        <Repartir sueltos={sueltos} puntos={puntos} trabajando={trabajando} setTrabajando={setTrabajando}
          onCargar={onCargar} onCrearPunto={onCrearPunto} onListo={onClose} />
      )}
    </Modal>
  );
}

function LinkVer({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir en otra pestaña"
      className="p-1 text-slate-400 hover:text-teal-700 hover:bg-slate-100 rounded transition-colors flex-shrink-0">
      <ExternalLink size={14} />
    </a>
  );
}

function SinArchivos() {
  return (
    <p className="text-sm text-slate-500 py-6 text-center">
      No hay archivos propios en Documentos. Súbelos en <b className="font-medium text-slate-700">Documentos › Documentos para Mercado Público</b> y vuelve.
    </p>
  );
}

function ElegirParaPunto({ punto, docs, sueltos, puntoDeUrl, trabajando, onElegir }: {
  punto: PuntoAnexo; docs: DocPropio[]; sueltos: DocPropio[]; puntoDeUrl: Map<string, { id: number; titulo: string }>; trabajando: boolean;
  onElegir: (d: DocPropio) => void;
}) {
  // Mejor coincidencia primero; a igual puntaje, los sueltos antes que los ya cargados en otro punto.
  const lista = useMemo(() => {
    const idsSueltos = new Set(sueltos.map(d => d.id));
    return ordenarPorCoincidencia(punto.titulo, docs.map(d => ({ ...d, nombre: d.documento_nombre })))
      .sort((a, b) => b.puntaje - a.puntaje || Number(idsSueltos.has(b.id)) - Number(idsSueltos.has(a.id)));
  }, [punto.titulo, docs, sueltos]);
  if (lista.length === 0) return <SinArchivos />;

  return (
    <ul className="divide-y divide-slate-100 -mx-1">
      {lista.map((d, i) => {
        const enPunto = puntoDeUrl.get(d.documento_url_local);
        const yaAqui = enPunto?.id === punto.id;
        const sugerido = i === 0 && d.puntaje >= 10;
        return (
          <li key={d.id} className="flex items-center gap-2 px-1 py-2.5">
            <FileText size={15} className="text-slate-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800 truncate" title={d.documento_nombre}>{d.documento_nombre}</p>
              <p className="text-[11px] text-slate-500">
                {yaAqui ? 'Ya está en este punto' : enPunto ? `Ya está en «${enPunto.titulo}»` : sugerido ? 'El que más se parece' : 'Sin casilla todavía'}
              </p>
            </div>
            <LinkVer url={d.documento_url_local} />
            <button type="button" disabled={trabajando || yaAqui} onClick={() => onElegir(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 ${sugerido ? 'bg-teal-700 text-white hover:bg-teal-800' : 'border border-slate-200 text-teal-700 hover:bg-slate-50'}`}>
              Cargar aquí
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Repartir({ sueltos, puntos, trabajando, setTrabajando, onCargar, onCrearPunto, onListo }: {
  sueltos: DocPropio[]; puntos: PuntoAnexo[]; trabajando: boolean; setTrabajando: (v: boolean) => void;
  onCargar: (itemId: number, docs: Array<{ nombre: string; url: string }>) => Promise<boolean>;
  onCrearPunto: (titulo: string) => Promise<number | null>;
  onListo: () => void;
}) {
  // destino por documento: '' = no cargar · id del punto · NUEVO = crear un punto con el nombre del archivo.
  // Se propone solo al abrir: mientras se revisa, una recarga en tiempo real no pisa lo que la persona eligió.
  const [destino, setDestino] = useState<Record<number, string>>(() =>
    Object.fromEntries(proponerReparto(sueltos, puntos).map(p => [p.doc.id, p.itemId != null ? String(p.itemId) : ''])));
  const elegidos = sueltos.filter(d => destino[d.id]);
  if (sueltos.length === 0) return <SinArchivos />;

  const cargar = async () => {
    setTrabajando(true);
    try {
      // Agrupado por punto: un punto con dos archivos se carga en una sola llamada.
      const porPunto = new Map<number, Array<{ nombre: string; url: string }>>();
      for (const d of elegidos) {
        const id = destino[d.id] === NUEVO ? await onCrearPunto(tituloDesdeArchivo(d.documento_nombre)) : Number(destino[d.id]);
        if (!id) continue;
        porPunto.set(id, [...(porPunto.get(id) || []), { nombre: d.documento_nombre, url: d.documento_url_local }]);
      }
      let ok = 0;
      for (const [id, archivos] of porPunto) if (await onCargar(id, archivos)) ok += archivos.length;
      if (ok === elegidos.length) onListo();
    } finally { setTrabajando(false); }
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 -mx-1">
        {sueltos.map(d => (
          <li key={d.id} className="flex items-center gap-2 px-1 py-2.5 flex-wrap sm:flex-nowrap">
            <FileText size={15} className="text-slate-400 flex-shrink-0" />
            <p className="min-w-0 flex-1 text-sm text-slate-800 truncate" title={d.documento_nombre}>{d.documento_nombre}</p>
            <LinkVer url={d.documento_url_local} />
            <select value={destino[d.id] ?? ''} disabled={trabajando} aria-label={`Punto para ${d.documento_nombre}`}
              onChange={e => setDestino(prev => ({ ...prev, [d.id]: e.target.value }))}
              className="w-full sm:w-72 text-xs text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">No cargar</option>
              {puntos.map(p => <option key={p.id} value={String(p.id)} disabled={p.estado === 'APROBADO'}>{p.titulo}{p.estado === 'APROBADO' ? ' (aprobado)' : ''}</option>)}
              <option value={NUEVO}>Punto nuevo: «{tituloDesdeArchivo(d.documento_nombre)}»</option>
            </select>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-3 pt-1">
        <p className="text-xs text-slate-500 mr-auto">Quedan «Por aprobar»: alguien del equipo los revisa y aprueba.</p>
        <button type="button" onClick={cargar} disabled={trabajando || elegidos.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed">
          {trabajando && <Loader2 size={14} className="animate-spin" />}
          Cargar {elegidos.length} archivo{elegidos.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
