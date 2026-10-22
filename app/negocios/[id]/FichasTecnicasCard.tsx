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
import { LinksProducto, type LinksCosteo } from './LinksProducto';
import { IncidenciaFichaModal } from './IncidenciaFichaModal';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
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
  return p.opciones.filter(o => !o.proveedor || p.cotizados.some(c => mismoProveedorFicha(o, c)));
}

const soloRut = (x: string | null | undefined) => (x || '').replace(/[^0-9kK]/g, '').toUpperCase();
/** ¿La opción (ficha) y la cotización son del mismo proveedor? Mismo RUT, o nombre igual / uno dentro del otro («Sodimac» ↔ «SODIMAC S.A.»).
 *  Una compra directa trae su propio nombre y RUT: comparar solo el nombre exacto dejaba la ficha «sin proveedor cotizado». */
export function mismoProveedorFicha(op: { proveedor: string | null; proveedorRut?: string | null }, cot: { proveedor: string; proveedorRut?: string | null }): boolean {
  const ra = soloRut(op.proveedorRut), rb = soloRut(cot.proveedorRut);
  if (ra.length >= 7 && rb.length >= 7) return ra === rb;
  const a = normP(op.proveedor), b = normP(cot.proveedor);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)));
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
  const [quitadas, setQuitadas] = useState<Set<number>>(new Set());
  const [verOtros, setVerOtros] = useState(false);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const idCola = useRef(0);
  // «Subir otra ficha» de UN producto: la ficha se asigna a ese producto (sin depender de que el sistema la adivine) y se vuelve a comparar.
  const subirRef = useRef<HTMLInputElement>(null);
  const [destino, setDestino] = useState<ProductoFichasDTO | null>(null);
  const [subiendoA, setSubiendoA] = useState<number | null>(null);

  const [linksCosteo, setLinksCosteo] = useState<LinksCosteo>({});
  const [incidenciaDe, setIncidenciaDe] = useState<ProductoFichasDTO[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const { recargar: recargarCompras } = useCompras();   // las incidencias nacen como tareas: se refresca la lista de tareas

  const cargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/fichas`).then(r => r.json());
      if (d.success) { setPanel(d.panel); setError(null); } else setError(d.error || 'No se pudieron cargar las fichas.');
      fetch(`/api/compras/${negocioId}/productos`).then(r => r.json()).then(x => setLinksCosteo(x.linksCosteo || {})).catch(() => {});
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
  const subirParaProducto = async (p: ProductoFichasDTO, files: FileList | File[]) => {
    const validos = [...files].filter(f => FORMATOS.test(f.name));
    if (validos.length === 0) { toast.error('Formato no soportado', 'Sube PDF, imagen (PNG/JPG), Word, Excel o texto (TXT).'); return; }
    setSubiendoA(p.productoId); setAbiertas(s => new Set(s).add(p.productoId));
    let asignadas = 0;
    try {
      for (const f of validos) {
        const fd = new FormData(); fd.set('file', f);
        const res = await fetch(`/api/compras/${negocioId}/fichas`, { method: 'POST', body: fd });
        const d = await res.json();
        if (!res.ok || !d.success) { toast.error(`No se pudo leer «${f.name}»`, d.error || 'Intenta de nuevo.'); continue; }
        const r: ResultadoRuteo = d.resultado;
        if (r.error) { toast.error(`No se pudo leer «${f.name}»`, r.error); continue; }
        for (const x of r.productos) {
          if (x.resultado === 'ya_asignada' && x.productoCompraId !== p.productoId) {
            // Esa ficha ya vive en OTRO producto: no se mueve sola (le quitaría la ficha a ese producto). Se avisa y, si de verdad va aquí, se cambia a mano.
            toast.error(`«${f.name}» ya está en otro producto`, `Está en «${x.productoNombre || 'otro producto'}». Si también corresponde a este, súbela como texto o cambia el modelo de producto a mano.`);
          } else if (x.resultado === 'asignada' || x.resultado === 'ya_asignada') {
            if (x.productoCompraId !== p.productoId && x.opcionId) await post({ accion: 'mover_modelo', opcionId: x.opcionId, productoCompraId: p.productoId });
            asignadas++;
          } else if ((x.resultado === 'por_confirmar' || x.resultado === 'sin_producto') && r.extraccionId != null) {
            await post({ accion: 'asignar', extraccionId: r.extraccionId, productoIdx: x.idx, productoCompraId: p.productoId, proveedor: null });
            asignadas++;
          } else if (x.resultado === 'no_es_ficha' || x.resultado === 'sin_identificar') {
            toast.error(`«${f.name}» no parece una ficha de producto`, x.motivo || 'Sube la ficha técnica del fabricante.');
          }
        }
      }
      await cargar();
      if (asignadas > 0) { toast.info('Ficha agregada', 'Comparando con las bases…'); await comparar(p, true); toast.success('Comparación lista', 'Mira abajo qué ficha cumple más.'); }
    } catch (e: any) { toast.error('No se pudo agregar la ficha', e.message); }
    finally { setSubiendoA(null); }
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
  const complementar = async (o: OpcionFichaDTO, n: number, resultado: 'CUMPLE' | 'NO_CUMPLE' | null, dato: string, fuente: string, adjunto: AdjuntoComplemento) => {
    try { await enviarComplemento(negocioId, { opcionId: o.opcionId, n, resultado, dato, fuente, adjunto }); toast.success(resultado ? 'Complemento guardado' : 'Complemento quitado'); await cargar(); }
    catch (e: any) { toast.error('No se pudo guardar el complemento', e.message); throw e; }
  };
  const quitarFicha = async (o: OpcionFichaDTO, url: string) => {
    try { await post({ accion: 'quitar_ficha', opcionId: o.opcionId, url }); toast.success('Ficha quitada', 'Si quedaron otras fichas de este modelo, vuelve a comparar para que cuenten solo esas.'); await cargar(); }
    catch (e: any) { toast.error('No se pudo quitar la ficha', e.message); }
  };
  const quitarModelo = async (o: OpcionFichaDTO) => {
    try { await post({ accion: 'quitar_modelo', opcionId: o.opcionId }); await cargar(); } catch (e: any) { toast.error('No se pudo quitar', e.message); }
  };
  const restaurarModelo = async (opcionId: number) => {
    try { await post({ accion: 'restaurar_modelo', opcionId }); toast.success('Modelo restaurado', 'Vuelve a comparar para que cuente contra las bases.'); await cargar(); }
    catch (e: any) { toast.error('No se pudo restaurar', e.message); }
  };
  const mover = async (opcionId: number, productoCompraId: number) => {
    try { await post({ accion: 'mover_modelo', opcionId, productoCompraId }); toast.success('Modelo cambiado de producto', 'Vuelve a comparar para que cuente contra las bases del producto nuevo.');
      const nuevo = panel?.productos.find(x => x.productoId === productoCompraId);
      setCola(c => c.map(it => it.resultado ? { ...it, resultado: { ...it.resultado, productos: it.resultado.productos.map(x => x.opcionId === opcionId ? { ...x, productoCompraId, productoNombre: nuevo?.descripcion.slice(0, 80) ?? x.productoNombre } : x) } } : it));
      await cargar(); }
    catch (e: any) { toast.error('No se pudo cambiar de producto', e.message); }
  };
  const olvidar = async (extraccionId: number) => {
    try { await post({ accion: 'olvidar_documento', extraccionId }); await cargar(); } catch (e: any) { toast.error('No se pudo quitar de la lista', e.message); }
  };
  const asignar = async (extraccionId: number, idx: number, productoCompraId: number, proveedor: string, sinMarca = false) => {
    try { await post({ accion: 'asignar', extraccionId, productoIdx: idx, productoCompraId, proveedor: proveedor || null, sinMarca }); toast.success('Ficha asignada'); await cargar(); }
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
              <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700">Paso 1 · Sube las fichas</p>
              <p className="text-[13.5px] font-bold text-zinc-800">Arrastra aquí todas las fichas técnicas juntas</p>
              <p className="text-[12px] text-zinc-500">PDF, imagen, Word, Excel o texto (hasta 100). No hace falta decir de qué son: el sistema detecta solo el producto y el proveedor.</p>
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
                    {p.resultado === 'asignada' && puedeOperar && p.opcionId != null && panel && !(quitadas.has(p.opcionId)) && (
                      <span className="ml-2 inline-flex items-center gap-2">
                        <select value="" onChange={e => { if (e.target.value) void mover(p.opcionId!, Number(e.target.value)); }} className="text-[11.5px] border border-zinc-200 rounded-md px-1.5 py-0.5 bg-white max-w-[200px]" title="Cambiar a otro producto">
                          <option value="">Cambiar de producto…</option>
                          {panel.productos.filter(x => x.productoId !== p.productoCompraId).map(x => <option key={x.productoId} value={x.productoId}>{x.descripcion.slice(0, 60)}</option>)}
                        </select>
                        <button type="button" onClick={() => { setQuitadas(s => new Set(s).add(p.opcionId!)); void post({ accion: 'quitar_modelo', opcionId: p.opcionId }).then(cargar).catch((e: any) => toast.error('No se pudo quitar', e.message)); }} className="text-[11.5px] font-semibold text-zinc-400 hover:text-rose-700">Quitar</button>
                      </span>
                    )}
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
          {panel.noSonFichas.map((d, i) => <p key={i} className="text-[11.5px] text-zinc-500"><b className="text-zinc-700">{d.documento}</b> · {d.motivo}{d.url && <a href={d.url} target="_blank" rel="noreferrer" className="ml-2 font-semibold text-teal-700 hover:text-teal-900">Ver</a>}{puedeOperar && <button type="button" onClick={() => olvidar(d.extraccionId)} className="ml-2 font-semibold text-zinc-500 hover:text-rose-700">Quitar</button>}</p>)}
        </div>
      )}
      {panel.quitados.length > 0 && (
        <details className="rounded-xl border border-zinc-200 bg-zinc-50/60" data-testid="fichas-quitadas">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-zinc-600">Fichas de modelos quitados ({panel.quitados.length}): siguen guardadas, se pueden restaurar</summary>
          <div className="px-3 pb-2 space-y-1">
            {panel.quitados.map(q => (
              <p key={q.opcionId} className="text-[11.5px] text-zinc-500">
                <b className="text-zinc-700">{[q.marca, q.modelo].filter(Boolean).join(' ') || 'Modelo sin nombre'}</b> · {q.productoDescripcion}{q.proveedor ? ` · ${q.proveedor}` : ''} · {q.fichas.join(', ')}
                {puedeOperar && <button type="button" onClick={() => restaurarModelo(q.opcionId)} data-testid={`ficha-restaurar-${q.opcionId}`} className="ml-2 font-semibold text-teal-700 hover:text-teal-900">Restaurar</button>}
              </p>
            ))}
          </div>
        </details>
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
        <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700">Paso 2 · Revisa y compara con las bases</p>
        <div className="grid grid-cols-3 gap-2 my-2" data-testid="fichas-resumen">
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2"><p className="text-[22px] font-extrabold leading-none tabular-nums text-zinc-900">{conFicha.length}<span className="text-[13px] font-semibold text-zinc-400"> de {panel.productos.length}</span></p><p className="text-[12px] font-bold text-zinc-700 mt-1">Productos con ficha</p></div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"><p className="text-[22px] font-extrabold leading-none tabular-nums text-emerald-800">{cumplen}</p><p className="text-[12px] font-bold text-emerald-800 mt-1">Cumplen las bases</p></div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"><p className="text-[22px] font-extrabold leading-none tabular-nums text-rose-800">{noCumplen}</p><p className="text-[12px] font-bold text-rose-800 mt-1">No cumplen</p></div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <p className="text-[12.5px] text-zinc-500">Abre un producto para ver su ficha contra lo que piden las bases.</p>
          {puedeOperar && conFicha.length > 0 && (
            <button type="button" onClick={compararTodos} disabled={comparando.size > 0 || procesando} data-testid="fichas-comparar-todos"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3.5 py-2 rounded-lg">
              {comparando.size > 0 ? <Loader2 size={13} className="animate-spin" /> : <Chispa size={14} />} Comparar todos con las bases
            </button>
          )}
        </div>
        {puedeOperar && panel.productos.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap mb-2 text-[12.5px]" data-testid="fichas-seleccion">
            <label className="inline-flex items-center gap-1.5 text-zinc-600 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-amber-600" checked={marcados.size === panel.productos.length} onChange={e => setMarcados(e.target.checked ? new Set(panel.productos.map(x => x.productoId)) : new Set())} /> Marcar todos
            </label>
            {marcados.size > 0 && (
              <>
                <span className="text-zinc-500">{marcados.size} marcado(s)</span>
                <button type="button" onClick={() => setIncidenciaDe(panel.productos.filter(x => marcados.has(x.productoId)))} data-testid="fichas-incidencia-varios"
                  className="inline-flex items-center gap-1.5 font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg"><Alerta size={13} /> Crear incidencias de los marcados</button>
                <button type="button" onClick={() => setMarcados(new Set())} className="font-semibold text-zinc-500 hover:text-zinc-800">Quitar marcas</button>
              </>
            )}
          </div>
        )}
        <div className="space-y-2">
          {panel.productos.map(p => {
            const est = estadoProducto(p);
            const abierta = abiertas.has(p.productoId);
            const conFichas = opcionesDeCompra(p).filter(o => o.fichas.length > 0);
            return (
              <div key={p.productoId} className="rounded-xl border border-zinc-200 bg-white overflow-hidden" data-testid={`ficha-producto-${p.productoId}`}>
                <div className="px-3 py-2.5 flex items-center gap-3 flex-wrap">
                  {puedeOperar && <input type="checkbox" checked={marcados.has(p.productoId)} onChange={e => setMarcados(s => { const n = new Set(s); if (e.target.checked) n.add(p.productoId); else n.delete(p.productoId); return n; })} aria-label={`Marcar ${p.descripcion}`} data-testid={`ficha-marcar-${p.productoId}`} className="w-4 h-4 accent-amber-600 flex-shrink-0" />}
                  <button type="button" onClick={() => setAbiertas(s => { const n = new Set(s); if (n.has(p.productoId)) n.delete(p.productoId); else n.add(p.productoId); return n; })} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <Chevron size={16} className={`text-zinc-400 transition-transform flex-shrink-0 ${abierta ? 'rotate-180' : ''}`} />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-bold text-zinc-900 truncate">{p.descripcion} <span className="font-normal text-zinc-400">· {p.cantidad ?? '?'} un.</span></span>
                      <span className="block text-[11.5px] text-zinc-500 truncate">
                        {p.cotizados.length ? `Cotizado por ${p.cotizados.map(c => c.proveedor).join(', ')}` : 'Sin cotización todavía'}
                        {conFichas.length ? ` · con ficha (${conFichas.reduce((n, o) => n + o.fichas.length, 0)})` : ' · sin ficha'}
                        {(() => { const ajenas = p.opciones.filter(o => !opcionesDeCompra(p).includes(o) && o.fichas.length > 0); return ajenas.length ? ` · ${ajenas.length} ficha(s) de un proveedor que no cotizó: revisa el proveedor` : ''; })()}
                      </span>
                    </span>
                  </button>
                  <div className="w-64 flex-shrink-0"><LinksProducto links={linksCosteo[p.productoId]?.links} /></div>
                  {est ? <Insignia estado={est} /> : <span className="text-[11px] font-semibold text-zinc-400">sin ficha</span>}
                  {puedeOperar && (
                    <button type="button" onClick={() => { setDestino(p); subirRef.current?.click(); }} disabled={subiendoA === p.productoId} data-testid={`ficha-subir-${p.productoId}`}
                      title="Sube otra ficha técnica de este producto: se compara con las bases y se muestra cuál cumple más."
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                      {subiendoA === p.productoId ? <Loader2 size={12} className="animate-spin" /> : <Upload size={13} />} {conFichas.length > 0 ? 'Subir otra ficha' : 'Subir ficha'}
                    </button>
                  )}
                  {puedeOperar && (
                    <button type="button" onClick={() => setIncidenciaDe([p])} data-testid={`ficha-incidencia-${p.productoId}`}
                      title="Levanta una o más incidencias de este ítem: quedan como tareas de la licitación y se avisa a los encargados."
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 border border-amber-200 hover:bg-amber-50 px-3 py-1.5 rounded-lg">
                      <Alerta size={13} /> Incidencias
                    </button>
                  )}
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
                      // La tabla de comparación ya trae cada requisito de las bases: con comparación no se repite la lista de arriba.
                      const hayComparacion = relevantes.some(o => !o.tecnico.sinFicha && !!o.tecnico.resumen && o.tecnico.filas.length > 0);
                      return (
                        <>
                          {!hayComparacion && <div className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2.5" data-testid={`bases-${p.productoId}`}>
                            <p className="text-[12px] font-bold text-teal-900">Lo que piden las bases para este producto{p.requisitosBase.length > 0 ? ` (${p.requisitosBase.length})` : ''}</p>
                            {p.requisitosBase.length === 0
                              ? <p className="text-[12px] text-zinc-500 mt-1">No hay requisitos técnicos de las bases cargados para este producto.</p>
                              : (
                                <ol className="mt-1.5 space-y-1">
                                  {p.requisitosBase.map(r => (
                                    <li key={r.n} className="flex gap-2 text-[12.5px] text-zinc-800 leading-snug">
                                      <span className="text-zinc-400 tabular-nums w-5 text-right flex-shrink-0">{r.n}.</span>
                                      <span>{r.texto}</span>
                                    </li>
                                  ))}
                                </ol>
                              )}
                          </div>}
                          <RankingFichas opciones={relevantes} />
                          {relevantes.length === 0 &&<p className="text-[12.5px] text-zinc-500">Todavía no hay fichas ni opciones de los proveedores cotizados. Sube la ficha del modelo que se va a comprar.</p>}
                          {relevantes.map(o => <OpcionFila key={o.opcionId} o={o} cotizados={nombres} puedeOperar={puedeOperar} onProveedor={cambiarProveedor} onQuitar={quitarModelo} onQuitarFicha={quitarFicha} onComplementar={complementar} onMover={(op, pid) => mover(op.opcionId, pid)} productosDestino={panel.productos.filter(x => x.productoId !== p.productoId)} />)}
                          {otras.length > 0 && (
                            <details open={otras.some(o => o.fichas.length > 0)} className="rounded-lg border border-zinc-200 bg-white">
                              <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-zinc-500 hover:text-zinc-800">Modelos con proveedor que no cotizó este producto ({otras.length}): no cuentan como lo que se compra hasta que cambies el proveedor</summary>
                              <div className="p-2 space-y-2">{otras.map(o => <OpcionFila key={o.opcionId} o={o} cotizados={nombres} puedeOperar={puedeOperar} onProveedor={cambiarProveedor} onQuitar={quitarModelo} onQuitarFicha={quitarFicha} onComplementar={complementar} onMover={(op, pid) => mover(op.opcionId, pid)} productosDestino={panel.productos.filter(x => x.productoId !== p.productoId)} />)}</div>
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
      <p className="text-[11.5px] text-zinc-400">Solo la ficha técnica sirve para juzgar si un producto cumple, no la cotización. Aquí solo cuentan las fichas subidas en este paso; no modifican las del Auditor.</p>

      <input ref={subirRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.md,.csv" data-testid="ficha-input-producto"
        onChange={e => { const fl = e.target.files ? Array.from(e.target.files) : []; const d = destino; e.target.value = ''; if (fl.length && d) void subirParaProducto(d, fl); }} />
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
      <IncidenciaFichaModal negocioId={negocioId} productos={incidenciaDe} onClose={() => setIncidenciaDe([])} onCreada={() => { setIncidenciaDe([]); setMarcados(new Set()); void recargarCompras(); }} />

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
  onAsignar: (extraccionId: number, idx: number, productoCompraId: number, proveedor: string, sinMarca?: boolean) => Promise<void>;
  onDescartar: (extraccionId: number) => Promise<void>;
}) {
  const [producto, setProducto] = useState<number>(f.sugerencia?.productoCompraId ?? 0);
  const [proveedor, setProveedor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cotizados = panel.productos.find(p => p.productoId === producto)?.cotizados.map(c => c.proveedor) ?? [];
  return (
    <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12.5px] space-y-1.5">
      <p className="text-zinc-800"><b>{[f.marca, f.modelo].filter(Boolean).join(' ') || f.nombre}</b> <span className="text-zinc-400">· {f.documento}</span>{f.url && <a href={f.url} target="_blank" rel="noreferrer" className="ml-2 text-[11.5px] font-semibold text-teal-700 hover:text-teal-900">Ver</a>}</p>
      {f.sinMarca && <p className="text-[11.5px] text-amber-800">No trae marca ni modelo: si es la ficha del producto que se va a comprar, asígnala igual (el nombre hará de modelo). Si es la propuesta técnica de la oferta, descártala.</p>}
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
          <button type="button" disabled={!producto || enviando} onClick={async () => { setEnviando(true); await onAsignar(f.extraccionId, f.idx, producto, proveedor, f.sinMarca); setEnviando(false); }}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {enviando && <Loader2 size={12} className="animate-spin" />} Asignar
          </button>
          <button type="button" onClick={() => onDescartar(f.extraccionId)} className="text-[12px] font-semibold text-zinc-500 hover:text-rose-700">Descartar</button>
        </div>
      )}
    </div>
  );
}

export type AdjuntoComplemento = { archivo: File | null; quitar: boolean };
const FORMATOS_ADJUNTO = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv';

/** Guarda un complemento; con archivo adjunto viaja como multipart (se sube a R2), sin él como JSON. Avisa a los demás paneles. */
export async function enviarComplemento(negocioId: number, p: { opcionId: number; n: number; resultado: 'CUMPLE' | 'NO_CUMPLE' | null; dato: string; fuente: string; adjunto?: AdjuntoComplemento }): Promise<void> {
  const { adjunto, ...campos } = p;
  let res: Response;
  if (adjunto?.archivo) {
    const fd = new FormData();
    fd.set('accion', 'complementar'); fd.set('file', adjunto.archivo);
    fd.set('opcionId', String(campos.opcionId)); fd.set('n', String(campos.n)); fd.set('resultado', campos.resultado ?? ''); fd.set('dato', campos.dato); fd.set('fuente', campos.fuente);
    res = await fetch(`/api/compras/${negocioId}/fichas`, { method: 'POST', body: fd });
  } else {
    res = await fetch(`/api/compras/${negocioId}/fichas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'complementar', ...campos, quitarAdjunto: !!adjunto?.quitar }) });
  }
  const d = await res.json();
  if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo completar');
  window.dispatchEvent(new Event('compras:fichas-cambio'));
}

const FUENTES = ['Llamada o correo con el proveedor', 'Manual o ficha del fabricante', 'Otro documento', 'Verificado en terreno', 'Otra'];

/** Aporta el dato que faltaba y decide si cumple. Queda registrado quién lo hizo. */
function ComplementoForm({ f, onGuardar, onCancelar }: { f: FilaRequisito; onGuardar: (resultado: 'CUMPLE' | 'NO_CUMPLE' | null, dato: string, fuente: string, adjunto: AdjuntoComplemento) => Promise<void>; onCancelar: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [quitarActual, setQuitarActual] = useState(false);
  const adjuntoRef = useRef<HTMLInputElement>(null);
  const actual = f.complemento?.adjuntoUrl && !quitarActual ? f.complemento : null;
  const [dato, setDato] = useState(f.complemento?.dato ?? '');
  const [fuente, setFuente] = useState(f.complemento?.fuente ?? FUENTES[0]);
  const [resultado, setResultado] = useState<'CUMPLE' | 'NO_CUMPLE' | ''>(f.complemento?.resultado ?? '');
  const [guardando, setGuardando] = useState(false);
  const enviar = async (r: 'CUMPLE' | 'NO_CUMPLE' | null) => { setGuardando(true); try { await onGuardar(r, dato, fuente, { archivo, quitar: quitarActual }); } catch { /* el aviso ya se mostró */ } setGuardando(false); };
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
      <div className="flex items-center gap-2 flex-wrap" data-testid={`complemento-adjunto-${f.n}`}>
        <button type="button" onClick={() => adjuntoRef.current?.click()} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-2.5 py-1 rounded-lg"><Upload size={12} /> {archivo || actual ? 'Cambiar adjunto' : 'Adjuntar documento o imagen'}</button>
        <input ref={adjuntoRef} type="file" accept={FORMATOS_ADJUNTO} className="hidden" onChange={e => { const x = e.target.files?.[0]; if (x) { setArchivo(x); setQuitarActual(false); } e.target.value = ''; }} />
        {archivo && <span className="text-[11.5px] text-zinc-700">{archivo.name} <button type="button" onClick={() => setArchivo(null)} className="text-zinc-400 hover:text-rose-700" aria-label="Quitar adjunto nuevo">✕</button></span>}
        {!archivo && actual && <span className="text-[11.5px] text-zinc-700">{actual.adjuntoNombre} <button type="button" onClick={() => setQuitarActual(true)} className="text-zinc-400 hover:text-rose-700" aria-label="Quitar adjunto">✕</button></span>}
        <span className="text-[11px] text-zinc-400">PDF, imagen, Word, Excel o texto (máx. 15 MB). Respalda el dato y se ve en esta misma fila.</span>
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

/** Puntaje de una ficha: proporción de requisitos de las bases que cumple (null si todavía no se comparó). */
const puntajeDe = (o: OpcionFichaDTO): number | null => (o.fichas.length > 0 && o.tecnico.resumen && o.tecnico.resumen.total > 0 ? o.tecnico.resumen.cumple / o.tecnico.resumen.total : null);
const nombreOpcion = (o: OpcionFichaDTO) => [o.marca, o.modelo].filter(Boolean).join(' ') || 'Modelo sin nombre';

/** «¿Qué ficha cumple más?»: ordena las fichas comparadas de un producto por requisitos cumplidos y marca la mejor. */
function RankingFichas({ opciones }: { opciones: OpcionFichaDTO[] }) {
  const comparadas = opciones.filter(o => puntajeDe(o) != null).sort((a, b) => (puntajeDe(b) ?? 0) - (puntajeDe(a) ?? 0) || (a.tecnico.resumen?.noCumple ?? 0) - (b.tecnico.resumen?.noCumple ?? 0));
  if (comparadas.length === 0) return null;
  const top = puntajeDe(comparadas[0])!;
  const empatan = comparadas.filter(o => puntajeDe(o) === top && (o.tecnico.resumen?.noCumple ?? 0) === (comparadas[0].tecnico.resumen?.noCumple ?? 0));
  const ganadora = empatan.length === 1 ? comparadas[0] : null;
  const ningunaCumple = !comparadas.some(o => o.tecnico.estado === 'CUMPLE');
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 px-3 py-2.5" data-testid="ranking-fichas">
      <p className="text-[12.5px] font-bold text-indigo-900">
        {comparadas.length === 1 ? 'Resultado de la ficha' : ganadora ? `La ficha que más cumple: ${nombreOpcion(ganadora)}` : `Empatan: ${empatan.map(nombreOpcion).join(' y ')}`}
      </p>
      {ningunaCumple && <p className="text-[11.5px] text-amber-800 mt-0.5">Ninguna ficha cumple todas las bases todavía{comparadas.length === 1 ? '' : ': la de arriba es la más cercana'}. Sube otra ficha o completa los datos que faltan.</p>}
      <ol className="mt-1.5 space-y-1">
        {comparadas.map((o, i) => {
          const r = o.tecnico.resumen!;
          const pct = Math.round((puntajeDe(o) ?? 0) * 100);
          const mejor = ganadora?.opcionId === o.opcionId;
          return (
            <li key={o.opcionId} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-5 text-right tabular-nums text-zinc-400">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate"><b className="text-zinc-900">{nombreOpcion(o)}</b>{o.proveedor ? <span className="text-zinc-500"> · {o.proveedor}</span> : null}{mejor && <span className="ml-1.5 text-[10.5px] font-bold text-amber-700">★ Mejor</span>}</span>
              <span className="w-28 h-2 rounded-full bg-zinc-200 overflow-hidden flex-shrink-0" role="img" aria-label={`${pct} % de los requisitos cumplen`}><span className={`block h-full ${pct === 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${pct}%` }} /></span>
              <span className="w-32 text-right tabular-nums text-zinc-700 flex-shrink-0">{r.cumple} de {r.total} cumplen</span>
              <Insignia estado={o.tecnico.estado} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function OpcionFila({ o, cotizados, puedeOperar, onProveedor, onQuitar, onQuitarFicha, onComplementar, onMover, productosDestino }: {
  o: OpcionFichaDTO; cotizados: string[]; puedeOperar: boolean; onProveedor: (o: OpcionFichaDTO, proveedor: string) => Promise<void>; onQuitar: (o: OpcionFichaDTO) => Promise<void>; onQuitarFicha?: (o: OpcionFichaDTO, url: string) => Promise<void>;
  onComplementar: (o: OpcionFichaDTO, n: number, resultado: 'CUMPLE' | 'NO_CUMPLE' | null, dato: string, fuente: string, adjunto: AdjuntoComplemento) => Promise<void>;
  onMover?: (o: OpcionFichaDTO, productoCompraId: number) => Promise<void>; productosDestino?: Array<{ productoId: number; descripcion: string }>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [fichaPorQuitar, setFichaPorQuitar] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [verAdjunto, setVerAdjunto] = useState<VisorDoc | null>(null);
  const t = o.tecnico;
  const sinFicha = o.fichas.length === 0;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="px-3 py-2 flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-zinc-800">{[o.marca, o.modelo].filter(Boolean).join(' ') || 'Opción sin marca ni modelo'}</p>
          <p className="text-[11.5px] text-zinc-500">
            {sinFicha ? <span className="text-amber-700 font-semibold">Falta la ficha técnica de este modelo</span> : o.fichas.map((f, i) => (
              <span key={i}>{i > 0 && ' · '}{f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{f.nombre}</a> : f.nombre}
                {puedeOperar && f.url && onQuitarFicha && (fichaPorQuitar === f.url
                  ? <span className="ml-1 text-[11px] text-zinc-600">¿Quitar esta ficha? <button type="button" onClick={() => { setFichaPorQuitar(null); void onQuitarFicha(o, f.url!); }} className="font-bold text-rose-700 hover:text-rose-900">Sí</button> · <button type="button" onClick={() => setFichaPorQuitar(null)} className="font-semibold text-zinc-500">No</button></span>
                  : <button type="button" onClick={() => setFichaPorQuitar(f.url)} title="Quitar solo esta ficha (por ejemplo si subiste la equivocada). El modelo y sus otras fichas siguen." className="ml-1 text-zinc-400 hover:text-rose-700">✕</button>)}
              </span>
            ))}
          </p>
        </div>
        {puedeOperar ? (
          <select value={o.proveedor || ''} onChange={e => onProveedor(o, e.target.value)} className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 bg-white max-w-[220px]" title="Proveedor de este modelo">
            <option value="">Proveedor por elegir</option>
            {[...new Set([...(o.proveedor ? [o.proveedor] : []), ...cotizados])].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : <span className="text-[12px] text-zinc-600">{o.proveedor || 'Proveedor por elegir'}</span>}
        {puedeOperar && onMover && productosDestino && productosDestino.length > 0 && (
          <select value="" onChange={e => { if (e.target.value) void onMover(o, Number(e.target.value)); }} className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 bg-white max-w-[200px]" title="Si la ficha quedó en el producto equivocado, cámbiala">
            <option value="">Cambiar de producto…</option>
            {productosDestino.map(x => <option key={x.productoId} value={x.productoId}>{x.descripcion.slice(0, 60)}</option>)}
          </select>
        )}
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
                  const sinDato = f.estadoIA === 'FALTA_DATO' || f.estadoIA === 'SIN_VEREDICTO' || f.estadoIA === 'NO_CUMPLE';
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
                          {f.complemento?.adjuntoUrl && (
                            <button type="button" onClick={() => setVerAdjunto({ nombre: f.complemento!.adjuntoNombre || 'Adjunto', url: f.complemento!.adjuntoUrl! })} data-testid={`ver-adjunto-${o.opcionId}-${f.n}`}
                              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline"><Eye size={12} /> Ver adjunto: {f.complemento.adjuntoNombre || 'documento'}</button>
                          )}
                        </td>
                      </tr>
                      {editando === f.n && (
                        <tr className="bg-indigo-50/40">
                          <td colSpan={4} className="px-2 py-2">
                            <ComplementoForm f={f} onCancelar={() => setEditando(null)}
                              onGuardar={async (resultado, dato, fuente, adjunto) => { await onComplementar(o, f.n, resultado, dato, fuente, adjunto); setEditando(null); }} />
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
      <DocumentViewerModal doc={verAdjunto} onClose={() => setVerAdjunto(null)} />
    </div>
  );
}
