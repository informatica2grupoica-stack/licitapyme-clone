'use client';

// COMPARADOR POR PRODUCTO — reemplaza como vista principal a la matriz (productos × proveedores), que con 10-20 cotizaciones obligaba a
// desplazarse a los lados. Aquí el eje es el PRODUCTO: cada uno es una tarjeta con TODAS sus ofertas en una lista vertical, de la más
// barata a la más cara (crece hacia abajo, no hacia el lado). Elegir = el círculo de la oferta. El cuadro «Por proveedor» resume cada
// cotización (qué cubre, total, plazo, avisos) y permite «Comprar todo aquí». Mismos datos, mismas acciones y mismas reglas que la matriz.
import { useMemo, useState } from 'react';
import { IconStar as Star, IconCheck as Check, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight, IconInfoCircle as Info, IconSearch as Search } from '@tabler/icons-react';
import { MenuAcciones } from '@/app/components/ui/MenuAcciones';
import { LinksProducto } from './LinksProducto';
import { compararPrecioConCosteo } from '@/app/lib/compras-precio-vs-costeo';
import { esLinkDeProducto } from '@/app/lib/costeo-comparativo';
import { margenCosteoVsCotizaciones } from '@/app/lib/compras-margen-vs-costeo';
import { MargenCosteoVsCotizaciones } from './MargenCosteoVsCotizaciones';
import { ESTILO_VEREDICTO, ESTILO_TECNICO, cotizacionesReemplazadas } from './MatrizPrecios';
import type { MatrizProps } from './MatrizPrecios';

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) && n > 0 ? n : 1; };

export function ComparadorPrecios({ productos, cotizaciones, costeado, venta, linksCosteo = {}, lecturaLink: lecLink, onCompraPorLink, seleccion, onSeleccionar, alertas, tecnico, onAgregar, compra, onElegirCelda, onComprarTodoAqui, acciones, onVerMatriz, costeoCompras = {} }: MatrizProps & { onVerMatriz?: () => void; costeoCompras?: Record<number, { costo: number | null; link: string }> }) {
  const [abiertos, setAbiertos] = useState<Set<number>>(() => new Set(productos.length <= 4 ? productos.map(p => p.id) : []));
  const [buscaProducto, setBuscaProducto] = useState('');
  const [buscaProveedor, setBuscaProveedor] = useState('');

  const reemp = useMemo(() => cotizacionesReemplazadas(cotizaciones), [cotizaciones]);
  const alternar = (id: number) => setAbiertos(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const resumen = useMemo(() => cotizaciones.map(c => {
    const cubiertos = productos.filter(p => c.items.some(i => i.productoId === p.id)).length;
    const total = productos.reduce((s, p) => { const it = c.items.find(i => i.productoId === p.id); return s + (it?.precioUnitario != null ? it.precioUnitario * num(p.cantidad) : 0); }, 0);
    const nAvisos = productos.reduce((s, p) => s + (alertas?.[`${c.id}:${p.id}`]?.length ?? 0), 0);
    return { c, cubiertos, faltan: productos.length - cubiertos, total, nAvisos };
  }), [cotizaciones, productos, alertas]);

  // Mejor precio por producto (sin las ofertas reemplazadas): el mismo «Mejor» de cada fila. null = sin cotización.
  const menorDe = useMemo(() => new Map(productos.map(p => {
    const v = cotizaciones.filter(c => !reemp.has(`${c.id}:${p.id}`)).map(c => c.items.find(i => i.productoId === p.id)?.precioUnitario).filter((x): x is number => x != null && x > 0);
    return [p.id, v.length ? Math.min(...v) : null] as const;
  })), [cotizaciones, productos, reemp]);

  // Margen del costeo inicial vs margen con las cotizaciones (Carolina, 27-oct-2026): misma venta, costo costeado vs mejor cotización por línea.
  const margen = useMemo(() => margenCosteoVsCotizaciones(productos.map(p => {
    const m = menorDe.get(p.id) ?? null;
    const proveedor = m == null ? null : cotizaciones.find(c => !reemp.has(`${c.id}:${p.id}`) && c.items.find(i => i.productoId === p.id)?.precioUnitario === m)?.proveedorNombre ?? null;
    return { id: p.id, descripcion: p.descripcion, cantidad: num(p.cantidad), venta: venta?.[p.id] ?? null, costeo: costeado[p.id] ?? null, cotizado: m, proveedor, compras: costeoCompras[p.id]?.costo ?? null };
  })), [productos, cotizaciones, costeado, venta, menorDe, reemp, costeoCompras]);

  if (productos.length === 0 || (cotizaciones.length === 0 && !lecLink?.disponible)) return null;

  const totales = resumen.filter(r => r.faltan === 0 && r.total > 0 && r.nAvisos === 0).map(r => r.total);
  const menorTotal = totales.length >= 2 ? Math.min(...totales) : null;
  const productosVisibles = productos.filter(p => !buscaProducto.trim() || p.descripcion.toLowerCase().includes(buscaProducto.trim().toLowerCase()));
  const resumenVisible = resumen.filter(r => !buscaProveedor.trim() || r.c.proveedorNombre.toLowerCase().includes(buscaProveedor.trim().toLowerCase()));
  const nElegidos = productos.filter(p => compra?.[p.id] != null).length;

  const menuDe = (c: typeof cotizaciones[number]) => acciones ? (
    <MenuAcciones etiqueta={`Más acciones de la cotización #${c.id}`} acciones={[
      ...(c.archivoUrl ? [{ label: 'Ver el archivo', onClick: () => window.open(c.archivoUrl!, '_blank', 'noopener,noreferrer') }] : []),
      { label: 'Qué productos cubre', onClick: () => acciones.onAsignar(c.id) },
      { label: acciones.ocupadoId === c.id ? 'Leyendo con IA…' : 'Volver a leer con IA', onClick: () => acciones.onHomologar(c.id), disabled: acciones.ocupadoId === c.id },
      { label: 'Editar datos', onClick: () => acciones.onEditar(c.id) },
      { label: 'Eliminar cotización', onClick: () => acciones.onEliminar(c.id), peligro: true },
    ]} />
  ) : null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden" data-testid="comparador-precios">
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-zinc-900">Compara y elige a quién comprar</p>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">Cada producto con todas sus ofertas, de la más barata a la más cara (neto por unidad contra lo costeado). <b className="font-semibold text-zinc-700">Marca el círculo</b> de la oferta que quieres comprar, o usa <b className="font-semibold text-zinc-700">«Comprar todo aquí»</b> en el cuadro «Por proveedor».</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {nElegidos > 0 && <span className="text-[12px] font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-0.5">{nElegidos} de {productos.length} elegidos</span>}
          {lecLink?.disponible && lecLink.totalPendientes > 0 && (
            <button type="button" onClick={() => lecLink.leer()} disabled={!!lecLink.leyendo}
              className="text-[12px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-60 rounded-lg px-2.5 py-1">
              {lecLink.leyendo ? `Leyendo link ${lecLink.leyendo.actual} de ${lecLink.leyendo.total}…` : `Leer ${lecLink.totalPendientes} link${lecLink.totalPendientes === 1 ? '' : 's'} del costeo`}
            </button>
          )}
          <button type="button" onClick={() => setAbiertos(abiertos.size >= productos.length ? new Set() : new Set(productos.map(p => p.id)))}
            className="text-[12px] font-semibold text-zinc-600 hover:text-zinc-900 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-lg px-2.5 py-1">
            {abiertos.size >= productos.length ? 'Plegar todos' : 'Desplegar todos'}
          </button>
          {onVerMatriz && <button type="button" onClick={onVerMatriz} className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-800 underline underline-offset-2">Ver como matriz</button>}
        </div>
      </div>

      {productos.length > 6 && (
        <div className="px-4 py-2 border-b border-zinc-100">
          <label className="relative block max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={buscaProducto} onChange={e => setBuscaProducto(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto"
              className="w-full text-[12.5px] border border-zinc-200 rounded-lg pl-8 pr-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          </label>
        </div>
      )}

      {/* Encabezado de la tabla: los tres precios de cada producto, en columnas (costeo · costeo de Compras · cotización). */}
      <div className="hidden md:flex items-center gap-3 px-4 py-1.5 border-b border-zinc-100 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
        <span className="flex-1 pl-7">Producto</span>
        <span className="w-[104px] text-right">Costeo</span>
        <span className="w-[124px] text-right">Costeo compras</span>
        <span className="w-[230px]">Cotización (mejor)</span>
        <span className="w-[150px] text-right">Elegido</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {productosVisibles.map(p => {
          const base = costeado[p.id] ?? null;
          const abierto = abiertos.has(p.id);
          const ofertas = cotizaciones.flatMap(c => {
            const item = c.items.find(i => i.productoId === p.id);
            return item ? [{ c, item }] : [];
          }).sort((a, b) => (a.item.precioUnitario ?? Infinity) - (b.item.precioUnitario ?? Infinity));
          const validos = ofertas.filter(o => !reemp.has(`${o.c.id}:${p.id}`)).map(o => o.item.precioUnitario).filter((x): x is number => x != null && x > 0);
          const mejor = validos.length >= 2 ? Math.min(...validos) : null;
          const menor = validos.length ? Math.min(...validos) : null;
          const elegidaId = compra?.[p.id];
          const elegida = elegidaId != null ? cotizaciones.find(c => c.id === elegidaId) : null;
          const lecturas = lecLink?.disponible ? (lecLink.lecturas[p.id] ?? []) : [];
          const pendLink = lecLink?.disponible ? lecLink.pendientesDe(p.id) : [];
          const sinOfertas = ofertas.length === 0 && lecturas.length === 0;
          const cmpMenor = menor != null ? compararPrecioConCosteo(menor, base) : null;
          const faltan = cotizaciones.filter(c => !c.items.some(i => i.productoId === p.id));
          return (
            <section key={p.id} aria-label={p.descripcion}>
              <button type="button" onClick={() => alternar(p.id)} aria-expanded={abierto}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-zinc-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500 outline-none">
                {abierto ? <ChevronDown size={16} className="text-zinc-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-zinc-400 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-zinc-900 truncate" title={p.descripcion}>{p.descripcion}</p>
                  <p className="text-[11.5px] text-zinc-500">
                    {p.cantidad != null && <>{num(p.cantidad)} un.</>}
                    <span className="md:hidden"> · Costeado {base != null ? <b className="text-zinc-700">{clp(base)}</b> : '—'}</span>
                    {sinOfertas && <b className="ml-2 text-amber-600">Sin cotizar todavía</b>}
                  </p>
                </div>
                <div className="hidden md:flex items-center gap-3 text-[12px] flex-shrink-0">
                  <span className="w-[104px] text-right tabular-nums text-zinc-700 font-semibold" title="Costo neto por unidad que costeó licitaciones">{base != null ? clp(base) : <span className="text-zinc-300">—</span>}</span>
                  <span className="w-[124px] text-right tabular-nums" title="Costo neto por unidad que costeó Compras (columna «Costo unit. COMPRAS» del costeo)">
                    {costeoCompras[p.id]?.costo != null ? (
                      <>
                        {costeoCompras[p.id].link && esLinkDeProducto(costeoCompras[p.id].link) && (
                          <a href={costeoCompras[p.id].link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="mr-1.5 text-[11px] text-teal-700 underline underline-offset-2">link</a>
                        )}
                        <b className="text-zinc-900">{clp(costeoCompras[p.id].costo!)}</b>
                      </>
                    ) : <span className="text-zinc-300">—</span>}
                  </span>
                  <span className="w-[230px] flex items-center gap-1.5">
                    {menor != null && cmpMenor ? (
                      <>
                        <b className="text-zinc-900 tabular-nums">{clp(menor)}</b>
                        <span className={`font-semibold px-1.5 py-0.5 rounded border ${ESTILO_VEREDICTO[cmpMenor.veredicto].chip}`}>{ESTILO_VEREDICTO[cmpMenor.veredicto].texto(cmpMenor.diffPct)}</span>
                        <span className="text-zinc-400">· {ofertas.length} oferta{ofertas.length === 1 ? '' : 's'}</span>
                      </>
                    ) : <span className="text-zinc-300" title="Sin cotización: se toma lo costeado">sin cotización</span>}
                  </span>
                </div>
                <span className="flex-shrink-0 md:w-[150px] md:text-right">
                  <span className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-full border ${elegida ? 'text-teal-800 bg-teal-50 border-teal-200' : 'text-zinc-400 bg-white border-zinc-200'}`}>
                    {elegida ? <><Check size={11} className="inline -mt-0.5 mr-0.5" />{elegida.proveedorNombre.length > 22 ? `${elegida.proveedorNombre.slice(0, 22)}…` : elegida.proveedorNombre}</> : 'Sin elegir'}
                  </span>
                </span>
              </button>

              {abierto && (
                <div className="px-4 pb-3 pl-11 space-y-1.5">
                  {linksCosteo[p.id] && <div className="text-[11.5px] text-zinc-500 flex items-center gap-1.5">Link del costeo: <span className="[&_a]:max-w-[220px]"><LinksProducto links={linksCosteo[p.id].links} /></span></div>}

                  {lecturas.map(l => {
                    const cmp = compararPrecioConCosteo(l.neto, base);
                    const est = ESTILO_VEREDICTO[cmp.veredicto];
                    const horas = l.capturaAt ? (Date.now() - new Date(l.capturaAt).getTime()) / 36e5 : Infinity;
                    const vieja = horas > 24; const dias = Math.floor(horas / 24);
                    const comprable = l.neto != null && !vieja && !l.agotado;
                    return (
                      <div key={`l-${l.opcionId}`} className="rounded-lg border border-indigo-100 bg-indigo-50/30 px-3 py-2 flex items-center gap-x-4 gap-y-1 flex-wrap" data-testid={`link-leido-${p.id}`}>
                        <span className="text-[11px] font-bold text-indigo-700 bg-white border border-indigo-200 rounded px-1.5 py-0.5">Por link</span>
                        <span className="text-[14px] font-bold text-zinc-900 tabular-nums">{l.neto != null ? clp(l.neto) : 'sin precio'}</span>
                        {l.neto != null && !l.agotado && <span className={`text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${est.chip}`}>{est.texto(cmp.diffPct)}</span>}
                        <span className="text-[11.5px] text-zinc-500">
                          {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline underline-offset-2">{l.host}</a> : l.host}
                          {l.capturaAt && <> · captura {vieja ? `de hace ${dias} día${dias === 1 ? '' : 's'}` : 'de hoy'}</>}
                        </span>
                        {l.agotado && <span className="text-[11.5px] font-bold text-rose-700">⛔ Producto agotado: no se puede comprar por este link</span>}
                        {vieja && !l.agotado && <span className="text-[11.5px] font-bold text-amber-700">⚠ Captura vieja: vuelve a leer antes de comprar</span>}
                        {l.neto != null && l.ivaSupuesto && <span className="text-[11px] text-zinc-400">IVA no aclarado: se asumió incluido y se rebajó</span>}
                        <span className="ml-auto flex items-center gap-1.5">
                          {lecLink && (!l.neto || vieja || l.agotado) && l.url && (
                            <button type="button" onClick={() => lecLink.releer(l.opcionId)} disabled={lecLink.releyendo != null}
                              className="text-[11.5px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-60 rounded-md px-2 py-0.5">{lecLink.releyendo === l.opcionId ? 'Leyendo…' : 'Volver a leer'}</button>
                          )}
                          {comprable && onCompraPorLink && l.url && (
                            <button type="button" onClick={() => onCompraPorLink(p.id, { link: l.url!, precio: l.neto!, proveedor: l.proveedor || l.host })}
                              className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-900 border border-teal-200 hover:bg-teal-50 rounded-md px-2 py-0.5">Comprar por este link</button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  {pendLink.length > 0 && lecLink && (
                    <button type="button" onClick={() => lecLink.leer(p.id)} disabled={!!lecLink.leyendo}
                      className="text-[12px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-60 rounded-md px-2 py-1">
                      {lecLink.leyendoProducto === p.id ? 'Leyendo link…' : `Leer el link del costeo${pendLink.length > 1 ? ` (${pendLink.length})` : ''}`}
                    </button>
                  )}

                  {ofertas.map(({ c, item }) => {
                    const cmp = compararPrecioConCosteo(item.precioUnitario, base);
                    const est = ESTILO_VEREDICTO[cmp.veredicto];
                    const incluido = item.precioBase === 0;
                    const esElegida = compra?.[p.id] === c.id;
                    const esMejor = mejor != null && item.precioUnitario === mejor;
                    const detalleActivo = seleccion?.cotizacionId === c.id && seleccion.productoId === p.id;
                    const al = alertas?.[`${c.id}:${p.id}`] ?? [];
                    const t = tecnico?.[`${c.id}:${p.id}`];
                    const et = t ? (ESTILO_TECNICO[t.estado] ?? ESTILO_TECNICO.NO_CORRIDO) : null;
                    const reemplazadaPor = reemp.get(`${c.id}:${p.id}`);
                    const bloqueada = reemplazadaPor != null && !esElegida;   // si ya estaba elegida se deja quitarla, no volver a elegirla
                    return (
                      <div key={c.id} className={`rounded-lg border px-3 py-2 flex items-center gap-x-4 gap-y-1 flex-wrap transition-colors ${reemplazadaPor != null ? 'opacity-50 bg-zinc-50 ' : ''}${esElegida ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-200' : detalleActivo ? 'border-indigo-300 bg-indigo-50/30' : 'border-zinc-200 hover:border-zinc-300'}`}>
                        {onElegirCelda && (
                          <button type="button" onClick={() => onElegirCelda(p.id, c.id)} aria-pressed={esElegida} aria-label={`${esElegida ? 'Quitar de mi compra' : 'Comprar este producto a'} ${c.proveedorNombre}`} disabled={bloqueada}
                            title={bloqueada ? `Reemplazada por la cotización #${reemplazadaPor} del mismo proveedor` : esElegida ? 'Quitar de mi compra' : 'Comprar este producto a este proveedor'} className={`p-1 -m-1 rounded-full focus-visible:ring-2 focus-visible:ring-teal-500 outline-none ${bloqueada ? 'cursor-not-allowed' : ''}`}>
                            <span className={`flex w-5 h-5 rounded-full border items-center justify-center ${esElegida ? 'bg-teal-600 border-teal-600 text-white' : 'border-zinc-300 bg-white hover:border-teal-500'}`}>{esElegida && <Check size={12} />}</span>
                          </button>
                        )}
                        <div className="min-w-[170px] flex-1">
                          <p className="text-[13px] font-semibold text-zinc-900 leading-tight" title={c.proveedorNombre}>{c.proveedorNombre}</p>
                          <p className="text-[11px] text-zinc-400">Cotización #{c.id}{c.plazoEntregaTexto ? ` · ${c.plazoEntregaTexto}` : ''}</p>
                          {reemplazadaPor != null && <p className="text-[11px] font-semibold text-zinc-500">Reemplazada por la #{reemplazadaPor} del mismo proveedor</p>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-bold text-zinc-900 tabular-nums">{item.precioUnitario != null ? clp(item.precioUnitario) : 'sin precio'}</span>
                          {esMejor && <span title="Mejor precio de este producto" className="inline-flex items-center gap-0.5 text-[10.5px] font-bold text-amber-600"><Star size={12} className="fill-amber-400" /> Mejor</span>}
                          {incluido
                            ? <span className="text-[11.5px] font-semibold text-sky-700">Incluido en otro producto</span>
                            : <span className={`text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${est.chip}`}>{est.texto(cmp.diffPct)}</span>}
                        </div>
                        {tecnico && !incluido && (et && t
                          ? <span title={`Ficha de ${t.modelo || 'este modelo'} contra las bases`} data-testid={`tecnico-${c.id}-${p.id}`} className={`text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${et.chip}`}>Ficha: {et.texto}{t.total > 0 ? ` ${t.cumple}/${t.total}` : ''}</span>
                          : <span className="text-[11.5px] text-zinc-400">sin ficha técnica</span>)}
                        {item.adicionales.length > 0 && <span className="text-[11px] text-zinc-400">incluye {item.adicionales.length} adicional{item.adicionales.length === 1 ? '' : 'es'}</span>}
                        {al.map(x => <span key={x} className="text-[11.5px] font-bold text-rose-600">⚠ {x}</span>)}
                        <span className="ml-auto flex items-center gap-1">
                          <button type="button" onClick={() => onSeleccionar({ cotizacionId: c.id, productoId: p.id })} title="Ver el detalle de este precio (desglose, adicionales, avisos)"
                            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-zinc-500 hover:text-indigo-700 px-2 py-1 rounded-md hover:bg-white"><Info size={13} /> Detalle</button>
                        </span>
                      </div>
                    );
                  })}

                  {sinOfertas && <p className="text-[12px] text-zinc-400">Todavía no hay ofertas para este producto: sube cotizaciones con «Cargar varias cotizaciones» o registra una compra directa.</p>}

                  {onAgregar && faltan.length > 0 && ofertas.length > 0 && (
                    <details className="text-[11.5px] text-zinc-500">
                      <summary className="cursor-pointer font-semibold hover:text-zinc-800">Agregar este producto a otra cotización ({faltan.length})</summary>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {faltan.map(c => (
                          <button key={c.id} type="button" onClick={() => onAgregar(c.id)} title="Agregar este producto a esta cotización: con precio, o «va incluido» en otro producto"
                            className="px-2 py-0.5 rounded-md border border-dashed border-zinc-300 text-zinc-600 hover:border-teal-400 hover:text-teal-700">+ {c.proveedorNombre} #{c.id}</button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {productosVisibles.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-zinc-400">Ningún producto coincide con la búsqueda.</p>}
      </div>

      {cotizaciones.length > 0 && (
        <details open={cotizaciones.length <= 8} className="border-t border-zinc-200">
          <summary className="px-4 py-2.5 cursor-pointer bg-zinc-50 text-[12.5px] font-bold text-zinc-700 hover:bg-zinc-100">Por proveedor <span className="font-normal text-zinc-400">({cotizaciones.length} cotización{cotizaciones.length === 1 ? '' : 'es'}: qué cubre cada una y cuánto costaría comprarle todo)</span></summary>
          {cotizaciones.length > 8 && (
            <div className="px-4 py-2">
              <input value={buscaProveedor} onChange={e => setBuscaProveedor(e.target.value)} placeholder="Buscar proveedor…" aria-label="Buscar proveedor"
                className="w-full max-w-xs text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="border-y border-zinc-200 text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Proveedor</th><th className="px-3 py-2">Cubre</th><th className="px-3 py-2 text-right">Total si compras aquí</th><th className="px-3 py-2">Plazo</th><th className="px-3 py-2">Avisos</th><th className="px-3 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {resumenVisible.map(({ c, cubiertos, faltan, total, nAvisos }) => (
                  <tr key={c.id} className="border-b border-zinc-100 last:border-0 align-middle">
                    <td className="px-4 py-2"><p className="text-[13px] font-semibold text-zinc-900">{c.proveedorNombre}</p><p className="text-[11px] text-zinc-400">Cotización #{c.id}</p></td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap">{faltan === 0 ? <span className="font-semibold text-emerald-700">Todos ({cubiertos} de {productos.length})</span> : <span className="font-semibold text-amber-700">{cubiertos} de {productos.length} · faltan {faltan}</span>}</td>
                    <td className="px-3 py-2 text-right text-[13px] font-bold text-zinc-900 tabular-nums whitespace-nowrap">{total > 0 ? clp(total) : <span className="text-zinc-300">—</span>}{menorTotal != null && faltan === 0 && nAvisos === 0 && total === menorTotal && <span className="ml-1 text-[10.5px] font-bold text-amber-600">★ menor</span>}</td>
                    <td className="px-3 py-2 text-[12.5px] text-zinc-700">{c.plazoEntregaTexto || <span className="text-zinc-300">no dice</span>}</td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap">{nAvisos > 0 ? <span className="font-bold text-rose-600">⚠ {nAvisos}</span> : <span className="text-emerald-600">sin avisos</span>}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {onComprarTodoAqui && cubiertos > 0 && (
                        <button type="button" onClick={() => onComprarTodoAqui(c.id)} className="text-[11.5px] font-semibold text-teal-700 border border-teal-200 hover:border-teal-400 hover:bg-teal-50 rounded-md px-2 py-1 mr-1">
                          {cubiertos === productos.length ? 'Comprar todo aquí' : `Comprar lo que cubre (${cubiertos})`}
                        </button>
                      )}
                      {menuDe(c)}
                    </td>
                  </tr>
                ))}
                {resumenVisible.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-center text-[12.5px] text-zinc-400">Ningún proveedor coincide con la búsqueda.</td></tr>}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {(margen.lineas.length > 0 || margen.sinVenta > 0 || margen.sinCosteo < productos.length) && <MargenCosteoVsCotizaciones resumen={margen} />}
      <p className="px-4 py-2 text-[11.5px] text-zinc-400 border-t border-zinc-100">Verde: más barata que lo costeado · Rojo: más cara · Azul: igual (±1 %) · Gris: no se puede comparar. ⚠ rojo = un problema del proveedor (plazo, RUT, mínimo de venta, falta un componente).</p>
    </div>
  );
}
