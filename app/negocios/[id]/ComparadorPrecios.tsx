'use client';

// COMPARADOR POR PRODUCTO — reemplaza como vista principal a la matriz (productos × proveedores), que con 10-20 cotizaciones obligaba a
// desplazarse a los lados. Aquí el eje es el PRODUCTO: cada uno es una tarjeta con TODAS sus ofertas en una lista vertical, de la más
// barata a la más cara (crece hacia abajo, no hacia el lado). Elegir = el círculo de la oferta. El cuadro «Por proveedor» resume cada
// cotización (qué cubre, total, plazo, avisos) y permite «Comprar todo aquí». Mismos datos, mismas acciones y mismas reglas que la matriz.
import { useMemo, useRef, useState } from 'react';
import { IconStar as Star, IconCheck as Check, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight, IconSearch as Search } from '@tabler/icons-react';
import { MenuAcciones } from '@/app/components/ui/MenuAcciones';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { LinksProducto } from './LinksProducto';
import { compararPrecioConCosteo, totalAdicionales, descuentoDelPrecio, vaIncluidoEnOtro, DIFERENCIA_SOSPECHOSA_PCT, type AdicionalCotizacion } from '@/app/lib/compras-precio-vs-costeo';
import { esLinkDeProducto } from '@/app/lib/costeo-comparativo';
import { margenCosteoVsCotizaciones, GASTO_ENTREGA_PCT } from '@/app/lib/compras-margen-vs-costeo';
import { MargenCosteoVsCotizaciones } from './MargenCosteoVsCotizaciones';
import { ESTILO_VEREDICTO, ESTILO_TECNICO, cotizacionesReemplazadas } from './MatrizPrecios';
import type { MatrizProps } from './MatrizPrecios';
import { lineasPendientes } from './ListaCotizaciones';
import { EmparejarAMano, type AsignacionMano, type CotizacionDeLista } from './EmparejarAMano';
import type { LineaCotizacion } from '@/app/lib/compras-cotizacion-lineas';

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
/** Con centavos cuando los hay ($5.181,30): el desglose tiene que cuadrar al peso con la cotización (3789-30-LE26). */
const clpExacto = (n: number) => `$${n.toLocaleString('es-CL', Number.isInteger(Math.round(n * 100) / 100) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Veredicto contra lo costeado: punto + texto (licitank-ui: nada de pastillas con borde). */
const COLOR_PUNTO = { MEJOR: '#16a34a', IGUAL: '#64748b', PEOR: '#dc2626', SIN_COMPARAR: '#94a3b8' } as const;
const COLOR_TEXTO = { MEJOR: 'text-emerald-700 dark:text-emerald-400', IGUAL: 'text-tinta-2 dark:text-slate-300', PEOR: 'text-rose-700 dark:text-rose-400', SIN_COMPARAR: 'text-tinta-3' } as const;
const PUNTO_FICHA: Record<string, string> = { CUMPLE: '#16a34a', NO_CUMPLE: '#dc2626', CON_PENDIENTES: '#d97706', NO_CORRIDO: '#94a3b8' };
const corto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trim()}…` : s);
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

export function ComparadorPrecios({ productos, cotizaciones, costeado, venta, linksCosteo = {}, lecturaLink: lecLink, onCompraPorLink, seleccion, onSeleccionar, alertas, tecnico, onAgregar, compra, onElegirCelda, onComprarTodoAqui, acciones, onVerMatriz, costeoCompras = {}, onAgregarLinea, onCambiarCantidad, onEditarAdicionales, onEmparejar }: MatrizProps & {
  /** Guarda «esta línea de esta cotización es el precio de este producto» (panel «Emparejar a mano»). Sin esta función no sale el botón. */
  onEmparejar?: (a: AsignacionMano) => Promise<void>;
  /** Guarda la lista completa de componentes/adicionales de un producto en una cotización (editar un precio en el cuadro «Qué trae el kit»). */
  onEditarAdicionales?: (cotizacionId: number, productoId: number, adicionales: AdicionalCotizacion[], precioBase?: number) => Promise<void>;
  onVerMatriz?: () => void; costeoCompras?: Record<number, { costo: number | null; link: string }>;
  /** Cambia la cantidad a comprar de un producto con observación, sin tocar el costeo (migration-179). */
  onCambiarCantidad?: (productoId: number, cantidad: number, motivo: string) => Promise<void>;
  /** Suma una línea del documento que no quedó en ningún producto (acoples, manguera…) como adicional de ESE producto en esa cotización. */
  onAgregarLinea?: (cotizacionId: number, linea: LineaCotizacion, productoId: number) => Promise<void>;
}) {
  const [abiertos, setAbiertos] = useState<Set<number>>(() => new Set(productos.length <= 4 ? productos.map(p => p.id) : []));
  const [agregandoLinea, setAgregandoLinea] = useState<string | null>(null);
  // Precio de un componente en edición dentro del cuadro: clave «cotización:producto:índice:unit|total». Se puede escribir el precio
  // unitario o el TOTAL de la línea (el que imprime la cotización: $25.906,50 por 5 alicates → $5.181,30 c/u). Con decimales.
  const [editPrecio, setEditPrecio] = useState<{ clave: string; valor: string } | null>(null);
  const [guardandoPrecio, setGuardandoPrecio] = useState<string | null>(null);
  const cancelarPrecio = useRef(false);   // Escape: el blur que sigue no guarda
  const guardarPrecio = async (cotizacionId: number, productoId: number, ads: AdicionalCotizacion[], i: number) => {
    if (cancelarPrecio.current) { cancelarPrecio.current = false; return; }
    if (!editPrecio || !onEditarAdicionales) return;
    const escrito = leerNumero(editPrecio.valor.replace(/\$/g, ''));
    const clave = editPrecio.clave;
    setEditPrecio(null);
    const nuevo = clave.endsWith(':total') ? Math.round((escrito / (ads[i].cantidad || 1)) * 100) / 100 : escrito;
    if (!Number.isFinite(nuevo) || nuevo < 0 || nuevo === ads[i].precioUnitario) return;
    setGuardandoPrecio(clave);
    try { await onEditarAdicionales(cotizacionId, productoId, ads.map((a, j) => ({ concepto: a.concepto, cantidad: a.cantidad, precioUnitario: j === i ? nuevo : a.precioUnitario }))); }
    finally { setGuardandoPrecio(null); }
  };
  // Líneas del documento sin usar, por cotización (las cotizaciones llegan completas, con el texto del documento).
  const pendientesPorCot = useMemo(() => new Map(cotizaciones.map(c => [c.id, lineasPendientes(c as unknown as Parameters<typeof lineasPendientes>[0], productos)] as const)), [cotizaciones, productos]);
  const [emparejando, setEmparejando] = useState<number | null>(null);   // producto abierto en «Emparejar a mano»
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
  // Servicios con SKU: el FLETE cuenta como flete real contra la reserva del 5 %; el ADICIONAL (grúa, instalación) es un gasto que no
  // estaba en el costeo y se resta aparte, sin tocar la reserva (1154: la grúa horquilla salía como flete y «ahorraba» contra la reserva).
  const adicionalesCotizados: Array<{ proveedor: string; cotizacionId: number; monto: number; nombre?: string }> = [];
  for (const p of productos.filter(p => p.esServicio)) {
    const m = menorDe.get(p.id); if (m == null) continue;
    const c = cotizaciones.find(c => !reemp.has(`${c.id}:${p.id}`) && c.items.find(i => i.productoId === p.id)?.precioUnitario === m);
    const fila = { proveedor: c?.proveedorNombre ?? '', cotizacionId: c?.id ?? 0, monto: m * num(p.cantidad), nombre: p.descripcion };
    (p.servicioTipo === 'ADICIONAL' ? adicionalesCotizados : fletesCotizados).push(fila);
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
    const incluido = vaIncluidoEnOtro(item);
    const esElegida = compra?.[p.id] === c.id;
    // Una oferta ≥ 50 % bajo lo costeado casi nunca es una ganga: otro producto, otra unidad (¿cotizó 1 set y no 30?) o mal leída.
    // No se corona «Mejor precio» ni se pinta de verde: se pide revisar primero.
    const sospechosa = !incluido && cmp.veredicto === 'MEJOR' && cmp.diffPct != null && Math.abs(cmp.diffPct) >= DIFERENCIA_SOSPECHOSA_PCT;
    const esMejor = mejor != null && item.precioUnitario === mejor && !sospechosa;
    const detalleActivo = seleccion?.cotizacionId === c.id && seleccion.productoId === p.id;
    const al = alertas?.[`${c.id}:${p.id}`] ?? [];
    const t = tecnico?.[`${c.id}:${p.id}`];
    const et = t ? (ESTILO_TECNICO[t.estado] ?? ESTILO_TECNICO.NO_CORRIDO) : null;
    const reemplazadaPor = reemp.get(`${c.id}:${p.id}`);
    const bloqueada = reemplazadaPor != null && !esElegida;   // si ya estaba elegida se deja quitarla, no volver a elegirla
    const ads = item.adicionales as AdicionalCotizacion[];
    const sumaAds = totalAdicionales(ads);
    // Kit cotizado por componentes (base $0 + piezas): no hay «producto solo», el precio ES la suma de las piezas.
    const esKit = item.precioBase === 0 && ads.length > 0;
    // Descuento del documento sobre el total (migration-195): piezas a precio de lista, el % se descuenta UNA vez al final, como la factura.
    const pctDesc = c.descuentoSobreTotal && c.descuentoPct ? c.descuentoPct : null;
    const montoDesc = pctDesc != null && item.precioBase != null ? descuentoDelPrecio(item.precioBase, ads, pctDesc) : 0;
    const soloProducto = item.precioBase != null ? item.precioBase : item.precioUnitario != null ? item.precioUnitario - sumaAds : null;
    const pendientes = onAgregarLinea && !bloqueada ? (pendientesPorCot.get(c.id) ?? []) : [];
    // Redondeo A PEDIDO (dueño, 16-11): el sistema guarda siempre lo que dice la cotización; solo una persona redondea, por oferta,
    // las piezas y el precio del producto a peso entero, hacia arriba o hacia abajo.
    const precioProducto = item.precioBase ?? (ads.length === 0 ? item.precioUnitario : null);
    const conDecimales = (n: number | null | undefined) => n != null && Math.abs(Math.round(n * 100) / 100 - Math.round(n)) >= 0.005;
    const baseConDecimales = precioProducto != null && precioProducto !== 0 && conDecimales(precioProducto);
    const hayDecimales = baseConDecimales || ads.some(a => conDecimales(a.precioUnitario));
    const redondear = (modo: 'arriba' | 'abajo') => {
      if (!onEditarAdicionales) return;
      const f = (n: number) => { const x = Math.round(n * 100) / 100; return modo === 'arriba' ? Math.ceil(x) : Math.floor(x); };
      void onEditarAdicionales(c.id, p.id, ads.map(a => ({ concepto: a.concepto, cantidad: a.cantidad, precioUnitario: f(a.precioUnitario) })), baseConDecimales ? f(precioProducto!) : undefined);
    };
    const acc = [
      ...(c.archivoUrl ? [{ label: 'Ver cotización', onClick: () => window.open(c.archivoUrl!, '_blank', 'noopener,noreferrer') }] : []),
      { label: 'Ver detalle del precio', onClick: () => onSeleccionar({ cotizacionId: c.id, productoId: p.id }) },
      ...(acciones ? [{ label: 'Cambiar producto', onClick: () => acciones.onAsignar(c.id) }] : []),
      ...(onEditarAdicionales && !bloqueada ? [
        { label: hayDecimales ? 'Redondear precios hacia arriba' : 'Redondear (no hay decimales)', onClick: () => redondear('arriba'), disabled: !hayDecimales },
        ...(hayDecimales ? [{ label: 'Redondear precios hacia abajo', onClick: () => redondear('abajo') }] : []),
      ] : []),
    ];
    const cant = num(p.cantidad);
    const queIncluye = incluido ? 'Va incluido en otro producto' : esKit ? `Kit de ${ads.length} componente${ads.length === 1 ? '' : 's'}` : ads.length > 0 ? `Producto + ${ads.length} adicional${ads.length === 1 ? '' : 'es'}` : 'Solo el producto';
    return (
      <div key={c.id} className={`rounded-xl border px-3.5 py-3 transition-colors ${reemplazadaPor != null ? 'opacity-60 bg-slate-50 dark:bg-slate-800/40 ' : 'bg-white dark:bg-slate-900 '}${esElegida ? 'border-marca ring-1 ring-marca/20 bg-marca-suave/60 dark:bg-teal-950/30' : detalleActivo ? 'border-teal-300' : 'border-linea dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}>
        <div className="grid items-center gap-x-4 gap-y-1.5 grid-cols-[auto_minmax(0,1fr)_auto] @3xl:grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_104px_112px_150px_auto]">
          {onElegirCelda ? (
            <button type="button" onClick={() => onElegirCelda(p.id, c.id)} aria-pressed={esElegida} aria-label={`${esElegida ? 'Quitar de mi compra' : 'Comprar este producto a'} ${c.proveedorNombre}`} disabled={bloqueada}
              title={bloqueada ? `Reemplazada por la cotización #${reemplazadaPor} del mismo proveedor` : esElegida ? 'Quitar de mi compra' : 'Comprar este producto a este proveedor'} className={`p-1 -m-1 rounded-full focus-visible:ring-2 focus-visible:ring-marca outline-none ${bloqueada ? 'cursor-not-allowed' : ''}`}>
              <span className={`flex w-5 h-5 rounded-full border items-center justify-center ${esElegida ? 'bg-marca border-marca text-white' : 'border-slate-300 bg-white dark:bg-slate-900 hover:border-marca'}`}>{esElegida && <Check size={12} />}</span>
            </button>
          ) : <span />}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-tinta dark:text-slate-100 leading-tight truncate" title={c.proveedorNombre}>{c.proveedorNombre}</p>
            <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">Cotización #{c.id}{c.plazoEntregaTexto ? ` · ${c.plazoEntregaTexto}` : ''}</p>
            {reemplazadaPor != null && <p className="text-xs text-tinta-2">Reemplazada por la #{reemplazadaPor} del mismo proveedor</p>}
          </div>
          <div className="text-right @3xl:hidden">
            <p className="text-[15px] font-semibold tabular-nums text-tinta dark:text-slate-100">{item.precioUnitario != null ? clpExacto(item.precioUnitario) : 'sin precio'}</p>
          </div>
          <div className="min-w-0 col-start-2 col-span-2 @3xl:col-span-1 @3xl:col-start-auto">
            <p className="text-xs text-tinta dark:text-slate-200 truncate">{queIncluye}</p>
            {tecnico && !incluido && (et && t
              ? <p className="text-xs text-tinta-2 dark:text-slate-400" title={`Ficha de ${t.modelo || 'este modelo'} contra las bases`} data-testid={`tecnico-${c.id}-${p.id}`}><Estado color={PUNTO_FICHA[t.estado] ?? PUNTO_FICHA.NO_CORRIDO}>Ficha: {et.texto}{t.total > 0 ? ` ${t.cumple}/${t.total}` : ''}</Estado></p>
              : <p className="text-xs text-tinta-3">Sin ficha técnica</p>)}
          </div>
          <div className="hidden @3xl:block text-right">
            {esMejor && <p title="Mejor precio de este producto" className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-600"><Star size={11} className="fill-amber-400" /> Mejor precio</p>}
            <p className="text-[15px] font-semibold tabular-nums text-tinta dark:text-slate-100">{item.precioUnitario != null ? clpExacto(item.precioUnitario) : 'sin precio'}</p>
            <p className="text-[11px] text-tinta-3">por unidad</p>
          </div>
          <div className="hidden @3xl:block text-right">
            <p className="text-[13px] font-medium tabular-nums text-tinta dark:text-slate-200">{item.precioUnitario != null ? clp(item.precioUnitario * cant) : '—'}</p>
            <p className="text-[11px] text-tinta-3">total · {cant} {p.unidad || 'un.'}</p>
          </div>
          <div className="col-start-2 col-span-2 @3xl:col-span-1 @3xl:col-start-auto text-xs">
            {incluido
              ? <span className="text-sky-700 dark:text-sky-400"><Estado color="#0284c7">Incluido en otro producto</Estado></span>
              : sospechosa
                ? <span className="text-amber-700 dark:text-amber-400" title="Una diferencia tan grande suele ser otro producto, otra unidad (¿cotizó 1 set y no el lote?) o una cotización mal leída. Revisa antes de elegirla."><Estado color="#d97706">{Math.abs(cmp.diffPct!).toString().replace('.', ',')} % bajo lo costeado: revisa</Estado></span>
                : <span className={`font-medium ${COLOR_TEXTO[cmp.veredicto]}`} title="Precio neto por unidad comparado con lo costeado"><Estado color={COLOR_PUNTO[cmp.veredicto]}>{est.texto(cmp.diffPct)}{cmp.veredicto === 'MEJOR' || cmp.veredicto === 'PEOR' ? ' que lo costeado' : ''}</Estado></span>}
          </div>
          <MenuAcciones etiqueta={`Acciones de la oferta de ${c.proveedorNombre}`} acciones={acc} />
        </div>
        {al.length > 0 && <div className="mt-1.5 pl-8 flex flex-wrap gap-x-4">{al.map(x => <span key={x} className="text-xs font-medium text-rose-700 dark:text-rose-400"><Estado color="#dc2626">{x}</Estado></span>)}</div>}
        {ads.length > 0 && (
          <div className={`mt-2.5 border-t border-linea dark:border-slate-800 pt-2 ${onElegirCelda ? 'pl-8' : ''}`} data-testid={`desglose-${c.id}-${p.id}`}>
            <p className="text-[11px] text-zinc-500 mb-0.5">{esKit ? 'Qué trae el kit, por unidad' : 'Qué incluye este precio, por unidad'}</p>
            <table className="w-full max-w-[520px] text-[12px] tabular-nums">
              <tbody>
                {!esKit && <tr><td className="py-0.5 text-zinc-800">{incluido ? 'Producto (va incluido en otro)' : 'Producto solo'}</td><td className="py-0.5 text-right text-zinc-800">{soloProducto != null ? clpExacto(soloProducto) : '—'}</td></tr>}
                {ads.map((a, i) => {
                  const editable = !!onEditarAdicionales && !bloqueada;
                  // Un monto del cuadro: texto, botón para editarlo o el campo abierto. modo = precio unitario o total de la línea.
                  const monto = (modo: 'unit' | 'total', valor: number, etiqueta: string) => {
                    const clave = `${c.id}:${p.id}:${i}:${modo}`;
                    if (editPrecio?.clave === clave) return (
                      <input autoFocus value={editPrecio.valor} inputMode="decimal" aria-label={`${etiqueta} de ${a.concepto}`}
                        onChange={e => setEditPrecio({ clave, valor: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { cancelarPrecio.current = true; setEditPrecio(null); } }}
                        onBlur={() => void guardarPrecio(c.id, p.id, ads, i)}
                        className={`w-28 rounded border border-teal-400 bg-white px-1 py-0 text-[12px] text-zinc-900 tabular-nums outline-none focus:ring-1 focus:ring-teal-500 ${modo === 'total' ? 'text-right' : ''}`} />
                    );
                    if (!editable) return clpExacto(valor);
                    const conCentavos = String(Math.round(valor * 100) / 100).replace('.', ',');
                    return (
                      <button type="button" onClick={() => { cancelarPrecio.current = false; setEditPrecio({ clave, valor: conCentavos }); }} disabled={guardandoPrecio != null}
                        title={`Cambiar ${etiqueta.toLowerCase()} (acepta decimales con coma)`} className="underline decoration-dotted underline-offset-2 hover:text-teal-700 disabled:opacity-50">
                        {guardandoPrecio === clave ? 'Guardando…' : clpExacto(valor)}
                      </button>
                    );
                  };
                  return (
                    <tr key={`${a.concepto}-${i}`}>
                      <td className="py-0.5 text-zinc-600">{esKit ? '' : '+ '}{a.concepto}
                        {(a.cantidad !== 1 || editable) && <span className="text-zinc-400"> · {a.cantidad !== 1 && <>{a.cantidad.toLocaleString('es-CL')} × </>}{monto('unit', a.precioUnitario, 'El precio unitario')}</span>}
                      </td>
                      <td className="py-0.5 text-right text-zinc-600">{monto('total', a.cantidad * a.precioUnitario, 'El total de la línea')}</td>
                    </tr>
                  );
                })}
                {montoDesc > 0 && (
                  <tr data-testid={`descuento-${c.id}-${p.id}`}>
                    <td className="pt-1 text-zinc-600">Descuento {String(pctDesc).replace('.', ',')} % <span className="text-zinc-400">· sobre el total, como el documento</span></td>
                    <td className="pt-1 text-right text-emerald-700">−{clpExacto(montoDesc)}</td>
                  </tr>
                )}
                <tr className="border-t border-zinc-200"><td className="pt-1 font-semibold text-zinc-900">{esKit ? 'Total por kit' : 'Total por unidad'}</td><td className="pt-1 text-right font-semibold text-zinc-900">{item.precioUnitario != null ? clpExacto(item.precioUnitario) : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {pendientes.length > 0 && (
          <div className={`mt-2 flex flex-wrap items-center gap-1.5 border-t border-linea dark:border-slate-800 pt-2 ${onElegirCelda ? 'pl-8' : ''}`} data-testid={`lineas-sin-usar-${c.id}-${p.id}`}>
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
    <div className="@container bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta overflow-hidden" data-testid="comparador-precios">
      <div className="px-5 py-4 border-b border-linea dark:border-slate-800 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">Compara y elige a quién comprar</p>
          <p className="text-xs text-tinta-2 dark:text-slate-400 mt-1 max-w-2xl">Cada producto con todas sus ofertas, de la más barata a la más cara (neto por unidad contra lo costeado). Marca el círculo de la oferta que quieres comprar, o usa «Comprar todo aquí» en «Por proveedor».</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {nElegidos > 0 && <span className="text-xs font-medium text-marca dark:text-teal-400 tabular-nums"><Estado color="#0f766e">{nElegidos} de {productos.length} elegidos</Estado></span>}
          {lecLink?.disponible && lecLink.totalPendientes > 0 && (
            <button type="button" onClick={() => lecLink.leer()} disabled={!!lecLink.leyendo}
              className="text-xs font-medium text-marca border border-linea bg-white dark:bg-slate-900 hover:bg-marca-suave disabled:opacity-60 rounded-lg px-3 py-1.5">
              {lecLink.leyendo ? `Leyendo link ${lecLink.leyendo.actual} de ${lecLink.leyendo.total}…` : `Leer ${lecLink.totalPendientes} link${lecLink.totalPendientes === 1 ? '' : 's'} del costeo`}
            </button>
          )}
          <button type="button" onClick={() => setAbiertos(abiertos.size >= productos.length ? new Set() : new Set(productos.map(p => p.id)))}
            className="text-xs font-medium text-tinta-2 hover:text-tinta border border-linea bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg px-3 py-1.5">
            {abiertos.size >= productos.length ? 'Plegar todos' : 'Desplegar todos'}
          </button>
          {onVerMatriz && <button type="button" onClick={onVerMatriz} className="text-xs font-medium text-tinta-2 hover:text-tinta underline underline-offset-2">Ver como matriz</button>}
        </div>
      </div>

      {productos.length > 6 && (
        <div className="px-5 py-2.5 border-b border-linea dark:border-slate-800">
          <label className="relative block max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={buscaProducto} onChange={e => setBuscaProducto(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto"
              className="w-full text-xs border border-linea dark:border-slate-700 dark:bg-slate-900 rounded-lg pl-8 pr-2.5 py-2 outline-none focus:ring-1 focus:ring-marca" />
          </label>
        </div>
      )}

      {/* Encabezado de la tabla: los tres precios de cada producto, en columnas (costeo · costeo de Compras · cotización). */}
      <div className="hidden md:flex items-center gap-3 px-5 py-2 border-b border-linea dark:border-slate-800 text-[11px] text-tinta-3">
        <span className="flex-1 pl-7">Producto</span>
        <span className="w-[104px] text-right">Costeo</span>
        <span className="w-[124px] text-right">Costo real (Compras)</span>
        <span className="w-[260px]">Mejor cotización</span>
        <span className="w-[150px] text-right">Elegido</span>
      </div>
      <div className="divide-y divide-linea dark:divide-slate-800">
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
                className="w-full text-left px-5 py-3.5 flex items-center gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marca outline-none">
                {abierto ? <ChevronDown size={16} className="text-zinc-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-zinc-400 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-tinta dark:text-slate-100 truncate" title={p.descripcion}>{p.descripcion}</p>
                  <p className="text-xs text-tinta-2 dark:text-slate-400">
                    {p.cantidadMotivo && p.cantidadCosteo != null && <s className="text-zinc-400 mr-1" title="Cantidad del costeo">{num(p.cantidadCosteo)}</s>}
                    {p.cantidad != null && <span className={p.cantidadMotivo ? 'font-semibold text-amber-700' : ''}>{num(p.cantidad)} {p.unidad || 'un.'}</span>}
                    {p.cantidadMotivo && <span className="ml-1 text-[10.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px">a comprar</span>}
                    <span className="md:hidden"> · Costeado {base != null ? <b className="text-zinc-700">{clp(base)}</b> : '—'}</span>
                    {sinOfertas && <b className="ml-2 font-medium text-amber-600">Sin cotizar todavía</b>}
                  </p>
                  {!abierto && ofertas.length > 0 && (
                    <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400 truncate" data-testid={`ofertas-resumen-${p.id}`}>
                      {ofertas.slice(0, 3).map((o, i) => (
                        <span key={o.c.id}>{i > 0 && <span className="text-tinta-3"> · </span>}{corto(o.c.proveedorNombre, 22)} <span className={`tabular-nums ${o.item.precioUnitario != null && o.item.precioUnitario === menor ? 'font-semibold text-marca dark:text-teal-400' : 'text-tinta dark:text-slate-200'}`}>{o.item.precioUnitario != null ? clp(o.item.precioUnitario) : 'sin precio'}</span></span>
                      ))}
                      {ofertas.length > 3 && <span className="text-tinta-3"> · +{ofertas.length - 3} más</span>}
                    </p>
                  )}
                </div>
                <div className="hidden md:flex items-center gap-3 text-[12px] flex-shrink-0">
                  <span className="w-[104px] text-right tabular-nums text-tinta-2 font-medium" title="Costo neto por unidad que costeó licitaciones">{base != null ? clp(base) : <span className="text-zinc-300">—</span>}</span>
                  <span className="w-[124px] text-right tabular-nums" title="«Costo unit. REAL» que Compras anotó a mano en el costeo (neto por unidad). Se reemplaza por el precio cotizado al mandar la compra a aprobación.">
                    {costeoCompras[p.id]?.costo != null ? (
                      <>
                        {costeoCompras[p.id].link && esLinkDeProducto(costeoCompras[p.id].link) && (
                          <a href={costeoCompras[p.id].link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="mr-1.5 text-[11px] text-teal-700 underline underline-offset-2">link</a>
                        )}
                        <b className="font-semibold text-tinta dark:text-slate-100">{clp(costeoCompras[p.id].costo!)}</b>
                      </>
                    ) : <span className="text-zinc-300">—</span>}
                  </span>
                  <span className="w-[260px] flex items-center gap-2">
                    {menor != null && cmpMenor ? (
                      <>
                        <b className="font-semibold text-tinta dark:text-slate-100 tabular-nums">{clp(menor)}</b>
                        <span className={`font-medium ${COLOR_TEXTO[cmpMenor.veredicto]}`}><Estado color={COLOR_PUNTO[cmpMenor.veredicto]}>{ESTILO_VEREDICTO[cmpMenor.veredicto].texto(cmpMenor.diffPct)}</Estado></span>
                        <span className="text-tinta-3">· {ofertas.length} oferta{ofertas.length === 1 ? '' : 's'}</span>
                      </>
                    ) : <span className="text-zinc-300" title="Sin cotización: se toma lo costeado">sin cotización</span>}
                  </span>
                </div>
                <span className="flex-shrink-0 md:w-[150px] md:text-right">
                  <span className={`text-xs font-medium ${elegida ? 'text-marca dark:text-teal-400' : 'text-tinta-3'}`}>
                    {elegida ? <Estado color="#0f766e">{corto(elegida.proveedorNombre, 22)}</Estado> : 'Sin elegir'}
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
                <div className="px-5 pb-4 pl-12 space-y-2">
                  {!p.esServicio && <CantidadAComprar p={p} base={base} onGuardar={onCambiarCantidad} />}
                  {onEmparejar && !p.esServicio && (
                    <div className="flex items-center gap-2 flex-wrap text-xs text-tinta-2 dark:text-slate-400">
                      <button type="button" onClick={() => setEmparejando(p.id)} data-testid={`emparejar-${p.id}`}
                        className="font-medium text-marca dark:text-teal-400 hover:underline underline-offset-2">Emparejar a mano con una línea de las cotizaciones</button>
                      <span>{ofertas.length === 0 ? 'Este producto no tiene oferta todavía.' : 'Para cuando una oferta no es la que corresponde o falta una.'}</span>
                    </div>
                  )}
                  {linksCosteo[p.id] && <div className="text-[11.5px] text-zinc-500 flex items-center gap-1.5">Link del costeo: <span className="[&_a]:max-w-[220px]"><LinksProducto links={linksCosteo[p.id].links} /></span></div>}

                  {lecturas.map(l => {
                    const cmp = compararPrecioConCosteo(l.neto, base);
                    const est = ESTILO_VEREDICTO[cmp.veredicto];
                    const horas = l.capturaAt ? (Date.now() - new Date(l.capturaAt).getTime()) / 36e5 : Infinity;
                    const vieja = horas > 24; const dias = Math.floor(horas / 24);
                    const comprable = l.neto != null && !vieja && !l.agotado;
                    return (
                      <div key={`l-${l.opcionId}`} className="rounded-xl border border-linea dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 px-3.5 py-2.5 flex items-center gap-x-4 gap-y-1 flex-wrap" data-testid={`link-leido-${p.id}`}>
                        <span className="text-xs font-medium text-tinta-2">Por link</span>
                        <span className="text-[14px] font-semibold text-tinta tabular-nums">{l.neto != null ? clp(l.neto) : 'sin precio'}</span>
                        {l.neto != null && !l.agotado && <span className={`text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${est.chip}`}>{est.texto(cmp.diffPct)}</span>}
                        <span className="text-[11.5px] text-zinc-500">
                          {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline underline-offset-2">{l.host}</a> : l.host}
                          {l.capturaAt && <> · captura {vieja ? `de hace ${dias} día${dias === 1 ? '' : 's'}` : 'de hoy'}</>}
                        </span>
                        {l.agotado && <span className="text-xs font-medium text-rose-700">⛔ Producto agotado: no se puede comprar por este link</span>}
                        {vieja && !l.agotado && <span className="text-xs font-medium text-amber-700">⚠ Captura vieja: vuelve a leer antes de comprar</span>}
                        {l.neto != null && l.ivaSupuesto && <span className="text-[11px] text-zinc-400">IVA no aclarado: se asumió incluido y se rebajó</span>}
                        <span className="ml-auto flex items-center gap-1.5">
                          {lecLink && (!l.neto || vieja || l.agotado) && l.url && (
                            <button type="button" onClick={() => lecLink.releer(l.opcionId)} disabled={lecLink.releyendo != null}
                              className="text-xs font-medium text-marca border border-linea bg-white hover:bg-marca-suave disabled:opacity-60 rounded-lg px-2.5 py-1">{lecLink.releyendo === l.opcionId ? 'Leyendo…' : 'Volver a leer'}</button>
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
                      className="text-xs font-medium text-marca border border-linea bg-white hover:bg-marca-suave disabled:opacity-60 rounded-lg px-2.5 py-1.5">
                      {lecLink.leyendoProducto === p.id ? 'Leyendo link…' : `Leer el link del costeo${pendLink.length > 1 ? ` (${pendLink.length})` : ''}`}
                    </button>
                  )}

                  {ofertas.length > 0 && (
                    <div className="hidden @3xl:grid grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_104px_112px_150px_auto] gap-x-4 px-3.5 text-[11px] text-tinta-3" aria-hidden>
                      <span className="w-5" /><span>Proveedor</span><span>Qué incluye</span><span className="text-right">Precio unitario</span><span className="text-right">Total</span><span>Contra lo costeado</span><span className="w-7" />
                    </div>
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
          <summary className="px-5 py-3 cursor-pointer text-[13px] font-semibold text-tinta dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/40">Por proveedor <span className="font-normal text-zinc-400">({cotizaciones.length} cotización{cotizaciones.length === 1 ? '' : 'es'}: qué cubre cada una y cuánto costaría comprarle todo)</span></summary>
          {cotizaciones.length > 8 && (
            <div className="px-4 py-2">
              <input value={buscaProveedor} onChange={e => setBuscaProveedor(e.target.value)} placeholder="Buscar proveedor…" aria-label="Buscar proveedor"
                className="w-full max-w-xs text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="border-y border-linea dark:border-slate-800 text-[11px] font-normal text-tinta-3">
                  <th className="px-5 py-2 font-normal">Proveedor</th><th className="px-3 py-2 font-normal">Cubre</th><th className="px-3 py-2 text-right font-normal">Total si compras aquí</th><th className="px-3 py-2 font-normal">Plazo</th><th className="px-3 py-2 font-normal">Avisos</th><th className="px-3 py-2 text-right font-normal">Acción</th>
                </tr>
              </thead>
              <tbody>
                {resumenVisible.map(({ c, cubiertos, faltan, subtotal, flete, total, nAvisos }) => (
                  <tr key={c.id} className="border-b border-zinc-100 last:border-0 align-middle">
                    <td className="px-4 py-2"><p className="text-[13px] font-semibold text-zinc-900">{c.proveedorNombre}</p><p className="text-[11px] text-zinc-400">Cotización #{c.id}</p></td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap">{faltan === 0 ? <span className="font-semibold text-emerald-700">Todos ({cubiertos} de {productos.length})</span> : <span className="font-semibold text-amber-700">{cubiertos} de {productos.length} · faltan {faltan}</span>}</td>
                    <td className="px-3 py-2 text-right text-[13px] font-semibold text-tinta tabular-nums whitespace-nowrap">{total > 0 ? clp(total) : <span className="text-zinc-300">—</span>}{menorTotal != null && faltan === 0 && nAvisos === 0 && total === menorTotal && <span className="ml-1 text-[10.5px] font-bold text-amber-600">★ menor</span>}
                      {flete > 0 && <span className="block text-[11px] font-normal text-zinc-500" data-testid={`total-desglose-${c.id}`}>Productos {clp(subtotal)} + flete {clp(flete)}</span>}</td>
                    <td className="px-3 py-2 text-[12.5px] text-zinc-700">{c.plazoEntregaTexto || <span className="text-zinc-300">no dice</span>}</td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap">{nAvisos > 0 ? <span className="font-medium text-rose-700">⚠ {nAvisos}</span> : <span className="text-emerald-600">sin avisos</span>}</td>
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
      {emparejando != null && onEmparejar && (() => {
        const p = productos.find(x => x.id === emparejando);
        return p ? (
          <EmparejarAMano producto={{ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad }} productos={productos.map(x => ({ id: x.id, descripcion: x.descripcion, cantidad: x.cantidad, unidad: x.unidad }))}
            cotizaciones={cotizaciones as unknown as CotizacionDeLista[]} costeado={costeado[p.id] ?? null} onCerrar={() => setEmparejando(null)} onConfirmar={onEmparejar} />
        ) : null;
      })()}
      {(margen.lineas.length > 0 || margen.sinVenta > 0 || margen.sinCosteo < productos.length) && <MargenCosteoVsCotizaciones resumen={margen} fletesCotizados={fletesCotizados} adicionales={adicionalesCotizados} />}
      <p className="px-4 py-2 text-[11.5px] text-zinc-400 border-t border-zinc-100">Verde: más barata que lo costeado · Rojo: más cara · Azul: igual (±1 %) · Gris: no se puede comparar. ⚠ rojo = un problema del proveedor (plazo, RUT, mínimo de venta, falta un componente).</p>
    </div>
  );
}
