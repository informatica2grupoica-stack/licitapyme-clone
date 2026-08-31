'use client';

// Paso de firma libre sobre PDF — pedido explícito del usuario (29-ago-2026): "poder seleccionar
// la firma o el logo con un clic... moverla por todo el documento para acomodarla donde quiero,
// así como lo hace ecert Chile". Un .docx es texto que fluye, sin coordenadas de píxel; un PDF sí
// tiene página fija, así que ESTE es el único componente del sistema donde una imagen se ubica por
// posición absoluta en vez de anclarse a un párrafo. El PDF que recibe ya viene con el texto del
// anexo puesto (ver /api/anexos/vista-previa-pdf) — acá solo se posicionan firma/timbre; al
// confirmar, /api/anexos/generar-firmado quema cada una en su lugar exacto sobre ESE PDF.
//
// Posiciones en PORCENTAJE de la página (xPct/yPct/anchoPct), nunca en píxeles — invariante al
// zoom con el que el usuario ve el PDF en su pantalla.
//
// BUG REAL (29-ago-2026, reportado dos veces: "algo lo bloquea", "en el Word no lo deja"): la
// primera versión usaba drag-and-drop NATIVO de HTML5 (`draggable` + eventos `dragstart`/
// `dragover`/`drop`). Ya se había encontrado y arreglado un choque `effectAllowed`/`dropEffect`
// que cancelaba el drop en silencio — y el usuario seguía topándose con casos donde "no deja".
// HTML5 DnD tiene fama merecida de frágil para justo este uso (posicionar libre sobre un canvas):
// el navegador decide unilateralmente cuándo permite el drop, con reglas de compatibilidad de
// efectos poco documentadas y comportamiento distinto entre navegadores. Herramientas serias de
// este tipo de interacción (Figma, Miro, Trello, y los propios firmadores tipo ecert) NO usan
// HTML5 DnD para esto — usan eventos de PUNTERO (pointerdown/pointermove/pointerup) con
// seguimiento manual, que da control total y no depende de que el navegador "autorice" nada.
// Reescrito completo sobre ese patrón: nunca más un drop "prohibido".
import { useEffect, useRef, useState } from 'react';
import { Loader2, X, Plus, Minus, ArrowLeft, FileSignature } from 'lucide-react';

export interface EstampaColocada { tipo: 'firma' | 'timbre'; pagina: number; xPct: number; yPct: number; anchoPct: number }
interface EstampaUI extends EstampaColocada { id: string }

const ANCHO_DEFECTO: Record<'firma' | 'timbre', number> = { firma: 0.22, timbre: 0.14 };
const PASO_TAMANO = 0.02;
const ESCALA_RENDER = 1.4; // fija: no depende del zoom del navegador, solo de qué tan nítido se ve

const clamp01 = (v: number, max = 1) => Math.min(Math.max(v, 0), max);

interface ArrastreActivo {
  tipo: 'firma' | 'timbre';
  /** null = viene de la miniatura (crea una nueva); string = moviendo una ya colocada. */
  idExistente: string | null;
  anchoPct: number;
  /** Punto donde se agarró la imagen, relativo a su esquina superior izquierda, en px de
   *  pantalla — sin esto la imagen "saltaría" a poner su esquina bajo el cursor apenas se suelta
   *  el botón, en vez de seguir agarrada del mismo punto que tocó el usuario. */
  offsetXPx: number;
  offsetYPx: number;
  /** Posición actual del puntero (viewport) — se actualiza en cada pointermove. */
  clientX: number;
  clientY: number;
}

function Miniatura({
  tipo, url, onIniciarArrastre,
}: {
  tipo: 'firma' | 'timbre'; url: string;
  onIniciarArrastre: (e: React.PointerEvent, tipo: 'firma' | 'timbre', anchoPct: number) => void;
}) {
  return (
    <figure
      className="text-center cursor-grab active:cursor-grabbing select-none touch-none"
      onPointerDown={e => onIniciarArrastre(e, tipo, ANCHO_DEFECTO[tipo])}
      title={`Arrastra ${tipo === 'firma' ? 'la firma' : 'el timbre'} a cualquier punto del documento`}
    >
      <img src={url} alt={tipo} className="h-10 max-w-[110px] object-contain pointer-events-none border border-slate-200 rounded bg-white p-1" draggable={false} />
      <figcaption className="text-[10px] text-slate-400 mt-0.5">{tipo}</figcaption>
    </figure>
  );
}

/** Una imagen ya colocada sobre la página — se puede volver a agarrar (a otra posición o a otra
 *  página), agrandar/achicar, o quitar. Se oculta mientras SE ESTÁ arrastrando (el preview
 *  flotante la reemplaza visualmente) para no ver dos copias a la vez. */
function EstampaColocadaUI({
  estampa, url, oculta, onIniciarArrastre, onQuitar, onRedimensionar,
}: {
  estampa: EstampaUI; url: string; oculta: boolean;
  onIniciarArrastre: (e: React.PointerEvent, id: string, tipo: 'firma' | 'timbre', anchoPct: number) => void;
  onQuitar: () => void; onRedimensionar: (delta: number) => void;
}) {
  return (
    <div
      className="group absolute cursor-move touch-none"
      style={{
        left: `${estampa.xPct * 100}%`, top: `${estampa.yPct * 100}%`, width: `${estampa.anchoPct * 100}%`,
        visibility: oculta ? 'hidden' : 'visible',
      }}
      onPointerDown={e => onIniciarArrastre(e, estampa.id, estampa.tipo, estampa.anchoPct)}
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
  const [arrastre, setArrastre] = useState<ArrastreActivo | null>(null);
  const [paginaSobre, setPaginaSobre] = useState<number | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const paginaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const idCounter = useRef(0);
  // Copia en ref del estado de arrastre — los listeners de window se agregan UNA vez (no en cada
  // pointermove) y necesitan leer el valor MÁS RECIENTE sin volver a suscribirse todo el tiempo.
  const arrastreRef = useRef<ArrastreActivo | null>(null);

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
        paginaRefs.current = new Array(pdf.numPages).fill(null);
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

  // ── Arrastre manual por eventos de puntero — ver el comentario largo arriba del archivo ──────
  const iniciarArrastre = (e: React.PointerEvent, tipo: 'firma' | 'timbre', anchoPct: number, idExistente: string | null) => {
    e.preventDefault();
    const rectImagen = e.currentTarget.getBoundingClientRect();
    const nuevo: ArrastreActivo = {
      tipo, idExistente, anchoPct,
      offsetXPx: e.clientX - rectImagen.left,
      offsetYPx: e.clientY - rectImagen.top,
      clientX: e.clientX, clientY: e.clientY,
    };
    arrastreRef.current = nuevo;
    setArrastre(nuevo);
  };

  const encontrarPaginaBajoElCursor = (clientX: number, clientY: number): number | null => {
    // Una página puede medir >1000px y el contenedor scrolleable solo muestra una ventana de eso
    // — su getBoundingClientRect() sigue devolviendo el rectángulo COMPLETO aunque la mayor parte
    // esté tapada arriba/abajo por el scroll (overflow-y solo recorta lo que se VE, no la
    // geometría). Sin este chequeo, un punto sobre la barra de herramientas (fija, fuera del
    // contenedor) podía caer igual "dentro" de una página que estuviera muy scrolleada, y
    // registrar un drop invisible ahí en vez de no hacer nada.
    const cont = contenedorRef.current;
    if (cont) {
      const rc = cont.getBoundingClientRect();
      if (clientX < rc.left || clientX > rc.right || clientY < rc.top || clientY > rc.bottom) return null;
    }
    for (let i = 0; i < paginaRefs.current.length; i++) {
      const el = paginaRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return i;
    }
    return null;
  };

  const MARGEN_AUTOSCROLL = 70;
  useEffect(() => {
    if (!arrastre) return;

    const alMover = (e: PointerEvent) => {
      const actual = arrastreRef.current;
      if (!actual) return;
      const actualizado = { ...actual, clientX: e.clientX, clientY: e.clientY };
      arrastreRef.current = actualizado;
      setArrastre(actualizado);
      setPaginaSobre(encontrarPaginaBajoElCursor(e.clientX, e.clientY));

      // Auto-scroll cerca de los bordes del contenedor — un anexo de varias páginas queda más
      // alto que la pantalla, y sin esto no habría forma de soltar en una página más abajo sin
      // soltar el botón a mitad de camino.
      const cont = contenedorRef.current;
      if (cont) {
        const r = cont.getBoundingClientRect();
        const distanciaArriba = e.clientY - r.top;
        const distanciaAbajo = r.bottom - e.clientY;
        if (distanciaArriba < MARGEN_AUTOSCROLL) cont.scrollTop -= (MARGEN_AUTOSCROLL - distanciaArriba) * 0.4;
        else if (distanciaAbajo < MARGEN_AUTOSCROLL) cont.scrollTop += (MARGEN_AUTOSCROLL - distanciaAbajo) * 0.4;
      }
    };

    const alSoltar = (e: PointerEvent) => {
      const actual = arrastreRef.current;
      arrastreRef.current = null;
      setArrastre(null);
      setPaginaSobre(null);
      if (!actual) return;

      const pagina = encontrarPaginaBajoElCursor(e.clientX, e.clientY);
      if (pagina == null) return; // soltado fuera de cualquier página (el margen gris): no se coloca nada, sin error
      const rectPagina = paginaRefs.current[pagina]!.getBoundingClientRect();
      // La esquina superior-izquierda de la IMAGEN es el punto de referencia (xPct/yPct), no el
      // cursor — por eso se resta el offset con el que se agarró, igual que cualquier editor
      // visual: la imagen no "salta" a centrarse en el cursor al soltar.
      const xPx = e.clientX - actual.offsetXPx - rectPagina.left;
      const yPx = e.clientY - actual.offsetYPx - rectPagina.top;
      const xPct = clamp01(xPx / rectPagina.width, 0.96);
      const yPct = clamp01(yPx / rectPagina.height, 0.97);

      if (actual.idExistente) {
        setEstampas(prev => prev.map(es => (es.id === actual.idExistente ? { ...es, pagina, xPct, yPct } : es)));
      } else {
        setEstampas(prev => [...prev, { id: `e${idCounter.current++}`, tipo: actual.tipo, pagina, xPct, yPct, anchoPct: actual.anchoPct }]);
      }
    };

    window.addEventListener('pointermove', alMover);
    window.addEventListener('pointerup', alSoltar);
    window.addEventListener('pointercancel', alSoltar);
    return () => {
      window.removeEventListener('pointermove', alMover);
      window.removeEventListener('pointerup', alSoltar);
      window.removeEventListener('pointercancel', alSoltar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arrastreRef lleva el valor vivo; re-suscribir solo al iniciar/terminar un arrastre evita listeners duplicados en cada pointermove.
  }, [!!arrastre]);

  const quitarEstampa = (id: string) => setEstampas(prev => prev.filter(es => es.id !== id));
  const redimensionarEstampa = (id: string, delta: number) => setEstampas(prev => prev.map(es => (
    es.id === id ? { ...es, anchoPct: Math.min(0.6, Math.max(0.06, es.anchoPct + delta)) } : es
  )));

  const urlDe = (tipo: 'firma' | 'timbre') => (tipo === 'firma' ? firmaUrl : timbreUrl);
  const hayImagenes = !!firmaUrl || !!timbreUrl;

  // Tamaño del preview flotante: se usa el ancho de la página bajo el cursor si hay una, si no el
  // de la primera página del documento (todas suelen compartir el mismo tamaño) — nunca depende
  // de dónde se originó el arrastre, así que se ve consistente entre miniatura y estampa movida.
  const anchoPreviewPx = arrastre
    ? (dimensiones[paginaSobre ?? 0]?.ancho ?? dimensiones[0]?.ancho ?? 200) * arrastre.anchoPct
    : 0;

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
              {firmaUrl && <Miniatura tipo="firma" url={firmaUrl} onIniciarArrastre={(e, tipo, ancho) => iniciarArrastre(e, tipo, ancho, null)} />}
              {timbreUrl && <Miniatura tipo="timbre" url={timbreUrl} onIniciarArrastre={(e, tipo, ancho) => iniciarArrastre(e, tipo, ancho, null)} />}
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

      <div ref={contenedorRef} className="flex-1 overflow-y-auto bg-slate-200 px-4 py-6 flex flex-col items-center gap-6">
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
            ref={el => { paginaRefs.current[i] = el; }}
            className={`relative flex-shrink-0 bg-white shadow-md transition-shadow ${arrastre && paginaSobre === i ? 'ring-2 ring-indigo-500' : ''}`}
            style={{ width: dim.ancho, height: dim.alto }}
          >
            <canvas ref={el => { canvasRefs.current[i] = el; }} className="absolute inset-0 pointer-events-none" />
            {estampas.filter(es => es.pagina === i).map(es => (
              <EstampaColocadaUI
                key={es.id} estampa={es} url={urlDe(es.tipo) || ''}
                oculta={arrastre?.idExistente === es.id}
                onIniciarArrastre={(e, id, tipo, ancho) => iniciarArrastre(e, tipo, ancho, id)}
                onQuitar={() => quitarEstampa(es.id)}
                onRedimensionar={delta => redimensionarEstampa(es.id, delta)}
              />
            ))}
            <span className="absolute -top-5 left-0 text-[10.5px] text-slate-500">Página {i + 1}</span>
          </div>
        ))}
      </div>

      {/* Preview flotante durante el arrastre — sigue al cursor en TODO momento, incluso fuera de
          cualquier página (soltar ahí simplemente no coloca nada, no hace falta bloquear el gesto). */}
      {arrastre && (
        <img
          src={urlDe(arrastre.tipo) || ''}
          alt=""
          className="fixed z-[200] pointer-events-none opacity-90 drop-shadow-lg"
          style={{
            left: arrastre.clientX - arrastre.offsetXPx,
            top: arrastre.clientY - arrastre.offsetYPx,
            width: anchoPreviewPx,
          }}
        />
      )}

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
