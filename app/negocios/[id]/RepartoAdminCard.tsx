'use client';

// PROCESO ADMINISTRATIVO POST-APROBACIÓN (spec §11) — §11.1 dice "el módulo controla y registra el
// estado, no los ejecuta", pero soporte de Obuma confirmó (10-sep-2026, correo directo) que
// /comprasOc.create.json SÍ permite emitir la orden de compra de verdad desde la API. Por eso el
// hito "Orden de compra emitida" ahora tiene dos caminos: el checkbox manual de siempre (para OC
// que se emiten desde Obuma directamente, sin pasar por acá) y el bloque de arriba, que SÍ ejecuta
// la creación real, una orden por proveedor del escenario elegido (pedido explícito del usuario).
// El resto de los hitos (pago, anticipo, factura, carpeta, provisión) siguen siendo checklist
// manual — esos de verdad no tienen todavía un endpoint de creación confirmado.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { parsearMontoCL } from '@/app/lib/numeros';
import { ClipboardList, Loader2, CheckCircle2, Circle, FileText, Zap, Truck } from 'lucide-react';

interface Reparto {
  ocEmitidaAt: string | null; ocNumero: string | null;
  pagoRegistradoAt: string | null;
  anticipoPagadoAt: string | null; anticipoMonto: number | null;
  facturaCompraRegistradaAt: string | null;
  carpetaProyectoCreadaAt: string | null; carpetaProyectoId: string | null;
  provisionFondosAt: string | null; provisionFondosMonto: number | null; cuentaOrigen: string | null;
}
type Hito = 'ocEmitida' | 'pagoRegistrado' | 'anticipoPagado' | 'facturaCompraRegistrada' | 'carpetaProyectoCreada' | 'provisionFondos';

interface ItemOC { productoId: number; descripcion: string; cantidad: number; precioUnitario: number; subtotal: number; obumaProductoId: string | null; obumaCodigoComercial: string | null }
interface ProveedorOC {
  proveedorNombre: string; proveedorId: number | null; proveedorRut: string | null;
  proveedorDireccion: string | null; proveedorComuna: string | null; proveedorEmail: string | null; proveedorTelefono: string | null;
  proveedorGiro: string | null; proveedorContacto: string | null;
  items: ItemOC[]; subtotal: number;
  yaCreada: { obumaCompraOcId: string; folio: string | null; total: number; fechaOc: string } | null;
}
interface FormaPago { id: string; codigo: string; nombre: string }
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

type EstadoProveedorObuma = 'idle' | 'cargando' | 'existe' | 'no_existe' | 'sin_rut';
const formProveedorVacio = {
  rut: '', razonSocial: '', nombreFantasia: '', contacto: '', giro: '', direccion: '', comuna: '', region: '', pais: 'CHILE',
  telefono: '', celular: '', email: '', website: '', observacion: '', cuentaContable: '',
  esSupermercado: false, esFactoring: false,
};

const HITOS: Array<{ key: Hito; label: string; atField: keyof Reparto }> = [
  { key: 'ocEmitida', label: 'Orden de compra emitida', atField: 'ocEmitidaAt' },
  { key: 'pagoRegistrado', label: 'Pago registrado', atField: 'pagoRegistradoAt' },
  { key: 'anticipoPagado', label: 'Anticipo pagado', atField: 'anticipoPagadoAt' },
  { key: 'facturaCompraRegistrada', label: 'Factura de compra registrada', atField: 'facturaCompraRegistradaAt' },
  { key: 'carpetaProyectoCreada', label: 'Carpeta de proyecto creada', atField: 'carpetaProyectoCreadaAt' },
  { key: 'provisionFondos', label: 'Provisión de fondos', atField: 'provisionFondosAt' },
];

export function RepartoAdminCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [visible, setVisible] = useState(false);
  const [reparto, setReparto] = useState<Reparto | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState<Hito | null>(null);

  const [proveedoresOC, setProveedoresOC] = useState<ProveedorOC[]>([]);
  const [centroCosto, setCentroCosto] = useState<{ id: string; nombre: string } | null>(null);
  const [formasPago, setFormasPago] = useState<FormaPago[]>([]);
  const [cargandoFormasPago, setCargandoFormasPago] = useState(false);
  const [ocAbierta, setOcAbierta] = useState<string | null>(null); // proveedorNombre
  const [formaPagoId, setFormaPagoId] = useState('');
  const [incluirFlete, setIncluirFlete] = useState(false);
  const [fleteMonto, setFleteMonto] = useState('');
  const [confirmadoOC, setConfirmadoOC] = useState(false);
  const [creandoOC, setCreandoOC] = useState<string | null>(null);

  const [estadoProveedorObuma, setEstadoProveedorObuma] = useState<EstadoProveedorObuma>('idle');
  const [modalProveedorAbierto, setModalProveedorAbierto] = useState(false);
  const [formProveedor, setFormProveedor] = useState(formProveedorVacio);
  const [guardandoProveedor, setGuardandoProveedor] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [rApr, rRep, rOC] = await Promise.all([
        fetch(`/api/compras/${negocioId}/aprobaciones`), fetch(`/api/compras/${negocioId}/reparto`),
        fetch(`/api/compras/${negocioId}/orden-compra-obuma`),
      ]);
      const [dApr, dRep, dOC] = await Promise.all([rApr.json(), rRep.json(), rOC.json()]);
      const compraAprobada = dApr.success && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(dApr.compra?.estado);
      setVisible(!!compraAprobada);
      if (dRep.success) setReparto(dRep.reparto);
      if (dOC.success) { setProveedoresOC(dOC.proveedores || []); setCentroCosto(dOC.centroCosto || null); }
    } catch (e: any) {
      toast.error('No se pudo cargar el proceso administrativo', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const cargarFormasPago = async () => {
    if (formasPago.length || cargandoFormasPago) return;
    setCargandoFormasPago(true);
    try {
      const res = await fetch('/api/compras/obuma-formas-pago');
      const data = await res.json();
      if (data.success) setFormasPago(data.formas || []);
    } catch { /* el selector queda vacío — no bloquea el resto */ }
    finally { setCargandoFormasPago(false); }
  };

  // Verificar (nunca crear a ciegas) al proveedor en Obuma por RUT — pedido explícito: la creación
  // solo pasa si la persona la confirma a mano en el modal, ver crearProveedorObuma().
  const verificarProveedor = async (rut: string | null) => {
    if (!rut) { setEstadoProveedorObuma('sin_rut'); return; }
    setEstadoProveedorObuma('cargando');
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/proveedor?rut=${encodeURIComponent(rut)}`);
      const data = await res.json();
      setEstadoProveedorObuma(data.success && data.existe ? 'existe' : 'no_existe');
    } catch {
      setEstadoProveedorObuma('no_existe');
    }
  };

  const abrirOC = (p: ProveedorOC) => {
    setOcAbierta(p.proveedorNombre); setFormaPagoId(''); setIncluirFlete(false); setFleteMonto(''); setConfirmadoOC(false);
    setEstadoProveedorObuma('idle');
    cargarFormasPago();
    verificarProveedor(p.proveedorRut);
  };

  const abrirModalProveedor = (p: ProveedorOC) => {
    setFormProveedor({
      ...formProveedorVacio, rut: p.proveedorRut || '', razonSocial: p.proveedorNombre,
      giro: p.proveedorGiro || '', contacto: p.proveedorContacto || '',
      direccion: p.proveedorDireccion || '', comuna: p.proveedorComuna || '',
      telefono: p.proveedorTelefono || '', email: p.proveedorEmail || '',
    });
    setModalProveedorAbierto(true);
  };

  const crearProveedorObuma = async () => {
    if (!formProveedor.rut.trim() || !formProveedor.razonSocial.trim()) {
      toast.error('Faltan datos', 'RUT y razón social son obligatorios.'); return;
    }
    setGuardandoProveedor(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/proveedor`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formProveedor),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success('Proveedor creado en Obuma', formProveedor.razonSocial);
      setModalProveedorAbierto(false);
      setEstadoProveedorObuma('existe');
    } catch (e: any) {
      toast.error('No se pudo crear el proveedor', e.message);
    } finally {
      setGuardandoProveedor(false);
    }
  };

  const crearOC = async (proveedorNombre: string) => {
    if (!formaPagoId) { toast.error('Falta la forma de pago', 'Elige una antes de crear la orden.'); return; }
    if (incluirFlete && !fleteMonto.trim()) { toast.error('Falta el monto del flete', ''); return; }
    if (!confirmadoOC) { toast.error('Falta confirmar', 'Revisa los datos y marca la casilla de confirmación.'); return; }
    setCreandoOC(proveedorNombre);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proveedorNombre, formaPagoId, incluirFlete, fleteMonto: incluirFlete ? fleteMonto : null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success('Orden de compra creada en Obuma', `Folio ${data.folio ?? data.obumaCompraOcId} — ${fmtCLP(data.total)}`);
      setOcAbierta(null);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo crear la orden de compra', e.message);
    } finally {
      setCreandoOC(null);
    }
  };

  const alternar = async (hito: Hito, activo: boolean, extra?: Record<string, any>) => {
    setGuardando(hito);
    try {
      const res = await fetch(`/api/compras/${negocioId}/reparto`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hito, activo, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      setReparto(data.reparto);
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
    } finally {
      setGuardando(null);
    }
  };

  if (loading || !visible || !reparto) return null;

  return (
    <div className="space-y-3">
      {proveedoresOC.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100 flex items-center gap-1.5">
            <FileText size={13} /> Órdenes de compra (Obuma) — una por proveedor
          </p>
          <p className="px-4 pt-2 text-[10.5px] text-zinc-400">Del escenario elegido. Escritura real contra Obuma — se crea de verdad, no es un registro manual.</p>
          <div className="divide-y divide-zinc-100">
            {proveedoresOC.map(p => {
              const previewFlete = incluirFlete ? parsearMontoCL(fleteMonto) : null;
              const total = p.subtotal + (ocAbierta === p.proveedorNombre && previewFlete ? previewFlete : 0);
              return (
                <div key={p.proveedorNombre} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[12.5px] font-bold text-zinc-800">{p.proveedorNombre}</p>
                      <p className="text-[10.5px] text-zinc-400">{p.items.length} ítem(s) · {fmtCLP(p.subtotal)}</p>
                    </div>
                    {p.yaCreada ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
                        <CheckCircle2 size={12} /> Folio {p.yaCreada.folio ?? p.yaCreada.obumaCompraOcId} · {fmtCLP(p.yaCreada.total)}
                      </span>
                    ) : puedeOperar && ocAbierta !== p.proveedorNombre ? (
                      <button onClick={() => abrirOC(p)}
                        className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
                        <Zap size={12} /> Crear orden de compra
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-1.5 space-y-0.5">
                    {p.items.map(it => (
                      <p key={it.productoId} className="text-[10.5px] text-zinc-500">
                        {it.descripcion} — {it.cantidad} un. × {fmtCLP(it.precioUnitario)} = {fmtCLP(it.subtotal)}
                        {it.obumaCodigoComercial ? <span className="text-indigo-500"> · SKU {it.obumaCodigoComercial}</span> : <span className="text-amber-500"> · sin SKU en Obuma todavía</span>}
                      </p>
                    ))}
                  </div>

                  {ocAbierta === p.proveedorNombre && (
                    <div className="mt-2.5 space-y-2 bg-zinc-50 border border-zinc-200 rounded-lg p-2.5">
                      {estadoProveedorObuma === 'cargando' && (
                        <p className="text-[11px] text-zinc-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Verificando si el proveedor ya está en Obuma…</p>
                      )}
                      {estadoProveedorObuma === 'sin_rut' && (
                        <p className="text-[11px] text-amber-600">Este proveedor no tiene RUT en Licitank — sin RUT no se puede buscar ni crear en Obuma. Complétalo en Proveedores primero.</p>
                      )}
                      {estadoProveedorObuma === 'no_existe' && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 flex items-center justify-between gap-2">
                          <p className="text-[11px] text-amber-700">Este proveedor todavía no está registrado en Obuma.</p>
                          <button onClick={() => abrirModalProveedor(p)}
                            className="flex-shrink-0 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">Crear proveedor en Obuma</button>
                        </div>
                      )}
                      {estadoProveedorObuma === 'existe' && (
                        <p className="text-[10.5px] text-emerald-600 flex items-center gap-1"><CheckCircle2 size={11} /> Proveedor confirmado en Obuma.</p>
                      )}

                      {estadoProveedorObuma === 'existe' && (<>
                      <select value={formaPagoId} onChange={e => setFormaPagoId(e.target.value)}
                        className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500">
                        <option value="">{cargandoFormasPago ? 'Cargando formas de pago…' : 'Elegir forma de pago…'}</option>
                        {formasPago.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                      </select>

                      <label className="flex items-center gap-2 text-[11px] text-zinc-700">
                        <input type="checkbox" checked={incluirFlete} onChange={e => setIncluirFlete(e.target.checked)} className="accent-indigo-600" />
                        <span className="flex items-center gap-1"><Truck size={11} /> Incluir flete/despacho en esta orden</span>
                      </label>
                      {incluirFlete && (
                        <input value={fleteMonto} onChange={e => setFleteMonto(e.target.value)} placeholder="Monto del flete"
                          className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                      )}

                      <div className="bg-white border border-indigo-100 rounded-lg px-2.5 py-2 space-y-1">
                        <p className="text-[10px] font-bold text-indigo-600 uppercase">Esto es lo que se va a mandar a Obuma</p>
                        <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Proveedor: </span><b>{p.proveedorNombre}</b>{p.proveedorRut && ` (${p.proveedorRut})`}</p>
                        <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Tipo: </span>Nacional · Inventario</p>
                        <p className="text-[11px] text-zinc-700">
                          <span className="text-zinc-400">Centro de costo: </span>
                          {centroCosto ? <b>{centroCosto.nombre}</b> : <span className="text-zinc-400 italic">esta licitación todavía no tiene uno armado en Obuma — queda sin asignar</span>}
                        </p>
                        <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Mercadería: </span>{fmtCLP(p.subtotal)}</p>
                        {incluirFlete && <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Flete: </span>{previewFlete != null ? fmtCLP(previewFlete) : <span className="text-rose-500">monto inválido</span>}</p>}
                        <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Neto total: </span><b>{fmtCLP(total)}</b> <span className="text-zinc-400">+ IVA</span></p>
                        <label className="flex items-center gap-1.5 text-[10.5px] text-indigo-700 pt-0.5">
                          <input type="checkbox" checked={confirmadoOC} onChange={e => setConfirmadoOC(e.target.checked)} className="accent-indigo-600" />
                          Confirmo estos datos — se va a crear de verdad en Obuma
                        </label>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button onClick={() => crearOC(p.proveedorNombre)} disabled={creandoOC === p.proveedorNombre || !formaPagoId || !confirmadoOC}
                          className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                          {creandoOC === p.proveedorNombre ? <Loader2 size={12} className="animate-spin" /> : 'Crear en Obuma'}
                        </button>
                        <button onClick={() => setOcAbierta(null)} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
                      </div>
                      </>)}
                      {estadoProveedorObuma !== 'existe' && (
                        <button onClick={() => setOcAbierta(null)} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100 flex items-center gap-1.5">
        <ClipboardList size={13} /> Proceso administrativo (§11) — hitos de OBUMA
      </p>
      <p className="px-4 pt-2 text-[10.5px] text-zinc-400">Estos hitos los ejecuta OBUMA (emite la OC, registra el pago, crea la carpeta) — acá solo se marca que ya pasaron.</p>
      <div className="divide-y divide-zinc-100">
        {HITOS.map(h => {
          const activo = !!reparto[h.atField];
          return (
            <div key={h.key} className="px-4 py-2 flex items-center gap-2 flex-wrap">
              <button onClick={() => puedeOperar && alternar(h.key, !activo)} disabled={!puedeOperar || guardando === h.key} className="flex-shrink-0">
                {guardando === h.key ? <Loader2 size={15} className="animate-spin text-zinc-400" />
                  : activo ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Circle size={15} className="text-zinc-300" />}
              </button>
              <span className={`text-[12px] ${activo ? 'text-zinc-500' : 'text-zinc-700'}`}>{h.label}</span>
              {activo && h.key === 'ocEmitida' && (
                <input defaultValue={reparto.ocNumero || ''} placeholder="N° de OC"
                  onBlur={e => alternar('ocEmitida', true, { ocNumero: e.target.value })}
                  className="text-[11px] border border-zinc-200 rounded-lg px-2 py-0.5 w-32 outline-none focus:ring-1 focus:ring-teal-500" />
              )}
              {activo && h.key === 'anticipoPagado' && (
                <input defaultValue={reparto.anticipoMonto ?? ''} placeholder="Monto" inputMode="numeric"
                  onBlur={e => alternar('anticipoPagado', true, { anticipoMonto: parsearMontoCL(e.target.value) })}
                  className="text-[11px] border border-zinc-200 rounded-lg px-2 py-0.5 w-28 outline-none focus:ring-1 focus:ring-teal-500" />
              )}
              {activo && h.key === 'carpetaProyectoCreada' && (
                <input defaultValue={reparto.carpetaProyectoId || ''} placeholder="ID carpeta"
                  onBlur={e => alternar('carpetaProyectoCreada', true, { carpetaProyectoId: e.target.value })}
                  className="text-[11px] border border-zinc-200 rounded-lg px-2 py-0.5 w-32 outline-none focus:ring-1 focus:ring-teal-500" />
              )}
              {activo && h.key === 'provisionFondos' && (
                <>
                  <input defaultValue={reparto.provisionFondosMonto ?? ''} placeholder="Monto" inputMode="numeric"
                    onBlur={e => alternar('provisionFondos', true, { provisionFondosMonto: parsearMontoCL(e.target.value) })}
                    className="text-[11px] border border-zinc-200 rounded-lg px-2 py-0.5 w-24 outline-none focus:ring-1 focus:ring-teal-500" />
                  <input defaultValue={reparto.cuentaOrigen || ''} placeholder="Cuenta de origen"
                    onBlur={e => alternar('provisionFondos', true, { cuentaOrigen: e.target.value })}
                    className="text-[11px] border border-zinc-200 rounded-lg px-2 py-0.5 w-40 outline-none focus:ring-1 focus:ring-teal-500" />
                </>
              )}
            </div>
          );
        })}
      </div>
      </div>

      {modalProveedorAbierto && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setModalProveedorAbierto(false)}>
          <div className="bg-white rounded-xl border border-zinc-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="px-4 py-3 text-[12px] font-bold text-zinc-800 border-b border-zinc-100 flex items-center gap-1.5">
              <Zap size={13} className="text-indigo-600" /> Crear proveedor en Obuma
            </p>
            <div className="p-4 space-y-2">
              <p className="text-[10.5px] text-zinc-400">Escritura real contra Obuma — se crea de verdad al guardar. Son los campos documentados de la API (obuma.cl/ayuda/articulo/157); solo RUT y razón social son obligatorios para crear.</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10.5px] font-semibold text-zinc-500 col-span-1">
                  RUT *
                  <input value={formProveedor.rut} onChange={e => setFormProveedor(f => ({ ...f, rut: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Razón social *
                  <input value={formProveedor.razonSocial} onChange={e => setFormProveedor(f => ({ ...f, razonSocial: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Nombre fantasía
                  <input value={formProveedor.nombreFantasia} onChange={e => setFormProveedor(f => ({ ...f, nombreFantasia: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Contacto <span className="font-normal text-zinc-400">(pide Obuma)</span>
                  <input value={formProveedor.contacto} onChange={e => setFormProveedor(f => ({ ...f, contacto: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Giro comercial
                  <input value={formProveedor.giro} onChange={e => setFormProveedor(f => ({ ...f, giro: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500 col-span-2">
                  Dirección
                  <input value={formProveedor.direccion} onChange={e => setFormProveedor(f => ({ ...f, direccion: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Comuna
                  <input value={formProveedor.comuna} onChange={e => setFormProveedor(f => ({ ...f, comuna: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Región
                  <input value={formProveedor.region} onChange={e => setFormProveedor(f => ({ ...f, region: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  País
                  <input value={formProveedor.pais} onChange={e => setFormProveedor(f => ({ ...f, pais: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Teléfono <span className="font-normal text-zinc-400">(pide Obuma)</span>
                  <input value={formProveedor.telefono} onChange={e => setFormProveedor(f => ({ ...f, telefono: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Celular
                  <input value={formProveedor.celular} onChange={e => setFormProveedor(f => ({ ...f, celular: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Email <span className="font-normal text-zinc-400">(pide Obuma)</span>
                  <input value={formProveedor.email} onChange={e => setFormProveedor(f => ({ ...f, email: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Sitio web
                  <input value={formProveedor.website} onChange={e => setFormProveedor(f => ({ ...f, website: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Cuenta contable <span className="font-normal text-zinc-400">(código, opcional)</span>
                  <input value={formProveedor.cuentaContable} onChange={e => setFormProveedor(f => ({ ...f, cuentaContable: e.target.value }))}
                    placeholder="ej. 2.1.01.001" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500 col-span-2">
                  Observación
                  <textarea value={formProveedor.observacion} onChange={e => setFormProveedor(f => ({ ...f, observacion: e.target.value }))} rows={2}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-zinc-600">
                  <input type="checkbox" checked={formProveedor.esSupermercado} onChange={e => setFormProveedor(f => ({ ...f, esSupermercado: e.target.checked }))} className="accent-indigo-600" />
                  Es supermercado
                </label>
                <label className="flex items-center gap-2 text-[11px] text-zinc-600">
                  <input type="checkbox" checked={formProveedor.esFactoring} onChange={e => setFormProveedor(f => ({ ...f, esFactoring: e.target.checked }))} className="accent-indigo-600" />
                  Es factoring
                </label>
              </div>
              <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                Tipo de proveedor, centro de costo, forma de pago y datos bancarios no están en la API documentada de Obuma — se completan después, directo en Obuma, si hacen falta.
              </p>
            </div>
            <div className="px-4 py-3 border-t border-zinc-100 flex items-center gap-2">
              <button onClick={crearProveedorObuma} disabled={guardandoProveedor || !formProveedor.rut.trim() || !formProveedor.razonSocial.trim()}
                className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {guardandoProveedor ? <Loader2 size={12} className="animate-spin" /> : 'Crear en Obuma'}
              </button>
              <button onClick={() => setModalProveedorAbierto(false)} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
