'use client';

// GASTO CON SKU Y OC (05-nov-2026, pedido del dueño): en «Compra y logística → Gastos extra», un gasto imprevisto que necesita SKU, OC y
// factura (grúa, armado, instalación o un flete que salió después). Se elige FLETE o ADICIONAL. Por dentro es un servicio
// (compras_producto.es_servicio + servicio_tipo, migrations 177/181: no va al costeo ni al acta) con una compra directa (compra rápida,
// migration-151): el jefe de ventas aprueba SOLO ese ítem, sin anular la aprobación de la compra completa. Aprobado, pasa a Comprado y
// entra a la OC de su proveedor (proveedoresParaOrdenCompra). Los gastos sin SKU ni OC siguen en «Anotar un gasto» (GastosCard).
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconPlus as Plus, IconLoader2 as Loader2, IconTruck as Truck, IconTool as Tool, IconBarcode as Barcode, IconGasStation as Fuel } from '@tabler/icons-react';
import { rutValido, formatearRut } from './FletesCompra';
import { TIPOS_COMBUSTIBLE, calcularCarga, cuadraConFactura, etiquetaCombustible, parsearLitros, validarCarga, type CargaCombustible, type TipoCombustible } from '@/app/lib/compras-combustible-core';

type Tipo = 'FLETE' | 'ADICIONAL' | 'COMBUSTIBLE';
interface Servicio { id: number; descripcion: string; cantidad: number | null; esServicio: boolean; servicioTipo: Tipo | null; subestado: string }
interface Rapida { productoId: number; estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'; proveedorNombre: string | null; proveedorRut: string | null; precioUnitario: number | null; comentario: string | null; resueltoPorNombre: string | null }
interface Cotizacion { id: number; archivoUrl: string | null; items: Array<{ productoId: number }> }
type Form = { tipo: Tipo | null; nombre: string; proveedor: string; rut: string; precio: string; cantidad: string; comb: string; litros: string; netoComb: string; impuesto: string; patente: string; totalFact: string };
interface CargaVista extends CargaCombustible { productoId: number }
const FORM_VACIO: Form = { tipo: null, nombre: '', proveedor: '', rut: '', precio: '', cantidad: '', comb: 'DIESEL', litros: '', netoComb: '', impuesto: '', patente: '', totalFact: '' };

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const monto = (t: string): number | null => { const n = Number(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const ETIQUETA: Record<Tipo, string> = { FLETE: 'Flete', ADICIONAL: 'Adicional', COMBUSTIBLE: 'Combustible' };
/** La carga que dicen los campos del formulario (litros con coma decimal; neto e impuesto en pesos enteros). */
const cargaDelForm = (f: Form): CargaCombustible => {
  const n = (t: string) => Number(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return { tipo: f.comb as TipoCombustible, litros: parsearLitros(f.litros), netoAfecto: n(f.netoComb), impuestoEspecifico: f.impuesto.trim() ? n(f.impuesto) : 0, patente: f.patente.trim() || null };
};

export function ServiciosConSkuCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [rapidas, setRapidas] = useState<Rapida[]>([]);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [cargas, setCargas] = useState<Map<number, CargaVista>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [reenviando, setReenviando] = useState<number | null>(null);
  const [quitando, setQuitando] = useState<number | null>(null);
  const [leyendo, setLeyendo] = useState<{ estado: 'leyendo' | 'ok' | 'sin_precio' | 'error'; texto?: string } | null>(null);
  const [provInfo, setProvInfo] = useState<{ estado: 'cargando' | 'sistema' | 'obuma' | 'no_existe' | 'error'; nombre?: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [rP, rR, rC, rK] = await Promise.all([fetch(`/api/compras/${negocioId}/productos`), fetch(`/api/compras/${negocioId}/compra-rapida`), fetch(`/api/compras/${negocioId}/cotizaciones`), fetch(`/api/compras/${negocioId}/combustible`)]);
      const [dP, dR, dC, dK] = await Promise.all([rP.json(), rR.json(), rC.json().catch(() => ({})), rK.json().catch(() => ({}))]);
      if (dP.success) setServicios((dP.productos || []).filter((p: Servicio) => p.esServicio));
      if (dR.success) setRapidas(dR.compras || []);
      if (dC.success) setCotizaciones(dC.cotizaciones || []);
      if (dK.success) setCargas(new Map((dK.cargas || []).map((c: CargaVista) => [c.productoId, c])));
    } catch (e: any) { toast.error('No se pudieron cargar los gastos con SKU', e.message); }
    finally { setCargando(false); }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar]);

  // Solo los que pasan por aprobación de un ítem (compra rápida): los fletes elegidos en «Compara y elige» siguen en su apartado de Fletes.
  const rapidaDe = new Map(rapidas.map(r => [r.productoId, r]));
  const lista = servicios.filter(s => rapidaDe.has(s.id) && !['RENUNCIADO', 'NO_ADJUDICADA'].includes(s.subestado));
  if (cargando || (lista.length === 0 && !puedeOperar)) return null;

  const set = (p: Partial<Form>) => setForm(f => (f ? { ...f, ...p } : f));

  const cambiarRut = async (texto: string) => {
    const rut = formatearRut(texto);
    set({ rut }); setProvInfo(null);
    if (!rutValido(rut)) return;
    setProvInfo({ estado: 'cargando' });
    const limpio = (x: string) => x.replace(/[^0-9kK]/g, '').toUpperCase();
    const rellenar = (nombre: string) => setForm(f => (f && limpio(f.rut) === limpio(rut) ? { ...f, proveedor: f.proveedor.trim() ? f.proveedor : nombre } : f));
    try {
      const rs = await fetch(`/api/compras/proveedores?q=${encodeURIComponent(rut)}`);
      const ds = await rs.json();
      const mio = (ds.proveedores || []).find((x: any) => x.rut && limpio(x.rut) === limpio(rut));
      if (mio) { rellenar(mio.nombreEmpresa); setProvInfo({ estado: 'sistema', nombre: mio.nombreEmpresa }); return; }
      const ro = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/proveedor?rut=${encodeURIComponent(rut)}`);
      const d = await ro.json();
      if (!ro.ok || !d.success) throw new Error(d.error || 'error');
      if (d.existe && d.ficha) { rellenar(d.ficha.razonSocial); setProvInfo({ estado: 'obuma', nombre: d.ficha.razonSocial }); }
      else setProvInfo({ estado: 'no_existe' });
    } catch { setProvInfo({ estado: 'error' }); }
  };

  /** Lee el documento (sin guardar nada) y propone precio neto, proveedor y RUT; lo que ya escribiste no se pisa. */
  const elegirArchivo = async (file: File | null) => {
    setArchivo(file); setLeyendo(null);
    if (!file || form?.tipo === 'COMBUSTIBLE') return;   // la factura de combustible se digita (neto e impuesto van aparte): no se lee un «precio» del documento
    setLeyendo({ estado: 'leyendo' });
    try {
      const fd = new FormData(); fd.set('file', file);
      const r = await fetch(`/api/compras/${negocioId}/cotizaciones/extraer`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo leer el documento');
      const ex = d.extraido;
      const bruto = ex?.precioUnitario ?? ex?.precioTotal ?? null;
      const neto = bruto != null && ex?.moneda && !String(ex.moneda).toUpperCase().includes('CLP') && !/peso/i.test(String(ex.moneda)) ? null : bruto;
      const precioNeto = neto != null ? Math.round(ex?.ivaIncluido ? neto / 1.19 : neto) : null;
      setForm(f => (f ? { ...f, precio: f.precio.trim() || (precioNeto != null ? String(precioNeto) : ''), proveedor: f.proveedor.trim() || ex?.proveedorNombre || '', rut: f.rut.trim() || (ex?.proveedorRut ? formatearRut(ex.proveedorRut) : '') } : f));
      setLeyendo(precioNeto != null
        ? { estado: 'ok', texto: `Leí el documento: precio neto ${clp(precioNeto)}${ex?.ivaIncluido ? ' (le descontué el IVA)' : ''}. Revísalo antes de guardar.` }
        : { estado: 'sin_precio', texto: 'Leí el documento pero no encontré el precio: escríbelo a mano (neto, sin IVA).' });
    } catch (e: any) { setLeyendo({ estado: 'error', texto: `No se pudo leer el documento (${e.message}). Escribe el precio a mano.` }); }
  };

  const guardar = async () => {
    if (!form) return;
    const proveedor = form.proveedor.trim(), rut = form.rut.trim();
    if (!form.tipo) return toast.error('Falta elegir', '¿Es un flete, un adicional o combustible?');
    const esComb = form.tipo === 'COMBUSTIBLE';
    const carga = esComb ? cargaDelForm(form) : null;
    // Combustible: el costo es neto + impuesto específico (el IVA es crédito fiscal); el nombre se arma solo.
    const precio = esComb ? calcularCarga(carga!).costo : monto(form.precio);
    const nombre = esComb ? `Combustible ${etiquetaCombustible(carga!.tipo)} ${carga!.litros.toLocaleString('es-CL')} L${carga!.patente ? ` ${carga!.patente.toUpperCase()}` : ''}` : form.nombre.trim();
    const totalFactura = esComb ? monto(form.totalFact) : null;
    if (carga) {
      const e = validarCarga(carga); if (e) return toast.error('Revisa la carga', e);
      // La carga tiene que cuadrar con la factura, así la OC de Obuma queda igual a ella (neto + impuesto exento + IVA = total).
      if (totalFactura == null) return toast.error('Falta el total de la factura', 'Escribe el total que dice la factura del combustible.');
      if (!cuadraConFactura(carga, totalFactura)) return toast.error('La carga no cuadra con la factura', `Neto + impuesto específico + IVA da ${clp(calcularCarga(carga).totalFactura)} y la factura dice ${clp(totalFactura)}. Revisa el neto y el impuesto.`);
    }
    if (!nombre) return toast.error('Falta qué es', form.tipo === 'FLETE' ? 'Por ejemplo «Flete Santiago – Temuco».' : 'Por ejemplo «Grúa horquilla para descarga».');
    if (!proveedor) return toast.error('Falta el proveedor', 'Es obligatorio para crear el SKU y emitir la OC.');
    if (!rutValido(rut)) return toast.error('El RUT del proveedor no es válido', 'Escríbelo con dígito verificador, por ejemplo 76.123.456-7.');
    if (precio == null) return toast.error('Falta el precio', 'Pon el precio neto (sin IVA).');
    // Cantidad (flete/adicional): el precio que se escribe es POR UNIDAD y el ítem se compra por esa cantidad (sin cantidad = 1).
    const cantidad = esComb ? 1 : (monto(form.cantidad) ?? 1);
    setGuardando(true);
    try {
      // 1 · El ítem (servicio: no va al costeo).
      const r = await fetch(`/api/compras/${negocioId}/productos`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'agregar_servicio', tipo: form.tipo, descripcion: nombre, cantidad, unidad: null, ...(carga ? { combustible: { ...carga, totalFactura } } : {}) }),
      });
      const d = await r.json();
      if (!r.ok || !d.success || !d.productoId) throw new Error(d.error || 'No se pudo crear el ítem');
      if (Array.isArray(d.avisos) && d.avisos.length) toast.warning('Revisa los números de la carga', d.avisos.join(' '));
      const productoId = Number(d.productoId);
      // 2 · Su compra directa: guarda la cotización y pide la aprobación del jefe de ventas SOLO de este ítem (compra rápida).
      const items = [{ productoId, precioUnitario: precio, cumple: 'CUMPLE' }];
      let r2: Response;
      if (archivo) {
        const fd = new FormData();
        fd.set('file', archivo); fd.set('origen', 'directa');
        fd.set('proveedorNombre', proveedor); fd.set('proveedorRut', rut); fd.set('precioUnitario', String(precio)); fd.set('moneda', 'CLP');
        fd.set('items', JSON.stringify(items));
        r2 = await fetch(`/api/compras/${negocioId}/cotizaciones`, { method: 'POST', body: fd });
      } else {
        r2 = await fetch(`/api/compras/${negocioId}/cotizaciones`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proveedorNombre: proveedor, proveedorRut: rut, origen: 'directa', precioUnitario: precio, moneda: 'CLP', notas: `${ETIQUETA[form.tipo]} agregado en Gastos extra, sin documento de cotización.`, items }),
        });
      }
      const d2 = await r2.json();
      if (!r2.ok || !d2.success) throw new Error(d2.error || 'No se pudo guardar la cotización');
      toast.success(`${ETIQUETA[form.tipo]} enviado a aprobación`, 'El jefe de ventas lo aprueba en «Aprobación y SKU». Lo demás que ya estaba aprobado no cambia.');
      setForm(null); setArchivo(null); setLeyendo(null); setProvInfo(null);
    } catch (e: any) {
      toast.error('No se pudo guardar', e.message);
    } finally {
      setGuardando(false);
      await cargar(); recargarCompartido();
    }
  };

  const reenviar = async (s: Servicio) => {
    setReenviando(s.id);
    try {
      const r = await fetch(`/api/compras/${negocioId}/compra-rapida`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId: s.id }) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo reenviar');
      toast.success('Reenviado a aprobación');
      await cargar(); recargarCompartido();
    } catch (e: any) { toast.error('No se pudo reenviar', e.message); }
    finally { setReenviando(null); }
  };

  const quitar = async (s: Servicio) => {
    if (!window.confirm(`¿Borrar «${s.descripcion}»? Se elimina el gasto y su cotización. No se puede deshacer.`)) return;
    setQuitando(s.id);
    try {
      const r = await fetch(`/api/compras/${negocioId}/productos`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'quitar_parte', productoId: s.id }) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo borrar');
      toast.success('Gasto borrado');
      await cargar(); recargarCompartido();
    } catch (e: any) { toast.error('No se pudo borrar', e.message); }
    finally { setQuitando(null); }
  };

  const campo = 'text-[12.5px] border border-zinc-300 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:ring-1 focus:ring-teal-500';
  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden" data-testid="servicios-con-sku">
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px] space-y-0.5">
          <p className="text-[13px] font-semibold text-zinc-800 flex items-center gap-1.5"><Barcode size={15} /> Gastos con SKU y orden de compra{lista.length > 0 && <span className="text-zinc-400 font-semibold">({lista.length})</span>}</p>
          <p className="text-[11.5px] text-zinc-500">Un flete, un adicional (grúa, armado, instalación) o una carga de combustible que necesita SKU, OC y factura. Lo aprueba el jefe de ventas solo a él: no toca el costeo ni lo que ya estaba aprobado.</p>
        </div>
        {puedeOperar && !form && (
          <button type="button" onClick={() => { setArchivo(null); setLeyendo(null); setProvInfo(null); setForm({ ...FORM_VACIO }); }} data-testid="agregar-con-sku"
            className="flex-shrink-0 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-2 rounded-lg"><Plus size={14} /> Agregar con SKU y OC</button>
        )}
      </div>

      {lista.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {lista.map(s => {
            const r = rapidaDe.get(s.id)!;
            const tipo: Tipo = s.servicioTipo ?? 'FLETE';
            const cot = cotizaciones.find(c => c.archivoUrl && c.items.some(i => i.productoId === s.id));
            return (
              <li key={s.id} className="px-4 py-2.5 flex items-start gap-3 flex-wrap" data-testid={`servicio-sku-${s.id}`}>
                <span className={`mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded border ${tipo === 'FLETE' ? 'bg-sky-50 text-sky-800 border-sky-200' : tipo === 'COMBUSTIBLE' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-cyan-50 text-cyan-800 border-cyan-200'}`}>
                  {tipo === 'FLETE' ? <Truck size={11} /> : tipo === 'COMBUSTIBLE' ? <Fuel size={11} /> : <Tool size={11} />} {ETIQUETA[tipo].toUpperCase()}
                </span>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[13px] font-semibold text-zinc-900">{s.descripcion}</p>
                  {cargas.get(s.id) && (() => { const c = cargas.get(s.id)!; const k = calcularCarga(c); return (
                    <p className="text-[11.5px] text-zinc-500 tabular-nums" data-testid={`carga-${s.id}`}>
                      {c.litros.toLocaleString('es-CL')} L · neto {clp(c.netoAfecto)} + impuesto específico {clp(c.impuestoEspecifico)} (exento) = <b className="text-zinc-700">{clp(k.costo)}</b> de costo · IVA {clp(k.iva)} (crédito) · total factura {clp(k.totalFactura)}{c.patente ? ` · ${c.patente}` : ''}
                    </p>
                  ); })()}
                  <p className="text-[12px] text-zinc-500">{r.proveedorNombre} · {r.proveedorRut || 'sin RUT'} · <b className="text-zinc-800 tabular-nums">{r.precioUnitario != null ? clp(r.precioUnitario * ((s.cantidad ?? 1) > 1 ? s.cantidad! : 1)) : 'sin precio'}</b> neto{(s.cantidad ?? 1) > 1 && r.precioUnitario != null && <span className="text-zinc-500 tabular-nums"> ({s.cantidad!.toLocaleString('es-CL')} × {clp(r.precioUnitario)})</span>}</p>
                  {r.estado === 'RECHAZADA' && <p className="text-[12px] text-rose-700">Rechazado{r.resueltoPorNombre ? ` por ${r.resueltoPorNombre}` : ''}: {r.comentario}</p>}
                  {r.estado === 'APROBADA' && <p className="text-[12px] text-zinc-500">Créale el SKU en «Aprobación y SKU» y emite la OC en «Órdenes y facturas».</p>}
                </div>
                <div className="flex items-center gap-2">
                  {cot && <button type="button" onClick={() => window.open(cot.archivoUrl!, '_blank', 'noopener,noreferrer')} className="text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700 px-2 py-1 rounded-md hover:bg-zinc-50">Ver cotización</button>}
                  <span className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-full ${r.estado === 'APROBADA' ? 'bg-emerald-50 text-emerald-700' : r.estado === 'RECHAZADA' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                    {r.estado === 'APROBADA' ? 'Aprobado' : r.estado === 'RECHAZADA' ? 'Rechazado' : 'Por aprobar'}
                  </span>
                  {puedeOperar && r.estado === 'RECHAZADA' && (
                    <button type="button" disabled={reenviando === s.id} onClick={() => reenviar(s)} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-50">Reenviar</button>
                  )}
                  {puedeOperar && (r.estado === 'RECHAZADA' || ['PENDIENTE', 'COTIZANDO'].includes(s.subestado)) && (
                    <button type="button" disabled={quitando === s.id} onClick={() => quitar(s)} data-testid={`borrar-servicio-${s.id}`} className="text-[11.5px] font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50">Borrar</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <div className="border-t border-zinc-100 px-4 py-3 space-y-2.5 bg-teal-50/30" data-testid="form-con-sku">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-semibold text-zinc-700">¿Qué es?</span>
            {(['FLETE', 'ADICIONAL', 'COMBUSTIBLE'] as const).map(t => (
              <button key={t} type="button" onClick={() => set({ tipo: t })} aria-pressed={form.tipo === t} data-testid={`tipo-${t.toLowerCase()}`}
                className={`inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1 rounded-lg border ${form.tipo === t ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-600 border-zinc-200 hover:border-teal-400'}`}>
                {t === 'FLETE' ? <Truck size={13} /> : t === 'COMBUSTIBLE' ? <Fuel size={13} /> : <Tool size={13} />} {ETIQUETA[t]}
              </button>
            ))}
          </div>
          {form.tipo && (
            <>
              {form.tipo !== 'COMBUSTIBLE' && (
                <input value={form.nombre} onChange={e => set({ nombre: e.target.value })} aria-label="Qué es"
                  placeholder={form.tipo === 'FLETE' ? 'Qué flete es (ej. Flete Santiago – Temuco)' : 'Qué adicional es (ej. Grúa horquilla para descarga)'} className={`${campo} w-full max-w-xl`} />
              )}
              {form.tipo === 'COMBUSTIBLE' && (() => {
                const c = cargaDelForm(form);
                const error = form.litros.trim() || form.netoComb.trim() ? validarCarga(c) : null;
                const k = !error && c.netoAfecto > 0 ? calcularCarga(c) : null;
                return (
                  <div className="space-y-1.5" data-testid="form-combustible">
                    <div className="flex items-center gap-2 flex-wrap">
                      <select value={form.comb} onChange={e => set({ comb: e.target.value })} aria-label="Tipo de combustible" className={`${campo} w-40`}>
                        {TIPOS_COMBUSTIBLE.map(t => <option key={t.clave} value={t.clave}>{t.etiqueta}</option>)}
                      </select>
                      <input value={form.litros} onChange={e => set({ litros: e.target.value })} inputMode="decimal" placeholder="Litros" aria-label="Litros" className={`${campo} w-24`} />
                      <input value={form.netoComb} onChange={e => set({ netoComb: e.target.value })} inputMode="numeric" placeholder="Neto afecto (factura)" aria-label="Neto afecto" className={`${campo} w-44`} />
                      <input value={form.impuesto} onChange={e => set({ impuesto: e.target.value })} inputMode="numeric" placeholder="Impuesto específico" aria-label="Impuesto específico" className={`${campo} w-40`} />
                      <input value={form.patente} onChange={e => set({ patente: e.target.value })} placeholder="Patente (opcional)" aria-label="Patente" className={`${campo} w-36`} />
                      <input value={form.totalFact} onChange={e => set({ totalFact: e.target.value })} inputMode="numeric" placeholder="Total factura" aria-label="Total de la factura" className={`${campo} w-36`} />
                    </div>
                    {k && (() => { const tf = monto(form.totalFact); return (
                      <p className="text-[11.5px] text-zinc-600 tabular-nums" data-testid="calculo-combustible">Costo del proyecto <b>{clp(k.costo)}</b> (neto + impuesto) · IVA {clp(k.iva)} es crédito fiscal · total calculado <b>{clp(k.totalFactura)}</b> · {clp(k.precioLitroNeto)} neto por litro.{' '}
                        {tf == null ? <span className="text-zinc-500">Escribe el total de la factura para comprobarlo.</span>
                          : cuadraConFactura(c, tf) ? <span className="text-emerald-700 font-semibold">Cuadra con la factura.</span>
                          : <span className="text-rose-700 font-semibold">No cuadra: la factura dice {clp(tf)}.</span>}
                      </p>); })()}
                    {error && <p className="text-[11.5px] text-amber-700">{error}</p>}
                  </div>
                );
              })()}
              <div className="flex items-center gap-2 flex-wrap">
                <input value={form.proveedor} onChange={e => set({ proveedor: e.target.value })} placeholder="Proveedor (nombre)" aria-label="Proveedor" className={`${campo} w-64`} />
                <input value={form.rut} onChange={e => cambiarRut(e.target.value)} placeholder="RUT del proveedor" aria-label="RUT del proveedor" className={`${campo} w-40`} />
                {form.tipo !== 'COMBUSTIBLE' && <input value={form.cantidad} onChange={e => set({ cantidad: e.target.value })} inputMode="decimal" placeholder="Cantidad (opcional)" aria-label="Cantidad" data-testid="con-sku-cantidad" className={`${campo} w-36`} />}
                {form.tipo !== 'COMBUSTIBLE' && <input value={form.precio} onChange={e => set({ precio: e.target.value })} inputMode="numeric" placeholder={(monto(form.cantidad) ?? 1) > 1 ? 'Precio neto por unidad' : 'Precio neto (sin IVA)'} aria-label="Precio neto" className={`${campo} w-44`} />}
                {form.tipo !== 'COMBUSTIBLE' && (monto(form.cantidad) ?? 1) > 1 && monto(form.precio) != null && (
                  <span className="basis-full text-[11.5px] text-zinc-600 tabular-nums" data-testid="con-sku-total">Total neto: <b>{clp(monto(form.precio)! * monto(form.cantidad)!)}</b> ({monto(form.cantidad)!.toLocaleString('es-CL')} × {clp(monto(form.precio)!)})</span>
                )}
                {provInfo && (
                  <span className={`basis-full text-[11.5px] ${provInfo.estado === 'no_existe' ? 'text-amber-700' : provInfo.estado === 'error' ? 'text-zinc-500' : 'text-emerald-700'}`}>
                    {provInfo.estado === 'cargando' && 'Buscando proveedor…'}
                    {provInfo.estado === 'sistema' && `Proveedor encontrado en nuestro sistema: ${provInfo.nombre}.`}
                    {provInfo.estado === 'obuma' && `Proveedor encontrado en Obuma: ${provInfo.nombre}.`}
                    {provInfo.estado === 'no_existe' && 'Este RUT no está en nuestro sistema ni en Obuma: es proveedor nuevo y habrá que crearlo en Obuma antes de la OC.'}
                    {provInfo.estado === 'error' && 'No se pudo consultar el proveedor; escribe el nombre a mano.'}
                  </span>
                )}
              </div>
              <label className="block text-[12px] font-semibold text-zinc-600">Cotización (si la tienes)
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx" onChange={e => elegirArchivo(e.target.files?.[0] ?? null)} className="mt-0.5 block text-[12.5px] font-normal" />
                {leyendo && (
                  <span className={`mt-1 flex items-center gap-1.5 text-[11.5px] font-normal ${leyendo.estado === 'ok' ? 'text-emerald-700' : leyendo.estado === 'leyendo' ? 'text-zinc-600' : 'text-amber-700'}`}>
                    {leyendo.estado === 'leyendo' ? <><Loader2 size={12} className="animate-spin" /> Leyendo la cotización… puede tardar hasta un minuto.</> : leyendo.texto}
                  </span>
                )}
              </label>
              <p className="text-[11.5px] text-zinc-500">Al guardar va a aprobación del jefe de ventas. Aprobado, le creas el SKU y la OC como a cualquier producto; la factura llega desde Obuma.</p>
            </>
          )}
          <div className="flex items-center gap-3 pt-0.5">
            <button type="button" onClick={guardar} disabled={guardando || !form.tipo || leyendo?.estado === 'leyendo'} data-testid="guardar-con-sku"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3.5 py-1.5 rounded-lg">
              {guardando && <Loader2 size={13} className="animate-spin" />} Guardar y enviar a aprobación
            </button>
            <button type="button" onClick={() => { setForm(null); setArchivo(null); setLeyendo(null); setProvInfo(null); }} disabled={guardando} className="text-[12.5px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
