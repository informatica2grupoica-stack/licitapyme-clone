'use client';

// COMPARADOR POR PRODUCTO — reemplaza como vista principal a la matriz (productos × proveedores), que con 10-20 cotizaciones obligaba a
// desplazarse a los lados. Aquí el eje es el PRODUCTO: cada uno es una tarjeta con TODAS sus ofertas en una lista vertical, de la más
// barata a la más cara (crece hacia abajo, no hacia el lado). Elegir = el círculo de la oferta. El cuadro «Por proveedor» resume cada
// cotización (qué cubre, total, plazo, avisos) y permite «Comprar todo aquí». Mismos datos, mismas acciones y mismas reglas que la matriz.
import { useMemo, useState } from 'react';
import { IconStar as Star, IconCheck as Check, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight, IconSearch as Search } from '@tabler/icons-react';
import { MenuAcciones } from '@/app/components/ui/MenuAcciones';
import { LinksProducto } from './LinksProducto';
import { compararPrecioConCosteo, totalAdicionales, type AdicionalCotizacion } from '@/app/lib/compras-precio-vs-costeo';
import { esLinkDeProducto } from '@/app/lib/costeo-comparativo';
import { margenCosteoVsCotizaciones, GASTO_ENTREGA_PCT } from '@/app/lib/compras-margen-vs-costeo';
import { MargenCosteoVsCotizaciones } from './MargenCosteoVsCotizaciones';
import { ESTILO_VEREDICTO, ESTILO_TECNICO, cotizacionesReemplazadas } from './MatrizPrecios';
import type { MatrizProps } from './MatrizPrecios';
import { lineasPendientes } from './ListaCotizaciones';
import type { LineaCotizacion } from '@/app/lib/compras-cotizacion-lineas';

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) && n > 0 ? n : 1; };

const fechaCorta = (s: string) => { const [d, h] = s.split(' '); const [y, m, dd] = d.split('-'); return `${dd}-${m}-${y}${h ? ` ${h.slice(0, 5)}` : ''}`; };
const leerNumero = (s: string) => Number(s.trim().replace(/\./g, '').replace(',', '.'));

type ProductoCmp = MatrizProps['productos'][number];

/** Cantidad a comprar de un producto (migration-179): el costeo dice 30 y se compran 20, sin tocar el costeo. Muestra lo que cambia
 *  el total a precio costeado y pide la observación, que después se ve aquí, en la aprobación y en el historial. */
function CantidadAComprar({ p, base, onGuardar }: { p: ProductoCmp; base: number | null; onGuardar?: (productoId: number, cantidad: number, motivo: string) => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actual = p.cantidad != null ? num(p.cantidad) : null;
  const delCosteo = p.cantidadMotivo ? (p.cantidadCosteo ?? null) : actual;
  const nueva = leerNumero(valor);
  const valida = Number.isFinite(nueva) && nueva > 0;
  const vuelve = valida && delCosteo != null && nueva === delCosteo;
  const un = p.unidad || 'un.';
  const abrir = () => { setValor(actual != null ? String(actual) : ''); setMotivo(p.cantidadMotivo ?? ''); setError(null); setEditando(true); };
  const guardar = async () => {
    if (!onGuardar || !valida || (!vuelve && !motivo.trim())) return;
    setGuardando(true); setError(null);
    try { await onGuardar(p.id, nueva, vuelve ? '' : motivo.trim()); setEditando(false); }
    catch (e: any) { setError(e.message || 'No se pudo guardar.'); }
    finally { setGuardando(false); }
  };

  if (!editando) return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[12px] text-zinc-600">
      <span>Cantidad a comprar: <b className="text-zinc-900 tabular-nums">{actual ?? '—'} {un}</b>
        {p.cantidadMotivo && delCosteo != null && <span className="text-zinc-400"> (costeo: {delCosteo})</span>}
        {base != null && actual != null && <span className="text-zinc-400"> · a lo costeado {actual} × {clp(base)} = <b className="text-zinc-700">{clp(actual * base)}</b></span>}
      </span>
      {onGuardar && <button type="button" onClick={abrir} className="text-[12px] font-semibold text-teal-700 hover:underline underline-offset-2">Cambiar cantidad</button>}
    </div>
  );

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 space-y-2" data-testid={`editar-cantidad-${p.id}`}>
      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-[11.5px] font-semibold text-zinc-600">Cantidad a comprar
          <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" autoFocus
            className="mt-0.5 block w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[13px] tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
        </label>
        <span className="text-[12px] text-zinc-500 pb-1.5">Costeo: <b className="text-zinc-700">{delCosteo ?? '—'} {un}</b>
          {base != null && valida && delCosteo != null && nueva !== delCosteo && (
            <> · a lo costeado {clp(delCosteo * base)} → <b className="text-zinc-900">{clp(nueva * base)}</b> <span className={nueva < delCosteo ? 'text-emerald-700' : 'text-red-600'}>({nueva < delCosteo ? '−' : '+'}{clp(Math.abs(nueva - delCosteo) * base)})</span></>
          )}
        </span>
      </div>
      {vuelve
        ? <p className="text-[12px] text-zinc-600">Es la misma cantidad del costeo: al guardar se quita el cambio y la observación.</p>
        : <label className="block text-[11.5px] font-semibold text-zinc-600">Observación (obligatoria: la ve quien aprueba la compra)
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ej.: hay 10 en bodega, se compran solo 20"
              className="mt-0.5 block w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12.5px] font-normal focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
          </label>}
      <p className="text-[11.5px] text-zinc-500">El costeo no se cambia. Si la compra ya estaba aprobada, al guardar vuelve a quedar por aprobar.</p>
      {error && <p className="text-[12px] font-semibold text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={guardar} disabled={guardando || !valida || (!vuelve && !motivo.trim())}
          className="rounded-md bg-teal-600 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" onClick={() => setEditando(false)} disabled={guardando} className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-[12.5px] font-semibold text-zinc-700 hover:bg-zinc-50">Cancelar</button>
      </div>
    </div>
  );
}

export function ComparadorPrecios({ productos, cotizaciones, costeado, venta, linksCosteo = {}, lecturaLink: lecLink, onCompraPorLink, seleccion, onSeleccionar, alertas, tecnico, onAgregar, compra, onElegirCelda, onComprarTodoAqui, acciones, onVerMatriz, costeoCompras = {}, onAgregarLinea, onCambiarCantidad }: MatrizProps & {
  onVerMatriz?: () => void; costeoCompras?: Record<number, { costo: number | null; link: string }>;
  /** Cambia la cantidad a comprar de un producto con observación, sin tocar el costeo (migration-179). */
  onCambiarCantidad?: (productoId: number, cantidad: number, motivo: string) => Promise<void>;
  /** Suma una línea del documento que no quedó en ningún producto (acoples, manguera…) como adicional de ESE producto en esa cotización. */
  onAgregarLinea?: (cotizacionId: number, linea: LineaCotizacion, productoId: number) => Promise<void>;
}) {
  const [abiertos, setAbiertos] = useState<Set<number>>(() => new Set(productos.length <= 4 ? productos.map(p => p.id) : []));
  const [agregandoLinea, setAgregandoLinea] = useState<string | null>(null);
  // Líneas del documento sin usar, por cotización (las cotizaciones llegan completas, con el texto del documento).
  const pendientesPorCot = useMemo(() => new Map(cotizaciones.map(c => [c.id, lineasPendientes(c as unknown as Parameters<typeof lineasPendientes>[0], productos)] as const)), [cotizaciones, productos]);
  const [buscaProducto, setBuscaProducto] = useState('');
  const [buscaProveedor, setBuscaProveedor] = useState('');
  // Productos con las cotizaciones reemplazadas desplegadas (por defecto van plegadas en una línea).
  const [conReemplazadas, setConReemplazadas] = useState<Set<number>>(() => new Set());

  const reemp = useMemo(() => cotizacionesReemplazadas(cotizaciones), [cotizaciones]);
  const alternar = (id: number) => setAbiertos(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const resumen = useMemo(() => cotizaciones.map(c => {
    const cubiertos = productos.filter(p => c.items.some(i => i.productoId === p.id)).length;
    const subtotal = productos.reduce((s, p) => { const it = c.items.find(i => i.productoId === p.id); return s + (it?.precioUnitario != null ? it.precioUnitario * num(p.cantidad) : 0); }, 0);
    // El flete que el proveedor cobra aparte se suma al total (antes quedaba fuera y el total parecía solo los productos).
    const flete = subtotal > 0 && c.fleteMonto != null && c.fleteMonto > 0 ? c.fleteMonto : 0;
    const nAvisos = productos.reduce((s, p) => s + (alertas?.[`${c.id}:${p.id}`]?.length ?? 0), 0);
    return { c, cubiertos, faltan: productos.length - cubiertos, subtotal, flete, total: subtotal + flete, nAvisos };
  }), [cotizaciones, productos, alertas]);

  // Mejor precio por producto (sin las ofertas reemplazadas): el mismo «Mejor» de cada fila. null = sin cotización.
  const menorDe = useMemo(() => new Map(productos.map(p => {
    const v = cotizaciones.filter(c => !reemp.has(`${c.id}:${p.id}`)).map(c => c.items.find(i => i.productoId === p.id)?.precioUnitario).filter((x): x is number => x != null && x > 0);
    return [p.id, v.length ? Math.min(...v) : null] as const;
  })), [cotizaciones, productos, reemp]);

  // Margen del costeo inicial vs margen con las cotizaciones (Carolina, 27-oct-2026): misma venta, costo costeado vs mejor cotización por línea.
  const margen = useMemo(() => margenCosteoVsCotizaciones(productos.filter(p => !p.esServicio).map(p => {
    const m = menorDe.get(p.id) ?? null;
    const proveedor = m == null ? null : cotizaciones.find(c => !reemp.has(`${c.id}:${p.id}`) && c.items.find(i => i.productoId === p.id)?.precioUnitario === m)?.proveedorNombre ?? null;
    return { id: p.id, descripcion: p.descripcion, cantidad: num(p.cantidad), venta: venta?.[p.id] ?? null, costeo: costeado[p.id] ?? null, cotizado: m, proveedor, compras: costeoCompras[p.id]?.costo ?? null };
  }), GASTO_ENTREGA_PCT), [productos, cotizaciones, costeado, venta, menorDe, reemp, costeoCompras]);

  // Fletes que cobran aparte los proveedores que dan el mejor precio de alguna línea: el cuadro de margen los muestra junto a la reserva.
  const fletesCotizados: Array<{ proveedor: string; cotizacionId: number; monto: number; nombre?: string }> = cotizaciones
    .filter(c => c.fleteMonto != null && c.fleteMonto > 0 && margen.lineas.some(l => l.cotizada && l.proveedor === c.proveedorNombre))
    .map(c => ({ proveedor: c.proveedorNombre, cotizacionId: c.id, monto: c.fleteMonto as number, nombre: undefined as string | undefined }));
  // Fletes agregados en «Fletes» (servicios): su mejor oferta cuenta como flete real contra la reserva del 5 %.
  for (const p of productos.filter(p => p.esServicio)) {
    const m = menorDe.get(p.id); if (m == null) continue;
    const c = cotizaciones.find(c => !reemp.has(`${c.id}:${p.id}`) && c.items.find(i => i.productoId === p.id)?.precioUnitario === m);
    fletesCotizados.push({ proveedor: c?.proveedorNombre ?? '', cotizacionId: c?.id ?? 0, monto: m * num(p.cantidad), nombre: p.descripcion });
  }

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

  // Una oferta: proveedor, precio por unidad y, debajo, QUÉ TRAE ese precio (producto solo + cada adicional), para comparar
  // ofertas equivalentes: el precio guardado ya es producto + adicionales (compras-adicionales.ts).
  const filaOferta = (p: typeof productos[number], { c, item }: { c: typeof cotizaciones[number]; item: typeof cotizaciones[number]['items'][number] }, base: number | null, mejor: number | null) => {
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
    const ads = item.adicionales as AdicionalCotizacion[];
    const sumaAds = totalAdicionales(ads);
    const soloProducto = item.precioBase != null ? item.precioBase : item.precioUnitario != null ? item.precioUnitario - sumaAds : null;
    const pendientes = onAgregarLinea && !bloqueada ? (pendientesPorCot.get(c.id) ?? []) : [];
    const acc = [
      ...(c.archivoUrl ? [{ label: 'Ver cotización', onClick: () => window.open(c.archivoUrl!, '_blank', 'noopener,noreferrer') }] : []),
      { label: 'Ver detalle del precio', onClick: () => onSeleccionar({ cotizacionId: c.id, productoId: p.id }) },
      ...(acciones ? [{ label: 'Cambiar producto', onClick: () => acciones.onAsignar(c.id) }] : []),
    ];
    return (
      <div key={c.id} className={`rounded-lg border px-3 py-2 transition-colors ${reemplazadaPor != null ? 'opacity-60 bg-zinc-50 ' : ''}${esElegida ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-200' : detalleActivo ? 'border-teal-300 bg-teal-50/20' : 'border-zinc-200 hover:border-zinc-300'}`}>
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
          {onElegirCelda && (
            <button type="button" onClick={() => onElegirCelda(p.id, c.id)} aria-pressed={esElegida} aria-label={`${esElegida ? 'Quitar de mi compra' : 'Comprar este producto a'} ${c.proveedorNombre}`} disabled={bloqueada}
              title={bloqueada ? `Reemplazada por la cotización #${reemplazadaPor} del mismo proveedor` : esElegida ? 'Quitar de mi compra' : 'Comprar este producto a este proveedor'} className={`p-1 -m-1 rounded-full focus-visible:ring-2 focus-visible:ring-teal-500 outline-none ${bloqueada ? 'cursor-not-allowed' : ''}`}>
              <span className={`flex w-5 h-5 rounded-full border items-center justify-center ${esElegida ? 'bg-teal-600 border-teal-600 text-white' : 'border-zinc-300 bg-white hover:border-teal-500'}`}>{esElegida && <Check size={12} />}</span>
            </button>
          )}
          <div className="min-w-[170px] flex-1">
            <p className="text-[13px] font-semibold text-zinc-900 leading-tight" title={c.proveedorNombre}>{c.proveedorNombre}</p>
            <p className="text-[11.5px] text-zinc-500">
              Cotización #{c.id}{c.plazoEntregaTexto ? ` · ${c.plazoEntregaTexto}` : ''}
              {' · '}{incluido ? 'va incluido en otro producto' : ads.length > 0 ? <b className="font-semibold text-zinc-700">producto + {ads.length} adicional{ads.length === 1 ? '' : 'es'}</b> : 'solo el producto, sin adicionales'}
            </p>
            {reemplazadaPor != null && <p className="text-[11px] font-semibold text-zinc-500">Reemplazada por la #{reemplazadaPor} del mismo proveedor</p>}
          </div>
          {tecnico && !incluido && (et && t
            ? <span title={`Ficha de ${t.modelo || 'este modelo'} contra las bases`} data-testid={`tecnico-${c.id}-${p.id}`} className={`text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${et.chip}`}>Ficha: {et.texto}{t.total > 0 ? ` ${t.cumple}/${t.total}` : ''}</span>
            : <span className="text-[11.5px] text-zinc-400">sin ficha técnica</span>)}
          <div className="flex flex-col items-end">
            <span className="flex items-center gap-1.5">
              {esMejor && <span title="Mejor precio de este producto" className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600"><Star size={12} className="fill-amber-400" /> Mejor precio</span>}
              <span className="text-[14px] font-bold text-zinc-900 tabular-nums">{item.precioUnitario != null ? clp(item.precioUnitario) : 'sin precio'}</span>
            </span>
            {incluido
              ? <span className="text-[11.5px] font-semibold text-sky-700">Incluido en otro producto</span>
              : <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${est.chip}`} title="Precio neto por unidad comparado con lo costeado">{est.texto(cmp.diffPct)}{cmp.veredicto === 'MEJOR' || cmp.veredicto === 'PEOR' ? ' que lo costeado' : ''}</span>}
          </div>
          <MenuAcciones etiqueta={`Acciones de la oferta de ${c.proveedorNombre}`} acciones={acc} />
        </div>
        {al.length > 0 && <div className="mt-1 pl-8 flex flex-wrap gap-x-3">{al.map(x => <span key={x} className="text-[11.5px] font-bold text-rose-600">⚠ {x}</span>)}</div>}
        {ads.length > 0 && (
          <div className={`mt-2 border-t border-dashed border-zinc-200 pt-1.5 ${onElegirCelda ? 'pl-8' : ''}`} data-testid={`desglose-${c.id}-${p.id}`}>
            <p className="text-[11px] text-zinc-500 mb-0.5">Qué incluye este precio, por unidad</p>
            <table className="w-full max-w-[520px] text-[12px] tabular-nums">
              <tbody>
                <tr><td className="py-0.5 text-zinc-800">{incluido ? 'Producto (va incluido en otro)' : 'Producto solo'}</td><td className="py-0.5 text-right text-zinc-800">{soloProducto != null ? clp(soloProducto) : '—'}</td></tr>
                {ads.map((a, i) => (
                  <tr key={`${a.concepto}-${i}`}>
                    <td className="py-0.5 text-zinc-600">+ {a.concepto}{a.cantidad !== 1 && <span className="text-zinc-400"> · {a.cantidad.toLocaleString('es-CL')} × {clp(a.precioUnitario)}</span>}</td>
                    <td className="py-0.5 text-right text-zinc-600">{clp(a.cantidad * a.precioUnitario)}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-200"><td className="pt-1 font-semibold text-zinc-900">Total por unidad</td><td className="pt-1 text-right font-semibold text-zinc-900">{item.precioUnitario != null ? clp(item.precioUnitario) : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {pendientes.length > 0 && (
          <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-zinc-200 pt-1.5 ${onElegirCelda ? 'pl-8' : ''}`} data-testid={`lineas-sin-usar-${c.id}-${p.id}`}>
            <span className="text-[11px] text-zinc-500">El documento trae además, sin sumar a ningún producto:</span>
            {pendientes.map(l => {
              const clave = `${c.id}|${p.id}|${l.descripcion}`;
              return (
                <button key={l.descripcion} type="button" disabled={agregandoLinea != null}
                  onClick={async () => { setAgregandoLinea(clave); try { await onAgregarLinea!(c.id, l, p.id); } finally { setAgregandoLinea(null); } }}
                  title={`Sumar «${l.descripcion}» al precio de este producto, como adicional`}
                  className="px-2 py-0.5 rounded-md border border-dashed border-zinc-300 text-[11px] text-zinc-600 hover:border-teal-400 hover:text-teal-700 disabled:opacity-50">
                  {agregandoLinea === clave ? 'Agregando…' : `+ Sumar ${l.descripcion.length > 42 ? `${l.descripcion.slice(0, 42).trim()}…` : l.descripcion}`}
                  {l.cantidad != null && l.precioUnitario != null && <span className="text-zinc-400 tabular-nums"> · {l.cantidad} × {clp(l.precioUnitario)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

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
        <span className="w-[124px] text-right">Costo real (Compras)</span>
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
                    {p.cantidadMotivo && p.cantidadCosteo != null && <s className="text-zinc-400 mr-1" title="Cantidad del costeo">{num(p.cantidadCosteo)}</s>}
                    {p.cantidad != null && <span className={p.cantidadMotivo ? 'font-bold text-amber-700' : ''}>{num(p.cantidad)} {p.unidad || 'un.'}</span>}
                    {p.cantidadMotivo && <span className="ml-1 text-[10.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px">a comprar</span>}
                    <span className="md:hidden"> · Costeado {base != null ? <b className="text-zinc-700">{clp(base)}</b> : '—'}</span>
                    {sinOfertas && <b className="ml-2 text-amber-600">Sin cotizar todavía</b>}
                  </p>
                </div>
                <div className="hidden md:flex items-center gap-3 text-[12px] flex-shrink-0">
                  <span className="w-[104px] text-right tabular-nums text-zinc-700 font-semibold" title="Costo neto por unidad que costeó licitaciones">{base != null ? clp(base) : <span className="text-zinc-300">—</span>}</span>
                  <span className="w-[124px] text-right tabular-nums" title="«Costo unit. REAL» que Compras anotó a mano en el costeo (neto por unidad). Se reemplaza por el precio cotizado al mandar la compra a aprobación.">
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

              {/* Observación del cambio de cantidad: a la vista aunque el producto esté plegado. */}
              {p.cantidadMotivo && (
                <div className="mx-4 mb-2 ml-11 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900" data-testid={`obs-cantidad-${p.id}`}>
                  <b>Se compran {num(p.cantidad)} en vez de {p.cantidadCosteo != null ? num(p.cantidadCosteo) : '—'} del costeo:</b> {p.cantidadMotivo}
                  {(p.cantidadCambiadaPorNombre || p.cantidadCambiadaAt) && <span className="text-amber-700/80"> — {p.cantidadCambiadaPorNombre || 'alguien'}{p.cantidadCambiadaAt ? `, ${fechaCorta(p.cantidadCambiadaAt)}` : ''}</span>}
                </div>
              )}

              {abierto && (
                <div className="px-4 pb-3 pl-11 space-y-1.5">
                  {!p.esServicio && <CantidadAComprar p={p} base={base} onGuardar={onCambiarCantidad} />}
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

                  {(() => {
                    // Las reemplazadas por una cotización más nueva del mismo proveedor no se pueden elegir: van plegadas al final (la elegida se queda a la vista).
                    const esOculta = (cid: number) => reemp.has(`${cid}:${p.id}`) && compra?.[p.id] !== cid;
                    const vigentes = ofertas.filter(o => !esOculta(o.c.id));
                    const viejas = ofertas.filter(o => esOculta(o.c.id));
                    const verViejas = conReemplazadas.has(p.id);
                    return (
                      <>
                        {vigentes.map(o => filaOferta(p, o, base, mejor))}
                        {viejas.length > 0 && (
                          <button type="button" onClick={() => setConReemplazadas(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                            aria-expanded={verViejas} className="flex items-center gap-1 text-[11.5px] text-zinc-500 hover:text-zinc-800 px-1 py-0.5" data-testid={`reemplazadas-${p.id}`}>
                            {verViejas ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {viejas.length} cotización{viejas.length === 1 ? '' : 'es'} anterior{viejas.length === 1 ? '' : 'es'} reemplazada{viejas.length === 1 ? '' : 's'} por una más nueva del mismo proveedor ({viejas.map(o => `#${o.c.id}`).join(', ')})
                          </button>
                        )}
                        {verViejas && viejas.map(o => filaOferta(p, o, base, mejor))}
                      </>
                    );
                  })()}

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
                {resumenVisible.map(({ c, cubiertos, faltan, subtotal, flete, total, nAvisos }) => (
                  <tr key={c.id} className="border-b border-zinc-100 last:border-0 align-middle">
                    <td className="px-4 py-2"><p className="text-[13px] font-semibold text-zinc-900">{c.proveedorNombre}</p><p className="text-[11px] text-zinc-400">Cotización #{c.id}</p></td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap">{faltan === 0 ? <span className="font-semibold text-emerald-700">Todos ({cubiertos} de {productos.length})</span> : <span className="font-semibold text-amber-700">{cubiertos} de {productos.length} · faltan {faltan}</span>}</td>
                    <td className="px-3 py-2 text-right text-[13px] font-bold text-zinc-900 tabular-nums whitespace-nowrap">{total > 0 ? clp(total) : <span className="text-zinc-300">—</span>}{menorTotal != null && faltan === 0 && nAvisos === 0 && total === menorTotal && <span className="ml-1 text-[10.5px] font-bold text-amber-600">★ menor</span>}
                      {flete > 0 && <span className="block text-[11px] font-normal text-zinc-500" data-testid={`total-desglose-${c.id}`}>Productos {clp(subtotal)} + flete {clp(flete)}</span>}</td>
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
      {(margen.lineas.length > 0 || margen.sinVenta > 0 || margen.sinCosteo < productos.length) && <MargenCosteoVsCotizaciones resumen={margen} fletesCotizados={fletesCotizados} />}
      <p className="px-4 py-2 text-[11.5px] text-zinc-400 border-t border-zinc-100">Verde: más barata que lo costeado · Rojo: más cara · Azul: igual (±1 %) · Gris: no se puede comparar. ⚠ rojo = un problema del proveedor (plazo, RUT, mínimo de venta, falta un componente).</p>
    </div>
  );
}
