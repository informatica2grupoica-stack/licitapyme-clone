'use client';

// CONTENIDO de la ficha de un negocio en Compras — UNA SOLA pantalla (11-sep-2026, quinta vuelta
// del mismo pedido). El usuario probó la versión con URL propia por submódulo y no era lo que
// quería: "quiero que todo el sistema de compras sea un flujo, ir paso a paso... el flujo puede
// estar arriba e ir cambiando por las pestañas, sin pinchar y navegar a otra pantalla". Confirmado
// explícito: una sola URL, stepper arriba, el contenido de abajo cambia al instante con estado
// local — no `<Link>`, no rutas por submódulo. Costeo y Auditoría van JUNTAS otra vez (se habían
// separado por pedido propio del usuario y luego pidió deshacerlo: "yo no pedí eso").
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { useCosteoFlotante } from '@/app/components/CosteoFlotanteContext';
import { DocumentosLicitacionCard } from '@/app/negocios/[id]/DocumentosLicitacionCard';
import { AuditoriaAgenteNegocioCard } from '@/app/negocios/[id]/AuditoriaAgenteNegocioCard';
import { ProductosCompraCard } from '@/app/negocios/[id]/ProductosCompraCard';
import { AuditorComprasCard } from '@/app/negocios/[id]/AuditorComprasCard';
import { AprobacionesCompraCard } from '@/app/negocios/[id]/AprobacionesCompraCard';
import { RepartoAdminCard } from '@/app/negocios/[id]/RepartoAdminCard';
import { ImportacionCard } from '@/app/negocios/[id]/ImportacionCard';
import { ModalidadRetiroCard } from '@/app/negocios/[id]/ModalidadRetiroCard';
import { GastosCard } from '@/app/negocios/[id]/GastosCard';
import { RelojEntregaCard } from '@/app/negocios/[id]/RelojEntregaCard';
import { IncidenciasCard } from '@/app/negocios/[id]/IncidenciasCard';
import { EntregaCard } from '@/app/negocios/[id]/EntregaCard';
import { PostventaCard } from '@/app/negocios/[id]/PostventaCard';
import { FracasoCard } from '@/app/negocios/[id]/FracasoCard';
import { ActividadComprasCard } from '@/app/negocios/[id]/ActividadComprasCard';
import { GanttComprasCard } from '@/app/negocios/[id]/GanttComprasCard';
import { TareasComprasCard } from './TareasComprasCard';
import { useCompras, fmtCLP, fmtFecha, type OrdenCompra } from './ComprasContext';
import { IconShoppingCart as ShoppingCart, IconLoader2 as Loader2, IconUserPlus as UserPlus, IconClock as Clock, IconAlertTriangle as AlertTriangle, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconCurrencyDollar as DollarSign, IconFileAlert as FileWarning, IconBuilding as Building2, IconFileText as FileText, IconDeviceFloppy as Save, IconClipboardList as ClipboardList, IconRefresh as RefreshCw, IconBolt as Zap, IconExternalLink as ExternalLink, IconArrowUpRight as ArrowUpRight, IconCalculator as Calculator, IconClipboardCheck as ClipboardCheck, IconPackage as Package, IconTruck as Truck, IconHistory as History, IconTimeline as GanttChartSquare } from '@tabler/icons-react';

type Fase = 'tareas' | 'costeo' | 'aprobacion' | 'compra' | 'entrega' | 'actividad' | 'gantt';
const FASES: { key: Fase; label: string; icon: typeof ClipboardList; descripcion: string }[] = [
  { key: 'tareas', label: 'Tareas', icon: ClipboardList, descripcion: 'El checklist de validación y plazos administrativos (§5): contacto con el cliente, validación técnica real, validación de la cotización y del costeo.' },
  { key: 'costeo', label: 'Costeo y Auditoría', icon: Calculator, descripcion: 'Cobertura por producto (§14), el costeo digital del proyecto y el Auditor de Compras (§8): cotizaciones, homologación, cuadro comparativo y los 4 escenarios de compra.' },
  { key: 'aprobacion', label: 'Aprobación y SKU', icon: ClipboardCheck, descripcion: 'Creación del SKU propio (§7) y las dos compuertas de aprobación (§10): aprobación de la compra y aprobación del margen (piso 20%).' },
  { key: 'compra', label: 'Compra, Importación y Logística', icon: Package, descripcion: 'Lo administrativo post-aprobación con OBUMA (§11), costo aterrizado si es importación (§12), modalidad de retiro (§13) y gastos reales del proyecto.' },
  { key: 'entrega', label: 'Entrega y Cierre', icon: Truck, descripcion: 'Reloj de entrega y multas (§15), incidencias (§9), acta de entrega (§16), postventa (§17) y, si corresponde, el registro de fracaso (§14.6).' },
  { key: 'actividad', label: 'Actividad', icon: History, descripcion: 'Línea de tiempo del proyecto: qué se hizo día a día, desde que se ganó hasta ahora.' },
  { key: 'gantt', label: 'Gantt', icon: GanttChartSquare, descripcion: 'Tareas por fecha: cuándo se crearon, cuándo vencía cada una y cuándo se cerraron.' },
];

export function ComprasChrome({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const flot = useCosteoFlotante();
  const {
    loading, error, asignacion, tareas, candidatos, resumenFases, licitacionNombre, licitacionOrganismo, ocMp,
    recargar, puedeOperar, esJefeDeVentas, esAdministracion, esBodega, esAdmin,
  } = useCompras();

  const [faseActiva, setFaseActiva] = useState<Fase>('tareas');
  const [asignando, setAsignando] = useState(false);
  const [candidatoElegido, setCandidatoElegido] = useState('');
  // Reasignar (pedido explícito del usuario, 15-sep-2026): solo admin puede cambiar un encargado
  // que ya tiene otro asignado — misma restricción que la lista de Compras (app/compras/page.tsx).
  const [reasignando, setReasignando] = useState(false);
  const [ocAbierta, setOcAbierta] = useState(false);
  const [ocForm, setOcForm] = useState({ numero: '', emitidaAt: '', aceptadaAt: '', monto: '', difiere: false, observacion: '' });
  const [guardandoOC, setGuardandoOC] = useState(false);
  const [buscandoOC, setBuscandoOC] = useState(false);
  const [resumenAbierto, setResumenAbierto] = useState(true);
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${asignacion.urgente ? 'bg-rose-50' : 'bg-teal-50'}`}>
          <ShoppingCart size={17} className={asignacion.urgente ? 'text-rose-600' : 'text-teal-600'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold text-zinc-900 leading-tight">
              {licitacionNombre || `Negocio #${negocioId}`}
            </h2>
            {asignacion.urgente && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                <AlertTriangle size={11} /> Cadena de Urgencia
              </span>
            )}
          </div>
          <p className="text-[12px] text-zinc-500 flex items-center gap-2 flex-wrap">
            <span>{asignacion.licitacionCodigo}</span>
            {licitacionOrganismo && <span>· {licitacionOrganismo}</span>}
            <span>· Ganado {fmtFecha(asignacion.ganadoAt)}</span>
            <Link href={`/negocios/${negocioId}`} className="inline-flex items-center gap-0.5 text-teal-700 hover:text-teal-800 font-semibold">
              Ver licitación <ArrowUpRight size={11} />
            </Link>
          </p>
        </div>
        <button
          onClick={() => flot.abrir(negocioId, asignacion.licitacionCodigo)}
          className="flex-shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-2 rounded-lg transition-colors"
          title="Abre el costeo digital del proyecto (misma burbuja flotante que en la pestaña Costeo de la licitación)"
        >
          <Calculator size={14} /> Ver costeo
        </button>
      </div>

      {/* Documentación, Encargado, OC y Resumen Ejecutivo — se ven siempre, sea cual sea el paso
          del flujo elegido abajo. */}
      <DocumentosLicitacionCard licitacionCodigo={asignacion.licitacionCodigo} />
      <AuditoriaAgenteNegocioCard negocioId={negocioId} />

      {r?.faltantes && r.faltantes.length > 0 && (
        <Banner variante="warning" accion={puedeOperar ? { label: 'Volver a armar el resumen', onClick: regenerarResumen, cargando: regenerando } : undefined}>
          <span className="font-semibold">El resumen ejecutivo quedó incompleto:</span> {r.faltantes.join(' · ')}
        </Banner>
      )}

      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <p className="text-[11px] font-bold text-zinc-400 uppercase mb-2">Encargado de Compras</p>
        {asignacion.asignadoA && !reasignando ? (
          <p className="text-[13.5px] text-zinc-800 flex items-center gap-1.5 flex-wrap">
            <span className="font-bold">{asignacion.asignadoNombre}</span>
            <span className="text-zinc-400"> — asignado {fmtFecha(asignacion.asignadoAt)}{asignacion.asignadoPor == null ? ' (automático, por carga)' : ''}</span>
            {esAdmin && (
              <button onClick={() => setReasignando(true)}
                className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-800">Cambiar</button>
            )}
          </p>
        ) : asignacion.asignadoA && reasignando ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={candidatoElegido} onChange={setCandidatoElegido}
              placeholder="Nuevo encargado…" minWidth={220}
              options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga} tarea${c.carga === 1 ? '' : 's'} activa${c.carga === 1 ? '' : 's'})` }))}
            />
            <button onClick={asignar} disabled={!candidatoElegido || asignando}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors">
              {asignando ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Cambiar
            </button>
            <button onClick={() => { setReasignando(false); setCandidatoElegido(''); }} disabled={asignando}
              className="text-[12px] text-zinc-500 hover:text-zinc-700 px-1.5 py-2">Cancelar</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[12.5px] text-zinc-500 flex items-center gap-1.5">
              <Clock size={13} className={vencimientoPasado ? 'text-rose-500' : 'text-amber-500'} />
              {vencimientoPasado
                ? 'Plazo de asignación vencido — se asignará automáticamente al de menor carga.'
                : `Sin asignar. Plazo: ${fmtFecha(asignacion.vencimientoAsignacionAt)} (3h hábiles).`}
            </p>
            {esJefeDeVentas && (
              <div className="flex items-center gap-2">
                <Select
                  value={candidatoElegido} onChange={setCandidatoElegido}
                  placeholder="Elegir encargado…" minWidth={220}
                  options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga} tarea${c.carga === 1 ? '' : 's'} activa${c.carga === 1 ? '' : 's'})` }))}
                />
                <button onClick={asignar} disabled={!candidatoElegido || asignando}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors">
                  {asignando ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Asignar
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-zinc-400 uppercase flex items-center gap-1.5">
              <FileText size={12} /> Orden de compra del cliente
              {oc.origen === 'mp' && (
                <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full normal-case">
                  <Zap size={10} /> Llegó sola desde Mercado Público
                </span>
              )}
            </p>
            {oc.numero || oc.aceptadaAt ? (
              <>
                <p className="text-[12.5px] text-zinc-700 mt-0.5">
                  {oc.numero && <span className="font-bold">N° {oc.numero}</span>}
                  {oc.monto != null && <span className="text-zinc-500"> · {fmtCLP(oc.monto)} c/IVA</span>}
                  {oc.emitidaAt && <span className="text-zinc-400"> · emitida {oc.emitidaAt}</span>}
                  {oc.aceptadaAt
                    ? <span className="text-emerald-700 font-semibold"> · aceptada {oc.aceptadaAt}</span>
                    : <span className="text-amber-600 font-semibold"> · sin aceptar todavía</span>}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  {oc.estadoMp && <span className="text-[10.5px] font-semibold text-zinc-500">Estado en MP: {oc.estadoMp}</span>}
                  {ocMp?.url && (
                    <a href={ocMp.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-700">
                      <ExternalLink size={10} /> Ver en Mercado Público
                    </a>
                  )}
                  {ocMp?.pdfUrl && (
                    <a href={ocMp.pdfUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-700">
                      <FileText size={10} /> PDF de la orden
                    </a>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[12px] text-zinc-400 mt-0.5">
                Todavía no llega. El sistema la busca solo en Mercado Público y la carga acá apenas aparece.
              </p>
            )}
          </div>
          {puedeOperar && (
            <div className="flex-shrink-0 flex items-center gap-3">
              {oc.origen !== 'mp' && (
                <button onClick={buscarOC} disabled={buscandoOC}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                  {buscandoOC ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  Buscar automáticamente
                </button>
              )}
              <button onClick={() => setOcAbierta(v => !v)}
                className="text-[12px] font-semibold text-teal-700 hover:text-teal-800">
                {ocAbierta ? 'Cerrar' : oc.origen === 'mp' ? 'Corregir a mano' : (oc.numero || oc.aceptadaAt ? 'Editar' : 'Registrar a mano')}
              </button>
            </div>
          )}
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
          {resumenAbierto && (
            <div className="border-t border-zinc-100 px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase flex items-center gap-1"><UserPlus size={11} /> Asistente comercial (lo trabajó)</p>
                  <p className="text-[13px] font-bold text-zinc-800">{r.responsableNombre || '—'}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase flex items-center gap-1"><DollarSign size={11} /> Precio de venta ganado</p>
                  <p className="text-[13px] font-bold text-zinc-800">{fmtCLP(r.montoNuestro)}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Presupuesto del proyecto</p>
                  <p className="text-[13px] font-bold text-zinc-800">{fmtCLP(r.presupuestoProyecto)}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Margen previsto</p>
                  <p className={`text-[13px] font-bold ${r.margenPrevisto != null && r.margenPrevisto < 20 ? 'text-rose-600' : 'text-zinc-800'}`}>
                    {r.margenPrevisto != null ? `${r.margenPrevisto}%` : '— (sin costeo)'}
                  </p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Monto costeado</p>
                  <p className="text-[13px] font-bold text-zinc-800">{r.existeCosteo ? fmtCLP(r.montoCosteado) : 'Sin costeo'}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Plazo de entrega ofertado</p>
                  <p className="text-[12.5px] font-semibold text-zinc-800">{r.plazoEntregaOfertado || '—'}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Desde cuándo corre</p>
                  <p className="text-[12.5px] font-semibold text-zinc-800">{r.hitoInicioPlazo || '—'}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border ${r.requiereBoletaFielCumplimiento ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-400 bg-zinc-50 border-zinc-200'}`}>
                  <FileWarning size={12} /> Boleta de fiel cumplimiento: {r.requiereBoletaFielCumplimiento ? 'Sí' : 'No'}
                </span>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border ${r.requiereFirmaContrato ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-400 bg-zinc-50 border-zinc-200'}`}>
                  <FileWarning size={12} /> Firma de contrato: {r.requiereFirmaContrato ? 'Sí' : 'No'}
                </span>
              </div>
              <p className="text-[11.5px] text-zinc-500">Plazo para aceptar la OC: {r.plazoAceptacionOC}</p>

              {r.contactosCliente && (
                <div className="pt-2 border-t border-zinc-100">
                  <p className="text-[11px] font-bold text-zinc-500 uppercase mb-1 flex items-center gap-1"><Building2 size={12} /> Contactos del cliente</p>
                  <p className="text-[12px] text-zinc-600">{[r.contactosCliente.organismo, r.contactosCliente.unidad].filter(Boolean).join(' · ')}</p>
                  {[r.contactosCliente.direccion, r.contactosCliente.comuna].filter(Boolean).length > 0 && (
                    <p className="text-[11.5px] text-zinc-400">{[r.contactosCliente.direccion, r.contactosCliente.comuna].filter(Boolean).join(', ')}</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                    {([
                      { rol: 'Contraparte', nombre: r.contactosCliente.usuarioNombre, datos: [r.contactosCliente.usuarioCargo, r.contactosCliente.usuarioTelefono, r.contactosCliente.usuarioEmail] },
                      { rol: 'Responsable del contrato', nombre: r.contactosCliente.responsableContratoNombre, datos: [r.contactosCliente.responsableContratoEmail, r.contactosCliente.responsableContratoFono] },
                      { rol: 'Responsable de pagos', nombre: r.contactosCliente.responsablePagoNombre, datos: [r.contactosCliente.responsablePagoEmail] },
                    ]).map(({ rol, nombre, datos }) => nombre ? (
                      <div key={rol} className="bg-zinc-50 rounded-lg p-2">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase">{rol}</p>
                        <p className="text-[12px] font-semibold text-zinc-700">{nombre}</p>
                        {datos.filter(Boolean).map(d => (
                          <p key={String(d)} className="text-[11px] text-zinc-500 break-words">{d}</p>
                        ))}
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
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
          <div className="px-3 sm:px-5 pt-4 pb-2 overflow-x-auto">
            <div className="flex items-center min-w-max">
              {FASES.map((f, i) => {
                const Icon = f.icon;
                const activa = faseActiva === f.key;
                const esLente = f.key === 'actividad' || f.key === 'gantt';
                const totalEtapas = FASES.filter(x => x.key !== 'actividad' && x.key !== 'gantt').length;
                const idxActiva = FASES.findIndex(x => x.key === faseActiva);
                const pasada = !esLente && idxActiva < totalEtapas && i < idxActiva;
                let badge: number | null = null; let alerta = false;
                if (resumenFases) {
                  if (f.key === 'tareas') badge = resumenFases.tareas.vencidas || null;
                  else if (f.key === 'costeo') badge = resumenFases.costeo.productosSinCotizacion || null;
                  else if (f.key === 'aprobacion') badge = resumenFases.aprobacion.compuertasPendientes || null;
                  else if (f.key === 'compra') badge = resumenFases.compra.hitosAdminPendientes;
                  else if (f.key === 'entrega') {
                    badge = resumenFases.entrega.incidenciasAbiertas || (resumenFases.entrega.relojVencido ? 0 : null);
                    alerta = resumenFases.entrega.relojVencido || resumenFases.entrega.incidenciasAbiertas > 0;
                  }
                }
                return (
                  <div key={f.key} className="flex items-center">
                    {i > 0 && !esLente && (
                      <div className={`h-0.5 w-6 sm:w-10 flex-shrink-0 transition-colors duration-300 ${pasada || activa ? 'bg-teal-400' : 'bg-zinc-200'}`} />
                    )}
                    {f.key === 'actividad' && <div className="w-px h-8 bg-zinc-200 mx-2 sm:mx-3 flex-shrink-0" />}
                    {f.key === 'gantt' && <div className="w-4 sm:w-6 flex-shrink-0" />}
                    <button onClick={() => setFaseActiva(f.key)} title={f.label}
                      className="group flex flex-col items-center gap-1.5 flex-shrink-0 px-1.5">
                      <span className={`relative inline-flex items-center justify-center w-9 h-9 border-2 transition-all duration-200 ${
                        esLente ? 'rounded-lg' : 'rounded-full'
                      } ${
                        activa && esLente ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/30 scale-110'
                        : activa ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-600/30 scale-110'
                        : pasada ? 'bg-teal-50 border-teal-400 text-teal-600'
                        : esLente ? 'bg-white border-zinc-200 text-zinc-400 group-hover:border-indigo-300 group-hover:text-indigo-500'
                        : 'bg-white border-zinc-200 text-zinc-400 group-hover:border-zinc-300 group-hover:text-zinc-600'
                      }`}>
                        <Icon size={15} />
                        {badge != null && (
                          <span className={`absolute -top-1.5 -right-1.5 text-[9.5px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center ring-2 ring-white ${
                            alerta ? 'bg-rose-500 text-white' : 'bg-amber-400 text-white'
                          }`}>
                            {badge}
                          </span>
                        )}
                      </span>
                      <span className={`text-[10.5px] font-semibold whitespace-nowrap transition-colors ${
                        activa && esLente ? 'text-indigo-700' : activa ? 'text-teal-700' : pasada ? 'text-teal-600/80' : esLente ? 'text-zinc-400 group-hover:text-indigo-500' : 'text-zinc-400 group-hover:text-zinc-600'
                      }`}>
                        {f.label}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-[11.5px] text-zinc-500 px-4 py-2.5 bg-zinc-50/60 border-y border-zinc-100">
            {FASES.find(f => f.key === faseActiva)?.descripcion}
          </p>
          <div className="p-3 sm:p-4 space-y-3">
            {faseActiva === 'tareas' && <TareasComprasCard />}
            {faseActiva === 'costeo' && (
              <div className="space-y-3">
                <ProductosCompraCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} />
                <AuditorComprasCard negocioId={negocioId} puedeOperar={puedeOperar} />
              </div>
            )}
            {faseActiva === 'aprobacion' && <AprobacionesCompraCard negocioId={negocioId} puedeOperar={puedeOperar} />}
            {faseActiva === 'compra' && (
              <div className="space-y-3">
                <RepartoAdminCard negocioId={negocioId} puedeOperar={puedeOperar || esAdministracion} />
                <ImportacionCard negocioId={negocioId} puedeOperar={puedeOperar} />
                <ModalidadRetiroCard negocioId={negocioId} puedeOperar={puedeOperar} />
                <GastosCard negocioId={negocioId} puedeOperar={puedeOperar} />
              </div>
            )}
            {faseActiva === 'entrega' && (
              <div className="space-y-3">
                <RelojEntregaCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} />
                <IncidenciasCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} />
                <EntregaCard negocioId={negocioId} puedeOperar={puedeOperar} puedeVerificar={esBodega} />
                <PostventaCard negocioId={negocioId} puedeOperar={puedeOperar} />
                <FracasoCard negocioId={negocioId} puedeOperar={puedeOperar} esJefeDeVentas={esJefeDeVentas} />
              </div>
            )}
            {faseActiva === 'actividad' && <ActividadComprasCard negocioId={negocioId} />}
            {faseActiva === 'gantt' && <GanttComprasCard tareas={tareas} />}
          </div>
        </div>
      )}
    </div>
  );
}
