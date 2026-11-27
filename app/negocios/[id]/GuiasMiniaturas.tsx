'use client';

// «Entrega y acta»: las guías de despacho de Obuma del negocio en miniatura, debajo de las órdenes de compra (misma forma). Cada una dice si
// está en el centro de costo del proyecto o en otro. «Enlazar» anota sus folios como N° de guía de la entrega; los PDF no se guardan.
// Solo aparece donde la empresa usa Obuma (la ruta responde 403 en las demás).
import { useEffect, useRef, useState } from 'react';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';
import { MiniaturaDoc } from './MiniaturaDoc';

interface Guia { folio: string; fecha: string; neto: number; anulada: boolean; xml: string | null; pdf: string | null; centroNombre: string | null; delProyecto: boolean }
interface Datos { guias: Guia[]; proyecto: { folio: string | null; centro: string | null } }

// Consultar Obuma tarda unos 20 s: al volver a la pestaña se muestra lo último mientras se actualiza.
const LISTAS = new Map<number, Datos>();
const BLOBS = new Map<string, string>();

const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
const fechaCorta = (f: string) => f.split('-').reverse().join('-');

// El PDF es la copia de consulta armada desde el XML (sin timbre del SII): se pide solo cuando la tarjeta se ve.
function MiniaturaGuia({ url, guia, enEntrega }: { url: string; guia: Guia; enEntrega: boolean }) {
  const clave = `${url}:${guia.folio}`;
  const [src, setSrc] = useState<string | null>(BLOBS.get(clave) ?? null);
  const [visible, setVisible] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const verPdf = `${url}?pdf=${encodeURIComponent(guia.folio)}`;
  useEffect(() => {
    const el = caja.current; if (!el) return;
    const o = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); o.disconnect(); } }, { rootMargin: '200px' });
    o.observe(el); return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !guia.xml || BLOBS.has(clave)) return;
    let vivo = true;
    fetch(verPdf).then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => { const u = URL.createObjectURL(b); BLOBS.set(clave, u); if (vivo) setSrc(u); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [visible, guia.xml, verPdf, clave]);
  return (
    <div ref={caja} className="flex-shrink-0 w-[150px]">
      <MiniaturaDoc ancho={148} src={src} titulo={`Guía ${guia.folio}${guia.anulada ? ' (anulada)' : ''}`} detalle={`${fechaCorta(guia.fecha)} · ${clp(guia.neto)} neto`}
        onAbrir={() => { const destino = guia.xml ? verPdf : guia.pdf; if (destino) window.open(destino, '_blank', 'noopener'); }} />
      <p className={`mt-1 text-[10.5px] leading-snug ${guia.delProyecto ? 'text-teal-700' : 'text-amber-700'}`}>
        {guia.delProyecto ? 'Centro de costo del proyecto' : `Otro centro de costo: ${guia.centroNombre || 'sin centro'}`}
      </p>
      {enEntrega && <p className="text-[10.5px] font-semibold text-teal-800">En la entrega</p>}
    </div>
  );
}

export function GuiasMiniaturas({ negocioId, actuales, puedeOperar, guardando, onEnlazar }: {
  negocioId: number; actuales: string | null; puedeOperar: boolean; guardando: boolean; onEnlazar: (numeros: string) => void;
}) {
  const url = `/api/compras/${negocioId}/guia-despacho-obuma`;
  const [datos, setDatos] = useState<Datos | null>(LISTAS.get(negocioId) ?? null);
  const [error, setError] = useState(false);
  const [noAplica, setNoAplica] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`${url}?guias=1`).then(async r => {
      if (r.status === 403) { if (vivo) setNoAplica(true); return; }
      const d = await r.json();
      if (!d?.success) throw new Error();
      LISTAS.set(negocioId, d); if (vivo) setDatos(d);
    }).catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [url, negocioId]);

  if (noAplica) return null;
  // Lo ya anotado (a mano o leído del escaneo) se conserva: solo se agregan los folios vigentes de Obuma que falten.
  const anotados: string[] = actuales?.match(/\d+/g) ?? [];
  const guias = [...(datos?.guias ?? [])].sort((a, b) => Number(a.folio) - Number(b.folio));
  const porEnlazar = guias.filter(g => !g.anulada && !anotados.includes(g.folio)).map(g => g.folio);
  const proyecto = [datos?.proyecto.folio && `Proyecto PR-${datos.proyecto.folio}`, datos?.proyecto.centro && `centro de costo ${datos.proyecto.centro}`].filter(Boolean).join(' · ');

  return (
    <div className="bg-white border border-linea rounded-2xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800 p-5 mb-3" data-testid="guias-miniaturas">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <p className="text-[12.5px] font-medium text-tinta-2 dark:text-slate-300">Guías de despacho en Obuma{proyecto && <span className="text-xs font-normal text-tinta-3 dark:text-slate-500"> · {proyecto}</span>}</p>
        {puedeOperar && porEnlazar.length > 0 && (
          <button onClick={() => onEnlazar([...(actuales ? [actuales] : []), ...porEnlazar].join(', '))} disabled={guardando}
            className="inline-flex items-center gap-2 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
            {guardando && <Loader2 size={13} className="animate-spin" />}
            {porEnlazar.length === 1 ? `Enlazar guía ${porEnlazar[0]} a la entrega` : `Enlazar ${porEnlazar.length} guías a la entrega`}
          </button>
        )}
      </div>
      {!datos && !error && <p className="inline-flex items-center gap-2 text-[12px] text-zinc-500"><Loader2 size={13} className="animate-spin" /> Buscando guías en Obuma (puede tardar unos 20 segundos)…</p>}
      {error && <p className="text-[12px] text-zinc-500">No se pudieron consultar las guías en Obuma. Recarga la página para reintentar.</p>}
      {datos && guias.length === 0 && <p className="text-[12px] text-zinc-500">No hay guías de esta licitación en Obuma. Puedes subir la guía firmada más abajo.</p>}
      {guias.length > 0 && <div className="flex gap-3 overflow-x-auto pb-1">{guias.map(g => <MiniaturaGuia key={g.folio} url={url} guia={g} enEntrega={anotados.includes(g.folio)} />)}</div>}
    </div>
  );
}
