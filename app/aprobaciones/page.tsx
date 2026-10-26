'use client';

// BANDEJA DE APROBACIÓN TRANSVERSAL (Auditor Técnico, Fase 2) — todos los negocios con algo
// pendiente de aprobación (bloque técnico y/o comercial), de todos los asistentes, en un solo
// lugar. Vista propia del asesor/CA — no una sección dentro de cada negocio.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Banner } from '@/app/components/ui/Banner';
import { useRealtime } from '@/app/lib/use-realtime';
import { IconClipboardCheck as ClipboardCheck, IconLoader2 as Loader2, IconInbox as Inbox, IconSearch as Search, IconX as X } from '@tabler/icons-react';
import { TarjetaNegocioAprobacion, type NegocioAprobacion } from './TarjetaNegocioAprobacion';
import { GrupoAprobacionCompras, agruparPorLicitacion, minutosEsperando } from './ItemAprobacionCompras';
import type { ItemBandejaCompras, TipoItemCompras } from '@/app/lib/compras-bandeja-aprobacion';
import { BandejaAuditorEM } from './BandejaAuditorEM';

const SEMAFOROS = [
  { value: 'TODOS', label: 'Todos', dot: 'bg-zinc-300 dark:bg-zinc-600' },
  { value: 'ROJO', label: 'Rojo', dot: 'bg-rose-500' },
  { value: 'AMARILLO', label: 'Amarillo', dot: 'bg-amber-500' },
  { value: 'VERDE', label: 'Verde', dot: 'bg-emerald-500' },
] as const;

// Filtros de COMPRAS (distintos a los del Auditor: lo que se aprueba allá es otra cosa).
const TIPOS_COMPRAS: Array<{ v: TipoItemCompras; label: string }> = [
  { v: 'COMPRA_RAPIDA', label: 'Compra rápida' }, { v: 'COMPRA', label: 'Cuadro comparativo' }, { v: 'MARGEN', label: 'Margen' },
  { v: 'PRODUCTO_CORREGIDO', label: 'Corregidos' }, { v: 'RENUNCIA', label: 'Renuncias' },
];
const CAMPO = 'w-full pl-8 pr-2.5 py-2 text-[13px] bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-zinc-700 dark:text-zinc-100 dark:placeholder:text-zinc-500 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/30';
const SELECT_CLS = 'text-[13px] px-2.5 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-zinc-700 dark:text-zinc-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/30';
const CHIP = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors';
const CHIP_ON = 'bg-zinc-900 text-white dark:bg-white/15';
const CHIP_OFF = 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.06]';

export default function AprobacionesPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();

  const [negocios, setNegocios] = useState<NegocioAprobacion[]>([]);
  // Lo que Compras mandó a aprobar (compra rápida, cuadro comparativo, margen, corregidos, renuncias): cada ítem lleva directo a donde se decide.
  const [compras, setCompras] = useState<ItemBandejaCompras[]>([]);
  const [vista, setVista] = useState<'todo' | 'compras' | 'auditor'>('todo');
  const [busquedaCompras, setBusquedaCompras] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | TipoItemCompras>('TODOS');
  const [filtroSolicitante, setFiltroSolicitante] = useState('TODOS');
  const [soloAntiguos, setSoloAntiguos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ids que ya se aprobaron pero se mantienen un instante en verde antes de desaparecer de la
  // lista — sin esto, la respuesta del servidor (que ya no trae el negocio aprobado) hace que la
  // tarjeta se esfume de golpe y el "quedó todo aprobado, en verde" nunca se alcanza a ver.
  // flashCache guarda una foto de la tarjeta en el momento de aprobar: publicarCambio() dispara
  // useRealtime() en esta misma pestaña, que puede refrescar `negocios` (sin el negocio ya
  // aprobado) ANTES de que termine el temporizador de abajo — sin la foto, el verde se cortaría
  // a la mitad en vez de completarse.
  const [flashAprobados, setFlashAprobados] = useState<Set<number>>(new Set());
  const [flashCache, setFlashCache] = useState<Map<number, NegocioAprobacion>>(new Map());

  // Opciones del Auditor (en aprobación y requisitos complementados): las cuenta su propia sección, BandejaAuditorEM.
  const [conteoEM, setConteoEM] = useState(0);
  const [busqueda, setBusqueda] = useState('');
  const [filtroAsistente, setFiltroAsistente] = useState('TODOS');
  const [filtroSemaforo, setFiltroSemaforo] = useState<string>('TODOS');

  const puedeVer = usuario?.rol === 'admin' || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/aprobaciones');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar la bandeja');
      setNegocios(data.negocios || []);
      setCompras(data.compras || []);
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

  useRealtime(cargar);

  const aprobarBloque = async (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL') => {
    try {
      const res = await fetch('/api/aprobaciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId, bloque, accion: 'APROBAR_BLOQUE' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo aprobar');
      setNegocios(data.negocios || []);
      toast.success('Bloque aprobado', bloque === 'TECNICO' ? 'Bloque técnico aprobado.' : 'Bloque comercial aprobado.');
    } catch (e: any) {
      toast.error('No se pudo aprobar', e.message);
    }
  };

  const rechazarBloque = async (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL', comentario: string) => {
    try {
      const res = await fetch('/api/aprobaciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId, bloque, accion: 'RECHAZAR_BLOQUE', comentario }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo rechazar');
      setNegocios(data.negocios || []);
      toast.info('Bloque rechazado', 'Vuelve a la bandeja del asistente con tu comentario.');
    } catch (e: any) {
      toast.error('No se pudo rechazar', e.message);
    }
  };

  // Aprobar TODO de un clic (técnico + comercial juntos). La tarjeta se pone verde un momento
  // antes de desaparecer — la respuesta ya no trae este negocio (quedó sin nada por aprobar), así
  // que el refresco de la lista se retrasa medio segundo para que el verde se alcance a ver.
  const aprobarTodo = async (negocioId: number) => {
    const antesDeAprobar = negocios.find(n => n.negocioId === negocioId) || null;
    try {
      const res = await fetch('/api/aprobaciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId, accion: 'APROBAR_TODO' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo aprobar');
      if (antesDeAprobar) setFlashCache(prev => new Map(prev).set(negocioId, antesDeAprobar));
      setFlashAprobados(prev => new Set(prev).add(negocioId));
      setNegocios(data.negocios || []);
      toast.success('Aprobado', 'Bloques técnico y comercial visados.');
      setTimeout(() => {
        setFlashAprobados(prev => { const n = new Set(prev); n.delete(negocioId); return n; });
        setFlashCache(prev => { const m = new Map(prev); m.delete(negocioId); return m; });
      }, 900);
    } catch (e: any) {
      toast.error('No se pudo aprobar', e.message);
    }
  };

  const comprasResuelta = (id: string, decision: 'APROBAR' | 'RECHAZAR') => {
    setCompras(prev => prev.filter(c => c.id !== id));
    if (decision === 'APROBAR') toast.success('Aprobado', 'Le avisamos a quien lo mandó.'); else toast.info('Rechazado', 'Le avisamos a quien lo mandó, con tu motivo.');
  };

  // Sacar un negocio de ESTA bandeja — solo admin. Ojo: NO toca el negocio (sigue activo,
  // visible en Negocios/Postuladas y para quien lo tenga asignado), solo lo oculta de
  // Aprobaciones. Ver docs/migration-74-aprobaciones-ocultar.sql.
  const eliminarNegocio = async (negocioId: number, licitacionNombre: string | null) => {
    const ok = await confirmar({
      titulo: `¿Sacar "${licitacionNombre || `negocio ${negocioId}`}" de Aprobaciones?`,
      mensaje: 'Solo desaparece de esta bandeja. El negocio sigue activo y visible en Negocios, Postuladas y para quien lo tenga asignado.',
      confirmarLabel: 'Sacar de la bandeja',
      peligro: true,
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/aprobaciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId, accion: 'OCULTAR_NEGOCIO' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo sacar de la bandeja');
      setNegocios(prev => prev.filter(n => n.negocioId !== negocioId));
      toast.info('Sacado de Aprobaciones');
    } catch (e: any) {
      toast.error('No se pudo sacar de la bandeja', e.message);
    }
  };

  const asistentes = useMemo(() => {
    const nombres = new Set(negocios.map(n => n.asignadoNombre).filter((v): v is string => !!v));
    return Array.from(nombres).sort();
  }, [negocios]);

  const negociosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return negocios.filter(n => {
      if (filtroSemaforo !== 'TODOS' && n.semaforo !== filtroSemaforo) return false;
      if (filtroAsistente !== 'TODOS' && n.asignadoNombre !== filtroAsistente) return false;
      if (q && !(
        n.licitacionCodigo?.toLowerCase().includes(q) ||
        n.licitacionNombre?.toLowerCase().includes(q) ||
        n.licitacionOrganismo?.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [negocios, busqueda, filtroAsistente, filtroSemaforo]);

  const solicitantes = useMemo(() => Array.from(new Set(compras.map(c => c.solicitadoPorNombre).filter((v): v is string => !!v))).sort(), [compras]);
  const comprasFiltradas = useMemo(() => {
    const q = busquedaCompras.trim().toLowerCase();
    return compras.filter(c => {
      if (filtroTipo !== 'TODOS' && c.tipo !== filtroTipo) return false;
      if (filtroSolicitante !== 'TODOS' && c.solicitadoPorNombre !== filtroSolicitante) return false;
      if (soloAntiguos && (minutosEsperando(c.solicitadoAt) ?? 0) < 60 * 24) return false;
      return !q || `${c.licitacionCodigo} ${c.licitacionNombre} ${c.titulo} ${c.detalle}`.toLowerCase().includes(q);
    });
  }, [compras, busquedaCompras, filtroTipo, filtroSolicitante, soloAntiguos]);
  const hayFiltrosCompras = busquedaCompras.trim() !== '' || filtroTipo !== 'TODOS' || filtroSolicitante !== 'TODOS' || soloAntiguos;
  const limpiarFiltrosCompras = () => { setBusquedaCompras(''); setFiltroTipo('TODOS'); setFiltroSolicitante('TODOS'); setSoloAntiguos(false); };

  // Urgentes: Compras que llevan más de un día esperando y licitaciones que cierran en menos de 24 h (o ya vencidas) o con semáforo rojo.
  const urgentes = useMemo(() => compras.filter(c => (minutosEsperando(c.solicitadoAt) ?? 0) >= 60 * 24).length
    + negocios.filter(n => n.semaforo === 'ROJO' || (n.cierre.horasRestantes != null && n.cierre.horasRestantes < 24)).length, [compras, negocios]);

  const hayFiltrosActivos = busqueda.trim() !== '' || filtroAsistente !== 'TODOS' || filtroSemaforo !== 'TODOS';
  const limpiarFiltros = () => { setBusqueda(''); setFiltroAsistente('TODOS'); setFiltroSemaforo('TODOS'); };

  // Lista a renderizar: lo filtrado + cualquier tarjeta en pleno flash verde que un refresco ya
  // haya sacado de `negocios` (ver comentario de flashCache arriba).
  const listaVisible = useMemo(() => {
    const vistos = new Set(negociosFiltrados.map(n => n.negocioId));
    const extras = Array.from(flashAprobados)
      .filter(id => !vistos.has(id) && flashCache.has(id))
      .map(id => flashCache.get(id)!);
    return [...negociosFiltrados, ...extras];
  }, [negociosFiltrados, flashAprobados, flashCache]);

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Aprobaciones' }]}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Aprobaciones' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-500/15 flex items-center justify-center flex-shrink-0">
            <ClipboardCheck size={20} className="text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">Aprobaciones</h1>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {negocios.length + compras.length + conteoEM === 0 ? 'Sin nada pendiente' : [conteoEM > 0 && `${conteoEM} del Auditor (opciones y requisitos)`, compras.length > 0 && `${compras.length} de Compras`, negocios.length > 0 && `${negocios.length} negocio(s) del checklist`].filter(Boolean).join(' · ') + ' por revisar'}
            </p>
          </div>
        </div>

        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {(compras.length > 0 || negocios.length > 0) && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5" data-testid="aprob-resumen">
            {([
              { clave: 'todo', titulo: 'Por aprobar', valor: compras.length + negocios.length + conteoEM, nota: 'en total', color: 'text-zinc-900 dark:text-zinc-100', vista: 'todo' as const },
              { clave: 'compras', titulo: 'Compras', valor: compras.length, nota: 'compras y márgenes', color: 'text-indigo-600 dark:text-indigo-400', vista: 'compras' as const },
              { clave: 'auditor', titulo: 'Licitaciones', valor: negocios.length, nota: 'técnico y comercial', color: 'text-violet-600 dark:text-violet-400', vista: 'auditor' as const },
              { clave: 'urgente', titulo: 'Urgentes', valor: urgentes, nota: 'esperan hace días o cierran pronto', color: urgentes > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-400', vista: null },
            ]).map(k => (
              <button key={k.clave} type="button" onClick={() => k.vista && setVista(k.vista)} disabled={!k.vista}
                className={`text-left bg-white dark:bg-zinc-900 border rounded-2xl px-4 py-3 transition ${k.vista ? 'hover:border-indigo-300 dark:hover:border-indigo-500/50 cursor-pointer' : 'cursor-default'} ${k.vista && vista === k.vista ? 'border-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-500/30' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <p className="text-[11.5px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{k.titulo}</p>
                <p className={`text-[28px] font-bold leading-none mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
                <p className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-1 leading-snug">{k.nota}</p>
              </button>
            ))}
          </div>
        )}

        {compras.length > 0 && negocios.length > 0 && (
          <div className="flex items-center gap-1" role="tablist" aria-label="Qué aprobar" data-testid="aprob-vistas">
            {([['todo', `Todo (${compras.length + negocios.length})`], ['compras', `Compras (${compras.length})`], ['auditor', `Auditor (${negocios.length})`]] as const).map(([v, t]) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                className={`px-4 py-2 rounded-xl text-[13.5px] font-semibold transition-colors ${vista === v ? 'bg-zinc-900 text-white dark:bg-white/15' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.06]'}`}>{t}</button>
            ))}
          </div>
        )}

        {/* Opciones del Auditor: primero, porque frenan el paso a Pre-postulación de cada licitación */}
        <div className={vista === 'compras' ? 'hidden' : ''}><BandejaAuditorEM onConteo={setConteoEM} /></div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          </div>
        ) : negocios.length === 0 && compras.length === 0 && conteoEM > 0 ? null : negocios.length === 0 && compras.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Inbox size={28} className="text-zinc-300 dark:text-zinc-700" />
            <p className="text-[14px] font-semibold text-zinc-500 dark:text-zinc-400">No hay nada esperando tu aprobación</p>
            <p className="text-[12.5px] text-zinc-400 dark:text-zinc-500">Cuando un asistente cargue algo en el bloque técnico o comercial de un negocio, o Compras mande algo a aprobar, aparece acá.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* COMPRAS: sus propios filtros (tipo de aprobación, quién lo mandó, antigüedad) */}
            {vista !== 'auditor' && compras.length > 0 && (
              <section className="space-y-3" data-testid="aprob-seccion-compras" aria-label="Compras">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">Compras</h2>
                  <span className="text-[12.5px] text-zinc-400">{comprasFiltradas.length === compras.length ? `${compras.length} por aprobar` : `${comprasFiltradas.length} de ${compras.length}`} en {agruparPorLicitacion(comprasFiltradas).length} {agruparPorLicitacion(comprasFiltradas).length === 1 ? 'licitación' : 'licitaciones'}</span>
                </div>
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2.5 space-y-2" data-testid="filtros-compras">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                      <input value={busquedaCompras} onChange={e => setBusquedaCompras(e.target.value)} placeholder="Buscar licitación, producto o tienda…" className={CAMPO} />
                    </div>
                    {solicitantes.length > 1 && (
                      <select value={filtroSolicitante} onChange={e => setFiltroSolicitante(e.target.value)} className={SELECT_CLS} aria-label="Quién lo mandó">
                        <option value="TODOS">Quién lo mandó: todos</option>
                        {solicitantes.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={() => setSoloAntiguos(v => !v)} aria-pressed={soloAntiguos}
                      className={`${CHIP} border ${soloAntiguos ? 'bg-rose-600 text-white border-rose-600' : 'text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-white/[0.06]'}`}>
                      Esperan más de un día
                    </button>
                    {hayFiltrosCompras && <button onClick={limpiarFiltrosCompras} className="flex items-center gap-1 px-2 py-1.5 text-[12.5px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><X size={13} /> Limpiar</button>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tipo de aprobación">
                    <button type="button" onClick={() => setFiltroTipo('TODOS')} className={`${CHIP} ${filtroTipo === 'TODOS' ? CHIP_ON : CHIP_OFF}`}>Todos ({compras.length})</button>
                    {TIPOS_COMPRAS.filter(t => compras.some(c => c.tipo === t.v)).map(t => (
                      <button key={t.v} type="button" onClick={() => setFiltroTipo(t.v)} className={`${CHIP} ${filtroTipo === t.v ? CHIP_ON : CHIP_OFF}`}>
                        {t.label} ({compras.filter(c => c.tipo === t.v).length})
                      </button>
                    ))}
                  </div>
                </div>
                {comprasFiltradas.length === 0 ? (
                  <div className="flex flex-col items-center py-10 text-center gap-2">
                    <Search size={22} className="text-zinc-300 dark:text-zinc-700" />
                    <p className="text-[13.5px] font-semibold text-zinc-500 dark:text-zinc-400">Nada de Compras calza con esos filtros</p>
                    <button onClick={limpiarFiltrosCompras} className="text-[12.5px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Limpiar filtros</button>
                  </div>
                ) : (
                  <div className="space-y-3">{agruparPorLicitacion(comprasFiltradas).map(g => <GrupoAprobacionCompras key={g.negocioId} items={g.items} onResuelto={comprasResuelta} />)}</div>
                )}
              </section>
            )}

            {/* AUDITOR (licitaciones): sus propios filtros (código/organismo, asistente, urgencia de cierre) */}
            {vista !== 'compras' && negocios.length > 0 && (
              <section className="space-y-3" data-testid="aprob-seccion-auditor" aria-label="Auditor">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">Licitaciones (Auditor)</h2>
                  <span className="text-[12.5px] text-zinc-400">{negociosFiltrados.length === negocios.length ? `${negocios.length} por visar` : `${negociosFiltrados.length} de ${negocios.length}`}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2.5" data-testid="filtros-auditor">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar código, nombre u organismo…" className={CAMPO} />
                  </div>
                  {asistentes.length > 1 && (
                    <select value={filtroAsistente} onChange={e => setFiltroAsistente(e.target.value)} className={SELECT_CLS} aria-label="Asistente">
                      <option value="TODOS">Todos los asistentes</option>
                      {asistentes.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  )}
                  <div className="flex items-center gap-1" role="group" aria-label="Urgencia de cierre">
                    {SEMAFOROS.map(sm => (
                      <button key={sm.value} onClick={() => setFiltroSemaforo(sm.value)} className={`${CHIP} ${filtroSemaforo === sm.value ? CHIP_ON : CHIP_OFF}`}>
                        <span className={`w-2 h-2 rounded-full ${sm.dot}`} /> {sm.label}
                      </button>
                    ))}
                  </div>
                  {hayFiltrosActivos && <button onClick={limpiarFiltros} className="flex items-center gap-1 px-2 py-1.5 text-[12.5px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><X size={13} /> Limpiar</button>}
                </div>
                {listaVisible.length === 0 ? (
                  <div className="flex flex-col items-center py-10 text-center gap-2">
                    <Search size={22} className="text-zinc-300 dark:text-zinc-700" />
                    <p className="text-[13.5px] font-semibold text-zinc-500 dark:text-zinc-400">Ninguna licitación calza con esos filtros</p>
                    <button onClick={limpiarFiltros} className="text-[12.5px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Limpiar filtros</button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {listaVisible.map(n => (
                      <TarjetaNegocioAprobacion
                        key={n.negocioId} negocio={n}
                        onAprobarBloque={aprobarBloque} onRechazarBloque={rechazarBloque}
                        onAprobarTodo={aprobarTodo} aprobadoFlash={flashAprobados.has(n.negocioId)}
                        esAdmin={usuario?.rol === 'admin'} onEliminar={eliminarNegocio}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
