'use client';

// MATRIZ DE PRECIOS — la pieza central del paso «Costeo y auditoría»: productos en filas, proveedores en columnas, y en cada celda el
// precio neto por unidad (con adicionales incluidos) y cuánto se aparta de lo costeado. Aquí también se ARMA LA COMPRA:
//   · un clic en una celda = «este producto se lo compro a este proveedor»;
//   · «Comprar todo aquí» en la cabecera de un proveedor = todo lo que cubre, a él;
//   · el menú ⋯ de cada proveedor reúne sus acciones (ver archivo, qué productos cubre, re-homologar, editar, eliminar), así ya no hace
//     falta una lista aparte de cotizaciones que, con 10 proveedores, se volvía interminable.
// Con muchas cotizaciones se ven las 6 que mejor cubren y las demás quedan en «Ver todas».
import { useMemo, useState } from 'react';
import type React from 'react';
import { IconStar as Star, IconDotsVertical as Dots, IconCheck as Check, IconPaperclip as Clip, IconListCheck as ListChecks, IconSparkles as Sparkles, IconPencil as Pencil, IconTrash as Trash, IconInfoCircle as Info } from '@tabler/icons-react';
import { compararPrecioConCosteo, type VeredictoPrecio } from '@/app/lib/compras-precio-vs-costeo';

export interface SeleccionCelda { cotizacionId: number; productoId: number }
export interface CotizacionMin {
  id: number; proveedorNombre: string; plazoEntregaTexto?: string | null; archivoUrl?: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null; precioBase?: number | null; adicionales: unknown[] }>;
}
export interface AccionesCotizacion {
  onAsignar: (cotizacionId: number) => void; onHomologar: (cotizacionId: number) => void; onEditar: (cotizacionId: number) => void; onEliminar: (cotizacionId: number) => void;
  /** Cotización con una acción en curso (muestra el menú ocupado). */
  ocupadoId?: number | null;
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const pct = (n: number) => String(n).replace('.', ',');
const MAX_COLUMNAS = 6;

export const ESTILO_VEREDICTO: Record<VeredictoPrecio, { chip: string; texto: (diffPct: number | null) => string }> = {
  MEJOR: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', texto: d => `▼ ${pct(Math.abs(d ?? 0))} % menos` },
  IGUAL: { chip: 'bg-sky-50 text-sky-700 border-sky-200', texto: () => '≈ igual al costeo' },
  PEOR: { chip: 'bg-rose-50 text-rose-700 border-rose-200', texto: d => `▲ ${pct(d ?? 0)} % más` },
  SIN_COMPARAR: { chip: 'bg-zinc-100 text-zinc-600 border-zinc-200', texto: () => 'sin comparar' },
};

/** Alertas por celda ("cotizaciónId:productoId" → textos cortos): lo que el auditor marcó fuera del precio y no se veía sin abrir el detalle. */
export const ETIQUETA_ALERTA: Record<string, string> = {
  plazo: 'Plazo no alcanza', proveedor: 'RUT inválido', cantidad: 'Mínimo de venta', vigencia: 'Cotización vencida', precio: 'Costo sobre la venta', producto: 'Falta lo que exigen las bases',
};

export function MatrizPrecios({ productos, cotizaciones, costeado, seleccion, onSeleccionar, alertas, onAgregar, compra, onElegirCelda, onComprarTodoAqui, acciones }: {
  productos: Array<{ id: number; descripcion: string; cantidad?: number | string | null }>; cotizaciones: CotizacionMin[];
  costeado: Record<number, number | null>; seleccion: SeleccionCelda | null; onSeleccionar: (s: SeleccionCelda) => void;
  alertas?: Record<string, string[]>;
  /** Abre «Asignar productos» de esa cotización (agregar un producto que no cotizó o que va incluido en otro). */
  onAgregar?: (cotizacionId: number) => void;
  /** La compra que se va armando: productoId → cotizacionId elegida. */
  compra?: Record<number, number>;
  onElegirCelda?: (productoId: number, cotizacionId: number) => void;
  onComprarTodoAqui?: (cotizacionId: number) => void;
  acciones?: AccionesCotizacion;
}) {
  const [verTodas, setVerTodas] = useState(false);
  const [menuId, setMenuId] = useState<number | null>(null);

  const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) && n > 0 ? n : 1; };   // la cantidad viene como número (o decimal con punto de la BD)
  const resumen = useMemo(() => cotizaciones.map(c => {
    const cubiertos = productos.filter(p => c.items.some(i => i.productoId === p.id));
    const total = productos.reduce((s, p) => { const it = c.items.find(i => i.productoId === p.id); return s + (it?.precioUnitario != null ? it.precioUnitario * num(p.cantidad) : 0); }, 0);
    const nAvisos = productos.reduce((s, p) => s + (alertas?.[`${c.id}:${p.id}`]?.length ?? 0), 0);
    return { c, cubiertos: cubiertos.length, faltan: productos.length - cubiertos.length, total, nAvisos };
  }), [cotizaciones, productos, alertas]);

  const usadas = new Set([...Object.values(compra ?? {}), ...(seleccion ? [seleccion.cotizacionId] : [])]);
  const visibles = useMemo(() => {
    if (verTodas || resumen.length <= MAX_COLUMNAS) return resumen;
    // Las que mejor cubren (y más baratas, y con menos avisos) primero; las que ya tienen elección o detalle abierto no se esconden nunca.
    const orden = [...resumen].sort((a, b) => a.faltan - b.faltan || a.nAvisos - b.nAvisos || (a.total || Infinity) - (b.total || Infinity));
    const ids = new Set(orden.slice(0, MAX_COLUMNAS).map(r => r.c.id));
    for (const id of usadas) ids.add(id);
    return resumen.filter(r => ids.has(r.c.id));
  }, [resumen, verTodas, compra, seleccion]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (cotizaciones.length === 0 || productos.length === 0) return null;
  const ocultas = resumen.length - visibles.length;

  // «★ menor» solo entre los que cubren todo y no traen avisos: un total bajo con un componente que falta no es el más barato de verdad.
  const totales = visibles.filter(r => r.faltan === 0 && r.total > 0 && r.nAvisos === 0).map(r => r.total);
  const menor = totales.length >= 2 ? Math.min(...totales) : null;
  const fila = (titulo: string, celda: (r: typeof resumen[number]) => React.ReactNode) => (
    <tr className="border-t border-zinc-100 bg-zinc-50/60 align-top">
      <td className="sticky left-0 z-10 bg-zinc-50 px-4 py-2 text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide">{titulo}</td>
      <td className="px-3 py-2" />
      {visibles.map(r => <td key={r.c.id} className="px-3 py-2 text-[12.5px]">{celda(r)}</td>)}
    </tr>
  );

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[14px] font-bold text-zinc-900">Compara y elige a quién comprar</p>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">Neto por unidad contra lo costeado. <b className="font-semibold text-zinc-700">Toca el precio</b> del proveedor al que le quieres comprar cada producto, o usa <b className="font-semibold text-zinc-700">«Comprar todo aquí»</b>.</p>
        </div>
        {resumen.length > MAX_COLUMNAS && (
          <button type="button" onClick={() => setVerTodas(v => !v)} className="text-[12px] font-semibold text-teal-700 hover:text-teal-900 whitespace-nowrap">
            {verTodas ? `Ver solo las ${MAX_COLUMNAS} mejores` : `Ver las ${resumen.length} cotizaciones (hay ${ocultas} más)`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide min-w-[220px]">Producto</th>
              <th className="px-3 py-2.5 text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide min-w-[110px]">Lo costeado</th>
              {visibles.map(({ c, cubiertos }) => (
                <th key={c.id} className="px-3 py-2.5 min-w-[165px] align-top">
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-zinc-900 leading-tight line-clamp-2" title={c.proveedorNombre}>{c.proveedorNombre}</span>
                      <span className="block text-[11px] font-normal text-zinc-400">Cotización #{c.id}</span>
                    </div>
                    {acciones && (
                      <div className="relative">
                        <button type="button" onClick={() => setMenuId(m => (m === c.id ? null : c.id))} aria-label="Acciones de esta cotización"
                          className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
                          <Dots size={15} />
                        </button>
                        {menuId === c.id && (
                          <>
                            <div className="fixed inset-0 z-20" onClick={() => setMenuId(null)} />
                            <div className="absolute right-0 top-7 z-30 w-52 bg-white rounded-lg border border-zinc-200 shadow-lg py-1 text-[12.5px] font-normal">
                              {c.archivoUrl && <a href={c.archivoUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenuId(null)} className="flex items-center gap-2 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"><Clip size={14} /> Ver el archivo</a>}
                              <button type="button" onClick={() => { setMenuId(null); acciones.onAsignar(c.id); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"><ListChecks size={14} /> Qué productos cubre</button>
                              <button type="button" onClick={() => { setMenuId(null); acciones.onHomologar(c.id); }} disabled={acciones.ocupadoId === c.id} className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"><Sparkles size={14} /> Volver a leer con IA</button>
                              <button type="button" onClick={() => { setMenuId(null); acciones.onEditar(c.id); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"><Pencil size={14} /> Editar datos</button>
                              <button type="button" onClick={() => { setMenuId(null); acciones.onEliminar(c.id); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-rose-600 hover:bg-rose-50"><Trash size={14} /> Eliminar</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {onComprarTodoAqui && cubiertos > 0 && (
                    <button type="button" onClick={() => onComprarTodoAqui(c.id)}
                      className="mt-1.5 text-[11.5px] font-semibold text-teal-700 border border-teal-200 hover:border-teal-400 hover:bg-teal-50 rounded-md px-2 py-0.5">
                      {cubiertos === productos.length ? 'Comprar todo aquí' : `Comprar lo que cubre (${cubiertos})`}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productos.map(p => {
              const base = costeado[p.id] ?? null;
              const precios = visibles.map(r => r.c.items.find(i => i.productoId === p.id)?.precioUnitario ?? null);
              const validos = precios.filter((x): x is number => x != null && x > 0);
              const mejor = validos.length >= 2 ? Math.min(...validos) : null;
              const sinCotizar = validos.length === 0 && visibles.every(r => !r.c.items.some(i => i.productoId === p.id));
              return (
                <tr key={p.id} className="border-b border-zinc-100 last:border-0 align-top">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <p className="text-[13px] font-semibold text-zinc-900 line-clamp-2" title={p.descripcion}>{p.descripcion}</p>
                    {sinCotizar && <p className="text-[11.5px] font-semibold text-amber-600 mt-0.5">Sin cotizar todavía</p>}
                  </td>
                  <td className="px-3 py-3 text-[13.5px] font-semibold text-zinc-700 whitespace-nowrap">{base != null ? clp(base) : <span className="font-normal text-zinc-400" title="El costeo no tiene un costo para esta línea">—</span>}</td>
                  {visibles.map(({ c }, i) => {
                    const item = c.items.find(x => x.productoId === p.id);
                    if (!item) return (
                      <td key={c.id} className="px-2 py-2">
                        {onAgregar
                          ? <button type="button" onClick={() => onAgregar(c.id)} title="Agregar este producto a esta cotización: con precio, o «va incluido» en otro producto"
                              className="w-full text-left rounded-lg px-2.5 py-1.5 border border-dashed border-zinc-200 text-[12px] text-zinc-400 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50/40">no cotizó · <b className="font-semibold">+ agregar</b></button>
                          : <span className="px-3 text-[12px] text-zinc-300">no cotizó</span>}
                      </td>
                    );
                    const cmp = compararPrecioConCosteo(item.precioUnitario, base);
                    const est = ESTILO_VEREDICTO[cmp.veredicto];
                    const incluido = item.precioBase === 0;
                    const elegida = compra?.[p.id] === c.id;
                    const esMejor = mejor != null && precios[i] === mejor;
                    const detalleActivo = seleccion?.cotizacionId === c.id && seleccion.productoId === p.id;
                    const al = alertas?.[`${c.id}:${p.id}`] ?? [];
                    return (
                      <td key={c.id} className="px-2 py-2">
                        <div className={`relative rounded-lg border transition-colors ${elegida ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-200' : detalleActivo ? 'border-indigo-300 bg-indigo-50/30' : 'border-transparent hover:border-zinc-300 hover:bg-zinc-50'}`}>
                          {/* Clic en la celda = ver el detalle (desglose, adicionales, avisos). Agregar a la compra = solo el círculo. */}
                          {onElegirCelda && (
                            <button type="button" onClick={() => onElegirCelda(p.id, c.id)} aria-pressed={elegida} aria-label={elegida ? 'Quitar de mi compra' : 'Agregar a mi compra'}
                              title={elegida ? 'Quitar de mi compra' : 'Comprar este producto a este proveedor'}
                              className="absolute top-2 left-2 z-10 p-1 -m-1 rounded-full">
                              <span className={`flex w-4 h-4 rounded-full border items-center justify-center ${elegida ? 'bg-teal-600 border-teal-600 text-white' : 'border-zinc-300 bg-white hover:border-teal-500'}`}>{elegida && <Check size={11} strokeWidth={3} />}</span>
                            </button>
                          )}
                          <button type="button" onClick={() => onSeleccionar({ cotizacionId: c.id, productoId: p.id })}
                            title="Ver el detalle de este precio (desglose, adicionales, avisos)" className={`w-full text-left py-1.5 pr-7 ${onElegirCelda ? 'pl-8' : 'px-2.5'}`}>
                            <span className="flex items-center gap-1.5">
                              <span className="text-[14px] font-bold text-zinc-900 whitespace-nowrap">{item.precioUnitario != null ? clp(item.precioUnitario) : 'sin precio'}</span>
                              {esMejor && <span title="Mejor precio de este producto" className="inline-flex items-center gap-0.5 text-[10.5px] font-bold text-amber-600"><Star size={12} className="fill-amber-400" /> Mejor</span>}
                            </span>
                            {incluido
                              ? <span className="block text-[11px] font-semibold text-sky-700 mt-0.5">Incluido en otro producto{item.adicionales.length > 0 ? ' · se suman sus componentes' : ''}</span>
                              : <span className={`inline-block mt-1 text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${est.chip}`}>{est.texto(cmp.diffPct)}</span>}
                            {al.map(t => <span key={t} className="block text-[11px] font-bold text-rose-600 mt-0.5">⚠ {t}</span>)}
                            {item.adicionales.length > 0 && <span className="block text-[11px] text-zinc-400 mt-0.5">incluye {item.adicionales.length} adicional{item.adicionales.length === 1 ? '' : 'es'}</span>}
                          </button>
                          <button type="button" onClick={() => onSeleccionar({ cotizacionId: c.id, productoId: p.id })} aria-label="Ver el detalle de este precio" title="Ver el detalle (desglose, adicionales, avisos)"
                            className="absolute top-1 right-1 p-1 rounded-md text-zinc-300 hover:text-indigo-600 hover:bg-white"><Info size={14} /></button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {fila('Cubre', r => r.faltan === 0
              ? <span className="font-semibold text-emerald-700">Todos ({r.cubiertos} de {productos.length})</span>
              : <span className="font-semibold text-amber-700">{r.cubiertos} de {productos.length} · faltan {r.faltan}</span>)}
            {fila('Total si compras aquí', r => r.total > 0
              ? <span className="font-bold text-zinc-900">{clp(r.total)}{menor != null && r.faltan === 0 && r.nAvisos === 0 && r.total === menor ? <span className="ml-1 text-[10.5px] font-bold text-amber-600">★ menor</span> : null}</span>
              : <span className="text-zinc-300">—</span>)}
            {fila('Plazo', r => <span className="text-zinc-700">{r.c.plazoEntregaTexto || <span className="text-zinc-300">no dice</span>}</span>)}
            {fila('Avisos', r => r.nAvisos > 0 ? <span className="font-bold text-rose-600">⚠ {r.nAvisos}</span> : <span className="text-emerald-600">sin avisos</span>)}
          </tfoot>
        </table>
      </div>
      <p className="px-4 py-2 text-[11.5px] text-zinc-400 border-t border-zinc-100">
        Verde: más barata que lo costeado · Rojo: más cara · Azul: igual (±1 %) · Gris: no se puede comparar. ⚠ rojo = un problema del proveedor (plazo, RUT, mínimo de venta, falta un componente). La estrella marca el mejor precio de cada producto.
      </p>
    </div>
  );
}
