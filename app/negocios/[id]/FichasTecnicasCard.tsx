'use client';

// FICHAS TÉCNICAS · paso 3 de «Costeo y auditoría». Se suben TODAS las fichas juntas (sin decir de qué son) y el sistema
// detecta a qué producto y a qué proveedor corresponde cada una; después se compara lo que dicen contra los requisitos de las
// bases (comparador técnico del Auditor, v3.0). Lógica en app/lib/compras-fichas.ts; este archivo solo la muestra.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import {
  IconLoader2 as Loader2, IconUpload as Upload, IconFolderPlus as FolderPlus, IconCircleCheck as Check, IconAlertTriangle as Alerta,
  IconChevronDown as Chevron, IconFileText as Doc, IconEye as Eye, IconX as X, IconRefresh as Refresh, IconSparkles as Chispa,
} from '@tabler/icons-react';
import type { PanelFichasDTO, ProductoFichasDTO, OpcionFichaDTO, ResultadoRuteo, ProductoRuteado, FilaRequisito } from '@/app/lib/compras-fichas';

const fmtCLP = (n: number | null | undefined) => n == null ? '' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const hora = (f: string | null) => f ? f.replace('T', ' ').slice(0, 16).split(' ').map((x, i) => i === 0 ? x.split('-').reverse().join('-') : x).join(' ') : '';

type EstadoCola = 'esperando' | 'leyendo' | 'listo' | 'error';
interface ItemCola { id: number; nombre: string; estado: EstadoCola; resultado?: ResultadoRuteo; error?: string; file?: File; url?: string }
interface DocProyecto { nombre: string; url: string; yaLeido: boolean; parece: boolean }

const FORMATOS = /\.(pdf|png|jpe?g|webp|docx?|xlsx?|txt|md|csv|tsv)$/i;

const ESTADO_TEC: Record<string, { texto: string; clase: string }> = {
  CUMPLE: { texto: 'Cumple', clase: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  NO_CUMPLE: { texto: 'No cumple', clase: 'bg-rose-100 text-rose-800 border-rose-200' },
  CON_PENDIENTES: { texto: 'Falta dato', clase: 'bg-amber-100 text-amber-800 border-amber-200' },
  SIN_EVALUAR: { texto: 'Sin evaluar', clase: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  NO_CORRIDO: { texto: 'Sin comparar', clase: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  SIN_REQUISITOS: { texto: 'Sin requisitos', clase: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  NO_APLICA: { texto: 'No aplica', clase: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
};
const CELDA: Record<string, { texto: string; clase: string }> = {
  CUMPLE: { texto: 'Cumple', clase: 'text-emerald-700' }, SOBRECUMPLE: { texto: 'Sobrecumple', clase: 'text-emerald-700' },
  NO_CUMPLE: { texto: 'No cumple', clase: 'text-rose-700 font-bold' }, FALTA_DATO: { texto: 'Falta dato', clase: 'text-amber-700' },
  CUMPLE_CON_COMPLEMENTO: { texto: 'Cumple con complemento', clase: 'text-emerald-700' }, SIN_VEREDICTO: { texto: 'Sin veredicto', clase: 'text-amber-700' },
};

const normP = (x: string | null | undefined) => (x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Lo que de verdad se va a comprar: opciones de un proveedor cotizado (o con el proveedor todavía por elegir). Las de links de tiendas o de
 *  comparación de precios del Auditor NO cuentan como «ficha del producto que se compra», aunque tengan ficha. */
export function opcionesDeCompra(p: ProductoFichasDTO): OpcionFichaDTO[] {
  const nombres = p.cotizados.map(c => normP(c.proveedor));
  return p.opciones.filter(o => !o.proveedor || nombres.includes(normP(o.proveedor)));
}

function Insignia({ estado }: { estado: string }) {
  const e = ESTADO_TEC[estado] ?? ESTADO_TEC.NO_CORRIDO;
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${e.clase}`}>{e.texto}</span>;
}

export function FichasTecnicasCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [panel, setPanel] = useState<PanelFichasDTO | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cola, setCola] = useState<ItemCola[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [comparando, setComparando] = useState<Set<number>>(new Set());
  const [abiertas, setAbiertas] = useState<Set<number>>(new Set());
  const [arrastrando, setArrastrando] = useState(false);
  const [proyecto, setProyecto] = useState<DocProyecto[] | null>(null);
  const [pegando, setPegando] = useState<{ nombre: string; texto: string } | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const [verOtros, setVerOtros] = useState(false);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const idCola = useRef(0);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/fichas`).then(r => r.json());
      if (d.success) { setPanel(d.panel); setError(null); } else setError(d.error || 'No se pudieron cargar las fichas.');
    } catch { setError('No se pudieron cargar las fichas.'); }
    finally { setCargando(false); }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar]);
  // Un cambio hecho desde la matriz de precios (complementar, comparar…) también se ve aquí.
  useEffect(() => {
    const h = () => { cargar(); };
    window.addEventListener('compras:fichas-cambio', h);
    return () => window.removeEventListener('compras:fichas-cambio', h);
  }, [cargar]);

  // ── Cola de procesamiento: de a 2 fichas a la vez, con progreso por archivo ───────────────────
  const procesarCola = useCallback(async (items: ItemCola[]) => {
    setProcesando(true);
    const pendientes = [...items];
    const actualizar = (id: number, cambio: Partial<ItemCola>) => setCola(c => c.map(x => x.id === id ? { ...x, ...cambio } : x));
    const trabajador = async () => {
      for (let it = pendientes.shift(); it; it = pendientes.shift()) {
        actualizar(it.id, { estado: 'leyendo' });
        try {
          let res: Response;
          if (it.file) { const fd = new FormData(); fd.set('file', it.file); res = await fetch(`/api/compras/${negocioId}/fichas`, { method: 'POST', body: fd }); }
          else res = await fetch(`/api/compras/${negocioId}/fichas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'procesar_url', url: it.url, nombre: it.nombre }) });
          const d = await res.json();
          if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo procesar');
          const r: ResultadoRuteo = d.resultado;
          actualizar(it.id, r.error ? { estado: 'error', error: r.error, resultado: r } : { estado: 'listo', resultado: r });
        } catch (e: any) { actualizar(it.id, { estado: 'error', error: e.message }); }
      }
    };
    await Promise.all([trabajador(), trabajador()]);
    setProcesando(false);
    await cargar();
  }, [negocioId, cargar]);

  const agregarArchivos = (files: FileList | File[]) => {
    const validos = [...files].filter(f => FORMATOS.test(f.name));
    if (validos.length === 0) { toast.error('Formato no soportado', 'Sube PDF, imagen (PNG/JPG), Word, Excel o texto (TXT).'); return; }
    if (validos.length < [...files].length) toast.error('Algunos archivos se omitieron', 'Solo se leen PDF, imágenes, Word, Excel y texto.');
    const items: ItemCola[] = validos.map(f => ({ id: ++idCola.current, nombre: f.name, estado: 'esperando', file: f }));
    setCola(c => [...c, ...items]);
    procesarCola(items);
  };

  const reintentar = (nombre: string, url: string) => {
    const item: ItemCola = { id: ++idCola.current, nombre, estado: 'esperando', url };
    setCola(c => [...c, item]);
    procesarCola([item]);
  };

  const enviarTexto = async () => {
    if (!pegando) return;
    const { nombre, texto } = pegando;
    setPegando(null);
    const item: ItemCola = { id: ++idCola.current, nombre: nombre.trim() || 'Ficha pegada', estado: 'leyendo' };
    setCola(c => [...c, item]);
    setProcesando(true);
    try {
      const d = await post({ accion: 'texto', nombre, texto });
      const r: ResultadoRuteo = d.resultado;
      setCola(c => c.map(x => x.id === item.id ? (r.error ? { ...x, estado: 'error', error: r.error, resultado: r } : { ...x, estado: 'listo', resultado: r }) : x));
    } catch (e: any) { setCola(c => c.map(x => x.id === item.id ? { ...x, estado: 'error', error: e.message } : x)); }
    setProcesando(false);
    await cargar();
  };

  const abrirProyecto = async () => {
    setProyecto([]); setElegidos(new Set()); setVerOtros(false);
    try { const d = await fetch(`/api/compras/${negocioId}/fichas?proyecto=1`).then(r => r.json()); setProyecto(d.documentos || []); } catch { setProyecto([]); }
  };
  const traerDelProyecto = () => {
    const docs = (proyecto || []).filter(d => elegidos.has(d.url));
    setProyecto(null);
    if (!docs.length) return;
    const items: ItemCola[] = docs.map(d => ({ id: ++idCola.current, nombre: d.nombre, estado: 'esperando', url: d.url }));
    setCola(c => [...c, ...items]);
    procesarCola(items);
  };

  // ── Acciones ───────────────────────────────────────────────────────────────────────────────────
  const post = async (cuerpo: object) => {
    const r = await fetch(`/api/compras/${negocioId}/fichas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo completar');
    window.dispatchEvent(new Event('compras:fichas-cambio'));   // la matriz de precios (paso 2) también se actualiza
    return d;
  };
  const comparar = async (p: ProductoFichasDTO, silencioso = false) => {
    setComparando(s => new Set(s).add(p.productoId));
    try { await post({ accion: 'comparar', productoCompraId: p.productoId }); if (!silencioso) toast.success('Comparación lista', p.descripcion); setAbiertas(s => new Set(s).add(p.productoId)); }
    catch (e: any) { toast.error(`No se pudo comparar «${p.descripcion}»`, e.message); }
    finally { setComparando(s => { const n = new Set(s); n.delete(p.productoId); return n; }); }
    if (!silencioso) await cargar();
  };
  const compararTodos = async () => {
    const lista = (panel?.productos || []).filter(p => p.opciones.some(o => o.fichas.length > 0));
    for (const p of lista) await comparar(p, true);
    await cargar();
    toast.success('Comparación terminada', `${lista.length} producto(s) comparados contra las bases.`);
  };
  const cambiarProveedor = async (o: OpcionFichaDTO, proveedor: string) => {
    try { await post({ accion: 'proveedor', opcionId: o.opcionId, proveedor: proveedor || null }); await cargar(); }
    catch (e: any) { toast.error('No se pudo cambiar el proveedor', e.message); }
  };
  const complementar = async (o: OpcionFichaDTO, n: number, resultado: 'CUMPLE' | 'NO_CUMPLE' | null, dato: string, fuente: string) => {
    try { await post({ accion: 'complementar', opcionId: o.opcionId, n, resultado, dato, fuente }); toast.success(resultado ? 'Complemento guardado' : 'Complemento quitado'); await cargar(); }
    catch (e: any) { toast.error('No se pudo guardar el complemento', e.message); throw e; }
  };
  const quitarModelo = async (o: OpcionFichaDTO) => {
    try { await post({ accion: 'quitar_modelo', opcionId: o.opcionId }); await cargar(); } catch (e: any) { toast.error('No se pudo quitar', e.message); }
  };
  const olvidar = async (extraccionId: number) => {
    try { await post({ accion: 'olvidar_documento', extraccionId }); await cargar(); } catch (e: any) { toast.error('No se pudo quitar de la lista', e.message); }
  };
  const asignar = async (extraccionId: number, idx: number, productoCompraId: number, proveedor: string) => {
    try { await post({ accion: 'asignar', extraccionId, productoIdx: idx, productoCompraId, proveedor: proveedor || null }); toast.success('Ficha asignada'); await cargar(); }
    catch (e: any) { toast.error('No se pudo asignar', e.message); }
  };

  if (cargando) return <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-6"><Loader2 size={15} className="animate-spin" /> Cargando fichas técnicas…</div>;
  if (error || !panel) return (
    <div className="py-3 flex items-center gap-3 text-[13px] text-rose-700">
      {error || 'No se pudieron cargar las fichas.'}
      <button type="button" onClick={() => { setCargando(true); cargar(); }} className="inline-flex items-center gap-1 font-semibold text-rose-800 hover:text-rose-950"><Refresh size={13} /> Reintentar</button>
    </div>
  );
  if (panel.sinCosteo) return <p className="text-[13px] text-zinc-600 py-3">Este negocio no tiene un costeo con líneas, así que no hay requisitos ni productos contra los que comparar las fichas.</p>;

  const conFicha = panel.productos.filter(p => opcionesDeCompra(p).some(o => o.fichas.length > 0));
  const estadoProducto = (p: ProductoFichasDTO) => {
    const con = opcionesDeCompra(p).filter(o => o.fichas.length > 0);
    if (!con.length) return null;
    if (con.some(o => o.tecnico.estado === 'NO_CUMPLE')) return 'NO_CUMPLE';
    if (con.every(o => o.tecnico.estado === 'CUMPLE')) return 'CUMPLE';
    if (con.some(o => o.tecnico.estado === 'CON_PENDIENTES')) return 'CON_PENDIENTES';
    return 'NO_CORRIDO';
  };
  const cumplen = conFicha.filter(p => estadoProducto(p) === 'CUMPLE').length;
  const noCumplen = conFicha.filter(p => estadoProducto(p) === 'NO_CUMPLE').length;

  return (
    <div className="space-y-4" data-testid="fichas-tecnicas">
      {/* 1 · Subir */}
      {puedeOperar && (
        <div
          onDragOver={e => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)}
          onDrop={e => { e.preventDefault(); setArrastrando(false); if (e.dataTransfer.files.length) agregarArchivos(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed px-4 py-4 transition-colors ${arrastrando ? 'border-teal-500 bg-teal-50/60' : 'border-zinc-200 bg-zinc-50/50'}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <Upload size={20} className="text-teal-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold text-zinc-800">Sube todas las fichas técnicas juntas</p>
              <p className="text-[12px] text-zinc-500">Arrástralas aquí o elígelas: PDF, imagen, Word, Excel o texto, hasta 100. No hace falta decir de qué son: el sistema detecta el producto y el proveedor de cada una. Este panel es independiente del Auditor: aquí solo cuentan las fichas que subas en este paso.</p>
            </div>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={procesando} data-testid="fichas-subir"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3.5 py-2 rounded-lg"><Upload size={14} /> Subir fichas</button>
            <button type="button" onClick={() => setPegando({ nombre: '', texto: '' })} disabled={procesando} data-testid="fichas-pegar"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 px-3.5 py-2 rounded-lg"><Doc size={14} /> Pegar texto</button>
            <button type="button" onClick={abrirProyecto} disabled={procesando} data-testid="fichas-proyecto"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 px-3.5 py-2 rounded-lg"><FolderPlus size={14} /> Traer del proyecto</button>
            <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,.tsv" className="hidden"
              onChange={e => { if (e.target.files?.length) agregarArchivos(e.target.files); e.target.value = ''; }} />
          </div>
        </div>
      )}

      {/* 2 · Progreso */}
      {cola.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden" data-testid="fichas-cola">
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 border-b border-zinc-100">
            <p className="text-[12px] font-bold text-zinc-600 uppercase tracking-wide">
              {procesando ? `Leyendo y clasificando… ${cola.filter(c => c.estado === 'listo' || c.estado === 'error').length} de ${cola.length}` : `${cola.length} ficha(s) procesadas`}
            </p>
            {!procesando && <button type="button" onClick={() => setCola([])} className="text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-800">Limpiar</button>}
          </div>
          <ul className="divide-y divide-zinc-100 max-h-[320px] overflow-y-auto">
            {cola.map(it => (
              <li key={it.id} className="px-3 py-2 text-[12.5px]">
                <div className="flex items-center gap-2">
                  {it.estado === 'leyendo' && <Loader2 size={13} className="animate-spin text-teal-600 flex-shrink-0" />}
                  {it.estado === 'esperando' && <span className="w-3 h-3 rounded-full border border-zinc-300 flex-shrink-0" />}
                  {it.estado === 'listo' && <Check size={14} className="text-emerald-600 flex-shrink-0" />}
                  {it.estado === 'error' && <Alerta size={14} className="text-rose-600 flex-shrink-0" />}
                  <span className="font-semibold text-zinc-800 truncate">{it.nombre}</span>
                  {it.estado === 'leyendo' && <span className="text-zinc-400">leyendo…</span>}
                </div>
                {it.error && <p className="ml-6 text-rose-700">{it.error}</p>}
                {it.resultado?.productos.map((p: ProductoRuteado) => (
                  <p key={p.idx} className="ml-6 text-zinc-600">
                    <b className="text-zinc-800">{[p.marca, p.modelo].filter(Boolean).join(' ') || p.nombre}</b>
                    {p.resultado === 'asignada' && <> → <b className="text-teal-700">{p.productoNombre}</b> · {p.proveedor ? <>proveedor <b>{p.proveedor}</b></> : <span className="text-amber-700">proveedor por elegir</span>}</>}
                    {p.resultado === 'ya_asignada' && <span className="text-zinc-400"> · ya estaba asignada</span>}
                    {p.resultado === 'por_confirmar' && <span className="text-amber-700"> → por confirmar (abajo)</span>}
                    {p.resultado === 'sin_producto' && <span className="text-amber-700"> → no la pude ubicar (abajo)</span>}
                    {(p.resultado === 'no_es_ficha' || p.resultado === 'sin_identificar') && <span className="text-zinc-500"> → {p.motivo}</span>}
                    {p.resultado === 'error' && <span className="text-rose-700"> → {p.motivo}</span>}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3 · Por confirmar */}
      {panel.pendientes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2" data-testid="fichas-pendientes">
          <p className="text-[12.5px] font-bold text-amber-900 flex items-center gap-1.5"><Alerta size={14} /> {panel.pendientes.length} ficha(s) por asignar a un producto</p>
          {panel.pendientes.map(f => <PendienteFila key={`${f.extraccionId}:${f.idx}`} f={f} panel={panel} puedeOperar={puedeOperar} onAsignar={asignar} onDescartar={olvidar} />)}
        </div>
      )}
      {panel.noSonFichas.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 space-y-0.5" data-testid="fichas-no-son">
          <p className="text-[12px] font-bold text-zinc-600">Documentos que no son fichas de un producto</p>
          {panel.noSonFichas.map((d, i) => <p key={i} className="text-[11.5px] text-zinc-500"><b className="text-zinc-700">{d.documento}</b> · {d.motivo}{puedeOperar && <button type="button" onClick={() => olvidar(d.extraccionId)} className="ml-2 font-semibold text-zinc-500 hover:text-rose-700">Quitar</button>}</p>)}
        </div>
      )}
      {panel.conError.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 space-y-1.5">
          <p className="text-[12.5px] font-bold text-rose-800">No se pudieron leer</p>
          {panel.conError.map(e => (
            <div key={e.extraccionId} className="flex items-center gap-3 text-[12px] text-rose-900 flex-wrap">
              <span className="font-semibold">{e.documento}</span><span className="min-w-0 flex-1">{e.error}</span>
              {puedeOperar && e.url && <button type="button" onClick={() => reintentar(e.documento, e.url!)}
                className="inline-flex items-center gap-1 font-semibold text-rose-700 hover:text-rose-900"><Refresh size={12} /> Reintentar</button>}
              {puedeOperar && <button type="button" onClick={() => olvidar(e.extraccionId)} className="font-semibold text-zinc-500 hover:text-rose-700">Quitar</button>}
            </div>
          ))}
        </div>
      )}

      {/* 4 · Resultado por producto */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <p className="text-[13px] text-zinc-700">
            <b>{conFicha.length}</b> de {panel.productos.length} productos con ficha
            {conFicha.length > 0 && <> · <b className="text-emerald-700">{cumplen}</b> cumplen · <b className="text-rose-700">{noCumplen}</b> no cumplen</>}
          </p>
          {puedeOperar && conFicha.length > 0 && (
            <button type="button" onClick={compararTodos} disabled={comparando.size > 0 || procesando} data-testid="fichas-comparar-todos"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3.5 py-2 rounded-lg">
              {comparando.size > 0 ? <Loader2 size={13} className="animate-spin" /> : <Chispa size={14} />} Comparar todos con las bases
            </button>
          )}
        </div>
        <div className="space-y-2">
          {panel.productos.map(p => {
            const est = estadoProducto(p);
            const abierta = abiertas.has(p.productoId);
            const conFichas = opcionesDeCompra(p).filter(o => o.fichas.length > 0);
            return (
              <div key={p.productoId} className="rounded-xl border border-zinc-200 bg-white overflow-hidden" data-testid={`ficha-producto-${p.productoId}`}>
                <div className="px-3 py-2.5 flex items-center gap-3 flex-wrap">
                  <button type="button" onClick={() => setAbiertas(s => { const n = new Set(s); if (n.has(p.productoId)) n.delete(p.productoId); else n.add(p.productoId); return n; })} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <Chevron size={16} className={`text-zinc-400 transition-transform flex-shrink-0 ${abierta ? 'rotate-180' : ''}`} />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-bold text-zinc-900 truncate">{p.descripcion} <span className="font-normal text-zinc-400">· {p.cantidad ?? '?'} un.</span></span>
                      <span className="block text-[11.5px] text-zinc-500 truncate">
                        {p.cotizados.length ? `Cotizado por ${p.cotizados.map(c => c.proveedor).join(', ')}` : 'Sin cotización todavía'}
                        {conFichas.length ? ` · ${conFichas.reduce((n, o) => n + o.fichas.length, 0)} ficha(s)` : ' · sin ficha'}
                      </span>
                    </span>
                  </button>
                  {est ? <Insignia estado={est} /> : <span className="text-[11px] font-semibold text-zinc-400">sin ficha</span>}
                  {puedeOperar && conFichas.length > 0 && (
                    <button type="button" onClick={() => comparar(p)} disabled={comparando.has(p.productoId)} data-testid={`ficha-comparar-${p.productoId}`}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                      {comparando.has(p.productoId) ? <Loader2 size={12} className="animate-spin" /> : <Chispa size={13} />} {est && est !== 'NO_CORRIDO' ? 'Comparar de nuevo' : 'Comparar'}
                    </button>
                  )}
                </div>
                {abierta && (
                  <div className="border-t border-zinc-100 px-3 py-3 space-y-3 bg-zinc-50/40">
                    {(() => {
                      // Lo que se va a comprar: modelos con ficha o de un proveedor cotizado. El resto (links de tiendas, comparación de precios del Auditor) va aparte.
                      const nombres = p.cotizados.map(c => c.proveedor);
                      const relevantes = opcionesDeCompra(p);
                      const otras = p.opciones.filter(o => !relevantes.includes(o));
                      return (
                        <>
                          {relevantes.length === 0 && <p className="text-[12.5px] text-zinc-500">Todavía no hay fichas ni opciones de los proveedores cotizados. Sube la ficha del modelo que se va a comprar.</p>}
                          {relevantes.map(o => <OpcionFila key={o.opcionId} o={o} cotizados={nombres} puedeOperar={puedeOperar} onProveedor={cambiarProveedor} onQuitar={quitarModelo} onComplementar={complementar} />)}
                          {otras.length > 0 && (
                            <details className="rounded-lg border border-zinc-200 bg-white">
                              <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-zinc-500 hover:text-zinc-800">Otros modelos con proveedor que no cotizó ({otras.length}): no cuentan como lo que se compra</summary>
                              <div className="p-2 space-y-2">{otras.map(o => <OpcionFila key={o.opcionId} o={o} cotizados={nombres} puedeOperar={puedeOperar} onProveedor={cambiarProveedor} onQuitar={quitarModelo} onComplementar={complementar} />)}</div>
                            </details>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[11.5px] text-zinc-400">La comparación usa el motor técnico de las bases: una sola consulta por producto, que compara a todos sus proveedores contra los mismos requisitos. Una cotización no sirve para juzgar si el producto cumple: solo la ficha. Este panel no usa ni modifica las fichas del Auditor.</p>

      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />

      {/* Modal: pegar texto */}
      {pegando && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={() => setPegando(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200">
              <p className="text-[14px] font-bold text-zinc-800">Pegar una ficha técnica como texto</p>
              <button onClick={() => setPegando(null)} aria-label="Cerrar" className="text-zinc-500 hover:text-zinc-900"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[12px] text-zinc-500">Copia las especificaciones desde la web del fabricante o de un correo. Incluye la marca y el modelo para que el sistema identifique el producto.</p>
              <input value={pegando.nombre} onChange={e => setPegando(p => p && { ...p, nombre: e.target.value })} placeholder="Nombre (ej. Samsung UN55U8000 especificaciones)" className="w-full text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
              <textarea value={pegando.texto} onChange={e => setPegando(p => p && { ...p, texto: e.target.value })} rows={10} placeholder="Pega aquí el texto de la ficha…" className="w-full text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500 font-mono" />
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setPegando(null)} className="text-[13px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
                <button onClick={enviarTexto} disabled={pegando.texto.trim().length < 40} className="text-[13px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 rounded-lg">Procesar texto</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: traer del proyecto */}
      {proyecto !== null && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={() => setProyecto(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200">
              <p className="text-[14px] font-bold text-zinc-800">Traer fichas del proyecto</p>
              <button onClick={() => setProyecto(null)} aria-label="Cerrar" className="text-zinc-500 hover:text-zinc-900"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[12px] text-zinc-500">Documentos del proyecto que parecen fichas técnicas (por su nombre). Usa el ojo para verlos antes de marcarlos. Los anexos, cotizaciones y comprobantes no se muestran aquí.</p>
              {(() => {
                const fichas = proyecto.filter(d => d.parece);
                const otros = proyecto.filter(d => !d.parece);
                const fila = (d: DocProyecto) => (

                  <li key={d.url} className="px-3 py-2 flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={elegidos.has(d.url)} onChange={e => setElegidos(s => { const n = new Set(s); if (e.target.checked) n.add(d.url); else n.delete(d.url); return n; })} />
                    <Doc size={14} className="text-zinc-400 flex-shrink-0" />
                    <span className="truncate flex-1">{d.nombre}</span>
                    {d.yaLeido && <span className="text-[10.5px] font-semibold text-emerald-700">ya leída</span>}
                    <button type="button" onClick={() => setVisor({ nombre: d.nombre, url: d.url })} title="Ver el documento antes de elegir" aria-label={`Ver ${d.nombre}`} data-testid="fichas-proyecto-ver"
                      className="p-1 rounded-md text-zinc-500 hover:text-teal-700 hover:bg-zinc-100 flex-shrink-0"><Eye size={15} /></button>
                  </li>
                );
                return (
                  <>
                    <ul className="max-h-[320px] overflow-y-auto divide-y divide-zinc-100 rounded-lg border border-zinc-100">
                      {fichas.length === 0 && <li className="px-3 py-3 text-[12.5px] text-zinc-400">Ningún documento del proyecto parece una ficha técnica por su nombre.</li>}
                      {fichas.map(fila)}
                    </ul>
                    {otros.length > 0 && (
                      <div>
                        <button type="button" onClick={() => setVerOtros(v => !v)} className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-800">{verOtros ? 'Ocultar' : 'Mostrar'} otros documentos del proyecto ({otros.length}): anexos, cotizaciones, comprobantes…</button>
                        {verOtros && <ul className="mt-1 max-h-[220px] overflow-y-auto divide-y divide-zinc-100 rounded-lg border border-zinc-100 opacity-80">{otros.map(fila)}</ul>}
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setProyecto(null)} className="text-[13px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
                <button onClick={traerDelProyecto} disabled={elegidos.size === 0} className="text-[13px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 rounded-lg">Procesar {elegidos.size || ''} ficha(s)</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PendienteFila({ f, panel, puedeOperar, onAsignar, onDescartar }: {
  f: PanelFichasDTO['pendientes'][number]; panel: PanelFichasDTO; puedeOperar: boolean;
  onAsignar: (extraccionId: number, idx: number, productoCompraId: number, proveedor: string) => Promise<void>;
  onDescartar: (extraccionId: number) => Promise<void>;
}) {
  const [producto, setProducto] = useState<number>(f.sugerencia?.productoCompraId ?? 0);
  const [proveedor, setProveedor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cotizados = panel.productos.find(p => p.productoId === producto)?.cotizados.map(c => c.proveedor) ?? [];
  return (
    <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12.5px] space-y-1.5">
      <p className="text-zinc-800"><b>{[f.marca, f.modelo].filter(Boolean).join(' ') || f.nombre}</b> <span className="text-zinc-400">· {f.documento}</span></p>
      {f.sugerencia?.motivo && <p className="text-[11.5px] text-amber-800">{f.sugerencia.productoCompraId ? `Sugerencia (${f.sugerencia.confianza}): ` : 'No pude ubicarla: '}{f.sugerencia.motivo}</p>}
      {puedeOperar && (
        <div className="flex items-center gap-2 flex-wrap">
          <select value={producto} onChange={e => { setProducto(Number(e.target.value)); setProveedor(''); }} className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 bg-white">
            <option value={0}>¿De qué producto es?</option>
            {panel.productos.map(p => <option key={p.productoId} value={p.productoId}>{p.descripcion}</option>)}
          </select>
          <select value={proveedor} onChange={e => setProveedor(e.target.value)} disabled={!producto} className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">{cotizados.length ? '¿De qué proveedor? (detectar)' : 'Proveedor (opcional)'}</option>
            {cotizados.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" disabled={!producto || enviando} onClick={async () => { setEnviando(true); await onAsignar(f.extraccionId, f.idx, producto, proveedor); setEnviando(false); }}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {enviando && <Loader2 size={12} className="animate-spin" />} Asignar
          </button>
          <button type="button" onClick={() => onDescartar(f.extraccionId)} className="text-[12px] font-semibold text-zinc-500 hover:text-rose-700">Descartar</button>
        </div>
      )}
    </div>
  );
}

const FUENTES = ['Llamada o correo con el proveedor', 'Manual o ficha del fabricante', 'Otro documento', 'Verificado en terreno', 'Otra'];

/** Aporta el dato que faltaba y decide si cumple. Queda registrado quién lo hizo. */
function ComplementoForm({ f, onGuardar, onCancelar }: { f: FilaRequisito; onGuardar: (resultado: 'CUMPLE' | 'NO_CUMPLE' | null, dato: string, fuente: string) => Promise<void>; onCancelar: () => void }) {
  const [dato, setDato] = useState(f.complemento?.dato ?? '');
  const [fuente, setFuente] = useState(f.complemento?.fuente ?? FUENTES[0]);
  const [resultado, setResultado] = useState<'CUMPLE' | 'NO_CUMPLE' | ''>(f.complemento?.resultado ?? '');
  const [guardando, setGuardando] = useState(false);
  const enviar = async (r: 'CUMPLE' | 'NO_CUMPLE' | null) => { setGuardando(true); try { await onGuardar(r, dato, fuente); } catch { /* el aviso ya se mostró */ } setGuardando(false); };
  return (
    <div className="space-y-2" data-testid={`complemento-form-${f.n}`}>
      <p className="text-[11.5px] text-zinc-600"><b>Requisito {f.n}:</b> {f.requerido}</p>
      <textarea value={dato} onChange={e => setDato(e.target.value)} rows={2} placeholder="¿Qué dato aportas? (ej. «Soporte VESA 400×200, según el manual del fabricante»)"
        className="w-full text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" />
      <div className="flex items-center gap-3 flex-wrap">
        <select value={fuente} onChange={e => setFuente(e.target.value)} className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 bg-white">
          {FUENTES.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <span className="text-[12px] font-semibold text-zinc-600">Con este dato el producto:</span>
        {(['CUMPLE', 'NO_CUMPLE'] as const).map(r => (
          <label key={r} className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg border cursor-pointer ${resultado === r ? (r === 'CUMPLE' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600') : 'bg-white text-zinc-600 border-zinc-200'}`}>
            <input type="radio" className="hidden" checked={resultado === r} onChange={() => setResultado(r)} /> {r === 'CUMPLE' ? 'Cumple' : 'No cumple'}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={guardando || !resultado || dato.trim().length < 3} onClick={() => enviar(resultado || null)}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">{guardando && <Loader2 size={12} className="animate-spin" />} Guardar complemento</button>
        {f.complemento && <button type="button" disabled={guardando} onClick={() => enviar(null)} className="text-[12px] font-semibold text-rose-700 hover:text-rose-900">Quitar complemento</button>}
        <button type="button" onClick={onCancelar} className="text-[12px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
        <span className="text-[11px] text-zinc-400">Queda registrado quién lo complementó y cuándo.</span>
      </div>
    </div>
  );
}

export function OpcionFila({ o, cotizados, puedeOperar, onProveedor, onQuitar, onComplementar }: {
  o: OpcionFichaDTO; cotizados: string[]; puedeOperar: boolean; onProveedor: (o: OpcionFichaDTO, proveedor: string) => Promise<void>; onQuitar: (o: OpcionFichaDTO) => Promise<void>;
  onComplementar: (o: OpcionFichaDTO, n: number, resultado: 'CUMPLE' | 'NO_CUMPLE' | null, dato: string, fuente: string) => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const t = o.tecnico;
  const sinFicha = o.fichas.length === 0;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="px-3 py-2 flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-zinc-800">{[o.marca, o.modelo].filter(Boolean).join(' ') || 'Opción sin marca ni modelo'}</p>
          <p className="text-[11.5px] text-zinc-500">
            {sinFicha ? <span className="text-amber-700 font-semibold">Falta la ficha técnica de este modelo</span> : o.fichas.map((f, i) => (
              <span key={i}>{i > 0 && ' · '}{f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{f.nombre}</a> : f.nombre}</span>
            ))}
          </p>
        </div>
        {puedeOperar ? (
          <select value={o.proveedor || ''} onChange={e => onProveedor(o, e.target.value)} className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 bg-white max-w-[220px]" title="Proveedor de este modelo">
            <option value="">Proveedor por elegir</option>
            {[...new Set([...(o.proveedor ? [o.proveedor] : []), ...cotizados])].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : <span className="text-[12px] text-zinc-600">{o.proveedor || 'Proveedor por elegir'}</span>}
        {!sinFicha && <Insignia estado={t.estado} />}
        {puedeOperar && (confirmando
          ? <span className="text-[11.5px] text-zinc-600">¿Quitar este modelo y su ficha? <button type="button" onClick={() => onQuitar(o)} className="font-bold text-rose-700 hover:text-rose-900">Sí, quitar</button> · <button type="button" onClick={() => setConfirmando(false)} className="font-semibold text-zinc-500">No</button></span>
          : <button type="button" onClick={() => setConfirmando(true)} className="text-[11.5px] font-semibold text-zinc-400 hover:text-rose-700">Quitar</button>)}
      </div>
      {!sinFicha && t.error && <p className="px-3 pb-2 text-[12px] text-rose-700">{t.error}</p>}
      {!sinFicha && t.resumen && (
        <div className="px-3 pb-2 space-y-2">
          <p className="text-[12px] text-zinc-600">
            {t.resumen.cumple} de {t.resumen.total} requisitos cumplen
            {t.resumen.noCumple > 0 && <> · <b className="text-rose-700">{t.resumen.noCumple} no cumplen</b></>}
            {t.resumen.sinVeredicto > 0 && <> · <b className="text-amber-700">{t.resumen.sinVeredicto} sin dato</b></>}
            {t.corridoAt && <span className="text-zinc-400"> · comparado {hora(t.corridoAt)}</span>}
          </p>
          {t.notas.length > 0 && <ul className="list-disc pl-5 text-[11.5px] text-zinc-500">{t.notas.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {t.preguntas.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
              <p className="text-[11.5px] font-bold text-amber-900">Preguntas para el proveedor</p>
              <ul className="list-disc pl-5 text-[11.5px] text-amber-900">{t.preguntas.map((q, i) => <li key={i}>{q.texto}</li>)}</ul>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] border-collapse">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400"><th className="py-1 pr-2">#</th><th className="py-1 pr-3">Lo que piden las bases</th><th className="py-1 pr-3">Resultado</th><th className="py-1 pr-3">Lo que dice la ficha</th></tr></thead>
              <tbody>
                {t.filas.map(f => {
                  const c = CELDA[f.estado] ?? { texto: f.estado, clase: 'text-zinc-600' };
                  const sinDato = f.estadoIA === 'FALTA_DATO' || f.estadoIA === 'SIN_VEREDICTO';
                  return (
                    <Fragment key={f.n}>
                      <tr className={`border-t border-zinc-100 align-top ${f.estado === 'NO_CUMPLE' ? 'bg-rose-50/40' : ''}`}>
                        <td className="py-1 pr-2 text-zinc-400 tabular-nums">{f.n}</td>
                        <td className="py-1 pr-3 text-zinc-700 min-w-[220px]">{f.requerido}{f.criticidad === 'INADMISIBLE' && <span className="ml-1 text-[10px] font-bold text-rose-700">EXCLUYENTE</span>}</td>
                        <td className={`py-1 pr-3 whitespace-nowrap ${c.clase}`}>
                          {c.texto}{f.confirmada && <span className="text-zinc-400 font-normal"> (confirmada)</span>}
                          {f.complemento && <span className="block text-[10px] font-semibold text-indigo-600">complementado</span>}
                          {puedeOperar && sinDato && editando !== f.n && (
                            <button type="button" onClick={() => setEditando(f.n)} data-testid={`complementar-${o.opcionId}-${f.n}`} className="block text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline">{f.complemento ? 'Editar complemento' : 'Complementar'}</button>
                          )}
                        </td>
                        <td className="py-1 pr-3 text-zinc-600">
                          {f.valor || '—'}
                          {f.cita && <span className="block text-[10.5px] text-zinc-400 italic">«{f.cita.slice(0, 140)}»</span>}
                          {f.complemento && (
                            <span className="block text-[10.5px] text-indigo-700">
                              {f.complemento.fuente ? `${f.complemento.fuente} · ` : ''}complementó <b>{f.complemento.por}</b> el {hora(f.complemento.at.replace(' ', 'T'))}
                            </span>
                          )}
                        </td>
                      </tr>
                      {editando === f.n && (
                        <tr className="bg-indigo-50/40">
                          <td colSpan={4} className="px-2 py-2">
                            <ComplementoForm f={f} onCancelar={() => setEditando(null)}
                              onGuardar={async (resultado, dato, fuente) => { await onComplementar(o, f.n, resultado, dato, fuente); setEditando(null); }} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!sinFicha && !t.resumen && !t.error && <p className="px-3 pb-2 text-[12px] text-zinc-500">Todavía no se compara contra las bases: usa «Comparar».</p>}
    </div>
  );
}
