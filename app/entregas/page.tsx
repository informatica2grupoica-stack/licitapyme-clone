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
import {
  Trophy, Loader2, Inbox, CheckCircle2, Clock, Building2, User, FileText,
  Users, AlertTriangle, ExternalLink, ChevronDown, ChevronRight,
  Search, Filter, X, Calendar, Briefcase, ArrowUpDown, ShieldAlert, Eye, Paperclip, Download,
} from 'lucide-react';

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
    <AppLayout title="Entregas" breadcrumb={[{ label: 'Entregas' }]}>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
              <Trophy size={19} className="text-amber-500" />
            </div>
            <div>
              <h1 className="text-[19px] font-bold text-zinc-900">Entrega de proyectos</h1>
              <p className="text-[13px] text-zinc-500 mt-0.5">
                {hayFiltro || q ? `${filtradas.length} de ${entregas.length}` : 'Proyectos ganados'} según el acta de Mercado Público, con lo que se comprometió al postular.
              </p>
            </div>
          </div>
          {entregas.length > 0 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, código, organismo, responsable o empresa…"
                className="pl-8 pr-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:ring-1 focus:ring-amber-500 outline-none w-80" />
            </div>
          )}
        </div>

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
            <span className="text-[12px] text-zinc-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
            {opciones.responsable.length > 0 && (
              <MultiSelect label="Responsable" icon={<Users size={13} />} options={opciones.responsable} selected={fResponsable} onChange={setFResponsable} minWidth={220} />
            )}
            {opciones.empresa.length > 0 && (
              <MultiSelect label="Empresa" icon={<Briefcase size={13} />} options={opciones.empresa} selected={fEmpresa} onChange={setFEmpresa} minWidth={220} />
            )}
            <MultiSelect label="Estado" icon={<CheckCircle2 size={13} />} options={opciones.estado} selected={fEstado} onChange={setFEstado} minWidth={190} />
            <div className="flex items-center gap-1.5 border border-zinc-200 rounded-lg px-2.5 py-1">
              <Calendar size={13} className="text-zinc-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-zinc-500">Ganado</span>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                max={fechaHasta || undefined}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[118px]" title="Ganado desde" />
              <span className="text-zinc-300">–</span>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                min={fechaDesde || undefined}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[118px]" title="Ganado hasta" />
              {(fechaDesde || fechaHasta) && (
                <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                  title="Quitar rango de fecha" className="text-zinc-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
              )}
            </div>
            {hayFiltro && (
              <button onClick={limpiarFiltros}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-2 rounded-lg transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
            <div className="inline-flex items-center gap-1.5 ml-auto">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400"><ArrowUpDown size={12} /> Ordenar</span>
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
          <div className="flex items-center justify-center py-20 text-zinc-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : entregas.length === 0 ? (
          <div className="text-center py-20">
            <Inbox size={34} className="mx-auto text-zinc-300" />
            <p className="text-[14px] font-semibold text-zinc-600 mt-3">Todavía no hay proyectos ganados por entregar</p>
            <p className="text-[12.5px] text-zinc-400 mt-1 max-w-md mx-auto">
              Cuando Mercado Público publique un acta donde ganemos, el proyecto aparece acá
              automáticamente con su resumen ejecutivo.
            </p>
          </div>
        ) : filtradas.length === 0 ? (
          <div className="text-center py-20">
            <Search size={34} className="mx-auto text-zinc-300" />
            <p className="text-[14px] font-semibold text-zinc-600 mt-3">Sin resultados</p>
            <p className="text-[12.5px] text-zinc-400 mt-1 max-w-md mx-auto">
              Ningún proyecto coincide con la búsqueda o los filtros.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtradas.map(e => {
              const expandida = abierta === e.negocioId;
              const r = e.resumen || {};
              return (
                <div key={e.negocioId} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
                  {/* ── Cabecera de la tarjeta ── */}
                  <button
                    onClick={() => setAbierta(expandida ? null : e.negocioId)}
                    className="w-full px-4 py-3.5 flex items-start gap-3 text-left hover:bg-zinc-50 transition-colors"
                  >
                    <span className="mt-0.5 text-zinc-400 flex-shrink-0">
                      {expandida ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-zinc-900 leading-snug">
                        {e.licitacionNombre || e.licitacionCodigo}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11.5px] text-zinc-500">
                        <span className="font-mono">{e.licitacionCodigo}</span>
                        {e.organismo && <span className="inline-flex items-center gap-1"><Building2 size={11} />{e.organismo}</span>}
                        {/* "Ganado el" = la fecha del ACTA de MP (cuándo se adjudicó de verdad),
                            NO `abiertaAt`, que es cuándo ESTE sistema abrió la entrega. En las
                            entregas cargadas retroactivamente esas dos fechas no tienen nada que
                            ver: `abiertaAt` sería el día del backfill. Solo se cae a `abiertaAt`
                            si el acta todavía no trae fecha. */}
                        <span>Ganado el {r.fechaAdjudicacion ? fechaHora(r.fechaAdjudicacion) : fecha(e.abiertaAt)}</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                          {clp(r.montoNuestro)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {e.miAcuse ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          <CheckCircle2 size={11} /> Recibido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          <Clock size={11} /> Falta tu acuse
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <Users size={11} /> {e.acusados}/{e.totalAcuses} recibieron
                      </span>
                    </div>
                  </button>

                  {/* ── Resumen ejecutivo ── */}
                  {expandida && (
                    <div className="border-t border-zinc-100 px-4 py-4 bg-zinc-50/60 space-y-4">
                      {Array.isArray(r.faltantes) && r.faltantes.length > 0 && (
                        <div className="flex items-start gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-semibold">Este resumen quedó incompleto:</p>
                            <ul className="mt-1 space-y-0.5 list-disc list-inside">
                              {r.faltantes.map((f: string, i: number) => <li key={i}>{f}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Qué ganamos / por qué */}
                      <div className="grid sm:grid-cols-3 gap-3">
                        <Dato etiqueta="Ofertamos" valor={clp(r.montoOfertado)} />
                        <Dato etiqueta="Nos adjudicaron" valor={clp(r.montoNuestro)} destacado />
                        <Dato etiqueta="Competencia" valor={r.numeroOferentes != null ? `${r.numeroOferentes} oferentes` : '—'} />
                        <Dato etiqueta="Empresa del grupo" valor={r.empresaNombre || '—'} />
                        <Dato etiqueta="Responsable" valor={r.responsableNombre || '—'} />
                        <Dato etiqueta="Total adjudicado" valor={clp(r.montoAdjudicadoTotal)} />
                      </div>

                      {/* Multas por atraso — plata en juego si el proyecto se retrasa. Sacadas por
                          la IA de viabilidad al postular (Módulo Plazos); rojo a propósito, no es
                          un dato informativo más. */}
                      {r.multas && (r.multas.costoPorDia || r.multas.estructura) && (
                        <div className="flex items-start gap-2.5 text-[12.5px] text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                          <ShieldAlert size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
                          <div className="space-y-0.5">
                            <p className="font-bold">Multas por atraso</p>
                            {r.multas.estructura && <p>{r.multas.estructura}</p>}
                            <p className="flex flex-wrap gap-x-3 text-[11.5px]">
                              {r.multas.costoPorDia && <span><span className="text-red-500">Por día:</span> {r.multas.costoPorDia}</span>}
                              {r.multas.costoMaximo && <span><span className="text-red-500">Tope:</span> {r.multas.costoMaximo}</span>}
                            </p>
                            {r.multas.umbralTermino && (
                              <p className="text-[11.5px]"><span className="text-red-500">Término anticipado:</span> {r.multas.umbralTermino}</p>
                            )}
                            {r.multas.fuente && <p className="text-[10.5px] text-red-400">Fuente: {r.multas.fuente}</p>}
                          </div>
                        </div>
                      )}

                      {Array.isArray(r.garantias) && r.garantias.length > 0 && (
                        <Seccion titulo="Garantías comprometidas">
                          <ul className="space-y-1">
                            {r.garantias.map((g: any, i: number) => (
                              <li key={i} className="text-[12.5px] text-zinc-700">
                                <span className="text-zinc-500">{g.titulo}:</span> {g.descripcion || '—'}
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
                              <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-zinc-700">
                                <AlertTriangle size={11} className="mt-0.5 flex-shrink-0 text-amber-500" />
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
                              <li key={i} className="text-[12.5px] text-zinc-700">
                                {c.proveedor || c.rut || 'Sin identificar'}
                                <span className="text-zinc-400"> · {c.lineas} línea{c.lineas !== 1 ? 's' : ''}</span>
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {Array.isArray(r.plazosComprometidos) && r.plazosComprometidos.length > 0 && (
                        <Seccion titulo="Plazos comprometidos">
                          <ul className="space-y-1">
                            {r.plazosComprometidos.map((p: any, i: number) => (
                              <li key={i} className="text-[12.5px] text-zinc-700">
                                <span className="text-zinc-500">{p.titulo}:</span> {p.valor || '—'}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {Array.isArray(r.compromisosPostventa) && r.compromisosPostventa.length > 0 && (
                        <Seccion titulo="Compromisos de postventa">
                          <ul className="space-y-1">
                            {r.compromisosPostventa.map((p: any, i: number) => (
                              <li key={i} className="text-[12.5px] text-zinc-700">
                                <span className="text-zinc-500">{p.titulo}:</span> {p.descripcion || '—'}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {r.contactosCliente && (
                        <Seccion titulo="Contacto del cliente">
                          <div className="text-[12.5px] text-zinc-700 space-y-0.5">
                            <p>{r.contactosCliente.organismo || '—'}{r.contactosCliente.unidad ? ` · ${r.contactosCliente.unidad}` : ''}</p>
                            {r.contactosCliente.direccion && (
                              <p className="text-zinc-500">
                                {r.contactosCliente.direccion}
                                {r.contactosCliente.comuna ? `, ${r.contactosCliente.comuna}` : ''}
                                {r.contactosCliente.region ? `, ${r.contactosCliente.region}` : ''}
                              </p>
                            )}
                            {r.contactosCliente.usuarioNombre && (
                              <p className="inline-flex items-center gap-1 text-zinc-600">
                                <User size={11} /> {r.contactosCliente.usuarioNombre}
                                {r.contactosCliente.usuarioCargo ? ` — ${r.contactosCliente.usuarioCargo}` : ''}
                              </p>
                            )}
                          </div>
                        </Seccion>
                      )}

                      {r.matrizTecnica && r.matrizTecnica.total > 0 && (
                        <Seccion titulo="Matriz técnica aprobada">
                          <p className="text-[12.5px] text-zinc-700">
                            {r.matrizTecnica.cumplen} cumplen · {r.matrizTecnica.conComplemento} con complemento ·{' '}
                            {r.matrizTecnica.noCumplen} no cumplen <span className="text-zinc-400">(de {r.matrizTecnica.total})</span>
                          </p>
                        </Seccion>
                      )}

                      {/* Documentos propios subidos durante la postulación — viajan CON la
                          entrega, no como un link a que alguien vaya a buscarlos aparte. */}
                      {Array.isArray(r.documentosPropios) && r.documentosPropios.length > 0 && (
                        <Seccion titulo="Documentos">
                          <ul className="space-y-1">
                            {r.documentosPropios.map((d: any, i: number) => (
                              <li key={i} className="flex items-center gap-2 text-[12.5px] text-zinc-700">
                                <Paperclip size={11} className="text-zinc-400 flex-shrink-0" />
                                <span className="truncate flex-1">{d.nombre}</span>
                                {d.subidoPorNombre && <span className="text-[10.5px] text-zinc-400 flex-shrink-0">subió {d.subidoPorNombre}</span>}
                                <button
                                  onClick={() => setVisorDoc({ nombre: d.nombre, url: d.url })}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex-shrink-0"
                                >
                                  <Eye size={11} /> Ver
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
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                          >
                            <FileText size={12} /> Ver acta en Mercado Público <ExternalLink size={11} />
                          </a>
                        )}
                        <a
                          href={`/negocios/${e.negocioId}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                        >
                          Abrir el negocio
                        </a>
                        {/* El área de entrega trabaja con un documento: se imprime, se adjunta,
                            se archiva con el proyecto. El PDF sale del resumen CONGELADO. */}
                        <a
                          href={`/api/entregas/pdf?negocioId=${e.negocioId}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                        >
                          <Download size={12} /> Descargar resumen (PDF)
                        </a>
                        {!e.miAcuse && (
                          <button
                            onClick={() => acusar(e.negocioId)}
                            disabled={enviando === e.negocioId}
                            className="ml-auto inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-[12.5px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 transition-colors"
                          >
                            {enviando === e.negocioId
                              ? <><Loader2 size={13} className="animate-spin" /> Registrando…</>
                              : 'Acuso recibo'}
                          </button>
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
    <div className="bg-white border border-zinc-200 rounded-lg px-3 py-2">
      <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wide">{etiqueta}</p>
      <p className={`text-[13px] mt-0.5 ${destacado ? 'font-bold text-emerald-700' : 'font-semibold text-zinc-800'}`}>{valor}</p>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">{titulo}</p>
      {children}
    </div>
  );
}
