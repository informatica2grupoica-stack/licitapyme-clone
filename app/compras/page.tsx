'use client';

// MÓDULO DE COMPRAS — listado transversal (Fase 1, spec §3-§5). Un negocio ganado por fila: quién
// lo tiene, si vence el plazo de asignación, si es urgente y cuánto avanzó de sus tareas. El
// detalle completo (resumen ejecutivo + tareas) vive en la pestaña "Compras" de cada negocio.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dayjs from 'dayjs';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { useRealtime } from '@/app/lib/use-realtime';
import { GanttComprasCard } from '@/app/negocios/[id]/GanttComprasCard';
import { IconShoppingCart as ShoppingCart, IconLoader2 as Loader2, IconBuilding as Building2, IconArrowUpRight as ArrowUpRight, IconSearch as Search, IconFilter as Filter, IconX as X, IconCalendar as Calendar, IconUsers as Users, IconArrowsUpDown as ArrowUpDown, IconAlertTriangle as AlertTriangle, IconClock as Clock, IconUserPlus as UserPlus, IconCircleCheck as CheckCircle2, IconChartBar as BarChart3, IconChevronLeft as ChevronLeft, IconChevronRight as ChevronRight, IconChevronsLeft as ChevronsLeft, IconChevronsRight as ChevronsRight, IconList as List, IconPackage as PackageCheck, IconCircleX as XCircle, IconArchive as Archive, IconArrowBackUp as Undo2, IconPencil as Pencil, IconTimeline as GanttChart, IconZoomIn as ZoomIn, IconZoomOut as ZoomOut, IconDiamond as Diamond, IconCalendarClock as CalendarClock, IconLayoutSidebarRightCollapse as PanelRightClose } from '@tabler/icons-react';

type CierreLegado = 'ENTREGADA' | 'NO_REALIZADA';
type EstadoTareaGantt = 'PENDIENTE' | 'EN_CURSO' | 'HECHA';

interface TareaGantt {
  id: number; titulo: string; categoria: string; estado: EstadoTareaGantt; responsableNombre: string | null;
  plazoAt: string | null; creadoAt: string; cerradoAt: string | null; vencida: boolean;
}

interface RelojEntregaResumen { fechaLimiteVigente: string | null; prorrogado: boolean; prorrogaMotivo: string | null; prorrogaAutorizadoPorNombre: string | null }

interface ComprasFila {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; licitacionOrganismo: string | null;
  urgente: boolean; asignadoA: number | null; asignadoNombre: string | null; asignadoAt: string | null;
  vencimientoAsignacionAt: string; ganadoAt: string; montoNuestro: number | null;
  tareasTotal: number; tareasHechas: number; tareasVencidas: number;
  ocFecha: string | null;
  cierreLegado: CierreLegado | null;
  plazoEntregaDias: number | null;
  postuladoPorNombre: string | null;
  plazoAceptacionOCDias: number | null;
  tareasGantt: TareaGantt[];
  reloj: RelojEntregaResumen | null;
}
interface Candidato { id: number; nombre: string | null; carga: number }

const SS_COMPRAS_FILTROS = 'compras:filtros:v1';

// "Urgente" = Cadena de Urgencia (§3.7/§15.2): el plazo de entrega OFERTADO es menor a 3 días —
// no es una cuenta regresiva desde hoy, es que el compromiso mismo era muy corto. Un solo texto
// para no repetir la frase en cada lugar donde se explica.
const explicacionUrgente = (f: ComprasFila) =>
  f.plazoEntregaDias != null
    ? `Urgente: el plazo de entrega ofertado es de ${f.plazoEntregaDias} día(s) — menos de 3, entra en la Cadena de Urgencia.`
    : 'Urgente: el plazo de entrega ofertado es menor a 3 días (Cadena de Urgencia).';

type Orden = 'reciente' | 'antiguo' | 'monto_desc' | 'monto_asc';
type Vista = 'gantt' | 'lista' | 'mes';

// Chip de perfil asignado — mismo par color+iniciales que Negocios (app/lib/user-color.ts), para
// reconocer a la misma persona de un vistazo entre módulos, pero acá en círculo relleno (no punto)
// porque en Compras el encargado es UN dato central de la fila, no un filtro de fondo.
function AvatarAsignado({ nombre, seed, size = 22 }: { nombre: string | null; seed: string | number | null; size?: number }) {
  if (!nombre) return null;
  return (
    <span
      style={{ background: colorUsuario(seed), width: size, height: size, fontSize: size * 0.4 }}
      className="inline-flex items-center justify-center rounded-full text-white font-bold flex-shrink-0"
      title={nombre}
    >
      {inicialesUsuario(nombre, null)}
    </span>
  );
}

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
// Versión abreviada del monto para las tarjetas compactas (vista de 2/3 meses) — el monto completo
// no cabía y se cortaba a la mitad ("$2..."), que es justo el dato que no puede perderse. Redondea
// a 1 decimal en millones/miles.
const fmtCLPCorto = (n: number | null) => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1).replace('.0', '')}K`;
  return `$${n}`;
};
const fmtFecha = (s: string) => {
  try { return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};
// ocFecha viene solo con día (la OC trae fecha, no hora) — formato corto aparte para no mostrar
// "00:00" como si fuera una hora real.
const fmtFechaCorta = (s: string) => {
  try { return new Date(`${s}T00:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return s; }
};

// Botones de cierre legado (backlog histórico) — deliberadamente separados del flujo de
// Entrega/Fracaso (ver app/lib/compras.ts, marcarCierreLegado). Solo jefe de ventas.
function AccionesCierreLegado({ f, onCambio }: { f: ComprasFila; onCambio: () => void }) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);

  const marcar = async (estado: CierreLegado) => {
    setCargando(true);
    try {
      const res = await fetch(`/api/compras/${f.negocioId}/cierre-legado`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo marcar');
      toast.success(estado === 'ENTREGADA' ? 'Marcada como entregada' : 'Marcada como no realizada');
      onCambio();
    } catch (e: any) {
      toast.error('No se pudo marcar', e.message);
    } finally {
      setCargando(false);
    }
  };

  const deshacer = async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/compras/${f.negocioId}/cierre-legado`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo deshacer');
      onCambio();
    } catch (e: any) {
      toast.error('No se pudo deshacer', e.message);
    } finally {
      setCargando(false);
    }
  };

  if (f.cierreLegado) {
    return (
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${
          f.cierreLegado === 'ENTREGADA' ? 'text-emerald-700 bg-emerald-50' : 'text-zinc-500 bg-zinc-100'
        }`}>
          {f.cierreLegado === 'ENTREGADA' ? <PackageCheck size={11} /> : <XCircle size={11} />}
          {f.cierreLegado === 'ENTREGADA' ? 'Entregada (histórico)' : 'No realizada (histórico)'}
        </span>
        <button onClick={deshacer} disabled={cargando} title="Deshacer"
          className="text-zinc-400 hover:text-zinc-600 disabled:opacity-50"><Undo2 size={13} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => marcar('ENTREGADA')} disabled={cargando}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors">
        <PackageCheck size={11} /> Entregada
      </button>
      <button onClick={() => marcar('NO_REALIZADA')} disabled={cargando}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors">
        <XCircle size={11} /> No realizada
      </button>
    </div>
  );
}

function FilaCompras({ f, esJefeDeVentas, esAdmin, candidatos, onAsignado }: {
  f: ComprasFila; esJefeDeVentas: boolean; esAdmin: boolean; candidatos: Candidato[]; onAsignado: () => void;
}) {
  const toast = useToast();
  const [candidatoElegido, setCandidatoElegido] = useState('');
  const [asignando, setAsignando] = useState(false);
  // Reasignar (pedido explícito del usuario, 15-sep-2026): antes solo se podía elegir encargado
  // mientras el negocio estaba "sin asignar" — una vez asignado no había forma de cambiarlo desde
  // acá. El endpoint /asignar ya soportaba reasignar (no valida "ya tiene encargado"), solo faltaba
  // la UI.
  const [reasignando, setReasignando] = useState(false);
  const vencimientoPasado = new Date(f.vencimientoAsignacionAt.replace(' ', 'T')).getTime() < Date.now();

  const asignar = async () => {
    if (!candidatoElegido) return;
    setAsignando(true);
    try {
      const res = await fetch(`/api/compras/${f.negocioId}/asignar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encargadoId: Number(candidatoElegido) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo asignar');
      toast.success('Encargado asignado');
      setReasignando(false);
      setCandidatoElegido('');
      onAsignado();
    } catch (e: any) {
      toast.error('No se pudo asignar', e.message);
    } finally {
      setAsignando(false);
    }
  };

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${f.urgente ? 'border-rose-200' : 'border-zinc-200'}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[11px] font-mono text-zinc-400">{f.licitacionCodigo}</p>
            <span className="text-[10.5px] text-zinc-400">Ganado {fmtFecha(f.ganadoAt)}</span>
            {f.ocFecha && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600">
                <PackageCheck size={11} /> OC {fmtFechaCorta(f.ocFecha)}
              </span>
            )}
            {f.urgente ? (
              <span title={explicacionUrgente(f)}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full cursor-help">
                <AlertTriangle size={10} /> Urgente{f.plazoEntregaDias != null ? ` · entrega en ${f.plazoEntregaDias} día(s)` : ''}
              </span>
            ) : f.plazoEntregaDias != null && (
              // Plazo de entrega visible siempre, no solo cuando es urgente — pedido explícito del
              // usuario, 16-sep-2026: necesita ver los días de TODAS las licitaciones de Compras
              // para transcribirlos al Auditor Técnico.
              <span title="Plazo de entrega ofertado"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-full">
                <Clock size={10} /> Entrega: {f.plazoEntregaDias} día(s)
              </span>
            )}
          </div>
          <Link href={`/compras/${f.negocioId}`} className="block text-[13.5px] font-bold text-zinc-800 hover:text-teal-700 leading-snug mt-0.5">
            {f.licitacionNombre || f.licitacionCodigo}
          </Link>
          <div className="flex items-center gap-3 mt-1 text-[11.5px] text-zinc-500 flex-wrap">
            {f.licitacionOrganismo && <span className="flex items-center gap-1"><Building2 size={11} /> {f.licitacionOrganismo}</span>}
            {f.tareasTotal > 0 && (
              <span className={`flex items-center gap-1 ${f.tareasVencidas > 0 ? 'text-rose-600 font-semibold' : ''}`}>
                <CheckCircle2 size={11} /> {f.tareasHechas}/{f.tareasTotal} tareas
                {f.tareasVencidas > 0 && ` · ${f.tareasVencidas} vencida(s)`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[12px] font-semibold text-zinc-600">{fmtCLP(f.montoNuestro)}</span>
          <Link href={`/compras/${f.negocioId}`} className="text-zinc-400 hover:text-teal-600"><ArrowUpRight size={16} /></Link>
        </div>
      </div>

      <div className="border-t border-zinc-100 px-4 py-2.5 bg-zinc-50/60 flex items-center justify-between gap-3 flex-wrap">
        {f.asignadoA && !reasignando ? (
          <p className="text-[12px] text-zinc-600 flex items-center gap-1.5">
            <AvatarAsignado nombre={f.asignadoNombre} seed={f.asignadoA} />
            <span className="font-semibold text-zinc-800">{f.asignadoNombre}</span>
            <span className="text-zinc-400"> — asignado {fmtFecha(f.asignadoAt || f.ganadoAt)}</span>
            {esAdmin && (
              <button onClick={() => setReasignando(true)} title="Cambiar encargado"
                className="text-zinc-400 hover:text-teal-600"><Pencil size={12} /></button>
            )}
          </p>
        ) : f.asignadoA && reasignando && esAdmin ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={candidatoElegido} onChange={setCandidatoElegido}
              placeholder="Nuevo encargado…" minWidth={200}
              options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga})` }))}
            />
            <button onClick={asignar} disabled={!candidatoElegido || asignando}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
              {asignando ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Cambiar
            </button>
            <button onClick={() => { setReasignando(false); setCandidatoElegido(''); }} disabled={asignando}
              className="text-[11.5px] text-zinc-500 hover:text-zinc-700 px-1.5 py-1.5">Cancelar</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11.5px] flex items-center gap-1 ${vencimientoPasado ? 'text-rose-600 font-semibold' : 'text-amber-600'}`}>
              <Clock size={12} /> {vencimientoPasado ? 'Plazo vencido — se asigna solo' : `Sin asignar (vence ${fmtFecha(f.vencimientoAsignacionAt)})`}
            </span>
            {esJefeDeVentas && (
              <>
                <Select
                  value={candidatoElegido} onChange={setCandidatoElegido}
                  placeholder="Elegir encargado…" minWidth={200}
                  options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga})` }))}
                />
                <button onClick={asignar} disabled={!candidatoElegido || asignando}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                  {asignando ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Asignar
                </button>
              </>
            )}
          </div>
        )}
        {esJefeDeVentas && <AccionesCierreLegado f={f} onCambio={onAsignado} />}
      </div>
    </div>
  );
}

// ── Vista mensual (por fecha de ganado_at) ──────────────────────────────────────────
// Pasó por dos anclas antes de esta (11-sep-2026): fecha de cierre (no sirve, el negocio ya se
// ganó — la licitación cerró hace semanas) y fecha de la OC (§3.6, `oc_aceptada_at`/
// `oc_emitida_at`) — se descartó porque esa fecha varía según lo que pida cada organismo en sus
// propias bases, no es comparable entre negocios. `ganado_at` (fecha real de adjudicación) es la
// única segura y consistente para todos — pedido explícito del usuario. La fecha de la OC se
// sigue mostrando como dato informativo en cada tarjeta ("OC dd-mm-aaaa"), solo que ya no ordena
// el calendario.
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Tarjeta de negocio dentro de un cuadro del mes — mismos campos que FilaCompras (lista), apilados
// en vertical porque la columna del día es angosta. Pedido explícito del usuario: "quiero que me
// entregue la misma info que me entregaba en lista, pero en el cuadro del día".
function TarjetaDiaCompras({ f, compacta = false }: { f: ComprasFila; compacta?: boolean }) {
  const acento = f.urgente ? '#e11d48' : colorUsuario(f.asignadoA ?? f.asignadoNombre);
  // Variante compacta (vista de 2/3 meses a la vez, pedido explícito del usuario 16-sep-2026):
  // el cuadro del día es mucho más chico, así que se corta a lo esencial — nombre, monto,
  // plazo/urgente y encargado — pero sin perder el dato que importa (código, organismo y tareas
  // se sacrifican, se ven completos abriendo el "+N más" o entrando al negocio).
  if (compacta) {
    return (
      <Link href={`/compras/${f.negocioId}`}
        style={{ borderLeftColor: acento }}
        title={`${f.licitacionNombre || f.licitacionCodigo} — ${fmtCLP(f.montoNuestro)}`}
        className={`block rounded-md border border-zinc-200 border-l-[3px] bg-white px-1.5 py-1 shadow-sm transition-all hover:shadow-md ${f.urgente ? 'ring-1 ring-rose-100' : ''}`}>
        <p className="text-[10px] font-bold text-zinc-800 leading-snug line-clamp-2">{f.licitacionNombre || f.licitacionCodigo}</p>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-[9.5px] font-bold text-teal-700 flex-shrink-0">{fmtCLPCorto(f.montoNuestro)}</span>
          {f.urgente ? (
            <span title={explicacionUrgente(f)} className="inline-flex items-center gap-0.5 text-[8px] font-bold text-rose-700 bg-rose-50 px-1 py-0.5 rounded-full flex-shrink-0 cursor-help">
              <AlertTriangle size={7} /> {f.plazoEntregaDias != null ? `${f.plazoEntregaDias}d` : 'Urg'}
            </span>
          ) : f.plazoEntregaDias != null && (
            <span title="Plazo de entrega ofertado" className="text-[8px] font-semibold text-zinc-400 bg-zinc-100 px-1 py-0.5 rounded-full flex-shrink-0">{f.plazoEntregaDias}d</span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <AvatarAsignado nombre={f.asignadoNombre} seed={f.asignadoA ?? f.asignadoNombre} size={13} />
          <span className="text-[9px] font-medium text-zinc-500 truncate">{f.asignadoNombre || 'Sin asignar'}</span>
        </div>
      </Link>
    );
  }
  return (
    <Link href={`/compras/${f.negocioId}`}
      style={{ borderLeftColor: acento }}
      className={`block rounded-lg border border-zinc-200 border-l-[4px] bg-white px-2.5 py-2 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${f.urgente ? 'ring-1 ring-rose-100' : ''}`}>
      <div className="flex items-center justify-between gap-1">
        <p className="text-[9.5px] font-mono text-zinc-400">{f.licitacionCodigo}</p>
        {f.cierreLegado ? (
          <span className={`inline-flex items-center gap-0.5 text-[8.5px] font-bold px-1 py-0.5 rounded-full flex-shrink-0 ${
            f.cierreLegado === 'ENTREGADA' ? 'text-emerald-700 bg-emerald-50' : 'text-zinc-500 bg-zinc-100'
          }`}>
            {f.cierreLegado === 'ENTREGADA' ? <PackageCheck size={8} /> : <XCircle size={8} />}
            {f.cierreLegado === 'ENTREGADA' ? 'Entregada' : 'No realizada'}
          </span>
        ) : f.urgente ? (
          <span title={explicacionUrgente(f)}
            className="inline-flex items-center gap-0.5 text-[8.5px] font-bold text-rose-700 bg-rose-50 px-1 py-0.5 rounded-full flex-shrink-0 cursor-help">
            <AlertTriangle size={8} /> Urgente{f.plazoEntregaDias != null ? ` · ${f.plazoEntregaDias}d` : ''}
          </span>
        ) : f.plazoEntregaDias != null && (
          <span title="Plazo de entrega ofertado"
            className="inline-flex items-center gap-0.5 text-[8.5px] font-semibold text-zinc-500 bg-zinc-100 px-1 py-0.5 rounded-full flex-shrink-0">
            <Clock size={8} /> {f.plazoEntregaDias}d
          </span>
        )}
      </div>
      <p className="text-[12px] font-bold text-zinc-800 leading-snug line-clamp-2 mt-0.5">{f.licitacionNombre || f.licitacionCodigo}</p>
      {f.licitacionOrganismo && (
        <p className="text-[9.5px] text-zinc-500 flex items-center gap-1 mt-0.5 truncate"><Building2 size={9} className="flex-shrink-0" /> {f.licitacionOrganismo}</p>
      )}
      <div className="flex items-center justify-between gap-1 mt-1.5">
        <span className="text-[11px] font-bold text-teal-700">{fmtCLP(f.montoNuestro)}</span>
        {f.tareasTotal > 0 && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${f.tareasVencidas > 0 ? 'text-rose-700 bg-rose-50' : 'text-zinc-500 bg-zinc-100'}`}>{f.tareasHechas}/{f.tareasTotal} tareas</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-zinc-100">
        <AvatarAsignado nombre={f.asignadoNombre} seed={f.asignadoA ?? f.asignadoNombre} size={17} />
        <span className="text-[10px] font-semibold text-zinc-600 truncate">{f.asignadoNombre || 'Sin asignar'}</span>
      </div>
      {/* Quien postuló/preparó la licitación en Negocios (negocios.asignado_a) — persona distinta
         del encargado de Compras de arriba, que la ejecuta recién después de ganada. Pedido
         explícito del usuario, 15-sep-2026. */}
      {f.postuladoPorNombre && (
        <div className="flex items-center gap-1.5 mt-1 text-[9.5px] text-zinc-400 truncate">
          <Users size={11} className="flex-shrink-0" />
          <span className="truncate">Postuló: <span className="font-semibold text-zinc-500">{f.postuladoPorNombre}</span></span>
        </div>
      )}
    </Link>
  );
}

// Grilla plana de urgentes (Cadena de Urgencia, §3.7/§15.2) — pedido explícito del usuario:
// con el filtro "Urgentes" activo NO quiere el calendario (agrupar por día no ayuda acá, lo que
// importa es verlas TODAS juntas), quiere cuadros como los del mes pero sin organizar por fecha.
// Reusa la misma tarjeta que el calendario — mismo nivel de detalle, mismo criterio visual.
function VistaUrgentesCompras({ negocios }: { negocios: ComprasFila[] }) {
  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-rose-600 flex items-center gap-1.5">
        <AlertTriangle size={12} /> {explicacionUrgente({ plazoEntregaDias: null } as ComprasFila)}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {negocios.map(f => <TarjetaDiaCompras key={f.negocioId} f={f} />)}
      </div>
    </div>
  );
}

// Grilla de UN mes — extraída para poder repetirla 1, 2 o 3 veces lado a lado (vista de varios
// meses) sin duplicar la lógica de armado del calendario.
function GrillaMesCompras({ mes, porDia, hoy, compacta, onAbrirDia }: {
  mes: dayjs.Dayjs; porDia: Map<string, ComprasFila[]>; hoy: string; compacta: boolean; onAbrirDia: (key: string) => void;
}) {
  const inicio = mes.startOf('month');
  const offset = (inicio.day() + 6) % 7; // lunes = 0
  const gridStart = inicio.subtract(offset, 'day');
  const dias = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const MOSTRAR_MAX = compacta ? 1 : 2; // con varios meses a la vista, un cupo por día basta — el resto queda en "+N más"

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
      <div className={`text-center bg-gradient-to-r from-teal-600 to-teal-700 ${compacta ? 'py-1.5' : 'py-2.5'}`}>
        <span className={`font-bold text-white capitalize ${compacta ? 'text-[12.5px]' : 'text-[14px]'}`}>{MESES[mes.month()]} {mes.year()}</span>
      </div>
      <div className={compacta ? 'p-1.5' : 'p-3'}>
        <div className={`grid grid-cols-7 ${compacta ? 'gap-1 mb-1' : 'gap-1.5 mb-1.5'}`}>
          {SEMANA.map(d => (
            <div key={d} className={`text-center font-bold text-teal-700 bg-teal-50 rounded-md ${compacta ? 'text-[9px] py-0.5' : 'text-[10.5px] py-1'}`}>
              {compacta ? d[0] : d}
            </div>
          ))}
        </div>
        <div className={`grid grid-cols-7 ${compacta ? 'gap-1' : 'gap-1.5'}`}>
          {dias.map(d => {
            const k = d.format('YYYY-MM-DD');
            const items = porDia.get(k) || [];
            const fueraMes = d.month() !== mes.month();
            const esHoy = k === hoy;
            const hayUrgente = items.some(f => f.urgente);
            const visibles = items.slice(0, MOSTRAR_MAX);
            const resto = items.length - visibles.length;
            return (
              <div key={k}
                className={`${compacta ? 'min-h-[86px]' : 'min-h-[150px]'} rounded-lg border p-1 flex flex-col gap-1 transition-colors ${
                  fueraMes ? 'bg-zinc-50/50 border-zinc-100'
                  : esHoy ? 'border-teal-400 bg-teal-50/40 ring-1 ring-teal-200'
                  : items.length > 0 ? 'border-zinc-200 bg-white shadow-sm' : 'border-zinc-100 bg-zinc-50/30'
                }`}>
                <div className="flex items-center justify-between px-0.5">
                  <span className={esHoy
                    ? `bg-teal-600 text-white rounded-full inline-flex items-center justify-center font-bold shadow-sm ${compacta ? 'w-4.5 h-4.5 text-[9.5px]' : 'w-5.5 h-5.5 text-[11px]'}`
                    : `font-bold ${fueraMes ? 'text-zinc-300' : 'text-zinc-600'} ${compacta ? 'text-[10px]' : 'text-[11.5px]'}`}>{d.date()}</span>
                  {items.length > 0 && (
                    <span className={`font-bold rounded-full tabular-nums ${hayUrgente ? 'text-rose-700 bg-rose-50' : 'text-teal-700 bg-teal-50'} ${compacta ? 'text-[8.5px] px-1' : 'text-[9.5px] px-1.5 py-0.5'}`}>{items.length}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-1 min-h-0">
                  {visibles.map(f => <TarjetaDiaCompras key={f.negocioId} f={f} compacta={compacta} />)}
                  {resto > 0 && (
                    <button onClick={() => onAbrirDia(k)}
                      className={`font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md transition-colors ${compacta ? 'text-[8.5px] py-0.5' : 'text-[10px] py-1'}`}>
                      +{resto} más
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type MesesVista = 1 | 2 | 3;

// Vista mensual — pedido explícito del usuario (16-sep-2026): poder ver 2 o 3 meses a la vez para
// planificar entregas con más rango, con cuadros más chicos (variante `compacta` de la tarjeta)
// pero sin perder los datos clave (nombre, monto, plazo de entrega, encargado).
function VistaMensualCompras({ negocios, onAbrirDia, mesesVista }: {
  negocios: ComprasFila[]; onAbrirDia: (key: string) => void; mesesVista: MesesVista;
}) {
  const [mes, setMes] = useState(() => dayjs().startOf('month'));

  // Ancla en ganado_at (fecha real de adjudicación) — pedido explícito del usuario, 11-sep-2026:
  // la fecha de la OC varía según lo que pida cada organismo en sus bases, ganado_at es la única
  // que es segura y consistente para todos los negocios. Como es NOT NULL, todo negocio SIEMPRE
  // cae en algún día — ya no hay bucket de "sin fecha".
  const porDia = useMemo(() => {
    const m = new Map<string, ComprasFila[]>();
    for (const f of negocios) {
      const k = f.ganadoAt.slice(0, 10);
      (m.get(k) || m.set(k, []).get(k)!).push(f);
    }
    return m;
  }, [negocios]);

  const hoy = dayjs().format('YYYY-MM-DD');
  const esMesActual = mes.format('YYYY-MM') === dayjs().format('YYYY-MM');
  const compacta = mesesVista > 1;

  // Meses que SÍ tienen algún negocio (por ganado_at), para saltar directo en vez de ir mes a mes.
  const mesesConDatos = useMemo(() => {
    const s = new Set<string>();
    for (const f of negocios) s.add(f.ganadoAt.slice(0, 7));
    return [...s].sort();
  }, [negocios]);
  const actualYYYYMM = mes.format('YYYY-MM');
  const mesAnteriorConDatos = [...mesesConDatos].reverse().find(m => m < actualYYYYMM) || null;
  const mesSiguienteConDatos = mesesConDatos.find(m => m > actualYYYYMM) || null;

  const rango = mesesVista === 1 ? MESES[mes.month()] + ' ' + mes.year()
    : `${MESES[mes.month()]} ${mes.year()} – ${MESES[mes.add(mesesVista - 1, 'month').month()]} ${mes.add(mesesVista - 1, 'month').year()}`;
  const mesesARenderizar = Array.from({ length: mesesVista }, (_, i) => mes.add(i, 'month'));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-teal-600 to-teal-700 rounded-2xl shadow-sm">
        <div className="flex items-center gap-0.5">
          <button onClick={() => mesAnteriorConDatos && setMes(dayjs(`${mesAnteriorConDatos}-01`))} disabled={!mesAnteriorConDatos}
            title="Saltar al mes anterior con negocios ganados" aria-label="Ganada anterior"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"><ChevronsLeft size={16} /></button>
          <button onClick={() => setMes(m => m.subtract(1, 'month'))} aria-label="Mes anterior"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white transition-colors"><ChevronLeft size={18} /></button>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-bold text-white capitalize">{rango}</span>
          {/* Siempre visible (antes se ocultaba en el mes actual y eso confundía — parecía que
              "Hoy" fallaba justo en septiembre). Acá queda deshabilitado en vez de desaparecer. */}
          <button onClick={() => setMes(dayjs().startOf('month'))} disabled={esMesActual}
            className={`text-[10.5px] font-bold px-2 py-1 rounded-full transition-colors ${
              esMesActual ? 'text-white/50 bg-white/10 cursor-default' : 'text-teal-700 bg-white hover:bg-teal-50'
            }`}>Hoy</button>
          {/* Saltar directo a cualquier mes — pedido explícito del usuario, 16-sep-2026: antes solo
              se podía avanzar/retroceder de a uno. Con la ventana de varios meses este mes elegido
              queda como el PRIMERO del rango. */}
          <input type="month" value={mes.format('YYYY-MM')} onChange={e => e.target.value && setMes(dayjs(`${e.target.value}-01`))}
            title="Ir a un mes específico" aria-label="Ir a un mes específico"
            className="text-[11px] font-semibold text-teal-800 bg-white/90 rounded-full px-2 py-1 outline-none cursor-pointer" />
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setMes(m => m.add(1, 'month'))} aria-label="Mes siguiente"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white transition-colors"><ChevronRight size={18} /></button>
          <button onClick={() => mesSiguienteConDatos && setMes(dayjs(`${mesSiguienteConDatos}-01`))} disabled={!mesSiguienteConDatos}
            title="Saltar al mes siguiente con negocios ganados" aria-label="Ganada siguiente"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"><ChevronsRight size={16} /></button>
        </div>
      </div>
      <div className={`grid gap-3 ${
        mesesVista === 1 ? 'grid-cols-1' : mesesVista === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      }`}>
        {mesesARenderizar.map(m => (
          <GrillaMesCompras key={m.format('YYYY-MM')} mes={m} porDia={porDia} hoy={hoy} compacta={compacta} onAbrirDia={onAbrirDia} />
        ))}
      </div>
    </div>
  );
}

function ModalDiaCompras({ dia, negocios, onClose }: { dia: string; negocios: ComprasFila[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 bg-gradient-to-r from-teal-600 to-teal-700 sticky top-0">
          <p className="text-[13.5px] font-bold text-white">{dayjs(dia).date()} de {MESES[dayjs(dia).month()]}</p>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-3 space-y-2">
          {negocios.map(f => <TarjetaDiaCompras key={f.negocioId} f={f} />)}
        </div>
      </div>
    </div>
  );
}

// ── Carta Gantt (vista principal de /compras) ───────────────────────────────────────────────────
// Pedido explícito del usuario, 16-sep-2026: quiere entrar al módulo y ver de entrada TODAS las
// licitaciones ganadas en una sola línea de tiempo, con sus hitos (adjudicación → aceptación de
// OC → entrega) y las tareas intermedias marcadas encima. Reemplaza a Lista/Mes como pestaña por
// defecto (esas siguen existiendo, ver el selector de arriba).
//
// Cálculo de fechas de cada tramo (ninguna se inventa si el dato no existe, ver
// feedback_datos_reales_nunca_inventados):
//   1. Adjudicación = ganadoAt (siempre existe, es NOT NULL en la tabla).
//   2. Aceptación de OC = adjudicación + N días. N es `plazoAceptacionOCDias` (parseado del texto
//      de ESTAS bases en el resumen ejecutivo) si el informe lo identificó; si no, se usa el tope
//      LEGAL de 5 días corridos como estimado (mismo criterio que ya usa el Resumen Ejecutivo,
//      app/lib/compras.ts) — marcado visualmente distinto (línea punteada) para no pasar una
//      estimación por un dato real.
//   3. Entrega = punto de partida (la OC real `ocFecha` si ya llegó, si no el límite de aceptación
//      de OC del punto 2) + `plazoEntregaDias`. Si no hay plazo de entrega identificado, no se
//      dibuja el tramo — no hay fecha que inventar.
const PX_DIA: Record<'compacta' | 'normal' | 'amplia', number> = { compacta: 16, normal: 26, amplia: 40 };
const ANCHO_ETIQUETA_GANTT = 300;
const ALTO_FILA_GANTT = 54;
const ALTO_REGLA_MESES = 26;
const ALTO_REGLA_DIAS = 22;
const TOPE_LEGAL_ACEPTACION_OC_DIAS = 5;

function diasEntre(desde: dayjs.Dayjs, hasta: dayjs.Dayjs): number {
  return hasta.startOf('day').diff(desde.startOf('day'), 'day');
}

interface HitosGantt {
  adjudicacion: dayjs.Dayjs;
  aceptacionOCLimite: dayjs.Dayjs;
  aceptacionOCEstimada: boolean;
  ocReal: dayjs.Dayjs | null;
  inicioEntrega: dayjs.Dayjs;
  entrega: dayjs.Dayjs | null;
  // true = la fecha de `entrega` viene del Reloj de Entrega (compras_reloj, spec §15) — oficial,
  // ya incluye la prórroga si el organismo amplió el plazo (§15.4). false = estimado automático
  // (ganado/OC + plazoEntregaDias) porque el reloj todavía no se fijó para este negocio.
  entregaOficial: boolean;
  entregaVencida: boolean;
}

function calcularHitosGantt(f: ComprasFila): HitosGantt {
  const adjudicacion = dayjs(f.ganadoAt.slice(0, 10));
  const diasAceptacion = f.plazoAceptacionOCDias ?? TOPE_LEGAL_ACEPTACION_OC_DIAS;
  const aceptacionOCLimite = adjudicacion.add(diasAceptacion, 'day');
  const ocReal = f.ocFecha ? dayjs(f.ocFecha) : null;
  const inicioEntrega = ocReal || aceptacionOCLimite;
  // El Reloj de Entrega (§15) manda sobre el estimado apenas está fijado — ya es la fecha oficial,
  // con cualquier prórroga registrada aplicada (app/lib/compras-reloj.ts).
  const entregaOficial = !!f.reloj?.fechaLimiteVigente;
  const entrega = entregaOficial ? dayjs(f.reloj!.fechaLimiteVigente!)
    : f.plazoEntregaDias != null ? inicioEntrega.add(f.plazoEntregaDias, 'day') : null;
  const entregaVencida = !!entrega && entrega.isBefore(dayjs(), 'day') && f.cierreLegado !== 'ENTREGADA' && f.cierreLegado !== 'NO_REALIZADA';
  return { adjudicacion, aceptacionOCLimite, aceptacionOCEstimada: f.plazoAceptacionOCDias == null, ocReal, inicioEntrega, entrega, entregaOficial, entregaVencida };
}

function colorEstadoTareaGantt(t: TareaGantt): string {
  if (t.vencida) return '#e11d48';       // rose-600
  if (t.estado === 'HECHA') return '#10b981'; // emerald-500
  if (t.estado === 'EN_CURSO') return '#f59e0b'; // amber-500
  return '#a1a1aa';                       // zinc-400
}

function FilaGantt({ f, inicioRango, pxDia, onSeleccionar, seleccionada }: {
  f: ComprasFila; inicioRango: dayjs.Dayjs; pxDia: number;
  onSeleccionar: () => void; seleccionada: boolean;
}) {
  const h = calcularHitosGantt(f);
  const x = (d: dayjs.Dayjs) => diasEntre(inicioRango, d) * pxDia;
  const xAdj = x(h.adjudicacion);
  const xAceptOC = x(h.aceptacionOCLimite);
  const xInicioEntrega = x(h.inicioEntrega);
  const xEntrega = h.entrega ? x(h.entrega) : null;
  const entregada = f.cierreLegado === 'ENTREGADA';
  const noRealizada = f.cierreLegado === 'NO_REALIZADA';

  const colorBarraEntrega = noRealizada ? '#a1a1aa' : entregada ? '#10b981' : h.entregaVencida || f.urgente ? '#e11d48' : '#0d9488';

  return (
    <div className={`flex border-b border-zinc-100 transition-colors ${seleccionada ? 'bg-teal-50/60' : 'hover:bg-teal-50/30'}`} style={{ height: ALTO_FILA_GANTT }}>
      <div role="button" tabIndex={0} onClick={onSeleccionar} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSeleccionar()}
        className={`sticky left-0 z-10 flex items-center gap-2 px-3 border-r border-zinc-200 flex-shrink-0 overflow-hidden cursor-pointer ${seleccionada ? 'bg-teal-50/60' : 'bg-white'}`}
        style={{ width: ANCHO_ETIQUETA_GANTT }} title="Ver todas las tareas de esta licitación">
        <AvatarAsignado nombre={f.asignadoNombre} seed={f.asignadoA ?? f.asignadoNombre} size={22} />
        <div className="min-w-0 flex-1">
          <p className={`text-[12px] font-bold leading-tight truncate ${seleccionada ? 'text-teal-700' : 'text-zinc-800'}`}>{f.licitacionNombre || f.licitacionCodigo}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] font-mono text-zinc-400 truncate">{f.licitacionCodigo}</span>
            {f.urgente && <AlertTriangle size={10} className="text-rose-600 flex-shrink-0" />}
            {f.reloj?.prorrogado && <CalendarClock size={10} className="text-amber-500 flex-shrink-0" />}
          </div>
        </div>
        <span className="text-[10.5px] font-semibold text-zinc-500 flex-shrink-0">{fmtCLPCorto(f.montoNuestro)}</span>
        <Link href={`/compras/${f.negocioId}`} onClick={e => e.stopPropagation()} title="Ir al negocio"
          className="text-zinc-300 hover:text-teal-600 flex-shrink-0"><ArrowUpRight size={14} /></Link>
      </div>
      <div className="relative flex-1" style={{ minWidth: 0 }}>
        {/* Tramo 1: esperando aceptación de OC — línea punteada si el plazo es estimado (tope legal), sólida si viene de las bases.
            `title` nativo en vez de un tooltip a medida: el tooltip a medida se renderizaba junto a la
            leyenda, al final de toda la tabla — en un Gantt alto quedaba fuera de pantalla y había que
            hacer scroll para leerlo (reporte del usuario, 16-sep-2026). El nativo aparece junto al cursor. */}
        <div
          title={`Aceptación de OC: ${h.adjudicacion.format('DD-MM-YYYY')} → ${h.aceptacionOCLimite.format('DD-MM-YYYY')} (${f.plazoAceptacionOCDias ?? TOPE_LEGAL_ACEPTACION_OC_DIAS} día(s)${h.aceptacionOCEstimada ? ', estimado — tope legal, sin dato en las bases' : ', según las bases'})`}
          className={`absolute rounded-full ${h.aceptacionOCEstimada ? 'opacity-50' : ''}`}
          style={{
            left: xAdj, width: Math.max(xAceptOC - xAdj, 3), top: 10, height: 7,
            background: '#d97706', backgroundImage: h.aceptacionOCEstimada ? 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,.6) 3px 6px)' : undefined,
          }} />
        {/* Tramo 2: plazo de entrega, desde la OC real (o el límite de aceptación si aún no llega) hasta el día de entrega comprometido. */}
        {xEntrega != null && (
          <div
            title={
              `Entrega: ${h.inicioEntrega.format('DD-MM-YYYY')} → ${h.entrega!.format('DD-MM-YYYY')}` +
              (h.entregaOficial
                ? ` — Reloj de Entrega${f.reloj?.prorrogado ? `, PRORROGADO${f.reloj.prorrogaMotivo ? `: "${f.reloj.prorrogaMotivo}"` : ''}${f.reloj.prorrogaAutorizadoPorNombre ? ` (${f.reloj.prorrogaAutorizadoPorNombre})` : ''}` : ''}`
                : ` (${f.plazoEntregaDias} día(s), estimado — el Reloj de Entrega aún no se fijó)`) +
              (entregada ? ' — ya entregada' : noRealizada ? ' — no realizada' : h.entregaVencida ? ' — VENCIDA' : '')
            }
            className={`absolute rounded-full shadow-sm ${!h.entregaOficial ? 'opacity-70' : ''}`}
            style={{ left: xInicioEntrega, width: Math.max(xEntrega - xInicioEntrega, 3), top: 22, height: 13, background: colorBarraEntrega }} />
        )}
        {xEntrega == null && (
          <div
            title="Plazo de entrega: sin dato — cárgalo en el Auditor Técnico o corre la auditoría con IA."
            className="absolute rounded-full border border-dashed border-zinc-300"
            style={{ left: xInicioEntrega, width: pxDia * 20, top: 22, height: 13 }} />
        )}
        {/* Hito: día de adjudicación. */}
        <div title={`Adjudicado: ${h.adjudicacion.format('DD-MM-YYYY')}`}
          className="absolute rounded-full bg-teal-700 ring-2 ring-white" style={{ left: xAdj - 4, top: 9, width: 9, height: 9 }} />
        {/* Hito: OC real (si ya llegó). */}
        {h.ocReal && (
          <div title={`OC recibida: ${h.ocReal!.format('DD-MM-YYYY')}`}
            className="absolute rounded-full bg-emerald-600 ring-2 ring-white" style={{ left: x(h.ocReal) - 4, top: 9, width: 9, height: 9 }} />
        )}
        {/* Hito: entrega — rombo al final del tramo 2. */}
        {xEntrega != null && (
          <div title={`Entrega comprometida: ${h.entrega!.format('DD-MM-YYYY')}${h.entregaOficial ? ' (Reloj de Entrega)' : ' (estimada)'}${f.reloj?.prorrogado ? ' · con prórroga' : ''}`}
            className="absolute" style={{ left: xEntrega - 5, top: 21 }}>
            <Diamond size={15} fill={colorBarraEntrega} color={colorBarraEntrega} stroke={1} />
          </div>
        )}
        {f.reloj?.prorrogado && xEntrega != null && (
          <div title="Plazo prorrogado — Reloj de Entrega" className="absolute text-amber-500" style={{ left: xEntrega - 4, top: 32 }}>
            <CalendarClock size={13} stroke={2.5} />
          </div>
        )}
        {/* Tareas intermedias — un punto por tarea, en su fecha límite. */}
        {f.tareasGantt.filter(t => t.plazoAt).map(t => (
          <div key={t.id}
            title={`${t.titulo} — ${dayjs(t.plazoAt!).format('DD-MM-YYYY')} (${t.vencida ? 'vencida' : t.estado === 'HECHA' ? 'hecha' : t.estado === 'EN_CURSO' ? 'en curso' : 'pendiente'})`}
            className="absolute rounded-full ring-2 ring-white cursor-help"
            style={{ left: x(dayjs(t.plazoAt!.slice(0, 10))) - 3, top: 40, width: 6, height: 6, background: colorEstadoTareaGantt(t) }} />
        ))}
      </div>
    </div>
  );
}

// Panel de detalle — pedido explícito del usuario (16-sep-2026): "a simple vista no lo entiendo
// mucho, tiene que ser todas las tareas de la licitación". Un punto de 6px por tarea en la barra
// no alcanza para leer nada; clic en una fila abre este panel con la lista COMPLETA, reusando el
// Gantt de tareas ya existente (GanttComprasCard, mismo componente del detalle del negocio) en vez
// de construir una segunda versión más pobre.
function PanelDetalleGantt({ f, onClose }: { f: ComprasFila; onClose: () => void }) {
  const h = calcularHitosGantt(f);
  return (
    <div className="flex flex-col bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden flex-shrink-0" style={{ width: 380, maxHeight: '72vh' }}>
      <div className="flex items-start justify-between gap-2 px-4 py-3 bg-gradient-to-r from-teal-600 to-teal-700">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-white leading-snug">{f.licitacionNombre || f.licitacionCodigo}</p>
          <p className="text-[10.5px] font-mono text-teal-100 mt-0.5">{f.licitacionCodigo}</p>
        </div>
        <button onClick={onClose} title="Cerrar" className="text-white/70 hover:text-white flex-shrink-0"><PanelRightClose size={16} /></button>
      </div>
      <div className="overflow-y-auto px-4 py-3 space-y-3">
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="bg-zinc-50 rounded-lg py-1.5">
            <p className="text-[9px] font-bold text-zinc-400 uppercase">Adjudicación</p>
            <p className="text-[11px] font-bold text-zinc-700">{h.adjudicacion.format('DD-MM-YY')}</p>
          </div>
          <div className="bg-amber-50 rounded-lg py-1.5">
            <p className="text-[9px] font-bold text-amber-500 uppercase">Aceptar OC</p>
            <p className="text-[11px] font-bold text-amber-700">{h.aceptacionOCLimite.format('DD-MM-YY')}{h.aceptacionOCEstimada && '*'}</p>
          </div>
          <div className={`rounded-lg py-1.5 ${h.entregaVencida ? 'bg-rose-50' : 'bg-teal-50'}`}>
            <p className={`text-[9px] font-bold uppercase ${h.entregaVencida ? 'text-rose-500' : 'text-teal-600'}`}>Entrega</p>
            <p className={`text-[11px] font-bold ${h.entregaVencida ? 'text-rose-700' : 'text-teal-800'}`}>{h.entrega ? h.entrega.format('DD-MM-YY') : '— sin dato'}</p>
          </div>
        </div>
        {h.aceptacionOCEstimada && <p className="text-[10px] text-zinc-400">*Estimado — tope legal (5 días corridos), sin dato en las bases.</p>}

        {/* Reloj de Entrega (spec §15) — dice si la fecha de arriba es oficial o solo estimada, y
            si ya se registró una prórroga. Si no está fijado, apunta a dónde fijarlo. */}
        {f.reloj?.fechaLimiteVigente ? (
          <div className={`rounded-lg border px-3 py-2 ${f.reloj.prorrogado ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className={`text-[11px] font-bold flex items-center gap-1.5 ${f.reloj.prorrogado ? 'text-amber-700' : 'text-emerald-700'}`}>
              <CalendarClock size={12} /> {f.reloj.prorrogado ? 'Plazo prorrogado' : 'Reloj de Entrega fijado'}
            </p>
            {f.reloj.prorrogado && (
              <p className="text-[10.5px] text-amber-700 mt-0.5">
                Nuevo plazo {dayjs(f.reloj.fechaLimiteVigente).format('DD-MM-YYYY')}
                {f.reloj.prorrogaMotivo && ` — ${f.reloj.prorrogaMotivo}`}
                {f.reloj.prorrogaAutorizadoPorNombre && ` (autorizó ${f.reloj.prorrogaAutorizadoPorNombre})`}.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-[10.5px] text-zinc-500">
              La fecha de entrega de arriba es un <strong>estimado</strong> — el Reloj de Entrega todavía no se fijó para este negocio.
              Fíjalo (o registra una prórroga oficial si el organismo amplió el plazo) desde <Link href={`/compras/${f.negocioId}`} className="text-teal-700 font-semibold hover:underline">el negocio</Link>.
            </p>
          </div>
        )}

        <div>
          <p className="text-[10.5px] font-bold text-zinc-400 uppercase mb-1.5">Todas las tareas ({f.tareasGantt.length})</p>
          <GanttComprasCard tareas={f.tareasGantt} />
        </div>

        <Link href={`/compras/${f.negocioId}`} className="flex items-center justify-center gap-1.5 text-[11.5px] font-semibold text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg py-2 transition-colors">
          Ver negocio completo <ArrowUpRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function VistaGanttCompras({ negocios }: { negocios: ComprasFila[] }) {
  const [densidad, setDensidad] = useState<'compacta' | 'normal' | 'amplia'>('normal');
  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const yaCentrado = useRef(false);
  const pxDia = PX_DIA[densidad];

  const { inicioRango, totalDias, meses } = useMemo(() => {
    const hitos = negocios.map(calcularHitosGantt);
    const fechas = hitos.flatMap(h => [h.adjudicacion, h.aceptacionOCLimite, h.entrega].filter((d): d is dayjs.Dayjs => !!d));
    for (const f of negocios) for (const t of f.tareasGantt) if (t.plazoAt) fechas.push(dayjs(t.plazoAt.slice(0, 10)));
    fechas.push(dayjs()); // "hoy" siempre entra en el rango, aunque no haya negocios con hitos ahí
    const min = fechas.length ? fechas.reduce((a, b) => (a.isBefore(b) ? a : b)) : dayjs().subtract(15, 'day');
    const max = fechas.length ? fechas.reduce((a, b) => (a.isAfter(b) ? a : b)) : dayjs().add(45, 'day');
    const inicioRango = min.subtract(7, 'day').startOf('week');
    const finRango = max.add(10, 'day');
    const totalDias = Math.max(diasEntre(inicioRango, finRango), 30);
    const meses: { label: string; x: number; w: number; par: boolean }[] = [];
    let cursor = inicioRango.startOf('month');
    let i = 0;
    while (cursor.isBefore(inicioRango.add(totalDias, 'day'))) {
      const inicioMes = cursor.isBefore(inicioRango) ? inicioRango : cursor;
      const finMes = cursor.add(1, 'month').startOf('month');
      const x = diasEntre(inicioRango, inicioMes) * pxDia;
      const w = diasEntre(inicioMes, finMes) * pxDia;
      meses.push({ label: `${MESES[cursor.month()]} ${cursor.year()}`, x, w, par: i % 2 === 0 });
      cursor = finMes; i++;
    }
    return { inicioRango, totalDias, meses };
  }, [negocios, pxDia]);

  const anchoTimeline = totalDias * pxDia;
  const xHoy = diasEntre(inicioRango, dayjs()) * pxDia;

  const irAHoy = useCallback((suave: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const left = Math.max(0, ANCHO_ETIQUETA_GANTT + xHoy - (el.clientWidth - ANCHO_ETIQUETA_GANTT) / 2);
    el.scrollTo({ left, behavior: suave ? 'smooth' : 'auto' });
  }, [xHoy]);

  // Centrar el scroll en "hoy" al entrar — solo una vez, para no pelear con el usuario si después
  // se mueve solo (llega tiempo real vía SSE) o cambia de densidad.
  useEffect(() => {
    if (yaCentrado.current) return;
    irAHoy(false);
    yaCentrado.current = true;
  }, [irAHoy]);

  if (negocios.length === 0) return null;
  const seleccionado = seleccionadoId != null ? negocios.find(f => f.negocioId === seleccionadoId) || null : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11.5px] text-zinc-400">
          {negocios.length} licitación(es) · adjudicación → aceptación de OC → entrega, con tareas marcadas en el camino. Clic en una licitación para ver todas sus tareas.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => irAHoy(true)} title="Volver a centrar en hoy"
            className="text-[11px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-full transition-colors">Hoy</button>
          <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5">
            <button onClick={() => setDensidad('compacta')} title="Zoom compacto"
              className={`p-1.5 rounded-md transition-colors ${densidad === 'compacta' ? 'bg-white text-teal-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}><ZoomOut size={14} /></button>
            <button onClick={() => setDensidad('normal')}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded-md transition-colors ${densidad === 'normal' ? 'bg-white text-teal-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>Normal</button>
            <button onClick={() => setDensidad('amplia')} title="Zoom amplio"
              className={`p-1.5 rounded-md transition-colors ${densidad === 'amplia' ? 'bg-white text-teal-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}><ZoomIn size={14} /></button>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <div className="flex-1 bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden min-w-0">
          <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: '72vh' }}>
            <div style={{ width: ANCHO_ETIQUETA_GANTT + anchoTimeline }}>
              {/* Regla de meses + días — sticky arriba mientras se hace scroll vertical. */}
              <div className="sticky top-0 z-20 flex bg-white border-b border-zinc-200" style={{ height: ALTO_REGLA_MESES + ALTO_REGLA_DIAS }}>
                <div className="sticky left-0 z-30 bg-white border-r border-zinc-200 flex-shrink-0" style={{ width: ANCHO_ETIQUETA_GANTT }} />
                <div className="relative flex-1">
                  {/* Días: un número por casilla; fin de semana sombreado, hoy resaltado. */}
                  <div className="absolute inset-x-0 bottom-0 border-t border-zinc-100" style={{ height: ALTO_REGLA_DIAS }}>
                    {Array.from({ length: totalDias }, (_, i) => {
                      const d = inicioRango.add(i, 'day');
                      const finde = d.day() === 0 || d.day() === 6;
                      const esHoy = d.isSame(dayjs(), 'day');
                      return (
                        <div key={i} title={d.format('dddd DD-MM-YYYY')}
                          className={`absolute inset-y-0 flex items-center justify-center text-[10px] leading-none ${
                            esHoy ? 'bg-rose-500 text-white font-bold rounded-sm' : finde ? 'bg-zinc-100 text-zinc-400' : 'text-zinc-500'
                          }`}
                          style={{ left: i * pxDia, width: pxDia }}>
                          {d.date()}
                        </div>
                      );
                    })}
                  </div>
                  {meses.map(m => (
                    <div key={m.label} className={`absolute top-0 ${m.par ? 'bg-zinc-50' : 'bg-white'}`}
                      style={{ left: m.x, width: m.w, height: ALTO_REGLA_MESES, borderLeft: '1px solid #f4f4f5' }}>
                      {/* Etiqueta "pegajosa": al desplazarse dentro de un mes ancho, su nombre se queda
                          pegado al borde de la columna fija en vez de desaparecer por la izquierda —
                          pero sin salirse de los límites de SU mes (se lo pasa al siguiente al llegar). */}
                      <div className={`sticky h-full flex items-center px-2 text-[11px] font-bold capitalize ${m.par ? 'text-zinc-500' : 'text-zinc-400'}`}
                        style={{ left: ANCHO_ETIQUETA_GANTT + 8 }}>
                        {m.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Filas */}
              <div className="relative">
                {negocios.map(f => (
                  <FilaGantt key={f.negocioId} f={f} inicioRango={inicioRango} pxDia={pxDia}
                    seleccionada={seleccionadoId === f.negocioId}
                    onSeleccionar={() => setSeleccionadoId(id => id === f.negocioId ? null : f.negocioId)} />
                ))}
                {/* Línea de "hoy", detrás de las barras pero sobre el fondo. */}
                <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-rose-300 pointer-events-none z-[1]"
                  style={{ left: ANCHO_ETIQUETA_GANTT + xHoy }} />
              </div>
            </div>
          </div>
        </div>
        {seleccionado && <PanelDetalleGantt f={seleccionado} onClose={() => setSeleccionadoId(null)} />}
      </div>

      <div className="flex items-center gap-4 flex-wrap text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-700" /> Adjudicación</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-1.5 rounded-full" style={{ background: '#d97706' }} /> Aceptación OC (punteado = estimado)</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> OC recibida</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-1.5 rounded-full bg-teal-600" /> Plazo de entrega</span>
        <span className="flex items-center gap-1.5"><Diamond size={11} className="text-teal-600" /> Entrega comprometida</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-zinc-400" /> Tarea</span>
        <span className="flex items-center gap-1.5"><span className="border-l-2 border-dashed border-rose-300 h-3" /> Hoy</span>
      </div>
    </div>
  );
}

export default function ComprasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [negocios, setNegocios] = useState<ComprasFila[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Vista principal = Gantt (pedido explícito del usuario, 16-sep-2026): lo primero que se ve al
  // entrar a Compras son todas las licitaciones con sus hitos (adjudicación → aceptación de OC →
  // entrega) y tareas en una sola línea de tiempo. Lista y Mes siguen disponibles como pestañas.
  const [vista, setVista] = useState<Vista>('gantt');
  const [mesesVista, setMesesVista] = useState<MesesVista>(1);
  const [diaSel, setDiaSel] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [fAsignado, setFAsignado] = useState<string[]>([]);
  const [fOrganismo, setFOrganismo] = useState<string[]>([]);
  // "Postuló" = quién preparó/postuló la licitación en Negocios (negocios.asignado_a) — persona
  // distinta del "Encargado" de Compras (fAsignado), que la ejecuta recién después de ganada.
  // Filtro pedido explícito del usuario, 16-sep-2026.
  const [fPostulador, setFPostulador] = useState<string[]>([]);
  const [fOC, setFOC] = useState<'todos' | 'con' | 'sin'>('todos');
  const [montoMin, setMontoMin] = useState('');
  const [montoMax, setMontoMax] = useState('');
  const [plazoMin, setPlazoMin] = useState('');
  const [plazoMax, setPlazoMax] = useState('');
  const [soloTareasVencidas, setSoloTareasVencidas] = useState(false);
  const [soloUrgentes, setSoloUrgentes] = useState(false);
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [orden, setOrden] = useState<Orden>('reciente');
  // Hidratado = ya restauramos los filtros guardados; evita persistir el default antes de leerlos.
  const [hidratado, setHidratado] = useState(false);

  // Restaurar filtros guardados al montar (persisten al volver de otro módulo — pedido explícito
  // del usuario, 11-sep-2026: "no se deben salir"). Mismo patrón que app/negocios/page.tsx
  // (SS_NEG_FILTROS) — sessionStorage, no localStorage: se limpia solo al cerrar la pestaña, no
  // se arrastra para siempre entre sesiones distintas.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SS_COMPRAS_FILTROS);
      if (raw) {
        const f = JSON.parse(raw);
        if (typeof f.q === 'string') setQ(f.q);
        if (Array.isArray(f.fAsignado)) setFAsignado(f.fAsignado.map(String));
        if (Array.isArray(f.fOrganismo)) setFOrganismo(f.fOrganismo.map(String));
        if (Array.isArray(f.fPostulador)) setFPostulador(f.fPostulador.map(String));
        if (f.fOC === 'con' || f.fOC === 'sin' || f.fOC === 'todos') setFOC(f.fOC);
        if (typeof f.montoMin === 'string') setMontoMin(f.montoMin);
        if (typeof f.montoMax === 'string') setMontoMax(f.montoMax);
        if (typeof f.plazoMin === 'string') setPlazoMin(f.plazoMin);
        if (typeof f.plazoMax === 'string') setPlazoMax(f.plazoMax);
        if (typeof f.soloTareasVencidas === 'boolean') setSoloTareasVencidas(f.soloTareasVencidas);
        if (typeof f.soloUrgentes === 'boolean') setSoloUrgentes(f.soloUrgentes);
        if (typeof f.soloSinAsignar === 'boolean') setSoloSinAsignar(f.soloSinAsignar);
        if (typeof f.verCerradas === 'boolean') setVerCerradas(f.verCerradas);
        if (typeof f.fechaDesde === 'string') setFechaDesde(f.fechaDesde);
        if (typeof f.fechaHasta === 'string') setFechaHasta(f.fechaHasta);
        if (f.orden === 'reciente' || f.orden === 'antiguo' || f.orden === 'monto_desc' || f.orden === 'monto_asc') setOrden(f.orden);
        if (f.vista === 'lista' || f.vista === 'mes' || f.vista === 'gantt') setVista(f.vista);
        if (f.mesesVista === 1 || f.mesesVista === 2 || f.mesesVista === 3) setMesesVista(f.mesesVista);
      }
    } catch { /* sin persistencia */ }
    setHidratado(true);
  }, []);

  // Persistir cada vez que cambian (después de hidratar, para no pisar lo guardado con el default).
  useEffect(() => {
    if (!hidratado) return;
    try {
      sessionStorage.setItem(SS_COMPRAS_FILTROS, JSON.stringify({
        q, fAsignado, fOrganismo, fPostulador, fOC, montoMin, montoMax, plazoMin, plazoMax, soloTareasVencidas,
        soloUrgentes, soloSinAsignar, verCerradas, fechaDesde, fechaHasta, orden, vista, mesesVista,
      }));
    } catch { /* cuota llena */ }
  }, [hidratado, q, fAsignado, fOrganismo, fPostulador, fOC, montoMin, montoMax, plazoMin, plazoMax, soloTareasVencidas,
      soloUrgentes, soloSinAsignar, verCerradas, fechaDesde, fechaHasta, orden, vista, mesesVista]);

  const cerradasCount = useMemo(() => negocios.filter(f => f.cierreLegado).length, [negocios]);
  const hayFiltro = fAsignado.length > 0 || fOrganismo.length > 0 || fPostulador.length > 0 || fOC !== 'todos'
    || !!montoMin || !!montoMax || !!plazoMin || !!plazoMax || soloTareasVencidas
    || soloUrgentes || soloSinAsignar || !!fechaDesde || !!fechaHasta;
  const limpiar = () => {
    setFAsignado([]); setFOrganismo([]); setFPostulador([]); setFOC('todos');
    setMontoMin(''); setMontoMax(''); setPlazoMin(''); setPlazoMax(''); setSoloTareasVencidas(false);
    setSoloUrgentes(false); setSoloSinAsignar(false); setFechaDesde(''); setFechaHasta('');
  };

  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026) — mismo criterio que el backend
  // (app/api/compras/route.ts, app/api/compras/[negocioId]/asignar/route.ts).
  const puedeVer = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial
    || !!usuario?.permisos?.compras_administracion || !!usuario?.permisos?.compras_bodega;
  const esJefeDeVentas = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.aprobar_comercial;
  // Pedido explícito del usuario, 15-sep-2026: CAMBIAR un encargado que ya tiene otro asignado
  // es solo de admin (el backend en /api/compras/[negocioId]/asignar/route.ts hace el mismo
  // corte) — la asignación inicial (negocio sin nadie encima todavía) la sigue haciendo el jefe
  // de ventas.
  const esAdmin = usuario?.rol === 'admin';

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/compras');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setNegocios(data.negocios || []);
      setCandidatos(data.candidatos || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  // Tiempo real (pedido explícito, 11-sep-2026): cuando llega/se acepta una OC en Mercado
  // Público, esta pantalla se refresca sola — mismo bus SSE que ya usa el resto de los
  // tableros de la app (publicarCambio('compras') en app/lib/compras.ts).
  useRealtime(cargar);

  const opciones = useMemo(() => {
    const asig = new Map<string, { nombre: string; n: number }>();
    const org = new Map<string, number>();
    const post = new Map<string, number>();
    for (const f of negocios) {
      if (f.asignadoNombre) {
        const key = String(f.asignadoA || f.asignadoNombre);
        const cur = asig.get(key) || { nombre: f.asignadoNombre, n: 0 }; cur.n++; asig.set(key, cur);
      }
      if (f.licitacionOrganismo) org.set(f.licitacionOrganismo, (org.get(f.licitacionOrganismo) || 0) + 1);
      if (f.postuladoPorNombre) post.set(f.postuladoPorNombre, (post.get(f.postuladoPorNombre) || 0) + 1);
    }
    return {
      asignado: [...asig.entries()].sort((a, b) => b[1].n - a[1].n)
        .map(([v, o]) => ({ value: v, label: o.nombre, color: colorUsuario(v), count: o.n })),
      organismo: [...org.entries()].sort((a, b) => b[1] - a[1])
        .map(([v, n]) => ({ value: v, label: v, count: n })),
      postulador: [...post.entries()].sort((a, b) => b[1] - a[1])
        .map(([v, n]) => ({ value: v, label: v, color: colorUsuario(v), count: n })),
    };
  }, [negocios]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const nMontoMin = montoMin ? Number(montoMin) : null;
    const nMontoMax = montoMax ? Number(montoMax) : null;
    const nPlazoMin = plazoMin ? Number(plazoMin) : null;
    const nPlazoMax = plazoMax ? Number(plazoMax) : null;
    const arr = negocios.filter(f => {
      if (qn) {
        const hay = [f.licitacionNombre, f.licitacionCodigo, f.licitacionOrganismo, f.asignadoNombre]
          .filter(Boolean).some(v => String(v).toLowerCase().includes(qn));
        if (!hay) return false;
      }
      if (fAsignado.length > 0 && !fAsignado.includes(String(f.asignadoA || f.asignadoNombre || ''))) return false;
      if (fOrganismo.length > 0 && !fOrganismo.includes(f.licitacionOrganismo || '')) return false;
      if (fPostulador.length > 0 && !fPostulador.includes(f.postuladoPorNombre || '')) return false;
      if (fOC === 'con' && !f.ocFecha) return false;
      if (fOC === 'sin' && f.ocFecha) return false;
      if (nMontoMin != null && (f.montoNuestro == null || f.montoNuestro < nMontoMin)) return false;
      if (nMontoMax != null && (f.montoNuestro == null || f.montoNuestro > nMontoMax)) return false;
      if (nPlazoMin != null && (f.plazoEntregaDias == null || f.plazoEntregaDias < nPlazoMin)) return false;
      if (nPlazoMax != null && (f.plazoEntregaDias == null || f.plazoEntregaDias > nPlazoMax)) return false;
      if (soloTareasVencidas && f.tareasVencidas <= 0) return false;
      if (soloUrgentes && !f.urgente) return false;
      if (soloSinAsignar && f.asignadoA != null) return false;
      // El backlog histórico (marcado entregada/no realizada) no compite con el trabajo activo —
      // queda oculto salvo que se pida explícitamente con "Ver cerradas".
      if (!verCerradas && f.cierreLegado) return false;
      const dia = f.ganadoAt.slice(0, 10);
      if (fechaDesde && dia < fechaDesde) return false;
      if (fechaHasta && dia > fechaHasta) return false;
      return true;
    });
    const t = (s: string) => new Date(s.replace(' ', 'T')).getTime();
    arr.sort((a, b) => {
      switch (orden) {
        case 'antiguo':    return t(a.ganadoAt) - t(b.ganadoAt);
        case 'monto_desc': return (b.montoNuestro ?? -1) - (a.montoNuestro ?? -1);
        case 'monto_asc':  return (a.montoNuestro ?? -1) - (b.montoNuestro ?? -1);
        default:           return t(b.ganadoAt) - t(a.ganadoAt);
      }
    });
    // Urgentes siempre primero, dentro del orden elegido.
    arr.sort((a, b) => Number(b.urgente) - Number(a.urgente));
    return arr;
  }, [negocios, q, fAsignado, fOrganismo, fPostulador, fOC, montoMin, montoMax, plazoMin, plazoMax, soloTareasVencidas,
      soloUrgentes, soloSinAsignar, verCerradas, fechaDesde, fechaHasta, orden]);

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Compras' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Compras' }]}>
      <div className={`p-4 sm:p-6 mx-auto space-y-4 ${
        vista === 'gantt' ? 'max-w-[1700px]' : vista === 'mes' && mesesVista > 1 ? 'max-w-[1600px]' : vista === 'mes' ? 'max-w-7xl' : 'max-w-5xl'
      }`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
              <ShoppingCart size={17} className="text-teal-600" />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Compras</h1>
              <p className="text-[12px] text-zinc-500">
                {negocios.length === 0 ? 'Sin negocios ganados todavía'
                  : hayFiltro || q || (!verCerradas && cerradasCount > 0) ? `${filtrados.length} de ${negocios.length} negocio(s)`
                  : `${negocios.length} negocio(s) ganado(s)`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {esJefeDeVentas && (
              <Link href="/compras/dashboard"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 px-3 py-2 rounded-lg transition-colors"
                title="Cuellos de botella y estadística de gestión (spec §18) — solo jefatura">
                <BarChart3 size={13} /> Dashboard
              </Link>
            )}
            {negocios.length > 0 && (
              <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5">
                {([
                  { key: 'gantt', label: 'Gantt', icon: <GanttChart size={13} /> },
                  { key: 'lista', label: 'Lista', icon: <List size={13} /> },
                  { key: 'mes', label: 'Mes', icon: <Calendar size={13} /> },
                ] as const).map(v => (
                  <button key={v.key} onClick={() => setVista(v.key)}
                    className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-md transition-colors ${
                      vista === v.key ? 'bg-white text-teal-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                    }`}>
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
            )}
            {negocios.length > 0 && vista === 'mes' && !soloUrgentes && (
              // Ver varios meses a la vez — pedido explícito del usuario, 16-sep-2026: planificar
              // entregas con más rango sin ir mes a mes. Con 2 o 3 meses las tarjetas del día pasan
              // a la variante compacta (ver TarjetaDiaCompras) para que quepan sin perder los datos.
              <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5" title="Meses a la vez">
                {([1, 2, 3] as const).map(n => (
                  <button key={n} onClick={() => setMesesVista(n)}
                    className={`text-[12px] font-semibold px-2.5 py-1.5 rounded-md transition-colors ${
                      mesesVista === n ? 'bg-white text-teal-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                    }`}>
                    {n} mes{n > 1 ? 'es' : ''}
                  </button>
                ))}
              </div>
            )}
            {negocios.length > 0 && (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, código, organismo o encargado…"
                  className="pl-8 pr-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:ring-1 focus:ring-teal-500 outline-none w-72" />
              </div>
            )}
          </div>
        </div>

        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {!loading && negocios.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-zinc-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
            {opciones.asignado.length > 0 && (
              <MultiSelect label="Encargado" icon={<Users size={13} />} options={opciones.asignado} selected={fAsignado} onChange={setFAsignado} minWidth={220} />
            )}
            {opciones.postulador.length > 0 && (
              <MultiSelect label="Postuló" icon={<Users size={13} />} options={opciones.postulador} selected={fPostulador} onChange={setFPostulador} minWidth={220} />
            )}
            {opciones.organismo.length > 0 && (
              <MultiSelect label="Organismo" icon={<Building2 size={13} />} options={opciones.organismo} selected={fOrganismo} onChange={setFOrganismo} minWidth={240} />
            )}
            <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5" title="Orden de compra">
              {([
                { key: 'todos', label: 'OC: todas' },
                { key: 'con', label: 'Con OC' },
                { key: 'sin', label: 'Sin OC' },
              ] as const).map(o => (
                <button key={o.key} onClick={() => setFOC(o.key)}
                  className={`text-[11.5px] font-semibold px-2 py-1.5 rounded-md transition-colors ${
                    fOC === o.key ? 'bg-white text-teal-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                  }`}>{o.label}</button>
              ))}
            </div>
            <button onClick={() => setSoloTareasVencidas(v => !v)}
              className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border transition-colors ${
                soloTareasVencidas ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-zinc-500 bg-white border-zinc-200 hover:bg-zinc-50'
              }`}>
              <CheckCircle2 size={12} /> Tareas vencidas
            </button>
            <button onClick={() => setSoloUrgentes(v => !v)}
              className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border transition-colors ${
                soloUrgentes ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-zinc-500 bg-white border-zinc-200 hover:bg-zinc-50'
              }`}>
              <AlertTriangle size={12} /> Urgentes
            </button>
            <button onClick={() => setSoloSinAsignar(v => !v)}
              className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border transition-colors ${
                soloSinAsignar ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-500 bg-white border-zinc-200 hover:bg-zinc-50'
              }`}>
              <Clock size={12} /> Sin asignar
            </button>
            {cerradasCount > 0 && (
              <button onClick={() => setVerCerradas(v => !v)}
                className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border transition-colors ${
                  verCerradas ? 'text-zinc-700 bg-zinc-100 border-zinc-300' : 'text-zinc-500 bg-white border-zinc-200 hover:bg-zinc-50'
                }`}>
                <Archive size={12} /> {verCerradas ? 'Ocultar' : 'Ver'} cerradas ({cerradasCount})
              </button>
            )}
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
            <div className="flex items-center gap-1.5 border border-zinc-200 rounded-lg px-2.5 py-1">
              <span className="text-[11px] font-semibold text-zinc-500">Monto</span>
              <input type="number" min={0} placeholder="Mín" value={montoMin} onChange={e => setMontoMin(e.target.value)}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[72px]" title="Monto mínimo" />
              <span className="text-zinc-300">–</span>
              <input type="number" min={0} placeholder="Máx" value={montoMax} onChange={e => setMontoMax(e.target.value)}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[72px]" title="Monto máximo" />
              {(montoMin || montoMax) && (
                <button onClick={() => { setMontoMin(''); setMontoMax(''); }}
                  title="Quitar rango de monto" className="text-zinc-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
              )}
            </div>
            <div className="flex items-center gap-1.5 border border-zinc-200 rounded-lg px-2.5 py-1">
              <Clock size={13} className="text-zinc-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-zinc-500">Entrega</span>
              <input type="number" min={0} placeholder="Mín" value={plazoMin} onChange={e => setPlazoMin(e.target.value)}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[50px]" title="Días de entrega mínimo" />
              <span className="text-zinc-300">–</span>
              <input type="number" min={0} placeholder="Máx" value={plazoMax} onChange={e => setPlazoMax(e.target.value)}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[50px]" title="Días de entrega máximo" />
              <span className="text-[11px] text-zinc-400">días</span>
              {(plazoMin || plazoMax) && (
                <button onClick={() => { setPlazoMin(''); setPlazoMax(''); }}
                  title="Quitar rango de plazo de entrega" className="text-zinc-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
              )}
            </div>
            {hayFiltro && (
              <button onClick={limpiar}
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
                  { value: 'monto_desc', label: 'Monto (mayor)' },
                  { value: 'monto_asc', label: 'Monto (menor)' },
                ]} />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : negocios.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <ShoppingCart size={28} className="text-zinc-300" />
            <p className="text-[13.5px] font-semibold text-zinc-500">Todavía no hay ningún negocio ganado</p>
            <p className="text-[12px] text-zinc-400">Cuando Mercado Público confirme que ganamos, aparece acá para asignar encargado.</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Search size={28} className="text-zinc-300" />
            <p className="text-[13.5px] font-semibold text-zinc-500">Sin resultados</p>
            <p className="text-[12px] text-zinc-400">Ningún negocio coincide con la búsqueda o los filtros.</p>
          </div>
        ) : soloUrgentes ? (
          <VistaUrgentesCompras negocios={filtrados} />
        ) : vista === 'gantt' ? (
          <VistaGanttCompras negocios={filtrados} />
        ) : vista === 'mes' ? (
          <VistaMensualCompras negocios={filtrados} onAbrirDia={setDiaSel} mesesVista={mesesVista} />
        ) : (
          <div className="space-y-3">
            {filtrados.map(f => (
              <FilaCompras key={f.negocioId} f={f} esJefeDeVentas={esJefeDeVentas} esAdmin={esAdmin} candidatos={candidatos} onAsignado={cargar} />
            ))}
          </div>
        )}

        {diaSel && (
          <ModalDiaCompras dia={diaSel}
            negocios={filtrados.filter(f => f.ganadoAt.slice(0, 10) === diaSel)}
            onClose={() => setDiaSel(null)} />
        )}
      </div>
    </AppLayout>
  );
}
