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
import {
  Shuffle, Loader2, Users, Trash2, RefreshCw, Building2, Calendar, ExternalLink,
  Check, X, Scale, Tag, DollarSign, MapPin, Gauge, Hand, AlertTriangle, Layers,
  ArrowRight, Plus, Radar as RadarIcon, GripVertical, Sparkles,
} from 'lucide-react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { PuenteLoader } from '@/app/components/ui/PuenteLoader';
import { extractTipoFromCodigo, getTipoLicitacion, TIPO_COLOR_CLASS } from '@/app/lib/tipos-licitacion';
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
        <div className="p-10 flex items-center justify-center text-slate-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Cargando el puente…
        </div>
      </AppLayout>
    );
  }

  if (migrationPending) {
    return (
      <AppLayout breadcrumb={[{ label: 'Puente' }]}>
        <div className="p-8 max-w-2xl mx-auto">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-[13px] text-amber-900">
            <div className="flex items-center gap-2 font-bold mb-1"><AlertTriangle size={16} /> Falta aplicar la migración</div>
            El puente necesita sus tablas. Corre <code className="bg-white px-1.5 py-0.5 rounded border border-amber-200">node scripts/aplicar-migration-73.mjs</code> y recarga.
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Puente' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto space-y-5">

        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Shuffle size={18} />
            </div>
            <div>
              <h1 className="text-[19px] font-bold text-slate-800 leading-tight">Puente del radar</h1>
              <p className="text-[12.5px] text-slate-500">
                {licitaciones.length === 0
                  ? 'Vacío. Empuja licitaciones desde el radar para repartirlas al equipo.'
                  : `${licitaciones.length} licitación${licitaciones.length !== 1 ? 'es' : ''} esperando dueño`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/radar"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg">
              <RadarIcon size={14} /> Ir al radar
            </Link>
            <button onClick={cargar} title="Recargar el puente"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg">
              <RefreshCw size={14} /> Actualizar
            </button>
            {licitaciones.length > 0 && (
              <button onClick={vaciarPuente} title="Devolver TODO al radar (no asigna ni descarta nada)"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-lg">
                <Trash2 size={14} /> Vaciar
              </button>
            )}
          </div>
        </div>

        {licitaciones.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Shuffle size={20} className="text-slate-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700 mb-1">El puente está vacío</p>
            <p className="text-[12.5px] text-slate-400 mb-4 max-w-md mx-auto">
              En el radar, selecciona licitaciones y usa el botón <strong>Al puente</strong>. Cuando tengas la tanda
              completa, vuelve acá y repártela entre los perfiles.
            </p>
            <Link href="/radar" className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-indigo-600 hover:underline">
              Abrir el radar <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

            {/* ── Columna izquierda: contenido del puente ─────────────────────── */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center gap-2 text-[12px] font-bold text-slate-400 uppercase tracking-wide">
                <Layers size={13} /> En el puente ({licitaciones.length})
              </div>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {licitaciones.map(l => {
                  const tipo = getTipoLicitacion(extractTipoFromCodigo(l.licitacion_codigo));
                  return (
                    <div key={l.id} className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 hover:border-indigo-200 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {tipo && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${TIPO_COLOR_CLASS[tipo.codigo] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                {tipo.codigo}
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-slate-400">{l.licitacion_codigo}</span>
                            {l.categoria_nombre && (
                              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                                <Tag size={9} /> {l.categoria_nombre}
                              </span>
                            )}
                          </div>
                          <p className="text-[13px] font-semibold text-slate-800 truncate mt-0.5">{l.licitacion_nombre || 'Sin nombre'}</p>
                          <div className="flex items-center gap-3 text-[11.5px] text-slate-500 mt-0.5 flex-wrap">
                            {l.licitacion_organismo && (
                              <span className="inline-flex items-center gap-1 truncate max-w-[260px]"><Building2 size={11} /> {l.licitacion_organismo}</span>
                            )}
                            <span className="inline-flex items-center gap-1"><DollarSign size={11} /> {fmtMonto(l.licitacion_monto)}</span>
                            <span className="inline-flex items-center gap-1"><Calendar size={11} /> {fmtFecha(l.licitacion_cierre)}</span>
                            {l.licitacion_region && (
                              <span className="inline-flex items-center gap-1 truncate max-w-[160px]"><MapPin size={11} /> {l.licitacion_region}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Link href={`/licitacion/${encodeURIComponent(l.licitacion_codigo)}`} target="_blank"
                            title="Abrir la licitación en otra pestaña"
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg">
                            <ExternalLink size={14} />
                          </Link>
                          <button onClick={() => quitarDelPuente([l.licitacion_codigo])}
                            title="Sacar del puente (vuelve al radar sin cambios)"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Columna derecha: panel de reparto ───────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 lg:sticky lg:top-4">
              <div className="flex items-center gap-2 text-[12px] font-bold text-slate-400 uppercase tracking-wide">
                <Users size={13} /> Repartir a
              </div>

              {/* Perfiles */}
              <div className="flex flex-wrap gap-1.5">
                {perfiles.map(p => {
                  const on = elegidos.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => togglePerfil(p.id)}
                      title={`${nombrePerfil(p)} — ${p.cargaActual} licitación(es) vigentes hoy`}
                      className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[12px] font-semibold transition-colors
                        ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                      <span className="w-5 h-5 rounded-full text-[9.5px] font-bold text-white flex items-center justify-center"
                        style={{ background: colorUsuario(p.id) }}>
                        {inicialesUsuario(p.nombre, p.email)}
                      </span>
                      <span className="truncate max-w-[120px]">{nombrePerfil(p)}</span>
                      <span className={`text-[10.5px] font-bold px-1.5 rounded-full ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
                        {p.cargaActual}
                      </span>
                    </button>
                  );
                })}
              </div>
              {elegidos.length > 0 && (
                <p className="text-[11.5px] text-slate-400 -mt-2">
                  El número es su carga vigente de hoy. {licitaciones.length} ÷ {elegidos.length} ≈{' '}
                  <strong className="text-slate-600">{Math.floor(licitaciones.length / elegidos.length)}</strong> por perfil.
                </p>
              )}

              {/* Estrategia */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-slate-500">Cómo repartir</label>
                <Select
                  value={estrategia}
                  onChange={v => { setEstrategia(v as Estrategia); setReglas({}); invalidarPrevia(); }}
                  options={ESTRATEGIAS.map(e => ({ value: e.value, label: e.label, description: e.desc }))}
                  minWidth={260}
                  className="w-full" buttonClassName="w-full"
                />
                <p className="text-[11.5px] text-slate-400 leading-snug">
                  {ESTRATEGIAS.find(e => e.value === estrategia)?.desc}
                </p>
              </div>

              {/* Reglas por valor (categoría / región / viabilidad) */}
              {valoresDeLaEstrategia.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-500">Reglas</label>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {valoresDeLaEstrategia.map(v => (
                      <div key={v.valor} className="flex items-center gap-2">
                        <span className="text-[12px] text-slate-700 truncate flex-1" title={v.valor}>
                          {v.valor} <span className="text-slate-400">({v.total})</span>
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
                    <p className="text-[11.5px] text-amber-600">Elige primero los perfiles de destino.</p>
                  )}
                </div>
              )}

              {/* Tramos de monto */}
              {estrategia === 'monto' && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-500">Tramos de presupuesto (CLP)</label>
                  {tramos.map((t, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input type="number" value={t.desde ?? ''} placeholder="desde"
                        onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); setTramos(prev => prev.map((x, j) => j === i ? { ...x, desde: v } : x)); invalidarPrevia(); }}
                        className="w-24 px-2 py-1.5 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400" />
                      <input type="number" value={t.hasta ?? ''} placeholder="hasta"
                        onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); setTramos(prev => prev.map((x, j) => j === i ? { ...x, hasta: v } : x)); invalidarPrevia(); }}
                        className="w-24 px-2 py-1.5 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400" />
                      <Select
                        value={t.usuarioId != null ? String(t.usuarioId) : ''}
                        onChange={val => { setTramos(prev => prev.map((x, j) => j === i ? { ...x, usuarioId: val ? Number(val) : null } : x)); invalidarPrevia(); }}
                        options={opcionesPerfil} minWidth={140} align="right"
                      />
                      <button onClick={() => { setTramos(prev => prev.filter((_, j) => j !== i)); invalidarPrevia(); }}
                        title="Quitar tramo" className="p-1 text-slate-300 hover:text-red-600">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setTramos(prev => [...prev, { desde: null, hasta: null, usuarioId: null }])}
                    className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-600 hover:underline">
                    <Plus size={12} /> Agregar tramo
                  </button>
                  <p className="text-[11px] text-slate-400">«desde» incluye el valor; «hasta» lo excluye. Vacío = sin tope.</p>
                </div>
              )}

              {/* Qué hacer con lo que ninguna regla alcanza */}
              {(estrategia === 'categoria' || estrategia === 'region' || estrategia === 'viabilidad' || estrategia === 'monto') && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-500">Lo que no calce con ninguna regla</label>
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

              <button onClick={simular} disabled={simulando || elegidos.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-[13px] font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {simulando ? <Loader2 size={15} className="animate-spin" /> : <Shuffle size={15} />}
                Simular reparto
              </button>
              <p className="text-[11px] text-slate-400 text-center -mt-2">
                La simulación no cambia nada: muestra a quién le tocaría cada una.
              </p>
            </div>
          </div>
        )}

        {/* ── Vista previa del reparto ─────────────────────────────────────────── */}
        {previa && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
                  <Hand size={15} className="text-indigo-600" /> Vista previa
                  {ajustadaAMano && (
                    <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                      ajustada a mano
                    </span>
                  )}
                </h2>
                <p className="text-[12px] text-slate-500">
                  Arrastra una tarjeta a otra columna para corregir antes de confirmar. Todavía no se ha asignado nada.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={invalidarPrevia} disabled={ejecutando}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50">
                  <X size={14} /> Descartar
                </button>
                <button onClick={confirmarReparto} disabled={ejecutando}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-[12.5px] font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  {ejecutando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Confirmar reparto
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {columnas.map(col => {
                const key = col.perfil ? String(col.perfil.id) : 'sin';
                const destino = col.perfil ? col.perfil.id : null;
                return (
                  <div key={key}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); if (arrastrando) mover(arrastrando, destino); setArrastrando(null); }}
                    className={`rounded-xl border p-2.5 min-h-[120px] transition-colors
                      ${col.perfil ? 'bg-white border-slate-200' : 'bg-amber-50/60 border-amber-200'}`}>
                    <div className="flex items-center gap-2 mb-2 px-0.5">
                      {col.perfil ? (
                        <>
                          <span className="w-6 h-6 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
                            style={{ background: colorUsuario(col.perfil.id) }}>
                            {inicialesUsuario(col.perfil.nombre, col.perfil.email)}
                          </span>
                          <span className="text-[12.5px] font-bold text-slate-700 truncate flex-1">{nombrePerfil(col.perfil)}</span>
                        </>
                      ) : (
                        <span className="text-[12.5px] font-bold text-amber-800 flex-1 flex items-center gap-1.5">
                          <AlertTriangle size={13} /> Se quedan en el puente
                        </span>
                      )}
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {col.items.length}
                      </span>
                    </div>
                    {col.perfil && (
                      <p className="text-[10.5px] text-slate-400 px-0.5 mb-1.5">
                        tenía {col.perfil.cargaActual} → queda con <strong className="text-slate-600">{col.perfil.cargaActual + col.items.length}</strong>
                      </p>
                    )}

                    <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-0.5">
                      {col.items.map(a => {
                        const l = porCodigo.get(a.codigo);
                        return (
                          <div key={a.codigo} draggable
                            onDragStart={() => setArrastrando(a.codigo)}
                            onDragEnd={() => setArrastrando(null)}
                            className={`group bg-white border border-slate-200 rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing
                              ${arrastrando === a.codigo ? 'opacity-40' : 'hover:border-indigo-300'}`}>
                            <div className="flex items-start gap-1.5">
                              <GripVertical size={12} className="text-slate-300 mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11.5px] font-semibold text-slate-700 line-clamp-2 leading-tight">
                                  {l?.licitacion_nombre || a.codigo}
                                </p>
                                <p className="font-mono text-[10px] text-slate-400 mt-0.5">{a.codigo}</p>
                                <p className="text-[10px] text-slate-400 truncate">{fmtMonto(l?.licitacion_monto ?? null)} · {a.motivo}</p>
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
                        <p className="text-[11px] text-slate-300 text-center py-4">Suelta tarjetas acá</p>
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
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm overlay-in">
            <div className="bg-white rounded-2xl shadow-2xl px-9 py-8 modal-in">
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
