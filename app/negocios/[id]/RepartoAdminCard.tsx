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
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconClipboardList as ClipboardList, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconCircle as Circle, IconFileText as FileText, IconBolt as Zap, IconTruck as Truck, IconCircleMinus as MinusCircle, IconPaperclip as Paperclip, IconX as X } from '@tabler/icons-react';

interface Reparto {
  ocEmitidaAt: string | null; ocNumero: string | null; ocMonto: number | null;
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
  posibleDuplicadoObuma: { folio: string | null; referencia: string; fecha: string; total: number } | null;
}
interface FormaPago { id: string; codigo: string; nombre: string }
interface ItemOCVista { descripcion: string; cantidad: number; precioUnitario: number; subtotal: number }
interface OrdenCompraVista {
  origen: 'LICITANK' | 'OBUMA_MANUAL'; folio: string | null; obumaCompraOcId: string | null;
  proveedorNombre: string; proveedorRut: string | null;
  proveedorDireccion: string | null; proveedorComuna: string | null; proveedorGiro: string | null; proveedorContacto: string | null;
  proveedorEmail: string | null; proveedorTelefono: string | null;
  fecha: string | null; centroCosto: string | null; formaPago: string | null;
  items: ItemOCVista[]; subtotal: number; flete: number; total: number; error?: string;
}
interface RespaldoHito {
  hito: Hito; estado: 'HECHO' | 'NO_APLICA'; nota: string; archivoUrl: string | null; archivoNombre: string | null;
  actualizadoPorNombre: string | null; updatedAt: string;
}
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

type EstadoProveedorObuma = 'idle' | 'cargando' | 'existe' | 'no_existe' | 'sin_rut';
const formProveedorVacio = {
  rut: '', razonSocial: '', nombreFantasia: '', contacto: '', giro: '', direccion: '', comuna: '', region: '', pais: 'CHILE',
  telefono: '', celular: '', email: '', website: '', observacion: '', cuentaContable: '',
  esSupermercado: false, esFactoring: false,
  // Configuración financiera — confirmada en vivo contra Obuma 22-sep-2026 (ver obuma.ts,
  // crearProveedorObuma). formaPago/centroCosto son IDs con catálogo consultable; bancoCuenta y
  // tipoProveedorId son IDs internos de Obuma sin catálogo público — quien llena el formulario debe
  // saber el ID (mismo que ve en el desplegable del formulario web de Obuma).
  formaPago: '', centroCosto: '', bancoCuenta: '', nroCuenta: '', tipoCuenta: '', tipoProveedorId: '', tags: '',
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
  const { recargar: recargarCompartido } = useCompras();
  const [visible, setVisible] = useState(false);
  const [margenAprobado, setMargenAprobado] = useState(false);
  const [reparto, setReparto] = useState<Reparto | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState<Hito | null>(null);
  // Respaldo por hito (pedido explícito, 14-sep-2026: "esos deben poder tener un respaldo, archivo
  // y texto obligatorio") — se abre un mini-formulario ANTES de marcar el hito, nunca se marca a
  // ciegas con un solo clic. `hitoNoAplica` es aparte porque pedido explícito distinto (14-sep-2026,
  // segundo mensaje): "qué pasa con las que no se realizan" — anticipo que nunca se paga, etc.
  const [respaldos, setRespaldos] = useState<RespaldoHito[]>([]);
  const [hitoAbierto, setHitoAbierto] = useState<Hito | null>(null);
  const [modoNoAplica, setModoNoAplica] = useState(false);
  const [notaHito, setNotaHito] = useState('');
  const [archivoHito, setArchivoHito] = useState<File | null>(null);
  const [guardandoRespaldo, setGuardandoRespaldo] = useState(false);

  // "Ver OC" (pedido explícito, 14-sep-2026: "podemos rescatar el documento de obuma para poder ver
  // la OC") — vista propia de Licitank con los mismos datos de la orden, no el PDF oficial de Obuma
  // (Obuma no confirma tener un endpoint de descarga, ver nota en compras-oc-obuma.ts).
  const [verOcAbierto, setVerOcAbierto] = useState(false);
  const [cargandoVerOc, setCargandoVerOc] = useState(false);
  const [ordenesVista, setOrdenesVista] = useState<OrdenCompraVista[]>([]);
  // Monto de la OC — controlado (en vez de defaultValue) para poder mostrar la conversión a IVA en
  // vivo mientras se tipea (pedido explícito, 15-sep-2026: "le puse NETO pero igual tienes que
  // hacer la conversión a con IVA para que tengamos todo eso visible"). Mismo factor 1.19 que usa
  // el resto del proyecto (ver IVA en costeo-comparativo.ts) — se guarda solo el NETO en la base
  // (como ya se hacía), el "con IVA" es siempre calculado, nunca un campo aparte que se desincronice.
  const [ocMontoDraft, setOcMontoDraft] = useState<string | null>(null); // null = todavía no se tocó, usar reparto.ocMonto

  const [proveedoresOC, setProveedoresOC] = useState<ProveedorOC[]>([]);
  const [centroCosto, setCentroCosto] = useState<{ id: string; nombre: string } | null>(null);
  const [formasPago, setFormasPago] = useState<FormaPago[]>([]);
  const [cargandoFormasPago, setCargandoFormasPago] = useState(false);
  const [ocAbierta, setOcAbierta] = useState<string | null>(null); // proveedorNombre
  const [formaPagoId, setFormaPagoId] = useState('');
  const [incluirFlete, setIncluirFlete] = useState(false);
  const [fleteMonto, setFleteMonto] = useState('');
  const [confirmadoOC, setConfirmadoOC] = useState(false);
  // Pedido explícito del usuario (14-sep-2026, caso real: el encargado de compras ya había creado
  // esta OC directo en Obuma) — segunda casilla, solo aparece cuando hay un posible duplicado real.
  const [confirmadoPeseADuplicado, setConfirmadoPeseADuplicado] = useState(false);
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
      // Control de gasto: la OC real en Obuma exige AMBAS compuertas (ver compras-oc-obuma.ts) —
      // se avisa acá ANTES de que la persona llene todo el formulario y recién ahí se entere.
      setMargenAprobado(dApr.success && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(dApr.margen?.estado));
      if (dRep.success) { setReparto(dRep.reparto); setRespaldos(dRep.respaldos || []); }
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
    setOcAbierta(p.proveedorNombre); setFormaPagoId(''); setIncluirFlete(false); setFleteMonto(''); setConfirmadoOC(false); setConfirmadoPeseADuplicado(false);
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
    cargarFormasPago();
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

  const crearOC = async (proveedorNombre: string, hayDuplicado: boolean) => {
    if (!formaPagoId) { toast.error('Falta la forma de pago', 'Elige una antes de crear la orden.'); return; }
    if (incluirFlete && !fleteMonto.trim()) { toast.error('Falta el monto del flete', ''); return; }
    if (!confirmadoOC) { toast.error('Falta confirmar', 'Revisa los datos y marca la casilla de confirmación.'); return; }
    if (hayDuplicado && !confirmadoPeseADuplicado) { toast.error('Falta confirmar el posible duplicado', 'Revisa la OC real que encontramos antes de seguir.'); return; }
    setCreandoOC(proveedorNombre);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedorNombre, formaPagoId, incluirFlete, fleteMonto: incluirFlete ? fleteMonto : null,
          confirmarPeseADuplicado: hayDuplicado ? confirmadoPeseADuplicado : undefined,
        }),
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
      if (data.respaldos) setRespaldos(data.respaldos);
      recargarCompartido(); // mueve el badge de "Compra, Importación y Logística" en el stepper
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
    } finally {
      setGuardando(null);
    }
  };

  // Respaldo por hito (pedido explícito, 14-sep-2026) — se abre un mini-formulario ANTES de marcar
  // un hito pendiente: nota obligatoria, archivo opcional. Deshacer (hito ya marcado o "no aplica")
  // sigue siendo un solo clic, mismo criterio de siempre ("por si se marcó por error").
  const abrirRespaldo = (hito: Hito, noAplica: boolean) => {
    setHitoAbierto(hito); setModoNoAplica(noAplica); setNotaHito(''); setArchivoHito(null);
  };
  const cerrarRespaldo = () => { setHitoAbierto(null); setModoNoAplica(false); setNotaHito(''); setArchivoHito(null); };

  const guardarRespaldo = async () => {
    if (!hitoAbierto) return;
    if (!notaHito.trim()) { toast.error('Falta la nota', modoNoAplica ? 'Explica por qué este hito no aplica.' : 'Deja una nota de respaldo.'); return; }
    setGuardandoRespaldo(true);
    try {
      let res: Response;
      if (archivoHito) {
        const fd = new FormData();
        fd.set('hito', hitoAbierto);
        fd.set(modoNoAplica ? 'noAplica' : 'activo', 'true');
        fd.set('nota', notaHito.trim());
        fd.set('file', archivoHito);
        res = await fetch(`/api/compras/${negocioId}/reparto`, { method: 'PATCH', body: fd });
      } else {
        res = await fetch(`/api/compras/${negocioId}/reparto`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hito: hitoAbierto, [modoNoAplica ? 'noAplica' : 'activo']: true, nota: notaHito.trim() }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setReparto(data.reparto); setRespaldos(data.respaldos || []);
      recargarCompartido();
      toast.success(modoNoAplica ? 'Marcado como no aplica' : 'Hito marcado con respaldo');
      cerrarRespaldo();
    } catch (e: any) {
      toast.error('No se pudo guardar el respaldo', e.message);
    } finally {
      setGuardandoRespaldo(false);
    }
  };

  const verOc = async () => {
    setVerOcAbierto(true);
    if (ordenesVista.length) return; // ya cargadas — no repetir la consulta en vivo por cada abierta/cerrada
    setCargandoVerOc(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/detalle`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setOrdenesVista(data.ordenes || []);
    } catch (e: any) {
      toast.error('No se pudo cargar la orden de compra', e.message);
      setVerOcAbierto(false);
    } finally {
      setCargandoVerOc(false);
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
          {!margenAprobado && (
            <p className="mx-4 mt-2 text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Falta aprobar el Hito 2 (margen) — control de gasto: no se puede emitir dinero real en Obuma sin los dos hitos aprobados.
            </p>
          )}
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
                      <div className="flex-shrink-0 flex items-center gap-2">
                        {p.posibleDuplicadoObuma && (
                          <span title={`Posible OC real ya existente: ${p.posibleDuplicadoObuma.referencia}`}
                            className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                            ⚠ posible duplicado
                          </span>
                        )}
                        <button onClick={() => abrirOC(p)} disabled={!margenAprobado}
                          className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-zinc-300 disabled:cursor-not-allowed">
                          <Zap size={12} /> Crear orden de compra
                        </button>
                      </div>
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

                      {/* Pedido explícito, 14-sep-2026: caso real donde el encargado de compras ya
                          había creado esta misma OC directo en Obuma — Licitank no se enteraba
                          porque solo miraba su propia tabla, nunca las OC reales de Obuma. */}
                      {p.posibleDuplicadoObuma && (
                        <div className="bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-2 space-y-1">
                          <p className="text-[11px] font-semibold text-rose-700">⚠ Ya existe una OC real en Obuma que menciona algo parecido — revisa antes de seguir:</p>
                          <p className="text-[11px] text-rose-700">
                            "{p.posibleDuplicadoObuma.referencia}" — folio {p.posibleDuplicadoObuma.folio ?? '—'}, {p.posibleDuplicadoObuma.fecha.slice(0, 10)}, {fmtCLP(p.posibleDuplicadoObuma.total)}
                          </p>
                          <label className="flex items-center gap-1.5 text-[10.5px] text-rose-700 pt-0.5">
                            <input type="checkbox" checked={confirmadoPeseADuplicado} onChange={e => setConfirmadoPeseADuplicado(e.target.checked)} className="accent-rose-600" />
                            Ya revisé esa OC — esta es una compra distinta, igual quiero crearla
                          </label>
                        </div>
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
                        <button onClick={() => crearOC(p.proveedorNombre, !!p.posibleDuplicadoObuma)}
                          disabled={creandoOC === p.proveedorNombre || !formaPagoId || !confirmadoOC || !margenAprobado || (!!p.posibleDuplicadoObuma && !confirmadoPeseADuplicado)}
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
          const respaldo = respaldos.find(r => r.hito === h.key);
          const noAplica = respaldo?.estado === 'NO_APLICA';
          const abierto = hitoAbierto === h.key;
          return (
            <div key={h.key} className="px-4 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    if (!puedeOperar) return;
                    if (activo || noAplica) alternar(h.key, false); // deshacer — un clic, "por si se marcó por error"
                    else abrirRespaldo(h.key, false); // pendiente → abre el mini-formulario, nunca marca a ciegas
                  }}
                  disabled={!puedeOperar || guardando === h.key} className="flex-shrink-0">
                  {guardando === h.key ? <Loader2 size={15} className="animate-spin text-zinc-400" />
                    : activo ? <CheckCircle2 size={15} className="text-emerald-500" />
                    : noAplica ? <MinusCircle size={15} className="text-zinc-400" />
                    : <Circle size={15} className="text-zinc-300" />}
                </button>
                <span className={`text-[12px] ${activo || noAplica ? 'text-zinc-500' : 'text-zinc-700'}`}>{h.label}</span>
                {noAplica && <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">no aplica</span>}
                {!activo && !noAplica && !abierto && puedeOperar && (
                  <button onClick={() => abrirRespaldo(h.key, true)} className="text-[10.5px] text-zinc-400 hover:text-zinc-600 underline">no aplica</button>
                )}
                {activo && h.key === 'ocEmitida' && (
                  <>
                    <input defaultValue={reparto.ocNumero || ''} placeholder="N° de OC"
                      onBlur={e => alternar('ocEmitida', true, { ocNumero: e.target.value })}
                      className="text-[11px] border border-zinc-200 rounded-lg px-2 py-0.5 w-32 outline-none focus:ring-1 focus:ring-teal-500" />
                    {/* Pedido explícito del usuario (15-sep-2026, tras ver que el agente marcaba
                        una OC registrada a mano como "inconsistencia grave" por tener $0 de
                        valor): "creo que nunca me pidió el valor de la OC" — tenía razón, este
                        checklist solo pedía el número. Se agrega el monto NETO (opcional — las OC
                        creadas vía la integración real con Obuma ya traen su propio total, este
                        campo es para las que se registran a mano), con la conversión a IVA visible
                        al lado (pedido explícito posterior: "tienes que hacer la conversión a con
                        IVA para que tengamos todo eso visible"). */}
                    <input value={ocMontoDraft ?? (reparto.ocMonto != null ? String(reparto.ocMonto) : '')} placeholder="Monto NETO de la OC (opcional)" inputMode="numeric"
                      onChange={e => setOcMontoDraft(e.target.value)}
                      onBlur={e => alternar('ocEmitida', true, { ocMonto: parsearMontoCL(e.target.value) })}
                      className="text-[11px] border border-zinc-200 rounded-lg px-2 py-0.5 w-32 outline-none focus:ring-1 focus:ring-teal-500" />
                    {(() => {
                      const neto = parsearMontoCL(ocMontoDraft ?? (reparto.ocMonto != null ? String(reparto.ocMonto) : ''));
                      return neto != null && neto > 0
                        ? <span className="text-[10.5px] text-zinc-400">= {fmtCLP(Math.round(neto * 1.19))} c/IVA</span>
                        : null;
                    })()}
                    <button onClick={verOc} className="text-[10.5px] font-semibold text-teal-600 hover:text-teal-700">Ver OC</button>
                  </>
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

              {/* Respaldo guardado (pedido explícito, 14-sep-2026) — nota + archivo, o el motivo de
                  "no aplica". Siempre visible una vez guardado, sin tener que reabrir nada. */}
              {respaldo && (
                <div className="mt-1 ml-6 text-[10.5px] text-zinc-500 flex items-start gap-1">
                  <span className="italic">{respaldo.nota}</span>
                  {respaldo.archivoUrl && (
                    <a href={respaldo.archivoUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 flex items-center gap-0.5 text-teal-600 hover:text-teal-700 font-semibold not-italic">
                      <Paperclip size={10} /> {respaldo.archivoNombre || 'archivo'}
                    </a>
                  )}
                </div>
              )}

              {/* Mini-formulario de respaldo — se abre ANTES de marcar, nunca después (spec §11:
                  "controla y registra" — la nota es la prueba de que se controló). */}
              {abierto && (
                <div className="mt-2 ml-6 space-y-1.5 bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 max-w-md">
                  <p className="text-[10.5px] font-semibold text-zinc-500">
                    {modoNoAplica ? '¿Por qué no aplica este hito?' : 'Nota de respaldo (obligatoria)'}
                  </p>
                  <textarea rows={2} value={notaHito} onChange={e => setNotaHito(e.target.value)}
                    placeholder={modoNoAplica ? 'Ej: se pagó de contado, no hubo anticipo' : 'Ej: transferencia N° 123, comprobante adjunto'}
                    className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
                  {!modoNoAplica && (
                    <label className="block text-[10.5px] text-zinc-400">
                      Archivo (opcional)
                      <input type="file" onChange={e => setArchivoHito(e.target.files?.[0] || null)}
                        className="mt-0.5 block text-[10.5px] text-zinc-600 file:mr-2 file:text-[10.5px] file:font-semibold file:text-teal-700 file:bg-teal-50 file:border-0 file:rounded-lg file:px-2 file:py-0.5" />
                    </label>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button onClick={guardarRespaldo} disabled={guardandoRespaldo || !notaHito.trim()}
                      className="text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1 rounded-lg">
                      {guardandoRespaldo ? <Loader2 size={12} className="animate-spin" /> : modoNoAplica ? 'Marcar no aplica' : 'Marcar como hecho'}
                    </button>
                    <button onClick={cerrarRespaldo} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
                  </div>
                </div>
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
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Forma de pago <span className="font-normal text-zinc-400">(opcional)</span>
                  <select value={formProveedor.formaPago} onChange={e => setFormProveedor(f => ({ ...f, formaPago: e.target.value }))}
                    className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                    <option value="">— sin definir —</option>
                    {formasPago.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                  </select>
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Centro de costo <span className="font-normal text-zinc-400">(ID de Obuma, opcional)</span>
                  <input value={formProveedor.centroCosto} onChange={e => setFormProveedor(f => ({ ...f, centroCosto: e.target.value }))}
                    placeholder="ej. 4491" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Banco <span className="font-normal text-zinc-400">(ID de Obuma, opcional)</span>
                  <input value={formProveedor.bancoCuenta} onChange={e => setFormProveedor(f => ({ ...f, bancoCuenta: e.target.value }))}
                    placeholder="mismo ID que ves en Obuma" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  Tipo de cuenta <span className="font-normal text-zinc-400">(opcional)</span>
                  <input value={formProveedor.tipoCuenta} onChange={e => setFormProveedor(f => ({ ...f, tipoCuenta: e.target.value }))}
                    placeholder="ej. Cuenta Corriente" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                </label>
                <label className="text-[10.5px] font-semibold text-zinc-500">
                  N° de cuenta <span className="font-normal text-zinc-400">(opcional)</span>
                  <input value={formProveedor.nroCuenta} onChange={e => setFormProveedor(f => ({ ...f, nroCuenta: e.target.value }))}
                    placeholder="ej. 164-28444-03" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
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
                Forma de pago, centro de costo, banco, tipo y N° de cuenta se mandan junto con la creación (confirmado en vivo, 22-sep-2026 — no están en la doc pública de Obuma, pero la API los acepta). El ID del banco no tiene catálogo público: usá el mismo que ves en el desplegable del formulario web de Obuma. "Tipo de proveedor" no tiene campo acá todavía — se completa después, directo en Obuma, si hace falta.
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

      {verOcAbierto && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 print:static print:bg-white print:p-0" onClick={() => setVerOcAbierto(false)}>
          <div className="bg-white rounded-xl border border-zinc-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto print:max-h-none print:max-w-none print:shadow-none print:border-0" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between print:hidden">
              <p className="text-[12px] font-bold text-zinc-800 flex items-center gap-1.5"><FileText size={13} className="text-teal-600" /> Orden(es) de compra</p>
              <div className="flex items-center gap-3">
                {ordenesVista.length > 0 && <button onClick={() => window.print()} className="text-[11px] font-semibold text-teal-600 hover:text-teal-700">Imprimir</button>}
                <button onClick={() => setVerOcAbierto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
              </div>
            </div>
            <div className="p-4 space-y-5">
              {cargandoVerOc && <p className="text-[11px] text-zinc-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando...</p>}
              {!cargandoVerOc && ordenesVista.length === 0 && (
                <p className="text-[11px] text-zinc-400">No hay ninguna orden de compra registrada para este negocio.</p>
              )}
              {!cargandoVerOc && ordenesVista.length > 0 && (
                <p className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 print:hidden">
                  Vista propia de Licitank armada con los datos de la orden — no es el documento oficial que emite Obuma (mismo contenido, distinto formato).
                </p>
              )}
              {ordenesVista.map((oc, i) => (
                <div key={i} className="border border-zinc-200 rounded-lg overflow-hidden break-inside-avoid">
                  <div className="px-3 py-2 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between flex-wrap gap-1">
                    <p className="text-[12px] font-bold text-zinc-800">
                      Orden de compra N° {oc.folio || oc.obumaCompraOcId || '—'}
                      {oc.origen === 'OBUMA_MANUAL' && <span className="ml-1.5 text-[9.5px] font-semibold text-zinc-400 bg-zinc-200 px-1.5 py-0.5 rounded-full align-middle">registrada directo en Obuma</span>}
                    </p>
                    {oc.fecha && <p className="text-[10.5px] text-zinc-400">{oc.fecha}</p>}
                  </div>
                  {oc.error ? (
                    <p className="px-3 py-3 text-[11px] text-amber-700 bg-amber-50">{oc.error}</p>
                  ) : (
                    <div className="p-3 space-y-2.5">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <p><span className="text-zinc-400">Proveedor:</span> <span className="font-semibold text-zinc-700">{oc.proveedorNombre || '—'}</span></p>
                        <p><span className="text-zinc-400">RUT:</span> {oc.proveedorRut || '—'}</p>
                        {(oc.proveedorDireccion || oc.proveedorComuna) && <p className="col-span-2"><span className="text-zinc-400">Dirección:</span> {[oc.proveedorDireccion, oc.proveedorComuna].filter(Boolean).join(', ')}</p>}
                        <p><span className="text-zinc-400">Centro de costo:</span> {oc.centroCosto || '—'}</p>
                        <p><span className="text-zinc-400">Forma de pago:</span> {oc.formaPago || '—'}</p>
                      </div>
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="text-left text-zinc-400 border-b border-zinc-100">
                            <th className="py-1 font-semibold">Ítem</th>
                            <th className="py-1 font-semibold text-right">Cant.</th>
                            <th className="py-1 font-semibold text-right">Precio unit.</th>
                            <th className="py-1 font-semibold text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {oc.items.map((it, j) => (
                            <tr key={j} className="border-b border-zinc-50">
                              <td className="py-1 pr-2 text-zinc-700">{it.descripcion}</td>
                              <td className="py-1 text-right text-zinc-500">{it.cantidad}</td>
                              <td className="py-1 text-right text-zinc-500">{fmtCLP(it.precioUnitario)}</td>
                              <td className="py-1 text-right text-zinc-700">{fmtCLP(it.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-end">
                        <div className="w-48 space-y-0.5 text-[11px]">
                          <div className="flex justify-between"><span className="text-zinc-400">Mercadería</span><span>{fmtCLP(oc.subtotal)}</span></div>
                          {oc.flete > 0 && <div className="flex justify-between"><span className="text-zinc-400">Flete</span><span>{fmtCLP(oc.flete)}</span></div>}
                          <div className="flex justify-between font-bold text-zinc-800 border-t border-zinc-200 pt-0.5"><span>Total</span><span>{fmtCLP(oc.total)}</span></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
