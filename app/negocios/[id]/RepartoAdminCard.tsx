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
import { irAFase } from '@/app/compras/[negocioId]/comprasNavegacion';
import { fetchJsonReintento } from '@/app/lib/fetch-reintento';
import { METODOS_DESPACHO_OBUMA } from '@/app/lib/obuma-despacho';
import { CrearProveedorObumaModal, type FormProveedor } from './CrearProveedorObumaModal';
import { IconClipboardList as ClipboardList, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconFileText as FileText, IconBolt as Zap, IconTruck as Truck, IconPaperclip as Paperclip, IconX as X } from '@tabler/icons-react';

interface Reparto {
  ocEmitidaAt: string | null; ocNumero: string | null; ocMonto: number | null;
  pagoRegistradoAt: string | null;
  anticipoPagadoAt: string | null; anticipoMonto: number | null;
  facturaCompraRegistradaAt: string | null;
  carpetaProyectoCreadaAt: string | null; carpetaProyectoId: string | null;
  provisionFondosAt: string | null; provisionFondosMonto: number | null; cuentaOrigen: string | null;
}
type Hito = 'ocEmitida' | 'pagoRegistrado' | 'anticipoPagado' | 'facturaCompraRegistrada' | 'carpetaProyectoCreada' | 'provisionFondos';

interface ItemOC { productoId: number; descripcion: string; cantidad: number; precioUnitario: number; subtotal: number; obumaProductoId: string | null; obumaCodigoComercial: string | null; aprobado?: boolean; estadoLinea?: 'APROBADA' | 'RECHAZADA' | 'SIN_DECIDIR' | null; compraRapida?: boolean }
interface ProveedorOC {
  proveedorNombre: string; proveedorId: number | null; proveedorRut: string | null;
  proveedorDireccion: string | null; proveedorComuna: string | null; proveedorEmail: string | null; proveedorTelefono: string | null;
  proveedorGiro: string | null; proveedorContacto: string | null;
  items: ItemOC[]; subtotal: number; fleteSugerido?: number | null;
  yaCreada: { obumaCompraOcId: string; folio: string | null; total: number; fechaOc: string; estado?: string | null } | null;
  posibleDuplicadoObuma: { folio: string | null; referencia: string; fecha: string; total: number } | null;
  ocRealObuma?: { folios: string[]; totalNeto: number; estados: string[]; fecha: string | null } | null;
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
// Pagos por OC (migration-157) y OC reales de Obuma con sus facturas — ver app/lib/compras-pagos-oc.ts.
type TipoPago = 'ANTICIPO' | 'PAGO_TOTAL' | 'SALDO';
interface PagoOc { id: number; ocFolio: string; proveedorNombre: string | null; tipo: TipoPago; monto: number; fecha: string; archivoUrl: string; archivoNombre: string | null; nota: string | null; adjuntos?: Array<{ url: string; nombre: string | null }> }
interface OcObuma { folio: string; estado: string | null; total: number | null; facturas: Array<{ folio: string; fecha: string | null; total: number | null; s3Link: string | null }> }
interface ProyectoOpcion { folio: number; nombre: string | null; referencia: string | null; cliente: string | null; estado: string | null; sugerido: boolean }
const TIPOS_PAGO: Array<{ key: TipoPago; label: string; ayuda: string }> = [
  { key: 'PAGO_TOTAL', label: 'Pago total', ayuda: 'Se pagó la orden completa de una vez.' },
  { key: 'ANTICIPO', label: 'Anticipo', ayuda: 'Una parte por adelantado. Cuando pagues el resto, registra el saldo.' },
  { key: 'SALDO', label: 'Saldo', ayuda: 'Lo que faltaba después del anticipo.' },
];
const fechaCorta = (f: string | null) => f ? f.slice(0, 10).split('-').reverse().join('-') : '';
const conPunto = (color: string, label: string) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
    <span aria-hidden style={{ backgroundColor: color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />{label}
  </span>
);
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

type EstadoProveedorObuma = 'idle' | 'cargando' | 'existe' | 'no_existe' | 'sin_rut';


export function RepartoAdminCard({ negocioId, puedeOperar, parte = 'todo' }: { negocioId: number; puedeOperar: boolean; parte?: 'todo' | 'oc' | 'hitos' }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [visible, setVisible] = useState(false);
  const [margenAprobado, setMargenAprobado] = useState(false);
  const [compraOk, setCompraOk] = useState(false);
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
  const [proveedoresOC, setProveedoresOC] = useState<ProveedorOC[]>([]);
  // Pagos por OC con comprobante (pedido del dueño, 21-oct-2026) y las OC de Obuma con su factura.
  const [pagosOc, setPagosOc] = useState<PagoOc[]>([]);
  const [ocsObuma, setOcsObuma] = useState<OcObuma[]>([]);
  const [pagoAbierto, setPagoAbierto] = useState<string | null>(null); // folio de la OC
  const [pagoTipo, setPagoTipo] = useState<TipoPago>('PAGO_TOTAL');
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoFecha, setPagoFecha] = useState('');
  const [pagoNota, setPagoNota] = useState('');
  const [pagoArchivos, setPagoArchivos] = useState<File[]>([]);
  const [guardandoPago, setGuardandoPago] = useState(false);
  // Proyecto de Obuma para vincular (la API de Obuma no deja crearlo).
  const [proyectos, setProyectos] = useState<ProyectoOpcion[] | null>(null);
  const [proyectoElegido, setProyectoElegido] = useState('');
  const [centroCosto, setCentroCosto] = useState<{ id: string; nombre: string } | null>(null);
  // Centros de costo de Obuma (para el selector del formulario) y el elegido; por defecto el que se detecta por el código de la licitación.
  const [centrosCosto, setCentrosCosto] = useState<Array<{ id: string; nombre: string }>>([]);
  const [centroElegido, setCentroElegido] = useState('');
  const [formasPago, setFormasPago] = useState<FormaPago[]>([]);
  const [cargandoFormasPago, setCargandoFormasPago] = useState(false);
  const [ocAbierta, setOcAbierta] = useState<string | null>(null); // proveedorNombre
  const [formaPagoId, setFormaPagoId] = useState('');
  // Obuma los pide en la OC; sin ellos había que editarla a mano después (OC 4005).
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [metodoDespacho, setMetodoDespacho] = useState('');
  const [incluirFlete, setIncluirFlete] = useState(false);
  const [fleteMonto, setFleteMonto] = useState('');
  const [confirmadoOC, setConfirmadoOC] = useState(false);
  // Pedido explícito del usuario (14-sep-2026, caso real: el encargado de compras ya había creado
  // esta OC directo en Obuma) — segunda casilla, solo aparece cuando hay un posible duplicado real.
  const [confirmadoPeseADuplicado, setConfirmadoPeseADuplicado] = useState(false);
  const [creandoOC, setCreandoOC] = useState<string | null>(null);
  // Productos marcados para cada orden (por proveedor). Si el proveedor no está aquí, se usan los aprobados.
  const [seleccion, setSeleccion] = useState<Record<string, number[]>>({});

  const [estadoProveedorObuma, setEstadoProveedorObuma] = useState<EstadoProveedorObuma>('idle');
  // ¿Cada proveedor ya existe en Obuma? Se consulta apenas se ve la lista (pedido 14-oct-2026: que se vea de entrada si falta crear el proveedor).
  const [estadoProvs, setEstadoProvs] = useState<Record<string, EstadoProveedorObuma>>({});
  const [modalProveedorAbierto, setModalProveedorAbierto] = useState(false);
  const [provInicial, setProvInicial] = useState<Partial<FormProveedor>>({});

  const cargar = useCallback(async () => {
    try {
      const [dApr, dRep, dOC]: any[] = await Promise.all([
        fetchJsonReintento(`/api/compras/${negocioId}/aprobaciones`), fetchJsonReintento(`/api/compras/${negocioId}/reparto`),
        fetchJsonReintento(`/api/compras/${negocioId}/orden-compra-obuma`),
      ]);
      const compraAprobada = dApr.success && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(dApr.compra?.estado);
      setCompraOk(!!compraAprobada);
      // Una compra rápida aprobada por el jefe de ventas también abre esta sección (solo para esos productos), aunque la compra completa no esté aprobada.
      setVisible(!!compraAprobada || (dOC.success && (dOC.proveedores || []).some((pv: any) => (pv.items || []).some((it: any) => it.compraRapida))));
      // Control de gasto: la OC real en Obuma exige AMBAS compuertas (ver compras-oc-obuma.ts) —
      // se avisa acá ANTES de que la persona llene todo el formulario y recién ahí se entere.
      setMargenAprobado(dApr.success && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(dApr.margen?.estado));
      if (dRep.success) { setReparto(dRep.reparto); setRespaldos(dRep.respaldos || []); }
      if (dOC.success) { setProveedoresOC(dOC.proveedores || []); setCentroCosto(dOC.centroCosto || null); setCentrosCosto(dOC.centrosCosto || []); setCentroElegido(prev => prev || dOC.centroCosto?.id || ''); }
    } catch (e: any) {
      toast.error('No se pudo cargar el proceso administrativo', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Las dos partes de la pantalla («oc» y «hitos») son instancias aparte: un pago registrado en una
  // avisa a la otra con el evento 'compras-pagos-oc' para que se recargue.
  const cargarPagos = useCallback(async () => {
    try {
      const d: any = await fetchJsonReintento(`/api/compras/${negocioId}/pagos-oc`);
      if (d.success) { setPagosOc(d.pagos || []); setOcsObuma(d.ocs || []); }
    } catch { /* sin pagos a la vista: no bloquea el resto de la sección */ }
  }, [negocioId]);
  useEffect(() => {
    void cargarPagos();
    const recargar = () => { void cargarPagos(); };
    window.addEventListener('compras-pagos-oc', recargar);
    return () => window.removeEventListener('compras-pagos-oc', recargar);
  }, [cargarPagos]);
  useEffect(() => {
    if (parte === 'oc') return;
    fetchJsonReintento(`/api/compras/${negocioId}/proyecto-obuma`)
      .then((d: any) => setProyectos(d.success ? d.proyectos || [] : []))
      .catch(() => setProyectos([]));
  }, [negocioId, parte]);

  const verificarTodosProveedores = useCallback(async (lista: ProveedorOC[]) => {
    setEstadoProvs(Object.fromEntries(lista.map(p => [p.proveedorNombre, p.proveedorRut ? 'cargando' : 'sin_rut'])) as Record<string, EstadoProveedorObuma>);
    await Promise.all(lista.filter(p => p.proveedorRut).map(async p => {
      let e: EstadoProveedorObuma = 'no_existe';
      try {
        const d = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/proveedor?rut=${encodeURIComponent(p.proveedorRut!)}`).then(r => r.json());
        e = d.success && d.existe ? 'existe' : 'no_existe';
      } catch { /* queda como «no existe»: se puede reintentar al crear */ }
      setEstadoProvs(prev => ({ ...prev, [p.proveedorNombre]: e }));
    }));
  }, [negocioId]);
  useEffect(() => {
    if (parte === 'hitos' || !visible || proveedoresOC.length === 0) return;
    void verificarTodosProveedores(proveedoresOC.filter(p => !p.yaCreada && !p.ocRealObuma));
  }, [visible, parte, proveedoresOC.length, verificarTodosProveedores]);   // eslint-disable-line react-hooks/exhaustive-deps

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
    setOcAbierta(p.proveedorNombre); setFormaPagoId(''); setIncluirFlete(!!p.fleteSugerido); setFleteMonto(p.fleteSugerido ? String(Math.round(p.fleteSugerido)) : ''); setConfirmadoOC(false); setConfirmadoPeseADuplicado(false);
    setEstadoProveedorObuma('idle');
    cargarFormasPago();
    verificarProveedor(p.proveedorRut);
  };

  const abrirModalProveedor = (p: ProveedorOC) => {
    setProvInicial({
      rut: p.proveedorRut || '', razonSocial: p.proveedorNombre,
      giro: p.proveedorGiro || '', contacto: p.proveedorContacto || '',
      direccion: p.proveedorDireccion || '', comuna: p.proveedorComuna || '',
      telefono: p.proveedorTelefono || '', email: p.proveedorEmail || '',
    });
    setModalProveedorAbierto(true);
  };

  const crearOC = async (proveedorNombre: string, hayDuplicado: boolean, productoIds: number[]) => {
    if (!formaPagoId) { toast.error('Falta la forma de pago', 'Elige una antes de crear la orden.'); return; }
    if (!fechaEntrega || !metodoDespacho) { toast.error('Faltan datos de entrega', 'Elige la fecha de entrega y el método de despacho.'); return; }
    if (incluirFlete && !fleteMonto.trim()) { toast.error('Falta el monto del flete', ''); return; }
    if (!confirmadoOC) { toast.error('Falta confirmar', 'Revisa los datos y marca la casilla de confirmación.'); return; }
    if (hayDuplicado && !confirmadoPeseADuplicado) { toast.error('Falta confirmar el posible duplicado', 'Revisa la OC real que encontramos antes de seguir.'); return; }
    setCreandoOC(proveedorNombre);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedorNombre, formaPagoId, incluirFlete, fleteMonto: incluirFlete ? fleteMonto : null, productoIds, centroCostoId: centroElegido || undefined,
          fechaEntrega, metodoDespacho,
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

  const abrirPago = (folio: string) => {
    const oc = ocsObuma.find(o => o.folio === folio);
    const pagos = pagosOc.filter(x => x.ocFolio === folio);
    const pagado = pagos.reduce((s, x) => s + x.monto, 0);
    setPagoAbierto(folio);
    setPagoTipo(pagos.some(x => x.tipo === 'ANTICIPO') ? 'SALDO' : 'PAGO_TOTAL');
    setPagoMonto(oc?.total ? String(Math.max(0, Math.round(oc.total - pagado))) : '');
    setPagoFecha(new Date().toLocaleDateString('sv-SE')); // AAAA-MM-DD en hora local
    setPagoNota(''); setPagoArchivos([]);
  };

  const guardarPago = async (p: ProveedorOC, folio: string) => {
    if (pagoArchivos.length === 0) { toast.error('Falta el comprobante', 'Adjunta el comprobante de la transferencia o del pago.'); return; }
    if (!(parsearMontoCL(pagoMonto) && parsearMontoCL(pagoMonto)! > 0)) { toast.error('Falta el monto', ''); return; }
    setGuardandoPago(true);
    try {
      const fd = new FormData();
      fd.set('ocFolio', folio); fd.set('proveedorNombre', p.proveedorNombre); fd.set('tipo', pagoTipo);
      fd.set('monto', pagoMonto); fd.set('fecha', pagoFecha); fd.set('nota', pagoNota.trim());
      for (const f of pagoArchivos) fd.append('file', f);
      const res = await fetch(`/api/compras/${negocioId}/pagos-oc`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setPagosOc(data.pagos || []); setPagoAbierto(null);
      window.dispatchEvent(new Event('compras-pagos-oc'));
      recargarCompartido();
      toast.success('Pago registrado', `OC ${folio} · ${fmtCLP(parsearMontoCL(pagoMonto))}`);
    } catch (e: any) {
      toast.error('No se pudo registrar el pago', e.message);
    } finally {
      setGuardandoPago(false);
    }
  };

  const quitarPago = async (pago: PagoOc) => {
    if (!window.confirm(`¿Quitar el pago de ${fmtCLP(pago.monto)} de la OC ${pago.ocFolio}? Úsalo solo si se registró por error.`)) return;
    try {
      const res = await fetch(`/api/compras/${negocioId}/pagos-oc?id=${pago.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo quitar');
      setPagosOc(data.pagos || []);
      window.dispatchEvent(new Event('compras-pagos-oc'));
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo quitar el pago', e.message);
    }
  };

  const vincularProyecto = () => {
    const pr = proyectos?.find(x => String(x.folio) === proyectoElegido);
    if (!pr) return;
    void alternar('carpetaProyectoCreada', true, { carpetaProyectoId: String(pr.folio), nota: `Vinculado al proyecto N° ${pr.folio} de Obuma${pr.nombre ? ` — ${pr.nombre}` : ''}.` });
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

  if (loading) return <p className="text-[12.5px] text-zinc-400 px-1">Cargando…</p>;
  if (!reparto) return (
    <div className="text-[13px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="flex-1 min-w-[220px]"><b className="text-zinc-800">No se pudo cargar esta sección.</b> Suele ser un fallo momentáneo de conexión; no significa que falte algo por hacer.</span>
      <button type="button" onClick={() => { setLoading(true); void cargar(); }} className="text-[12.5px] font-semibold text-teal-700 hover:text-teal-900">Reintentar</button>
    </div>
  );
  // Selección de productos de una orden: lo marcado a mano, o por defecto lo aprobado (nunca lo rechazado).
  // Sin las dos compuertas de la compra, por defecto solo entran las compras rápidas aprobadas (lo único que se puede emitir antes).
  const compuertasOk = compraOk && margenAprobado;
  const idsSel = (p: ProveedorOC): number[] => seleccion[p.proveedorNombre] ?? p.items.filter(it => it.aprobado !== false && it.estadoLinea !== 'RECHAZADA' && (compuertasOk || it.compraRapida)).map(it => it.productoId);
  // ¿Se puede emitir esta orden? Con las dos compuertas, siempre; si no, solo si TODO lo marcado es compra rápida aprobada.
  const puedeEmitirOC = (p: ProveedorOC) => compuertasOk || (idsSel(p).length > 0 && idsSel(p).every(id => p.items.find(it => it.productoId === id)?.compraRapida));
  const subtotalSel = (p: ProveedorOC) => p.items.filter(it => idsSel(p).includes(it.productoId)).reduce((s, it) => s + it.subtotal, 0);
  // Las OC de un proveedor (la hecha en Obuma y/o la emitida desde Licitank), para mostrarlas rotuladas.
  const ocsDe = (p: ProveedorOC) => [
    ...(p.ocRealObuma ? [{ folio: p.ocRealObuma.folios.join(', '), origen: 'Hecha en Obuma', estado: p.ocRealObuma.estados.join(' / '), monto: p.ocRealObuma.totalNeto, montoNota: 'neto' }] : []),
    ...(p.yaCreada ? [{ folio: p.yaCreada.folio ?? p.yaCreada.obumaCompraOcId, origen: p.ocRealObuma ? 'Emitida desde Licitank (adicional)' : 'Emitida desde Licitank', estado: p.yaCreada.estado || 'Emitida', monto: p.yaCreada.total, montoNota: 'con IVA' }] : []),
  ];
  const foliosDe = (p: ProveedorOC) => [...(p.ocRealObuma?.folios ?? []), ...(p.yaCreada ? [p.yaCreada.folio ?? p.yaCreada.obumaCompraOcId] : [])];
  const estadoTexto = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const colorEstado = (s: string) => /anulad/i.test(s) ? '#94a3b8' : /factur/i.test(s) ? '#059669' : '#0f766e';
  const alternarItem = (p: ProveedorOC, id: number) => setSeleccion(prev => {
    const act = prev[p.proveedorNombre] ?? idsSel(p);
    return { ...prev, [p.proveedorNombre]: act.includes(id) ? act.filter(x => x !== id) : [...act, id] };
  });
  if (!visible) return parte === 'oc'
    ? <div className="text-[13px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="flex-1 min-w-[220px]"><b className="text-zinc-800">Aún no se pueden emitir órdenes de compra.</b> Primero el jefe de ventas debe aprobar la compra y el margen.</span>
        <button type="button" onClick={() => irAFase('aprobacion')} className="text-[12.5px] font-semibold text-teal-700 hover:text-teal-900">Ir a Aprobación y SKU →</button>
      </div>
    : <div className="text-[13px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
        <b className="text-zinc-800">Aún no hay nada que marcar.</b> El pago, la factura y la carpeta del proyecto aparecen cuando la compra está aprobada (después de «Aprobación y SKU»).
      </div>;

  return (
    <div className="space-y-3">
      {parte === 'oc' && proveedoresOC.length === 0 && (
        <p className="text-[12.5px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">Todavía no hay una forma de comprar elegida: las órdenes de compra salen del escenario elegido en «Costeo y auditoría».</p>
      )}
      {parte !== 'hitos' && proveedoresOC.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100">
            <p className="text-[14px] font-medium text-slate-800 flex items-center gap-1.5">
              <FileText size={15} /> Órdenes de compra a proveedores
              <span className="ml-1 text-xs font-semibold tabular-nums text-slate-500">{proveedoresOC.filter(p => p.yaCreada || p.ocRealObuma).length} de {proveedoresOC.length} emitidas</span>
            </p>
            <p className="text-[12.5px] text-slate-500 mt-0.5">Una orden por proveedor, con lo que le compramos. Para emitirla, el proveedor tiene que existir en Obuma: si no está, lo creas aquí mismo. La orden se crea de verdad en Obuma.</p>
          </div>
          {!compuertasOk && proveedoresOC.some(pv => pv.items.some(it => it.compraRapida)) && (
            <p className="mx-4 mt-2 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5" data-testid="oc-aviso-compra-rapida">
              ✔ Los productos con «compra rápida» ya los aprobó el jefe de ventas: puedes crear su proveedor en Obuma y emitir su orden de compra ya, sin esperar la aprobación de la compra completa.
            </p>
          )}
          {!compuertasOk && !proveedoresOC.some(pv => pv.items.some(it => it.compraRapida)) && (
            <p className="mx-4 mt-2 text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Falta aprobar la compra y el margen — control de gasto: no se puede emitir dinero real en Obuma sin los dos hitos aprobados. Solo se pueden emitir antes las compras rápidas aprobadas por el jefe de ventas.
            </p>
          )}
          <div className="p-3 mt-3 space-y-3 bg-slate-50/70 border-t border-slate-100">
            {proveedoresOC.map(p => {
              const previewFlete = incluirFlete ? parsearMontoCL(fleteMonto) : null;
              const total = subtotalSel(p) + (ocAbierta === p.proveedorNombre && previewFlete ? previewFlete : 0);
              const ocs = ocsDe(p);
              return (
                <div key={p.proveedorNombre} className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-[220px] sm:w-80 flex-shrink-0">
                      <p className="text-[13.5px] font-medium text-slate-900">{p.proveedorNombre}</p>
                      <p className="text-[11px] text-slate-500">{p.proveedorRut && <>RUT {p.proveedorRut} · </>}{p.yaCreada || p.ocRealObuma ? `${p.items.length} producto(s)` : `${idsSel(p).length} de ${p.items.length} productos en la orden`}</p>
                    </div>
                    {/* La OC de este proveedor, rotulada: número, estado, origen y monto. */}
                    <dl className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 min-w-[320px]">
                      <div>
                        <dt className="text-[11px] text-slate-500">Orden de compra</dt>
                        <dd className="mt-0.5">{ocs.length ? ocs.map(o => <div key={o.folio} className="text-[15px] font-bold tabular-nums text-slate-900 leading-tight">OC {o.folio}</div>) : <span className="text-xs font-medium text-amber-700">Sin emitir</span>}</dd>
                      </div>
                      {ocs.length > 0 && (<>
                        <div>
                          <dt className="text-[11px] text-slate-500">Estado</dt>
                          <dd className="mt-0.5">{ocs.map(o => (
                            <div key={o.folio} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap"><span aria-hidden style={{ backgroundColor: colorEstado(o.estado) }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />{estadoTexto(o.estado)}</div>
                          ))}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-slate-500">Origen</dt>
                          <dd className="mt-0.5">{ocs.map(o => <div key={o.folio} className="text-xs text-slate-700">{o.origen}</div>)}</dd>
                        </div>
                      </>)}
                      <div>
                        <dt className="text-[11px] text-slate-500">Monto</dt>
                        <dd className="mt-0.5">{ocs.length
                          ? ocs.map(o => <div key={o.folio} className="text-xs whitespace-nowrap"><b className="tabular-nums text-slate-900">{fmtCLP(o.monto)}</b> <span className="text-slate-500">{o.montoNota}</span></div>)
                          : <div className="text-xs whitespace-nowrap"><b className="tabular-nums text-slate-900">{fmtCLP(subtotalSel(p))}</b> <span className="text-slate-500">neto</span></div>}</dd>
                      </div>
                    </dl>
                    <div className="sm:min-w-[10rem] flex justify-end self-center">
                    {p.ocRealObuma && !p.yaCreada && puedeOperar && ocAbierta !== p.proveedorNombre ? (
                      <button onClick={() => abrirOC(p)} disabled={!puedeEmitirOC(p)} data-testid={`oc-crear-otra-${p.proveedorNombre}`}
                        title="Ya hay una OC de este proveedor en Obuma. Esto crea OTRA orden aparte (compra adicional o de prueba)."
                        className="self-center text-[12px] font-medium text-slate-500 hover:text-teal-700 disabled:opacity-40 whitespace-nowrap">
                        + Otra orden adicional
                      </button>
                    ) : !p.yaCreada && !p.ocRealObuma && puedeOperar && ocAbierta !== p.proveedorNombre ? (
                      <div className="self-center flex-shrink-0 flex items-center gap-2">
                        {p.posibleDuplicadoObuma && (
                          <span title={`Posible OC real ya existente: ${p.posibleDuplicadoObuma.referencia}`}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
                            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-red-600" />Posible duplicado
                          </span>
                        )}
                        <button onClick={() => abrirOC(p)} disabled={idsSel(p).length === 0 || !puedeEmitirOC(p) || estadoProvs[p.proveedorNombre] === 'no_existe' || estadoProvs[p.proveedorNombre] === 'sin_rut'}
                          title={!puedeEmitirOC(p) ? 'Falta aprobar la compra y el margen (o la compra rápida de estos productos)' : estadoProvs[p.proveedorNombre] === 'no_existe' || estadoProvs[p.proveedorNombre] === 'sin_rut' ? 'Primero crea el proveedor en Obuma' : undefined}
                          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed px-3.5 py-2 rounded-lg">
                          <Zap size={13} /> Crear orden de compra
                        </button>
                      </div>
                    ) : null}
                    </div>
                  </div>

                  {!p.yaCreada && !p.ocRealObuma && (() => {
                    const e = estadoProvs[p.proveedorNombre];
                    if (!e || e === 'idle') return null;
                    if (e === 'cargando') return <p className="mt-1.5 text-[12px] text-zinc-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Verificando si el proveedor está en Obuma…</p>;
                    if (e === 'existe') return <p className="mt-1.5 text-[12px] font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle2 size={13} /> El proveedor ya está en Obuma. Puedes crear la orden.</p>;
                    return (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-center gap-3 flex-wrap">
                        <p className="flex-1 min-w-[220px] text-[12.5px] text-amber-900">
                          <b>{e === 'sin_rut' ? 'Este proveedor no tiene RUT en Licitank.' : 'Este proveedor todavía no está en Obuma.'}</b>{' '}
                          {e === 'sin_rut' ? 'Sin RUT no se puede buscar ni crear: complétalo en Proveedores.' : 'Créalo primero y después podrás emitir la orden.'}
                        </p>
                        {puedeOperar && e === 'no_existe' && <button type="button" onClick={() => abrirModalProveedor(p)} className="text-[12.5px] font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg">Crear proveedor en Obuma</button>}
                      </div>
                    );
                  })()}
                  {/* Tabla de productos de la orden: qué se compra, a qué precio, si tiene SKU y quién lo aprobó. Con la orden pendiente se marcan con la casilla; emitida, es solo lectura. */}
                  {(() => {
                    const editable = !p.yaCreada && (!p.ocRealObuma || ocAbierta === p.proveedorNombre);
                    const chipAprob = (it: ItemOC) => it.estadoLinea === 'RECHAZADA' ? conPunto('#dc2626', 'Rechazado')
                      : it.compraRapida ? conPunto('#059669', 'Compra rápida aprobada')
                      : it.estadoLinea === 'APROBADA' || it.aprobado ? conPunto('#059669', 'Aprobado')
                      : conPunto('#d97706', 'Aún sin aprobar');
                    const folios = ocsDe(p).map(o => o.folio).join(' · ');
                    return (
                      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200" data-testid={`oc-productos-${p.proveedorNombre}`}>
                        <table className="w-full text-[12px] min-w-[760px]">
                          <thead>
                            <tr className="text-left text-[11px] font-medium text-slate-500 bg-slate-50 border-b border-slate-200">
                              {editable && <th className="px-3 py-2 w-8" title="Marcado = va en la orden"></th>}
                              <th className="px-2 py-2">OC</th>
                              <th className="px-2 py-2">Producto</th>
                              <th className="px-2 py-2">SKU Obuma</th>
                              <th className="px-2 py-2 text-right">Cant.</th>
                              <th className="px-2 py-2 text-right">Precio neto c/u</th>
                              <th className="px-2 py-2 text-right">Subtotal neto</th>
                              <th className="px-2 py-2">Aprobación</th>
                              {editable && <th className="px-2 py-2 text-right">En la orden</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {p.items.map(it => {
                              const rech = it.estadoLinea === 'RECHAZADA';
                              const marcado = idsSel(p).includes(it.productoId);
                              return (
                                <tr key={it.productoId} className={rech ? 'bg-rose-50/40' : editable && marcado ? 'bg-teal-50/30' : ''}>
                                  {editable && (
                                    <td className="px-3 py-2"><input type="checkbox" checked={marcado} disabled={rech || !puedeOperar} onChange={() => alternarItem(p, it.productoId)} className="accent-teal-600" aria-label={`Incluir ${it.descripcion.split(' - ')[0]} en la orden`} /></td>
                                  )}
                                  <td className="px-2 py-2 whitespace-nowrap">{folios ? <span className="font-bold tabular-nums text-slate-900">{folios}</span> : <span className="text-amber-700 font-medium">Sin emitir</span>}</td>
                                  <td className="px-2 py-2 font-medium text-slate-800">{it.descripcion.split(' - ')[0]}</td>
                                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{it.obumaCodigoComercial ? <span className="text-slate-700">{it.obumaCodigoComercial}</span> : <span className="text-amber-700">sin SKU todavía</span>}</td>
                                  <td className="px-2 py-2 text-right tabular-nums">{it.cantidad}</td>
                                  <td className="px-2 py-2 text-right tabular-nums">{fmtCLP(it.precioUnitario)}</td>
                                  <td className="px-2 py-2 text-right tabular-nums font-semibold">{fmtCLP(it.subtotal)}</td>
                                  <td className="px-2 py-2">{chipAprob(it)}</td>
                                  {editable && <td className={`px-2 py-2 text-right text-[11px] font-semibold ${marcado ? 'text-teal-700' : 'text-zinc-400'}`}>{marcado ? 'Sí, va' : 'No va'}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-50 font-bold text-slate-800 border-t border-slate-200">
                              <td className="px-3 py-2" colSpan={editable ? 6 : 5}>{editable ? `Total de la orden (${idsSel(p).length} de ${p.items.length} productos marcados)` : 'Total'}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{fmtCLP(editable ? subtotalSel(p) : p.subtotal)}</td>
                              <td className="px-2 py-2 text-[11px] font-normal text-zinc-500" colSpan={editable ? 2 : 1}>neto, sin IVA</td>
                            </tr>
                          </tfoot>
                        </table>
                        {editable && <p className="px-3 py-1.5 text-[11px] text-zinc-500 border-t border-zinc-100">Marca con la casilla lo que va en la orden. Se emite <b>una sola orden por proveedor</b>. Un producto sin aprobar o rechazado no puede ir. Cuando esté lista, aprieta «Crear orden de compra».</p>}
                      </div>
                    );
                  })()}

                  {/* Factura y pagos de cada OC del proveedor (21-oct-2026): la factura llega sola desde
                      Obuma; los pagos se registran aquí, cada uno con su comprobante. */}
                  {foliosDe(p).length > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-200 divide-y divide-slate-100" data-testid={`oc-pagos-${p.proveedorNombre}`}>
                      {foliosDe(p).map(folio => {
                        const oc = ocsObuma.find(o => o.folio === folio);
                        const pagos = pagosOc.filter(x => x.ocFolio === folio);
                        const pagado = pagos.reduce((s, x) => s + x.monto, 0);
                        const pagada = pagos.some(x => x.tipo !== 'ANTICIPO');
                        return (
                          <div key={folio} className="px-3 py-2.5">
                            <dl className="grid grid-cols-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_9rem] gap-x-4 gap-y-2">
                              <div>
                                <dt className="text-[11px] text-slate-500">Orden</dt>
                                <dd className="mt-0.5 text-xs font-bold tabular-nums text-slate-900">OC {folio}</dd>
                              </div>
                              <div>
                                <dt className="text-[11px] text-slate-500">Factura del proveedor</dt>
                                <dd className="mt-0.5 text-xs text-slate-700">
                                  {oc?.facturas.length ? oc.facturas.map(f => (
                                    <div key={f.folio} className="flex items-center gap-1.5 flex-wrap">
                                      {conPunto('#059669', `N° ${f.folio}`)}
                                      {f.fecha && <span className="text-slate-500">{fechaCorta(f.fecha)}</span>}
                                      {f.total != null && <span className="tabular-nums text-slate-500">{fmtCLP(f.total)}</span>}
                                      {f.s3Link && <a href={f.s3Link} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-700 hover:text-teal-900">Ver XML</a>}
                                    </div>
                                  )) : /factur/i.test(oc?.estado || '') ? conPunto('#059669', 'Facturada en Obuma')
                                    : conPunto('#94a3b8', 'Todavía no factura')}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-[11px] text-slate-500">Pago</dt>
                                <dd className="mt-0.5 flex items-center gap-2 flex-wrap">
                                  {pagada ? conPunto('#059669', 'Pagada') : pagos.length ? conPunto('#d97706', 'Con anticipo') : conPunto('#94a3b8', 'Sin pagar')}
                                  <span className="text-xs text-slate-500"><b className="tabular-nums text-slate-800">{fmtCLP(pagado)}</b>{oc?.total != null && <> de {fmtCLP(oc.total)} con IVA</>}</span>
                                </dd>
                              </div>
                              <div className="self-center sm:text-right">
                                {puedeOperar && !pagada && pagoAbierto !== folio && (
                                  <button type="button" onClick={() => abrirPago(folio)} data-testid={`oc-registrar-pago-${folio}`}
                                    className="text-[12px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-3 py-1.5 rounded-lg whitespace-nowrap">
                                    Registrar pago
                                  </button>
                                )}
                              </div>
                            </dl>
                            {pagos.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {pagos.map(x => (
                                  <li key={x.id} className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
                                    <span className="font-medium text-slate-800">{TIPOS_PAGO.find(t => t.key === x.tipo)?.label}</span>
                                    <b className="tabular-nums text-slate-900">{fmtCLP(x.monto)}</b>
                                    <span>{fechaCorta(x.fecha)}</span>
                                    {(x.adjuntos ?? [{ url: x.archivoUrl, nombre: x.archivoNombre }]).map((adj, i) => (
                                      <a key={i} href={adj.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-teal-700 hover:text-teal-900">
                                        <Paperclip size={11} /> {adj.nombre || 'comprobante'}
                                      </a>
                                    ))}
                                    {x.nota && <span className="text-slate-500">· {x.nota}</span>}
                                    {puedeOperar && <button type="button" onClick={() => quitarPago(x)} className="ml-auto text-[11px] text-slate-400 hover:text-red-600">Quitar</button>}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {pagoAbierto === folio && (
                              <div className="mt-2.5 rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2.5 max-w-xl" data-testid={`oc-form-pago-${folio}`}>
                                <p className="text-xs font-medium text-slate-800">Registrar pago de la OC {folio} · {p.proveedorNombre}</p>
                                <div className="flex gap-4 flex-wrap">
                                  {TIPOS_PAGO.map(t => (
                                    <label key={t.key} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                                      <input type="radio" name={`tipo-${folio}`} checked={pagoTipo === t.key} onChange={() => setPagoTipo(t.key)} className="accent-teal-700" />{t.label}
                                    </label>
                                  ))}
                                </div>
                                <p className="text-[11px] text-slate-500">{TIPOS_PAGO.find(t => t.key === pagoTipo)?.ayuda}</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="text-[11px] text-slate-500">Monto pagado (con IVA)
                                    <input value={pagoMonto} onChange={e => setPagoMonto(e.target.value)} inputMode="numeric"
                                      className="mt-0.5 block w-full text-xs text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-600 bg-white" />
                                  </label>
                                  <label className="text-[11px] text-slate-500">Fecha del pago
                                    <input type="date" value={pagoFecha} onChange={e => setPagoFecha(e.target.value)}
                                      className="mt-0.5 block w-full text-xs text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-600 bg-white" />
                                  </label>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  <label className="block">Comprobantes del pago (al menos uno; puedes agregar varios)
                                    {/* Cada selección se suma a la lista; value='' deja volver a elegir el mismo archivo. */}
                                    <input type="file" multiple accept="application/pdf,image/*"
                                      onChange={e => { const nuevos = Array.from(e.target.files ?? []); setPagoArchivos(prev => [...prev, ...nuevos]); e.target.value = ''; }}
                                      className="mt-0.5 block text-xs text-transparent file:mr-2 file:text-xs file:font-medium file:text-teal-800 file:bg-teal-50 file:border-0 file:rounded-lg file:px-2.5 file:py-1" />
                                  </label>
                                  {pagoArchivos.length > 0 && (
                                    <ul className="mt-1.5 space-y-1">
                                      {pagoArchivos.map((f, i) => (
                                        <li key={i} className="flex items-center gap-1.5 text-xs text-slate-700">
                                          <Paperclip size={11} className="text-slate-400 shrink-0" />
                                          <span className="truncate">{f.name}</span>
                                          <button type="button" onClick={() => setPagoArchivos(prev => prev.filter((_, j) => j !== i))}
                                            className="ml-auto text-[11px] text-slate-400 hover:text-red-600">Quitar</button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                <label className="block text-[11px] text-slate-500">Nota (opcional)
                                  <input value={pagoNota} onChange={e => setPagoNota(e.target.value)} placeholder="Ej: transferencia N° 123 desde la cuenta Santander"
                                    className="mt-0.5 block w-full text-xs text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-600 bg-white" />
                                </label>
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => guardarPago(p, folio)} disabled={guardandoPago}
                                    className="text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                                    {guardandoPago && <Loader2 size={12} className="animate-spin" />} Guardar pago
                                  </button>
                                  <button type="button" onClick={() => setPagoAbierto(null)} className="text-[12px] font-medium text-slate-500 hover:text-slate-800">Cancelar</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

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
                      {p.ocRealObuma && (
                        <div className="bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-2 space-y-1" data-testid="oc-aviso-adicional">
                          <p className="text-[11px] font-semibold text-rose-700">⚠ Este proveedor ya tiene la OC {p.ocRealObuma.folios.join(', ')} en Obuma ({fmtCLP(p.ocRealObuma.totalNeto)} neto). Esto crea OTRA orden aparte, de verdad, en Obuma.</p>
                          <label className="flex items-center gap-1.5 text-[10.5px] text-rose-700 pt-0.5">
                            <input type="checkbox" checked={confirmadoPeseADuplicado} onChange={e => setConfirmadoPeseADuplicado(e.target.checked)} className="accent-rose-600" />
                            Entiendo que ya existe esa OC: esta es una compra adicional o una prueba, igual quiero crearla
                          </label>
                        </div>
                      )}
                      {p.posibleDuplicadoObuma && !p.ocRealObuma && (
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

                      <div className="flex gap-1.5">
                        <label className="flex-1 text-[10.5px] text-zinc-500">Fecha de entrega
                          <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} data-testid="oc-fecha-entrega"
                            className="mt-0.5 w-full text-[11.5px] text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500" />
                        </label>
                        <label className="flex-1 text-[10.5px] text-zinc-500">Método de despacho
                          <select value={metodoDespacho} onChange={e => setMetodoDespacho(e.target.value)} data-testid="oc-metodo-despacho"
                            className="mt-0.5 w-full text-[11.5px] text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                            <option value="">Elegir…</option>
                            {METODOS_DESPACHO_OBUMA.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                      </div>

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
                        <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Entrega: </span>{fechaEntrega ? fechaEntrega.split('-').reverse().join('-') : <span className="text-rose-500">falta fecha</span>} · {metodoDespacho || <span className="text-rose-500">falta método de despacho</span>}</p>
                        <p className="text-[11px] text-zinc-700">
                          <span className="text-zinc-400">Centro de costo: </span>
                          <select value={centroElegido} onChange={e => setCentroElegido(e.target.value)} data-testid="oc-centro-costo"
                            className="mt-0.5 w-full max-w-[520px] text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                            <option value="">{centrosCosto.length === 0 ? 'Sin centros de costo leídos de Obuma' : 'Sin centro de costo'}</option>
                            {centrosCosto.map(c => <option key={c.id} value={c.id}>{c.nombre}{centroCosto?.id === c.id ? ' (el de esta licitación)' : ''}</option>)}
                          </select>
                          <span className="block text-[10.5px] text-amber-700 mt-0.5">Se manda a Obuma, pero la API de Obuma hasta ahora no lo guarda (probado): si la orden queda «Ninguno», elígelo a mano en Obuma.</span>
                        </p>
                        <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Mercadería ({idsSel(p).length} producto(s)): </span>{fmtCLP(subtotalSel(p))}</p>
                        {p.items.some(it => idsSel(p).includes(it.productoId) && it.aprobado === false) && <p className="text-[11px] font-semibold text-amber-700">⚠ Incluye productos que aún no están aprobados.</p>}
                        {incluirFlete && <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Flete: </span>{previewFlete != null ? fmtCLP(previewFlete) : <span className="text-rose-500">monto inválido</span>}</p>}
                        <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Neto total: </span><b>{fmtCLP(total)}</b> <span className="text-zinc-400">+ IVA</span></p>
                        <label className="flex items-center gap-1.5 text-[10.5px] text-indigo-700 pt-0.5">
                          <input type="checkbox" checked={confirmadoOC} onChange={e => setConfirmadoOC(e.target.checked)} className="accent-indigo-600" />
                          Confirmo estos datos — se va a crear de verdad en Obuma
                        </label>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button onClick={() => crearOC(p.proveedorNombre, !!p.posibleDuplicadoObuma || !!p.ocRealObuma, idsSel(p))}
                          disabled={creandoOC === p.proveedorNombre || idsSel(p).length === 0 || !formaPagoId || !fechaEntrega || !metodoDespacho || !confirmadoOC || !puedeEmitirOC(p) || ((!!p.posibleDuplicadoObuma || !!p.ocRealObuma) && !confirmadoPeseADuplicado)}
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

      {parte !== 'oc' && (() => {
        // Avance administrativo (rehecho 21-oct-2026): ya no son 6 casillas a marcar a mano. Las OC,
        // los pagos y las facturas se cuentan solos desde cada orden; solo el proyecto de Obuma se vincula aquí.
        const todosFolios = proveedoresOC.flatMap(foliosDe);
        const conOc = proveedoresOC.filter(p => p.yaCreada || p.ocRealObuma).length;
        const pagadas = todosFolios.filter(f => pagosOc.some(x => x.ocFolio === f && x.tipo !== 'ANTICIPO')).length;
        const facturadas = todosFolios.filter(f => { const o = ocsObuma.find(x => x.folio === f); return !!o && (o.facturas.length > 0 || /factur/i.test(o.estado || '')); }).length;
        const totalPagado = pagosOc.reduce((s, x) => s + x.monto, 0);
        const proyNoAplica = respaldos.find(r => r.hito === 'carpetaProyectoCreada')?.estado === 'NO_APLICA';
        const proyVinculado = reparto.carpetaProyectoCreadaAt ? proyectos?.find(x => String(x.folio) === reparto.carpetaProyectoId) : null;
        const color = (listo: boolean, alguno: boolean) => listo ? '#059669' : alguno ? '#d97706' : '#94a3b8';
        const fila = (titulo: string, estado: React.ReactNode, ayuda: React.ReactNode, accion?: React.ReactNode, extra?: React.ReactNode) => (
          <div className="px-4 py-3">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="w-48 flex-shrink-0">
                <p className="text-[13px] font-medium text-slate-900">{titulo}</p>
                <div className="mt-1">{estado}</div>
              </div>
              <p className="flex-1 min-w-[220px] text-xs text-slate-500 leading-snug">{ayuda}</p>
              {accion && <div className="flex-shrink-0 flex items-center gap-2">{accion}</div>}
            </div>
            {extra}
          </div>
        );
        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden" data-testid="avance-administrativo">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <p className="text-[13px] font-medium text-slate-800 flex items-center gap-1.5"><ClipboardList size={14} /> Avance administrativo</p>
              <p className="mt-0.5 text-xs text-slate-500">Se completa solo a medida que avanzan las órdenes. Lo único que se hace aquí es vincular el proyecto de Obuma.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {fila('Órdenes de compra',
                conPunto(color(conOc === proveedoresOC.length && conOc > 0, conOc > 0), `${conOc} de ${proveedoresOC.length} emitidas`),
                'Una por proveedor. Se emiten arriba; las que se hicieron directo en Obuma aparecen solas.',
                conOc > 0 ? <button type="button" onClick={verOc} className="text-[12px] font-medium text-teal-700 hover:text-teal-900">Ver órdenes</button> : undefined)}
              {fila('Pagos a proveedores',
                <div>{conPunto(color(pagadas === todosFolios.length && pagadas > 0, pagosOc.length > 0), `${pagadas} de ${todosFolios.length} pagadas`)}<p className="mt-0.5 text-xs text-slate-500"><b className="tabular-nums text-slate-800">{fmtCLP(totalPagado)}</b> pagado</p></div>,
                <>Cada pago se registra en su orden, arriba, con el botón <b className="font-medium text-slate-700">«Registrar pago»</b>: eliges si es anticipo, pago total o saldo, y adjuntas el comprobante.</>)}
              {fila('Facturas de los proveedores',
                conPunto(color(facturadas === todosFolios.length && facturadas > 0, facturadas > 0), `${facturadas} de ${todosFolios.length} facturadas`),
                'No se registran a mano: cuando el proveedor factura y la factura entra a Obuma, aparece sola en su orden (con el XML).')}
              {fila('Proyecto en Obuma',
                reparto.carpetaProyectoCreadaAt ? conPunto('#059669', `Proyecto N° ${reparto.carpetaProyectoId ?? '—'}`)
                  : proyNoAplica ? conPunto('#94a3b8', 'No aplica') : conPunto('#d97706', 'Sin vincular'),
                <>
                  El proyecto de Obuma junta todas las compras y gastos de esta licitación, para saber cuánto costó de verdad.
                  {reparto.carpetaProyectoCreadaAt && proyVinculado?.nombre && <span className="block mt-0.5 text-slate-700">{proyVinculado.nombre}{proyVinculado.estado && ` · ${proyVinculado.estado}`}</span>}
                  {!reparto.carpetaProyectoCreadaAt && !proyNoAplica && <span className="block mt-0.5">Obuma no deja crearlo desde aquí: si todavía no existe, créalo en Obuma y vuelve; la lista se actualiza sola cada 30 minutos.</span>}
                  {proyNoAplica && <span className="block mt-0.5 italic">Motivo: {respaldos.find(r => r.hito === 'carpetaProyectoCreada')?.nota}</span>}
                </>,
                puedeOperar && (reparto.carpetaProyectoCreadaAt || proyNoAplica)
                  ? <button type="button" onClick={() => alternar('carpetaProyectoCreada', false)} disabled={guardando === 'carpetaProyectoCreada'}
                      className="text-[12px] font-medium text-slate-500 hover:text-slate-800">{proyNoAplica ? 'Deshacer' : 'Cambiar'}</button>
                  : undefined,
                puedeOperar && !reparto.carpetaProyectoCreadaAt && !proyNoAplica && (
                  hitoAbierto === 'carpetaProyectoCreada' ? (
                    <div className="mt-2.5 sm:ml-52 space-y-1.5 bg-slate-50 border border-slate-200 rounded-lg p-2.5 max-w-md">
                      <p className="text-[11px] text-slate-600">¿Por qué esta compra no tiene proyecto en Obuma?</p>
                      <textarea rows={2} value={notaHito} onChange={e => setNotaHito(e.target.value)} placeholder="Ej: compra chica, se carga al proyecto general"
                        className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-600" />
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={guardarRespaldo} disabled={guardandoRespaldo || !notaHito.trim()}
                          className="text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg">Guardar</button>
                        <button type="button" onClick={cerrarRespaldo} className="text-[12px] font-medium text-slate-500 hover:text-slate-800">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 sm:ml-52 flex items-center gap-2 flex-wrap">
                      <select value={proyectoElegido} onChange={e => setProyectoElegido(e.target.value)} data-testid="proyecto-obuma-select"
                        className="min-w-0 w-full sm:w-[420px] text-xs border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-600 bg-white">
                        <option value="">{proyectos == null ? 'Cargando proyectos de Obuma…' : 'Elige el proyecto de Obuma…'}</option>
                        {(proyectos ?? []).some(x => x.sugerido) && (
                          <optgroup label="Mencionan esta licitación">
                            {(proyectos ?? []).filter(x => x.sugerido).map(x => <option key={x.folio} value={x.folio}>N° {x.folio} · {x.nombre}{x.cliente ? ` · ${x.cliente}` : ''}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="Todos los proyectos">
                          {(proyectos ?? []).filter(x => !x.sugerido).map(x => <option key={x.folio} value={x.folio}>N° {x.folio} · {x.nombre}{x.estado ? ` · ${x.estado}` : ''}</option>)}
                        </optgroup>
                      </select>
                      <button type="button" onClick={vincularProyecto} disabled={!proyectoElegido || guardando === 'carpetaProyectoCreada'}
                        className="text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-40 px-3 py-1.5 rounded-lg">Vincular</button>
                      <button type="button" onClick={() => abrirRespaldo('carpetaProyectoCreada', true)}
                        className="text-[12px] font-medium text-slate-500 hover:text-slate-800">No aplica</button>
                    </div>
                  )
                ))}
            </div>
          </div>
        );
      })()}

      {modalProveedorAbierto && (
        <CrearProveedorObumaModal negocioId={negocioId} inicial={provInicial} onCerrar={() => setModalProveedorAbierto(false)}
          onCreado={(creado) => {
            setModalProveedorAbierto(false); setEstadoProveedorObuma('existe');
            const norm = (r: string) => r.replace(/[^0-9kK]/g, '').toLowerCase();
            const prov = proveedoresOC.find(x => x.proveedorRut && norm(x.proveedorRut) === norm(creado.rut));
            if (prov) setEstadoProvs(prev => ({ ...prev, [prov.proveedorNombre]: 'existe' }));
          }} />
      )}

      {verOcAbierto && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 print:static print:bg-white print:p-0" onClick={() => setVerOcAbierto(false)}>
          <div className="bg-white rounded-xl border border-zinc-200 shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto print:max-h-none print:max-w-none print:shadow-none print:border-0" onClick={e => e.stopPropagation()}>
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
