'use client';

// CONTENIDO de la ficha de un negocio en Compras — UNA SOLA pantalla (11-sep-2026, quinta vuelta
// del mismo pedido). El usuario probó la versión con URL propia por submódulo y no era lo que
// quería: "quiero que todo el sistema de compras sea un flujo, ir paso a paso... el flujo puede
// estar arriba e ir cambiando por las pestañas, sin pinchar y navegar a otra pantalla". Confirmado
// explícito: una sola URL, stepper arriba, el contenido de abajo cambia al instante con estado
// local — no `<Link>`, no rutas por submódulo. Costeo y Auditoría van JUNTAS otra vez (se habían
// separado por pedido propio del usuario y luego pidió deshacerlo: "yo no pedí eso").
import DocumentosCompraCard from './DocumentosCompraCard';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { SubirPdfOficialOC } from '@/app/components/SubirPdfOficialOC';
import { useCosteoFlotante } from '@/app/components/CosteoFlotanteContext';
import { DocumentosLicitacionCard } from '@/app/negocios/[id]/DocumentosLicitacionCard';
import { AuditoriaAgenteNegocioCard } from '@/app/negocios/[id]/AuditoriaAgenteNegocioCard';
import { ProductosCompraCard } from '@/app/negocios/[id]/ProductosCompraCard';
import { AuditorComprasCard } from '@/app/negocios/[id]/AuditorComprasCard';
import { AuditorCosteoCard } from '@/app/negocios/[id]/AuditorCosteoCard';
import { AprobacionesCompraCard } from '@/app/negocios/[id]/AprobacionesCompraCard';
import { RepartoAdminCard } from '@/app/negocios/[id]/RepartoAdminCard';
import { OcPropiaCard } from '@/app/negocios/[id]/OcPropiaCard';
import { ObumaHubCard } from '@/app/negocios/[id]/ObumaHubCard';
import { irAFase, enfocarProducto } from './comprasNavegacion';
import { ResumenGastosCard } from '@/app/negocios/[id]/ResumenGastosCard';
import { ResumenComparativoCard } from '@/app/negocios/[id]/ResumenComparativoCard';
import { FichasTecnicasCard } from '@/app/negocios/[id]/FichasTecnicasCard';
import { CostoRealCard } from '@/app/negocios/[id]/CostoRealCard';
import { ImportacionCard } from '@/app/negocios/[id]/ImportacionCard';
import { ModalidadRetiroCard } from '@/app/negocios/[id]/ModalidadRetiroCard';
import { GastosCard } from '@/app/negocios/[id]/GastosCard';
import { ServiciosConSkuCard } from '@/app/negocios/[id]/ServiciosConSkuCard';
import { RelojEntregaCard } from '@/app/negocios/[id]/RelojEntregaCard';
import { RELOJ_ENTREGA_ACTIVO } from '@/app/lib/compras-reloj-activo';
import { IncidenciasCard } from '@/app/negocios/[id]/IncidenciasCard';
import { EntregaCard } from '@/app/negocios/[id]/EntregaCard';
import { ResumenCierreCard } from '@/app/negocios/[id]/ResumenCierreCard';
import { FacturaVentaCard } from '@/app/negocios/[id]/FacturaVentaCard';
import { OcMiniaturas } from '@/app/negocios/[id]/OcMiniaturas';
import { PostventaCard, useHayPostventa } from '@/app/negocios/[id]/PostventaCard';
import { FracasoCard } from '@/app/negocios/[id]/FracasoCard';
import { ActividadComprasCard } from '@/app/negocios/[id]/ActividadComprasCard';
import { GanttComprasCard } from '@/app/negocios/[id]/GanttComprasCard';
import { TareasComprasCard } from './TareasComprasCard';
import { Seccion } from './Seccion';
import { Pestanas, irAPestana } from './Pestanas';
import { FranjaCompra } from './FranjaCompra';
import { siguientePaso, type SiguientePaso } from '@/app/lib/compras-siguiente-paso';
import { useCompras, fmtCLP, fmtFecha, type OrdenCompra } from './ComprasContext';
import { CoencargadosCompras } from './CoencargadosCompras';
import { ResumenObumaModal } from './ResumenObumaModal';
import { IconBolt as ObumaIcon, IconShoppingCart as ShoppingCart, IconLoader2 as Loader2, IconUserPlus as UserPlus, IconClock as Clock, IconAlertTriangle as AlertTriangle, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconCurrencyDollar as DollarSign, IconFileAlert as FileWarning, IconBuilding as Building2, IconFileText as FileText, IconDeviceFloppy as Save, IconClipboardList as ClipboardList, IconRefresh as RefreshCw, IconBolt as Zap, IconExternalLink as ExternalLink, IconArrowUpRight as ArrowUpRight, IconCalculator as Calculator, IconClipboardCheck as ClipboardCheck, IconPackage as Package, IconTruck as Truck, IconHistory as History, IconGauge as Gauge, IconWallet as Wallet, IconCalendarTime as CalendarTime, IconHourglassHigh as Hourglass, IconMail as Mail, IconPhone as Phone, IconUserCircle as UserCircle, IconCheck as Check, IconArrowRight as ArrowRight, IconTarget as Target } from '@tabler/icons-react';

// Gantt SALIÓ del stepper (pedido explícito, 17-sep-2026: "es aparte de todo ese flujo y es lo
// primero que se debe ver") — ahora es una tarjeta propia, arriba de todo, no una pestaña más.
// Documentos entró en su lugar como pestaña (antes era tarjeta fija, ocupaba mucho espacio arriba).
type Fase = 'tareas' | 'costeo' | 'aprobacion' | 'compra' | 'entrega' | 'obuma' | 'documentos' | 'actividad';
const FASES: { key: Fase; label: string; icon: typeof ClipboardList; descripcion: string; secundaria?: boolean }[] = [
  { key: 'tareas', label: 'Tareas', icon: ClipboardList, descripcion: 'Lo primero: las tareas del proyecto con su plazo. El plazo de entrega y las incidencias están siempre a la vista en la franja de arriba.' },
  { key: 'costeo', label: 'Costeo y auditoría', icon: Calculator, descripcion: 'Aquí se cotiza: verifica el costo de cada producto, carga las cotizaciones de los proveedores y compara para elegir la mejor compra.' },
  { key: 'aprobacion', label: 'Aprobación y SKU', icon: ClipboardCheck, descripcion: 'El jefe de ventas aprueba la compra y el margen (mínimo 20 %). Después se crea el código (SKU) de lo que se va a comprar.' },
  { key: 'compra', label: 'Compra y logística', icon: Package, descripcion: 'Lo que pasa después de aprobar: cómo se retira la mercadería, órdenes de compra a proveedores y facturas, importación si corresponde y los gastos del proyecto.' },
  { key: 'entrega', label: 'Entrega y cierre', icon: Truck, descripcion: 'Plazo de entrega, incidencias, entrega al cliente, acta firmada, costo real final, postventa y cierre del proyecto.' },
  { key: 'obuma', label: 'Obuma', icon: ObumaIcon, descripcion: 'Un solo lugar para lo que se crea en Obuma: primero el proveedor, después el SKU de cada producto y por último las órdenes de compra.', secundaria: true },
  { key: 'documentos', label: 'Documentos', icon: FileText, descripcion: 'Bases y acta de la licitación, más la revisión automática del agente sobre este negocio.', secundaria: true },
  { key: 'actividad', label: 'Actividad', icon: History, descripcion: 'Línea de tiempo del proyecto: qué se hizo día a día, desde que se ganó hasta ahora.', secundaria: true },
];

interface LineaGanada { correlativo: number | null; producto: string | null; descripcion: string | null; cantidad: number | null; unidad: string | null; montoUnitario: number | null }

export function ComprasChrome({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const flot = useCosteoFlotante();
  const {
    loading, error, asignacion, tareas, hitosGantt, candidatos, resumenFases, licitacionNombre, licitacionOrganismo, licitacionCodigoActual, ocMp, facturacionActa,
    recargar, puedeOperar, puedeCotizar, esJefeDeVentas, esAdministracion, esBodega, esAdmin, soloDesdeAprobacion,
  } = useCompras();

  const [faseElegida, setFaseActiva] = useState<Fase>('tareas');
  // El Auditor de Compras no ve Tareas ni Costeo: arranca (y cae) en Aprobación y SKU.
  const faseActiva: Fase = soloDesdeAprobacion && (faseElegida === 'tareas' || faseElegida === 'costeo') ? 'aprobacion' : faseElegida;
  // El botón «Obuma» abre un resumen de lo creado en Obuma desde Licitank (ya no lleva a otra pantalla).
  const [resumenObumaAbierto, setResumenObumaAbierto] = useState(false);
  const hayPostventa = useHayPostventa(negocioId);
  // Otras tarjetas pueden mandar al encargado a otro paso (ej. «Ir a crear proveedor» desde una compra directa).
  useEffect(() => {
    const h = (e: Event) => {
      const fase = (e as CustomEvent<{ fase: Fase }>).detail?.fase;
      if (!fase) return;
      setFaseActiva(fase);
      setTimeout(() => document.getElementById('compras-flujo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    };
    window.addEventListener('compras:ir', h);
    return () => window.removeEventListener('compras:ir', h);
  }, []);
  // Enlaces de avisos (correo, campana, aviso central): /compras/<id>?fase=aprobacion abre directo el paso donde hay que corregir.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fase = q.get('fase');
    if (fase && ['tareas', 'costeo', 'aprobacion', 'compra', 'entrega', 'obuma', 'documentos', 'actividad'].includes(fase)) {
      irAFase(fase as Fase);
      const pid = Number(q.get('producto'));
      if (q.get('pestana') || pid) enfocarProducto(q.get('pestana'), pid > 0 ? pid : null);
    }
  }, [loading]);
  const [asignando, setAsignando] = useState(false);
  const [candidatoElegido, setCandidatoElegido] = useState('');
  // Reasignar (pedido explícito del usuario, 15-sep-2026): solo admin puede cambiar un encargado
  // que ya tiene otro asignado — misma restricción que la lista de Compras (app/compras/page.tsx).
  const [reasignando, setReasignando] = useState(false);
  const [visorOC, setVisorOC] = useState<VisorDoc | null>(null);
  const [cargandoPdfOC, setCargandoPdfOC] = useState(false);
  // Abre el PDF en el visor de la app (proxy inline): el link directo a R2 no se podía ver. Si el cron
  // todavía no lo bajó, se pide ahora a Mercado Público.
  const verPdfOC = async () => {
    if (!ocMp?.codigo) return;
    setCargandoPdfOC(true);
    try {
      let url = ocMp.pdfUrl;
      if (!url) {
        const r = await fetch('/api/ordenes-compra/pdf', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigoOC: ocMp.codigo }),
        });
        const d = await r.json().catch(() => null);
        if (!d?.success || !d.url) throw new Error(d?.error || 'No se pudo obtener el PDF');
        url = d.url;
      }
      setVisorOC({ nombre: `OC_${ocMp.codigo}.pdf`, url: url! });
    } catch (e: any) {
      toast.error('No se pudo abrir el PDF', e.message || 'Intenta de nuevo');
    } finally {
      setCargandoPdfOC(false);
    }
  };
  const [ocAbierta, setOcAbierta] = useState(false);
  const [ocForm, setOcForm] = useState({ numero: '', emitidaAt: '', aceptadaAt: '', monto: '', difiere: false, observacion: '' });
  const [guardandoOC, setGuardandoOC] = useState(false);
  const [buscandoOC, setBuscandoOC] = useState(false);
  const [resumenAbierto, setResumenAbierto] = useState(true);
  // "Precio de venta ganado" clicable: las líneas que el acta de MP nos adjudicó (lectura en vivo de la
  // caché del acta, no la foto del resumen — que no distingue qué línea se ganó ni se actualiza sola).
  const [ganadasAbierto, setGanadasAbierto] = useState(false);
  const [ganadas, setGanadas] = useState<LineaGanada[] | null>(null);
  const [perdidasActa, setPerdidasActa] = useState<Array<{ correlativo: number; proveedor: string | null; montoUnitario: number | null }>>([]);
  const [cargandoGanadas, setCargandoGanadas] = useState(false);
  const alternarGanadas = async () => {
    const abrir = !ganadasAbierto;
    setGanadasAbierto(abrir);
    if (!abrir) return;
    setCargandoGanadas(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/productos`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo leer el acta');
      setGanadas(data.ganadas || []); setPerdidasActa(data.perdidas || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar las líneas ganadas', e.message);
      setGanadasAbierto(false);
    } finally { setCargandoGanadas(false); }
  };
  const [regenerando, setRegenerando] = useState(false);

  // El formulario de OC se precarga cuando llega/cambia la asignación (no al tipear).
  useEffect(() => {
    if (!asignacion) return;
    const oc = asignacion.ordenCompra;
    setOcForm({
      numero: oc.numero || '', emitidaAt: oc.emitidaAt || '', aceptadaAt: oc.aceptadaAt || '',
      monto: oc.monto != null ? String(oc.monto) : '', difiere: !!oc.difiere, observacion: oc.observacion || '',
    });
  }, [asignacion?.ordenCompra]);

  const asignar = async () => {
    if (!candidatoElegido) return;
    setAsignando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/asignar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encargadoId: Number(candidatoElegido) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo asignar');
      toast.success(
        asignacion?.asignadoA ? 'Encargado cambiado' : 'Encargado asignado',
        asignacion?.asignadoA ? undefined : 'Se sembraron las tareas de Compras.',
      );
      setReasignando(false);
      setCandidatoElegido('');
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo asignar', e.message);
    } finally {
      setAsignando(false);
    }
  };

  const regenerarResumen = async () => {
    setRegenerando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/resumen`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      const faltan: string[] = data.faltantes || [];
      toast.success('Resumen ejecutivo actualizado', faltan.length ? `Quedan ${faltan.length} dato(s) sin resolver.` : 'Quedó completo.');
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo actualizar el resumen', e.message);
    } finally {
      setRegenerando(false);
    }
  };

  const buscarOC = async () => {
    setBuscandoOC(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra/buscar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo buscar');
      if (!data.encontrada) {
        toast.error('No se encontró todavía', 'Ni guardada de antes ni en Mercado Público ahora mismo — puedes registrarla a mano o volver a intentar más tarde.');
      } else {
        toast.success(`Orden de compra encontrada — N° ${data.oc.numero}`, data.viaVivo ? 'Se trajo en vivo desde Mercado Público.' : 'Ya estaba guardada, se enganchó con este negocio.');
        await recargar();
      }
    } catch (e: any) {
      toast.error('No se pudo buscar la orden de compra', e.message);
    } finally {
      setBuscandoOC(false);
    }
  };

  const guardarOC = async () => {
    setGuardandoOC(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero: ocForm.numero.trim() || null,
          emitidaAt: ocForm.emitidaAt || null,
          aceptadaAt: ocForm.aceptadaAt || null,
          monto: ocForm.monto.trim() === '' ? null : Number(ocForm.monto.replace(/[^\d.-]/g, '')),
          difiere: ocForm.difiere,
          observacion: ocForm.observacion.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Orden de compra registrada', data.tareaAceptacionCerrada ? 'La tarea "Aceptación de la orden de compra" quedó hecha.' : undefined);
      setOcAbierta(false);
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo registrar la orden de compra', e.message);
    } finally {
      setGuardandoOC(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  }
  if (error) return <Banner variante="error" accion={{ label: 'Reintentar', onClick: recargar }}>{error}</Banner>;
  if (!asignacion) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <ShoppingCart size={28} className="text-zinc-300" />
        <p className="text-[13.5px] font-semibold text-zinc-500">Compras todavía no se abre para este negocio</p>
        <p className="text-[12px] text-zinc-400 max-w-sm">Se abre automáticamente apenas Mercado Público confirma que ganamos.</p>
      </div>
    );
  }

  const r = asignacion.resumen;
  const oc: OrdenCompra = asignacion.ordenCompra;
  const vencimientoPasado = new Date(asignacion.vencimientoAsignacionAt.replace(' ', 'T')).getTime() < Date.now();

  // "¿Qué hago ahora?": un solo pendiente, el más urgente (lógica en app/lib/compras-siguiente-paso.ts).
  const paso: SiguientePaso = siguientePaso({
    asignado: !!asignacion.asignadoA, plazoAsignacionVencido: vencimientoPasado, esJefeDeVentas,
    ocAceptada: !!oc.aceptadaAt || tareas.some(t => t.catalogoClave === 'aceptar_oc' && t.estado === 'HECHA'),
    tareas: tareas.map(t => ({ catalogoClave: t.catalogoClave, titulo: t.titulo, estado: t.estado, vencida: t.vencida })),
    fases: resumenFases ? {
      tareasVencidas: resumenFases.tareas.vencidas, productosSinCotizacion: resumenFases.costeo.productosSinCotizacion,
      escenarioElegido: resumenFases.costeo.escenarioElegido, compraAprobada: resumenFases.aprobacion.compraAprobada, margenAprobado: resumenFases.aprobacion.margenAprobado, compraRechazada: resumenFases.aprobacion.compraRechazada, margenRechazado: resumenFases.aprobacion.margenRechazado,
      compuertasPendientes: resumenFases.aprobacion.compuertasPendientes, hitosAdminPendientes: resumenFases.compra.hitosAdminPendientes,
      incidenciasAbiertas: resumenFases.entrega.incidenciasAbiertas, relojVencido: resumenFases.entrega.relojVencido,
    } : null,
  });
  const irAlPaso = () => {
    if (paso.fase) {
      setFaseActiva(paso.fase);
      setTimeout(() => document.getElementById('compras-flujo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } else if (paso.ancla) {
      document.getElementById(`compras-${paso.ancla}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  const pendientesN = tareas.filter(t => t.estado !== 'HECHA').length;
  const hitoPendiente = (clave: string) => tareas.some(t => t.catalogoClave === clave && t.estado !== 'HECHA');
  // Estado REAL de cada paso (pedido del 17-sep: no quedar en verde si aún hay pendientes).
  const calcFase = (key: Fase): { badge: number | null; estado: 'alerta' | 'pendiente' | 'ok' | 'neutral' } => {
    if (key === 'tareas') {
      const vencidas = resumenFases?.tareas.vencidas ?? 0; const incidencias = resumenFases?.entrega.incidenciasAbiertas ?? 0;
      return { badge: vencidas || incidencias || pendientesN || null, estado: vencidas > 0 || incidencias > 0 ? 'alerta' : pendientesN > 0 ? 'pendiente' : tareas.length > 0 ? 'ok' : 'neutral' };
    }
    if (!resumenFases) return { badge: null, estado: 'neutral' };
    // ✓ solo si ocurrió de verdad: todos los productos cotizados Y una forma de comprar elegida; compra Y margen aprobados.
    if (key === 'costeo') { const c = resumenFases.costeo; return { badge: c.productosSinCotizacion || null, estado: c.productosSinCotizacion > 0 || !c.escenarioElegido ? 'pendiente' : 'ok' }; }
    if (key === 'aprobacion') { const a = resumenFases.aprobacion; return { badge: a.compuertasPendientes || null, estado: a.compuertasPendientes > 0 || !(a.compraAprobada && a.margenAprobado) ? 'pendiente' : 'ok' }; }
    if (key === 'compra') { const h = resumenFases.compra.hitosAdminPendientes; return { badge: h || null, estado: h == null ? 'neutral' : h > 0 ? 'pendiente' : 'ok' }; }
    if (key === 'entrega') return { badge: resumenFases.entrega.relojVencido ? 0 : null, estado: resumenFases.entrega.relojVencido ? 'alerta' : 'neutral' };  // sin dato de "entregado": no se marca ✓ por no estar vencido
    return { badge: null, estado: 'neutral' };
  };

  const pasosFlujo = FASES.filter(f => !f.secundaria && !(soloDesdeAprobacion && (f.key === 'tareas' || f.key === 'costeo')));
  const irAFaseFlujo = (k: Fase) => { setFaseActiva(k); setTimeout(() => document.getElementById('compras-flujo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };

  return (
    <div className="space-y-3 @container">
      {/* Cabecera + encargado en UNA tarjeta (antes dos cajas apiladas: en un notebook se comían la
          primera pantalla antes de llegar al flujo). */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-tarjeta overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${asignacion.urgente ? 'bg-rose-50' : 'bg-teal-50'}`}>
          <ShoppingCart size={18} className={asignacion.urgente ? 'text-rose-600' : 'text-teal-600'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900 leading-tight">
              {licitacionNombre || `Negocio #${negocioId}`}
            </h2>
            {asignacion.urgente && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                <AlertTriangle size={11} /> Cadena de Urgencia
              </span>
            )}
          </div>
          <p className="text-[12px] text-zinc-500 flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5">
            <span className="font-medium text-zinc-700 tabular-nums">{asignacion.licitacionCodigo}</span>
            {licitacionOrganismo && <span>· {licitacionOrganismo}</span>}
            <span>· Ganado {fmtFecha(asignacion.ganadoAt)}</span>
            <Link href={`/negocios/${negocioId}`} className="inline-flex items-center gap-0.5 text-teal-700 hover:text-teal-800 font-semibold">
              Ver licitación <ArrowUpRight size={11} />
            </Link>
          </p>
        </div>
        <button
          onClick={() => flot.abrir(negocioId, asignacion.licitacionCodigo)}
          className="flex-shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-2 rounded-lg transition-colors"
          title="Abre el costeo digital del proyecto (misma burbuja flotante que en la pestaña Costeo de la licitación)"
        >
          <Calculator size={14} /> Ver costeo
        </button>
      </div>

      {/* Encargado: chico, una sola línea (pedido explícito, 17-sep-2026: "en encargado debe ser
          pequeño") — ahora es la fila de abajo de la tarjeta de cabecera. */}
      <div id="compras-encargado" className="bg-zinc-50/70 border-t border-zinc-100 px-4 py-2 flex items-center gap-2 flex-wrap text-[12px] scroll-mt-4">
        <span className="text-[11px] font-medium text-zinc-400 flex-shrink-0">Encargado</span>
        {asignacion.asignadoA && !reasignando ? (
          <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
            <span className="font-bold text-zinc-800">{asignacion.asignadoNombre}</span>
            <span className="text-zinc-400 text-[11px]">— {fmtFecha(asignacion.asignadoAt)}{asignacion.asignadoPor == null ? ' · automático' : ''}</span>
            {esAdmin && (
              <button onClick={() => setReasignando(true)}
                className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Cambiar</button>
            )}
            <CoencargadosCompras negocioId={negocioId} principalId={asignacion.asignadoA} coencargados={asignacion.coencargados || []} candidatos={candidatos}
              puedeEditar={esAdmin || esJefeDeVentas} onCambio={recargar} />
          </div>
        ) : asignacion.asignadoA && reasignando ? (
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <Select
              value={candidatoElegido} onChange={setCandidatoElegido}
              placeholder="Nuevo encargado…" minWidth={180}
              options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga} tarea${c.carga === 1 ? '' : 's'} activa${c.carga === 1 ? '' : 's'})` }))}
            />
            <button onClick={asignar} disabled={!candidatoElegido || asignando}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
              {asignando ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Cambiar
            </button>
            <button onClick={() => { setReasignando(false); setCandidatoElegido(''); }} disabled={asignando}
              className="text-[11.5px] text-zinc-500 hover:text-zinc-700">Cancelar</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <span className="text-[11.5px] text-zinc-500 flex items-center gap-1">
              <Clock size={12} className={vencimientoPasado ? 'text-rose-500' : 'text-amber-500'} />
              {vencimientoPasado
                ? 'Plazo vencido — se asignará automáticamente al de menor carga.'
                : `Sin asignar · vence ${fmtFecha(asignacion.vencimientoAsignacionAt)}`}
            </span>
            {esJefeDeVentas && (
              <>
                <Select
                  value={candidatoElegido} onChange={setCandidatoElegido}
                  placeholder="Elegir encargado…" minWidth={180}
                  options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga} tarea${c.carga === 1 ? '' : 's'} activa${c.carga === 1 ? '' : 's'})` }))}
                />
                <button onClick={asignar} disabled={!candidatoElegido || asignando}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
                  {asignando ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Asignar
                </button>
              </>
            )}
          </div>
        )}
      </div>
      </div>

      {/* SIGUIENTE PASO: lo primero que se lee. Un solo pendiente, con un botón que lleva a donde se hace. */}
      {/* Se unió con el reloj de entrega y las incidencias (antes: banner alto + chips aparte, con la
          incidencia repetida dos veces). Superficie blanca; el color va solo en ícono, reloj y botón.
          El detalle largo queda en el tooltip. */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-tarjeta px-3.5 py-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          paso.tono === 'alerta' ? 'bg-rose-50 text-rose-600' : paso.tono === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {paso.tono === 'ok' ? <Check size={18} /> : paso.tono === 'alerta' ? <AlertTriangle size={18} /> : <Target size={18} />}
        </span>
        <div className="flex-1 min-w-[200px]" title={paso.detalle}>
          <p className="text-[11px] text-zinc-400 leading-none">{paso.tono === 'ok' ? 'Todo en orden' : 'Siguiente paso'}</p>
          <p className="text-[14px] font-semibold tracking-tight text-zinc-900 leading-snug mt-1 truncate">{paso.titulo}</p>
        </div>
        <FranjaCompra compacto ocultarIncidencias={/incidencia/i.test(paso.titulo)} negocioId={negocioId} incidenciasAbiertas={resumenFases?.entrega.incidenciasAbiertas ?? 0}
          version={tareas.filter(t => t.estado === 'HECHA').length}
          onIrEntrega={() => { setFaseActiva('entrega'); setTimeout(() => document.getElementById('compras-flujo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}
          onIrIncidencias={() => { setFaseActiva('entrega'); setTimeout(() => { irAPestana('incidencias'); document.getElementById('compras-incidencias')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120); }} />
        <button type="button" onClick={irAlPaso}
          className={`inline-flex items-center gap-1.5 text-[13px] font-semibold text-white px-3.5 py-2 rounded-lg transition-colors ${
            paso.tono === 'alerta' ? 'bg-rose-600 hover:bg-rose-700' : paso.tono === 'ok' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-teal-600 hover:bg-teal-700'}`}>
          {paso.boton} <ArrowRight size={15} />
        </button>
      </div>

      {/* Gantt, aparte del flujo por pestañas (pedido explícito, 17-sep-2026): "es aparte de todo ese
          flujo y es lo primero que se debe ver". */}
      <GanttComprasCard tareas={tareas} hitos={hitosGantt} />

      {/* Resumen ejecutivo, justo después del Gantt (pedido explícito, 17-sep-2026: "despues el
          resumen que es super importante") — antes quedaba escondido abajo de todo. */}
      {r && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors">
            <button onClick={() => setResumenAbierto(v => !v)} className="flex-1 flex items-center justify-between text-left">
              <p className="text-[12.5px] font-bold text-zinc-700">Resumen ejecutivo</p>
            </button>
            <div className="flex items-center gap-2 pl-2">
              {puedeOperar && (
                <button onClick={regenerarResumen} disabled={regenerando}
                  title="Vuelve a leer el costeo, los contactos del cliente y los plazos de las bases. El resumen no se actualiza solo: es una foto del momento de ganar."
                  className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-teal-700 disabled:opacity-50">
                  {regenerando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Volver a armar
                </button>
              )}
              <button onClick={() => setResumenAbierto(v => !v)}>
                {resumenAbierto ? <ChevronUp size={15} className="text-zinc-400" /> : <ChevronDown size={15} className="text-zinc-400" />}
              </button>
            </div>
          </div>
          {resumenAbierto && (() => {
            // Más detallado y colorido (pedido explícito, 17-sep-2026) — cada dato tiene su propio
            // color e ícono en vez de tarjetas grises idénticas, y el margen ahora se ve como barra
            // contra el piso del 20% (spec §10.3) en vez de solo un número.
            const margenOk = r.margenPrevisto != null && r.margenPrevisto >= 20;
            const margenBajo = r.margenPrevisto != null && r.margenPrevisto < 20;
            const excedePresupuesto = r.presupuestoProyecto != null && r.montoCosteado != null && r.montoCosteado > r.presupuestoProyecto;
            return (
            <div className="border-t border-zinc-100 px-4 py-3 space-y-3">
              {/* Tres cifras principales — grandes, a color. Monto costeado va acá (pedido explícito,
                  22-sep-2026: es la cifra más importante para el encargado de Compras) en el lugar
                  que antes tenía Presupuesto del proyecto, que baja a las secundarias. Los montos
                  se guardan NETOS (ver construirResumenEjecutivoCompras en compras.ts) — se
                  especifica también el equivalente con IVA (×1,19) para no tener que calcularlo a mano. */}
              <div className="grid grid-cols-1 @xl:grid-cols-3 gap-3">
                <button type="button" onClick={alternarGanadas} aria-expanded={ganadasAbierto} title="Ver las líneas que se ganaron"
                  className="group text-left rounded-xl px-3.5 py-3 bg-white border border-zinc-200 hover:border-emerald-400 hover:shadow-sm transition cursor-pointer">
                  <p className="text-[12px] font-semibold text-zinc-500 flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><DollarSign size={14} /></span> Precio de venta ganado
                    <span className="ml-auto text-[11.5px] font-semibold text-emerald-700 flex items-center gap-0.5 opacity-80 group-hover:opacity-100">{ganadasAbierto ? 'Ocultar' : 'Ver líneas'} {ganadasAbierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
                  </p>
                  <p className="text-[21px] leading-tight font-extrabold text-zinc-900 mt-1 tabular-nums">{fmtCLP(r.montoNuestro)} <span className="text-[12px] font-semibold text-zinc-400">neto</span></p>
                  {r.montoNuestro != null && <p className="text-[12px] text-zinc-500 mt-0.5 tabular-nums">{fmtCLP(Math.round(r.montoNuestro * 1.19))} con IVA</p>}
                </button>
                <div className={`rounded-xl px-3.5 py-3 border ${excedePresupuesto ? 'bg-amber-50/60 border-amber-300' : 'bg-white border-zinc-200'}`}>
                  <p className="text-[12px] font-semibold text-zinc-500 flex items-center gap-1.5">
                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${excedePresupuesto ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}><Calculator size={14} /></span> Monto costeado
                    {excedePresupuesto && <span className="ml-auto text-[11px] font-bold text-amber-700 flex items-center gap-1"><AlertTriangle size={12} /> Sobre el presupuesto</span>}
                  </p>
                  <p className="text-[21px] leading-tight font-extrabold text-zinc-900 mt-1 tabular-nums">
                    {r.existeCosteo ? <>{fmtCLP(r.montoCosteado)} <span className="text-[12px] font-semibold text-zinc-400">neto</span></> : <span className="text-[18px] text-zinc-400">Sin costeo</span>}
                  </p>
                  {r.existeCosteo && r.montoCosteado != null && <p className="text-[12px] text-zinc-500 mt-0.5 tabular-nums">{fmtCLP(Math.round(r.montoCosteado * 1.19))} con IVA</p>}
                </div>
                <div className={`rounded-xl px-3.5 py-3 border ${margenBajo ? 'bg-rose-50/60 border-rose-300' : 'bg-white border-zinc-200'}`}>
                  <p className="text-[12px] font-semibold text-zinc-500 flex items-center gap-1.5">
                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${margenBajo ? 'bg-rose-100 text-rose-600' : 'bg-teal-50 text-teal-600'}`}><Gauge size={14} /></span> Margen previsto
                    {margenBajo && <span className="ml-auto text-[11px] font-bold text-rose-700 flex items-center gap-1"><AlertTriangle size={12} /> Bajo el piso</span>}
                  </p>
                  <p className={`text-[21px] leading-tight font-extrabold mt-1 tabular-nums ${margenBajo ? 'text-rose-700' : 'text-zinc-900'}`}>
                    {r.margenPrevisto != null ? `${r.margenPrevisto}%` : <span className="text-[18px] text-zinc-400">Sin costeo</span>}
                  </p>
                  {r.margenPrevisto != null && (
                    <div className="mt-2.5">
                      <div className="relative h-1.5 rounded-full bg-zinc-100">
                        <div className={`h-full rounded-full ${margenOk ? 'bg-teal-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(4, Math.min(100, (r.margenPrevisto / 40) * 100))}%` }} />
                        <span className="absolute -top-0.5 h-2.5 w-px bg-zinc-400" style={{ left: '50%' }} title="Piso del 20 %" />
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1">Piso del 20 %</p>
                    </div>
                  )}
                </div>
              </div>

              {ganadasAbierto && (
                <div className="rounded-xl border border-emerald-200 bg-white overflow-hidden">
                  <p className="px-3 py-2 text-[11px] font-bold text-emerald-800 bg-emerald-50 border-b border-emerald-100">
                    Líneas que se ganaron según el acta de Mercado Público
                  </p>
                  {cargandoGanadas ? (
                    <div className="flex items-center justify-center py-5"><Loader2 size={16} className="animate-spin text-emerald-600" /></div>
                  ) : !ganadas || ganadas.length === 0 ? (
                    <p className="px-3 py-3 text-[11.5px] text-zinc-500">El acta todavía no detalla las líneas adjudicadas a nosotros (puede ser una adjudicación global o el acta aún no está en el sistema).</p>
                  ) : (
                    <div className="divide-y divide-zinc-100">
                      {ganadas.map((g, i) => {
                        const total = (g.montoUnitario ?? 0) * (g.cantidad ?? 1);
                        return (
                          <div key={g.correlativo ?? i} className="px-3 py-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-zinc-800">
                                {g.correlativo != null && <span className="text-emerald-700">Línea {g.correlativo} · </span>}{g.descripcion || g.producto || 'Producto sin nombre'}
                              </p>
                              <p className="text-[10.5px] text-zinc-400">
                                {[g.producto && g.descripcion && g.producto !== g.descripcion ? `Rubro MP: ${g.producto}` : null,
                                  g.cantidad != null ? `${g.cantidad}${g.unidad ? ` ${g.unidad}` : ''}` : null,
                                  g.montoUnitario != null ? `${fmtCLP(g.montoUnitario)} unitario neto` : null].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <p className="text-[12px] font-bold text-emerald-800 flex-shrink-0">{fmtCLP(total)}</p>
                          </div>
                        );
                      })}
                      <div className="px-3 py-2 flex items-center justify-between bg-emerald-50/50">
                        <p className="text-[11px] font-bold text-emerald-800">{ganadas.length} línea(s) ganada(s)</p>
                        <p className="text-[12px] font-extrabold text-emerald-800">{fmtCLP(ganadas.reduce((s, g) => s + (g.montoUnitario ?? 0) * (g.cantidad ?? 1), 0))} neto</p>
                      </div>
                    </div>
                  )}
                  {perdidasActa.length > 0 && (
                    <p className="px-3 py-2 text-[10.5px] text-zinc-500 bg-zinc-50 border-t border-zinc-100">
                      No ganadas (adjudicadas a otro proveedor): {perdidasActa.map(l => `Línea ${l.correlativo}${l.proveedor ? ` → ${l.proveedor}` : ''}`).join(' · ')}.
                    </p>
                  )}
                </div>
              )}

              {/* Datos del proyecto: una sola tarjeta con columnas etiqueta/valor (antes 4 cajas de colores distintos). */}
              <div className="rounded-xl border border-zinc-200 bg-zinc-100 overflow-hidden grid grid-cols-1 @xl:grid-cols-6 gap-px">
                {([
                  { icono: <Building2 size={13} />, etiqueta: 'Empresa adjudicada', valor: r.empresaNombre || '—', extra: r.empresaRut ? `RUT ${r.empresaRut}` : null },
                  { icono: <UserPlus size={13} />, etiqueta: 'Asistente comercial', valor: r.responsableNombre || '—', extra: null },
                  { icono: <Wallet size={13} />, etiqueta: 'Presupuesto del proyecto', valor: r.presupuestoProyecto != null ? fmtCLP(r.presupuestoProyecto) : '—', extra: r.presupuestoProyecto != null ? `neto · ${fmtCLP(Math.round(r.presupuestoProyecto * 1.19))} con IVA` : null },
                  { icono: <CalendarTime size={13} />, etiqueta: 'Plazo de entrega ofertado', valor: r.plazoEntregaOfertado || '—', extra: null },
                  { icono: <Hourglass size={13} />, etiqueta: 'Desde cuándo corre', valor: r.hitoInicioPlazo || '—', extra: null },
                ] as Array<{ icono: React.ReactNode; etiqueta: string; valor: string; extra: string | null }>).map((d, i) => (
                  // 3 arriba (empresa, asistente, presupuesto) y 2 abajo (plazo, desde cuándo corre: texto largo).
                  <div key={d.etiqueta} className={`bg-white px-4 py-3 min-w-0 ${i < 3 ? '@xl:col-span-2' : '@xl:col-span-3'}`}>
                    <p className="text-[11.5px] font-medium text-zinc-500 flex items-center gap-1.5">{d.icono} {d.etiqueta}</p>
                    <p className="text-[14px] font-semibold text-zinc-900 mt-1 leading-snug break-words">{d.valor}</p>
                    {d.extra && <p className="text-[11.5px] text-zinc-500 mt-0.5">{d.extra}</p>}
                  </div>
                ))}
              </div>

              {/* Condiciones críticas de las bases: una sola franja delgada, tres celdas. El valor va en
                  negrita; ámbar solo cuando las bases exigen algo. */}
              <div className="grid grid-cols-1 @xl:grid-cols-3 gap-px rounded-lg border border-amber-300 bg-amber-200 overflow-hidden">
                {([
                  { rotulo: 'Boleta de fiel cumplimiento', valor: r.requiereBoletaFielCumplimiento ? 'Sí' : 'No', exige: !!r.requiereBoletaFielCumplimiento },
                  { rotulo: 'Firma de contrato', valor: r.requiereFirmaContrato ? 'Sí' : 'No', exige: !!r.requiereFirmaContrato },
                  { rotulo: 'Plazo para aceptar la OC', valor: r.plazoAceptacionOC, exige: true },
                ] as Array<{ rotulo: string; valor: string; exige: boolean }>).map(c => (
                  <div key={c.rotulo} className={`px-3 py-2.5 min-w-0 flex items-baseline gap-2 ${c.exige ? 'bg-amber-50' : 'bg-white'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 translate-y-[-1px] ${c.exige ? 'bg-amber-500' : 'bg-zinc-300'}`} />
                    <p className={`text-[12.5px] min-w-0 ${c.exige ? 'text-amber-900/80' : 'text-zinc-500'}`}>{c.rotulo}: <b className={`text-[13.5px] font-semibold ${c.exige ? 'text-amber-950' : 'text-zinc-500'}`}>{c.valor}</b></p>
                  </div>
                ))}
              </div>

              {r.contactosCliente && (
                <div className="rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="px-4 py-3 bg-zinc-50/70 border-b border-zinc-100">
                    <p className="text-[13px] font-semibold text-zinc-800 flex items-center gap-1.5"><Building2 size={14} className="text-slate-400" /> Contactos del cliente</p>
                    <p className="text-[12.5px] text-zinc-600 mt-0.5">
                      {[r.contactosCliente.organismo, r.contactosCliente.unidad].filter(Boolean).join(' · ')}
                      {(r.contactosCliente.rut || facturacionActa?.rut) && <span className="text-zinc-500"> · RUT {r.contactosCliente.rut || facturacionActa?.rut}</span>}
                    </p>
                    {[r.contactosCliente.direccion, r.contactosCliente.comuna, r.contactosCliente.region].filter(Boolean).length > 0 && (
                      <p className="text-[11.5px] text-zinc-400">{[r.contactosCliente.direccion, r.contactosCliente.comuna, r.contactosCliente.region].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 @xl:grid-cols-3 @xl:divide-x divide-y @xl:divide-y-0 divide-zinc-100">
                    {([
                      { rol: 'Contraparte', nombre: r.contactosCliente.usuarioNombre, datos: [r.contactosCliente.usuarioCargo, r.contactosCliente.usuarioTelefono, r.contactosCliente.usuarioEmail] },
                      { rol: 'Responsable del contrato', nombre: r.contactosCliente.responsableContratoNombre, datos: [r.contactosCliente.responsableContratoEmail, r.contactosCliente.responsableContratoFono] },
                      { rol: 'Responsable de pagos', nombre: r.contactosCliente.responsablePagoNombre, datos: [r.contactosCliente.responsablePagoEmail] },
                    ] as const).map(({ rol, nombre, datos }) => nombre ? (
                      <div key={rol} className="px-4 py-3 min-w-0">
                        <p className="text-[11.5px] font-medium text-zinc-500 flex items-center gap-1.5"><UserCircle size={13} /> {rol}</p>
                        <p className="text-[13px] font-semibold text-zinc-900 mt-1">{nombre}</p>
                        {datos.filter(Boolean).map(d => (
                          <p key={String(d)} className="text-[12px] text-zinc-500 break-words flex items-center gap-1.5 mt-0.5">
                            {String(d).includes('@') ? <Mail size={12} className="flex-shrink-0 text-zinc-400" /> : /\d/.test(String(d)) ? <Phone size={12} className="flex-shrink-0 text-zinc-400" /> : null}
                            {d}
                          </p>
                        ))}
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}
            </div>
            );
          })()}
        </div>
      )}

      {/* Orden de compra del cliente, junto al resumen ejecutivo (pedido explícito, 17-sep-2026:
          "eso metelo a resumen igual") — antes quedaba abajo de todo, separada. */}
      <DocumentViewerModal doc={visorOC} onClose={() => setVisorOC(null)} />
      <div id="compras-oc" className="bg-white rounded-xl border border-zinc-200 shadow-tarjeta overflow-hidden scroll-mt-4">
        <div>
        <div className="flex items-start justify-between gap-3 px-4 py-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-zinc-800 flex items-center gap-2 flex-wrap">
              <FileText size={15} className="text-slate-400" /> Orden de compra del cliente
              {oc.origen === 'mp' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700">
                  <Zap size={11} /> Llegó sola desde Mercado Público
                </span>
              )}
            </p>
            {oc.numero || oc.aceptadaAt ? (
              <>
                <dl className="mt-2.5 grid grid-cols-2 @2xl:grid-cols-5 gap-x-6 gap-y-2.5">
                  {oc.numero && <div><dt className="text-[11px] text-zinc-500">N° de la orden</dt><dd className="text-[13px] font-semibold text-zinc-900 tabular-nums mt-0.5">{oc.numero}</dd></div>}
                  {oc.monto != null && <div><dt className="text-[11px] text-zinc-500">Monto con IVA</dt><dd className="text-[13px] font-semibold text-zinc-900 tabular-nums mt-0.5">{fmtCLP(oc.monto)}</dd></div>}
                  {oc.emitidaAt && <div><dt className="text-[11px] text-zinc-500">Emitida</dt><dd className="text-[13px] font-semibold text-zinc-900 tabular-nums mt-0.5">{oc.emitidaAt}</dd></div>}
                  <div><dt className="text-[11px] text-zinc-500">Aceptada</dt>
                    <dd className={`text-[13px] font-semibold tabular-nums mt-0.5 ${oc.aceptadaAt ? 'text-emerald-700' : 'text-amber-600'}`}>{oc.aceptadaAt || 'Todavía no'}</dd></div>
                  {oc.estadoMp && <div><dt className="text-[11px] text-zinc-500">Estado en Mercado Público</dt><dd className="text-[13px] font-semibold text-zinc-900 mt-0.5">{oc.estadoMp}</dd></div>}
                </dl>
                <div className="flex items-center gap-x-4 gap-y-1 mt-3 flex-wrap">
                  {ocMp?.url && (
                    <a href={ocMp.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap">
                      <ExternalLink size={13} /> Ver en Mercado Público
                    </a>
                  )}
                  {ocMp?.pdfUrl && (
                    <button type="button" onClick={verPdfOC} disabled={cargandoPdfOC}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 whitespace-nowrap">
                      {cargandoPdfOC ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} PDF de la orden
                    </button>
                  )}
                  {ocMp?.codigo && ocMp.url && puedeOperar && (
                    <SubirPdfOficialOC codigoOC={ocMp.codigo} urlFicha={ocMp.url}
                      onSubido={url => { recargar(); setVisorOC({ nombre: `OC_${ocMp.codigo}.pdf`, url }); }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap" />
                  )}
                </div>
              </>
            ) : (
              <p className="text-[12px] text-zinc-400 mt-1">
                Todavía no llega. El sistema la busca solo en Mercado Público y la carga acá apenas aparece.
              </p>
            )}
          </div>
          {puedeOperar && (
            <div className="flex-shrink-0 flex items-center gap-3">
              {oc.origen !== 'mp' && (
                <button onClick={buscarOC} disabled={buscandoOC}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50">
                  {buscandoOC ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  Buscar automáticamente
                </button>
              )}
              <button onClick={() => setOcAbierta(v => !v)}
                className="text-[12px] font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap">
                {ocAbierta ? 'Cerrar' : oc.origen === 'mp' ? 'Corregir a mano' : (oc.numero || oc.aceptadaAt ? 'Editar' : 'Registrar a mano')}
              </button>
            </div>
          )}
        </div>

        {(() => {
          // Manda la adjudicación (acta "Organismo Demandante" + contactos del resumen), que existe
          // desde que se gana. La OC no reemplaza nada: solo completa lo que falte (giro, forma de
          // pago, despacho…). Pedido del usuario, 21-oct-2026.
          const cc = asignacion?.resumen?.contactosCliente ?? null;
          const fa = facturacionActa;
          const f = ocMp?.facturacion ?? null;
          if (!fa?.razonSocial && !fa?.rut && !cc && !f) return null;
          const unir = (...xs: Array<string | null | undefined>) => xs.filter(Boolean).join(', ') || null;
          const filas: Array<[string, string | null]> = [
            ['Razón social', fa?.razonSocial || cc?.organismo || f?.razonSocial || null],
            ['RUT', fa?.rut || cc?.rut || f?.rut || null],
            ['Giro', f?.giro ?? null],
            ['Unidad', fa?.unidad || cc?.unidad || null],
            ['Dirección', unir(fa?.direccion || cc?.direccion, fa?.comuna || cc?.comuna, fa?.ciudad || cc?.region)
              || unir(f?.direccion, f?.comuna, f?.region)],
            ['Contacto', [cc?.usuarioNombre, cc?.usuarioCargo].filter(Boolean).join(' — ')
              || [f?.contactoNombre, f?.contactoCargo].filter(Boolean).join(' — ') || null],
            ['Teléfono', cc?.usuarioTelefono || f?.contactoFono || null],
            ['Correo', cc?.usuarioEmail || f?.contactoMail || null],
            ['Forma de pago', f?.formaPago ?? null],
            ['Despacho', f?.direccionDespacho ?? null],
          ];
          const origen = f ? 'según la adjudicación, completado con la OC' : 'según la adjudicación';
          const rutPlano = (x: string | null | undefined) => (x || '').replace(/[^\dkK]/g, '').toUpperCase();
          const rutMostrado = filas.find(([k]) => k === 'RUT')?.[1];
          const otroTitular = fa?.facturaRut && rutPlano(fa.facturaRut) !== rutPlano(rutMostrado) ? fa : null;
          return (
            <div className="border-t border-zinc-100 px-4 py-3 space-y-2.5">
              {otroTitular && (
                <Banner variante="warning">
                  <span className="font-semibold">La factura va a nombre de {otroTitular.facturaANombre}, RUT {otroTitular.facturaRut}</span>, no del comprador. Lo dice la resolución de adjudicación.
                  {otroTitular.facturaCita && <span className="block mt-0.5 text-[11px] italic">“{otroTitular.facturaCita}…”</span>}
                </Banner>
              )}
              <div>
                <p className="text-[13px] font-semibold text-zinc-800">Datos para facturar <span className="text-[11px] font-normal text-zinc-400">· {origen}</span></p>
                {/* Tres grupos con título (antes una grilla corrida: la dirección quedaba entre el giro y el correo). */}
                <div className="mt-3 grid grid-cols-1 @3xl:grid-cols-3 gap-4 @3xl:gap-0 @3xl:divide-x divide-zinc-100">
                  {([
                    ['Cliente', ['Razón social', 'RUT', 'Giro', 'Unidad']],
                    ['Contacto', ['Contacto', 'Teléfono', 'Correo']],
                    ['Dirección y pago', ['Dirección', 'Despacho', 'Forma de pago']],
                  ] as Array<[string, string[]]>).map(([titulo, claves], gi) => {
                    const items = filas.filter(([k, v]) => claves.includes(k) && v);
                    if (items.length === 0) return null;
                    return (
                      <section key={titulo} className={`min-w-0 ${gi > 0 ? '@3xl:pl-5' : ''} ${gi < 2 ? '@3xl:pr-5' : ''}`}>
                        <h4 className="text-[12px] font-semibold text-teal-700 pb-1.5 mb-2 border-b border-zinc-100">{titulo}</h4>
                        <dl className="space-y-2.5">
                          {items.map(([k, v]) => (
                            <div key={k} className="min-w-0">
                              <dt className="text-[11px] text-zinc-500">{k}</dt>
                              <dd className="text-[13px] font-medium text-zinc-900 break-words mt-0.5">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}
        </div>

        {oc.difiere && (
          <div className="px-4 pb-3">
            <Banner variante="warning">
              <span className="font-semibold">La orden de compra difiere de lo ofertado.</span> Manda la OC, no nuestra oferta: revisa alcance y monto antes de comprar.
              {oc.observacion && <span className="block mt-0.5">{oc.observacion}</span>}
            </Banner>
          </div>
        )}

        {ocAbierta && puedeOperar && (
          <div className="border-t border-zinc-100 px-4 py-3 space-y-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <label className="text-[11px] font-semibold text-zinc-500">
                N° de la OC
                <input value={ocForm.numero} onChange={e => setOcForm(f => ({ ...f, numero: e.target.value }))}
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
              <label className="text-[11px] font-semibold text-zinc-500">
                Emitida
                <input type="date" value={ocForm.emitidaAt} onChange={e => setOcForm(f => ({ ...f, emitidaAt: e.target.value }))}
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
              <label className="text-[11px] font-semibold text-zinc-500">
                Aceptada en el portal
                <input type="date" value={ocForm.aceptadaAt} onChange={e => setOcForm(f => ({ ...f, aceptadaAt: e.target.value }))}
                  title="Al anotarla, la tarea 'Aceptación de la orden de compra' queda hecha sola."
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
              <label className="text-[11px] font-semibold text-zinc-500">
                Monto de la OC
                <input inputMode="numeric" value={ocForm.monto} onChange={e => setOcForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="Neto o total, como venga"
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
            </div>
            <label className="flex items-start gap-2 text-[12px] text-zinc-700">
              <input type="checkbox" checked={ocForm.difiere} onChange={e => setOcForm(f => ({ ...f, difiere: e.target.checked }))}
                className="mt-0.5 accent-teal-600" />
              <span>
                <span className="font-semibold">El alcance o el monto difiere de lo que ofertamos.</span>
                <span className="text-zinc-400"> Caso típico: se ofertaron 10 productos y el presupuesto alcanzó para 5. Manda la OC.</span>
              </span>
            </label>
            <textarea value={ocForm.observacion} onChange={e => setOcForm(f => ({ ...f, observacion: e.target.value }))}
              rows={2} placeholder="En qué difiere, o cualquier nota de la orden de compra…"
              className="w-full text-[12.5px] text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
            <div className="flex items-center gap-2">
              <button onClick={guardarOC} disabled={guardandoOC}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
                {guardandoOC ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
              </button>
              {oc.actualizadaAt && (
                <span className="text-[10.5px] text-zinc-400">Última vez: {fmtFecha(oc.actualizadaAt)}{oc.registradaPorNombre ? ` · ${oc.registradaPorNombre}` : ''}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {r?.faltantes && r.faltantes.length > 0 && (
        <Banner variante="warning" accion={puedeOperar ? { label: 'Volver a armar el resumen', onClick: regenerarResumen, cargando: regenerando } : undefined}>
          <span className="font-semibold">El resumen ejecutivo quedó incompleto:</span> {r.faltantes.join(' · ')}
        </Banner>
      )}

      {/* Flujo, en UNA sola pantalla: el stepper cambia `faseActiva` (estado local), nunca navega.
          Se muestra recién cuando hay encargado: antes no hay nada que hacer en ninguno de los 7
          pasos. */}
      {!asignacion.asignadoA ? (
        <div className="flex items-center gap-2 text-[12.5px] text-zinc-400 bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-6 justify-center text-center">
          Asigna un encargado para ver Tareas, Costeo, Aprobación y el resto del flujo.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div id="compras-flujo" className="px-3 sm:px-5 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap scroll-mt-4">
            <div className="overflow-x-auto -mt-2 pt-3 px-2 -mx-2 pb-1">
              <div className="flex items-start min-w-max">
                {pasosFlujo.map((f, i) => {
                  const activa = faseActiva === f.key;
                  const { badge, estado } = calcFase(f.key);
                  const ESTADO_STYLE = {
                    alerta: 'bg-rose-50 border-rose-500 text-rose-600', pendiente: 'bg-amber-50 border-amber-400 text-amber-600',
                    ok: 'bg-emerald-50 border-emerald-500 text-emerald-600', neutral: 'bg-white border-zinc-300 text-zinc-400',
                  } as const;
                                    return (
                    <div key={f.key} className="flex items-start">
                      {i > 0 && <div className={`h-0.5 w-6 sm:w-12 mt-[30px] flex-shrink-0 ${calcFase(pasosFlujo[i - 1].key).estado === 'ok' ? 'bg-emerald-300' : 'bg-zinc-200'}`} />}
                      <button onClick={() => setFaseActiva(f.key)} aria-current={activa ? 'step' : undefined}
                        className={`group flex flex-col items-center gap-1.5 flex-shrink-0 px-1.5 py-2 w-[110px] rounded-xl transition-colors ${activa ? 'bg-teal-50' : 'hover:bg-zinc-50'}`}>
                        <span className={`relative inline-flex items-center justify-center w-10 h-10 rounded-full border-2 text-[15px] font-semibold transition-all ${ESTADO_STYLE[estado]} ${activa ? '' : 'group-hover:border-zinc-500'}`}>
                          {estado === 'ok' ? <Check size={18} strokeWidth={3} /> : estado === 'alerta' ? '!' : i + 1}
                          {badge != null && badge > 0 && estado !== 'ok' && (
                            <span className={`absolute -top-1.5 -right-1.5 text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center ring-2 ring-white text-white ${estado === 'alerta' ? 'bg-rose-500' : 'bg-amber-400'}`}>{badge}</span>
                          )}
                        </span>
                        <span className={`text-[12.5px] leading-tight text-center ${activa ? 'font-semibold text-teal-800' : 'font-medium text-zinc-600 group-hover:text-zinc-900'}`}>{f.label}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              {FASES.filter(f => f.secundaria).map(f => {
                const Icon = f.icon; const activa = faseActiva === f.key;
                return (
                  <button key={f.key} onClick={() => (f.key === 'obuma' ? setResumenObumaAbierto(true) : setFaseActiva(f.key))} aria-current={activa ? 'page' : undefined}
                    title={f.key === 'obuma' ? 'Ver lo que ya se creó en Obuma desde Licitank' : undefined}
                    className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${activa ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-teal-300 hover:text-teal-700'}`}>
                    <Icon size={14} /> {f.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="px-4 py-2.5 border-t border-zinc-100 flex items-baseline gap-x-2.5 gap-y-0.5 flex-wrap">
            <h3 className="text-[14px] font-semibold tracking-tight text-zinc-900">{FASES.find(f => f.key === faseActiva)?.label}</h3>
            <p className="text-[12.5px] text-zinc-500">{FASES.find(f => f.key === faseActiva)?.descripcion}</p>
          </div>
          <div className="p-3 sm:p-4 space-y-3">
            {faseActiva === 'tareas' && (
              <div className="space-y-3">
                <Seccion titulo="Lista de tareas" ayuda="Lo que hay que hacer, cada una con su plazo. Ciérralas a medida que avances." badge={pendientesN ? `${pendientesN} pendiente${pendientesN === 1 ? '' : 's'}` : 'Al día'} tono={(resumenFases?.tareas.vencidas ?? 0) > 0 ? 'alerta' : pendientesN > 0 ? 'pendiente' : 'ok'} defaultAbierta>
                  <TareasComprasCard />
                </Seccion>
              </div>
            )}
            {faseActiva === 'costeo' && (
              <Pestanas id="costeo" pestanas={[
                { clave: 'productos', titulo: 'Productos', ayuda: 'Cada producto ganado y cómo va. Todos deben quedar cubiertos para poder entregar.',
                  contenido: <ProductosCompraCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} /> },
                { clave: 'cotizaciones', titulo: 'Cotizaciones', ayuda: 'Sube la cotización de cada proveedor. El sistema compara su PRECIO contra lo que se costeó al ofertar: más barata, igual o más cara, y por cuánto.',
                  badge: resumenFases?.costeo.productosSinCotizacion ? `${resumenFases.costeo.productosSinCotizacion} sin cotizar` : null, tono: 'pendiente',
                  contenido: <AuditorComprasCard negocioId={negocioId} puedeOperar={puedeCotizar} soloLectura={puedeOperar && !puedeCotizar} /> },
                { clave: 'fichas', titulo: 'Fichas técnicas', ayuda: 'Sube las fichas técnicas (todas juntas): el sistema detecta de qué producto y proveedor es cada una y compara lo que dice contra lo que exigen las bases.',
                  contenido: <FichasTecnicasCard negocioId={negocioId} puedeOperar={puedeCotizar} soloLectura={puedeOperar && !puedeCotizar} /> },
                /* PROMPT 5: verifica cada línea de la tabla de costeo (respaldo real, producto, unidad, IVA, costos ocultos) y da la posición de precio. */
                { clave: 'costo', titulo: 'Verificar el costo', ayuda: 'Revisa que cada costo del costeo tenga respaldo real (link o cotización), sea el mismo producto y no esconda costos.',
                  contenido: <AuditorCosteoCard negocioId={negocioId} puedeOperar={puedeOperar} /> },
              ]} />
            )}
            {faseActiva === 'aprobacion' && (
              <div className="space-y-3">
                {/* parte="todo": primero las dos aprobaciones y, cuando la compra queda aprobada, aparece abajo la lista de productos para crear su SKU (uno por uno o todos seguidos). */}
                <AprobacionesCompraCard negocioId={negocioId} puedeOperar={puedeOperar} parte="todo" />
              </div>
            )}
            {faseActiva === 'obuma' && <ObumaHubCard negocioId={negocioId} puedeOperar={puedeOperar} esAdministracion={esAdministracion} />}
            {faseActiva === 'compra' && (
              <Pestanas id="compra" inicial="pasos" pestanas={[
                { clave: 'pasos', titulo: 'Órdenes y facturas', ayuda: 'Aquí emites las órdenes de compra a los proveedores (y creas al proveedor si no está en Obuma), registras cada pago con su comprobante y ves la factura de cada orden, que llega sola desde Obuma.',
                  badge: resumenFases?.compra.hitosAdminPendientes || null, tono: 'pendiente',
                  contenido: (
                    <div className="space-y-6">
                      <section className="space-y-2">
                        <p className="text-[13px] font-bold text-zinc-800"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">1</span>Emite las órdenes de compra a los proveedores</p>
                        <RepartoAdminCard negocioId={negocioId} puedeOperar={puedeOperar || esAdministracion} parte="oc" />
                        {/* OC que emite una empresa del grupo sin Obuma (Comercial MP → Inversiones Claro); no se muestra si el negocio va por Obuma. */}
                        <OcPropiaCard negocioId={negocioId} puedeOperar={puedeOperar || esAdministracion} />
                      </section>
                      <section className="space-y-2">
                        <p className="text-[13px] font-bold text-zinc-800"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">2</span>Avance: pagos, facturas y proyecto en Obuma</p>
                        <RepartoAdminCard negocioId={negocioId} puedeOperar={puedeOperar || esAdministracion} parte="hitos" />
                      </section>
                    </div>
                  ) },
                { clave: 'retiro', titulo: 'Retiro por proveedor', ayuda: 'Cada proveedor está en un lugar distinto: defines para cada uno si lo buscamos nosotros o lo trae un transporte, y el sistema sugiere fleteros.',
                  contenido: <ModalidadRetiroCard negocioId={negocioId} puedeOperar={puedeOperar} /> },
                { clave: 'importacion', titulo: 'Importación (si aplica)', ayuda: 'Solo si el producto viene del extranjero: flete, aduana y costo final puesto en bodega. Si no, sáltate esta pestaña.',
                  contenido: <ImportacionCard negocioId={negocioId} puedeOperar={puedeOperar} /> },
                { clave: 'gastos', titulo: 'Gastos extra', ayuda: 'Gastos que no son productos. Si necesita SKU, OC y factura (un flete o un adicional como una grúa), agrégalo con SKU y OC: va a aprobación solo ese ítem. Si no (colación, bencina, viáticos), anótalo como gasto.',
                  contenido: (
                    <div className="space-y-4">
                      <ServiciosConSkuCard negocioId={negocioId} puedeOperar={puedeOperar} />
                      <GastosCard negocioId={negocioId} puedeOperar={puedeOperar} />
                    </div>
                  ) },
                { clave: 'resumen', titulo: 'Seguimiento · Resumen', ayuda: 'Para mirar cómo va: productos cubiertos, órdenes de compra emitidas, facturas recibidas y cuánto se gastó contra lo costeado.',
                  contenido: <ResumenGastosCard negocioId={negocioId} /> },
                { clave: 'comparativo', titulo: 'Seguimiento · Comparativo', ayuda: 'Por producto y por orden de compra, todo neto: lo costeado, lo planeado en Licitank y lo que de verdad se compró en Obuma, para ver si coincide.',
                  contenido: <ResumenComparativoCard negocioId={negocioId} /> },
              ]} />
            )}
            {faseActiva === 'entrega' && (
              <div>
                {/* Incidencias (§9): transversales (pueden aparecer en cualquier etapa); se llega desde la franja fija de arriba. */}
                <div id="compras-incidencias" className="scroll-mt-4" />
                <Pestanas id="entrega" inicial={(resumenFases?.entrega.incidenciasAbiertas ?? 0) > 0 ? 'incidencias' : (RELOJ_ENTREGA_ACTIVO ? 'plazo' : 'entrega')} pestanas={[
                  ...(RELOJ_ENTREGA_ACTIVO ? [
                  { clave: 'plazo', titulo: 'Plazo de entrega', ayuda: 'Cuánto queda para entregar y qué hacer si no se alcanza: pedir prórroga sin multa o, solo con autorización, entregar con multa.',
                    badge: resumenFases?.entrega.relojVencido ? 'Vencido' : null, tono: 'alerta' as const,
                    contenido: <RelojEntregaCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} /> }
                  ] : []),
                  { clave: 'entrega', titulo: 'Entrega y acta', ayuda: 'Preparación, despacho y el acta de entrega que firma el cliente. El acta cierra el proyecto.',
                    contenido: <><OcMiniaturas negocioId={negocioId} /><EntregaCard negocioId={negocioId} puedeOperar={puedeOperar} puedeVerificar={esBodega} /></> },
                  { clave: 'costoreal', titulo: 'Factura y cierre', ayuda: 'La factura de venta al cliente (al subirla se marca sola la tarea de cierre) y el resultado final: lo costeado contra lo realmente gastado.',
                    contenido: <><FacturaVentaCard negocioId={negocioId} puedeOperar={puedeOperar} /><ResumenCierreCard negocioId={negocioId} /><CostoRealCard negocioId={negocioId} puedeOperar={puedeOperar} /></> },
                  ...(hayPostventa ? [
                  { clave: 'postventa', titulo: 'Garantías y postventa', ayuda: 'Las garantías ofertadas con su vencimiento y lo que hay que cumplir después de entregar.',
                    contenido: <PostventaCard negocioId={negocioId} puedeOperar={puedeOperar} /> }
                  ] : []),
                  { clave: 'incidencias', titulo: 'Si hay un problema · Incidencias', ayuda: 'Problemas u oportunidades que pueden aparecer en cualquier etapa: sin stock, plazo incompatible, una alternativa más barata.',
                    badge: (resumenFases?.entrega.incidenciasAbiertas ?? 0) || null, tono: 'alerta',
                    contenido: <IncidenciasCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} /> },
                  { clave: 'fracaso', titulo: 'Si no se puede entregar', ayuda: 'Registro de fracaso: lo declara el encargado y el jefe de ventas dictamina la causa real.',
                    contenido: <FracasoCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} /> },
                ]} />
              </div>
            )}
      {resumenObumaAbierto && (
        <ResumenObumaModal negocioId={negocioId} onCerrar={() => setResumenObumaAbierto(false)}
          onIrGestion={() => irAFase('obuma')} onIrSku={() => setFaseActiva('aprobacion')} />
      )}
            {faseActiva === 'documentos' && (
              <div className="space-y-3">
                <DocumentosLicitacionCard licitacionCodigo={licitacionCodigoActual || asignacion.licitacionCodigo} />
                {soloDesdeAprobacion && <DocumentosCompraCard negocioId={negocioId} />}
                <AuditoriaAgenteNegocioCard negocioId={negocioId} />
              </div>
            )}
            {faseActiva === 'actividad' && <ActividadComprasCard negocioId={negocioId} />}
            {(() => {
              const i = pasosFlujo.findIndex(f => f.key === faseActiva);
              if (i < 0) return null;
              const ant = pasosFlujo[i - 1], sig = pasosFlujo[i + 1];
              if (!ant && !sig) return null;
              return (
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-zinc-100">
                  {ant ? <button type="button" onClick={() => irAFaseFlujo(ant.key)} className="text-[12.5px] font-semibold text-zinc-500 hover:text-zinc-800">← {ant.label}</button> : <span />}
                  {sig && <button type="button" onClick={() => irAFaseFlujo(sig.key)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-teal-700 hover:text-teal-800">Siguiente: {sig.label} <ArrowRight size={15} /></button>}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
