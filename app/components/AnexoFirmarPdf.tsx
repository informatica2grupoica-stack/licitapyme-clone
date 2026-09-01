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

export interface EstampaColocada {
  tipo: 'firma' | 'timbre';
  /** CUÁL de las firmas de la empresa es esta (migration-84: titular, suplente, apoderado…).
   *  Solo para `tipo: 'firma'`; sin él se estampa la principal, que es como funcionaba cuando
   *  había una sola. */
  firmaId?: number;
  pagina: number; xPct: number; yPct: number; anchoPct: number;
}
interface EstampaUI extends EstampaColocada { id: string }

/** Una firma escaneada de la ficha de la empresa — llega desde /api/anexos/analizar. */
export interface FirmaDisponibleUI { id: number; etiqueta: string; url: string; esPrincipal: boolean }

const ANCHO_DEFECTO: Record<'firma' | 'timbre', number> = { firma: 0.22, timbre: 0.14 };
// Un click del botón mueve el ancho 4 puntos de página (~33px en una carta a la escala de
// pantalla). Empezó en 2 y era demasiado sutil: sobre una firma escaneada, con su fondo blanco
// alrededor, un click se veía igual que ningún click — el control parecía roto aunque funcionara.
const PASO_TAMANO = 0.04;
const ANCHO_MIN = 0.06;
const ANCHO_MAX = 0.6;

/** Ancho permitido para una estampa, en % del ancho de la página. Además del mínimo/máximo fijos,
 *  se topea contra el borde DERECHO de la hoja (`1 - xPct`): la esquina superior izquierda es el
 *  ancla, así que agrandar crece hacia la derecha y sin este tope la imagen se saldría de la
 *  página — pdf-lib la estamparía igual, recortada, y recién se vería en el PDF descargado. */
const anchoValido = (xPct: number, ancho: number) => {
  const tope = Math.max(ANCHO_MIN, Math.min(ANCHO_MAX, 1 - xPct));
  return Math.min(tope, Math.max(ANCHO_MIN, ancho));
};
const ESCALA_RENDER = 1.4; // fija: no depende del zoom del navegador, solo de qué tan nítido se ve

const clamp01 = (v: number, max = 1) => Math.min(Math.max(v, 0), max);

interface ArrastreActivo {
  tipo: 'firma' | 'timbre';
  /** Cuál firma se está arrastrando (undefined = timbre, o la firma principal). */
  firmaId?: number;
  /** La imagen que se está arrastrando, resuelta al empezar el gesto: con varias firmas ya no
   *  alcanza con el `tipo` para saber cuál dibujar en el preview flotante. */
  url: string;
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

/** Las cuatro esquinas de la estampa, cada una un manijón. El nombre es la esquina que se
 *  AGARRA; la que queda quieta es siempre la opuesta, igual que en cualquier editor visual. */
type Esquina = 'nw' | 'ne' | 'sw' | 'se';

/** Redimensionado en curso: se arrastra un manijón de esquina y la estampa escala PAREJA — el
 *  alto sale del ancho por la proporción real de la imagen, así que nunca se achata ni se estira
 *  (es la misma cuenta que hace `estamparPdf` al quemarla en el PDF, ver anexos-pdf-firma.ts:
 *  `escala = anchoDibujo / imagen.width`).
 *  Mismo patrón de eventos de puntero que el arrastre (ver el comentario de arriba del archivo):
 *  el gesto vive en `window`, no en el elemento, así que no se corta si el cursor se sale de la
 *  estampa mientras se agranda. */
interface RedimensionActiva {
  id: string;
  esquina: Esquina;
  /** Medidas que tenía la estampa al empezar el gesto — el delta del puntero se aplica sobre
   *  ESTOS valores, no sobre los actuales: acumular incrementos frame a frame arrastra el error
   *  y hace que la imagen "se escape" del cursor. */
  anchoInicial: number;
  altoInicial: number;
  xInicial: number;
  yInicial: number;
  clientXInicial: number;
  /** Tamaño en píxeles de la página donde vive la estampa — convierte el desplazamiento del
   *  puntero (px) a los % de página con los que se guarda todo. */
  anchoPaginaPx: number;
  altoPaginaPx: number;
}

/** Hacia dónde crece la estampa al alejar el manijón del centro, por esquina: la esquina que
 *  queda FIJA es la opuesta a la que se agarra. */
const CRECE_A_LA_DERECHA: Record<Esquina, boolean> = { se: true, ne: true, sw: false, nw: false };
const ANCLA_ARRIBA: Record<Esquina, boolean> = { se: true, sw: true, ne: false, nw: false };
const CURSOR_ESQUINA: Record<Esquina, string> = {
  nw: 'cursor-nwse-resize', se: 'cursor-nwse-resize', ne: 'cursor-nesw-resize', sw: 'cursor-nesw-resize',
};
const POSICION_ESQUINA: Record<Esquina, string> = {
  nw: '-top-1.5 -left-1.5', ne: '-top-1.5 -right-1.5', sw: '-bottom-1.5 -left-1.5', se: '-bottom-1.5 -right-1.5',
};

// Una miniatura por imagen arrastrable: el timbre, y UNA POR CADA firma de la empresa
// (migration-84). La etiqueta debajo es de quién es la firma — con dos firmas escaneadas del
// mismo trazo, el rótulo es lo único que distingue al titular del suplente.
function Miniatura({
  tipo, url, etiqueta, principal, onIniciarArrastre,
}: {
  tipo: 'firma' | 'timbre'; url: string; etiqueta: string; principal?: boolean;
  onIniciarArrastre: (e: React.PointerEvent) => void;
}) {
  return (
    <figure
      className="text-center cursor-grab active:cursor-grabbing select-none touch-none"
      onPointerDown={onIniciarArrastre}
      title={`Arrastra "${etiqueta}" a cualquier punto del documento`}
    >
      <img src={url} alt={etiqueta} className="h-10 max-w-[110px] object-contain pointer-events-none border border-slate-200 rounded bg-white p-1" draggable={false} />
      <figcaption className="text-[10px] text-slate-400 mt-0.5 max-w-[110px] truncate" title={etiqueta}>
        {principal ? '★ ' : ''}{etiqueta}
      </figcaption>
    </figure>
  );
}

/** Una imagen ya colocada sobre la página — se puede volver a agarrar (a otra posición o a otra
 *  página), agrandar/achicar, o quitar. Se oculta mientras SE ESTÁ arrastrando (el preview
 *  flotante la reemplaza visualmente) para no ver dos copias a la vez. */
function EstampaColocadaUI({
  estampa, url, oculta, redimensionando, onIniciarArrastre, onIniciarRedimension, onQuitar, onRedimensionar,
}: {
  estampa: EstampaUI; url: string; oculta: boolean; redimensionando: boolean;
  onIniciarArrastre: (e: React.PointerEvent, id: string, tipo: 'firma' | 'timbre', anchoPct: number) => void;
  onIniciarRedimension: (e: React.PointerEvent, esquina: Esquina, caja: DOMRect) => void;
  onQuitar: () => void; onRedimensionar: (delta: number) => void;
}) {
  // BUG REAL (31-ago-2026, 2495-17-B226 — "lo que me falta es poder agrandar o achicar la firma"):
  // los botones +/- YA existían acá, pero no hacían absolutamente nada. Son hijos del <div> que
  // lleva el `onPointerDown` de arrastrar, así que su pointerdown BURBUJEABA hasta el padre, que
  // llama `e.preventDefault()` — y un preventDefault en pointerdown le dice al navegador que no
  // emita los eventos de mouse compatibles, `click` incluido. El `onClick` del botón nunca
  // disparaba; lo único que pasaba era que empezaba un arrastre. Cortar la propagación en el
  // propio control es el arreglo: vale para los dos botones Y para el manijón nuevo.
  const soloEsteControl = (e: React.PointerEvent) => e.stopPropagation();
  // La caja de la estampa se mide en el momento de agarrar el manijón: de ahí sale el ALTO real
  // en pantalla (el `h-auto` de la imagen lo decide el navegador según la proporción del archivo,
  // el estado solo guarda el ancho), que es lo que permite mover el ancla cuando se agarra una
  // esquina de arriba o de la izquierda.
  const cajaRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={cajaRef}
      className="group absolute cursor-move touch-none"
      style={{
        left: `${estampa.xPct * 100}%`, top: `${estampa.yPct * 100}%`, width: `${estampa.anchoPct * 100}%`,
        visibility: oculta ? 'hidden' : 'visible',
      }}
      onPointerDown={e => onIniciarArrastre(e, estampa.id, estampa.tipo, estampa.anchoPct)}
    >
      <img
        src={url} alt={estampa.tipo} draggable={false}
        className={`w-full h-auto object-contain pointer-events-none drop-shadow ${redimensionando ? 'outline outline-1 outline-indigo-500' : ''}`}
      />
      {/* Manijones en las CUATRO esquinas — SIEMPRE visibles, a diferencia de los botones (que
          aparecen al pasar el mouse por encima). Es el gesto que espera cualquiera que haya usado
          un firmador o un editor visual, y además es la única pista en pantalla de que la estampa
          se puede redimensionar: con los controles escondidos tras el hover, no había forma de
          descubrirlo. Cuatro y no uno porque la esquina útil depende de dónde quedó la firma —
          pegada al margen derecho, tirar hacia la derecha no tiene lugar adonde ir; ahí se agarra
          una esquina izquierda y crece hacia el otro lado.
          `touch-none` para que en un trackpad o pantalla táctil el navegador no se quede el gesto
          como scroll. */}
      {(['nw', 'ne', 'sw', 'se'] as Esquina[]).map(esquina => (
        <div
          key={esquina}
          onPointerDown={e => { if (cajaRef.current) onIniciarRedimension(e, esquina, cajaRef.current.getBoundingClientRect()); }}
          title="Arrastra para agrandar o achicar"
          className={`absolute ${POSICION_ESQUINA[esquina]} ${CURSOR_ESQUINA[esquina]} w-3.5 h-3.5 rounded-[3px] bg-white border-2 border-indigo-600 shadow touch-none`}
        />
      ))}
      {/* Los tres botones van JUNTOS arriba y a la IZQUIERDA, separados de las esquinas.
          Tres cosas medidas en el navegador (31-ago-2026), cada una dejaba un control muerto:
           · Anclados a la DERECHA (`-right-2.5`), el botón se corría solo: al agrandar, el borde
             derecho avanza y el botón se va de abajo del cursor — el primer click funcionaba y
             los siguientes caían al vacío, que se siente exactamente como "no hace nada". El
             ancla del redimensionado por botón es la esquina superior IZQUIERDA, así que ahí los
             botones quedan quietos y se puede clickear varias veces seguidas.
           · Antes estaban en `-bottom-2.5 right-0` y se superponían con el manijón de esquina:
             `elementFromPoint` sobre el manijón devolvía el botón "Achicar" y el gesto de
             redimensionar nunca empezaba. `-top-7` los sube por encima de los cuatro manijones.
           · `opacity-0` los hace invisibles pero SIGUEN capturando el puntero, y ahí tapaban un
             pedazo de la imagen para arrastrarla — de ahí el `pointer-events-none`. */}
      <div className="absolute -top-7 left-0 flex gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
        <button
          type="button" onClick={() => onRedimensionar(-PASO_TAMANO)} onPointerDown={soloEsteControl} title="Achicar"
          className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-800 text-white shadow"
        >
          <Minus size={11} />
        </button>
        <button
          type="button" onClick={() => onRedimensionar(PASO_TAMANO)} onPointerDown={soloEsteControl} title="Agrandar"
          className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-800 text-white shadow"
        >
          <Plus size={11} />
        </button>
        <button
          type="button" onClick={onQuitar} onPointerDown={soloEsteControl} title="Quitar"
          className="flex items-center justify-center w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

export function AnexoFirmarPdf({
  pdfBytes, firmaUrl, timbreUrl, firmas, generando, onConfirmar, onVolver,
}: {
  pdfBytes: ArrayBuffer;
  /** La firma PRINCIPAL de la empresa (espejo de `empresas.firma_url`) — sigue siendo el fallback
   *  cuando `firmas` viene vacío (migración 84 sin aplicar, o ficha vieja). */
  firmaUrl: string | null;
  timbreUrl: string | null;
  /** Todas las firmas de la empresa; una miniatura arrastrable por cada una. */
  firmas?: FirmaDisponibleUI[];
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
  const [redimension, setRedimension] = useState<RedimensionActiva | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const paginaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const idCounter = useRef(0);
  // Las firmas arrastrables: las de la ficha (migration-84) o, si esa lista viene vacía, la única
  // firma principal de siempre — así una base sin la migración aplicada se sigue comportando
  // exactamente como antes en vez de quedarse sin nada que arrastrar. El id 0 del fallback nunca
  // viaja al backend (ver `idFirmaDe`): significa "la principal", que es justo el default.
  const firmasDisponibles: FirmaDisponibleUI[] = firmas && firmas.length
    ? firmas
    : (firmaUrl ? [{ id: 0, etiqueta: 'Firma', url: firmaUrl, esPrincipal: true }] : []);
  const idFirmaDe = (f: FirmaDisponibleUI) => (f.id > 0 ? f.id : undefined);
  const urlDeFirma = (firmaId?: number) =>
    (firmaId != null ? firmasDisponibles.find(f => f.id === firmaId)?.url : undefined)
      ?? firmasDisponibles.find(f => f.esPrincipal)?.url
      ?? firmaUrl
      ?? '';
  const urlDe = (estampa: { tipo: 'firma' | 'timbre'; firmaId?: number }) =>
    (estampa.tipo === 'timbre' ? timbreUrl : urlDeFirma(estampa.firmaId));

  // Copia en ref del estado de arrastre — los listeners de window se agregan UNA vez (no en cada
  // pointermove) y necesitan leer el valor MÁS RECIENTE sin volver a suscribirse todo el tiempo.
  const arrastreRef = useRef<ArrastreActivo | null>(null);
  const redimensionRef = useRef<RedimensionActiva | null>(null);

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
  const iniciarArrastre = (
    e: React.PointerEvent, tipo: 'firma' | 'timbre', anchoPct: number, idExistente: string | null,
    firmaId?: number, url?: string,
  ) => {
    e.preventDefault();
    const rectImagen = e.currentTarget.getBoundingClientRect();
    const nuevo: ArrastreActivo = {
      tipo, idExistente, anchoPct, firmaId,
      url: url ?? (tipo === 'timbre' ? (timbreUrl || '') : (urlDeFirma(firmaId) || '')),
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
    es.id === id ? { ...es, anchoPct: anchoValido(es.xPct, es.anchoPct + delta) } : es
  )));

  // Los listeners del gesto se enganchan ACÁ, dentro del propio pointerdown — NO en un
  // useEffect que reaccione a `redimension`. BUG REAL medido en el navegador (31-ago-2026): con
  // el useEffect, un gesto rápido llegaba a `pointerup` ANTES de que React alcanzara a renderizar
  // y correr el efecto que suscribe los listeners; el gesto entero se perdía y el manijón se
  // sentía muerto. `setEstampas` y `redimensionRef` son estables, así que no hace falta esperar a
  // ningún render: el estado `redimension` queda solo para pintar el borde de la estampa activa.
  const iniciarRedimension = (e: React.PointerEvent, id: string, esquina: Esquina, caja: DOMRect, pagina: number) => {
    e.preventDefault();
    e.stopPropagation(); // no debe empezar TAMBIÉN un arrastre de la estampa (el padre escucha pointerdown)
    const rectPagina = paginaRefs.current[pagina]?.getBoundingClientRect();
    if (!rectPagina?.width || !rectPagina.height) return;

    const actual: RedimensionActiva = {
      id, esquina,
      anchoInicial: caja.width / rectPagina.width,
      altoInicial: caja.height / rectPagina.height,
      xInicial: (caja.left - rectPagina.left) / rectPagina.width,
      yInicial: (caja.top - rectPagina.top) / rectPagina.height,
      clientXInicial: e.clientX,
      anchoPaginaPx: rectPagina.width,
      altoPaginaPx: rectPagina.height,
    };
    redimensionRef.current = actual;
    setRedimension(actual);

    // Escala PAREJA: el gesto solo lee el eje horizontal y el alto se deriva por la misma razón
    // (`factor`), así que la firma nunca se achata ni se estira — es la misma cuenta que hace
    // pdf-lib al quemarla. Leer un solo eje (y no la diagonal) es a propósito: con los dos, un
    // gesto en diagonal manda señales que se pelean entre sí y la imagen tiembla.
    //
    // La esquina OPUESTA a la que se agarra queda fija. Para las de la derecha/abajo eso es
    // gratis (el ancla ya es la esquina superior izquierda, que es lo que guarda xPct/yPct); para
    // las de la izquierda/arriba hay que correr xPct/yPct lo mismo que creció o se achicó, si no
    // la estampa "se escapa" hacia el otro lado mientras se la redimensiona.
    const aplicar = (clientX: number) => {
      const dx = (clientX - actual.clientXInicial) / actual.anchoPaginaPx;
      const crecimiento = CRECE_A_LA_DERECHA[actual.esquina] ? dx : -dx;

      // Tope: además del mínimo/máximo fijos, la estampa no puede salirse de la hoja. El borde
      // que la frena es el del lado hacia el que está creciendo.
      const espacio = CRECE_A_LA_DERECHA[actual.esquina]
        ? 1 - actual.xInicial                        // ancla a la izquierda: crece hacia el margen derecho
        : actual.xInicial + actual.anchoInicial;     // ancla a la derecha: crece hacia el margen izquierdo
      const ancho = Math.min(
        Math.max(actual.anchoInicial + crecimiento, ANCHO_MIN),
        Math.max(ANCHO_MIN, Math.min(ANCHO_MAX, espacio)),
      );

      const factor = ancho / actual.anchoInicial;
      const alto = actual.altoInicial * factor;
      const xPct = CRECE_A_LA_DERECHA[actual.esquina]
        ? actual.xInicial
        : clamp01(actual.xInicial + (actual.anchoInicial - ancho));
      const yPct = ANCLA_ARRIBA[actual.esquina]
        ? actual.yInicial
        : clamp01(actual.yInicial + (actual.altoInicial - alto));

      setEstampas(prev => prev.map(es => (es.id === actual.id ? { ...es, anchoPct: ancho, xPct, yPct } : es)));
    };

    const alMover = (ev: PointerEvent) => aplicar(ev.clientX);
    // El ancho se aplica TAMBIÉN al soltar, con la posición final: un gesto lo bastante rápido
    // puede llegar a `pointerup` sin un solo `pointermove` en el medio. Es la misma garantía que
    // ya tenía el arrastre de posición, que siempre se resolvió en el pointerup.
    const alSoltar = (ev: PointerEvent) => {
      aplicar(ev.clientX);
      redimensionRef.current = null;
      setRedimension(null);
      window.removeEventListener('pointermove', alMover);
      window.removeEventListener('pointerup', alSoltar);
      window.removeEventListener('pointercancel', alSoltar);
    };

    window.addEventListener('pointermove', alMover);
    window.addEventListener('pointerup', alSoltar);
    window.addEventListener('pointercancel', alSoltar);
  };

  const hayImagenes = firmasDisponibles.length > 0 || !!timbreUrl;

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
            <div className="flex items-center gap-3 flex-wrap max-w-[45%] overflow-x-auto">
              {firmasDisponibles.map(f => (
                <Miniatura
                  key={f.id} tipo="firma" url={f.url} etiqueta={f.etiqueta} principal={f.esPrincipal && firmasDisponibles.length > 1}
                  onIniciarArrastre={e => iniciarArrastre(e, 'firma', ANCHO_DEFECTO.firma, null, idFirmaDe(f), f.url)}
                />
              ))}
              {timbreUrl && (
                <Miniatura
                  tipo="timbre" url={timbreUrl} etiqueta="timbre"
                  onIniciarArrastre={e => iniciarArrastre(e, 'timbre', ANCHO_DEFECTO.timbre, null, undefined, timbreUrl)}
                />
              )}
            </div>
            <p className="text-[11.5px] text-slate-500 leading-snug flex-1">
              {firmasDisponibles.length > 1 ? 'Elige cuál firma va en cada lugar y arrástrala' : 'Arrastra la firma y/o el timbre'} a cualquier punto del documento. Ya colocada: arrástrala para moverla, o tira de <strong>cualquiera de sus cuatro esquinas</strong> para agrandarla y achicarla —siempre pareja, sin deformarse—. Pasa el mouse por encima para los botones de tamaño y de quitar.
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
                key={es.id} estampa={es} url={urlDe(es) || ''}
                oculta={arrastre?.idExistente === es.id}
                redimensionando={redimension?.id === es.id}
                onIniciarArrastre={(e, id, tipo, ancho) => iniciarArrastre(e, tipo, ancho, id, es.firmaId)}
                onIniciarRedimension={(e, esquina, caja) => iniciarRedimension(e, es.id, esquina, caja, i)}
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
          src={arrastre.url}
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
