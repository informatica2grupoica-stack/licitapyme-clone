'use client';

// ÓRDENES DE COMPRA PROPIAS (migration-180, pedido del dueño 05-nov-2026). Solo aparece si el negocio es de una empresa que NO está
// en Obuma (Comercial MP): ahí la OC a Inversiones Claro se emite desde Licitank (folio MP-año-correlativo, PDF con su logo) y la
// factura de Inversiones Claro se sube a mano para emparejarla. Diseño con la skill licitank-ui.
import { useCallback, useEffect, useState } from 'react';
import { IconFileInvoice as FileInvoice, IconPlus as Plus, IconUpload as Upload, IconLoader2 as Loader2, IconSend as Send } from '@tabler/icons-react';
import { EnviarOcModal } from './EnviarOcModal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Modal } from '@/app/components/ui/Modal';
import { MenuAcciones } from '@/app/components/ui/MenuAcciones';
import { useToast } from '@/app/components/ui/toast';

const IVA = 0.19;
const clp = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`;
const numero = (s: string) => Number(String(s).replace(/[^\d,]/g, '').replace(',', '.')) || 0;
const fecha = (s: string | null) => !s ? '—' : s.slice(0, 10).split('-').reverse().join('-');

interface Proveedor { nombre: string; rut: string; giro: string | null; direccion: string | null; email: string | null; telefono: string | null }
interface Empresa { razonSocial: string; rut: string; direccion: string }
interface ProductoOc { productoId: number; codigo: string | null; descripcion: string; cantidad: number; precioSugerido: number | null; origenPrecio: string | null; yaEnOc: string | null }
interface Oc {
  id: number; folio: string; estado: 'EMITIDA' | 'FACTURADA' | 'ANULADA'; fechaOc: string; proveedor: Proveedor;
  items: Array<{ descripcion: string; cantidad: number; precio: number }>; neto: number; iva: number; total: number;
  factura: { folio: string | null; fecha: string | null; neto: number | null; url: string | null; nombre: string | null; emparejo: string | null } | null;
  anuladaMotivo: string | null; creadoPor: string | null;
}
interface Datos { habilitada: boolean; empresa?: Empresa; proveedor?: Proveedor | null; productos?: ProductoOc[]; ocs?: Oc[] }

const campo = 'mt-0.5 w-full text-[13px] font-normal text-zinc-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-zinc-200 dark:border-slate-700 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500';
const rotulo = 'block text-[11.5px] font-medium text-zinc-600 dark:text-slate-400';

export function OcPropiaCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [facturaDe, setFacturaDe] = useState<Oc | null>(null);
  const [anularDe, setAnularDe] = useState<Oc | null>(null);
  const [enviarDe, setEnviarDe] = useState<Oc | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/compras/${negocioId}/oc-propia`);
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'No se pudieron cargar las órdenes de compra.'); return; }
      setError(null); setDatos(d);
    } catch { setError('No se pudieron cargar las órdenes de compra.'); }
  }, [negocioId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (body: Record<string, unknown>, ok: string) => {
    const r = await fetch(`/api/compras/${negocioId}/oc-propia`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo guardar.');
    toast.success(ok); await cargar();
  };

  if (error) return <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{error}</p>;
  if (!datos?.habilitada || !datos.empresa) return null;
  const ocs = datos.ocs ?? [];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta overflow-hidden" data-testid="oc-propia">
      <div className="px-5 py-4 flex items-center gap-x-4 gap-y-3 flex-wrap border-b border-linea dark:border-slate-800">
        <span className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0"><FileInvoice size={18} /></span>
        <div className="flex-1 min-w-[240px]">
          <p className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">Órdenes de compra de {datos.empresa.razonSocial}</p>
          <p className="text-xs text-tinta-3 mt-0.5">{datos.empresa.razonSocial} no está en Obuma: su orden de compra a {datos.proveedor?.nombre ?? 'Inversiones Claro'} se emite aquí, y la factura se sube a mano para emparejarla.</p>
        </div>
        {puedeOperar && <Boton variante="primario" icono={<Plus size={16} />} onClick={() => setNueva(true)}>Nueva OC de {datos.empresa.razonSocial.replace(/\s+SpA$/i, '')}</Boton>}
      </div>

      {ocs.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-tinta-3">Todavía no hay órdenes de compra emitidas. Usa «Nueva OC» para emitir la primera.</p>
      ) : (
        <div className="divide-y divide-linea dark:divide-slate-800">
          {ocs.map(oc => (
            <div key={oc.id} className="px-5 py-3 flex items-center gap-x-4 gap-y-1.5 flex-wrap" data-testid={`oc-propia-${oc.id}`}>
              <div className="min-w-[200px] flex-1">
                <p className="text-[13px] font-semibold text-tinta dark:text-slate-100 tabular-nums">{oc.folio} <span className="font-normal text-tinta-3">· {oc.proveedor.nombre}</span></p>
                <p className="text-xs text-tinta-3">{fecha(oc.fechaOc)} · {oc.items.length} producto{oc.items.length === 1 ? '' : 's'}{oc.creadoPor ? ` · ${oc.creadoPor}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-100">{clp(oc.total)}</p>
                <p className="text-xs text-tinta-3 tabular-nums">neto {clp(oc.neto)}</p>
              </div>
              <EstadoOc oc={oc} />
              <span className="flex items-center gap-1.5">
                <a href={`/api/compras/${negocioId}/oc-propia?pdf=${oc.id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center h-8 px-3 text-[13px] font-medium rounded-lg border border-linea dark:border-slate-700 text-tinta dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800">Ver PDF</a>
                {puedeOperar && oc.estado !== 'ANULADA' && <Boton tamano="sm" icono={<Send size={14} />} onClick={() => setEnviarDe(oc)} data-testid={`oc-propia-enviar-${oc.id}`}>Enviar al proveedor</Boton>}
                {puedeOperar && oc.estado === 'EMITIDA' && <Boton tamano="sm" icono={<Upload size={14} />} onClick={() => setFacturaDe(oc)}>Subir factura</Boton>}
                {puedeOperar && oc.estado !== 'ANULADA' && (
                  <MenuAcciones etiqueta={`Más acciones de la ${oc.folio}`} acciones={[
                    ...(oc.factura?.url ? [{ label: 'Ver la factura', onClick: () => window.open(oc.factura!.url!, '_blank', 'noopener,noreferrer') }] : []),
                    ...(oc.factura ? [{ label: 'Quitar la factura', onClick: () => { void accion({ accion: 'quitar-factura', ocId: oc.id }, `Se quitó la factura de la ${oc.folio}`).catch(e => toast.error('No se pudo quitar', e.message)); } }] : []),
                    ...(!oc.factura ? [{ label: 'Anular la OC', onClick: () => setAnularDe(oc), peligro: true }] : []),
                  ]} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {nueva && datos.productos && (
        <ModalNuevaOc negocioId={negocioId} empresa={datos.empresa} proveedorInicial={datos.proveedor ?? null} productos={datos.productos}
          onCerrar={() => setNueva(false)} onCreada={async folio => { setNueva(false); toast.success(`Orden de compra ${folio} emitida`); await cargar(); }} />
      )}
      {facturaDe && <ModalFactura negocioId={negocioId} oc={facturaDe} onCerrar={() => setFacturaDe(null)} onListo={async () => { setFacturaDe(null); toast.success('Factura emparejada'); await cargar(); }} />}
      {enviarDe && <EnviarOcModal negocioId={negocioId} ocPropiaId={enviarDe.id} onCerrar={() => setEnviarDe(null)} />}
      {anularDe && <ModalAnular oc={anularDe} onCerrar={() => setAnularDe(null)} onAnular={async motivo => { await accion({ accion: 'anular', ocId: anularDe.id, motivo }, `Orden de compra ${anularDe.folio} anulada`); setAnularDe(null); }} />}
    </div>
  );
}

function EstadoOc({ oc }: { oc: Oc }) {
  const [punto, texto, color] = oc.estado === 'FACTURADA'
    ? ['bg-emerald-500', `Facturada · factura ${oc.factura?.folio ?? ''}`, 'text-emerald-700 dark:text-emerald-400']
    : oc.estado === 'ANULADA' ? ['bg-slate-300', `Anulada${oc.anuladaMotivo ? `: ${oc.anuladaMotivo}` : ''}`, 'text-tinta-3']
    : ['bg-amber-500', 'Esperando la factura', 'text-amber-700 dark:text-amber-400'];
  return <span className={`inline-flex items-center gap-1.5 text-xs max-w-[260px] ${color}`} title={texto}><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${punto}`} /><span className="truncate">{texto}</span></span>;
}

function ModalNuevaOc({ negocioId, empresa, proveedorInicial, productos, onCerrar, onCreada }: {
  negocioId: number; empresa: Empresa; proveedorInicial: Proveedor | null; productos: ProductoOc[];
  onCerrar: () => void; onCreada: (folio: string) => Promise<void>;
}) {
  const [proveedor, setProveedor] = useState<Proveedor>(proveedorInicial ?? { nombre: '', rut: '', giro: null, direccion: null, email: null, telefono: null });
  const [editarProveedor, setEditarProveedor] = useState(!proveedorInicial);
  const [lineas, setLineas] = useState(() => productos.map(p => ({
    ...p, elegido: false, cantidadTxt: String(p.cantidad), precioTxt: p.precioSugerido != null ? String(p.precioSugerido) : '',
  })));
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [formaPago, setFormaPago] = useState('');
  const [despacho, setDespacho] = useState(empresa.direccion);
  const [condiciones, setCondiciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegidas = lineas.filter(l => l.elegido);
  const neto = Math.round(elegidas.reduce((s, l) => s + numero(l.cantidadTxt) * numero(l.precioTxt), 0));
  const iva = Math.round(neto * IVA);
  const falta = !proveedor.nombre.trim() || !proveedor.rut.trim() ? 'Falta el nombre y el RUT del proveedor'
    : elegidas.length === 0 ? 'Elige al menos un producto'
    : elegidas.some(l => !(numero(l.cantidadTxt) > 0) || !(numero(l.precioTxt) > 0)) ? 'Falta la cantidad o el precio de algún producto' : null;
  const setLinea = (id: number, cambio: Partial<(typeof lineas)[number]>) => setLineas(ls => ls.map(l => l.productoId === id ? { ...l, ...cambio } : l));

  const emitir = async () => {
    if (falta) return;
    setGuardando(true); setError(null);
    try {
      const r = await fetch(`/api/compras/${negocioId}/oc-propia`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'crear', proveedor, fechaEntrega: fechaEntrega || null, formaPago, direccionDespacho: despacho, condiciones,
          items: elegidas.map(l => ({ productoId: l.productoId, codigo: l.codigo, descripcion: l.descripcion, cantidad: numero(l.cantidadTxt), precio: numero(l.precioTxt) })),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo emitir la orden de compra.');
      await onCreada(d.oc.folio);
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <Modal open onClose={onCerrar} size="lg" title={`Nueva orden de compra de ${empresa.razonSocial}`} subtitle={`Emite ${empresa.razonSocial} (RUT ${empresa.rut}). El folio lo asigna Licitank al emitir.`}
      footer={<>
        {(falta || error) && <span className={`mr-auto text-xs ${error ? 'text-red-600' : 'text-amber-700 dark:text-amber-400'}`}>{error || falta}</span>}
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={emitir} disabled={!!falta || guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : `Emitir OC por ${clp(neto + iva)}`}</Boton>
      </>}>
      <div className="space-y-6" data-testid="form-oc-propia">
        <section className="space-y-2">
          <p className="text-[13px] font-semibold text-zinc-800 dark:text-slate-100">Proveedor</p>
          {!editarProveedor ? (
            <div className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-800/50 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-zinc-900 dark:text-slate-100">{proveedor.nombre}</p>
                <p className="text-xs text-zinc-500">RUT {proveedor.rut}{proveedor.direccion ? ` · ${proveedor.direccion}` : ''}</p>
              </div>
              <Boton tamano="sm" variante="fantasma" onClick={() => setEditarProveedor(true)}>Cambiar</Boton>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([['nombre', 'Razón social'], ['rut', 'RUT'], ['giro', 'Giro'], ['direccion', 'Dirección'], ['email', 'Correo'], ['telefono', 'Teléfono']] as const).map(([k, et]) => (
                <label key={k} className={rotulo}>{et}
                  <input value={proveedor[k] ?? ''} onChange={e => setProveedor(p => ({ ...p, [k]: e.target.value }))} className={campo} />
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <p className="text-[13px] font-semibold text-zinc-800 dark:text-slate-100">Productos</p>
          <p className="text-xs text-zinc-500">Precio neto por unidad. Se propone el costo del escenario de compra elegido: entre empresas relacionadas el precio debe ser de mercado (el SII puede tasarlo si queda muy abajo).</p>
          <div className="rounded-lg border border-zinc-200 dark:border-slate-700 divide-y divide-zinc-100 dark:divide-slate-800">
            {lineas.map(l => (
              <div key={l.productoId} className={`px-3 py-2.5 flex items-center gap-3 flex-wrap ${l.elegido ? '' : 'opacity-60'}`}>
                <input type="checkbox" checked={l.elegido} onChange={e => setLinea(l.productoId, { elegido: e.target.checked })} className="accent-teal-600" aria-label={`Incluir ${l.descripcion}`} />
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[13px] font-medium text-zinc-900 dark:text-slate-100 leading-snug">{l.descripcion}</p>
                  <p className="text-xs text-zinc-500">
                    {l.codigo ? `SKU ${l.codigo}` : 'sin SKU'}
                    {l.origenPrecio ? ` · precio del ${l.origenPrecio}` : ' · sin costo en el escenario: escríbelo'}
                    {l.yaEnOc && <span className="text-amber-700 dark:text-amber-400"> · ya está en la {l.yaEnOc}</span>}
                  </p>
                </div>
                <label className="text-[11px] text-zinc-500 w-20">Cantidad
                  <input inputMode="decimal" value={l.cantidadTxt} disabled={!l.elegido} onChange={e => setLinea(l.productoId, { cantidadTxt: e.target.value })} className={`${campo} tabular-nums text-right`} />
                </label>
                <label className="text-[11px] text-zinc-500 w-32">Precio neto c/u
                  <input inputMode="numeric" value={l.precioTxt} disabled={!l.elegido} onChange={e => setLinea(l.productoId, { precioTxt: e.target.value })}
                    className={`${campo} tabular-nums text-right ${l.elegido && !(numero(l.precioTxt) > 0) ? 'border-amber-300 bg-amber-50/40' : ''}`} />
                </label>
                <p className="w-28 text-right text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-slate-100">{l.elegido ? clp(numero(l.cantidadTxt) * numero(l.precioTxt)) : '—'}</p>
              </div>
            ))}
          </div>
          <div className="ml-auto w-64 text-[13px] tabular-nums space-y-0.5">
            <p className="flex justify-between text-zinc-600 dark:text-slate-400"><span>Neto</span><span>{clp(neto)}</span></p>
            <p className="flex justify-between text-zinc-600 dark:text-slate-400"><span>IVA 19 %</span><span>{clp(iva)}</span></p>
            <p className="flex justify-between font-semibold text-zinc-900 dark:text-slate-100 border-t border-zinc-200 dark:border-slate-700 pt-1"><span>Total</span><span>{clp(neto + iva)}</span></p>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={rotulo}>Fecha de entrega <span className="font-normal text-zinc-400">(opcional)</span>
            <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} className={campo} />
          </label>
          <label className={rotulo}>Forma de pago <span className="font-normal text-zinc-400">(opcional)</span>
            <input value={formaPago} onChange={e => setFormaPago(e.target.value)} placeholder="Ej: transferencia a 30 días" className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>Dirección de despacho
            <input value={despacho} onChange={e => setDespacho(e.target.value)} className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>Condiciones <span className="font-normal text-zinc-400">(opcional; el PDF ya pide citar la OC en la factura)</span>
            <textarea value={condiciones} onChange={e => setCondiciones(e.target.value)} rows={2} className={campo} />
          </label>
        </section>
      </div>
    </Modal>
  );
}

function ModalFactura({ negocioId, oc, onCerrar, onListo }: { negocioId: number; oc: Oc; onCerrar: () => void; onListo: () => Promise<void> }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [folio, setFolio] = useState(''); const [fechaF, setFechaF] = useState(''); const [neto, setNeto] = useState(String(Math.round(oc.neto))); const [total, setTotal] = useState('');
  const [pendiente, setPendiente] = useState<string[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esXml = !!archivo && /\.xml$/i.test(archivo.name);
  const falta = !archivo ? 'Elige el archivo de la factura' : !esXml && (!folio.trim() || !(numero(neto) > 0)) ? 'Falta el folio o el neto de la factura' : null;

  const enviar = async (confirmar: boolean) => {
    if (!archivo || falta) return;
    setGuardando(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('ocId', String(oc.id)); fd.append('file', archivo);
      if (confirmar) fd.append('confirmar', '1');
      if (!esXml) { fd.append('folio', folio); fd.append('fecha', fechaF); fd.append('neto', neto); fd.append('total', total); }
      const r = await fetch(`/api/compras/${negocioId}/oc-propia`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo subir la factura.');
      if (d.pendiente) { setPendiente(d.pendiente.motivos); return; }
      await onListo();
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <Modal open onClose={onCerrar} size="sm" title={`Factura de la ${oc.folio}`} subtitle={`${oc.proveedor.nombre} · neto ${clp(oc.neto)} · total ${clp(oc.total)}`}
      footer={<>
        {(falta || error) && !pendiente && <span className={`mr-auto text-xs ${error ? 'text-red-600' : 'text-amber-700 dark:text-amber-400'}`}>{error || falta}</span>}
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        {pendiente
          ? <Boton variante="primario" onClick={() => enviar(true)} disabled={guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : 'Sí, es esta factura'}</Boton>
          : <Boton variante="primario" onClick={() => enviar(false)} disabled={!!falta || guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : 'Subir y emparejar'}</Boton>}
      </>}>
      <div className="space-y-4">
        <p className="text-xs text-zinc-500">Lo mejor es el <b className="font-semibold text-zinc-700 dark:text-slate-300">XML</b> que entrega el SII: se revisa solo que la emita {oc.proveedor.nombre}, que vaya a nombre de quien emitió la OC y que cite la {oc.folio}. Con un PDF, escribe tú los datos.</p>
        <label className={rotulo}>Archivo de la factura (XML o PDF)
          <input type="file" accept=".xml,.pdf" onChange={e => { setArchivo(e.target.files?.[0] ?? null); setPendiente(null); setError(null); }}
            className="mt-1 block w-full text-[13px] text-zinc-700 dark:text-slate-300 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-white file:px-3 file:py-1.5 file:text-[13px] file:font-medium" />
        </label>
        {archivo && !esXml && (
          <div className="grid grid-cols-2 gap-2">
            <label className={rotulo}>Folio de la factura<input value={folio} onChange={e => setFolio(e.target.value)} className={campo} /></label>
            <label className={rotulo}>Fecha<input type="date" value={fechaF} onChange={e => setFechaF(e.target.value)} className={campo} /></label>
            <label className={rotulo}>Neto<input inputMode="numeric" value={neto} onChange={e => setNeto(e.target.value)} className={`${campo} tabular-nums`} /></label>
            <label className={rotulo}>Total <span className="font-normal text-zinc-400">(opcional)</span><input inputMode="numeric" value={total} onChange={e => setTotal(e.target.value)} className={`${campo} tabular-nums`} /></label>
          </div>
        )}
        {pendiente && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-[12.5px] text-amber-900 dark:text-amber-200 space-y-1">
            {pendiente.map(m => <p key={m}>{m}</p>)}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ModalAnular({ oc, onCerrar, onAnular }: { oc: Oc; onCerrar: () => void; onAnular: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onCerrar} size="sm" title={`Anular la ${oc.folio}`} subtitle="El folio no se vuelve a usar; la OC queda en el historial como anulada."
      footer={<>
        {error && <span className="mr-auto text-xs text-red-600">{error}</span>}
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="peligro" disabled={!motivo.trim() || guardando} onClick={async () => { setGuardando(true); setError(null); try { await onAnular(motivo); } catch (e: any) { setError(e.message); } finally { setGuardando(false); } }}>Anular la OC</Boton>
      </>}>
      <label className={rotulo}>¿Por qué se anula?
        <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} className={campo} placeholder="Ej: se emitió con el precio equivocado" />
      </label>
    </Modal>
  );
}
