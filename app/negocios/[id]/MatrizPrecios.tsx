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
import { LinksProducto, type LinksCosteo } from './LinksProducto';
import type { useLinksLeidos } from './LinksLeidos';
import { compararPrecioConCosteo, type VeredictoPrecio } from '@/app/lib/compras-precio-vs-costeo';

export interface SeleccionCelda { cotizacionId: number; productoId: number }
export interface CotizacionMin {
  id: number; proveedorNombre: string; proveedorRut?: string | null; plazoEntregaTexto?: string | null; archivoUrl?: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null; precioBase?: number | null; adicionales: unknown[] }>;
}
export interface AccionesCotizacion {
  onAsignar: (cotizacionId: number) => void; onHomologar: (cotizacionId: number) => void; onEditar: (cotizacionId: number) => void; onEliminar: (cotizacionId: number) => void;
  /** Cotización con una acción en curso (muestra el menú ocupado). */
  ocupadoId?: number | null;
}

/** Cotizaciones reemplazadas: si el MISMO proveedor (RUT, o nombre si no hay) cotizó un producto en varias cotizaciones, solo la más reciente (id mayor)
 *  se puede elegir; las anteriores quedan a la vista, atenuadas. Devuelve «cotizaciónId:productoId» → id de la cotización que la reemplaza. */
export function cotizacionesReemplazadas(cotizaciones: CotizacionMin[]): Map<string, number> {
  const clave = (c: CotizacionMin) => { const rut = (c.proveedorRut ?? '').replace(/[^0-9kK]/g, '').toUpperCase(); return rut ? `rut:${rut}` : `nom:${c.proveedorNombre.trim().toLowerCase().replace(/\s+/g, ' ')}`; };
  const ultima = new Map<string, number>();   // proveedor|producto → id de la cotización más reciente
  for (const c of cotizaciones) for (const it of c.items) { const k = `${clave(c)}|${it.productoId}`; if ((ultima.get(k) ?? 0) < c.id) ultima.set(k, c.id); }
  const out = new Map<string, number>();
  for (const c of cotizaciones) for (const it of c.items) { const u = ultima.get(`${clave(c)}|${it.productoId}`)!; if (u !== c.id) out.set(`${c.id}:${it.productoId}`, u); }
  return out;
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

export const ESTILO_TECNICO: Record<string, { chip: string; texto: string }> = {
  CUMPLE: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', texto: 'cumple' },
  NO_CUMPLE: { chip: 'bg-rose-50 text-rose-700 border-rose-200', texto: 'no cumple' },
  CON_PENDIENTES: { chip: 'bg-amber-50 text-amber-800 border-amber-200', texto: 'falta dato' },
  NO_CORRIDO: { chip: 'bg-zinc-100 text-zinc-600 border-zinc-200', texto: 'sin comparar' },
};

export type MatrizProps = {
  /** Link del costeo de cada producto: se muestra junto a «Lo costeado» (de ahí sale ese precio). */
  linksCosteo?: LinksCosteo;
  /** Lectura de los links del costeo por el Auditor (la primera cotización de cada producto). */
  lecturaLink?: ReturnType<typeof useLinksLeidos>;
  /** «Comprar por este link»: lleva a la compra directa de ese producto con link, precio neto y proveedor ya puestos. */
  onCompraPorLink?: (productoId: number, d: { link: string; precio: number; proveedor: string }) => void;
  productos: Array<{ id: number; descripcion: string; cantidad?: number | string | null }>; cotizaciones: CotizacionMin[];
  costeado: Record<number, number | null>;
  /** Precio de venta neto/u del costeo de cada producto (para el margen del costeo inicial vs las cotizaciones). */
  venta?: Record<number, number | null>;
  seleccion: SeleccionCelda | null; onSeleccionar: (s: SeleccionCelda) => void;
  alertas?: Record<string, string[]>;
  /** Resultado de la ficha técnica por celda («cotizaciónId:productoId»); solo las celdas cuyo proveedor tiene ficha de ese producto. */
  tecnico?: Record<string, { estado: string; cumple: number; total: number; modelo: string }>;
  /** Abre «Asignar productos» de esa cotización (agregar un producto que no cotizó o que va incluido en otro). */
  onAgregar?: (cotizacionId: number) => void;
  /** La compra que se va armando: productoId → cotizacionId elegida. */
  compra?: Record<number, number>;
  onElegirCelda?: (productoId: number, cotizacionId: number) => void;
  onComprarTodoAqui?: (cotizacionId: number) => void;
  acciones?: AccionesCotizacion;
};

export function MatrizPrecios({ productos, cotizaciones, costeado, linksCosteo = {}, lecturaLink: lecLink, onCompraPorLink, seleccion, onSeleccionar, alertas, tecnico, onAgregar, compra, onElegirCelda, onComprarTodoAqui, acciones }: MatrizProps) {
  const [verTodas, setVerTodas] = useState(false);
  const [menuId, setMenuId] = useState<number | null>(null);
  const reemp = useMemo(() => cotizacionesReemplazadas(cotizaciones), [cotizaciones]);

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

  if (productos.length === 0 || (cotizaciones.length === 0 && !lecLink?.disponible)) return null;
  const ocultas = resumen.length - visibles.length;

  // «★ menor» solo entre los que cubren todo y no traen avisos: un total bajo con un componente que falta no es el más barato de verdad.
  const totales = visibles.filter(r => r.faltan === 0 && r.total > 0 && r.nAvisos === 0).map(r => r.total);
  const menor = totales.length >= 2 ? Math.min(...totales) : null;
  const fila = (titulo: string, celda: (r: typeof resumen[number]) => React.ReactNode) => (
    <tr className="border-t border-zinc-100 bg-zinc-50/60 align-top">
      <td className="sticky left-0 z-10 bg-zinc-50 px-4 py-2 text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide">{titulo}</td>
      <td className="px-3 py-2" />
      {lecLink?.disponible && <td className="px-3 py-2" />}
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
              {lecLink?.disponible && (
                <th className="px-3 py-2.5 min-w-[190px] align-top">
                  <span className="block text-[13px] font-bold text-zinc-900 leading-tight">1 · Cotización por link</span>
                  <span className="block text-[11px] font-normal text-zinc-400">Precio leído de la página, neto</span>
                  {lecLink.totalPendientes > 0 && (
                    <button type="button" onClick={() => lecLink.leer()} disabled={!!lecLink.leyendo}
                      className="mt-1.5 text-[11.5px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-60 rounded-md px-2 py-0.5">
                      {lecLink.leyendo ? `Leyendo link ${lecLink.leyendo.actual} de ${lecLink.leyendo.total}…` : `Leer ${lecLink.totalPendientes} link${lecLink.totalPendientes === 1 ? '' : 's'} del costeo`}
                    </button>
                  )}
                </th>
              )}
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
              const precios = visibles.map(r => reemp.has(`${r.c.id}:${p.id}`) ? null : r.c.items.find(i => i.productoId === p.id)?.precioUnitario ?? null);
              const validos = precios.filter((x): x is number => x != null && x > 0);
              const mejor = validos.length >= 2 ? Math.min(...validos) : null;
              const sinCotizar = validos.length === 0 && visibles.every(r => !r.c.items.some(i => i.productoId === p.id));
              return (
                <tr key={p.id} className="border-b border-zinc-100 last:border-0 align-top">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <p className="text-[13px] font-semibold text-zinc-900 line-clamp-2" title={p.descripcion}>{p.descripcion}</p>
                    {sinCotizar && <p className="text-[11.5px] font-semibold text-amber-600 mt-0.5">Sin cotizar todavía</p>}
                  </td>
                  <td className="px-3 py-3 text-[13.5px] font-semibold text-zinc-700 whitespace-nowrap">
                    {base != null ? clp(base) : <span className="font-normal text-zinc-400" title="El costeo no tiene un costo para esta línea">—</span>}
                    {linksCosteo[p.id] && <div className="mt-0.5 [&_a]:max-w-[130px]"><LinksProducto links={linksCosteo[p.id].links} /></div>}
                  </td>
                  {lecLink?.disponible && (() => {
                    // La primera cotización: el link del costeo, leído por el Auditor. Precio neto, cuánto se aparta de lo costeado y de dónde salió.
                    const lec = lecLink.lecturas[p.id] ?? [];
                    const pend = lecLink.pendientesDe(p.id);
                    const leyendoEste = lecLink.leyendoProducto === p.id;
                    return (
                      <td className="px-2 py-2 min-w-[190px]" data-testid={`link-leido-${p.id}`}>
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 px-2.5 py-1.5 space-y-1.5">
                          {lec.map(l => {
                            const cmp = compararPrecioConCosteo(l.neto, base);
                            const est = ESTILO_VEREDICTO[cmp.veredicto];
                            // Un precio de una captura vieja no sirve para comprar: los precios de las tiendas cambian de un día para otro.
                            const horas = l.capturaAt ? (Date.now() - new Date(l.capturaAt).getTime()) / 36e5 : Infinity;
                            const vieja = horas > 24;
                            const dias = Math.floor(horas / 24);
                            const comprable = l.neto != null && !vieja && !l.agotado;
                            return (
                              <div key={l.opcionId}>
                                <span className="text-[14px] font-bold text-zinc-900">{l.neto != null ? clp(l.neto) : 'sin precio'}</span>
                                {l.neto != null && !l.agotado && <span className={`ml-1.5 inline-block text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${est.chip}`}>{est.texto(cmp.diffPct)}</span>}
                                <span className="block text-[11px] text-zinc-500">
                                  {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline underline-offset-2">{l.host}</a> : l.host}
                                  {l.capturaAt && <> · captura {vieja ? `de hace ${dias} día${dias === 1 ? '' : 's'} (${l.capturaAt.slice(0, 10)})` : 'de hoy'}</>}
                                </span>
                                {l.agotado && <span className="block text-[11px] font-bold text-rose-700">⛔ La página dice PRODUCTO AGOTADO: no se puede comprar por este link.</span>}
                                {vieja && <span className="block text-[11px] font-bold text-amber-700">⚠ Precio de una captura vieja: la tienda pudo cambiarlo. Vuelve a leer antes de comprar.</span>}
                                {l.neto != null && l.ivaSupuesto && <span className="block text-[11px] text-zinc-400">la página dice {l.precioPagina != null ? clp(l.precioPagina) : '—'} y no aclara el IVA: se asumió con IVA y se rebajó</span>}
                                {l.neto != null && !l.ivaSupuesto && l.precioPagina != null && l.precioPagina !== l.neto && <span className="block text-[11px] text-zinc-400">la página dice {clp(l.precioPagina)}{l.ivaDeclarado === 'incluido' ? ' con IVA' : ''}</span>}
                                {l.neto == null && <span className="block text-[11px] text-amber-700">{l.precioPagina != null ? `la página dice ${clp(l.precioPagina)} pero el IVA no está claro` : 'no se pudo leer el precio'}</span>}
                                {lecLink && (!l.neto || vieja || l.agotado) && l.url && (
                                  <button type="button" onClick={() => lecLink.releer(l.opcionId)} disabled={lecLink.releyendo != null}
                                    className="mt-0.5 mr-1 text-[11.5px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-60 rounded-md px-2 py-0.5">{lecLink.releyendo === l.opcionId ? 'Leyendo link…' : 'Volver a leer'}</button>
                                )}
                                {comprable && onCompraPorLink && l.url && (
                                  <button type="button" onClick={() => onCompraPorLink(p.id, { link: l.url!, precio: l.neto!, proveedor: l.proveedor || l.host })} title="Comprar este producto a este link: abre la compra directa con el precio y el link ya puestos"
                                    className="mt-0.5 text-[11.5px] font-semibold text-teal-700 hover:text-teal-900 border border-teal-200 hover:bg-teal-50 rounded-md px-2 py-0.5">Comprar por este link</button>
                                )}
                              </div>
                            );
                          })}
                          {pend.length > 0 && (
                            <button type="button" onClick={() => lecLink.leer(p.id)} disabled={!!lecLink.leyendo}
                              className="text-[12px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-60 rounded-md px-2 py-1">
                              {leyendoEste ? 'Leyendo link…' : `Leer link${pend.length > 1 ? `s (${pend.length})` : ''}`}
                            </button>
                          )}
                          {lec.length === 0 && pend.length === 0 && <span className="text-[12px] text-zinc-400">{linksCosteo[p.id]?.links.length ? 'Sin precio leído' : 'Sin link en el costeo'}</span>}
                        </div>
                      </td>
                    );
                  })()}
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
                    const reemplazadaPor = reemp.get(`${c.id}:${p.id}`);
                    const bloqueada = reemplazadaPor != null && !elegida;   // si ya estaba elegida se deja quitarla, no volver a elegirla
                    return (
                      <td key={c.id} className="px-2 py-2">
                        <div className={`relative rounded-lg border transition-colors ${reemplazadaPor != null ? 'opacity-50 bg-zinc-50 ' : ''}${elegida ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-200' : detalleActivo ? 'border-indigo-300 bg-indigo-50/30' : 'border-transparent hover:border-zinc-300 hover:bg-zinc-50'}`}>
                          {/* Clic en la celda = ver el detalle (desglose, adicionales, avisos). Agregar a la compra = solo el círculo. */}
                          {onElegirCelda && (
                            <button type="button" onClick={() => onElegirCelda(p.id, c.id)} aria-pressed={elegida} aria-label={elegida ? 'Quitar de mi compra' : 'Agregar a mi compra'} disabled={bloqueada}
                              title={bloqueada ? `Reemplazada por la cotización #${reemplazadaPor} del mismo proveedor` : elegida ? 'Quitar de mi compra' : 'Comprar este producto a este proveedor'}
                              className={`absolute top-2 left-2 z-10 p-1 -m-1 rounded-full ${bloqueada ? 'cursor-not-allowed' : ''}`}>
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
                            {tecnico && !incluido && (() => {
                              const t = tecnico[`${c.id}:${p.id}`];
                              if (!t) return <span className="block text-[11px] text-zinc-400 mt-1">sin ficha técnica</span>;
                              const e = ESTILO_TECNICO[t.estado] ?? ESTILO_TECNICO.NO_CORRIDO;
                              return <span title={`Ficha de ${t.modelo || 'este modelo'} contra las bases`} data-testid={`tecnico-${c.id}-${p.id}`} className={`inline-block mt-1 text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${e.chip}`}>Ficha: {e.texto}{t.total > 0 ? ` ${t.cumple}/${t.total}` : ''}</span>;
                            })()}
                            {reemplazadaPor != null && <span className="block text-[11px] font-semibold text-zinc-500 mt-0.5">Reemplazada por la #{reemplazadaPor}</span>}
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
            {tecnico && fila('Ficha técnica', r => {
              const celdas = r.c.items.map(i => tecnico[`${r.c.id}:${i.productoId}`]).filter(Boolean);
              if (celdas.length === 0) return <span className="text-zinc-300">sin fichas</span>;
              const malas = celdas.filter(t => t.estado === 'NO_CUMPLE').length;
              return <span className={malas > 0 ? 'font-semibold text-rose-600' : 'text-zinc-700'}>{celdas.filter(t => t.estado === 'CUMPLE').length} de {celdas.length} cumplen{malas > 0 ? ` · ${malas} no` : ''}</span>;
            })}
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
