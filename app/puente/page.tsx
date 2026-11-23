'use client';

// PUENTE DEL RADAR — la bandeja donde el asesor deja licitaciones y las reparte al equipo.
//
// Flujo: el radar empuja licitaciones acá → se eligen los perfiles y una estrategia de reparto
// → "Simular" muestra en columnas quién se lleva qué (y por qué) → se puede corregir a mano
// arrastrando tarjetas → "Confirmar" crea los negocios y vacía el puente.
//
// La vista previa NO se calcula acá: la calcula el servidor con el mismo motor que la ejecución
// (app/lib/puente-reparto.ts). Esta pantalla solo la pinta y deja ajustarla.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconArrowsShuffle as Shuffle, IconLoader2 as Loader2, IconUsers as Users, IconTrash as Trash2, IconRefresh as RefreshCw, IconBuilding as Building2, IconCalendar as Calendar, IconExternalLink as ExternalLink, IconCheck as Check, IconX as X, IconScale as Scale, IconTag as Tag, IconCurrencyDollar as DollarSign, IconMapPin as MapPin, IconGauge as Gauge, IconHandStop as Hand, IconAlertTriangle as AlertTriangle, IconStack2 as Layers, IconArrowRight as ArrowRight, IconPlus as Plus, IconRadar as RadarIcon, IconGripVertical as GripVertical, IconWand as Sparkles } from '@tabler/icons-react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { PuenteLoader } from '@/app/components/ui/PuenteLoader';
import { extractTipoFromCodigo, getTipoLicitacion } from '@/app/lib/tipos-licitacion';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { Banner } from '@/app/components/ui/Banner';
import { Tooltip } from '@/app/components/ui/Tooltip';
import type { Estrategia } from '@/app/lib/puente-reparto';

// ── Tipos (espejo de lo que devuelve /api/puente) ──────────────────────────────
interface LicitacionPuente {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | string | null;
  licitacion_cierre: string | null;
  licitacion_estado: string | null;
  licitacion_tipo: string | null;
  licitacion_region: string | null;
  categoria_nombre: string | null;
  viabilidad_semaforo: string | null;
  agregado_en?: string;
}
interface Perfil {
  id: number; nombre: string | null; email: string; rol?: string;
  cargaActual: number; vencidas?: number;
}
interface ValorConteo { valor: string; total: number }
interface Adjudicacion { codigo: string; usuarioId: number | null; motivo: string }
interface Tramo { desde: number | null; hasta: number | null; usuarioId: number | null }

const ESTRATEGIAS: { value: Estrategia; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: 'equitativa', label: 'Reparto equitativo', icon: <Scale size={14} />,
    desc: '30 licitaciones entre 3 perfiles → 10 y 10 y 10, elegidas al azar.' },
  { value: 'carga',      label: 'Nivelar carga de trabajo', icon: <Gauge size={14} />,
    desc: 'Mira cuántas tiene encima cada uno hoy y empareja: el más desocupado recibe más.' },
  { value: 'categoria',  label: 'Por categoría', icon: <Tag size={14} />,
    desc: 'Ferretería a un perfil, aseo a otro. Lo que no calce se reparte parejo.' },
  { value: 'monto',      label: 'Por rango de monto', icon: <DollarSign size={14} />,
    desc: 'Tramos de presupuesto: las chicas a uno, las grandes a otro.' },
  { value: 'region',     label: 'Por región', icon: <MapPin size={14} />,
    desc: 'Cada región a su responsable. Lo que no calce se reparte parejo.' },
  { value: 'viabilidad', label: 'Por viabilidad', icon: <Sparkles size={14} />,
    desc: 'Según el semáforo del análisis IA (verde/amarillo/rojo).' },
];

const fmtMonto = (n: number | string | null) => {
  const v = n == null ? null : Number(n);
  return v ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(v) : '—';
};
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
};
const nombrePerfil = (p?: Perfil | null) => p?.nombre || p?.email || 'perfil';
const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const ROTULO = 'text-[13px] font-medium text-tinta dark:text-slate-200';
const CAMPO = 'h-9 rounded-lg border border-linea bg-white px-2.5 text-sm text-tinta outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export default function PuentePage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();

  const [cargando, setCargando] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);
  const [licitaciones, setLicitaciones] = useState<LicitacionPuente[]>([]);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [valores, setValores] = useState<{ categorias: ValorConteo[]; regiones: ValorConteo[]; semaforos: ValorConteo[] }>(
    { categorias: [], regiones: [], semaforos: [] });

  // Configuración del reparto
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [estrategia, setEstrategia] = useState<Estrategia>('equitativa');
  const [reglas, setReglas] = useState<Record<string, number | null>>({});   // valor → perfil
  const [tramos, setTramos] = useState<Tramo[]>([
    { desde: null, hasta: 5_000_000, usuarioId: null },
    { desde: 5_000_000, hasta: 50_000_000, usuarioId: null },
    { desde: 50_000_000, hasta: null, usuarioId: null },
  ]);
  const [fallback, setFallback] = useState<'equitativa' | 'carga' | 'ninguno'>('equitativa');

  // Vista previa
  const [previa, setPrevia] = useState<Adjudicacion[] | null>(null);
  const [semilla, setSemilla] = useState<number | null>(null);
  const [ajustadaAMano, setAjustadaAMano] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);

  const puedeUsar = !!usuario && (usuario.rol === 'admin' || usuario.permisos?.repartir_puente);

  // ── Carga ────────────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const d = await fetch('/api/puente').then(r => r.json());
      if (d._migrationPending) { setMigrationPending(true); return; }
      if (!d.success) { toast.error('No se pudo cargar el puente', d.error); return; }
      setLicitaciones(d.licitaciones || []);
      setPerfiles(d.perfiles || []);
      setValores(d.valores || { categorias: [], regiones: [], semaforos: [] });
    } catch {
      toast.error('Error de conexión');
    } finally { setCargando(false); }
  }, [toast]);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeUsar) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeUsar, router, cargar]);

  // Cualquier cambio de configuración invalida la vista previa: no se puede confirmar
  // un reparto que ya no corresponde a lo que está en pantalla.
  const invalidarPrevia = useCallback(() => { setPrevia(null); setSemilla(null); setAjustadaAMano(false); }, []);

  // ── Derivados ────────────────────────────────────────────────────────────────
  const perfilesElegidos = useMemo(
    () => elegidos.map(id => perfiles.find(p => p.id === id)).filter((p): p is Perfil => !!p),
    [elegidos, perfiles]);

  const porCodigo = useMemo(
    () => new Map(licitaciones.map(l => [l.licitacion_codigo, l])), [licitaciones]);

  // Reparto pintado por columnas (incluye la columna "sin asignar").
  const columnas = useMemo(() => {
    if (!previa) return [];
    const cols = perfilesElegidos.map(p => ({
      perfil: p as Perfil | null,
      items: previa.filter(a => a.usuarioId === p.id),
    }));
    const huerfanas = previa.filter(a => a.usuarioId == null);
    if (huerfanas.length > 0) cols.push({ perfil: null, items: huerfanas });
    return cols;
  }, [previa, perfilesElegidos]);

  const valoresDeLaEstrategia = useMemo((): ValorConteo[] => {
    if (estrategia === 'categoria') return valores.categorias;
    if (estrategia === 'region') return valores.regiones;
    if (estrategia === 'viabilidad') return valores.semaforos;
    return [];
  }, [estrategia, valores]);

  const opcionesPerfil = useMemo(
    () => [{ value: '', label: '— sin asignar —' },
           ...perfilesElegidos.map(p => ({ value: String(p.id), label: nombrePerfil(p), color: colorUsuario(p.id) }))],
    [perfilesElegidos]);

  // ── Acciones ─────────────────────────────────────────────────────────────────
  const togglePerfil = (id: number) => {
    setElegidos(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    invalidarPrevia();
  };

  const quitarDelPuente = useCallback(async (codigos: string[]) => {
    if (codigos.length === 0) return;
    try {
      const d = await fetch('/api/puente', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos }),
      }).then(r => r.json());
      if (!d.success) { toast.error('No se pudo sacar del puente', d.error); return; }
      setLicitaciones(prev => prev.filter(l => !codigos.includes(l.licitacion_codigo)));
      invalidarPrevia();
      toast.success(`${d.eliminadas} licitación(es) de vuelta al radar`);
    } catch { toast.error('Error de conexión'); }
  }, [toast, invalidarPrevia]);

  const vaciarPuente = useCallback(async () => {
    const ok = await confirmar({
      titulo: 'Vaciar el puente',
      mensaje: `Las ${licitaciones.length} licitaciones vuelven al radar tal como estaban. No se asigna ni se descarta ninguna.`,
      confirmarLabel: 'Vaciar', peligro: true,
    });
    if (!ok) return;
    try {
      const d = await fetch('/api/puente', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: true }),
      }).then(r => r.json());
      if (!d.success) { toast.error('No se pudo vaciar', d.error); return; }
      setLicitaciones([]); invalidarPrevia();
      toast.success('Puente vacío');
    } catch { toast.error('Error de conexión'); }
  }, [confirmar, licitaciones.length, toast, invalidarPrevia]);

  /** Config actual → cuerpo que entienden /simular y /repartir. */
  const construirConfig = useCallback(() => {
    const base: Record<string, unknown> = { estrategia, perfiles: elegidos, fallback };
    if (estrategia === 'categoria' || estrategia === 'region' || estrategia === 'viabilidad') {
      base.reglas = Object.entries(reglas)
        .filter(([, uid]) => uid != null)
        .map(([valor, usuarioId]) => ({ valor, usuarioId }));
    }
    if (estrategia === 'monto') {
      base.tramos = tramos.filter(t => t.usuarioId != null);
    }
    return base;
  }, [estrategia, elegidos, fallback, reglas, tramos]);

  const simular = useCallback(async () => {
    if (elegidos.length === 0) { toast.warning('Elige al menos un perfil de destino'); return; }
    setSimulando(true);
    try {
      const d = await fetch('/api/puente/simular', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(construirConfig()),
      }).then(r => r.json());
      if (!d.success) { toast.error('No se pudo simular', d.error); return; }
      setPrevia(d.resultado.asignaciones);
      setSemilla(d.semilla);
      setAjustadaAMano(false);
      const sin = d.resultado.sinAsignar.length;
      toast.success('Vista previa lista', sin > 0 ? `${sin} sin asignar con esta regla` : 'Revisa y confirma');
    } catch { toast.error('Error de conexión'); }
    finally { setSimulando(false); }
  }, [elegidos.length, construirConfig, toast]);

  /** Mover una tarjeta de columna (arrastrar o menú). Pasa el reparto a modo manual. */
  const mover = useCallback((codigo: string, usuarioId: number | null) => {
    setPrevia(prev => prev ? prev.map(a =>
      a.codigo === codigo ? { ...a, usuarioId, motivo: usuarioId == null ? 'sacada a mano' : 'movida a mano' } : a) : prev);
    setAjustadaAMano(true);
  }, []);

  const confirmarReparto = useCallback(async () => {
    if (!previa || semilla == null) return;
    const asignadas = previa.filter(a => a.usuarioId != null);
    if (asignadas.length === 0) { toast.warning('No hay ninguna licitación asignada en la vista previa'); return; }

    const resumen = perfilesElegidos
      .map(p => `${nombrePerfil(p)}: ${previa.filter(a => a.usuarioId === p.id).length}`)
      .join(' · ');
    const ok = await confirmar({
      titulo: `Repartir ${asignadas.length} licitación(es)`,
      mensaje: `${resumen}\n\nSe crean los negocios, se avisa a cada perfil y el puente queda con lo que no se asignó.`,
      confirmarLabel: 'Repartir ahora',
    });
    if (!ok) return;

    setEjecutando(true);
    try {
      // Si el asesor movió tarjetas, lo que manda es SU reparto: se envía como 'manual'.
      const cuerpo = ajustadaAMano
        ? { estrategia: 'manual', perfiles: elegidos, semilla,
            manual: asignadas.map(a => ({ codigo: a.codigo, usuarioId: a.usuarioId })),
            confirmacion: previa }
        : { ...construirConfig(), semilla, confirmacion: previa };

      const res = await fetch('/api/puente/repartir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const d = await res.json();
      if (res.status === 409) { toast.error('El puente cambió', 'Vuelve a simular antes de confirmar'); await cargar(); invalidarPrevia(); return; }
      if (!d.success) { toast.error('No se pudo repartir', d.error); return; }

      const detalle = (d.porPerfil || [])
        .filter((p: any) => p.asignadas > 0)
        .map((p: any) => `${p.nombre || p.email}: ${p.asignadas}`).join(' · ');
      if (d.fallidas?.length) {
        toast.warning(`${d.asignadas} de ${d.total} repartidas`, `${d.fallidas.length} quedaron en el puente para reintentar`);
      } else {
        toast.success(`${d.asignadas} licitación(es) repartidas`, detalle);
      }
      invalidarPrevia();
      await cargar();
    } catch { toast.error('Error de conexión'); }
    finally { setEjecutando(false); }
  }, [previa, semilla, perfilesElegidos, confirmar, toast, ajustadaAMano, elegidos, construirConfig, cargar, invalidarPrevia]);

  // ── Render ───────────────────────────────────────────────────────────────────
  if (cargandoSesion || (cargando && !migrationPending)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Puente' }]}>
        <div className="@container mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
          <Esqueleto className="h-7 w-56" />
          <Esqueleto className="mt-2 h-4 w-80" />
          <div className="mt-6 grid grid-cols-1 gap-5 @4xl:grid-cols-3">
            <div className="space-y-2 @4xl:col-span-2">
              {Array.from({ length: 5 }).map((_, i) => <Esqueleto key={i} className="h-[72px] rounded-xl" />)}
            </div>
            <Esqueleto className="h-80 rounded-xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (migrationPending) {
    return (
      <AppLayout breadcrumb={[{ label: 'Puente' }]}>
        <div className="mx-auto max-w-2xl p-8">
          <Banner variante="warning">
            <span className="font-semibold">Falta aplicar la migración.</span> El puente necesita sus tablas. Corre{' '}
            <code className="rounded border border-linea bg-white px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900">node scripts/aplicar-migration-73.mjs</code> y recarga.
          </Banner>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Puente' }]}>
      <div className="@container mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">

        <Encabezado
          titulo="Puente del radar"
          descripcion={licitaciones.length === 0
            ? 'Vacío. Empuja licitaciones desde el radar para repartirlas al equipo.'
            : `${licitaciones.length} licitación${licitaciones.length !== 1 ? 'es' : ''} esperando dueño`}
          acciones={
            <>
              <Link href="/radar"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-linea bg-white px-3.5 text-sm font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                <RadarIcon size={16} stroke={1.75} /> Ir al radar
              </Link>
              <Tooltip label="Recargar el puente">
                <Boton onClick={cargar} icono={<RefreshCw size={16} stroke={1.75} />}>Actualizar</Boton>
              </Tooltip>
              {licitaciones.length > 0 && (
                <Tooltip label="Devolver TODO al radar (no asigna ni descarta nada)">
                  <Boton variante="peligro" onClick={vaciarPuente} icono={<Trash2 size={16} stroke={1.75} />}>Vaciar</Boton>
                </Tooltip>
              )}
            </>
          }
        />

        {licitaciones.length === 0 ? (
          <Vacio icono={<Shuffle size={28} stroke={1.75} />} titulo="El puente está vacío"
            texto="En el radar, selecciona licitaciones y usa el botón «Al puente». Cuando tengas la tanda completa, vuelve acá y repártela entre los perfiles."
            accion={<Link href="/radar" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-marca px-3 text-[13px] font-medium text-white shadow-tarjeta hover:bg-marca-fuerte focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60">Abrir el radar <ArrowRight size={16} stroke={1.75} /></Link>} />
        ) : (
          <div className="grid grid-cols-1 @4xl:grid-cols-3 gap-5 items-start">

            {/* ── Columna izquierda: contenido del puente ─────────────────────── */}
            <div className="@4xl:col-span-2 space-y-3">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-100">
                <Layers size={18} stroke={1.75} className="text-slate-400" /> En el puente <span className="text-xs font-semibold tabular-nums text-tinta-2 dark:text-slate-400">{licitaciones.length}</span>
              </h2>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {licitaciones.map(l => {
                  const tipo = getTipoLicitacion(extractTipoFromCodigo(l.licitacion_codigo));
                  return (
                    <div key={l.id} className="bg-white border border-linea rounded-xl px-4 py-3 shadow-tarjeta transition-colors hover:border-teal-200 dark:bg-slate-900 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {tipo && <span className="text-xs font-medium text-tinta dark:text-slate-200"><Estado color={tipo.color}>{tipo.codigo}</Estado></span>}
                            <span className="font-mono text-xs text-tinta-2 dark:text-slate-400">{l.licitacion_codigo}</span>
                            {l.categoria_nombre && (
                              <span className="inline-flex items-center gap-1 text-xs text-tinta-2 dark:text-slate-400">
                                <Tag size={12} stroke={1.75} /> {l.categoria_nombre}
                              </span>
                            )}
                          </div>
                          <p className="text-[13px] font-medium text-tinta dark:text-slate-100 truncate mt-0.5">{l.licitacion_nombre || 'Sin nombre'}</p>
                          <div className="flex items-center gap-3 text-xs text-tinta-2 dark:text-slate-400 mt-1 flex-wrap">
                            {l.licitacion_organismo && (
                              <span className="inline-flex items-center gap-1 truncate max-w-[260px]"><Building2 size={14} stroke={1.75} /> {l.licitacion_organismo}</span>
                            )}
                            <span className="inline-flex items-center gap-1"><DollarSign size={14} stroke={1.75} /> <span className="tabular-nums">{fmtMonto(l.licitacion_monto)}</span></span>
                            <span className="inline-flex items-center gap-1"><Calendar size={14} stroke={1.75} /> {fmtFecha(l.licitacion_cierre)}</span>
                            {l.licitacion_region && (
                              <span className="inline-flex items-center gap-1 truncate max-w-[160px]"><MapPin size={14} stroke={1.75} /> {l.licitacion_region}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Tooltip label="Abrir la licitación en otra pestaña">
                            <Link href={`/licitacion/${encodeURIComponent(l.licitacion_codigo)}`} target="_blank" aria-label="Abrir la licitación en otra pestaña"
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800">
                              <ExternalLink size={16} stroke={1.75} />
                            </Link>
                          </Tooltip>
                          <Tooltip label="Sacar del puente (vuelve al radar sin cambios)">
                            <button onClick={() => quitarDelPuente([l.licitacion_codigo])} aria-label="Sacar del puente"
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-urgente focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-red-950/40">
                              <X size={16} stroke={1.75} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Columna derecha: panel de reparto ───────────────────────────── */}
            <div className="bg-white border border-linea rounded-xl p-5 shadow-tarjeta space-y-4 @4xl:sticky @4xl:top-4 dark:bg-slate-900 dark:border-slate-800">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-100">
                <Users size={18} stroke={1.75} className="text-slate-400" /> Repartir a
              </h2>

              {/* Perfiles */}
              <div className="flex flex-wrap gap-1.5">
                {perfiles.map(p => {
                  const on = elegidos.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => togglePerfil(p.id)}
                      title={`${nombrePerfil(p)} — ${p.cargaActual} licitación(es) vigentes hoy`}
                      className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 h-8 rounded-lg border text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60
                        ${on ? 'bg-marca text-white border-marca' : 'bg-white text-tinta border-linea hover:border-teal-300 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700'}`}>
                      <span className="w-5 h-5 rounded-full text-[10px] font-semibold text-white flex items-center justify-center"
                        style={{ background: colorUsuario(p.id) }}>
                        {inicialesUsuario(p.nombre, p.email)}
                      </span>
                      <span className="truncate max-w-[120px]">{nombrePerfil(p)}</span>
                      <span className={`text-xs font-semibold tabular-nums ${on ? 'text-white/80' : 'text-tinta-2'}`}>
                        {p.cargaActual}
                      </span>
                    </button>
                  );
                })}
              </div>
              {elegidos.length > 0 && (
                <p className="text-xs text-tinta-2 dark:text-slate-400 -mt-2">
                  El número es su carga vigente de hoy. {licitaciones.length} ÷ {elegidos.length} ≈{' '}
                  <strong className="font-semibold text-tinta dark:text-slate-200">{Math.floor(licitaciones.length / elegidos.length)}</strong> por perfil.
                </p>
              )}

              {/* Estrategia */}
              <div className="space-y-1.5">
                <label className={ROTULO}>Cómo repartir</label>
                <Select
                  value={estrategia}
                  onChange={v => { setEstrategia(v as Estrategia); setReglas({}); invalidarPrevia(); }}
                  options={ESTRATEGIAS.map(e => ({ value: e.value, label: e.label, description: e.desc }))}
                  minWidth={260}
                  className="w-full" buttonClassName="w-full"
                />
                <p className="text-xs text-tinta-2 dark:text-slate-400 leading-snug">
                  {ESTRATEGIAS.find(e => e.value === estrategia)?.desc}
                </p>
              </div>

              {/* Reglas por valor (categoría / región / viabilidad) */}
              {valoresDeLaEstrategia.length > 0 && (
                <div className="space-y-1.5">
                  <label className={ROTULO}>Reglas</label>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {valoresDeLaEstrategia.map(v => (
                      <div key={v.valor} className="flex items-center gap-2">
                        <span className="text-[13px] text-tinta dark:text-slate-100 truncate flex-1" title={v.valor}>
                          {v.valor} <span className="text-tinta-2 tabular-nums">({v.total})</span>
                        </span>
                        <Select
                          value={reglas[v.valor] != null ? String(reglas[v.valor]) : ''}
                          onChange={val => { setReglas(prev => ({ ...prev, [v.valor]: val ? Number(val) : null })); invalidarPrevia(); }}
                          options={opcionesPerfil} minWidth={150} align="right"
                        />
                      </div>
                    ))}
                  </div>
                  {perfilesElegidos.length === 0 && (
                    <p className="text-xs text-alerta">Elige primero los perfiles de destino.</p>
                  )}
                </div>
              )}

              {/* Tramos de monto */}
              {estrategia === 'monto' && (
                <div className="space-y-1.5">
                  <label className={ROTULO}>Tramos de presupuesto (CLP)</label>
                  {tramos.map((t, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input type="number" value={t.desde ?? ''} placeholder="desde"
                        onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); setTramos(prev => prev.map((x, j) => j === i ? { ...x, desde: v } : x)); invalidarPrevia(); }}
                        className={`w-24 tabular-nums ${CAMPO}`} />
                      <input type="number" value={t.hasta ?? ''} placeholder="hasta"
                        onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); setTramos(prev => prev.map((x, j) => j === i ? { ...x, hasta: v } : x)); invalidarPrevia(); }}
                        className={`w-24 tabular-nums ${CAMPO}`} />
                      <Select
                        value={t.usuarioId != null ? String(t.usuarioId) : ''}
                        onChange={val => { setTramos(prev => prev.map((x, j) => j === i ? { ...x, usuarioId: val ? Number(val) : null } : x)); invalidarPrevia(); }}
                        options={opcionesPerfil} minWidth={140} align="right"
                      />
                      <Tooltip label="Quitar tramo">
                        <button onClick={() => { setTramos(prev => prev.filter((_, j) => j !== i)); invalidarPrevia(); }}
                          aria-label="Quitar tramo" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-urgente focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-red-950/40">
                          <X size={16} stroke={1.75} />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                  <button onClick={() => setTramos(prev => [...prev, { desde: null, hasta: null, usuarioId: null }])}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-marca hover:underline">
                    <Plus size={16} stroke={1.75} /> Agregar tramo
                  </button>
                  <p className="text-xs text-tinta-2 dark:text-slate-400">«desde» incluye el valor; «hasta» lo excluye. Vacío = sin tope.</p>
                </div>
              )}

              {/* Qué hacer con lo que ninguna regla alcanza */}
              {(estrategia === 'categoria' || estrategia === 'region' || estrategia === 'viabilidad' || estrategia === 'monto') && (
                <div className="space-y-1.5">
                  <label className={ROTULO}>Lo que no calce con ninguna regla</label>
                  <Select
                    value={fallback}
                    onChange={v => { setFallback(v as typeof fallback); invalidarPrevia(); }}
                    options={[
                      { value: 'equitativa', label: 'Repartir parejo entre los elegidos' },
                      { value: 'carga',      label: 'Al que tenga menos carga' },
                      { value: 'ninguno',    label: 'Dejarlo en el puente' },
                    ]}
                    minWidth={240} className="w-full" buttonClassName="w-full"
                  />
                </div>
              )}

              <Boton variante="primario" onClick={simular} disabled={simulando || elegidos.length === 0} className="w-full"
                icono={simulando ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} stroke={1.75} />}>
                {simulando ? 'Simulando…' : 'Simular reparto'}
              </Boton>
              <p className="text-xs text-tinta-2 dark:text-slate-400 text-center -mt-2">
                La simulación no cambia nada: muestra a quién le tocaría cada una.
              </p>
            </div>
          </div>
        )}

        {/* ── Vista previa del reparto ─────────────────────────────────────────── */}
        {previa && (
          <div className="bg-white border border-linea rounded-2xl p-5 shadow-tarjeta space-y-4 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-100">
                  <Hand size={18} stroke={1.75} className="text-slate-400" /> Vista previa
                  {ajustadaAMano && (
                    <span className="text-xs font-medium text-alerta">
                      <Estado color="#d97706">ajustada a mano</Estado>
                    </span>
                  )}
                </h2>
                <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">
                  Arrastra una tarjeta a otra columna para corregir antes de confirmar. Todavía no se ha asignado nada.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Boton onClick={invalidarPrevia} disabled={ejecutando} icono={<X size={16} stroke={1.75} />}>Descartar</Boton>
                <Boton variante="primario" onClick={confirmarReparto} disabled={ejecutando}
                  icono={ejecutando ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} stroke={1.75} />}>
                  {ejecutando ? 'Repartiendo…' : 'Confirmar reparto'}
                </Boton>
              </div>
            </div>

            <div className="grid grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-4 gap-3">
              {columnas.map(col => {
                const key = col.perfil ? String(col.perfil.id) : 'sin';
                const destino = col.perfil ? col.perfil.id : null;
                return (
                  <div key={key}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); if (arrastrando) mover(arrastrando, destino); setArrastrando(null); }}
                    className={`rounded-xl border p-3 min-h-[120px] transition-colors
                      ${col.perfil ? 'bg-slate-50 border-linea dark:bg-slate-950/40 dark:border-slate-800' : 'bg-amber-50/60 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900'}`}>
                    <div className="flex items-center gap-2 mb-2 px-0.5">
                      {col.perfil ? (
                        <>
                          <span className="w-6 h-6 rounded-full text-[10px] font-semibold text-white flex items-center justify-center"
                            style={{ background: colorUsuario(col.perfil.id) }}>
                            {inicialesUsuario(col.perfil.nombre, col.perfil.email)}
                          </span>
                          <span className="text-[13px] font-semibold text-tinta dark:text-slate-100 truncate flex-1">{nombrePerfil(col.perfil)}</span>
                        </>
                      ) : (
                        <span className="text-[13px] font-semibold text-alerta flex-1 flex items-center gap-1.5">
                          <AlertTriangle size={16} stroke={1.75} /> Se quedan en el puente
                        </span>
                      )}
                      <span className="text-xs font-semibold tabular-nums text-tinta dark:text-slate-100">
                        {col.items.length}
                      </span>
                    </div>
                    {col.perfil && (
                      <p className="text-xs text-tinta-2 dark:text-slate-400 px-0.5 mb-2">
                        tenía {col.perfil.cargaActual} → queda con <strong className="font-semibold text-tinta dark:text-slate-200">{col.perfil.cargaActual + col.items.length}</strong>
                      </p>
                    )}

                    <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-0.5">
                      {col.items.map(a => {
                        const l = porCodigo.get(a.codigo);
                        return (
                          <div key={a.codigo} draggable
                            onDragStart={() => setArrastrando(a.codigo)}
                            onDragEnd={() => setArrastrando(null)}
                            className={`group bg-white border border-linea rounded-lg px-2.5 py-2 shadow-tarjeta cursor-grab active:cursor-grabbing dark:bg-slate-900 dark:border-slate-800
                              ${arrastrando === a.codigo ? 'opacity-40' : 'hover:border-teal-300'}`}>
                            <div className="flex items-start gap-1.5">
                              <GripVertical size={16} stroke={1.75} className="text-slate-300 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-tinta dark:text-slate-100 line-clamp-2 leading-snug">
                                  {l?.licitacion_nombre || a.codigo}
                                </p>
                                <p className="font-mono text-xs text-tinta-2 dark:text-slate-400 mt-0.5">{a.codigo}</p>
                                <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">{fmtMonto(l?.licitacion_monto ?? null)} · {a.motivo}</p>
                              </div>
                            </div>
                            {/* Respaldo sin arrastrar: en táctil el drag&drop de HTML5 no existe,
                                así que este selector es el camino real, no un adorno. */}
                            <div className="mt-1">
                              <Select
                                value={a.usuarioId != null ? String(a.usuarioId) : ''}
                                onChange={v => mover(a.codigo, v ? Number(v) : null)}
                                options={opcionesPerfil} minWidth={150}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {col.items.length === 0 && (
                        <p className="text-xs text-tinta-3 text-center py-4">Suelta tarjetas acá</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Overlay del reparto en marcha. Es la operación larga de verdad: crea un negocio por
            licitación, avisa a cada perfil y encola la descarga de documentos. Se va sola al
            terminar (finally de confirmarReparto). */}
        {ejecutando && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 overlay-in">
            <div className="bg-white rounded-xl shadow-flotante px-9 py-8 modal-in">
              <PuenteLoader
                total={previa ? previa.filter(a => a.usuarioId != null).length : undefined}
                titulo="Repartiendo al equipo…"
                subtitulo="Creando los negocios y avisando a cada perfil. No cierres esta pestaña."
              />
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
