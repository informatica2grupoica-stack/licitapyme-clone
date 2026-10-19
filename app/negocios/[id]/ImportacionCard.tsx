'use client';

// RUTA DE IMPORTACIÓN Y COSTEO ATERRIZADO (spec §12). Solo se muestra completo cuando el origen es
// IMPORTACION: "la cotización FOB no es el costo del producto" — acá se suma flete internacional +
// aduana + logística local, prorrateados POR UNIDAD, para saber el costo real puesto en bodega.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconShip as Ship, IconLoader2 as Loader2, IconDeviceFloppy as Save } from '@tabler/icons-react';

type Origen = 'LOCAL' | 'IMPORTACION';
interface Embarque { fleteInternacional: number | null; costosAduana: number | null; costoLogisticoLocal: number | null; notas: string | null }
interface ProductoImp { productoId: number; descripcion: string; cantidad: number | null; proveedor: string | null; importado: boolean }
interface ItemAterrizado { importado: boolean; productoId: number; descripcion: string; proveedor: string | null; cantidad: number | null; precioUnitarioFob: number | null; costoUnitarioAterrizado: number | null; subtotalAterrizado: number | null }
interface CostoAterrizado { items: ItemAterrizado[]; totalUnidades: number; extraPorUnidad: number; totalAterrizado: number; totalFob: number }

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ImportacionCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [embarque, setEmbarque] = useState<Embarque | null>(null);
  const [costoAterrizado, setCostoAterrizado] = useState<CostoAterrizado | null>(null);
  const [productos, setProductos] = useState<ProductoImp[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fleteInternacional: '', costosAduana: '', costoLogisticoLocal: '', notas: '' });
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setOrigen(data.origen?.origen || null);
      setEmbarque(data.embarque);
      setCostoAterrizado(data.costoAterrizado); setProductos(data.productos || []);
      if (data.embarque) setForm({
        fleteInternacional: data.embarque.fleteInternacional != null ? String(data.embarque.fleteInternacional) : '',
        costosAduana: data.embarque.costosAduana != null ? String(data.embarque.costosAduana) : '',
        costoLogisticoLocal: data.embarque.costoLogisticoLocal != null ? String(data.embarque.costoLogisticoLocal) : '',
        notas: data.embarque.notas || '',
      });
    } catch (e: any) {
      toast.error('No se pudo cargar la ruta de importación', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const definirOrigen = async (v: string) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'origen', origen: v }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo definir');
      setOrigen(data.origen?.origen || null); setCostoAterrizado(data.costoAterrizado); setProductos(data.productos || []);
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo definir el origen', e.message);
    }
  };

  const marcar = async (productoId: number, importado: boolean) => {
    setProductos(ps => ps.map(p => p.productoId === productoId ? { ...p, importado } : p));
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'producto', productoId, importado }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setOrigen(data.origen?.origen || null); setCostoAterrizado(data.costoAterrizado); setProductos(data.productos || []);
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo marcar el producto', e.message);
      cargar();
    }
  };

  const guardarEmbarque = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'embarque', ...form }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Datos del embarque guardados');
      setEmbarque(data.embarque); setCostoAterrizado(data.costoAterrizado);
      recargarCompartido(); // el costo aterrizado alimenta el margen de la Compuerta 2
    } catch (e: any) {
      toast.error('No se pudo guardar', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  const nImp = productos.filter(p => p.importado).length;
  const campo = (clave: 'fleteInternacional' | 'costosAduana' | 'costoLogisticoLocal', titulo: string, ayuda: string) => (
    <label className="block rounded-lg border border-zinc-200 px-3 py-2.5">
      <span className="block text-[12.5px] font-bold text-zinc-800">{titulo}</span>
      <span className="block text-[11.5px] text-zinc-500 leading-snug mb-1.5">{ayuda}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-[13px] text-zinc-400">$</span>
        <input inputMode="numeric" value={form[clave]} onChange={e => setForm(f => ({ ...f, [clave]: e.target.value }))} disabled={!puedeOperar} placeholder="0 si no hubo"
          className="w-full text-[13px] border border-zinc-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-zinc-50" />
      </span>
    </label>
  );

  return (
    <div className="space-y-4" data-testid="importacion-guia">
      {/* PASO 1 */}
      <section className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
        <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-2">
          <span className="inline-flex w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">1</span>
          <Ship size={14} /> ¿De dónde viene lo que compraste?
          {origen && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">✔ Elegido: {origen === 'LOCAL' ? 'Todo local' : `${nImp} importado(s)`}</span>}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {([
            { v: 'LOCAL', t: 'Todo se compró en Chile', d: 'Los proveedores son nacionales. No hay nada más que hacer en esta pestaña.' },
            { v: 'IMPORTACION', t: 'Algo viene del extranjero', d: 'Marcas cuáles productos vienen de afuera y anotas flete, aduana y traslado para saber su costo real.' },
          ] as const).map(o => {
            const on = origen === o.v;
            return (
              <button key={o.v} type="button" onClick={() => definirOrigen(o.v)} disabled={!puedeOperar} data-testid={`origen-${o.v}`}
                className={`text-left rounded-xl border-2 px-3.5 py-3 transition-colors disabled:cursor-not-allowed ${on ? 'border-teal-500 bg-teal-50' : 'border-zinc-200 bg-white hover:border-teal-300 hover:bg-zinc-50'}`}>
                <span className="block text-[13px] font-bold text-zinc-800">{on ? '✔ ' : ''}{o.t}</span>
                <span className="block mt-1 text-[11.5px] text-zinc-500 leading-snug">{o.d}</span>
              </button>
            );
          })}
        </div>
        {!origen && <p className="text-[12px] text-zinc-500">Elige una opción para seguir. Si no estás seguro, pregunta a quien hizo la compra.</p>}
        {origen === 'IMPORTACION' && (
          <div className="space-y-1.5 pt-1" data-testid="importacion-productos">
            <p className="text-[12.5px] font-bold text-zinc-800">¿Cuáles productos vienen del extranjero? <span className="font-normal text-zinc-500">Marca solo esos; el resto se compra en Chile.</span></p>
            {productos.length === 0 ? <p className="text-[12px] text-zinc-500">Todavía no hay productos en esta compra.</p> : productos.map(p => (
              <label key={p.productoId} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer ${p.importado ? 'border-teal-400 bg-teal-50' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
                <input type="checkbox" checked={p.importado} disabled={!puedeOperar} onChange={e => marcar(p.productoId, e.target.checked)} className="accent-teal-600" />
                <span className="flex-1 text-[12.5px] font-semibold text-zinc-800">{p.descripcion.split(' - ')[0]}{p.cantidad != null && <span className="font-normal text-zinc-500"> · {p.cantidad} un.</span>}{p.proveedor && <span className="font-normal text-zinc-400"> · {p.proveedor}</span>}</span>
                <span className={`text-[11px] font-bold ${p.importado ? 'text-teal-700' : 'text-zinc-400'}`}>{p.importado ? '✈ Del extranjero' : 'Se compra en Chile'}</span>
              </label>
            ))}
            {nImp === 0 && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Marca al menos un producto para seguir con los costos del embarque.</p>}
          </div>
        )}
      </section>

      {origen === 'LOCAL' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12.5px] text-emerald-900">
          <b>Listo: aquí no hay nada más que hacer.</b> Como la compra es local, no se suman costos de importación. Sigue con la pestaña «Gastos extra» (si hubo algún gasto) o con la Entrega.
        </div>
      )}

      {origen === 'IMPORTACION' && nImp > 0 && (<>
        {/* PASO 2 */}
        <section className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
          <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-2">
            <span className="inline-flex w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">2</span>
            Anota lo que costó traerlo
          </p>
          <p className="text-[12px] text-zinc-500">El precio que cobra el proveedor extranjero (FOB) no es el costo real. Anota estos tres gastos del embarque de los productos marcados; si alguno no hubo, déjalo en 0. El sistema los reparte solo entre las unidades importadas y calcula su costo real; lo comprado en Chile no lleva estos costos.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {campo('fleteInternacional', 'Flete internacional', 'Lo que cobró el transporte por traerlo desde afuera (barco o avión). El total del embarque.')}
            {campo('costosAduana', 'Aduana', 'Aranceles, impuestos de importación y gastos de la agencia de aduana.')}
            {campo('costoLogisticoLocal', 'Traslado dentro de Chile', 'Sacarlo del puerto o aeropuerto y llevarlo a la bodega (desaduanaje y camión).')}
          </div>
          <Banner variante="info">Con el proveedor extranjero se trabaja por escrito: lo importante es tener la factura proforma y la ficha técnica.</Banner>
          {puedeOperar && (
            <button onClick={guardarEmbarque} disabled={guardando} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 rounded-lg">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar costos del embarque
            </button>
          )}
        </section>

        {/* PASO 3 */}
        <section className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
          <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-2">
            <span className="inline-flex w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">3</span>
            Revisa el costo real de cada producto
          </p>
          {costoAterrizado ? (
            <div>
              <p className="text-[12px] text-zinc-500 mb-1.5">A cada unidad se le suman ${Math.round(costoAterrizado.extraPorUnidad).toLocaleString('es-CL')} de los gastos de arriba. «FOB» es lo que cobra el proveedor; la flecha lleva al costo real.</p>
              <div className="space-y-1">
                {costoAterrizado.items.filter(it => it.importado).map(it => (
                  <div key={it.productoId} className="flex items-center justify-between gap-2 bg-zinc-50 rounded-lg px-3 py-2">
                    <span className="text-[12px] text-zinc-700 truncate">{it.descripcion}</span>
                    <span className="text-[12px] font-semibold text-zinc-800 flex-shrink-0">FOB {fmtCLP(it.precioUnitarioFob)} → <b>{fmtCLP(it.costoUnitarioAterrizado)}</b></span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-[13px] font-bold text-zinc-700">Costo real total</span>
                <span className="text-[16px] font-bold text-zinc-900">{fmtCLP(costoAterrizado.totalAterrizado)}</span>
              </div>
              <p className="text-[11.5px] text-zinc-500 px-1">Solo el proveedor cobra {fmtCLP(costoAterrizado.totalFob)}. Esta cifra más alta (no el FOB) es la que se usa para calcular la ganancia del proyecto.</p>
            </div>
          ) : (
            <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Todavía no se puede calcular. Falta elegir un escenario de compra en «Costeo y auditoría» y guardar los costos del paso 2.</p>
          )}
        </section>
      </>)}
    </div>
  );
}
