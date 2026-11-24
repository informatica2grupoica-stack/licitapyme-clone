'use client';

// ENTREGA DE PROYECTOS (Frente F.1, Fase 4) — los proyectos que GANAMOS, con su resumen ejecutivo
// y el estado de acuse de recibo de cada involucrado.
//
// Es una vista de TRABAJO, no un panel de administración: cada persona del circuito entra, lee el
// resumen del proyecto y acusa recibo. Por eso vive en el grupo PRINCIPAL del menú (sigue el ciclo
// Negocios → Postuladas → Ganadas/Perdidas → Entregas) y no en ADMIN.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { useRealtime } from '@/app/lib/use-realtime';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario } from '@/app/lib/user-color';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { IconTrophy as Trophy, IconLoader2 as Loader2, IconInbox as Inbox, IconCircleCheck as CheckCircle2, IconClock as Clock, IconBuilding as Building2, IconUser as User, IconFileText as FileText, IconUsers as Users, IconAlertTriangle as AlertTriangle, IconExternalLink as ExternalLink, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight, IconSearch as Search, IconFilter as Filter, IconX as X, IconCalendar as Calendar, IconBriefcase as Briefcase, IconArrowsUpDown as ArrowUpDown, IconShieldExclamation as ShieldAlert, IconEye as Eye, IconPaperclip as Paperclip, IconDownload as Download } from '@tabler/icons-react';

interface Entrega {
  negocioId: number;
  licitacionCodigo: string;
  licitacionNombre: string | null;
  organismo: string | null;
  abiertaAt: string;
  completadaAt: string | null;
  miAcuse: string | null;
  acusados: number;
  totalAcuses: number;
  resumen: any;
}

const clp = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const fecha = (f: string | null) => {
  if (!f) return '—';
  const d = new Date(f);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Fecha CON hora, para el instante de adjudicación: es el dato que publica el acta de MP y el
// equipo lo usa para ubicar el hito exacto. 'YYYY-MM-DD HH:mm:ss' se parsea con la T para que el
// navegador NO lo tome como UTC (Safari/Chrome difieren con el espacio) y corra la hora.
const fechaHora = (f: string | null) => {
  if (!f) return '—';
  const d = new Date(typeof f === 'string' ? f.replace(' ', 'T') : f);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CL', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

// Fecha REAL de "cuándo ganamos" para filtrar/ordenar/mostrar: el acta de MP
// (resumen.fechaAdjudicacion) manda; abiertaAt (cuándo ESTE sistema abrió la entrega) es solo el
// respaldo cuando el acta aún no trae fecha. Mismo criterio que la cabecera de la tarjeta.
const ganadoAt = (e: Entrega): string | null => e.resumen?.fechaAdjudicacion || e.abiertaAt || null;
// Ambos formatos ('YYYY-MM-DDTHH:mm:ssZ' ISO y 'YYYY-MM-DD HH:mm:ss' plano) empiezan igual →
// slice(0,10) sirve para comparar por día sin convertir, para el rango de fecha.
const soloDia = (f: string | null) => f ? f.slice(0, 10) : '';
const msDe = (f: string | null) => {
  if (!f) return 0;
  const d = new Date(f.includes('T') || f.endsWith('Z') ? f : f.replace(' ', 'T'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

type Orden = 'reciente' | 'antiguo' | 'monto_desc' | 'monto_asc';

export default function EntregasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const toast = useToast();

  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [enviando, setEnviando] = useState<number | null>(null);
  const [visorDoc, setVisorDoc] = useState<VisorDoc | null>(null);

  const [q, setQ] = useState('');
  const [fResponsable, setFResponsable] = useState<string[]>([]);
  const [fEmpresa, setFEmpresa] = useState<string[]>([]);
  const [fEstado, setFEstado] = useState<string[]>([]);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [orden, setOrden] = useState<Orden>('reciente');

  const hayFiltro = fResponsable.length > 0 || fEmpresa.length > 0 || fEstado.length > 0 || !!fechaDesde || !!fechaHasta;
  const limpiarFiltros = () => { setFResponsable([]); setFEmpresa([]); setFEstado([]); setFechaDesde(''); setFechaHasta(''); };

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/entregas');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setEntregas(data.entregas || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!cargandoSesion) cargar(); }, [cargandoSesion, cargar]);
  useRealtime(cargar);

  const acusar = async (negocioId: number) => {
    setEnviando(negocioId);
    try {
      const res = await fetch('/api/entregas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Acuse de recibo registrado',
        data.completada ? 'Todos los involucrados ya reconocieron el proyecto.' : 'Queda registrado que recibiste el proyecto.');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo registrar el acuse', e.message);
    } finally {
      setEnviando(null);
    }
  };

  const pendientes = entregas.filter(e => !e.miAcuse);

  // Opciones (con conteo) de cada MultiSelect, derivadas de lo que hay realmente cargado.
  const opciones = useMemo(() => {
    const resp = new Map<string, number>();
    const emp = new Map<string, number>();
    for (const e of entregas) {
      const r = e.resumen || {};
      if (r.responsableNombre) resp.set(r.responsableNombre, (resp.get(r.responsableNombre) || 0) + 1);
      if (r.empresaNombre) emp.set(r.empresaNombre, (emp.get(r.empresaNombre) || 0) + 1);
    }
    return {
      responsable: [...resp.entries()].sort((a, b) => b[1] - a[1])
        .map(([v, n]) => ({ value: v, label: v, color: colorUsuario(v), count: n })),
      empresa: [...emp.entries()].sort((a, b) => b[1] - a[1])
        .map(([v, n]) => ({ value: v, label: v, count: n })),
      estado: [
        { value: 'recibido', label: 'Recibido (mío)', count: entregas.filter(e => e.miAcuse).length },
        { value: 'pendiente', label: 'Falta mi acuse', count: pendientes.length },
        { value: 'completa', label: 'Todos acusaron', count: entregas.filter(e => e.acusados === e.totalAcuses).length },
      ],
    };
  }, [entregas, pendientes.length]);

  const filtradas = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const arr = entregas.filter(e => {
      const r = e.resumen || {};
      if (qn) {
        const hay = [e.licitacionNombre, e.licitacionCodigo, e.organismo, r.responsableNombre, r.empresaNombre]
          .filter(Boolean).some(v => String(v).toLowerCase().includes(qn));
        if (!hay) return false;
      }
      if (fResponsable.length > 0 && !fResponsable.includes(r.responsableNombre)) return false;
      if (fEmpresa.length > 0 && !fEmpresa.includes(r.empresaNombre)) return false;
      if (fEstado.length > 0) {
        const cumple = fEstado.some(f =>
          f === 'recibido'  ? !!e.miAcuse :
          f === 'pendiente' ? !e.miAcuse :
          f === 'completa'  ? e.acusados === e.totalAcuses : false);
        if (!cumple) return false;
      }
      const dia = soloDia(ganadoAt(e));
      if (fechaDesde && dia && dia < fechaDesde) return false;
      if (fechaHasta && dia && dia > fechaHasta) return false;
      return true;
    });
    arr.sort((a, b) => {
      switch (orden) {
        case 'antiguo':    return msDe(ganadoAt(a)) - msDe(ganadoAt(b));
        case 'monto_desc': return (b.resumen?.montoNuestro ?? -1) - (a.resumen?.montoNuestro ?? -1);
        case 'monto_asc':  return (a.resumen?.montoNuestro ?? -1) - (b.resumen?.montoNuestro ?? -1);
        default:           return msDe(ganadoAt(b)) - msDe(ganadoAt(a));
      }
    });
    return arr;
  }, [entregas, q, fResponsable, fEmpresa, fEstado, fechaDesde, fechaHasta, orden]);

  return (
    <AppLayout title="Acuses de recibo" breadcrumb={[{ label: 'Ganadas/Perdidas', href: '/adjudicadas' }, { label: 'Acuses de recibo' }]}>
      <div className="@container max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Acuses de recibo de proyectos ganados"
          descripcion={`${hayFiltro || q ? `${filtradas.length} de ${entregas.length}` : 'Proyectos ganados'} según el acta de Mercado Público, con lo que se comprometió al postular.`}
          acciones={entregas.length > 0 ? (
            <div className="relative">
              <Search size={16} stroke={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, código, organismo o empresa…" aria-label="Buscar entregas"
                className="h-9 w-80 rounded-lg border border-linea bg-white pl-9 pr-3 text-[13px] text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </div>
          ) : undefined}
        />

        {pendientes.length > 0 && (
          <Banner variante="warning" className="mb-5">
            {pendientes.length === 1
              ? 'Tienes 1 proyecto ganado esperando tu acuse de recibo.'
              : `Tienes ${pendientes.length} proyectos ganados esperando tu acuse de recibo.`}
          </Banner>
        )}

        {error && <Banner variante="error" className="mb-5">{error}</Banner>}

        {!loading && entregas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-[13px] font-medium text-tinta-2 dark:text-slate-400 flex items-center gap-1.5 mr-1"><Filter size={16} stroke={1.75} className="text-slate-400" /> Filtros</span>
            {opciones.responsable.length > 0 && (
              <MultiSelect label="Responsable" icon={<Users size={13} />} options={opciones.responsable} selected={fResponsable} onChange={setFResponsable} minWidth={220} />
            )}
            {opciones.empresa.length > 0 && (
              <MultiSelect label="Empresa" icon={<Briefcase size={13} />} options={opciones.empresa} selected={fEmpresa} onChange={setFEmpresa} minWidth={220} />
            )}
            <MultiSelect label="Estado" icon={<CheckCircle2 size={13} />} options={opciones.estado} selected={fEstado} onChange={setFEstado} minWidth={190} />
            <div className="flex h-9 items-center gap-1.5 border border-linea dark:border-slate-700 rounded-lg px-2.5 bg-white dark:bg-slate-900">
              <Calendar size={16} stroke={1.75} className="text-slate-400 flex-shrink-0" />
              <span className="text-[13px] text-tinta-2 dark:text-slate-400">Ganado</span>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                max={fechaHasta || undefined}
                className="text-[13px] text-tinta dark:text-slate-100 bg-transparent outline-none w-[118px]" title="Ganado desde" />
              <span className="text-tinta-3">–</span>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                min={fechaDesde || undefined}
                className="text-[13px] text-tinta dark:text-slate-100 bg-transparent outline-none w-[118px]" title="Ganado hasta" />
              {(fechaDesde || fechaHasta) && (
                <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                  title="Quitar rango de fecha" aria-label="Quitar rango de fecha" className="text-slate-400 hover:text-urgente flex-shrink-0"><X size={16} stroke={1.75} /></button>
              )}
            </div>
            {hayFiltro && (
              <Boton variante="fantasma" onClick={limpiarFiltros} icono={<X size={16} stroke={1.75} />}>Limpiar</Boton>
            )}
            <div className="inline-flex items-center gap-1.5 ml-auto">
              <span className="inline-flex items-center gap-1.5 text-[13px] text-tinta-2 dark:text-slate-400"><ArrowUpDown size={16} stroke={1.75} className="text-slate-400" /> Ordenar</span>
              <Select value={orden} onChange={v => setOrden(v as Orden)}
                options={[
                  { value: 'reciente', label: 'Ganado reciente' },
                  { value: 'antiguo', label: 'Ganado más antiguo' },
                  { value: 'monto_desc', label: 'Monto adjudicado (mayor)' },
                  { value: 'monto_asc', label: 'Monto adjudicado (menor)' },
                ]} />
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-20 rounded-xl" />)}</div>
        ) : entregas.length === 0 ? (
          <Vacio icono={<Inbox size={28} stroke={1.75} />} titulo="Todavía no hay proyectos ganados por entregar"
            texto="Cuando Mercado Público publique un acta donde ganemos, el proyecto aparece acá automáticamente con su resumen ejecutivo." />
        ) : filtradas.length === 0 ? (
          <Vacio icono={<Search size={28} stroke={1.75} />} titulo="Sin resultados" texto="Ningún proyecto coincide con la búsqueda o los filtros."
            accion={<Boton tamano="sm" onClick={() => { limpiarFiltros(); setQ(''); }}>Quitar filtros</Boton>} />
        ) : (
          <div className="space-y-3">
            {filtradas.map(e => {
              const expandida = abierta === e.negocioId;
              const r = e.resumen || {};
              return (
                <div key={e.negocioId} className="bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 shadow-tarjeta rounded-xl overflow-hidden">
                  {/* ── Cabecera de la tarjeta ── */}
                  <button
                    onClick={() => setAbierta(expandida ? null : e.negocioId)}
                    aria-expanded={expandida}
                    className="w-full px-4 py-3.5 flex items-start gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marca/60"
                  >
                    <span className="mt-0.5 text-slate-400 flex-shrink-0">
                      {expandida ? <ChevronDown size={16} stroke={1.75} /> : <ChevronRight size={16} stroke={1.75} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-tinta dark:text-slate-100 leading-snug">
                        {e.licitacionNombre || e.licitacionCodigo}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-tinta-2 dark:text-slate-400">
                        <span className="font-mono">{e.licitacionCodigo}</span>
                        {e.organismo && <span className="inline-flex items-center gap-1"><Building2 size={14} stroke={1.75} />{e.organismo}</span>}
                        {/* "Ganado el" = la fecha del ACTA de MP (cuándo se adjudicó de verdad),
                            NO `abiertaAt`, que es cuándo ESTE sistema abrió la entrega. En las
                            entregas cargadas retroactivamente esas dos fechas no tienen nada que
                            ver: `abiertaAt` sería el día del backfill. Solo se cae a `abiertaAt`
                            si el acta todavía no trae fecha. */}
                        <span>Ganado el {r.fechaAdjudicacion ? fechaHora(r.fechaAdjudicacion) : fecha(e.abiertaAt)}</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-tinta dark:text-slate-100 tabular-nums">
                          {clp(r.montoNuestro)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-xs font-medium text-tinta dark:text-slate-100">
                        {e.miAcuse
                          ? <Estado color="#16a34a">Recibido</Estado>
                          : <Estado color="#d97706">Falta tu acuse</Estado>}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
                        <Users size={14} stroke={1.75} /> {e.acusados}/{e.totalAcuses} recibieron
                      </span>
                    </div>
                  </button>

                  {/* ── Resumen ejecutivo ── */}
                  {expandida && (
                    <div className="border-t border-linea dark:border-slate-800 px-4 py-4 space-y-4">
                      {Array.isArray(r.faltantes) && r.faltantes.length > 0 && (
                        <Banner variante="warning">
                          <p className="font-semibold">Este resumen quedó incompleto:</p>
                          <ul className="mt-1 space-y-0.5 list-disc list-inside">
                            {r.faltantes.map((f: string, i: number) => <li key={i}>{f}</li>)}
                          </ul>
                        </Banner>
                      )}

                      {/* Qué ganamos / por qué */}
                      <dl className="grid grid-cols-2 @xl:grid-cols-3 gap-x-4 gap-y-3">
                        <Dato etiqueta="Ofertamos" valor={clp(r.montoOfertado)} />
                        <Dato etiqueta="Nos adjudicaron" valor={clp(r.montoNuestro)} destacado />
                        <Dato etiqueta="Competencia" valor={r.numeroOferentes != null ? `${r.numeroOferentes} oferentes` : '—'} />
                        <Dato etiqueta="Empresa del grupo" valor={r.empresaNombre || '—'} />
                        <Dato etiqueta="Responsable" valor={r.responsableNombre || '—'} />
                        <Dato etiqueta="Total adjudicado" valor={clp(r.montoAdjudicadoTotal)} />
                      </dl>

                      {/* Multas por atraso — plata en juego si el proyecto se retrasa. Sacadas por
                          la IA de viabilidad al postular (Módulo Plazos); rojo a propósito, no es
                          un dato informativo más. */}
                      {r.multas && (r.multas.costoPorDia || r.multas.estructura) && (
                        <div className="flex items-start gap-2.5 text-[13px] text-red-800 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 dark:bg-red-950/30 dark:border-red-900 dark:text-red-200">
                          <ShieldAlert size={16} stroke={1.75} className="mt-0.5 flex-shrink-0 text-urgente" />
                          <div className="space-y-0.5">
                            <p className="font-semibold">Multas por atraso</p>
                            {r.multas.estructura && <p>{r.multas.estructura}</p>}
                            <p className="flex flex-wrap gap-x-3 text-xs">
                              {r.multas.costoPorDia && <span><span className="text-red-700 dark:text-red-300">Por día:</span> {r.multas.costoPorDia}</span>}
                              {r.multas.costoMaximo && <span><span className="text-red-700 dark:text-red-300">Tope:</span> {r.multas.costoMaximo}</span>}
                            </p>
                            {r.multas.umbralTermino && (
                              <p className="text-xs"><span className="text-red-700 dark:text-red-300">Término anticipado:</span> {r.multas.umbralTermino}</p>
                            )}
                            {r.multas.fuente && <p className="text-xs text-red-700 dark:text-red-300">Fuente: {r.multas.fuente}</p>}
                          </div>
                        </div>
                      )}

                      {Array.isArray(r.garantias) && r.garantias.length > 0 && (
                        <Seccion titulo="Garantías comprometidas">
                          <ul className="space-y-1">
                            {r.garantias.map((g: any, i: number) => (
                              <li key={i} className="text-[13px] text-tinta dark:text-slate-200">
                                <span className="text-tinta-2 dark:text-slate-400">{g.titulo}:</span> {g.descripcion || '—'}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {(Array.isArray(r.riesgosViabilidad) && r.riesgosViabilidad.length > 0) ||
                       (Array.isArray(r.alertasViabilidad) && r.alertasViabilidad.length > 0) ? (
                        <Seccion titulo="Riesgos detectados por la viabilidad IA">
                          <ul className="space-y-1">
                            {[...(r.riesgosViabilidad || []), ...(r.alertasViabilidad || [])].map((txt: string, i: number) => (
                              <li key={i} className="flex items-start gap-1.5 text-[13px] text-tinta dark:text-slate-200">
                                <AlertTriangle size={14} stroke={1.75} className="mt-0.5 flex-shrink-0 text-alerta" />
                                {txt}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      ) : null}

                      {Array.isArray(r.competidoresAdjudicados) && r.competidoresAdjudicados.length > 0 && (
                        <Seccion titulo="Otros adjudicados en esta licitación">
                          <ul className="space-y-1">
                            {r.competidoresAdjudicados.map((c: any, i: number) => (
                              <li key={i} className="text-[13px] text-tinta dark:text-slate-200">
                                {c.proveedor || c.rut || 'Sin identificar'}
                                <span className="text-tinta-2"> · {c.lineas} línea{c.lineas !== 1 ? 's' : ''}</span>
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {Array.isArray(r.plazosComprometidos) && r.plazosComprometidos.length > 0 && (
                        <Seccion titulo="Plazos comprometidos">
                          <ul className="space-y-1">
                            {r.plazosComprometidos.map((p: any, i: number) => (
                              <li key={i} className="text-[13px] text-tinta dark:text-slate-200">
                                <span className="text-tinta-2 dark:text-slate-400">{p.titulo}:</span> {p.valor || '—'}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {Array.isArray(r.compromisosPostventa) && r.compromisosPostventa.length > 0 && (
                        <Seccion titulo="Compromisos de postventa">
                          <ul className="space-y-1">
                            {r.compromisosPostventa.map((p: any, i: number) => (
                              <li key={i} className="text-[13px] text-tinta dark:text-slate-200">
                                <span className="text-tinta-2 dark:text-slate-400">{p.titulo}:</span> {p.descripcion || '—'}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {r.contactosCliente && (
                        <Seccion titulo="Contacto del cliente">
                          <div className="text-[13px] text-tinta dark:text-slate-200 space-y-0.5">
                            <p>{r.contactosCliente.organismo || '—'}{r.contactosCliente.unidad ? ` · ${r.contactosCliente.unidad}` : ''}</p>
                            {r.contactosCliente.direccion && (
                              <p className="text-tinta-2 dark:text-slate-400">
                                {r.contactosCliente.direccion}
                                {r.contactosCliente.comuna ? `, ${r.contactosCliente.comuna}` : ''}
                                {r.contactosCliente.region ? `, ${r.contactosCliente.region}` : ''}
                              </p>
                            )}
                            {r.contactosCliente.usuarioNombre && (
                              <p className="inline-flex items-center gap-1 text-tinta-2 dark:text-slate-400">
                                <User size={14} stroke={1.75} /> {r.contactosCliente.usuarioNombre}
                                {r.contactosCliente.usuarioCargo ? ` — ${r.contactosCliente.usuarioCargo}` : ''}
                              </p>
                            )}
                          </div>
                        </Seccion>
                      )}

                      {r.matrizTecnica && r.matrizTecnica.total > 0 && (
                        <Seccion titulo="Matriz técnica aprobada">
                          <p className="text-[13px] text-tinta dark:text-slate-200">
                            {r.matrizTecnica.cumplen} cumplen · {r.matrizTecnica.conComplemento} con complemento ·{' '}
                            {r.matrizTecnica.noCumplen} no cumplen <span className="text-tinta-2">(de {r.matrizTecnica.total})</span>
                          </p>
                        </Seccion>
                      )}

                      {/* Documentos propios subidos durante la postulación — viajan CON la
                          entrega, no como un link a que alguien vaya a buscarlos aparte. */}
                      {Array.isArray(r.documentosPropios) && r.documentosPropios.length > 0 && (
                        <Seccion titulo="Documentos">
                          <ul className="space-y-1">
                            {r.documentosPropios.map((d: any, i: number) => (
                              <li key={i} className="flex items-center gap-2 text-[13px] text-tinta dark:text-slate-200">
                                <Paperclip size={14} stroke={1.75} className="text-slate-400 flex-shrink-0" />
                                <span className="truncate flex-1">{d.nombre}</span>
                                {d.subidoPorNombre && <span className="text-xs text-tinta-2 flex-shrink-0">subió {d.subidoPorNombre}</span>}
                                <button
                                  onClick={() => setVisorDoc({ nombre: d.nombre, url: d.url })}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-marca hover:underline flex-shrink-0"
                                >
                                  <Eye size={14} stroke={1.75} /> Ver
                                </button>
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {r.urlActa && (
                          <a
                            href={r.urlActa} target="_blank" rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            <FileText size={16} stroke={1.75} /> Ver acta en Mercado Público <ExternalLink size={14} stroke={1.75} />
                          </a>
                        )}
                        <a
                          href={`/negocios/${e.negocioId}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Abrir el negocio
                        </a>
                        {/* El área de entrega trabaja con un documento: se imprime, se adjunta,
                            se archiva con el proyecto. El PDF sale del resumen CONGELADO. */}
                        <a
                          href={`/api/entregas/pdf?negocioId=${e.negocioId}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          <Download size={16} stroke={1.75} /> Descargar resumen (PDF)
                        </a>
                        {!e.miAcuse && (
                          <Boton variante="primario" className="ml-auto" onClick={() => acusar(e.negocioId)} disabled={enviando === e.negocioId}
                            icono={enviando === e.negocioId ? <Loader2 size={16} className="animate-spin" /> : undefined}>
                            {enviando === e.negocioId ? 'Registrando…' : 'Acuso recibo'}
                          </Boton>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />
    </AppLayout>
  );
}

function Dato({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-tinta-2 dark:text-slate-400">{etiqueta}</dt>
      <dd className={`mt-0.5 truncate text-[13px] tabular-nums ${destacado ? 'font-semibold text-tinta dark:text-slate-50' : 'font-medium text-tinta dark:text-slate-100'}`}>{valor}</dd>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-medium text-tinta dark:text-slate-100 mb-1.5">{titulo}</p>
      {children}
    </div>
  );
}
