'use client';

// FLETES de la compra (02-nov-2026, pedido del dueño). Reemplaza el «Agregar servicio» de Productos: el flete se agrega aquí, en la etapa de
// comparar precios. «Agregar flete» pregunta si TIENE COTIZACIÓN: con cotización se sube el documento; sin cotización se pone el precio neto
// a mano (editable, y después se puede agregar la cotización). En los dos casos el flete lleva proveedor con nombre y RUT, y entra a
// «Compara y elige» como cualquier producto: se elige, se manda a aprobar y lleva SKU y OC. Por dentro sigue siendo el «servicio»
// (compras_producto.es_servicio, migration-177): por eso aprobación, SKU y OC funcionan sin rehacerlos.
import { useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import { IconTruck as Truck, IconPlus as Plus, IconLoader2 as Loader2 } from '@tabler/icons-react';

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const monto = (t: string): number | null => { const n = Number(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

/** «778977893» → «77.897.789-3». */
export const formatearRut = (v: string) => {
  const l = v.replace(/[^\dkK]/g, '').toUpperCase().slice(0, 9);
  return l.length < 2 ? l : `${l.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${l.slice(-1)}`;
};

/** RUT chileno con dígito verificador (módulo 11). Copia local: compras-compra-rapida.ts es de servidor. */
export function rutValido(rut: string): boolean {
  const limpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 8) return false;
  const cuerpo = limpio.slice(0, -1), dv = limpio.slice(-1);
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const r = 11 - (suma % 11);
  return dv === (r === 11 ? '0' : r === 10 ? 'K' : String(r));
}

interface ProductoFlete { id: number; descripcion: string; cantidad?: number | null; esServicio?: boolean; servicioTipo?: 'FLETE' | 'ADICIONAL' | null; subestado?: string }
interface CotizacionFlete {
  id: number; proveedorNombre: string; proveedorRut: string | null; archivoUrl: string | null; descripcionLibre: string | null; moneda: string;
  plazoEntregaTexto: string | null; vigenciaAt?: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null }>;
}

type Form = { productoId: number | null; cotizacionId: number | null; nombre: string; tiene: '' | 'si' | 'no'; proveedor: string; rut: string; precio: string };
const VACIO: Form = { productoId: null, cotizacionId: null, nombre: '', tiene: '', proveedor: '', rut: '', precio: '' };
const NOTA_SIN_COTIZACION = 'Flete sin cotización: precio puesto a mano.';

export function FletesCompra({ negocioId, puedeOperar, productos, cotizaciones, onCambio }: {
  negocioId: number; puedeOperar: boolean; productos: ProductoFlete[]; cotizaciones: CotizacionFlete[]; onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [porQuitar, setPorQuitar] = useState<ProductoFlete | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [leyendo, setLeyendo] = useState<{ estado: 'leyendo' | 'ok' | 'sin_precio' | 'error'; texto?: string } | null>(null);
  const [provInfo, setProvInfo] = useState<{ estado: 'cargando' | 'sistema' | 'obuma' | 'no_existe' | 'error'; nombre?: string } | null>(null);
  const fletes = productos.filter(p => p.esServicio && p.servicioTipo !== 'ADICIONAL');   // los adicionales (grúa, armado) viven en «Gastos extra»
  if (fletes.length === 0 && !puedeOperar) return null;

  /** Al completar un RUT válido: busca el proveedor en nuestro sistema y, si no está, en Obuma, y rellena el nombre si está vacío. */
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

  /** Al elegir el documento lo lee (sin guardar nada) y propone precio neto, proveedor y RUT; lo que ya escribiste no se pisa. */
  const elegirArchivo = async (file: File | null) => {
    setArchivo(file); setLeyendo(null);
    if (!file) return;
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

  const set = (p: Partial<Form>) => setForm(f => (f ? { ...f, ...p } : f));
  const abrirNuevo = () => { setArchivo(null); setProvInfo(null); setLeyendo(null); setForm({ ...VACIO }); };
  // Agregar cotización a un flete que ya existe (típico: se puso el precio a mano y después llegó la cotización).
  const abrirCotizacion = (f: ProductoFlete) => {
    const previa = cotizaciones.find(c => c.items.some(i => i.productoId === f.id));
    setArchivo(null); setProvInfo(null); setLeyendo(null); setForm({ ...VACIO, productoId: f.id, nombre: f.descripcion, tiene: 'si', proveedor: previa?.proveedorNombre ?? '', rut: previa?.proveedorRut ?? '' });
  };
  const abrirEditar = (f: ProductoFlete, c: CotizacionFlete) => {
    const it = c.items.find(i => i.productoId === f.id);
    setArchivo(null); setProvInfo(null); setLeyendo(null); setForm({ productoId: f.id, cotizacionId: c.id, nombre: f.descripcion, tiene: 'no', proveedor: c.proveedorNombre, rut: c.proveedorRut ?? '', precio: it?.precioUnitario != null ? String(Math.round(it.precioUnitario)) : '' });
  };

  const guardar = async () => {
    if (!form) return;
    const proveedor = form.proveedor.trim(), rut = form.rut.trim(), precio = monto(form.precio);
    if (!form.nombre.trim()) return toast.error('Falta el nombre del flete', 'Por ejemplo «Flete Talagante – Coyhaique».');
    if (!form.tiene) return toast.error('Falta responder', '¿El flete tiene cotización?');
    if (!proveedor) return toast.error('Falta el proveedor del flete', 'Es obligatorio para poder comprarlo y emitir la OC.');
    if (!rutValido(rut)) return toast.error('El RUT del proveedor no es válido', 'Escríbelo con dígito verificador, por ejemplo 76.123.456-7.');
    if (form.tiene === 'no' && precio == null) return toast.error('Falta el precio', 'Pon el precio neto (sin IVA) del flete.');
    if (form.tiene === 'si' && !archivo && form.cotizacionId == null) return toast.error('Falta la cotización', 'Adjunta el documento del flete.');
    setGuardando(true);
    try {
      // 1 · El flete en sí (si es nuevo).
      let productoId = form.productoId;
      if (productoId == null) {
        const r = await fetch(`/api/compras/${negocioId}/productos`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'agregar_servicio', descripcion: form.nombre.trim(), cantidad: 1, unidad: null }),
        });
        const d = await r.json();
        if (!r.ok || !d.success || !d.productoId) throw new Error(d.error || 'No se pudo crear el flete');
        productoId = Number(d.productoId);
      }
      // 2 · Su cotización.
      if (form.cotizacionId != null) {
        // Editar un flete sin cotización: proveedor, RUT y precio.
        const r1 = await fetch(`/api/compras/${negocioId}/cotizaciones/${form.cotizacionId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proveedorNombre: proveedor, proveedorRut: rut, precioUnitario: precio, moneda: 'CLP', notas: NOTA_SIN_COTIZACION }),
        });
        const d1 = await r1.json();
        if (!r1.ok || !d1.success) throw new Error(d1.error || 'No se pudo editar');
        const r2 = await fetch(`/api/compras/${negocioId}/cotizaciones/${form.cotizacionId}/items`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ productoId, precioUnitario: precio, cumple: 'CUMPLE', incluido: false }] }),
        });
        const d2 = await r2.json();
        if (!r2.ok || !d2.success) throw new Error(d2.error || 'No se pudo guardar el precio');
      } else if (form.tiene === 'no') {
        const r = await fetch(`/api/compras/${negocioId}/cotizaciones`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proveedorNombre: proveedor, proveedorRut: rut, origen: 'llamada', precioUnitario: precio, moneda: 'CLP', notas: NOTA_SIN_COTIZACION, items: [{ productoId, precioUnitario: precio, cumple: 'CUMPLE' }] }),
        });
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo guardar el precio');
      } else {
        const fd = new FormData();
        fd.set('file', archivo!);
        fd.set('proveedorNombre', proveedor); fd.set('proveedorRut', rut); fd.set('origen', 'pdf');
        if (precio != null) fd.set('precioUnitario', String(precio));
        fd.set('items', JSON.stringify([{ productoId, precioUnitario: precio, cumple: 'CUMPLE' }]));
        const r = await fetch(`/api/compras/${negocioId}/cotizaciones`, { method: 'POST', body: fd });
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo subir la cotización');
      }
      toast.success(form.cotizacionId != null ? 'Flete actualizado' : 'Flete agregado', 'Ya está en «Compara y elige» para elegirlo.');
      setForm(null); setArchivo(null);
      await onCambio();
    } catch (e: any) {
      toast.error('No se pudo guardar el flete', e.message);
      await onCambio().catch(() => {});   // si el flete quedó creado a medias, que se vea en la lista y se pueda completar
    } finally { setGuardando(false); }
  };

  const quitar = async (f: ProductoFlete) => {
    setQuitando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/productos`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId: f.id, accion: 'quitar_parte' }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'No se pudo quitar');
      toast.success('Flete quitado', `«${f.descripcion}» ya no está en la compra.`);
      setPorQuitar(null);
      await onCambio();
    } catch (e: any) { toast.error('No se pudo quitar el flete', e.message); }
    finally { setQuitando(false); }
  };

  const campo = 'text-[12.5px] border border-zinc-300 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:ring-1 focus:ring-teal-500';
  return (
    <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden" data-testid="fletes-compra">
      <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-1.5"><Truck size={15} /> Fletes{fletes.length > 0 && <span className="text-zinc-400 font-semibold">({fletes.length})</span>}</p>
        <p className="text-[11.5px] text-zinc-500 flex-1 min-w-[200px]">Cada flete lleva su proveedor (nombre y RUT). Se elige en «Compara y elige» y de ahí sigue a aprobación, SKU y OC como un producto.</p>
        {puedeOperar && !form && (
          <button type="button" onClick={abrirNuevo} data-testid="agregar-flete"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg"><Plus size={12} /> Agregar flete</button>
        )}
      </div>

      {fletes.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {fletes.map(f => {
            const ofertas = cotizaciones.filter(c => c.items.some(i => i.productoId === f.id));
            return (
              <li key={f.id} className="px-4 py-2.5">
                <p className="text-[13px] font-semibold text-zinc-900">{f.descripcion}</p>
                {ofertas.length === 0 && <p className="text-[12px] text-amber-700">Sin proveedor ni precio todavía.</p>}
                {ofertas.map(c => {
                  const it = c.items.find(i => i.productoId === f.id)!;
                  return (
                    <div key={c.id} className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[12.5px]">
                      <span className="font-semibold text-zinc-800">{c.proveedorNombre}</span>
                      <span className="text-zinc-400">{c.proveedorRut || 'sin RUT'}</span>
                      <b className="text-zinc-900 tabular-nums">{it.precioUnitario != null ? clp(it.precioUnitario) : 'sin precio'} <span className="font-normal text-zinc-400">neto</span></b>
                      {c.archivoUrl
                        ? <span className="text-[11.5px] font-semibold text-emerald-700">Con cotización #{c.id}</span>
                        : <span className="text-[11.5px] font-semibold text-amber-700">Sin cotización · precio a mano</span>}
                      <span className="ml-auto flex items-center gap-1">
                        {c.archivoUrl && <button type="button" onClick={() => window.open(c.archivoUrl!, '_blank', 'noopener,noreferrer')} className="text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700 px-2 py-1 rounded-md hover:bg-zinc-50">Ver cotización</button>}
                        {puedeOperar && !c.archivoUrl && <button type="button" onClick={() => abrirEditar(f, c)} className="text-[11.5px] font-semibold text-zinc-500 hover:text-indigo-700 px-2 py-1 rounded-md hover:bg-zinc-50">Editar precio</button>}
                      </span>
                    </div>
                  );
                })}
                {puedeOperar && (
                  <div className="mt-1 flex items-center gap-3">
                    <button type="button" onClick={() => abrirCotizacion(f)} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-900">+ Agregar cotización</button>
                    <button type="button" onClick={() => setPorQuitar(f)} className="text-[11.5px] text-zinc-400 hover:text-rose-600">Quitar flete</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <div className="border-t border-zinc-100 px-4 py-3 space-y-2.5 bg-teal-50/30" data-testid="form-flete">
          <p className="text-[12.5px] font-bold text-zinc-800">{form.cotizacionId != null ? 'Editar el flete' : form.productoId != null ? 'Agregar cotización al flete' : 'Agregar flete'}</p>
          <input value={form.nombre} onChange={e => set({ nombre: e.target.value })} disabled={form.productoId != null} placeholder="Qué flete es (ej. Flete Talagante – Coyhaique)" aria-label="Nombre del flete" className={`${campo} w-full max-w-xl`} />
          {form.cotizacionId == null && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-semibold text-zinc-700">¿Tiene cotización?</span>
              {(['si', 'no'] as const).map(v => (
                <button key={v} type="button" onClick={() => set({ tiene: v })} aria-pressed={form.tiene === v}
                  className={`text-[12px] font-semibold px-3 py-1 rounded-lg border ${form.tiene === v ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-600 border-zinc-200 hover:border-teal-400'}`}>{v === 'si' ? 'Sí' : 'No'}</button>
              ))}
            </div>
          )}
          {form.tiene && (
            <div className="flex items-center gap-2 flex-wrap">
              <input value={form.proveedor} onChange={e => set({ proveedor: e.target.value })} placeholder="Proveedor del flete (nombre)" aria-label="Proveedor del flete" className={`${campo} w-64`} />
              <input value={form.rut} onChange={e => cambiarRut(e.target.value)} placeholder="RUT del proveedor" aria-label="RUT del proveedor" className={`${campo} w-40`} />
              {provInfo && (
                <span className={`basis-full text-[11.5px] ${provInfo.estado === 'no_existe' ? 'text-amber-700' : provInfo.estado === 'error' ? 'text-zinc-500' : 'text-emerald-700'}`} data-testid="flete-proveedor-estado">
                  {provInfo.estado === 'cargando' && 'Buscando proveedor…'}
                  {provInfo.estado === 'sistema' && `Proveedor encontrado en nuestro sistema: ${provInfo.nombre}.`}
                  {provInfo.estado === 'obuma' && `Proveedor encontrado en Obuma: ${provInfo.nombre}.`}
                  {provInfo.estado === 'no_existe' && 'Este RUT no está en nuestro sistema ni en Obuma: es proveedor nuevo y habrá que crearlo en Obuma antes de la OC.'}
                  {provInfo.estado === 'error' && 'No se pudo consultar el proveedor; escribe el nombre a mano.'}
                </span>
              )}
              {form.tiene === 'no' || form.cotizacionId != null
                ? <input value={form.precio} onChange={e => set({ precio: e.target.value })} inputMode="numeric" placeholder="Precio neto (sin IVA)" aria-label="Precio neto del flete" className={`${campo} w-44`} />
                : <input value={form.precio} onChange={e => set({ precio: e.target.value })} inputMode="numeric" placeholder="Precio neto (si el documento no lo lee)" aria-label="Precio neto del flete, opcional" className={`${campo} w-64`} />}
            </div>
          )}
          {form.tiene === 'si' && form.cotizacionId == null && (
            <label className="block text-[12px] font-semibold text-zinc-600">Documento de la cotización
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx" onChange={e => elegirArchivo(e.target.files?.[0] ?? null)} className="mt-0.5 block text-[12.5px] font-normal" />
              {leyendo && (
                <span className={`mt-1 flex items-center gap-1.5 text-[11.5px] font-normal ${leyendo.estado === 'ok' ? 'text-emerald-700' : leyendo.estado === 'leyendo' ? 'text-zinc-600' : 'text-amber-700'}`} data-testid="flete-lectura">
                  {leyendo.estado === 'leyendo' ? <><Loader2 size={12} className="animate-spin" /> Leyendo la cotización… puede tardar hasta un minuto.</> : leyendo.texto}
                </span>
              )}
            </label>
          )}
          {form.tiene === 'no' && form.cotizacionId == null && <p className="text-[11.5px] text-zinc-500">Sin cotización el precio queda a mano; si después llega la cotización, usa «Agregar cotización» en este flete.</p>}
          <div className="flex items-center gap-3 pt-0.5">
            <button type="button" onClick={guardar} disabled={guardando} className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3.5 py-1.5 rounded-lg">
              {guardando && <Loader2 size={13} className="animate-spin" />} Guardar
            </button>
            <button type="button" onClick={() => { setForm(null); setArchivo(null); }} disabled={guardando} className="text-[12.5px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
          </div>
        </div>
      )}

      <Modal open={!!porQuitar && puedeOperar} onClose={() => { if (!quitando) setPorQuitar(null); }} size="sm" title="¿Quitar este flete?" subtitle={porQuitar?.descripcion}
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" disabled={quitando} onClick={() => setPorQuitar(null)} className="text-[13px] font-semibold text-zinc-600 px-3 py-1.5 rounded-lg hover:bg-zinc-100">Cancelar</button>
            <button type="button" disabled={quitando} onClick={() => porQuitar && quitar(porQuitar)} data-testid="confirmar-quitar-flete"
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 px-3.5 py-1.5 rounded-lg">
              {quitando && <Loader2 size={13} className="animate-spin" />} Sí, quitar flete
            </button>
          </div>
        )}>
        <div className="text-[13px] text-zinc-700 space-y-2" data-testid="aviso-quitar-flete">
          <p>Si lo quitas, de inmediato:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Desaparece de «Compara y elige» y de la lista de fletes.</li>
            <li>Se borran sus precios y la cotización que tenía asignada. El documento sigue en «Cotizaciones recibidas», sin producto asignado.</li>
            <li>Se borra la aprobación que se le hubiera dado a este flete. Las demás aprobaciones no se tocan.</li>
            <li>El margen vuelve a calcular con la reserva del 5 %, sin el flete real.</li>
          </ul>
          <p className="text-[12px] text-zinc-500">Si el flete ya se compró o tiene SKU, no se puede quitar: ahí se usa «Renunciar».</p>
        </div>
      </Modal>
    </div>
  );
}
