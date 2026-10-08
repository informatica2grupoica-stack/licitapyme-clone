'use client';

// COTIZACIONES RECIBIDAS, EN UNA TABLA ORDENADA: una fila por cotización (proveedor, qué productos cubre y a qué precio, total, plazo,
// vigencia, avisos y sus acciones). Reemplaza a las tarjetas apiladas, que con 10 cotizaciones se volvían una lista inmensa, sin
// esconder nada: todas siguen a la vista, en filas compactas con scroll propio y encabezado fijo.
import { useState } from 'react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { IconEye as Eye, IconListCheck as ListChecks, IconSparkles as Sparkles, IconPencil as Pencil, IconTrash as Trash, IconLoader2 as Loader2, IconAlertTriangle as Alerta } from '@tabler/icons-react';

export interface CotizacionFilaUI {
  id: number; proveedorNombre: string; proveedorRut: string | null; proveedorNuevo: boolean | null; origen: string;
  precioUnitario: number | null; precioUnitarioBruto: number | null; descuentoPct: number | null; moneda: string;
  plazoEntregaTexto: string | null; vigenciaAt?: string | null; archivoUrl: string | null; homologadaAt: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null; precioBase?: number | null; adicionales: unknown[] }>;
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const corto = (t: string, n = 26) => (t.length > n ? `${t.slice(0, n).trim()}…` : t);
const hoy = () => new Date().toISOString().slice(0, 10);
/** Nombre legible del archivo subido (la URL trae un prefijo numérico de subida). Conserva la extensión: el visor la usa para elegir cómo mostrarlo. */
const nombreDeArchivo = (url: string) => { try { return decodeURIComponent(url.split('?')[0].split('/').pop() || 'cotizacion').replace(/^\d+_/, ''); } catch { return 'cotizacion'; } };
const fmtFecha = (ymd: string) => `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;

export function ListaCotizaciones({ cotizaciones, productos, avisosPorCotizacion, origenLabel, puedeOperar, homologandoId, onAsignar, onHomologar, onEditar, onEliminar }: {
  cotizaciones: CotizacionFilaUI[]; productos: Array<{ id: number; descripcion: string; cantidad?: number | string | null }>;
  avisosPorCotizacion: Record<number, number>; origenLabel: Record<string, string>; puedeOperar: boolean; homologandoId: number | null;
  onAsignar: (id: number) => void; onHomologar: (id: number) => void; onEditar: (id: number) => void; onEliminar: (id: number) => void;
}) {
  const [visor, setVisor] = useState<VisorDoc | null>(null);
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
            const total = productos.reduce((s, p) => { const it = c.items.find(i => i.productoId === p.id); return s + (it?.precioUnitario != null ? it.precioUnitario * num(p.cantidad) : 0); }, 0);
            const vencida = c.vigenciaAt != null && c.vigenciaAt < h;
            const avisos = avisosPorCotizacion[c.id] ?? 0;
            return (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 align-top hover:bg-zinc-50/60">
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-zinc-900 leading-tight">{c.proveedorNombre}{c.proveedorNuevo != null && <span className="ml-1.5 text-[10px] font-bold text-zinc-400">{c.proveedorNuevo ? '(nuevo)' : '(antiguo)'}</span>}</p>
                  <p className="text-[11px] text-zinc-400">#{c.id} · {origenLabel[c.origen] ?? c.origen}{c.proveedorRut ? ` · ${c.proveedorRut}` : ''}</p>
                  {c.descuentoPct != null && c.precioUnitarioBruto != null && <p className="text-[11px] text-emerald-600">bruto {clp(c.precioUnitarioBruto)} − {c.descuentoPct} %</p>}
                  {c.moneda !== 'CLP' && <p className="text-[11px] text-sky-700">en {c.moneda}</p>}
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
                      </div>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap font-bold text-zinc-900">{total > 0 ? clp(total) : <span className="text-zinc-300">—</span>}</td>
                <td className="px-3 py-2.5 text-zinc-700">{c.plazoEntregaTexto || <span className="text-zinc-300">no dice</span>}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{c.vigenciaAt ? <span className={vencida ? 'font-semibold text-rose-600' : 'text-zinc-700'}>{fmtFecha(c.vigenciaAt)}{vencida && ' · vencida'}</span> : <span className="text-zinc-300">no dice</span>}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{avisos > 0 ? <span className="inline-flex items-center gap-1 font-bold text-rose-600"><Alerta size={13} />{avisos}</span> : <span className="text-emerald-600">sin avisos</span>}</td>
                {puedeOperar && (
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {c.archivoUrl && <button type="button" onClick={() => setVisor({ nombre: nombreDeArchivo(c.archivoUrl!), url: c.archivoUrl! })} title="Ver el documento que se subió" aria-label={`Ver el documento de ${c.proveedorNombre}`} data-testid={`cotizacion-ver-${c.id}`} className="p-1.5 rounded-md text-zinc-500 hover:text-teal-700 hover:bg-zinc-100"><Eye size={15} /></button>}
                      <button type="button" onClick={() => onAsignar(c.id)} title="Qué productos cubre" className="p-1.5 rounded-md text-zinc-500 hover:text-teal-700 hover:bg-zinc-100"><ListChecks size={15} /></button>
                      <button type="button" onClick={() => onHomologar(c.id)} disabled={homologandoId === c.id} title={c.homologadaAt ? 'Volver a leer con IA' : 'Leer con IA'} className="p-1.5 rounded-md text-zinc-500 hover:text-indigo-700 hover:bg-zinc-100 disabled:opacity-50">{homologandoId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}</button>
                      <button type="button" onClick={() => onEditar(c.id)} title="Editar datos" className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"><Pencil size={15} /></button>
                      <button type="button" onClick={() => onEliminar(c.id)} title="Eliminar" className="p-1.5 rounded-md text-rose-500 hover:text-rose-700 hover:bg-rose-50"><Trash size={15} /></button>
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
