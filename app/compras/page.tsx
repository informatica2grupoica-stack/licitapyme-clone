'use client';

// MÓDULO DE COMPRAS — listado transversal (Fase 1, spec §3-§5). Un negocio ganado por fila: quién
// lo tiene, si vence el plazo de asignación, si es urgente y cuánto avanzó de sus tareas. El
// detalle completo (resumen ejecutivo + tareas) vive en la pestaña "Compras" de cada negocio.
import { useState, useEffect, useCallback, useMemo } from 'react';
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
import {
  ShoppingCart, Loader2, Building2, ArrowUpRight, Search, Filter, X, Calendar,
  Users, ArrowUpDown, AlertTriangle, Clock, UserPlus, CheckCircle2, BarChart3,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, List, PackageCheck, XCircle, Archive, Undo2, Pencil,
} from 'lucide-react';

type CierreLegado = 'ENTREGADA' | 'NO_REALIZADA';

interface ComprasFila {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; licitacionOrganismo: string | null;
  urgente: boolean; asignadoA: number | null; asignadoNombre: string | null; asignadoAt: string | null;
  vencimientoAsignacionAt: string; ganadoAt: string; montoNuestro: number | null;
  tareasTotal: number; tareasHechas: number; tareasVencidas: number;
  ocFecha: string | null;
  cierreLegado: CierreLegado | null;
  plazoEntregaDias: number | null;
  postuladoPorNombre: string | null;
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
type Vista = 'lista' | 'mes';

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
            {f.urgente && (
              <span title={explicacionUrgente(f)}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full cursor-help">
                <AlertTriangle size={10} /> Urgente{f.plazoEntregaDias != null ? ` · entrega en ${f.plazoEntregaDias} día(s)` : ''}
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
function TarjetaDiaCompras({ f }: { f: ComprasFila }) {
  const acento = f.urgente ? '#e11d48' : colorUsuario(f.asignadoA ?? f.asignadoNombre);
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
        ) : f.urgente && (
          <span title={explicacionUrgente(f)}
            className="inline-flex items-center gap-0.5 text-[8.5px] font-bold text-rose-700 bg-rose-50 px-1 py-0.5 rounded-full flex-shrink-0 cursor-help">
            <AlertTriangle size={8} /> Urgente{f.plazoEntregaDias != null ? ` · ${f.plazoEntregaDias}d` : ''}
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

function VistaMensualCompras({ negocios, onAbrirDia }: { negocios: ComprasFila[]; onAbrirDia: (key: string) => void }) {
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

  const inicio = mes.startOf('month');
  const offset = (inicio.day() + 6) % 7; // lunes = 0
  const gridStart = inicio.subtract(offset, 'day');
  const dias = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const hoy = dayjs().format('YYYY-MM-DD');

  const MOSTRAR_MAX = 2; // más de esto, "+N más" abre el detalle del día — las tarjetas son grandes
  const esMesActual = mes.format('YYYY-MM') === dayjs().format('YYYY-MM');

  // Meses que SÍ tienen algún negocio (por ganado_at), para saltar directo en vez de ir mes a mes.
  const mesesConDatos = useMemo(() => {
    const s = new Set<string>();
    for (const f of negocios) s.add(f.ganadoAt.slice(0, 7));
    return [...s].sort();
  }, [negocios]);
  const actualYYYYMM = mes.format('YYYY-MM');
  const mesAnteriorConDatos = [...mesesConDatos].reverse().find(m => m < actualYYYYMM) || null;
  const mesSiguienteConDatos = mesesConDatos.find(m => m > actualYYYYMM) || null;

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-teal-600 to-teal-700">
        <div className="flex items-center gap-0.5">
          <button onClick={() => mesAnteriorConDatos && setMes(dayjs(`${mesAnteriorConDatos}-01`))} disabled={!mesAnteriorConDatos}
            title="Saltar al mes anterior con negocios ganados" aria-label="Ganada anterior"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"><ChevronsLeft size={16} /></button>
          <button onClick={() => setMes(m => m.subtract(1, 'month'))} aria-label="Mes anterior"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white transition-colors"><ChevronLeft size={18} /></button>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[16px] font-bold text-white capitalize">{MESES[mes.month()]} {mes.year()}</span>
          {/* Siempre visible (antes se ocultaba en el mes actual y eso confundía — parecía que
              "Hoy" fallaba justo en septiembre). Acá queda deshabilitado en vez de desaparecer. */}
          <button onClick={() => setMes(dayjs().startOf('month'))} disabled={esMesActual}
            className={`text-[10.5px] font-bold px-2 py-1 rounded-full transition-colors ${
              esMesActual ? 'text-white/50 bg-white/10 cursor-default' : 'text-teal-700 bg-white hover:bg-teal-50'
            }`}>Hoy</button>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setMes(m => m.add(1, 'month'))} aria-label="Mes siguiente"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white transition-colors"><ChevronRight size={18} /></button>
          <button onClick={() => mesSiguienteConDatos && setMes(dayjs(`${mesSiguienteConDatos}-01`))} disabled={!mesSiguienteConDatos}
            title="Saltar al mes siguiente con negocios ganados" aria-label="Ganada siguiente"
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"><ChevronsRight size={16} /></button>
        </div>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-7 gap-2 mb-2">
          {SEMANA.map(d => <div key={d} className="text-center text-[11px] font-bold text-teal-700 bg-teal-50 rounded-md py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-2">
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
                className={`min-h-[210px] rounded-xl border p-1.5 flex flex-col gap-1.5 transition-colors ${
                  fueraMes ? 'bg-zinc-50/50 border-zinc-100'
                  : esHoy ? 'border-teal-400 bg-teal-50/40 ring-1 ring-teal-200'
                  : items.length > 0 ? 'border-zinc-200 bg-white shadow-sm' : 'border-zinc-100 bg-zinc-50/30'
                }`}>
                <div className="flex items-center justify-between px-0.5">
                  <span className={esHoy ? 'bg-teal-600 text-white rounded-full w-6 h-6 inline-flex items-center justify-center text-[12px] font-bold shadow-sm' : `text-[12.5px] font-bold ${fueraMes ? 'text-zinc-300' : 'text-zinc-600'}`}>{d.date()}</span>
                  {items.length > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${hayUrgente ? 'text-rose-700 bg-rose-50' : 'text-teal-700 bg-teal-50'}`}>{items.length}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-h-0">
                  {visibles.map(f => <TarjetaDiaCompras key={f.negocioId} f={f} />)}
                  {resto > 0 && (
                    <button onClick={() => onAbrirDia(k)}
                      className="text-[10.5px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg py-1 transition-colors">
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

export default function ComprasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [negocios, setNegocios] = useState<ComprasFila[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>('mes');
  const [diaSel, setDiaSel] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [fAsignado, setFAsignado] = useState<string[]>([]);
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
        if (typeof f.soloUrgentes === 'boolean') setSoloUrgentes(f.soloUrgentes);
        if (typeof f.soloSinAsignar === 'boolean') setSoloSinAsignar(f.soloSinAsignar);
        if (typeof f.verCerradas === 'boolean') setVerCerradas(f.verCerradas);
        if (typeof f.fechaDesde === 'string') setFechaDesde(f.fechaDesde);
        if (typeof f.fechaHasta === 'string') setFechaHasta(f.fechaHasta);
        if (f.orden === 'reciente' || f.orden === 'antiguo' || f.orden === 'monto_desc' || f.orden === 'monto_asc') setOrden(f.orden);
        if (f.vista === 'lista' || f.vista === 'mes') setVista(f.vista);
      }
    } catch { /* sin persistencia */ }
    setHidratado(true);
  }, []);

  // Persistir cada vez que cambian (después de hidratar, para no pisar lo guardado con el default).
  useEffect(() => {
    if (!hidratado) return;
    try {
      sessionStorage.setItem(SS_COMPRAS_FILTROS, JSON.stringify({
        q, fAsignado, soloUrgentes, soloSinAsignar, verCerradas, fechaDesde, fechaHasta, orden, vista,
      }));
    } catch { /* cuota llena */ }
  }, [hidratado, q, fAsignado, soloUrgentes, soloSinAsignar, verCerradas, fechaDesde, fechaHasta, orden, vista]);

  const cerradasCount = useMemo(() => negocios.filter(f => f.cierreLegado).length, [negocios]);
  const hayFiltro = fAsignado.length > 0 || soloUrgentes || soloSinAsignar || !!fechaDesde || !!fechaHasta;
  const limpiar = () => { setFAsignado([]); setSoloUrgentes(false); setSoloSinAsignar(false); setFechaDesde(''); setFechaHasta(''); };

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
    for (const f of negocios) {
      if (f.asignadoNombre) {
        const key = String(f.asignadoA || f.asignadoNombre);
        const cur = asig.get(key) || { nombre: f.asignadoNombre, n: 0 }; cur.n++; asig.set(key, cur);
      }
    }
    return {
      asignado: [...asig.entries()].sort((a, b) => b[1].n - a[1].n)
        .map(([v, o]) => ({ value: v, label: o.nombre, color: colorUsuario(v), count: o.n })),
    };
  }, [negocios]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const arr = negocios.filter(f => {
      if (qn) {
        const hay = [f.licitacionNombre, f.licitacionCodigo, f.licitacionOrganismo, f.asignadoNombre]
          .filter(Boolean).some(v => String(v).toLowerCase().includes(qn));
        if (!hay) return false;
      }
      if (fAsignado.length > 0 && !fAsignado.includes(String(f.asignadoA || f.asignadoNombre || ''))) return false;
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
  }, [negocios, q, fAsignado, soloUrgentes, soloSinAsignar, verCerradas, fechaDesde, fechaHasta, orden]);

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
      <div className={`p-4 sm:p-6 mx-auto space-y-4 ${vista === 'mes' ? 'max-w-7xl' : 'max-w-5xl'}`}>
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
        ) : vista === 'mes' ? (
          <VistaMensualCompras negocios={filtrados} onAbrirDia={setDiaSel} />
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
