'use client';

// COTIZACIONES RECIBIDAS, DENSAS: una fila de ~44 px por cotización (proveedor, qué cubre, total, vigencia, avisos, acciones en íconos);
// el detalle (documento, quién la subió, plazo, chips completos, líneas sin asignar) se abre con la flecha. Con muchas cotizaciones
// hay buscador, scroll propio y encabezado fijo. Columnas por ancho del panel (@3xl), no de la pantalla.
import { useState } from 'react';
import { MenuAcciones } from '@/app/components/ui/MenuAcciones';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { lineasDesdeTabla, lineasSinAsignar, type LineaCotizacion } from '@/app/lib/compras-cotizacion-lineas';
import { adicionalesDesdeIA } from '@/app/lib/compras-adicionales-ia';
import { useToast } from '@/app/components/ui/toast';
import { IconEye as Eye, IconListCheck as ListChecks, IconSparkles as Sparkles, IconPencil as Pencil, IconTrash as Trash, IconLoader2 as Loader2, IconAlertTriangle as Alerta, IconChevronRight as Flecha, IconCheck as Check, IconFileText as Doc } from '@tabler/icons-react';

export interface CotizacionFilaUI {
  id: number; proveedorNombre: string; proveedorRut: string | null; proveedorNuevo: boolean | null; origen: string;
  precioUnitario: number | null; precioTotalClp?: number | null; precioUnitarioBruto: number | null; descuentoPct: number | null; moneda: string;
  plazoEntregaTexto: string | null; vigenciaAt?: string | null; archivoUrl: string | null; homologadaAt: string | null;
  registradoPorNombre?: string | null; registradoAt?: string | null; archivoNombre?: string | null;
  /** Flete cobrado aparte (neto): se suma al total y se detalla. */
  fleteMonto?: number | null;
  /** Texto del documento (trae la tabla «LÍNEAS DEL DOCUMENTO»): de ahí salen las líneas que no quedaron en ningún producto. */
  descripcionLibre?: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null; precioBase?: number | null; adicionales: unknown[] }>;
}

interface AdicionalFila { concepto: string; cantidad: number; precioUnitario: number }

/** Líneas del documento que no calzan con ningún producto asignado ni adicional. Con flete aparte ya cargado, su línea de flete no se ofrece (se suma sola). */
export function lineasPendientes(c: Pick<CotizacionFilaUI, 'moneda' | 'descripcionLibre' | 'fleteMonto' | 'items'>, productos: Array<{ id: number; descripcion: string }>): LineaCotizacion[] {
  if (c.moneda !== 'CLP') return [];
  const lineas = lineasDesdeTabla(String(c.descripcionLibre || ''));
  if (!lineas.length) return [];
  const asignados = [
    // Descripción COMPLETA del producto: cortar en « - » dejaba fuera «vertical extra reforzado 15.000L» y la línea del propio estanque
    // salía como «sin asignar» (2906-19-LE26: al agregarla se sumó el estanque dos veces).
    ...c.items.flatMap(i => { const d = String(productos.find(p => p.id === i.productoId)?.descripcion ?? ''); return [d, d.split(' - ')[0]]; }),
  ];
  // Cada adicional tapa UNA sola línea (la de su mismo precio si hay varias parecidas): por nombre, «ACOPLE RAPIDO DE BOLA … AHNPROC»
  // escondía también «ACOPLE RAPIDO MACHO … AHNPROC» y no se podía agregar (979, cotización AHN 9853).
  const tapadas = new Set<LineaCotizacion>();
  for (const a of c.items.flatMap(i => i.adicionales as AdicionalFila[])) {
    const parecidas = lineas.filter(l => !tapadas.has(l) && lineasSinAsignar([l], [String(a.concepto)]).length === 0);
    const l = parecidas.find(x => x.precioUnitario != null && Math.abs(x.precioUnitario - Number(a.precioUnitario)) <= 1) ?? parecidas[0];
    if (l) tapadas.add(l);
  }
  const fleteAparte = c.fleteMonto != null && c.fleteMonto > 0;
  return lineasSinAsignar(lineas.filter(l => !tapadas.has(l)), asignados)
    .filter(l => !(fleteAparte && /flete|transport|despacho|env[ií]o/i.test(l.descripcion)))
    // Segunda red: una línea con el mismo precio unitario que el producto ya asignado es ese producto, aunque el nombre difiera.
    .filter(l => !(l.precioUnitario != null && c.items.some(i => i.precioBase != null && Math.abs(i.precioBase - l.precioUnitario!) <= 1)));
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const corto = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n).trim()}…` : t);
const hoy = () => new Date().toISOString().slice(0, 10);
/** Nombre legible del archivo subido (la URL trae un prefijo numérico de subida). Conserva la extensión: el visor la usa para elegir cómo mostrarlo. */
const nombreDeArchivo = (url: string) => { try { return decodeURIComponent(url.split('?')[0].split('/').pop() || 'cotizacion').replace(/^\d+_/, ''); } catch { return 'cotizacion'; } };
const fmtFecha = (ymd: string) => `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;

/** Agrega UNA línea del documento como adicional del producto en esa cotización. El PUT reemplaza la lista del producto: se manda lo
 *  que ya tenía + la nueva. La usan la lista de cotizaciones y la lista de opciones de cada producto (`ComparadorPrecios`). */
export async function agregarLineaComoAdicional(
  negocioId: number, c: Pick<CotizacionFilaUI, 'id' | 'items'>, l: LineaCotizacion, productoId: number,
  productos: Array<{ id: number; cantidad?: number | string | null }>,
): Promise<void> {
  const prod = productos.find(p => p.id === productoId);
  const item = c.items.find(i => i.productoId === productoId);
  const cantProd = prod?.cantidad != null && Number(prod.cantidad) > 0 ? Number(prod.cantidad) : null;
  const nuevos = l.precioUnitario == null || l.cantidad == null ? []
    : adicionalesDesdeIA([{ concepto: l.descripcion, cantidadLinea: l.cantidad, precioUnitario: l.precioUnitario }], cantProd, n => n);
  if (!nuevos.length) throw new Error('La línea no trae cantidad o precio válidos.');
  const previos = ((item?.adicionales ?? []) as AdicionalFila[]).map(a => ({ concepto: a.concepto, cantidad: a.cantidad, precioUnitario: a.precioUnitario }));
  const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${c.id}/adicionales`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId, adicionales: [...previos, ...nuevos] }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo agregar');
}

export function ListaCotizaciones({ negocioId, cotizaciones, productos, avisosPorCotizacion, origenLabel, puedeOperar, homologandoId, onAsignar, onHomologar, onEditar, onEliminar, onCambio }: {
  negocioId?: number;
  cotizaciones: CotizacionFilaUI[]; productos: Array<{ id: number; descripcion: string; cantidad?: number | string | null; esServicio?: boolean }>;
  avisosPorCotizacion: Record<number, number>; origenLabel: Record<string, string>; puedeOperar: boolean; homologandoId: number | null;
  onAsignar: (id: number) => void; onHomologar: (id: number) => void; onEditar: (id: number) => void; onEliminar: (id: number) => void;
  /** Recarga la lista tras agregar una línea como adicional. Sin esto (o sin negocioId) no se ofrece agregar. */
  onCambio?: () => Promise<void>;
}) {
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const toast = useToast();
  const [ignoradas, setIgnoradas] = useState<Set<string>>(new Set());   // «cotizaciónId|descripción»: solo de esta vista
  const [destino, setDestino] = useState<Record<string, number>>({});   // línea → producto elegido (si la cotización cubre varios)
  const [agregando, setAgregando] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<number>>(new Set());   // filas con el detalle desplegado
  const [filtro, setFiltro] = useState('');

  const agregar = async (c: CotizacionFilaUI, l: LineaCotizacion, productoId: number) => {
    if (negocioId == null || l.precioUnitario == null || l.cantidad == null) return;
    setAgregando(`${c.id}|${l.descripcion}`);
    try {
      await agregarLineaComoAdicional(negocioId, c, l, productoId, productos);
      toast.success('Línea agregada', `«${l.descripcion.slice(0, 50)}» se suma al precio de ese producto.`);
      await onCambio?.();
    } catch (e: any) {
      toast.error('No se pudo agregar la línea', e.message);
    } finally { setAgregando(null); }
  };
  if (cotizaciones.length === 0) return null;
  const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) && n > 0 ? n : 1; };
  const h = hoy();
  const alternar = (id: number) => setAbiertas(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Todas las cotizaciones con documento, juntas: el visor las muestra con lista lateral y ‹ ›.
  const docsTodos: VisorDoc[] = cotizaciones.filter(c => c.archivoUrl).map(c => ({
    nombre: c.archivoNombre || nombreDeArchivo(c.archivoUrl!), url: c.archivoUrl!, titulo: c.proveedorNombre,
    detalle: `#${c.id}${c.registradoAt ? ` · ${fmtFecha(c.registradoAt.slice(0, 10))}` : ''} · ${c.archivoNombre || nombreDeArchivo(c.archivoUrl!)}`,
  }));
  const q = filtro.trim().toLowerCase();
  const visibles = q
    ? cotizaciones.filter(c => `${c.proveedorNombre} ${c.proveedorRut ?? ''} ${c.items.map(i => productos.find(p => p.id === i.productoId)?.descripcion ?? '').join(' ')}`.toLowerCase().includes(q))
    : cotizaciones;
  // Una sola plantilla de columnas para encabezado y filas (denso: ~44 px por fila; el detalle se abre con la flecha).
  const COLS = 'grid-cols-[minmax(0,1fr)_auto_auto] @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_96px_92px_40px_108px_84px]';
  return (
    <div className="@container border-t border-zinc-100">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-zinc-100">
          {cotizaciones.length > 6 && <><input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar proveedor, RUT o producto…" aria-label="Buscar cotización"
            className="w-full max-w-xs text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <span className="text-[11.5px] text-zinc-400 tabular-nums whitespace-nowrap">{visibles.length} de {cotizaciones.length}</span></>}
          {docsTodos.length > 0 && (
            <button type="button" onClick={() => setVisor(docsTodos[0])} data-testid="cotizaciones-ver-todas"
              className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 hover:text-teal-900 hover:bg-teal-50 border border-teal-200 rounded-md px-2.5 py-1 whitespace-nowrap">
              <Doc size={14} /> Ver todas las cotizaciones ({docsTodos.length})
            </button>
          )}
        </div>
      <div className="max-h-[560px] overflow-y-auto">
        <div className={`hidden @3xl:grid ${COLS} gap-x-3 px-3 py-1.5 sticky top-0 z-10 bg-white border-b border-zinc-200 text-[11px] font-medium text-zinc-500`}>
          <span className="pl-6">Proveedor</span><span>Qué cubre</span><span className="text-right">Total</span><span>Vigencia</span><span className="text-center">Avisos</span><span>Cotización</span><span />
        </div>
        {visibles.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-zinc-400">Ninguna cotización calza con la búsqueda.</p>}
        {visibles.map(c => {
          const cubiertos = productos.filter(p => c.items.some(i => i.productoId === p.id));
          const suma = productos.reduce((s, p) => { const it = c.items.find(i => i.productoId === p.id); return s + (it?.precioUnitario != null ? it.precioUnitario * num(p.cantidad) : 0); }, 0);
          // El unitario lleva centavos (52.597 − 7 % = 48.915,21; × 250 = …802,5): si la cotización cubre un solo producto y su total impreso difiere
          // en menos de un peso, se muestra el impreso (el proveedor redondea el descuento, no el unitario).
          const subtotal = cubiertos.length === 1 && c.precioTotalClp != null && Math.abs(suma - c.precioTotalClp) < 1 ? c.precioTotalClp : suma;
          const flete = subtotal > 0 && c.fleteMonto != null && c.fleteMonto > 0 ? c.fleteMonto : 0;
          const total = subtotal + flete;
          const pendientes = lineasPendientes(c, productos).filter(l => !ignoradas.has(`${c.id}|${l.descripcion}`));
          const vencida = c.vigenciaAt != null && c.vigenciaAt < h;
          const avisos = avisosPorCotizacion[c.id] ?? 0;
          const abierta = abiertas.has(c.id);
          const primero = cubiertos[0];
          const itPrimero = primero ? c.items.find(i => i.productoId === primero.id) : undefined;
          const precioPrimero = itPrimero ? (itPrimero.precioBase === 0 && !itPrimero.adicionales.length ? 'incluido' : itPrimero.precioUnitario != null ? clp(itPrimero.precioUnitario) : 'sin precio') : '';
          const resumenCubre = cubiertos.length === 0
            ? <span className="text-amber-600">Sin asignar a ningún producto</span>
            : <><span className="text-zinc-600" title={cubiertos.map(p => p.descripcion).join('\n')}>{corto(primero.descripcion, 34)}</span> <b className="font-semibold text-zinc-900 tabular-nums">{precioPrimero}</b>{cubiertos.length > 1 && <span className="text-zinc-400"> +{cubiertos.length - 1} más</span>}</>;
          return (
            <div key={c.id} className="border-b border-zinc-100 last:border-0">
              <div className={`grid ${COLS} items-center gap-x-3 px-3 py-1.5 hover:bg-zinc-50/70`}>
                <button type="button" onClick={() => alternar(c.id)} aria-expanded={abierta} title={abierta ? 'Ocultar el detalle' : 'Ver el detalle'} data-testid={`cotizacion-fila-${c.id}`}
                  className="flex items-center gap-1.5 min-w-0 text-left">
                  <Flecha size={14} className={`flex-shrink-0 text-zinc-400 transition-transform ${abierta ? 'rotate-90' : ''}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-zinc-900 truncate leading-tight">{c.proveedorNombre}{c.proveedorNuevo != null && <span className="ml-1.5 text-[10px] font-medium text-zinc-400">{c.proveedorNuevo ? 'nuevo' : 'antiguo'}</span>}</span>
                    <span className="block text-[11px] text-zinc-400 truncate leading-tight">#{c.id} · {origenLabel[c.origen] ?? c.origen}{c.proveedorRut ? ` · ${c.proveedorRut}` : ''}</span>
                    <span className="block @3xl:hidden text-[11.5px] truncate leading-tight mt-0.5">{resumenCubre}</span>
                  </span>
                </button>
                <div className="hidden @3xl:block min-w-0 text-[12px] truncate">
                  {resumenCubre}
                  {pendientes.length > 0 && <span className="ml-2 text-amber-700 font-medium" title="El documento trae líneas que no están en ningún producto">⚠ {pendientes.length} sin asignar</span>}
                </div>
                <div className="text-right text-[13px] font-semibold text-zinc-900 tabular-nums whitespace-nowrap">{total > 0 ? clp(total) : <span className="text-zinc-300">—</span>}</div>
                <div title={vencida ? 'Vencida' : undefined} className={`hidden @3xl:block text-[12px] tabular-nums whitespace-nowrap ${vencida ? 'font-semibold text-rose-600' : 'text-zinc-600'}`}>{c.vigenciaAt ? fmtFecha(c.vigenciaAt) : <span className="text-zinc-300">—</span>}</div>
                <div className="hidden @3xl:flex justify-center text-[12px]">{avisos > 0 ? <span className="inline-flex items-center gap-0.5 font-semibold text-rose-600" title={`${avisos} aviso${avisos === 1 ? '' : 's'}`}><Alerta size={13} />{avisos}</span> : <span className="text-emerald-500" title="Sin avisos"><Check size={14} /></span>}</div>
                <div className="hidden @3xl:flex items-center">
                  {c.archivoUrl
                    ? <button type="button" onClick={() => setVisor(docsTodos.find(d => d.url === c.archivoUrl) ?? { nombre: nombreDeArchivo(c.archivoUrl!), url: c.archivoUrl! })} title="Abrir la cotización que se subió" data-testid={`cotizacion-ver-${c.id}`}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:text-teal-900 hover:bg-teal-50 border border-teal-200 rounded-md px-2 py-1 whitespace-nowrap"><Doc size={14} /> Ver cotización</button>
                    : <span className="text-[11px] text-zinc-400" title="Cargada a mano, sin documento">sin archivo</span>}
                </div>
                <div className="flex items-center justify-end gap-0.5">
                  {avisos > 0 && <span className="@3xl:hidden inline-flex items-center gap-0.5 text-[12px] font-semibold text-rose-600 mr-1"><Alerta size={13} />{avisos}</span>}
                  {puedeOperar && <>
                    {c.archivoUrl && <button type="button" onClick={() => setVisor(docsTodos.find(d => d.url === c.archivoUrl) ?? { nombre: nombreDeArchivo(c.archivoUrl!), url: c.archivoUrl! })} title="Abrir la cotización que se subió" aria-label="Ver cotización"
                      className="@3xl:hidden inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 mr-1"><Doc size={13} /> Ver</button>}
                    <button type="button" onClick={() => onAsignar(c.id)} title="Asignar a productos" aria-label="Asignar a productos" className="p-1.5 rounded-md text-teal-700 hover:text-teal-900 hover:bg-teal-50"><ListChecks size={15} /></button>
                    <MenuAcciones texto="Más" acciones={[
                      { label: homologandoId === c.id ? 'Leyendo con IA…' : c.homologadaAt ? 'Volver a leer con IA' : 'Leer con IA', onClick: () => onHomologar(c.id), disabled: homologandoId === c.id },
                      { label: 'Editar datos', onClick: () => onEditar(c.id) },
                      { label: 'Eliminar cotización', onClick: () => onEliminar(c.id), peligro: true },
                    ]} />
                  </>}
                </div>
              </div>

              {abierta && (
                <div className="px-3 pb-3 pl-[34px] bg-zinc-50/60 space-y-2.5 text-[12px]">
                  <dl className="grid grid-cols-2 @3xl:grid-cols-4 gap-x-6 gap-y-2 pt-2">
                    <div className="min-w-0"><dt className="text-[11px] text-zinc-500">Documento</dt>
                      <dd className="mt-0.5">{c.archivoUrl
                        ? <button type="button" onClick={() => setVisor(docsTodos.find(d => d.url === c.archivoUrl) ?? { nombre: nombreDeArchivo(c.archivoUrl!), url: c.archivoUrl! })} title="Ver el documento que se subió" data-testid={`cotizacion-doc-${c.id}`}
                            className="inline-flex items-center gap-1 max-w-full font-semibold text-teal-700 hover:text-teal-900 underline underline-offset-2"><Eye size={12} className="flex-shrink-0" /><span className="truncate">{c.archivoNombre || nombreDeArchivo(c.archivoUrl)}</span></button>
                        : <span className="text-zinc-400">Sin documento (cargada a mano)</span>}</dd></div>
                    <div className="min-w-0"><dt className="text-[11px] text-zinc-500">Subida por</dt>
                      <dd className="mt-0.5 text-zinc-700" data-testid={`cotizacion-subio-${c.id}`}><b className="font-semibold">{c.registradoPorNombre || 'sin dato'}</b>{c.registradoAt ? ` · ${fmtFecha(c.registradoAt.slice(0, 10))} ${c.registradoAt.slice(11, 16)}` : ''}</dd></div>
                    <div className="min-w-0"><dt className="text-[11px] text-zinc-500">Plazo de entrega</dt>
                      <dd className="mt-0.5 text-zinc-700">{c.plazoEntregaTexto || <span className="text-zinc-400">no dice</span>}</dd></div>
                    <div className="min-w-0 @3xl:hidden"><dt className="text-[11px] text-zinc-500">Vigencia</dt>
                      <dd className={`mt-0.5 ${vencida ? 'font-semibold text-rose-600' : 'text-zinc-700'}`}>{c.vigenciaAt ? <>{fmtFecha(c.vigenciaAt)}{vencida && ' · vencida'}</> : <span className="text-zinc-400">no dice</span>}</dd></div>
                    {flete > 0 && <div className="min-w-0"><dt className="text-[11px] text-zinc-500">Total</dt>
                      <dd className="mt-0.5 text-zinc-700 tabular-nums">Productos {clp(subtotal)} + flete {clp(flete)}</dd></div>}
                    {c.descuentoPct != null && c.precioUnitarioBruto != null && <div className="min-w-0"><dt className="text-[11px] text-zinc-500">Descuento</dt>
                      <dd className="mt-0.5 text-emerald-700 tabular-nums">bruto {clp(c.precioUnitarioBruto)} − {c.descuentoPct} %</dd></div>}
                    {c.moneda !== 'CLP' && <div className="min-w-0"><dt className="text-[11px] text-zinc-500">Moneda</dt><dd className="mt-0.5 text-sky-700">{c.moneda}</dd></div>}
                  </dl>

                  <div>
                    <p className="text-[11px] text-zinc-500 mb-1">Qué cubre y a qué precio</p>
                    {cubiertos.length === 0
                      ? <span className="text-amber-600">Sin asignar a ningún producto — no entra a la comparación</span>
                      : <div className="flex flex-wrap gap-1">
                          {cubiertos.map(p => {
                            const it = c.items.find(i => i.productoId === p.id)!;
                            const incluido = it.precioBase === 0;
                            // Otra cotización cubre el mismo SERVICIO (transportes): casi siempre es una cotización mal asignada.
                            const repetido = p.esServicio && cotizaciones.some(o => o.id !== c.id && o.items.some(i => i.productoId === p.id));
                            const Pill = puedeOperar ? 'button' : 'span';
                            return (
                              <Pill key={p.id} {...(puedeOperar ? { type: 'button' as const, onClick: () => onAsignar(c.id) } : {})}
                                title={repetido ? `Otra cotización también está asignada a «${p.descripcion}»: haz clic para cambiar el producto` : puedeOperar ? `${p.descripcion} — clic para cambiar el producto de esta cotización` : p.descripcion}
                                className={`inline-flex items-center gap-1.5 border rounded-md px-1.5 py-0.5 bg-white text-left ${repetido ? 'border-amber-400' : 'border-zinc-200'} ${puedeOperar ? 'hover:border-teal-400 cursor-pointer' : ''}`}>
                                {repetido && <span className="text-amber-600" aria-label="Servicio repetido">⚠</span>}
                                <span className="text-zinc-600">{corto(p.descripcion, 60)}</span>
                                <span className="font-semibold text-zinc-900 tabular-nums">{incluido && !it.adicionales.length ? 'incluido' : it.precioUnitario != null ? clp(it.precioUnitario) : 'sin precio'}</span>
                                {it.adicionales.length > 0 && <span className="text-[10.5px] text-zinc-400">+{it.adicionales.length} adic.</span>}
                              </Pill>
                            );
                          })}
                          {flete > 0 && (
                            <span className="inline-flex items-center gap-1.5 border border-zinc-200 rounded-md px-1.5 py-0.5 bg-white" data-testid={`cotizacion-flete-${c.id}`}>
                              <span className="text-zinc-600">Flete</span>
                              <span className="font-semibold text-zinc-900 tabular-nums">{clp(flete)}</span>
                            </span>
                          )}
                        </div>}
                  </div>

                  {pendientes.length > 0 && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2" data-testid={`cotizacion-lineas-sin-asignar-${c.id}`}>
                      <p className="text-[12px] font-bold text-amber-900">⚠ El documento trae {pendientes.length === 1 ? 'una línea' : `${pendientes.length} líneas`} que no está{pendientes.length === 1 ? '' : 'n'} en ningún producto ni adicional</p>
                      <p className="text-[11px] text-amber-800">No se suman al precio hasta que tú las agregues, de a una.</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {pendientes.map(l => {
                          const clave = `${c.id}|${l.descripcion}`;
                          const elegido = destino[clave] ?? cubiertos[0]?.id;
                          const puedeAgregar = puedeOperar && negocioId != null && onCambio != null && cubiertos.length > 0 && l.precioUnitario != null && l.cantidad != null;
                          return (
                            <li key={clave} className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white border border-amber-200 rounded-md px-2 py-1">
                              <span className="font-semibold text-zinc-800" title={l.descripcion}>{corto(l.descripcion, 40)}</span>
                              <span className="text-zinc-500 tabular-nums">{l.cantidad != null && l.precioUnitario != null ? `${l.cantidad.toLocaleString('es-CL')} × ${clp(l.precioUnitario)} = ` : ''}<b className="text-zinc-900">{l.total != null ? clp(l.total) : '—'}</b></span>
                              {puedeAgregar && (
                                <span className="ml-auto flex items-center gap-1.5">
                                  {cubiertos.length > 1 && (
                                    <select value={elegido} onChange={e => setDestino(d => ({ ...d, [clave]: Number(e.target.value) }))} aria-label="Producto al que se suma"
                                      className="max-w-[170px] text-[11.5px] border border-zinc-300 rounded-md px-1 py-0.5 bg-white">
                                      {cubiertos.map(p => <option key={p.id} value={p.id}>{corto(p.descripcion, 28)}</option>)}
                                    </select>
                                  )}
                                  <button type="button" onClick={() => agregar(c, l, elegido)} disabled={agregando != null}
                                    title={`Sumar esta línea al precio de «${cubiertos.find(p => p.id === elegido)?.descripcion ?? ''}»`}
                                    className="text-[11.5px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 rounded-md px-2 py-0.5">
                                    {agregando === clave ? 'Agregando…' : cubiertos.length > 1 ? 'Agregar' : `Agregar a «${corto(cubiertos[0].descripcion, 22)}»`}
                                  </button>
                                  <button type="button" onClick={() => setIgnoradas(s => new Set(s).add(clave))} className="text-[11.5px] text-zinc-500 hover:text-zinc-800 px-1">No agregar</button>
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {cubiertos.length === 0 && <p className="mt-1 text-[11px] text-amber-800">Primero asigna la cotización a un producto («Productos») para poder sumar estas líneas.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} lista={docsTodos} onElegir={setVisor} />
    </div>
  );
}
