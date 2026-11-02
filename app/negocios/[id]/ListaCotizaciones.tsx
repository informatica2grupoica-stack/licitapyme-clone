'use client';

// COTIZACIONES RECIBIDAS, EN UNA TABLA ORDENADA: una fila por cotización (proveedor, qué productos cubre y a qué precio, total, plazo,
// vigencia, avisos y sus acciones). Reemplaza a las tarjetas apiladas, que con 10 cotizaciones se volvían una lista inmensa, sin
// esconder nada: todas siguen a la vista, en filas compactas con scroll propio y encabezado fijo.
import { useState } from 'react';
import { MenuAcciones } from '@/app/components/ui/MenuAcciones';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { lineasDesdeTabla, lineasSinAsignar, type LineaCotizacion } from '@/app/lib/compras-cotizacion-lineas';
import { adicionalesDesdeIA } from '@/app/lib/compras-adicionales-ia';
import { useToast } from '@/app/components/ui/toast';
import { IconEye as Eye, IconListCheck as ListChecks, IconSparkles as Sparkles, IconPencil as Pencil, IconTrash as Trash, IconLoader2 as Loader2, IconAlertTriangle as Alerta } from '@tabler/icons-react';

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
function lineasPendientes(c: CotizacionFilaUI, productos: Array<{ id: number; descripcion: string }>): LineaCotizacion[] {
  if (c.moneda !== 'CLP') return [];
  const lineas = lineasDesdeTabla(String(c.descripcionLibre || ''));
  if (!lineas.length) return [];
  const asignados = [
    ...c.items.map(i => String(productos.find(p => p.id === i.productoId)?.descripcion ?? '').split(' - ')[0]),
    ...c.items.flatMap(i => (i.adicionales as AdicionalFila[]).map(a => String(a.concepto))),
  ];
  const fleteAparte = c.fleteMonto != null && c.fleteMonto > 0;
  return lineasSinAsignar(lineas, asignados).filter(l => !(fleteAparte && /flete|transport|despacho|env[ií]o/i.test(l.descripcion)));
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const corto = (t: string, n = 26) => (t.length > n ? `${t.slice(0, n).trim()}…` : t);
const hoy = () => new Date().toISOString().slice(0, 10);
/** Nombre legible del archivo subido (la URL trae un prefijo numérico de subida). Conserva la extensión: el visor la usa para elegir cómo mostrarlo. */
const nombreDeArchivo = (url: string) => { try { return decodeURIComponent(url.split('?')[0].split('/').pop() || 'cotizacion').replace(/^\d+_/, ''); } catch { return 'cotizacion'; } };
const fmtFecha = (ymd: string) => `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;

export function ListaCotizaciones({ negocioId, cotizaciones, productos, avisosPorCotizacion, origenLabel, puedeOperar, homologandoId, onAsignar, onHomologar, onEditar, onEliminar, onCambio }: {
  negocioId?: number;
  cotizaciones: CotizacionFilaUI[]; productos: Array<{ id: number; descripcion: string; cantidad?: number | string | null }>;
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

  // Agrega UNA línea como adicional del producto elegido. El PUT reemplaza la lista del producto: se manda lo que ya tenía + la nueva.
  const agregar = async (c: CotizacionFilaUI, l: LineaCotizacion, productoId: number) => {
    if (negocioId == null || l.precioUnitario == null || l.cantidad == null) return;
    const clave = `${c.id}|${l.descripcion}`;
    setAgregando(clave);
    try {
      const prod = productos.find(p => p.id === productoId);
      const item = c.items.find(i => i.productoId === productoId);
      const cantProd = prod?.cantidad != null && Number(prod.cantidad) > 0 ? Number(prod.cantidad) : null;
      const nuevos = adicionalesDesdeIA([{ concepto: l.descripcion, cantidadLinea: l.cantidad, precioUnitario: l.precioUnitario }], cantProd, n => n);
      if (!nuevos.length) throw new Error('La línea no trae cantidad o precio válidos.');
      const previos = ((item?.adicionales ?? []) as AdicionalFila[]).map(a => ({ concepto: a.concepto, cantidad: a.cantidad, precioUnitario: a.precioUnitario }));
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${c.id}/adicionales`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId, adicionales: [...previos, ...nuevos] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo agregar');
      toast.success('Línea agregada', `«${l.descripcion.slice(0, 50)}» se suma al precio de ese producto.`);
      await onCambio?.();
    } catch (e: any) {
      toast.error('No se pudo agregar la línea', e.message);
    } finally { setAgregando(null); }
  };
  if (cotizaciones.length === 0) return null;
  const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) && n > 0 ? n : 1; };
  const h = hoy();
  return (
    <div className="max-h-[460px] overflow-auto border-t border-zinc-100">
      <table className="w-full min-w-[900px] text-left border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-zinc-200 text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
            <th className="px-4 py-2 w-[22%]">Proveedor</th>
            <th className="px-3 py-2">Qué cubre y a qué precio</th>
            <th className="px-3 py-2 whitespace-nowrap">Total</th>
            <th className="px-3 py-2">Plazo</th>
            <th className="px-3 py-2">Vigencia</th>
            <th className="px-3 py-2">Avisos</th>
            {puedeOperar && <th className="px-3 py-2 text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {cotizaciones.map(c => {
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
            return (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 align-top hover:bg-zinc-50/60">
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-zinc-900 leading-tight">{c.proveedorNombre}{c.proveedorNuevo != null && <span className="ml-1.5 text-[10px] font-bold text-zinc-400">{c.proveedorNuevo ? '(nuevo)' : '(antiguo)'}</span>}</p>
                  <p className="text-[11px] text-zinc-400">#{c.id} · {origenLabel[c.origen] ?? c.origen}{c.proveedorRut ? ` · ${c.proveedorRut}` : ''}</p>
                  {c.descuentoPct != null && c.precioUnitarioBruto != null && <p className="text-[11px] text-emerald-600">bruto {clp(c.precioUnitarioBruto)} − {c.descuentoPct} %</p>}
                  {c.moneda !== 'CLP' && <p className="text-[11px] text-sky-700">en {c.moneda}</p>}
                  {c.archivoUrl
                    ? <button type="button" onClick={() => setVisor({ nombre: c.archivoNombre || nombreDeArchivo(c.archivoUrl!), url: c.archivoUrl! })} title="Ver el documento que se subió" data-testid={`cotizacion-doc-${c.id}`}
                        className="mt-1 inline-flex items-center gap-1 max-w-[230px] text-[11.5px] font-semibold text-teal-700 hover:text-teal-900 underline underline-offset-2"><Eye size={12} className="flex-shrink-0" /><span className="truncate">{c.archivoNombre || nombreDeArchivo(c.archivoUrl)}</span></button>
                    : <p className="mt-1 text-[11px] text-zinc-400">Sin documento (cargada a mano)</p>}
                  <p className="text-[11px] text-zinc-500" data-testid={`cotizacion-subio-${c.id}`}>Subida por <b className="font-semibold text-zinc-700">{c.registradoPorNombre || 'sin dato'}</b>{c.registradoAt ? ` · ${fmtFecha(c.registradoAt.slice(0, 10))} ${c.registradoAt.slice(11, 16)}` : ''}</p>
                </td>
                <td className="px-3 py-2.5">
                  {cubiertos.length === 0
                    ? <span className="text-[12px] text-amber-600">Sin asignar a ningún producto — no entra a la comparación</span>
                    : <div className="flex flex-wrap gap-1">
                        {cubiertos.map(p => {
                          const it = c.items.find(i => i.productoId === p.id)!;
                          const incluido = it.precioBase === 0;
                          return (
                            <span key={p.id} title={p.descripcion} className="inline-flex items-center gap-1.5 border border-zinc-200 rounded-md px-1.5 py-0.5 bg-white">
                              <span className="text-zinc-600">{corto(p.descripcion)}</span>
                              <span className="font-bold text-zinc-900">{incluido && !it.adicionales.length ? 'incluido' : it.precioUnitario != null ? clp(it.precioUnitario) : 'sin precio'}</span>
                              {it.adicionales.length > 0 && <span className="text-[10.5px] text-zinc-400">+{it.adicionales.length} adic.</span>}
                            </span>
                          );
                        })}
                        {flete > 0 && (
                          <span className="inline-flex items-center gap-1.5 border border-zinc-200 rounded-md px-1.5 py-0.5 bg-white" data-testid={`cotizacion-flete-${c.id}`}>
                            <span className="text-zinc-600">Flete</span>
                            <span className="font-bold text-zinc-900">{clp(flete)}</span>
                          </span>
                        )}
                      </div>}
                  {pendientes.length > 0 && (
                    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2" data-testid={`cotizacion-lineas-sin-asignar-${c.id}`}>
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
                                    className="text-[11.5px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 rounded-md px-2 py-0.5">
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
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap font-bold text-zinc-900">{total > 0 ? clp(total) : <span className="text-zinc-300">—</span>}
                  {flete > 0 && <span className="block text-[11px] font-normal text-zinc-500">Productos {clp(subtotal)} + flete {clp(flete)}</span>}</td>
                <td className="px-3 py-2.5 text-zinc-700">{c.plazoEntregaTexto || <span className="text-zinc-300">no dice</span>}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{c.vigenciaAt ? <span className={vencida ? 'font-semibold text-rose-600' : 'text-zinc-700'}>{fmtFecha(c.vigenciaAt)}{vencida && ' · vencida'}</span> : <span className="text-zinc-300">no dice</span>}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{avisos > 0 ? <span className="inline-flex items-center gap-1 font-bold text-rose-600"><Alerta size={13} />{avisos}</span> : <span className="text-emerald-600">sin avisos</span>}</td>
                {puedeOperar && (
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      {c.archivoUrl && <button type="button" onClick={() => setVisor({ nombre: nombreDeArchivo(c.archivoUrl!), url: c.archivoUrl! })} data-testid={`cotizacion-ver-${c.id}`}
                        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-zinc-600 hover:text-teal-800 px-2 py-1 rounded-md hover:bg-zinc-100"><Eye size={13} /> Ver documento</button>}
                      <button type="button" onClick={() => onAsignar(c.id)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:text-teal-900 px-2 py-1 rounded-md hover:bg-teal-50"><ListChecks size={13} /> Productos</button>
                      <MenuAcciones texto="Más" acciones={[
                        { label: homologandoId === c.id ? 'Leyendo con IA…' : c.homologadaAt ? 'Volver a leer con IA' : 'Leer con IA', onClick: () => onHomologar(c.id), disabled: homologandoId === c.id },
                        { label: 'Editar datos', onClick: () => onEditar(c.id) },
                        { label: 'Eliminar cotización', onClick: () => onEliminar(c.id), peligro: true },
                      ]} />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
