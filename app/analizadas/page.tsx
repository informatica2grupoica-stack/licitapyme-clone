'use client';

// Página "Licitaciones analizadas" — lista las licitaciones que ya pasaron por el análisis
// de viabilidad con IA (PROMPT 2). Rediseño profesional: fecha+hora del análisis, DE QUIÉN
// es la licitación (perfil asignado), toda la info del análisis, orden y filtros completos.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { IconWand as Sparkles, IconLoader2 as Loader2, IconChevronRight as ChevronRight, IconBuilding as Building2, IconCalendar as Calendar, IconSearch as Search, IconFilter as Filter, IconX as X, IconGauge as Gauge, IconTrophy as Trophy, IconStack2 as Layers, IconUsers as Users, IconArrowsUpDown as ArrowUpDown, IconClock as Clock, IconRefresh as RefreshCw, IconWallet as Wallet } from '@tabler/icons-react';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';

interface Analizada {
  codigo: string; nombre: string; organismo: string; cierre: string | null;
  analizado_at: string; creado_at: string | null; reanalizada: boolean;
  score: number | null; semaforo: string | null; area: string | null;
  resultado: string | null; titular: string | null;
  // v4.1: nivel de atractivo (lo calcula el código) y la acción del asistente.
  nivel?: string | null; nivel_num?: number | null; nivel_presupuesto_neto?: number | null; accion?: string | null;
  presupuesto: number | null; modalidad: string | null; n_lineas: number | null;
  confianza: number | null; esquema: string;
  owner_nombre: string | null; owner_email: string | null; estado_pipeline: string | null;
}

const SEM: Record<string, { bg: string; text: string; label: string }> = {
  VERDE:     { bg: 'bg-emerald-500', text: 'text-emerald-700', label: 'Muy conveniente' },
  AMARILLO:  { bg: 'bg-yellow-500',  text: 'text-yellow-700',  label: 'Conveniente' },
  NARANJA:   { bg: 'bg-orange-500',  text: 'text-orange-700',  label: 'Media' },
  ROJO:      { bg: 'bg-red-500',     text: 'text-red-700',     label: 'Baja' },
  ROJO_DURO: { bg: 'bg-red-700',     text: 'text-red-800',     label: 'Descartar' },
};
const SEM_HEX: Record<string, string> = { VERDE: '#10b981', AMARILLO: '#eab308', NARANJA: '#f97316', ROJO: '#ef4444', ROJO_DURO: '#b91c1c' };
// Veredicto de negocio unificado (lo entrega ya normalizado la API).
const RES: Record<string, { label: string; bg: string; hex: string }> = {
  GANABLE:   { label: 'GANABLE',   bg: 'bg-emerald-600', hex: '#16a34a' },
  PUEDE_SER: { label: 'PUEDE SER', bg: 'bg-yellow-500',  hex: '#d97706' },
  NO_VAMOS:  { label: 'NO VAMOS',  bg: 'bg-red-600',     hex: '#dc2626' },
  // v4.1 · niveles de atractivo (informes analizados con la v4).
  MUY_ALTO:   { label: 'MUY ALTO',   bg: 'bg-emerald-600', hex: '#059669' },
  ALTO:       { label: 'ALTO',       bg: 'bg-emerald-500', hex: '#10b981' },
  MEDIO_ALTO: { label: 'MEDIO ALTO', bg: 'bg-yellow-500',  hex: '#eab308' },
  MEDIO:      { label: 'MEDIO',      bg: 'bg-yellow-500',  hex: '#ca8a04' },
  MEDIO_BAJO: { label: 'MEDIO BAJO', bg: 'bg-orange-500',  hex: '#f97316' },
  BAJO:       { label: 'BAJO',       bg: 'bg-red-500',     hex: '#ef4444' },
  EXCLUIDO:   { label: 'EXCLUIDO',   bg: 'bg-red-700',     hex: '#b91c1c' },
};
const fmt = (n?: number | null) => n != null ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const soloFecha = (s?: string | null) => s ? new Date(s).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fechaHora = (s?: string | null) => s ? new Date(s).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const modalidadLabel = (m?: string | null) => (m ? String(m).replace(/_/g, ' ') : '—');

type Orden = 'reciente' | 'antiguo' | 'nivel' | 'score_desc' | 'score_asc' | 'cierre' | 'presupuesto';

export default function AnalizadasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const puedeVer = !!usuario?.permisos?.ver_analizadas;

  const [lics, setLics] = useState<Analizada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');
  const [fSemaforo, setFSemaforo]   = useState<string[]>([]);
  const [fResultado, setFResultado] = useState<string[]>([]);
  const [fModalidad, setFModalidad] = useState<string[]>([]);
  const [fOwner, setFOwner]         = useState<string[]>([]);
  const [orden, setOrden] = useState<Orden>('reciente');
  const hayFiltro = fSemaforo.length > 0 || fResultado.length > 0 || fModalidad.length > 0 || fOwner.length > 0;
  const limpiar = () => { setFSemaforo([]); setFResultado([]); setFModalidad([]); setFOwner([]); };

  const cargar = useCallback(() => {
    fetch('/api/analizadas').then(r => r.json())
      .then(d => { if (d.success) setLics(d.licitaciones || []); })
      .catch(() => { /* noop */ })
      .finally(() => setCargando(false));
  }, []);

  // Análisis IA de TODOS los negocios: es admin-only de verdad (la API también lo exige),
  // no solo un ítem oculto en el sidebar — ver auditoría ago-2026.
  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  // Opciones (con conteo) presentes en los datos, para cada filtro.
  const opciones = useMemo(() => {
    const sem = new Map<string, number>(), res = new Map<string, number>(), mod = new Map<string, number>(), own = new Map<string, { nombre: string; n: number }>();
    for (const l of lics) {
      if (l.semaforo) sem.set(l.semaforo, (sem.get(l.semaforo) || 0) + 1);
      if (l.resultado) res.set(l.resultado, (res.get(l.resultado) || 0) + 1);
      if (l.modalidad) mod.set(l.modalidad, (mod.get(l.modalidad) || 0) + 1);
      const key = l.owner_email || (l.owner_nombre ? l.owner_nombre : null);
      if (key) { const cur = own.get(key) || { nombre: l.owner_nombre || l.owner_email || key, n: 0 }; cur.n++; own.set(key, cur); }
    }
    const ordenSem = ['VERDE', 'AMARILLO', 'NARANJA', 'ROJO', 'ROJO_DURO'];
    const ordenRes = ['MUY_ALTO', 'ALTO', 'MEDIO_ALTO', 'MEDIO', 'MEDIO_BAJO', 'BAJO', 'EXCLUIDO', 'GANABLE', 'PUEDE_SER', 'NO_VAMOS'];
    return {
      semaforo: [...sem.entries()].sort((a, b) => ordenSem.indexOf(a[0]) - ordenSem.indexOf(b[0]))
        .map(([v, c]) => ({ value: v, label: SEM[v]?.label || v, color: SEM_HEX[v], count: c })),
      resultado: [...res.entries()].sort((a, b) => ordenRes.indexOf(a[0]) - ordenRes.indexOf(b[0]))
        .map(([v, c]) => ({ value: v, label: RES[v]?.label || v, color: RES[v]?.hex, count: c })),
      modalidad: [...mod.entries()].sort().map(([v, c]) => ({ value: v, label: modalidadLabel(v), count: c })),
      owner: [...own.entries()].sort((a, b) => b[1].n - a[1].n)
        .map(([v, o]) => ({ value: v, label: o.nombre, color: colorUsuario(v), count: o.n })),
    };
  }, [lics]);

  const filtradas = useMemo(() => {
    const arr = lics.filter(l =>
      (!q || l.nombre.toLowerCase().includes(q.toLowerCase()) || l.codigo.toLowerCase().includes(q.toLowerCase()) || (l.organismo || '').toLowerCase().includes(q.toLowerCase()) || (l.owner_nombre || '').toLowerCase().includes(q.toLowerCase())) &&
      (fSemaforo.length === 0 || (!!l.semaforo && fSemaforo.includes(l.semaforo))) &&
      (fResultado.length === 0 || (!!l.resultado && fResultado.includes(l.resultado))) &&
      (fModalidad.length === 0 || (!!l.modalidad && fModalidad.includes(l.modalidad))) &&
      (fOwner.length === 0 || fOwner.includes(l.owner_email || l.owner_nombre || '')));
    const t = (s?: string | null) => (s ? new Date(s).getTime() : 0);
    const arrSorted = [...arr];
    arrSorted.sort((a, b) => {
      switch (orden) {
        case 'antiguo':     return t(a.analizado_at) - t(b.analizado_at);
        // v4.1 §5.5: por nivel y, dentro del mismo nivel, por presupuesto neto de mayor a menor.
        case 'nivel':       return ((b.nivel_num ?? -1) - (a.nivel_num ?? -1)) || ((b.nivel_presupuesto_neto ?? 0) - (a.nivel_presupuesto_neto ?? 0));
        case 'score_desc':  return (b.score ?? -1) - (a.score ?? -1);
        case 'score_asc':   return (a.score ?? 999) - (b.score ?? 999);
        case 'cierre': {    // cierre más cercano primero; sin cierre al final
          const ca = a.cierre ? t(a.cierre) : Infinity, cb = b.cierre ? t(b.cierre) : Infinity;
          return ca - cb;
        }
        case 'presupuesto': return (b.presupuesto ?? -1) - (a.presupuesto ?? -1);
        default:            return t(b.analizado_at) - t(a.analizado_at); // reciente
      }
    });
    return arrSorted;
  }, [lics, q, fSemaforo, fResultado, fModalidad, fOwner, orden]);

  if (cargandoSesion || (!puedeVer && cargando)) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto space-y-3 p-4 sm:p-6">
          <Esqueleto className="h-7 w-56" />
          {[1, 2, 3, 4].map(i => <Esqueleto key={i} className="h-24 rounded-xl" />)}
        </div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Licitaciones analizadas' }]}>
      <div className="@container max-w-6xl mx-auto p-4 sm:p-6">
        <Encabezado
          titulo="Licitaciones analizadas"
          descripcion={`${hayFiltro || q ? `${filtradas.length} de ${lics.length}` : lics.length} con análisis de viabilidad completado`}
          acciones={
            <div className="relative">
              <Search size={16} stroke={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, código, organismo o perfil…" aria-label="Buscar analizadas"
                className="h-9 w-72 rounded-lg border border-linea bg-white pl-9 pr-3 text-[13px] text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </div>
          }
        />

        {/* Barra de filtros + orden */}
        {!cargando && lics.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-[13px] font-medium text-tinta-2 dark:text-slate-400 flex items-center gap-1.5 mr-1"><Filter size={16} stroke={1.75} className="text-slate-400" /> Filtros</span>
            <MultiSelect label="Semáforo" icon={<Gauge size={14} />} options={opciones.semaforo} selected={fSemaforo} onChange={setFSemaforo} />
            <MultiSelect label="Veredicto" icon={<Trophy size={14} />} options={opciones.resultado} selected={fResultado} onChange={setFResultado} />
            {opciones.modalidad.length > 0 && (
              <MultiSelect label="Modalidad" icon={<Layers size={14} />} options={opciones.modalidad} selected={fModalidad} onChange={setFModalidad} />
            )}
            {opciones.owner.length > 0 && (
              <MultiSelect label="Perfil" icon={<Users size={14} />} options={opciones.owner} selected={fOwner} onChange={setFOwner} minWidth={220} />
            )}
            {hayFiltro && (
              <Boton variante="fantasma" onClick={limpiar} icono={<X size={16} stroke={1.75} />}>Limpiar</Boton>
            )}
            <div className="inline-flex items-center gap-1.5 ml-auto">
              <span className="inline-flex items-center gap-1.5 text-[13px] text-tinta-2 dark:text-slate-400"><ArrowUpDown size={16} stroke={1.75} className="text-slate-400" /> Ordenar</span>
              <Select value={orden} onChange={v => setOrden(v as Orden)}
                options={[
                  { value: 'reciente', label: 'Análisis reciente' },
                  { value: 'antiguo', label: 'Análisis más antiguo' },
                  { value: 'nivel', label: 'Nivel de atractivo' },
                  { value: 'score_desc', label: 'Score (mayor)' },
                  { value: 'score_asc', label: 'Score (menor)' },
                  { value: 'cierre', label: 'Cierre más cercano' },
                  { value: 'presupuesto', label: 'Presupuesto (mayor)' },
                ]} />
            </div>
          </div>
        )}

        {cargando ? (
          <div className="space-y-2">{[1, 2, 3, 4].map(i => <Esqueleto key={i} className="h-24 rounded-xl" />)}</div>
        ) : filtradas.length === 0 ? (
          <Vacio icono={<Sparkles size={28} stroke={1.75} />}
            titulo={hayFiltro || q ? 'Sin resultados' : 'Aún no hay licitaciones analizadas'}
            texto={hayFiltro || q ? 'Ninguna analizada coincide con la búsqueda o los filtros.' : 'Entra a una licitación del radar → Viabilidad → «Analizar». Aparecerán aquí.'}
            accion={hayFiltro || q ? <Boton tamano="sm" onClick={() => { limpiar(); setQ(''); }}>Quitar filtros</Boton> : undefined} />
        ) : (
          <div className="space-y-2">
            {filtradas.map((l, i) => {
              const sem = SEM[l.semaforo || ''] || { bg: 'bg-zinc-400', text: 'text-tinta-2 dark:text-slate-400', label: '—' };
              const semHex = SEM_HEX[l.semaforo || ''] || '#94a3b8';
              const res = l.resultado ? RES[l.resultado] : null;
              const nivel = l.nivel ? RES[l.nivel] : null;
              const ownerKey = l.owner_email || l.owner_nombre || '';
              return (
                <Link key={l.codigo} href={`/licitacion/${encodeURIComponent(l.codigo)}`}
                  style={{ '--stagger-i': Math.min(i, 12) } as React.CSSProperties}
                  className="stagger-item group flex items-stretch gap-4 rounded-xl border border-linea bg-white p-4 shadow-tarjeta transition-[box-shadow,border-color] duration-150 hover:border-teal-300 hover:shadow-tarjeta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-800 dark:bg-slate-900">
                  {/* Nivel (v4) o score (análisis anteriores): número/nivel grande con punto de color, sin bloque sólido */}
                  <div className="flex w-20 flex-shrink-0 flex-col items-start justify-center" title={l.accion || ''}>
                    {nivel ? (
                      <>
                        <span className="text-[13px] font-semibold leading-tight text-tinta dark:text-slate-100">{nivel.label.charAt(0) + nivel.label.slice(1).toLowerCase()}</span>
                        <span className="mt-1 h-1.5 w-12 rounded-full" style={{ backgroundColor: nivel.hex }} aria-hidden />
                      </>
                    ) : (
                      <>
                        <span className="text-[22px] font-semibold leading-none tracking-tight tabular-nums text-tinta dark:text-slate-50">{l.score ?? '—'}<span className="text-xs font-normal text-tinta-2"> /100</span></span>
                        <span className="mt-1.5 h-1.5 w-12 rounded-full" style={{ backgroundColor: semHex }} aria-hidden />
                      </>
                    )}
                  </div>

                  {/* Identidad + análisis */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-tinta dark:text-slate-100 truncate group-hover:text-marca">{l.nombre}</p>
                    <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-0.5 text-xs text-tinta-2 dark:text-slate-400">
                      <span className="font-mono">{l.codigo}</span>
                      {l.organismo && <span className="flex items-center gap-1 truncate max-w-[220px]"><Building2 size={14} stroke={1.75} />{l.organismo}</span>}
                      <span className="flex items-center gap-1" title="Cierre de recepción de ofertas"><Calendar size={14} stroke={1.75} />Cierre {soloFecha(l.cierre)}</span>
                    </div>
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-xs">
                      {res
                        ? <span className="font-medium text-tinta dark:text-slate-100"><Estado color={res.hex}>{res.label.charAt(0) + res.label.slice(1).toLowerCase()}</Estado></span>
                        : <span className="text-tinta-2 dark:text-slate-400">Sin veredicto</span>}
                      <span className="font-medium text-tinta-2 dark:text-slate-300"><Estado color={semHex}>{sem.label}</Estado></span>
                      {l.presupuesto != null && <span className="inline-flex items-center gap-1 font-medium text-tinta dark:text-slate-100 tabular-nums"><Wallet size={14} stroke={1.75} className="text-slate-400" />{fmt(l.presupuesto)}</span>}
                      {l.modalidad && <span className="text-tinta-2 dark:text-slate-400">{modalidadLabel(l.modalidad)}</span>}
                      {l.n_lineas != null && <span className="text-tinta-2 dark:text-slate-400">{l.n_lineas} línea{l.n_lineas === 1 ? '' : 's'}</span>}
                      {l.confianza != null && <span className="text-tinta-2 dark:text-slate-400" title="Confianza del análisis">conf. {Math.round(l.confianza * 100)}%</span>}
                    </div>
                  </div>

                  {/* Dueño + fecha/hora de análisis (columna derecha) */}
                  <div className="hidden @3xl:flex flex-col items-end justify-center gap-1 flex-shrink-0 w-[200px] border-l border-linea dark:border-slate-800 pl-4">
                    {ownerKey ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-tinta dark:text-slate-200">
                        <span style={{ background: colorUsuario(ownerKey) }} className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[8px] font-semibold flex-shrink-0">
                          {inicialesUsuario(l.owner_nombre, l.owner_email)}
                        </span>
                        <span className="truncate max-w-[140px]">{l.owner_nombre || l.owner_email}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-tinta-3">Sin asignar</span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs text-tinta-2 dark:text-slate-400 tabular-nums" title={`Analizada el ${fechaHora(l.analizado_at)}`}>
                      {l.reanalizada ? <RefreshCw size={14} stroke={1.75} className="text-slate-400" /> : <Clock size={14} stroke={1.75} className="text-slate-400" />}
                      {fechaHora(l.analizado_at)}
                    </span>
                    <span className="text-xs text-tinta-3">{l.reanalizada ? 'Re-analizada' : 'Analizada'} · {l.esquema}</span>
                  </div>

                  <ChevronRight size={18} stroke={1.75} className="text-slate-300 group-hover:text-marca flex-shrink-0 self-center" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
