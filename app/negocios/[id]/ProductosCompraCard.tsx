'use client';

// PRODUCTOS Y COBERTURA (spec §14) — un producto/línea ganada por fila, con su subestado de
// cumplimiento. "Cobertura total o nada": el proyecto solo es entregable cuando TODOS los
// productos vigentes (no renunciados) llegan a ENTREGADO.
import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconPackage as Package, IconLoader2 as Loader2, IconX as X, IconFlag as Flag, IconRefresh as RefreshCw, IconSearch as Search } from '@tabler/icons-react';

type Subestado = 'PENDIENTE' | 'COTIZANDO' | 'COMPRADO' | 'EN_BODEGA' | 'LISTO_ENTREGA' | 'ENTREGADO' | 'RENUNCIADO' | 'NO_ADJUDICADA';

interface Producto {
  id: number; correlativo: number | null; descripcion: string; cantidad: number | null; unidad: string | null;
  montoUnitario: number | null; subestado: Subestado;
  renunciaMotivo: string | null; renunciaPropuestaPorNombre: string | null; renunciaAprobadaPorNombre: string | null;
}
interface Cobertura { total: number; listos: number; renunciados: number; noAdjudicadas: number; cobertura: boolean }
// Quién se llevó cada línea que ofertamos y no ganamos (viene del acta de MP).
interface LineaPerdida { correlativo: number; proveedor: string | null; montoUnitario: number | null }

const SUBESTADO_LABEL: Record<Subestado, string> = {
  PENDIENTE: 'Pendiente', COTIZANDO: 'Cotizando', COMPRADO: 'Comprado', EN_BODEGA: 'En bodega',
  LISTO_ENTREGA: 'Listo para entrega', ENTREGADO: 'Entregado', RENUNCIADO: 'Renunciado', NO_ADJUDICADA: 'No adjudicada',
};
const OPCIONES_SUBESTADO = (Object.keys(SUBESTADO_LABEL) as Subestado[])
  .filter(s => s !== 'RENUNCIADO' && s !== 'NO_ADJUDICADA').map(s => ({ value: s, label: SUBESTADO_LABEL[s] }));

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ProductosCompraCard({ negocioId, puedeOperar, esJefeDeVentas }: { negocioId: number; puedeOperar: boolean; esJefeDeVentas: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cobertura, setCobertura] = useState<Cobertura | null>(null);
  const [perdidas, setPerdidas] = useState<LineaPerdida[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conflictos, setConflictos] = useState<Array<{ productoId: number; correlativo: number; subestado: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState<number | null>(null);
  const [renunciaAbierta, setRenunciaAbierta] = useState<number | null>(null);
  const [motivoRenuncia, setMotivoRenuncia] = useState('');
  const [sincronizando, setSincronizando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'pendientes' | 'listos' | 'fuera'>('todos');

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/productos`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProductos(data.productos || []);
      setCobertura(data.cobertura || null);
      setPerdidas(data.perdidas || []);
      setAviso(data.aviso || null); setConflictos(data.conflictos || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los productos', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (body: Record<string, unknown>) => {
    const productoId = body.productoId as number;
    setGuardando(productoId);
    try {
      const res = await fetch(`/api/compras/${negocioId}/productos`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      setProductos(data.productos); setCobertura(data.cobertura);
      // Refresca el contexto compartido de Compras (pedido explícito, 17-sep-2026: los apartados
      // deben actualizarse solos entre sí) — antes esta tarjeta vivía aislada y el resto de la
      // pantalla (stepper, Gantt) quedaba desactualizado hasta recargar el navegador entero.
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
    } finally {
      setGuardando(null);
    }
  };

  const proponerRenuncia = async (productoId: number) => {
    if (!motivoRenuncia.trim()) return;
    await accion({ productoId, accion: 'proponer_renuncia', motivo: motivoRenuncia.trim() });
    setRenunciaAbierta(null); setMotivoRenuncia('');
  };

  // "Sincronizar con costeo" (pedido explícito del usuario, 15-sep-2026): esta lista se puebla UNA
  // sola vez al abrir Compras — si en ese momento no había costeo cargado, cae al desglose del acta
  // de MP (genérico) y se queda así para siempre. Este botón la actualiza a mano contra el costeo
  // vigente, sin perder el subestado ni el historial de renuncia de cada producto (merge por línea).
  const sincronizarConCosteo = async () => {
    setSincronizando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/productos`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'sincronizar_costeo' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo sincronizar');
      setProductos(data.productos); setCobertura(data.cobertura);
      await cargar(); // trae también quién se llevó las líneas no adjudicadas
      recargarCompartido();
      toast.success('Sincronizado con el costeo', `${data.actualizados} actualizado(s) · ${data.agregados} nuevo(s)`);
    } catch (e: any) {
      toast.error('No se pudo sincronizar con el costeo', e.message);
    } finally {
      setSincronizando(false);
    }
  };

  // Con 30 o más productos la lista tiene que poder buscarse y filtrarse: se agrupan los subestados en cuatro grupos que se entienden de un vistazo.
  const grupoDe = (st: Subestado): 'pendientes' | 'listos' | 'fuera' =>
    st === 'RENUNCIADO' || st === 'NO_ADJUDICADA' ? 'fuera' : st === 'LISTO_ENTREGA' || st === 'ENTREGADO' ? 'listos' : 'pendientes';
  const conteo = useMemo(() => {
    const c = { pendientes: 0, listos: 0, fuera: 0 };
    for (const p of productos) c[grupoDe(p.subestado)]++;
    return c;
  }, [productos]);
  // Si el número de línea viene repetido (pasa en algunas licitaciones), se muestra un número corrido para poder ubicarse.
  const lineasUnicas = useMemo(() => new Set(productos.map(p => p.correlativo)).size === productos.length, [productos]);
  const ventaTotal = useMemo(() => productos.filter(p => grupoDe(p.subestado) !== 'fuera').reduce((t, p) => t + (p.montoUnitario ?? 0) * (p.cantidad != null && Number(p.cantidad) > 0 ? Number(p.cantidad) : 1), 0), [productos]);
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter(p => (filtro === 'todos' || grupoDe(p.subestado) === filtro) && (!q || p.descripcion.toLowerCase().includes(q) || String(p.correlativo ?? '').includes(q)));
  }, [productos, busqueda, filtro]);

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  if (productos.length === 0) return null;

  const totalVivos = conteo.pendientes + conteo.listos;
  const pctListos = totalVivos > 0 ? Math.round((conteo.listos / totalVivos) * 100) : 0;
  const chip = (clave: typeof filtro, texto: string, n: number) => (
    <button key={clave} type="button" onClick={() => setFiltro(clave)}
      className={`text-[12px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${filtro === clave ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-600 border-zinc-200 hover:border-teal-400'}`}>
      {texto} <span className={filtro === clave ? 'text-teal-100' : 'text-zinc-400'}>{n}</span>
    </button>
  );

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 space-y-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-1.5"><Package size={15} /> {productos.length} producto{productos.length === 1 ? '' : 's'} · venta neta {fmtCLP(ventaTotal)}</p>
          {puedeOperar && (
            <button onClick={sincronizarConCosteo} disabled={sincronizando} title="Vuelve a traer descripción, cantidad y monto desde el Costeo vigente — no toca el subestado ni renuncias"
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors">
              {sincronizando ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Sincronizar con costeo
            </button>
          )}
        </div>
        <div>
          <div className="h-2 rounded-full bg-zinc-200 overflow-hidden flex" title={`${conteo.listos} listos · ${conteo.pendientes} por avanzar`}>
            <div className="bg-emerald-500" style={{ width: `${pctListos}%` }} />
          </div>
          <p className="text-[12px] text-zinc-500 mt-1">
            <b className="text-emerald-700">{conteo.listos} listos para entrega</b> de {totalVivos} que hay que cumplir
            {conteo.fuera > 0 && <> · <span className="text-zinc-400">{conteo.fuera} fuera de la compra (no adjudicados o renunciados)</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {chip('todos', 'Todos', productos.length)}
          {chip('pendientes', 'Por avanzar', conteo.pendientes)}
          {chip('listos', 'Listos', conteo.listos)}
          {conteo.fuera > 0 && chip('fuera', 'Fuera de la compra', conteo.fuera)}
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar producto o línea…"
              className="w-56 text-[12.5px] border border-zinc-200 rounded-lg pl-7 pr-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 bg-white" />
          </div>
        </div>
      </div>
      {aviso && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11.5px] font-semibold text-amber-800">{aviso}</div>
      )}
      {conflictos.length > 0 && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-[11.5px] font-semibold text-rose-800">
          El acta de MP dio a otro proveedor {conflictos.length === 1 ? 'la línea' : 'las líneas'} {conflictos.map(c => c.correlativo).join(', ')}, pero Compras ya la avanzó ({conflictos.map(c => SUBESTADO_LABEL[c.subestado as Subestado] || c.subestado).join(', ')}). No se marcó sola: revisa si hay plata comprometida.
        </div>
      )}

      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[760px] text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-zinc-200 text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
              <th className="px-4 py-2 w-12">N°</th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 w-24 whitespace-nowrap">Cantidad</th>
              <th className="px-3 py-2 w-32 whitespace-nowrap">Se vendió a</th>
              <th className="px-3 py-2 w-52">Estado</th>
              <th className="px-3 py-2 w-24" />
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-[12.5px] text-zinc-400">Ningún producto coincide con la búsqueda o el filtro.</td></tr>
            )}
            {visibles.map(p => {
              const fuera = p.subestado === 'NO_ADJUDICADA' || p.subestado === 'RENUNCIADO';
              const l = p.subestado === 'NO_ADJUDICADA' ? perdidas.find(x => x.correlativo === p.correlativo) : null;
              return (
                <Fragment key={p.id}>
                  <tr className={`border-b border-zinc-100 align-middle ${fuera ? 'bg-zinc-50/70 text-zinc-400' : 'hover:bg-zinc-50/60'}`}>
                    <td className="px-4 py-2 text-[12px] text-zinc-400 tabular-nums">{lineasUnicas ? (p.correlativo ?? '—') : productos.indexOf(p) + 1}</td>
                    <td className="px-3 py-2 max-w-0">
                      <p title={p.descripcion} className={`text-[13px] font-semibold truncate ${fuera ? 'text-zinc-400' : 'text-zinc-800'} ${p.subestado === 'NO_ADJUDICADA' ? 'line-through decoration-zinc-400' : ''}`}>{p.descripcion}</p>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-zinc-600 whitespace-nowrap">{p.cantidad != null ? `${p.cantidad}${p.unidad ? ` ${p.unidad}` : ''}` : '—'}</td>
                    <td className="px-3 py-2 text-[12.5px] text-zinc-600 whitespace-nowrap tabular-nums" title="Precio de venta unitario de la oferta (no es lo que cuesta comprarlo)">{fmtCLP(p.montoUnitario)}</td>
                    <td className="px-3 py-2">
                      {p.subestado === 'NO_ADJUDICADA' ? (
                        <span title="No se compra ni cuenta para la entrega; se muestra solo como referencia." className="text-[11.5px] text-zinc-500">No adjudicada · la ganó {l?.proveedor || 'otro proveedor'}{l?.montoUnitario != null && ` (${fmtCLP(l.montoUnitario)})`}</span>
                      ) : p.subestado === 'RENUNCIADO' ? (
                        <span className="text-[11.5px] font-bold text-zinc-500">Renunciado</span>
                      ) : puedeOperar ? (
                        <Select value={p.subestado} onChange={v => accion({ productoId: p.id, accion: 'subestado', subestado: v })}
                          options={OPCIONES_SUBESTADO} minWidth={150} disabled={guardando === p.id} />
                      ) : (
                        <span className="text-[12px] font-semibold text-zinc-600">{SUBESTADO_LABEL[p.subestado]}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {puedeOperar && !fuera && !p.renunciaMotivo && (
                        <button onClick={() => { setRenunciaAbierta(p.id); setMotivoRenuncia(''); }} className="text-[11.5px] font-semibold text-rose-500 hover:text-rose-700">Renunciar</button>
                      )}
                    </td>
                  </tr>
                  {p.renunciaMotivo && !fuera && (
                    <tr key={`${p.id}-r`} className="border-b border-zinc-100">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                          <p className="text-[12px] text-amber-800"><Flag size={12} className="inline mr-1" />Renuncia propuesta por {p.renunciaPropuestaPorNombre}: {p.renunciaMotivo}</p>
                          {esJefeDeVentas && (
                            <button onClick={() => accion({ productoId: p.id, accion: 'aprobar_renuncia' })} className="flex-shrink-0 text-[11.5px] font-bold text-white bg-amber-600 hover:bg-amber-700 px-2 py-1 rounded-lg">Aprobar renuncia</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {renunciaAbierta === p.id && (
                    <tr key={`${p.id}-m`} className="border-b border-zinc-100">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <input autoFocus value={motivoRenuncia} onChange={e => setMotivoRenuncia(e.target.value)} placeholder="Motivo de la renuncia a esta línea…"
                            className="flex-1 text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                          <button onClick={() => proponerRenuncia(p.id)} disabled={!motivoRenuncia.trim()} className="text-[12px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Proponer</button>
                          <button onClick={() => setRenunciaAbierta(null)} className="text-zinc-400 hover:text-zinc-600"><X size={15} /></button>
                        </div>
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
  );
}
