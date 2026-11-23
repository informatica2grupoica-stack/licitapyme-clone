'use client';
// app/negocios/[id]/EditorPlantillaDocumento.tsx
// EDITOR DE PLANTILLAS de Gestionar documentos: una hoja A4 donde se arrastran y redimensionan textos, logos (del banco), tablas, líneas,
// recuadros y la firma. El fondo es la MISMA hoja que sale en el PDF (armarHtml); encima van cajas invisibles que se mueven. Se guarda como
// JSON (posiciones en mm) y de él salen solos los campos del formulario: cada {{palabra}} del texto, cada logo y cada tabla.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import {
  armarHtml, derivarCampos, VARIABLES_FIJAS, HOJA_MM,
  type ContextoDocumento, type ElementoLayout, type LayoutDoc, type Plantilla, type TipoElemento,
} from '@/app/lib/compras-documentos-render';
import {
  IconLoader2 as Loader2, IconX as X, IconTypography as Texto, IconPhoto as Logo, IconTable as Tabla, IconMinus as Linea, IconSquare as Caja,
  IconSignature as Firma, IconArrowBackUp as Deshacer, IconArrowForwardUp as Rehacer, IconCopy as Copiar, IconTrash as Borrar, IconDeviceFloppy as Guardar,
  IconEye as Ojo, IconPencil as Lapiz, IconBold as Negrita, IconItalic as Cursiva, IconUnderline as Subrayado, IconAlignLeft as AlIzq, IconAlignCenter as AlCentro,
  IconAlignRight as AlDer, IconLayoutAlignCenter as CentrarH, IconChevronUp as Subir, IconChevronDown as Bajar,
} from '@tabler/icons-react';

const PX_MM = 794 / HOJA_MM.w; // la hoja se dibuja a 794 x 1123 px (A4 a 96 dpi) y se escala a la pantalla
const entrada = 'w-full text-[12.5px] px-2.5 py-1.5 rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500';
const redondo = (n: number) => Math.round(n * 2) / 2; // se ajusta a medios milímetros
const idNuevo = () => Math.random().toString(36).slice(2, 8);

const NOMBRES: Record<TipoElemento, string> = { texto: 'Texto', logo: 'Logo', linea: 'Línea', caja: 'Recuadro', tabla: 'Tabla', firma: 'Firma y timbre' };

function nuevoElemento(tipo: TipoElemento): ElementoLayout {
  const base = { id: idNuevo(), tipo, x: 25, y: 40 };
  switch (tipo) {
    case 'texto': return { ...base, w: 100, h: 14, texto: 'Escribe aquí. Puedes usar {{variables}}.', tam: 11, alinea: 'left' };
    case 'logo': return { ...base, w: 45, h: 20, logo: 'empresa', etiqueta: 'Logo' };
    case 'linea': return { ...base, w: 160, h: 0, grosor: 0.5, color: '#3a3a3a' };
    case 'caja': return { ...base, w: 80, h: 30, grosor: 0.4, color: '#3a3a3a' };
    case 'tabla': return { ...base, w: 160, h: 50, etiqueta: 'Tabla', columnas: ['Ítem', 'Cantidad', 'Detalle'], filasMin: 5 };
    default: return { ...base, w: 70, h: 40 };
  }
}

/** Punto de partida de una plantilla nueva: encabezado con logo, título, texto y firma. */
function hojaInicial(): LayoutDoc {
  return {
    v: 1, elementos: [
      { id: idNuevo(), tipo: 'logo', x: 15, y: 12, w: 50, h: 22, logo: 'empresa', etiqueta: 'Logo de la izquierda' },
      { id: idNuevo(), tipo: 'texto', x: 120, y: 14, w: 75, h: 14, texto: '{{empresa}}\nRUT {{rut_empresa}}', tam: 10, negrita: true, alinea: 'right' },
      { id: idNuevo(), tipo: 'linea', x: 15, y: 38, w: 180, h: 0, grosor: 0.6, color: '#3a3a3a' },
      { id: idNuevo(), tipo: 'texto', x: 15, y: 52, w: 180, h: 14, texto: 'TÍTULO DEL DOCUMENTO', tam: 22, negrita: true, alinea: 'center' },
      { id: idNuevo(), tipo: 'texto', x: 20, y: 80, w: 170, h: 90, texto: 'Escribe el contenido. Datos de la licitación: {{licitacion_codigo}} — {{organismo}}.', tam: 11, alinea: 'left' },
      { id: idNuevo(), tipo: 'texto', x: 110, y: 235, w: 85, h: 8, texto: '{{ciudad}}, {{fecha_larga}}', tam: 11, alinea: 'right' },
      { id: idNuevo(), tipo: 'firma', x: 70, y: 248, w: 70, h: 36 },
    ],
  };
}

function Num({ etiqueta, v, onC, paso = 0.5 }: { etiqueta: string; v: number; onC: (n: number) => void; paso?: number }) {
  return (
    <label className="block"><span className="block text-[10.5px] text-zinc-500 mb-0.5">{etiqueta}</span>
      <input type="number" step={paso} className={entrada} value={Math.round(v * 100) / 100} onChange={ev => onC(Number(ev.target.value) || 0)} /></label>
  );
}
function Boton({ activo, onClick, titulo, children }: { activo?: boolean; onClick: () => void; titulo: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo} className={`p-1.5 rounded-md border ${activo ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50'}`}>{children}</button>
  );
}

type Manija = { hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string };
const MANIJAS: Manija[] = [
  { hx: -1, hy: -1, cursor: 'nwse-resize' }, { hx: 0, hy: -1, cursor: 'ns-resize' }, { hx: 1, hy: -1, cursor: 'nesw-resize' },
  { hx: -1, hy: 0, cursor: 'ew-resize' }, { hx: 1, hy: 0, cursor: 'ew-resize' },
  { hx: -1, hy: 1, cursor: 'nesw-resize' }, { hx: 0, hy: 1, cursor: 'ns-resize' }, { hx: 1, hy: 1, cursor: 'nwse-resize' },
];

interface Props {
  negocioId: number; ctx: ContextoDocumento; plantilla: Plantilla | null; onCerrar: () => void; onGuardado: () => void;
}

export function EditorPlantillaDocumento({ negocioId, ctx, plantilla, onCerrar, onGuardado }: Props) {
  const toast = useToast();
  const [nombre, setNombre] = useState(plantilla?.nombre || '');
  const [descripcion, setDescripcion] = useState(plantilla?.descripcion || '');
  const [porPersona, setPorPersona] = useState(plantilla?.porPersona ?? false);
  const [elementos, setElementos] = useState<ElementoLayout[]>(() => plantilla?.layout?.elementos || hojaInicial().elementos);
  const [sel, setSel] = useState<string | null>(null);
  const [vistaReal, setVistaReal] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [guiaCentro, setGuiaCentro] = useState(false);
  const [arrastre, setArrastre] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const historia = useRef<ElementoLayout[][]>([]);
  const futuro = useRef<ElementoLayout[][]>([]);
  const caja = useRef<HTMLDivElement>(null);
  const [ajuste, setAjuste] = useState(0.6);
  const refTexto = useRef<HTMLTextAreaElement>(null);
  const [campoNuevo, setCampoNuevo] = useState('');

  useEffect(() => {
    const el = caja.current; if (!el) return;
    const medir = () => setAjuste(Math.max(0.3, Math.min((el.clientWidth - 48) / 794, (el.clientHeight - 48) / 1123)));
    medir(); const ro = new ResizeObserver(medir); ro.observe(el); return () => ro.disconnect();
  }, []);
  const escala = ajuste * zoom;

  /** Cada cambio que se puede deshacer pasa por aquí. */
  const cambiar = useCallback((fn: (l: ElementoLayout[]) => ElementoLayout[], guardarHistoria = true) => {
    setElementos(actual => {
      const nuevo = fn(actual);
      if (guardarHistoria) { historia.current.push(actual); if (historia.current.length > 80) historia.current.shift(); futuro.current = []; }
      return nuevo;
    });
    setSucio(true);
  }, []);
  const deshacer = () => { const h = historia.current.pop(); if (!h) return; futuro.current.push(elementos); setElementos(h); setSucio(true); };
  const rehacer = () => { const f = futuro.current.pop(); if (!f) return; historia.current.push(elementos); setElementos(f); setSucio(true); };
  const actualizar = (id: string, parche: Partial<ElementoLayout>) => cambiar(l => l.map(e => e.id === id ? { ...e, ...parche } : e));
  const elegido = elementos.find(e => e.id === sel) || null;

  const agregar = (tipo: TipoElemento) => { const e = nuevoElemento(tipo); cambiar(l => [...l, e]); setSel(e.id); };
  const duplicar = () => { if (!elegido) return; const c = { ...elegido, id: idNuevo(), x: elegido.x + 5, y: elegido.y + 5 }; cambiar(l => [...l, c]); setSel(c.id); };
  const borrar = () => { if (!elegido) return; cambiar(l => l.filter(e => e.id !== elegido.id)); setSel(null); };
  const orden = (delta: 1 | -1) => { if (!elegido) return; cambiar(l => { const i = l.findIndex(e => e.id === elegido.id), j = i + delta; if (j < 0 || j >= l.length) return l; const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c; }); };

  // Teclado: flechas mueven 1 mm (Mayús = 5), Supr borra, Ctrl+Z / Ctrl+Y deshacen y rehacen, Ctrl+D duplica.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement; if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); deshacer(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); rehacer(); return; }
      if (!elegido) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicar(); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); borrar(); return; }
      const paso = ev.shiftKey ? 5 : 1; const mover: Record<string, [number, number]> = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] };
      const m = mover[ev.key]; if (m) { ev.preventDefault(); actualizar(elegido.id, { x: Math.max(0, elegido.x + m[0]), y: Math.max(0, elegido.y + m[1]) }); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  // ── Arrastrar y redimensionar ───────────────────────────────────────────────────────────────────────────────────────────────────
  const iniciar = (ev: React.PointerEvent, e: ElementoLayout, manija: Manija | null) => {
    ev.stopPropagation(); ev.preventDefault(); setSel(e.id);
    const sx = ev.clientX, sy = ev.clientY, o = { x: e.x, y: e.y, w: e.w, h: e.h };
    const esLinea = e.tipo === 'linea';
    let ultimo = { ...o };
    const mover = (m: PointerEvent) => {
      const dx = (m.clientX - sx) / escala / PX_MM, dy = (m.clientY - sy) / escala / PX_MM;
      let { x, y, w, h } = o;
      if (!manija) { x = redondo(o.x + dx); y = redondo(o.y + dy); }
      else {
        if (manija.hx === 1) w = redondo(o.w + dx); if (manija.hx === -1) { x = redondo(o.x + dx); w = redondo(o.w - dx); }
        if (!esLinea) { if (manija.hy === 1) h = redondo(o.h + dy); if (manija.hy === -1) { y = redondo(o.y + dy); h = redondo(o.h - dy); } }
        if (w < 3) { if (manija.hx === -1) x = o.x + o.w - 3; w = 3; } if (!esLinea && h < 3) { if (manija.hy === -1) y = o.y + o.h - 3; h = 3; }
      }
      x = Math.max(0, Math.min(HOJA_MM.w - Math.min(w, HOJA_MM.w), x)); y = Math.max(0, Math.min(HOJA_MM.h - 1, y));
      // imán al centro de la hoja
      let centrado = false;
      if (!manija && Math.abs(x + w / 2 - HOJA_MM.w / 2) < 1.5) { x = HOJA_MM.w / 2 - w / 2; centrado = true; }
      setGuiaCentro(centrado);
      ultimo = { x, y, w, h }; setArrastre({ id: e.id, ...ultimo });
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar);
      setArrastre(null); setGuiaCentro(false);
      if (ultimo.x !== o.x || ultimo.y !== o.y || ultimo.w !== o.w || ultimo.h !== o.h) cambiar(l => l.map(z => z.id === e.id ? { ...z, ...ultimo } : z));
    };
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar);
  };

  // ── Vista y guardado ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const layout: LayoutDoc = useMemo(() => ({ v: 1, elementos }), [elementos]);
  const html = useMemo(() => {
    const p: Plantilla = { id: 0, clave: 'vista', nombre, descripcion: null, porPersona, campos: derivarCampos(layout), cuerpoHtml: '', layout };
    const valores: Record<string, string> = {};
    return armarHtml(p, valores, ctx, [{ nombre: 'Nombre Apellido', rut: '12.345.678-9' }], !vistaReal);
  }, [layout, nombre, porPersona, ctx, vistaReal]);
  const campos = useMemo(() => derivarCampos(layout), [layout]);

  const guardar = async () => {
    if (!nombre.trim()) { toast.error('Ponle un nombre a la plantilla'); return; }
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/documentos-plantillas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: plantilla?.id, nombre, descripcion, porPersona, layout }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo guardar.');
      toast.success('Plantilla guardada', 'Ya aparece en «Nuevo:» para generar documentos.');
      setSucio(false); onGuardado();
    } catch (e: any) { toast.error('No se pudo guardar la plantilla', e.message); }
    finally { setGuardando(false); }
  };
  const cerrar = () => { if (sucio && !window.confirm('Hay cambios sin guardar. ¿Salir de todos modos?')) return; onCerrar(); };

  const insertarVariable = (k: string) => {
    if (!elegido || elegido.tipo !== 'texto') return;
    const ta = refTexto.current; const txt = elegido.texto || ''; const pos = ta ? ta.selectionStart : txt.length; const fin = ta ? ta.selectionEnd : txt.length;
    actualizar(elegido.id, { texto: txt.slice(0, pos) + `{{${k}}}` + txt.slice(fin) });
  };
  const crearCampo = () => {
    const k = campoNuevo.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!k) return; insertarVariable(k); setCampoNuevo('');
  };

  const caja_ = (e: ElementoLayout) => (arrastre && arrastre.id === e.id ? { ...e, ...arrastre } : e);
  return (
    <div className="fixed inset-0 z-[210] bg-zinc-100 flex flex-col">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-white border-b border-zinc-200">
        <Lapiz size={18} className="text-teal-700" />
        <input className={`${entrada} max-w-[280px] font-semibold`} placeholder="Nombre de la plantilla" value={nombre} onChange={e => { setNombre(e.target.value); setSucio(true); }} />
        <input className={`${entrada} max-w-[340px]`} placeholder="Descripción (opcional)" value={descripcion} onChange={e => { setDescripcion(e.target.value); setSucio(true); }} />
        <label className="inline-flex items-center gap-2 text-[12.5px] text-zinc-700 cursor-pointer" title="Repite la hoja una vez por persona, con {{nombre}} y {{rut}}">
          <input type="checkbox" checked={porPersona} onChange={e => { setPorPersona(e.target.checked); setSucio(true); }} /> Una hoja por persona
        </label>
        <div className="flex-1" />
        <Boton onClick={deshacer} titulo="Deshacer (Ctrl+Z)"><Deshacer size={16} /></Boton>
        <Boton onClick={rehacer} titulo="Rehacer (Ctrl+Y)"><Rehacer size={16} /></Boton>
        <Boton activo={vistaReal} onClick={() => setVistaReal(v => !v)} titulo="Ver la hoja tal como sale en el PDF"><Ojo size={16} /></Boton>
        <div className="flex items-center gap-1 text-[12px] text-zinc-600">
          <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(1)))} className="px-2 py-1 rounded border border-zinc-300 bg-white">−</button>
          <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))} className="px-2 py-1 rounded border border-zinc-300 bg-white">+</button>
        </div>
        <button onClick={cerrar} disabled={guardando} className="text-[13px] font-semibold px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50">Cerrar</button>
        <button onClick={guardar} disabled={guardando} className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60">
          {guardando ? <Loader2 size={14} className="animate-spin" /> : <Guardar size={15} />} Guardar plantilla
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Herramientas */}
        <div className="w-44 flex-shrink-0 bg-white border-r border-zinc-200 p-3 space-y-1.5 overflow-y-auto">
          <p className="text-[11px] font-semibold text-zinc-400 mb-1">Agregar a la hoja</p>
          {([['texto', Texto], ['logo', Logo], ['tabla', Tabla], ['linea', Linea], ['caja', Caja], ['firma', Firma]] as [TipoElemento, any][]).map(([t, Ico]) => (
            <button key={t} onClick={() => agregar(t)} className="w-full flex items-center gap-2 text-[12.5px] font-medium px-2.5 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:border-teal-400 hover:bg-teal-50">
              <Ico size={16} className="text-teal-700" /> {NOMBRES[t]}
            </button>
          ))}
          <div className="pt-3 mt-2 border-t border-zinc-100">
            <p className="text-[11px] font-semibold text-zinc-400 mb-1">Campos del formulario</p>
            {campos.length === 0 ? <p className="text-[11.5px] text-zinc-400">Aún ninguno. Escribe {'{{ciudad}}'} en un texto y aparece aquí.</p>
              : <ul className="space-y-1">{campos.map(c => <li key={c.clave} className="text-[11.5px] text-zinc-600 flex gap-1.5"><span className="text-teal-700">•</span><span>{c.etiqueta}</span></li>)}</ul>}
          </div>
          <p className="pt-3 text-[11px] text-zinc-400 leading-snug">Arrastra para mover, tira de los bordes para cambiar el tamaño. Flechas = 1 mm (Mayús = 5 mm).</p>
        </div>

        {/* Hoja */}
        <div ref={caja} className="flex-1 min-w-0 overflow-auto p-6" onPointerDown={() => setSel(null)}>
          <div className="mx-auto shadow-lg bg-white relative" style={{ width: 794 * escala, height: 1123 * escala }}>
            <div className="absolute top-0 left-0" style={{ width: 794, height: 1123, transform: `scale(${escala})`, transformOrigin: 'top left' }}>
              <iframe srcDoc={html} title="Hoja" tabIndex={-1} sandbox="" className="border-0 pointer-events-none bg-white absolute top-0 left-0" style={{ width: 794, height: 1123 }} />
              {!vistaReal && (
                <div className="absolute inset-0">
                  {guiaCentro && <div className="absolute top-0 bottom-0 border-l border-dashed border-orange-500" style={{ left: 397 }} />}
                  {elementos.map(e0 => {
                    const e = caja_(e0); const activo = e.id === sel; const esLinea = e.tipo === 'linea';
                    return (
                      <div key={e.id} onPointerDown={ev => iniciar(ev, e0, null)}
                        className={`absolute cursor-move ${activo ? 'outline outline-2 outline-teal-500' : 'hover:outline hover:outline-1 hover:outline-teal-300'}`}
                        style={{ left: e.x * PX_MM, top: e.y * PX_MM - (esLinea ? 6 : 0), width: e.w * PX_MM, height: esLinea ? 12 : Math.max(e.h * PX_MM, 8) }}>
                        {activo && MANIJAS.filter(m => !esLinea || m.hy === 0).map(m => (
                          <span key={`${m.hx}${m.hy}`} onPointerDown={ev => iniciar(ev, e0, m)} className="absolute w-2.5 h-2.5 bg-white border-2 border-teal-600 rounded-sm"
                            style={{ cursor: m.cursor, left: m.hx === -1 ? -6 : m.hx === 0 ? 'calc(50% - 5px)' : undefined, right: m.hx === 1 ? -6 : undefined, top: m.hy === -1 ? -6 : m.hy === 0 ? 'calc(50% - 5px)' : undefined, bottom: m.hy === 1 ? -6 : undefined }} />
                        ))}
                        {activo && <span className="absolute -top-5 left-0 text-[10px] font-semibold bg-teal-600 text-white px-1.5 rounded whitespace-nowrap">{NOMBRES[e.tipo]} · {e.x}, {e.y} · {e.w}×{e.h} mm</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Propiedades */}
        <div className="w-72 flex-shrink-0 bg-white border-l border-zinc-200 p-3 overflow-y-auto" onPointerDown={e => e.stopPropagation()}>
          {!elegido ? (
            <div className="text-[12.5px] text-zinc-500 space-y-2">
              <p className="font-semibold text-zinc-700">Nada seleccionado</p>
              <p>Haz clic en un elemento de la hoja para cambiar su texto, tamaño o posición, o agrega uno desde la izquierda.</p>
              <p className="text-[11.5px] text-zinc-400">Lo que está en amarillo es lo que se llena al generar el documento.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-zinc-800">{NOMBRES[elegido.tipo]}</p>
                <div className="flex gap-1">
                  <Boton onClick={() => orden(1)} titulo="Traer adelante"><Subir size={15} /></Boton>
                  <Boton onClick={() => orden(-1)} titulo="Enviar atrás"><Bajar size={15} /></Boton>
                  <Boton onClick={duplicar} titulo="Duplicar (Ctrl+D)"><Copiar size={15} /></Boton>
                  <Boton onClick={borrar} titulo="Eliminar (Supr)"><Borrar size={15} /></Boton>
                </div>
              </div>

              {elegido.tipo === 'texto' && <>
                <textarea ref={refTexto} rows={5} className={entrada} value={elegido.texto || ''} onChange={e => actualizar(elegido.id, { texto: e.target.value })} />
                <div>
                  <span className="block text-[10.5px] text-zinc-500 mb-1">Insertar dato que se llena solo</span>
                  <div className="flex flex-wrap gap-1">
                    {VARIABLES_FIJAS.map(v => <button key={v.k} type="button" onClick={() => insertarVariable(v.k)} className="text-[11px] px-1.5 py-0.5 rounded border border-zinc-300 hover:border-teal-400 hover:bg-teal-50 text-zinc-700">{v.n}</button>)}
                  </div>
                </div>
                <div>
                  <span className="block text-[10.5px] text-zinc-500 mb-1">Campo que se escribe al generar</span>
                  <div className="flex gap-1.5">
                    <input className={entrada} placeholder="ej.: ciudad, equipo" value={campoNuevo} onChange={e => setCampoNuevo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') crearCampo(); }} />
                    <button type="button" onClick={crearCampo} className="text-[12px] font-semibold px-2.5 rounded-md bg-teal-600 text-white hover:bg-teal-700">Poner</button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input type="number" min={5} max={60} className={`${entrada} !w-16`} value={elegido.tam || 11} onChange={e => actualizar(elegido.id, { tam: Number(e.target.value) || 11 })} title="Tamaño en puntos" />
                  <Boton activo={elegido.negrita} onClick={() => actualizar(elegido.id, { negrita: !elegido.negrita })} titulo="Negrita"><Negrita size={15} /></Boton>
                  <Boton activo={elegido.cursiva} onClick={() => actualizar(elegido.id, { cursiva: !elegido.cursiva })} titulo="Cursiva"><Cursiva size={15} /></Boton>
                  <Boton activo={elegido.subrayado} onClick={() => actualizar(elegido.id, { subrayado: !elegido.subrayado })} titulo="Subrayado"><Subrayado size={15} /></Boton>
                  <Boton activo={(elegido.alinea || 'left') === 'left'} onClick={() => actualizar(elegido.id, { alinea: 'left' })} titulo="A la izquierda"><AlIzq size={15} /></Boton>
                  <Boton activo={elegido.alinea === 'center'} onClick={() => actualizar(elegido.id, { alinea: 'center' })} titulo="Centrado"><AlCentro size={15} /></Boton>
                  <Boton activo={elegido.alinea === 'right'} onClick={() => actualizar(elegido.id, { alinea: 'right' })} titulo="A la derecha"><AlDer size={15} /></Boton>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">Color <input type="color" value={elegido.color || '#1f1f1f'} onChange={e => actualizar(elegido.id, { color: e.target.value })} /></label>
                  <label className="flex items-center gap-1.5 text-[12px] text-zinc-600"><input type="checkbox" checked={!!elegido.serif} onChange={e => actualizar(elegido.id, { serif: e.target.checked })} /> Letra con serifa</label>
                </div>
              </>}

              {elegido.tipo === 'logo' && <>
                <label className="block"><span className="block text-[10.5px] text-zinc-500 mb-0.5">Nombre en el formulario</span>
                  <input className={entrada} value={elegido.etiqueta || ''} onChange={e => actualizar(elegido.id, { etiqueta: e.target.value })} /></label>
                <label className="block"><span className="block text-[10.5px] text-zinc-500 mb-0.5">Logo por defecto (se puede cambiar al generar)</span>
                  <select className={entrada} value={elegido.logo || ''} onChange={e => actualizar(elegido.id, { logo: e.target.value })}>
                    {(ctx.logosOpciones || []).map(o => <option key={o.clave} value={o.clave}>{o.nombre}</option>)}
                  </select></label>
                <p className="text-[11.5px] text-zinc-400">Los logos se suben en «Banco de logos». Se ajustan al recuadro sin deformarse.</p>
              </>}

              {elegido.tipo === 'tabla' && <>
                <label className="block"><span className="block text-[10.5px] text-zinc-500 mb-0.5">Nombre en el formulario</span>
                  <input className={entrada} value={elegido.etiqueta || ''} onChange={e => actualizar(elegido.id, { etiqueta: e.target.value })} /></label>
                <label className="block"><span className="block text-[10.5px] text-zinc-500 mb-0.5">Columnas (separadas por coma)</span>
                  <input className={entrada} value={(elegido.columnas || []).join(', ')} onChange={e => actualizar(elegido.id, { columnas: e.target.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8) })} /></label>
                <Num etiqueta="Filas mínimas (se dibujan en blanco)" v={elegido.filasMin || 0} paso={1} onC={n => actualizar(elegido.id, { filasMin: Math.max(0, Math.min(40, Math.round(n))) })} />
              </>}

              {(elegido.tipo === 'linea' || elegido.tipo === 'caja') && <>
                <Num etiqueta="Grosor (mm)" v={elegido.grosor || 0.5} paso={0.1} onC={n => actualizar(elegido.id, { grosor: Math.max(0.25, Math.min(3, n)) })} />
                <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">Color <input type="color" value={elegido.color || '#3a3a3a'} onChange={e => actualizar(elegido.id, { color: e.target.value })} /></label>
                {elegido.tipo === 'caja' && <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">Relleno <input type="color" value={elegido.relleno || '#ffffff'} onChange={e => actualizar(elegido.id, { relleno: e.target.value })} />
                  <button type="button" className="text-[11px] text-teal-700 underline" onClick={() => actualizar(elegido.id, { relleno: undefined })}>sin relleno</button></label>}
              </>}

              {elegido.tipo === 'firma' && <p className="text-[11.5px] text-zinc-500">Usa la firma, el timbre y el representante cargados en «Mi empresa» (Empresas).</p>}

              <div className="pt-2 border-t border-zinc-100">
                <p className="text-[10.5px] font-semibold text-zinc-400 mb-1.5">Posición y tamaño (mm)</p>
                <div className="grid grid-cols-2 gap-2">
                  <Num etiqueta="Izquierda" v={elegido.x} onC={n => actualizar(elegido.id, { x: Math.max(0, n) })} />
                  <Num etiqueta="Arriba" v={elegido.y} onC={n => actualizar(elegido.id, { y: Math.max(0, n) })} />
                  <Num etiqueta="Ancho" v={elegido.w} onC={n => actualizar(elegido.id, { w: Math.max(3, n) })} />
                  {elegido.tipo !== 'linea' && <Num etiqueta="Alto" v={elegido.h} onC={n => actualizar(elegido.id, { h: Math.max(3, n) })} />}
                </div>
                <button type="button" onClick={() => actualizar(elegido.id, { x: Math.round((HOJA_MM.w - elegido.w) / 2 * 2) / 2 })} className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 hover:text-teal-800"><CentrarH size={15} /> Centrar en la hoja</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
