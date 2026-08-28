'use client';

// Paso de firma libre sobre PDF — pedido explícito del usuario (29-ago-2026): "poder seleccionar
// la firma o el logo con un clic... moverla por todo el documento para acomodarla donde quiero,
// así como lo hace ecert Chile". Un .docx es texto que fluye, sin coordenadas de píxel; un PDF sí
// tiene página fija, así que ESTE es el único componente del sistema donde una imagen se ubica por
// posición absoluta en vez de anclarse a un párrafo. El PDF que recibe ya viene con el texto del
// anexo puesto (ver /api/anexos/vista-previa-pdf) — acá solo se posicionan firma/timbre; al
// confirmar, /api/anexos/generar-firmado quema cada una en su lugar exacto sobre ESE PDF.
//
// Posiciones en PORCENTAJE de la página (xPct/yPct/anchoPct), nunca en píxeles: el zoom con el que
// el usuario ve el PDF en su pantalla no tiene por qué coincidir con el tamaño real en puntos de
// la página — el porcentaje es invariante a eso y es justo lo que espera `estamparPdf`
// (anexos-pdf-firma.ts) en el servidor.
import { useEffect, useRef, useState } from 'react';
import { Loader2, X, Plus, Minus, ArrowLeft, FileSignature } from 'lucide-react';

export interface EstampaColocada { tipo: 'firma' | 'timbre'; pagina: number; xPct: number; yPct: number; anchoPct: number }
interface EstampaUI extends EstampaColocada { id: string }

const ANCHO_DEFECTO: Record<'firma' | 'timbre', number> = { firma: 0.22, timbre: 0.14 };
const PASO_TAMANO = 0.02;
const ESCALA_RENDER = 1.4; // fija: no depende del zoom del navegador, solo de qué tan nítido se ve

const clamp01 = (v: number, max = 1) => Math.min(Math.max(v, 0), max);

function Miniatura({ tipo, url }: { tipo: 'firma' | 'timbre'; url: string }) {
  return (
    <figure
      className="text-center cursor-grab active:cursor-grabbing select-none"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('application/json', JSON.stringify({ origen: 'nueva', tipo }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`Arrastra ${tipo === 'firma' ? 'la firma' : 'el timbre'} a cualquier punto del documento`}
    >
      <img src={url} alt={tipo} className="h-10 max-w-[110px] object-contain pointer-events-none border border-slate-200 rounded bg-white p-1" draggable={false} />
      <figcaption className="text-[10px] text-slate-400 mt-0.5">{tipo}</figcaption>
    </figure>
  );
}

/** Una imagen ya colocada sobre la página — se puede volver a arrastrar (a otra posición o a otra
 *  página), agrandar/achicar, o quitar. */
function EstampaColocadaUI({
  estampa, url, onQuitar, onRedimensionar,
}: {
  estampa: EstampaUI; url: string; onQuitar: () => void; onRedimensionar: (delta: number) => void;
}) {
  return (
    <div
      className="group absolute cursor-move"
      style={{ left: `${estampa.xPct * 100}%`, top: `${estampa.yPct * 100}%`, width: `${estampa.anchoPct * 100}%` }}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('application/json', JSON.stringify({ origen: 'mover', id: estampa.id }));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <img src={url} alt={estampa.tipo} className="w-full h-auto object-contain pointer-events-none drop-shadow" draggable={false} />
      <div className="absolute -top-2.5 -right-2.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button" onClick={onQuitar} title="Quitar"
          className="flex items-center justify-center w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow"
        >
          <X size={11} />
        </button>
      </div>
      <div className="absolute -bottom-2.5 right-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button" onClick={() => onRedimensionar(-PASO_TAMANO)} title="Achicar"
          className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-800 text-white shadow"
        >
          <Minus size={11} />
        </button>
        <button
          type="button" onClick={() => onRedimensionar(PASO_TAMANO)} title="Agrandar"
          className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-800 text-white shadow"
        >
          <Plus size={11} />
        </button>
      </div>
    </div>
  );
}

export function AnexoFirmarPdf({
  pdfBytes, firmaUrl, timbreUrl, generando, onConfirmar, onVolver,
}: {
  pdfBytes: ArrayBuffer;
  firmaUrl: string | null;
  timbreUrl: string | null;
  generando: boolean;
  onConfirmar: (estampas: EstampaColocada[]) => void;
  onVolver: () => void;
}) {
  const [dimensiones, setDimensiones] = useState<{ ancho: number; alto: number }[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estampas, setEstampas] = useState<EstampaUI[]>([]);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const idCounter = useRef(0);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    setEstampas([]);

    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        // pdf.js SE QUEDA CON el ArrayBuffer que le pasás (lo detachea) — una copia evita que un
        // segundo intento (o un StrictMode double-effect en dev) reciba un buffer ya vaciado.
        const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
        if (cancelado) return;

        const dims: { ancho: number; alto: number }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const pagina = await pdf.getPage(i);
          const viewport = pagina.getViewport({ scale: ESCALA_RENDER });
          dims.push({ ancho: viewport.width, alto: viewport.height });
        }
        if (cancelado) return;
        canvasRefs.current = new Array(pdf.numPages).fill(null);
        setDimensiones(dims);
        setCargando(false);

        // Los <canvas> recién existen en el DOM después de este render — se dibuja en el próximo frame.
        requestAnimationFrame(() => {
          (async () => {
            for (let i = 1; i <= pdf.numPages; i++) {
              if (cancelado) return;
              const canvas = canvasRefs.current[i - 1];
              const ctx = canvas?.getContext('2d');
              if (!canvas || !ctx) continue;
              const pagina = await pdf.getPage(i);
              const viewport = pagina.getViewport({ scale: ESCALA_RENDER });
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              await pagina.render({ canvas, canvasContext: ctx, viewport }).promise;
            }
          })();
        });
      } catch (e: any) {
        if (!cancelado) { setError(e?.message || 'No se pudo mostrar el PDF'); setCargando(false); }
      }
    })();

    return () => { cancelado = true; };
  }, [pdfBytes]);

  // Auto-scroll al arrastrar cerca de los bordes del contenedor — un anexo de varias páginas queda
  // más alto que la pantalla, y sin esto no habría forma de soltar la firma en una página de más
  // abajo sin soltar el mouse a mitad de camino primero.
  const MARGEN_AUTOSCROLL = 70;
  const autoScrollAlArrastrar = (e: React.DragEvent<HTMLDivElement>) => {
    const el = contenedorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const distanciaArriba = e.clientY - rect.top;
    const distanciaAbajo = rect.bottom - e.clientY;
    if (distanciaArriba < MARGEN_AUTOSCROLL) el.scrollTop -= (MARGEN_AUTOSCROLL - distanciaArriba) * 0.4;
    else if (distanciaAbajo < MARGEN_AUTOSCROLL) el.scrollTop += (MARGEN_AUTOSCROLL - distanciaAbajo) * 0.4;
  };

  const soltarEnPagina = (e: React.DragEvent<HTMLDivElement>, pagina: number) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    let datos: any;
    try { datos = JSON.parse(raw); } catch { return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = clamp01((e.clientX - rect.left) / rect.width, 0.96);
    const yPct = clamp01((e.clientY - rect.top) / rect.height, 0.97);

    if (datos.origen === 'nueva' && (datos.tipo === 'firma' || datos.tipo === 'timbre')) {
      setEstampas(prev => [...prev, {
        id: `e${idCounter.current++}`, tipo: datos.tipo, pagina, xPct, yPct, anchoPct: ANCHO_DEFECTO[datos.tipo as 'firma' | 'timbre'],
      }]);
    } else if (datos.origen === 'mover' && datos.id) {
      setEstampas(prev => prev.map(es => (es.id === datos.id ? { ...es, pagina, xPct, yPct } : es)));
    }
  };

  const quitarEstampa = (id: string) => setEstampas(prev => prev.filter(es => es.id !== id));
  const redimensionarEstampa = (id: string, delta: number) => setEstampas(prev => prev.map(es => (
    es.id === id ? { ...es, anchoPct: Math.min(0.6, Math.max(0.06, es.anchoPct + delta)) } : es
  )));

  const urlDe = (tipo: 'firma' | 'timbre') => (tipo === 'firma' ? firmaUrl : timbreUrl);
  const hayImagenes = !!firmaUrl || !!timbreUrl;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <button
          type="button" onClick={onVolver}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={14} /> Volver a los campos
        </button>
        <div className="w-px h-6 bg-slate-300" />
        {hayImagenes ? (
          <>
            <div className="flex items-center gap-3">
              {firmaUrl && <Miniatura tipo="firma" url={firmaUrl} />}
              {timbreUrl && <Miniatura tipo="timbre" url={timbreUrl} />}
            </div>
            <p className="text-[11.5px] text-slate-500 leading-snug flex-1">
              Arrastra la firma y/o el timbre a cualquier punto del documento — se puede mover, agrandar/achicar y quitar después de soltarla.
            </p>
          </>
        ) : (
          <p className="text-[11.5px] text-slate-500">
            No hay firma ni timbre cargados en la ficha de la empresa — súbelos en <strong>/empresas</strong> para poder colocarlas.
          </p>
        )}
      </div>

      <div ref={contenedorRef} onDragOver={autoScrollAlArrastrar} className="flex-1 overflow-y-auto bg-slate-200 px-4 py-6 flex flex-col items-center gap-6">
        {cargando && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-indigo-500" /> Preparando el PDF…
          </div>
        )}
        {!cargando && error && (
          <div className="max-w-md text-center py-16 text-[12.5px] text-rose-700">{error}</div>
        )}
        {!cargando && !error && dimensiones.map((dim, i) => (
          <div
            key={i}
            className="relative bg-white shadow-md"
            style={{ width: dim.ancho, height: dim.alto }}
            onDragOver={e => {
              e.preventDefault();
              // BUG REAL (29-ago-2026, reportado con video: la firma ya colocada se "cancelaba" y
              // volvía a su lugar al intentar re-arrastrarla). El drop de una NUEVA imagen declara
              // `effectAllowed:'copy'` (Miniatura) y el de MOVER una ya puesta declara 'move'
              // (EstampaColocadaUI) — acá se fijaba `dropEffect` siempre en 'copy', y cuando no
              // calza con el `effectAllowed` del origen el navegador muestra el cursor "prohibido"
              // y CANCELA el drop sin disparar `onDrop`: el estado nunca cambiaba, así que la
              // imagen se quedaba exactamente donde estaba (no es que "volviera", nunca se movió).
              e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
            }}
            onDrop={e => soltarEnPagina(e, i)}
          >
            <canvas ref={el => { canvasRefs.current[i] = el; }} className="absolute inset-0 pointer-events-none" />
            {estampas.filter(es => es.pagina === i).map(es => (
              <EstampaColocadaUI
                key={es.id} estampa={es} url={urlDe(es.tipo) || ''}
                onQuitar={() => quitarEstampa(es.id)}
                onRedimensionar={delta => redimensionarEstampa(es.id, delta)}
              />
            ))}
            <span className="absolute -top-5 left-0 text-[10.5px] text-slate-500">Página {i + 1}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
        <p className="text-[11px] text-slate-400">
          {estampas.length === 0 ? 'Sin firma ni timbre colocados — el PDF sale igual, en blanco ahí.' : `${estampas.length} imagen(es) colocada(s)`}
        </p>
        <button
          type="button"
          onClick={() => onConfirmar(estampas.map(({ id, ...resto }) => resto))}
          disabled={generando || cargando || !!error}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-4 py-2 rounded-lg transition-colors"
        >
          {generando
            ? <><Loader2 size={13} className="animate-spin" /> Generando…</>
            : <><FileSignature size={13} /> Generar documento firmado</>}
        </button>
      </div>
    </div>
  );
}
