'use client';

// Análisis de licitación (SOLO ADMIN): tablero ANALÍTICO por perfil.
// Se elige UN perfil (o "Todos") y se muestran SUS estadísticas: KPIs, gráficos
// interactivos (dona por estado, barras por tipo, evolución mensual, top organismos,
// tasa de adjudicación) y, aparte, la LISTA de sus licitaciones.
//
// FUENTES (las dos reales, ninguna inventada):
//   · /api/negocios         → los negocios (admin = todos).
//   · /api/postuladas/estado→ el RESULTADO de adjudicación desde el acta de MP (cache de BD
//                             que refresca el cron cada 2h). Es la MISMA fuente de Postuladas,
//                             /adjudicadas y el dashboard, así que los números cuadran entre sí.
//     Antes se contaban las adjudicadas por `estado_pipeline`, que solo cambia si alguien la
//     mueve a mano → este tablero decía otra cosa que el resto del sistema.
//
// SELECTIVO: las tortas y las barras de tipo son filtros. Al tocar un segmento, TODO lo demás
// (KPIs, montos, cierres por mes, organismos y la lista) se remide sobre esa selección; el
// gráfico selector sigue mostrando el universo completo para no perder el contexto.
//
// TIEMPO REAL: useRealtime recarga en cuanto alguien postula/descarta/cambia etapa o el cron
// trae adjudicaciones nuevas desde MP.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity, Loader2, RefreshCw, Building2, Calendar, DollarSign, Send, Clock,
  Layers, Users, Trophy, Ban, Briefcase, TrendingUp, Target, ChevronRight, ExternalLink, X, Filter,
  Search, ArrowUpDown, ChevronDown,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, AreaChart, Area, RadialBarChart, RadialBar,
} from 'recharts';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useRealtime } from '@/app/lib/use-realtime';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { ChartCard } from '@/app/components/ui/ChartCard';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { ESTADOS_PIPELINE, getEstadoPipeline } from '@/app/lib/pipeline';
import { extractTipoFromCodigo, getTipoLicitacion } from '@/app/lib/tipos-licitacion';
import { cierreVencido } from '@/app/lib/estado-mp';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_region: string | null;
  monto_ofertado: number | null;
  estado_pipeline: string;
  created_at: string | null;
  updated_at: string | null;
  usuario_nombre: string | null;
  usuario_email: string | null;
  comentarios_count?: number | null;
}

// Estado de adjudicación tal como lo devuelve /api/postuladas/estado (solo lo que se usa aquí).
interface EstadoAdj {
  esAdjudicada: boolean;
  ganamos: boolean;
  montoNuestro: number | null;
  montoAdjudicadoTotal: number | null;
}

const RESUELTOS = new Set(['POSTULADA', 'DESCARTADA', 'ADJUDICADA', 'POSIBLE_ADJ', 'PERDIDA']);
// Universo que pasó por postulación: solo de aquí puede salir un resultado ganada/perdida.
const UNIVERSO_POSTULADA = new Set(['POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA']);
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const fmtMonto = (n: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtMontoCorto = (n: number) => {
  if (!n) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}MM`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' });
};
const diasHasta = (s: string | null): number | null => {
  if (!s) return null;
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
};
// Estados que ya salieron de la mesa de trabajo: o se resolvió (ganó/perdió/descartó) o la
// oferta ya está presentada y no hay nada que gestionar.
const FUERA_DE_TRABAJO = new Set(['DESCARTADA', 'POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA']);
const labelDe = (estado: string) => getEstadoPipeline(estado)?.label || estado || 'ASIGNADO';
const idDe = (estado: string) => getEstadoPipeline(estado)?.id || estado || 'ASIGNADO';
// Clave del perfil responsable. Una sola definición: antes el selector agrupaba con fallback
// 'sin' pero el filtro comparaba sin él, así que "Sin asignar" nunca filtraba nada.
const claveDe = (n: Negocio) => n.usuario_email || n.usuario_nombre || 'sin';
// ÚNICA definición de "está en la mesa de trabajo": no salió del pipeline y el cierre no pasó.
// La usan el KPI "Vigentes" Y la dona "En gestión activa" — antes cada uno tenía su propio
// criterio y daban números distintos con el mismo rótulo.
const esVigente = (n: Negocio) =>
  !FUERA_DE_TRABAJO.has(idDe(n.estado_pipeline)) && !cierreVencido(n.licitacion_cierre);

// ── Tooltip común de los gráficos ─────────────────────────────────────────────
function ChartTooltip({ active, payload, label, sufijo }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-[12px]">
      {label != null && <p className="font-semibold text-slate-700 mb-0.5">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-slate-600 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color || p.payload?.color }} />
          <span className="font-bold tabular-nums">{p.value}</span> {sufijo || p.name || ''}
        </p>
      ))}
    </div>
  );
}

export default function AnalisisLicitacionPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjMap, setAdjMap] = useState<Record<string, EstadoAdj | null>>({});
  // TODOS los filtros son de selección múltiple y se combinan entre sí (AND entre filtros,
  // OR dentro de cada uno). Vacío = sin filtrar por esa dimensión.
  //   · perfiles → define el UNIVERSO que miden los gráficos-selector.
  //   · estados/tipos/organismos → recortan lo que se mide dentro de ese universo.
  const [perfilesSel, setPerfilesSel] = useState<string[]>([]);
  const [estadosSel, setEstadosSel] = useState<string[]>([]);
  const [tiposSel, setTiposSel] = useState<string[]>([]);
  const [organismosSel, setOrganismosSel] = useState<string[]>([]);
  // Búsqueda libre (nombre / código / organismo): recorta la MEDICIÓN igual que los demás filtros.
  const [busqueda, setBusqueda] = useState('');
  // Orden y carga incremental de la lista (con cientos de filas, pintar todas de una es lento).
  const [ordenLista, setOrdenLista] = useState<'cierre' | 'monto' | 'reciente'>('cierre');
  const [maxLista, setMaxLista] = useState(30);

  const esAdmin = usuario?.rol === 'admin';

  useEffect(() => {
    if (!cargandoSesion && usuario && !esAdmin) router.replace('/negocios');
  }, [cargandoSesion, usuario, esAdmin, router]);

  // Carga en una pasada: negocios + resultado real de adjudicación. `silencioso` evita el
  // spinner cuando la recarga viene del tiempo real (no parpadea ni pierde la selección).
  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const res = await fetch('/api/negocios', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar');
      setNegocios(data.negocios || []);
      setError(null);
      // Resultado real (acta de MP) para las que pasaron por postulación.
      try {
        const r = await fetch('/api/postuladas/estado', { cache: 'no-store' });
        const d = await r.json();
        if (d?.estados) setAdjMap(d.estados);
      } catch { /* sin cruce → se cae al estado_pipeline, que es lo que había antes */ }
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin, cargar]);
  useRealtime(useCallback(() => { if (esAdmin) cargar(true); }, [esAdmin, cargar]));

  // Perfiles disponibles (para el selector).
  const perfiles = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; email: string | null; total: number }>();
    for (const n of negocios) {
      const key = claveDe(n);
      const e = m.get(key) || { key, nombre: n.usuario_nombre || n.usuario_email || 'Sin asignar', email: n.usuario_email, total: 0 };
      e.total++; m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Universo de los perfiles elegidos. Es la base de los gráficos-SELECTOR (dona por estado y
  // barras por tipo): siguen mostrando el total aunque haya una selección activa.
  const base = useMemo(
    () => negocios.filter(n => perfilesSel.length === 0 || perfilesSel.includes(claveDe(n))),
    [negocios, perfilesSel]);

  const tipoDe = (n: Negocio) => extractTipoFromCodigo(n.licitacion_codigo || '') || '—';

  // Organismos del universo, para el selector (con su conteo).
  const organismos = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of base) if (n.licitacion_organismo) m.set(n.licitacion_organismo, (m.get(n.licitacion_organismo) || 0) + 1);
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  }, [base]);

  // Resultado REAL de una postulada, con el acta de MP por delante del estado interno:
  // el cache dice si MP adjudicó y si ganó una de nuestras empresas (match por RUT). El
  // estado_pipeline solo se usa de respaldo (si el cruce aún no cargó o la tabla no tiene
  // esa licitación), que es como se contaba antes.
  const resultadoDe = useCallback((n: Negocio): 'ganada' | 'perdida' | 'evaluacion' | null => {
    const id = idDe(n.estado_pipeline);
    if (!UNIVERSO_POSTULADA.has(id)) return null;
    const a = adjMap[n.licitacion_codigo];
    if (a?.esAdjudicada) return a.ganamos ? 'ganada' : 'perdida';
    if (id === 'ADJUDICADA') return 'ganada';
    if (id === 'PERDIDA') return 'perdida';
    return 'evaluacion';   // postulada, MP todavía no resuelve
  }, [adjMap]);

  // Conjunto MEDIDO = universo ∩ todos los filtros activos. Todo lo de abajo (KPIs, montos,
  // cierres por mes, organismos y la lista) se calcula sobre esto.
  const seleccion = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return base.filter(n =>
      (estadosSel.length === 0 || estadosSel.includes(idDe(n.estado_pipeline))) &&
      (tiposSel.length === 0 || tiposSel.includes(tipoDe(n))) &&
      (organismosSel.length === 0 || (n.licitacion_organismo != null && organismosSel.includes(n.licitacion_organismo))) &&
      (!q
        || (n.licitacion_nombre || '').toLowerCase().includes(q)
        || (n.licitacion_codigo || '').toLowerCase().includes(q)
        || (n.licitacion_organismo || '').toLowerCase().includes(q)),
    );
  }, [base, estadosSel, tiposSel, organismosSel, busqueda]);

  // Universo de los gráficos-selector = base ∩ (organismo + búsqueda). CROSS-FILTER: cada
  // gráfico deja fuera SOLO su propia dimensión (la dona no se filtra por estado, las barras no
  // se filtran por tipo) para poder seguir eligiendo dentro de él; todo lo demás sí lo recorta.
  // Antes se medían sobre `base` a secas: al buscar o filtrar por organismo la torta seguía
  // mostrando el universo entero y la lista se veía "incompleta".
  const baseSelectores = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return base.filter(n =>
      (organismosSel.length === 0 || (n.licitacion_organismo != null && organismosSel.includes(n.licitacion_organismo))) &&
      (!q
        || (n.licitacion_nombre || '').toLowerCase().includes(q)
        || (n.licitacion_codigo || '').toLowerCase().includes(q)
        || (n.licitacion_organismo || '').toLowerCase().includes(q)),
    );
  }, [base, organismosSel, busqueda]);

  // ── Gráficos-selector: sobre baseSelectores, NO sobre la selección de su propia dimensión ──
  const selectores = useMemo(() => {
    const porEstadoMap = new Map<string, number>();
    const porTipoMap = new Map<string, number>();
    // La dona de estado ignora estadosSel (es su selector) pero SÍ respeta el filtro de tipo.
    const paraEstado = baseSelectores.filter(n => tiposSel.length === 0 || tiposSel.includes(tipoDe(n)));
    // Las barras de tipo ignoran tiposSel pero SÍ respetan el filtro de estado.
    const paraTipo = baseSelectores.filter(n => estadosSel.length === 0 || estadosSel.includes(idDe(n.estado_pipeline)));
    for (const n of paraEstado) {
      const id = idDe(n.estado_pipeline);
      porEstadoMap.set(id, (porEstadoMap.get(id) || 0) + 1);
    }
    for (const n of paraTipo) {
      const t = tipoDe(n);
      porTipoMap.set(t, (porTipoMap.get(t) || 0) + 1);
    }

    // El centro y los % se miden sobre lo que REALMENTE está en los segmentos. Antes el centro
    // usaba base.length mientras los segmentos solo recorrían ESTADOS_PIPELINE: cualquier estado
    // legado fuera del catálogo desaparecía del gráfico pero seguía sumando en el centro, así que
    // los porcentajes no llegaban a 100.
    const enCatalogo = ESTADOS_PIPELINE.reduce((acc, e) => acc + (porEstadoMap.get(e.id) || 0), 0);
    const fueraCatalogo = paraEstado.length - enCatalogo;
    const porEstado = ESTADOS_PIPELINE
      .filter(e => (porEstadoMap.get(e.id) || 0) > 0)
      .map(e => ({ id: e.id, name: e.label, value: porEstadoMap.get(e.id)!, color: e.color, pct: enCatalogo ? Math.round((porEstadoMap.get(e.id)! / enCatalogo) * 100) : 0 }));

    // Dona "en gestión activa": MISMA definición que el KPI Vigentes (esVigente) — no resuelta,
    // no postulada y con el cierre aún por delante. Antes solo excluía descartadas y postuladas,
    // así que arrastraba adjudicadas/perdidas y las vencidas: dos números distintos en la misma
    // pantalla bajo el rótulo "en trabajo".
    const porTrabajoMap = new Map<string, number>();
    for (const n of paraEstado) if (esVigente(n)) {
      const id = idDe(n.estado_pipeline);
      porTrabajoMap.set(id, (porTrabajoMap.get(id) || 0) + 1);
    }
    const totalTrabajo = [...porTrabajoMap.values()].reduce((a, b) => a + b, 0);
    const porEstadoTrabajo = ESTADOS_PIPELINE
      .filter(e => (porTrabajoMap.get(e.id) || 0) > 0)
      .map(e => ({ id: e.id, name: e.label, value: porTrabajoMap.get(e.id)!, color: e.color, pct: totalTrabajo ? Math.round((porTrabajoMap.get(e.id)! / totalTrabajo) * 100) : 0 }));

    const porTipo = [...porTipoMap.entries()]
      .map(([tipo, value]) => ({ tipo, name: tipo, value, color: getTipoLicitacion(tipo)?.color || '#94a3b8' }))
      .sort((a, b) => b.value - a.value);

    return {
      porEstado, porEstadoTrabajo, totalTrabajo, porTipo,
      totalBase: base.length, totalEstado: enCatalogo, fueraCatalogo,
      totalTipo: paraTipo.length, universo: baseSelectores.length,
    };
  }, [base, baseSelectores, estadosSel, tiposSel]);

  // ── Métricas de la selección ────────────────────────────────────────────────
  const stats = useMemo(() => {
    let vigentes = 0, postuladas = 0, ganadas = 0, descartadas = 0, perdidas = 0,
      enEvaluacion = 0, cierran7 = 0, montoOfertado = 0, montoAdjudicado = 0,
      montoCartera = 0, ganadasSinActa = 0;
    const porMesMap = new Map<string, number>();
    const porOrgMap = new Map<string, number>();

    for (const n of seleccion) {
      const id = idDe(n.estado_pipeline);

      if (id === 'DESCARTADA') descartadas++;

      // Ganadas/perdidas por el acta de MP, no por la etapa interna.
      const res = resultadoDe(n);
      // "Postuladas" = OFERTAS PRESENTADAS = todo lo que pasó por postulación, igual que el
      // apartado /postuladas (64). Contar solo estado === 'POSTULADA' daba 57: al promover una
      // a ADJUDICADA/PERDIDA desaparecía del conteo, como si nunca se hubiera ofertado.
      // Se cumple: postuladas = ganadas + perdidas + enEvaluacion.
      if (res != null) postuladas++;
      if (res === 'ganada') {
        ganadas++;
        const a = adjMap[n.licitacion_codigo];
        // Monto NETO: lo que MP nos adjudicó según el acta; si no está, lo ofertado.
        montoAdjudicado += a?.montoNuestro || n.monto_ofertado || n.licitacion_monto || 0;
        // Ganada que NO viene del acta sino del estado puesto a mano: se cuenta aparte para
        // poder decir en pantalla cuántas del total no están confirmadas por MP.
        if (!a?.esAdjudicada) ganadasSinActa++;
      }
      if (res === 'perdida') perdidas++;
      if (res === 'evaluacion') enEvaluacion++;

      const resuelta = RESUELTOS.has(id);
      if (esVigente(n)) vigentes++;

      const d = diasHasta(n.licitacion_cierre);
      if (d != null && d >= 0 && d <= 7 && !resuelta) cierran7++;

      // Dos bolsas SEPARADAS, no una suma mezclada. Antes era `monto_ofertado || licitacion_monto`
      // sobre TODO (incluidas descartadas): mezclaba oferta real con presupuesto de MP y no era
      // comparable con el monto adjudicado, así que el par no significaba nada.
      //   · Ofertado real  → solo lo que efectivamente se ofertó (universo postulada).
      //   · Cartera        → presupuesto MP de lo que sigue vigente (lo que aún se puede ganar).
      if (res != null) montoOfertado += n.monto_ofertado || 0;
      if (esVigente(n)) montoCartera += n.licitacion_monto || 0;

      if (n.licitacion_cierre) {
        const dt = new Date(n.licitacion_cierre);
        if (!isNaN(dt.getTime())) {
          const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          porMesMap.set(k, (porMesMap.get(k) || 0) + 1);
        }
      }
      if (n.licitacion_organismo) porOrgMap.set(n.licitacion_organismo, (porOrgMap.get(n.licitacion_organismo) || 0) + 1);
    }

    const porMes = [...porMesMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([k, value]) => { const [y, m] = k.split('-'); return { mes: `${MESES[+m - 1]} ${y.slice(2)}`, value }; });

    const topOrg = [...porOrgMap.entries()]
      .map(([name, value]) => ({ name: name.length > 26 ? name.slice(0, 26) + '…' : name, value }))
      .sort((a, b) => b.value - a.value).slice(0, 6);

    // Tasa = ganadas sobre lo RESUELTO por MP (ganadas + perdidas). Las que siguen en
    // evaluación no entran: no se sabe todavía. Es el mismo cálculo del dashboard
    // ("Éxito competitivo"), así que ambos tableros dan el mismo número.
    const resueltas = ganadas + perdidas;
    const tasaExito = resueltas > 0 ? Math.round((ganadas / resueltas) * 100) : 0;

    return {
      total: seleccion.length, vigentes, postuladas, ganadas, descartadas, perdidas,
      enEvaluacion, resueltas, cierran7, montoOfertado, montoCartera, montoAdjudicado,
      ganadasSinActa, tasaExito, porMes, topOrg,
    };
  }, [seleccion, resultadoDe, adjMap]);

  // Lista: el mismo conjunto medido, con orden seleccionable (cierre próximo por defecto).
  const lista = useMemo(() => [...seleccion].sort((a, b) => {
    if (ordenLista === 'monto') {
      return (b.monto_ofertado || b.licitacion_monto || 0) - (a.monto_ofertado || a.licitacion_monto || 0);
    }
    if (ordenLista === 'reciente') {
      return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
    }
    const da = a.licitacion_cierre ? new Date(a.licitacion_cierre).getTime() : Infinity;
    const db = b.licitacion_cierre ? new Date(b.licitacion_cierre).getTime() : Infinity;
    return da - db;
  }), [seleccion, ordenLista]);

  // Al cambiar cualquier filtro se reinicia la carga incremental de la lista.
  useEffect(() => { setMaxLista(30); }, [busqueda, perfilesSel, estadosSel, tiposSel, organismosSel, ordenLista]);

  // Los gráficos son otra forma de operar los MISMOS filtros del selector de arriba: clic en un
  // segmento lo suma a la selección, clic de nuevo lo quita. Los dos controles se reflejan.
  const limpiarSeleccion = () => { setEstadosSel([]); setTiposSel([]); setOrganismosSel([]); };
  const toggleEstado = (id: string) => setEstadosSel(a => (a.includes(id) ? a.filter(x => x !== id) : [...a, id]));
  const toggleTipo = (t: string) => setTiposSel(a => (a.includes(t) ? a.filter(x => x !== t) : [...a, t]));
  const haySeleccion = estadosSel.length > 0 || tiposSel.length > 0 || organismosSel.length > 0;

  if (!cargandoSesion && usuario && !esAdmin) {
    return <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}><div className="p-10 text-center text-sm text-slate-500">Redirigiendo…</div></AppLayout>;
  }

  const perfilNombre = perfilesSel.length === 0
    ? 'Todos los perfiles'
    : perfilesSel.length === 1
      ? (perfiles.find(p => p.key === perfilesSel[0])?.nombre || perfilesSel[0])
      : `${perfilesSel.length} perfiles`;

  return (
    <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}>
      {/* <main> no trae padding: cada página pone el suyo. Esta no lo hacía y el contenido
          quedaba pegado al sidebar. Mismo espaciado que Postuladas/Adjudicadas. */}
      <div className="p-4 sm:p-6 lg:p-8 space-y-5">
        {/* Encabezado */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Activity size={18} />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900">Análisis de licitación</h1>
              <p className="text-xs text-slate-500">Estadísticas y gráficos por perfil</p>
            </div>
          </div>
          <button onClick={() => cargar()} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

        {cargando ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando…
          </div>
        ) : negocios.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Activity size={20} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">No hay licitaciones en gestión</p>
          </div>
        ) : (
          <>
            {/* Barra de filtros PEGAJOSA: todos multi-select y combinables + búsqueda libre.
                Queda fija al hacer scroll para poder re-filtrar sin volver arriba. */}
            <div className="sticky top-0 z-30 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-sm p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">
                  <Filter size={13} className="text-slate-400" /> Filtros
                </span>
                <div className="relative w-full sm:w-64 order-last sm:order-none">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                    placeholder="Nombre, código u organismo…"
                    className="w-full pl-8 pr-7 py-2 text-[13px] rounded-lg border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-400 transition" />
                  {busqueda && (
                    <button onClick={() => setBusqueda('')} title="Limpiar búsqueda"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <MultiSelect label="Perfil" icon={<Users size={13} />} selected={perfilesSel}
                  onChange={next => { setPerfilesSel(next); limpiarSeleccion(); }}
                  options={perfiles.map(p => ({ value: p.key, label: p.nombre, color: colorUsuario(p.email || p.key), count: p.total }))} />
                <MultiSelect label="Estado" icon={<Layers size={13} />} selected={estadosSel} onChange={setEstadosSel}
                  options={selectores.porEstado.map(e => ({ value: e.id, label: e.name, color: e.color, count: e.value }))} />
                <MultiSelect label="Tipo" icon={<Layers size={13} />} selected={tiposSel} onChange={setTiposSel} minWidth={170}
                  options={selectores.porTipo.map(t => ({ value: t.tipo, label: t.name, color: t.color, count: t.value }))} />
                <MultiSelect label="Organismo" icon={<Building2 size={13} />} selected={organismosSel} onChange={setOrganismosSel} minWidth={320}
                  options={organismos.map(o => ({ value: o.value, label: o.value, count: o.count }))} />
                {(haySeleccion || perfilesSel.length > 0 || busqueda) && (
                  <button onClick={() => { setPerfilesSel([]); setBusqueda(''); limpiarSeleccion(); }}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-red-600 px-2 py-2">
                    <X size={13} /> Limpiar todo
                  </button>
                )}
              </div>
            </div>

            {/* Título del scope + chips de lo que se está midiendo ahora mismo */}
            <div className="flex items-center gap-2 text-[13px] text-slate-500 flex-wrap">
              <span className="font-bold text-slate-800">{perfilNombre}</span>
              <span>·</span>
              <span>
                {stats.total} licitación{stats.total !== 1 ? 'es' : ''}
                {haySeleccion ? ` de ${selectores.totalBase}` : ' en total'}
              </span>
              {estadosSel.map(id => {
                const col = getEstadoPipeline(id)?.color || '#64748b';
                return (
                  <button key={id} onClick={() => toggleEstado(id)}
                    style={{ background: col + '18', color: col, borderColor: col + '40' }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border hover:opacity-75">
                    {labelDe(id)} <X size={11} />
                  </button>
                );
              })}
              {tiposSel.map(t => {
                const col = getTipoLicitacion(t)?.color || '#64748b';
                return (
                  <button key={t} onClick={() => toggleTipo(t)}
                    style={{ background: col + '18', color: col, borderColor: col + '40' }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border hover:opacity-75">
                    Tipo {t} <X size={11} />
                  </button>
                );
              })}
              {organismosSel.map(o => (
                <button key={o} onClick={() => setOrganismosSel(a => a.filter(x => x !== o))}
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 hover:opacity-75 max-w-[220px]">
                  <span className="truncate">{o}</span> <X size={11} className="flex-shrink-0" />
                </button>
              ))}
              {busqueda && (
                <button onClick={() => setBusqueda('')}
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 hover:opacity-75">
                  <Search size={10} /> “{busqueda}” <X size={11} />
                </button>
              )}
              {haySeleccion
                ? <button onClick={limpiarSeleccion} className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 underline">quitar filtros</button>
                : <span className="text-[11px] text-slate-400">— toca un segmento de las tortas o una barra de tipo para medir solo ese tramo</span>}
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 stagger-grid">
              <KPI icon={<Briefcase size={16} />} label="Vigentes" value={String(stats.vigentes)} tint="#4f46e5" sub="en trabajo" />
              <KPI icon={<Send size={16} />} label="Postuladas" value={String(stats.postuladas)} tint="#b45309" sub="ofertas presentadas" />
              <KPI icon={<Trophy size={16} />} label="Ganadas" value={String(stats.ganadas)} tint="#16a34a" sub="ganadas según acta" />
              <KPI icon={<Ban size={16} />} label="Descartadas" value={String(stats.descartadas)} tint="#dc2626" />
              <KPI icon={<Target size={16} />} label="Tasa de éxito" value={`${stats.tasaExito}%`} tint="#7c3aed"
                sub={stats.resueltas ? `${stats.ganadas} de ${stats.resueltas} resueltas` : 'sin resueltas aún'} />
              <KPI icon={<Clock size={16} />} label="Cierran ≤ 7 días" value={String(stats.cierran7)} tint={stats.cierran7 > 0 ? '#dc2626' : '#64748b'} />
            </div>

            {/* Montos — TRES bolsas separadas y no comparables entre sí salvo ofertado→adjudicado,
                que ahora sí es una tasa de conversión legítima (misma población: lo que se ofertó). */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-gradient-to-br from-sky-50 to-white rounded-xl border border-sky-100 p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0"><Briefcase size={20} /></div>
                <div>
                  <p className="text-[11px] text-sky-700 font-semibold uppercase tracking-wide">Presupuesto en cartera</p>
                  <p className="text-[22px] font-black text-slate-900 tabular-nums leading-tight">{fmtMonto(stats.montoCartera)}</p>
                  <p className="text-[10px] text-slate-400">suma de <span className="font-semibold">licitacion_monto</span> (presupuesto MP) de las {stats.vigentes} vigentes</p>
                </div>
              </div>
              <div className="bg-gradient-to-br from-teal-50 to-white rounded-xl border border-teal-100 p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-teal-100 text-teal-600 flex items-center justify-center flex-shrink-0"><DollarSign size={20} /></div>
                <div>
                  <p className="text-[11px] text-teal-700 font-semibold uppercase tracking-wide">Ofertado real</p>
                  <p className="text-[22px] font-black text-slate-900 tabular-nums leading-tight">{fmtMonto(stats.montoOfertado)}</p>
                  <p className="text-[10px] text-slate-400">suma de <span className="font-semibold">monto_ofertado</span> de las {stats.postuladas} que se presentaron. No incluye descartadas ni presupuesto estimado.</p>
                </div>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl border border-emerald-100 p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0"><Trophy size={20} /></div>
                <div>
                  <p className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wide">Monto adjudicado</p>
                  <p className="text-[22px] font-black text-slate-900 tabular-nums leading-tight">{fmtMonto(stats.montoAdjudicado)}</p>
                  <p className="text-[10px] text-slate-400">
                    <span className="font-semibold">montoNuestro</span> del acta de Mercado Público en las {stats.ganadas} ganadas
                    {stats.montoOfertado > 0 && <> · convierte el <span className="font-semibold">{Math.round((stats.montoAdjudicado / stats.montoOfertado) * 100)}%</span> de lo ofertado</>}
                  </p>
                </div>
              </div>
            </div>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Dona por estado — TODAS (dato completo). Selectiva: toca un segmento y todo
                  el tablero se remide sobre ese estado. */}
              <ChartCard title="Distribución por estado · todas" icon={<Layers size={13} />}
                sub={`${selectores.totalEstado} licitaciones · campo estado_pipeline`}>
                {selectores.porEstado.length === 0 ? <SinDatos /> : (
                  <>
                    <DonaEstados data={selectores.porEstado} total={selectores.totalEstado} centroLabel="licitaciones"
                      seleccion={estadosSel} onSelect={toggleEstado} />
                    <Procedencia
                      fuente="/api/negocios → estado_pipeline (la etapa que el equipo mueve a mano)"
                      universo={`${selectores.universo} licitaciones del perfil, ya recortadas por organismo y búsqueda${tiposSel.length ? ' y por el tipo seleccionado' : ''}. NO se recorta por estado: es el selector de esta torta.`}
                      calculo="Una licitación por segmento, según su etapa actual. El % es sobre el total del centro."
                      ojo={selectores.fueraCatalogo > 0
                        ? `${selectores.fueraCatalogo} con un estado antiguo fuera del catálogo quedan fuera de la torta y del centro.`
                        : undefined}
                    />
                  </>
                )}
              </ChartCard>

              {/* Dona "en gestión activa" — MISMA definición que el KPI Vigentes (esVigente) */}
              <ChartCard title="En gestión activa" icon={<Briefcase size={13} />}
                sub={`${selectores.totalTrabajo} en la mesa · mismo criterio que el KPI “Vigentes”`}>
                {selectores.porEstadoTrabajo.length === 0 ? <SinDatos /> : (
                  <>
                    <DonaEstados data={selectores.porEstadoTrabajo} total={selectores.totalTrabajo} centroLabel="en gestión"
                      seleccion={estadosSel} onSelect={toggleEstado} />
                    <Procedencia
                      fuente="/api/negocios → estado_pipeline + fecha de cierre de la licitación"
                      universo="El mismo de la torta de la izquierda, filtrado por esVigente()."
                      calculo="Deja fuera lo que ya salió de la mesa (descartadas, postuladas, en posible adjudicación, ganadas y perdidas) Y todo lo que tiene el cierre vencido. Es exactamente el número del KPI “Vigentes”, por eso ahora coinciden."
                    />
                  </>
                )}
              </ChartCard>

              {/* Tasa de éxito (radial) */}
              <ChartCard title="Tasa de éxito" icon={<Target size={13} />}
                sub={stats.resueltas ? `${stats.ganadas} ganadas de ${stats.resueltas} que MP ya resolvió` : 'MP aún no resuelve ninguna'}>
                <div className="flex items-center gap-4">
                  <div style={{ width: 180, height: 200 }} className="relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: 'tasa', value: stats.tasaExito, fill: '#7c3aed' }]}
                        startAngle={90} endAngle={90 - (stats.tasaExito / 100) * 360}>
                        <RadialBar background dataKey="value" cornerRadius={10} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[30px] font-black text-violet-700 leading-none tabular-nums">{stats.tasaExito}%</span>
                      <span className="text-[10px] text-slate-400 font-semibold">éxito</span>
                    </div>
                  </div>
                  {/* Las 3 primeras son el desglose de "Ofertas presentadas": suman exactamente
                      ese total. Descartadas va aparte: nunca se llegó a ofertar. */}
                  <div className="flex-1 space-y-2.5">
                    <MiniStat label="Ofertas presentadas" value={stats.postuladas} color="#b45309" />
                    <MiniStat label="· Ganadas" value={stats.ganadas} color="#16a34a" />
                    <MiniStat label="· Perdidas" value={stats.perdidas} color="#9f1239" />
                    <MiniStat label="· En evaluación" value={stats.enEvaluacion} color="#64748b" />
                    <MiniStat label="Descartadas (no se ofertó)" value={stats.descartadas} color="#dc2626" />
                  </div>
                </div>
                <Procedencia
                  fuente="/api/postuladas/estado → acta de adjudicación de Mercado Público (cache que refresca el cron cada 2h). El acta manda; estado_pipeline solo se usa si esa licitación aún no está en el cache."
                  universo="Las que pasaron por postulación (postuladas, en posible adjudicación, ganadas y perdidas). Las descartadas nunca se ofertaron, por eso van aparte."
                  calculo="Tasa = ganadas ÷ (ganadas + perdidas). Las que siguen en evaluación NO entran: todavía no se sabe. Ganamos = el RUT del acta calza con una de nuestras empresas."
                  ojo={stats.ganadasSinActa > 0
                    ? `${stats.ganadasSinActa} de las ${stats.ganadas} ganadas vienen del estado puesto a mano, no del acta de MP.`
                    : undefined}
                />
              </ChartCard>

              {/* Barras por tipo — también selectivas (clic en una barra filtra el tablero) */}
              <ChartCard title="Por tipo de licitación" icon={<Layers size={13} />}
                sub={`${selectores.totalTipo} licitaciones · tipo leído del código MP`}>
                {selectores.porTipo.length === 0 ? <SinDatos /> : (
                  <>
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={selectores.porTipo} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
                      <RTooltip content={<ChartTooltip sufijo="licitaciones" />} cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]} className="cursor-pointer"
                        onClick={(d: any) => d?.tipo && toggleTipo(d.tipo)}>
                        {selectores.porTipo.map((e) => (
                          // La barra elegida queda a color pleno; el resto se atenúa.
                          <Cell key={e.tipo} fill={e.color} fillOpacity={tiposSel.length && !tiposSel.includes(e.tipo) ? 0.25 : 1} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <Procedencia
                    fuente="El segmento del código de MP (LE, LP, LR…), leído con extractTipoFromCodigo. No viene de la API: se deduce del código."
                    universo={`Las ${selectores.universo} del perfil tras organismo y búsqueda${estadosSel.length ? ', recortadas por el estado seleccionado' : ''}. NO se recorta por tipo: es el selector de este gráfico.`}
                    calculo="Una licitación por barra según su tipo. Las que tienen un código no reconocible caen en “—”."
                  />
                  </>
                )}
              </ChartCard>

              {/* Evolución mensual */}
              <ChartCard title="Cierres por mes" icon={<TrendingUp size={13} />}
                sub="Últimos 8 meses con cierres · incluye pasados y futuros">
                {stats.porMes.length === 0 ? <SinDatos /> : (
                  <>
                  <ResponsiveContainer width="100%" height={210}>
                    <AreaChart data={stats.porMes} margin={{ left: -18, right: 12, top: 8, bottom: 4 }}>
                      <defs>
                        <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} width={30} />
                      <RTooltip content={<ChartTooltip sufijo="cierran" />} />
                      <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fill="url(#gradArea)" />
                    </AreaChart>
                  </ResponsiveContainer>
                  <Procedencia
                    fuente="Fecha de cierre de la licitación (licitacion_cierre) que trae la API de Mercado Público."
                    universo={`Las ${stats.total} licitaciones que estás midiendo ahora mismo (todos los filtros aplicados, incluidos estado y tipo).`}
                    calculo="Agrupa por año-mes de cierre y muestra los últimos 8 meses con datos. Mezcla meses ya pasados con los que vienen: es un calendario de cierres, no una tendencia de resultados."
                  />
                  </>
                )}
              </ChartCard>

              {/* Top organismos */}
              <ChartCard title="Top organismos" icon={<Building2 size={13} />} className="lg:col-span-2"
                sub={`Los 6 con más licitaciones dentro de las ${stats.total} medidas`}>
                {stats.topOrg.length === 0 ? <SinDatos /> : (
                  <>
                  <ResponsiveContainer width="100%" height={Math.max(120, stats.topOrg.length * 34)}>
                    <BarChart data={stats.topOrg} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} width={200} />
                      <RTooltip content={<ChartTooltip sufijo="licitaciones" />} cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="value" fill="#0d9488" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <Procedencia
                    fuente="Campo licitacion_organismo de la API de Mercado Público, tal cual lo publica el comprador."
                    universo={`Las ${stats.total} licitaciones medidas ahora (todos los filtros aplicados).`}
                    calculo="Cuenta cuántas licitaciones aporta cada organismo y muestra los 6 primeros. Es conteo, no monto."
                  />
                  </>
                )}
              </ChartCard>
            </div>

            {/* Lista de licitaciones (aparte de los gráficos) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 flex-wrap">
                <Briefcase size={13} className="text-slate-400" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Lista de licitaciones</span>
                <span className="text-[11px] text-slate-400">({lista.length})</span>
                <div className="inline-flex items-center gap-1.5 ml-2">
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-400">
                    <ArrowUpDown size={11} /> Orden
                  </span>
                  <Select value={ordenLista} onChange={v => setOrdenLista(v as typeof ordenLista)}
                    options={[
                      { value: 'cierre', label: 'Cierre próximo' },
                      { value: 'monto', label: 'Monto (mayor)' },
                      { value: 'reciente', label: 'Actividad reciente' },
                    ]} />
                </div>
                {/* Filtro por estado — es el MISMO estado que la dona: los dos se reflejan. */}
                <div className="ml-auto flex flex-wrap gap-1">
                  <button onClick={() => setEstadosSel([])}
                    className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-md border ${estadosSel.length === 0 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>Todas</button>
                  {selectores.porEstado.map(e => (
                    <button key={e.id} onClick={() => toggleEstado(e.id)}
                      style={estadosSel.includes(e.id) ? { backgroundColor: e.color, borderColor: e.color, color: '#fff' } : { borderColor: e.color + '55', color: e.color }}
                      className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md border bg-white hover:bg-slate-50">
                      {e.name} {e.value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {lista.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-10">Sin licitaciones en este filtro</p>
                ) : lista.slice(0, maxLista).map(n => {
                  const cfg = getEstadoPipeline(n.estado_pipeline);
                  const col = cfg?.color || '#64748b';
                  const d = diasHasta(n.licitacion_cierre);
                  const cierreTint = d != null && d >= 0 ? (d <= 3 ? '#dc2626' : d <= 7 ? '#d97706' : '#64748b') : '#94a3b8';
                  const perfilCol = colorUsuario(n.usuario_email || n.usuario_nombre || 'sin');
                  return (
                    <Link key={n.id} href={`/negocios/${n.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors group">
                      <span className="text-[10.5px] font-mono font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0 w-[130px] truncate">{n.licitacion_codigo}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">{n.licitacion_nombre || '(sin nombre)'}</p>
                        {n.licitacion_organismo && <p className="text-[11px] text-slate-400 truncate flex items-center gap-1"><Building2 size={9} /> {n.licitacion_organismo}</p>}
                      </div>
                      {/* El avatar sobra solo si estás mirando UN perfil: ahí ya se sabe de quién es. */}
                      {perfilesSel.length !== 1 && (
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0" style={{ background: perfilCol }} title={n.usuario_nombre || n.usuario_email || ''}>
                          {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 whitespace-nowrap"
                        style={{ background: col + '18', color: col, borderColor: col + '40' }}>{cfg?.label || n.estado_pipeline}</span>
                      <span className="text-[12px] font-semibold text-slate-700 tabular-nums w-16 text-right flex-shrink-0">{fmtMontoCorto(n.monto_ofertado || n.licitacion_monto || 0)}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums w-20 justify-end flex-shrink-0" style={{ color: cierreTint }}>
                        <Calendar size={10} /> {fmtFecha(n.licitacion_cierre)}
                      </span>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-500 flex-shrink-0" />
                    </Link>
                  );
                })}
                {lista.length > maxLista && (
                  <div className="flex justify-center py-3">
                    <button onClick={() => setMaxLista(m => m + 50)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-400 hover:shadow-sm px-4 py-2 rounded-lg transition-all">
                      <ChevronDown size={13} />
                      Mostrar más ({lista.length - maxLista} restantes)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────
function KPI({ icon, label, value, tint, sub }: { icon: React.ReactNode; label: string; value: string; tint: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3.5 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${tint}14`, color: tint }}>{icon}</div>
        <p className="text-[10.5px] text-slate-400 font-semibold uppercase tracking-wide leading-tight">{label}</p>
      </div>
      <p className="text-[24px] font-black text-slate-900 leading-none tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
      <span className="text-[12px] text-slate-500 flex-1">{label}</span>
      <span className="text-[15px] font-bold text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}

// Ficha de PROCEDENCIA al pie de cada gráfico: de qué campo/endpoint sale el número, sobre qué
// conjunto se midió y cómo se calculó. Sin esto hay que leer el código para saber por qué dos
// tarjetas que "deberían" dar lo mismo dan distinto.
function Procedencia({ fuente, universo, calculo, ojo }: {
  fuente: string; universo: string; calculo: string; ojo?: string;
}) {
  return (
    <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1 text-[10.5px] leading-snug text-slate-500">
      <p><span className="font-bold text-slate-600 uppercase tracking-wide">Fuente</span> · {fuente}</p>
      <p><span className="font-bold text-slate-600 uppercase tracking-wide">Mide</span> · {universo}</p>
      <p><span className="font-bold text-slate-600 uppercase tracking-wide">Cálculo</span> · {calculo}</p>
      {ojo && <p className="text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-1"><span className="font-bold">Ojo</span> · {ojo}</p>}
    </div>
  );
}

function SinDatos() {
  return <div className="h-[200px] flex items-center justify-center text-[12px] text-slate-300">Sin datos</div>;
}

// Dona por estado reutilizable (leyenda con valor y %). Se usa para "todas" y "en trabajo".
// SELECTIVA y MÚLTIPLE: clic en un segmento (o en su fila de la leyenda) suma ese estado a la
// selección y el tablero entero se remide sobre ella; clic de nuevo lo quita. Se pueden marcar
// varios a la vez. Los elegidos quedan a color pleno y el resto se atenúa, para que se vea de
// un vistazo qué tramo se está midiendo.
function DonaEstados({ data, total, centroLabel, seleccion = [], onSelect }: {
  data: { id: string; name: string; value: number; color: string; pct: number }[];
  total: number;
  centroLabel: string;
  seleccion?: string[];
  onSelect?: (id: string) => void;
}) {
  const atenuado = (id: string) => (seleccion.length > 0 && !seleccion.includes(id) ? 0.25 : 1);
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-shrink-0" style={{ width: 180, height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none"
              className={onSelect ? 'cursor-pointer' : undefined}
              onClick={(d: any) => { const id = d?.id ?? d?.payload?.id; if (id) onSelect?.(id); }}>
              {data.map((e) => <Cell key={e.id} fill={e.color} fillOpacity={atenuado(e.id)} />)}
            </Pie>
            <RTooltip content={<ChartTooltip sufijo="licitaciones" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[26px] font-black text-slate-900 leading-none tabular-nums">{total}</span>
          <span className="text-[10px] text-slate-400 font-semibold">{centroLabel}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {data.map(e => {
          const activo = seleccion.includes(e.id);
          return (
            <button key={e.id} type="button" onClick={() => onSelect?.(e.id)}
              className={`w-full flex items-center gap-2 text-[12px] rounded px-1 py-0.5 text-left transition-colors ${
                onSelect ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
              }`}
              style={{ opacity: atenuado(e.id) }}>
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: e.color }} />
              <span className={`truncate flex-1 ${activo ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{e.name}</span>
              <span className="font-bold text-slate-800 tabular-nums">{e.value}</span>
              <span className="text-slate-400 tabular-nums w-9 text-right">{e.pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
