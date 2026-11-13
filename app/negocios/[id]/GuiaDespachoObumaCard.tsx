'use client';

// Guía de despacho en Obuma (solo Inversiones Claro, la única empresa con Obuma). Se elige una OC de Obuma del negocio y se arma un
// BORRADOR: productos, SKU y cantidades de la OC con el precio de VENTA del costeo, el cliente (comprador de la OC de Mercado Público),
// la bodega y el transporte, más el JSON exacto que iría a Obuma. Crear emite un documento tributario real (Obuma lo manda al SII):
// lo confirma una persona marcando la casilla. Si se edita algo, hay que actualizar el borrador antes de crear.
import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconLoader2 as Loader2, IconTruckDelivery as Truck } from '@tabler/icons-react';

interface Oc { folio: string; proveedor: string; total: number; lineas: number }
interface Linea { productoIdObuma: string; sku: string | null; nombre: string; cantidad: number; precioCompraNeto: number; precioNeto: number | null; origenPrecio: 'costeo' | 'manual' | null; subtotalNeto: number }
interface Guia { folioOc: string; lineas: Linea[]; totalNeto: number; faltanPrecios: number }
interface Datos {
  clienteRut: string; clienteRazonSocial: string; clienteGiro: string; clienteDireccion: string; clienteComuna: string; clienteRegion: string;
  clienteEmail: string; clienteTelefono: string; clienteContacto: string; direccionDespacho: string; bodegaCodigo: string;
  tipoTraslado: number; tipoDespacho: number; choferRut: string; choferNombre: string; patente: string; rebajarStock: boolean; observacion: string;
}
interface Respuesta { guia: Guia; datos: Datos; bodegas: { codigo: string; nombre: string }[]; avisos: string[]; doc: Record<string, unknown>; faltan: string[]; clienteEnObuma: boolean }

const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
const TRASLADOS: [number, string][] = [[1, 'Operación constituye venta'], [2, 'Ventas por efectuar'], [3, 'Consignaciones'], [4, 'Entrega gratuita'], [5, 'Traslado interno'], [6, 'Otros traslados no venta'], [7, 'Guía de devolución']];
const DESPACHOS: [number, string][] = [[1, 'Por cuenta del cliente'], [2, 'Nosotros a instalaciones del cliente'], [3, 'Nosotros a otras instalaciones']];

function Campo({ label, value, onChange, ancho = '' }: { label: string; value: string; onChange: (v: string) => void; ancho?: string }) {
  return (
    <label className={`block ${ancho}`}>
      <span className="block text-[11.5px] font-semibold text-zinc-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        className={`mt-0.5 w-full text-[13px] border rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 ${value.trim() ? 'border-zinc-300' : 'border-amber-300 bg-amber-50/40'}`} />
    </label>
  );
}

export function GuiaDespachoObumaCard({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const [ocs, setOcs] = useState<Oc[] | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [folio, setFolio] = useState('');
  const [r, setR] = useState<Respuesta | null>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [sucio, setSucio] = useState(false);
  const [confirmo, setConfirmo] = useState(false);
  const [creada, setCreada] = useState<{ folio: string | null; pdf: string | null; simulada: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const url = `/api/compras/${negocioId}/guia-despacho-obuma`;

  useEffect(() => {
    fetch(url).then(x => x.json()).then(d => {
      if (d?.success) { setOcs(d.ocs); setSimulando(!!d.simulando); if (d.ocs.length === 1) setFolio(d.ocs[0].folio); } else setOcs([]);
    }).catch(() => setOcs([]));
  }, [url]);

  const preciosManual = () => Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v.replace(/[^\d]/g, '')) || 0]).filter(([, v]) => (v as number) > 0));
  const set = <K extends keyof Datos>(k: K, v: Datos[K]) => { setDatos(d => (d ? { ...d, [k]: v } : d)); setSucio(true); setConfirmo(false); };

  const llamar = async (enviar: boolean, permitirRepetida = false) => {
    setOcupado(true);
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folioOc: folio, preciosManual: preciosManual(), datos: datos ?? undefined, enviar, permitirRepetida }),
      });
      const d = await res.json();
      if (res.status === 409 && d.repetida) {
        if (window.confirm(`${d.error}\n\n¿Crear otra guía de todas formas?`)) return await llamar(true, true);
        return;
      }
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo.');
      setR(d); setDatos(d.datos); setSucio(false);
      if (enviar && d.envio) {
        setCreada({ folio: d.envio.folio, pdf: d.envio.pdf, simulada: d.envio.simulada });
        setConfirmo(false);
        toast.success(d.envio.simulada ? 'Guía simulada' : 'Guía creada en Obuma', `Folio ${d.envio.folio ?? '(sin folio en la respuesta)'}`);
      }
    } catch (e: any) { toast.error(enviar ? 'No se pudo crear la guía' : 'No se pudo armar el borrador', e.message); }
    finally { setOcupado(false); }
  };

  if (ocs === null) return null;

  if (ocs.length === 0) return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-4">
      <div className="flex items-center gap-2"><Truck size={18} className="text-zinc-400" /><h3 className="text-[14px] font-semibold text-zinc-700">Guía de despacho en Obuma</h3></div>
      <p className="mt-1 text-[12.5px] text-zinc-500">Este negocio aún no tiene una orden de compra de Obuma con folio. Cuando la tenga (créala en «Compra y logística» o anota su N°), aquí podrás armar la guía con sus productos y SKU.</p>
    </section>
  );

  const guia = r?.guia;
  const precioDe = (l: Linea) => l.precioNeto ?? (Number((manual[l.productoIdObuma] || '').replace(/[^\d]/g, '')) || null);
  const neto = guia ? guia.lineas.reduce((s, l) => s + (precioDe(l) ?? 0) * l.cantidad, 0) : 0;
  const iva = Math.round(neto * 0.19);
  const faltan = r?.faltan ?? [];
  const puedeCrear = !!r && !sucio && faltan.length === 0 && confirmo && !ocupado && !creada;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2"><Truck size={18} className="text-teal-700" /><h3 className="text-[14px] font-semibold text-zinc-900">Guía de despacho en Obuma</h3></div>
      <p className="text-[12.5px] text-zinc-500">Se arma con los productos y SKU de una orden de compra de Obuma de este negocio, con el <b>precio de venta</b> del costeo.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={folio} onChange={e => { setFolio(e.target.value); setR(null); setDatos(null); setManual({}); setCreada(null); setConfirmo(false); }}
          className="text-[13px] px-3 py-2 rounded-lg border border-zinc-300 bg-white min-w-[260px]">
          <option value="">Elige la orden de compra…</option>
          {ocs.map(o => <option key={o.folio} value={o.folio}>OC {o.folio} · {o.proveedor} · {o.lineas} líneas</option>)}
        </select>
        <button onClick={() => llamar(false)} disabled={!folio || ocupado}
          className={`inline-flex items-center gap-2 text-[13px] font-semibold px-3.5 py-2 rounded-lg border disabled:opacity-50 ${sucio ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50'}`}>
          {ocupado && <Loader2 size={14} className="animate-spin" />} {r ? (sucio ? 'Actualizar borrador (hay cambios)' : 'Actualizar borrador') : 'Ver borrador'}
        </button>
      </div>

      {r && guia && datos && (
        <div className="space-y-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-700">Borrador · aún no se envía a Obuma{simulando ? ' · modo simulación' : ''}</p>
          {r.avisos.map((a, i) => <p key={i} className="text-[12.5px] text-amber-700">{a}</p>)}

          <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
            <p className="text-[13px] font-semibold text-zinc-800">Cliente <span className={`ml-2 text-[11.5px] font-medium ${r.clienteEnObuma ? 'text-teal-700' : 'text-amber-700'}`}>{r.clienteEnObuma ? 'ya existe en Obuma (Obuma usa sus datos guardados)' : 'no existe en Obuma: se crea con estos datos'}</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Campo label="RUT" value={datos.clienteRut} onChange={v => set('clienteRut', v)} />
              <Campo label="Razón social" value={datos.clienteRazonSocial} onChange={v => set('clienteRazonSocial', v)} ancho="sm:col-span-2" />
              <Campo label="Giro" value={datos.clienteGiro} onChange={v => set('clienteGiro', v)} />
              <Campo label="Dirección" value={datos.clienteDireccion} onChange={v => set('clienteDireccion', v)} ancho="sm:col-span-2" />
              <Campo label="Comuna" value={datos.clienteComuna} onChange={v => set('clienteComuna', v)} />
              <Campo label="Región" value={datos.clienteRegion} onChange={v => set('clienteRegion', v)} />
              <Campo label="Contacto" value={datos.clienteContacto} onChange={v => set('clienteContacto', v)} />
              <Campo label="Email" value={datos.clienteEmail} onChange={v => set('clienteEmail', v)} />
              <Campo label="Teléfono" value={datos.clienteTelefono} onChange={v => set('clienteTelefono', v)} />
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
            <p className="text-[13px] font-semibold text-zinc-800">Despacho</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="block text-[11.5px] font-semibold text-zinc-500">Bodega de Obuma</span>
                <select value={datos.bodegaCodigo} onChange={e => set('bodegaCodigo', e.target.value)} className="mt-0.5 w-full text-[13px] border border-zinc-300 rounded-md px-2 py-1.5 bg-white">
                  <option value="">Elige…</option>
                  {r.bodegas.map(b => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11.5px] font-semibold text-zinc-500">Tipo de traslado</span>
                <select value={datos.tipoTraslado} onChange={e => set('tipoTraslado', Number(e.target.value))} className="mt-0.5 w-full text-[13px] border border-zinc-300 rounded-md px-2 py-1.5 bg-white">
                  {TRASLADOS.map(([v, t]) => <option key={v} value={v}>{v} · {t}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11.5px] font-semibold text-zinc-500">Quién despacha</span>
                <select value={datos.tipoDespacho} onChange={e => set('tipoDespacho', Number(e.target.value))} className="mt-0.5 w-full text-[13px] border border-zinc-300 rounded-md px-2 py-1.5 bg-white">
                  {DESPACHOS.map(([v, t]) => <option key={v} value={v}>{v} · {t}</option>)}
                </select>
              </label>
              <Campo label="RUT del chofer" value={datos.choferRut} onChange={v => set('choferRut', v)} />
              <Campo label="Nombre del chofer" value={datos.choferNombre} onChange={v => set('choferNombre', v)} />
              <Campo label="Patente" value={datos.patente} onChange={v => set('patente', v)} />
              <Campo label="Dirección de despacho" value={datos.direccionDespacho} onChange={v => set('direccionDespacho', v)} ancho="sm:col-span-2" />
              <label className="flex items-center gap-2 text-[12.5px] text-zinc-700 pt-4">
                <input type="checkbox" checked={datos.rebajarStock} onChange={e => set('rebajarStock', e.target.checked)} /> Rebajar stock en la bodega
              </label>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full text-[12.5px]">
              <thead className="bg-zinc-50 text-zinc-500 text-left"><tr>
                <th className="px-3 py-2">SKU Obuma</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-right">Precio venta neto</th><th className="px-3 py-2 text-right">Subtotal</th>
              </tr></thead>
              <tbody>{guia.lineas.map(l => {
                const p = precioDe(l);
                return (
                  <tr key={l.productoIdObuma} className={`border-t border-zinc-100 ${l.precioNeto == null ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-3 py-1.5">{l.sku || '—'}</td>
                    <td className="px-3 py-1.5">{l.nombre}<span className="block text-[11px] text-zinc-400">Compra: {clp(l.precioCompraNeto)} c/u</span></td>
                    <td className="px-3 py-1.5 text-right">{l.cantidad}</td>
                    <td className="px-3 py-1.5 text-right">
                      {l.origenPrecio === 'costeo' ? clp(l.precioNeto!) : (
                        <input inputMode="numeric" value={manual[l.productoIdObuma] ?? ''} placeholder="No está en el costeo"
                          onChange={e => { setManual(m => ({ ...m, [l.productoIdObuma]: e.target.value })); setSucio(true); setConfirmo(false); }}
                          className="w-36 text-right tabular-nums border border-amber-300 rounded-md px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-teal-500" />
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold">{p != null ? clp(p * l.cantidad) : '—'}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot className="bg-zinc-50">
                <tr className="border-t border-zinc-200"><td colSpan={4} className="px-3 py-1.5 text-right text-zinc-600">Neto</td><td className="px-3 py-1.5 text-right font-semibold">{clp(neto)}</td></tr>
                <tr><td colSpan={4} className="px-3 py-1.5 text-right text-zinc-600">IVA 19 %</td><td className="px-3 py-1.5 text-right">{clp(iva)}</td></tr>
                <tr><td colSpan={4} className="px-3 py-1.5 text-right font-semibold">Total</td><td className="px-3 py-1.5 text-right font-semibold">{clp(neto + iva)}</td></tr>
              </tfoot>
            </table>
          </div>

          <details className="rounded-lg border border-zinc-200">
            <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-semibold text-zinc-700">Ver exactamente lo que se manda a Obuma{sucio ? ' (desactualizado: actualiza el borrador)' : ''}</summary>
            <pre className="max-h-80 overflow-auto bg-zinc-50 px-3 py-2 text-[11.5px] leading-snug">{JSON.stringify(r.doc, null, 2)}</pre>
          </details>

          {faltan.length > 0 && <p className="text-[12.5px] text-amber-700"><b>Falta para crearla:</b> {faltan.join(', ')}.</p>}
          {creada ? (
            <p className="text-[13px] text-teal-800">
              {creada.simulada ? 'Guía simulada (no se envió nada a Obuma)' : 'Guía creada en Obuma'} · folio <b>{creada.folio ?? 'sin folio en la respuesta'}</b>
              {creada.pdf && <> · <a href={creada.pdf} target="_blank" rel="noreferrer" className="underline">ver PDF</a></>}
            </p>
          ) : (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-[12.5px] text-zinc-700">
                <input type="checkbox" className="mt-0.5" checked={confirmo} disabled={sucio || faltan.length > 0} onChange={e => setConfirmo(e.target.checked)} />
                <span>{simulando ? 'Revisé el borrador (modo simulación: no se envía nada a Obuma).' : 'Revisé el borrador. Entiendo que Obuma emite una guía de despacho real y la manda al SII.'}</span>
              </label>
              <button onClick={() => llamar(true)} disabled={!puedeCrear}
                className="inline-flex items-center gap-2 text-[13px] font-semibold px-3.5 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                {ocupado && <Loader2 size={14} className="animate-spin" />} Crear guía en Obuma
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
