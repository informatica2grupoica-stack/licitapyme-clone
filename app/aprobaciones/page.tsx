'use client';

// BANDEJA DE APROBACIÓN TRANSVERSAL (Auditor Técnico, Fase 2) — todos los negocios con algo
// pendiente de aprobación (bloque técnico y/o comercial), de todos los asistentes, en un solo
// lugar. Vista propia del asesor/CA — no una sección dentro de cada negocio.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Banner } from '@/app/components/ui/Banner';
import { useRealtime } from '@/app/lib/use-realtime';
import { IconInbox as Inbox, IconSearch as Search, IconX as X } from '@tabler/icons-react';
import { AnimatePresence } from 'framer-motion';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Encabezado, TarjetaCargando, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { TarjetaNegocioAprobacion, type NegocioAprobacion } from './TarjetaNegocioAprobacion';
import { GrupoAprobacionCompras, agruparPorLicitacion, minutosEsperando } from './ItemAprobacionCompras';
import type { ItemBandejaCompras, TipoItemCompras } from '@/app/lib/compras-bandeja-aprobacion';
import { BandejaAuditorEM } from './BandejaAuditorEM';

const SEMAFOROS = [
  { value: 'TODOS', label: 'Todas', dot: '' },
  { value: 'ROJO', label: 'Urgentes', dot: 'bg-red-600' },
  { value: 'AMARILLO', label: 'Cierran pronto', dot: 'bg-amber-500' },
  { value: 'VERDE', label: 'Con tiempo', dot: 'bg-green-600' },
] as const;

// Filtros de COMPRAS (distintos a los del Auditor: lo que se aprueba allá es otra cosa).
const TIPOS_COMPRAS: Array<{ v: TipoItemCompras; label: string }> = [
  { v: 'COMPRA_RAPIDA', label: 'Compra rápida' }, { v: 'COMPRA', label: 'Cuadro comparativo' }, { v: 'MARGEN', label: 'Margen' },
  { v: 'PRODUCTO_CORREGIDO', label: 'Corregidos' }, { v: 'RENUNCIA', label: 'Renuncias' },
];
const CAMPO = 'w-full pl-8 pr-2.5 h-9 text-[13px] bg-white dark:bg-slate-950 border border-linea dark:border-slate-700 text-tinta dark:text-slate-100 placeholder:text-tinta-3 dark:placeholder:text-slate-500 rounded-lg outline-none focus:ring-2 focus:ring-marca/30 focus:border-marca/50';
const SELECT_CLS = 'text-[13px] px-2.5 h-9 bg-white dark:bg-slate-950 border border-linea dark:border-slate-700 text-tinta dark:text-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-marca/30';
const CHIP = 'flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[13px] font-medium transition-colors duration-150';
const CHIP_ON = 'bg-white text-tinta shadow-tarjeta dark:bg-slate-900 dark:text-slate-50';
const CHIP_OFF = 'text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-200';
const GRUPO_CHIPS = 'inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/70';
const BARRA_FILTROS = 'bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-xl shadow-tarjeta p-2.5';

export default function AprobacionesPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();

  const [negocios, setNegocios] = useState<NegocioAprobacion[]>([]);
  // Lo que Compras mandó a aprobar (compra rápida, cuadro comparativo, margen, corregidos, renuncias): cada ítem lleva directo a donde se decide.
  const [compras, setCompras] = useState<ItemBandejaCompras[]>([]);
  const [vista, setVista] = useState<'compras' | 'auditor'>('auditor');
  const vistaElegida = useRef(false);   // si el usuario ya eligió pestaña, no se la cambiamos al recargar
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
  // Un solo buscador para toda la bandeja (compras, licitaciones y opciones del Auditor).
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
      if (!vistaElegida.current && (data.negocios || []).length === 0 && (data.compras || []).length > 0) setVista('compras');
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
    const ok = await confirmar({
      titulo: bloque === 'TECNICO' ? '¿Aprobar el bloque técnico?' : '¿Aprobar el bloque comercial?',
      mensaje: 'Queda visado con tu nombre y la fecha.',
      confirmarLabel: 'Sí, aprobar', cancelarLabel: 'No',
    });
    if (!ok) return;
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
    const ok = await confirmar({
      titulo: bloque === 'TECNICO' ? '¿Rechazar el bloque técnico?' : '¿Rechazar el bloque comercial?',
      mensaje: 'Vuelve a la bandeja del asistente con tu comentario.',
      confirmarLabel: 'Sí, rechazar', cancelarLabel: 'No', peligro: true,
    });
    if (!ok) return;
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
    const ok = await confirmar({
      titulo: '¿Aprobar todo el negocio?',
      mensaje: 'Se visan juntos el bloque técnico y el comercial, con tu nombre y la fecha.',
      confirmarLabel: 'Sí, aprobar todo', cancelarLabel: 'No',
    });
    if (!ok) return;
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
    const q = busqueda.trim().toLowerCase();
    return compras.filter(c => {
      if (filtroTipo !== 'TODOS' && c.tipo !== filtroTipo) return false;
      if (filtroSolicitante !== 'TODOS' && c.solicitadoPorNombre !== filtroSolicitante) return false;
      if (soloAntiguos && (minutosEsperando(c.solicitadoAt) ?? 0) < 60 * 24) return false;
      return !q || `${c.licitacionCodigo} ${c.licitacionNombre} ${c.titulo} ${c.detalle}`.toLowerCase().includes(q);
    });
  }, [compras, busqueda, filtroTipo, filtroSolicitante, soloAntiguos]);
  const hayFiltrosCompras = filtroTipo !== 'TODOS' || filtroSolicitante !== 'TODOS' || soloAntiguos;
  const limpiarFiltrosCompras = () => { setBusqueda(''); setFiltroTipo('TODOS'); setFiltroSolicitante('TODOS'); setSoloAntiguos(false); };

  // Urgentes: Compras que llevan más de un día esperando y licitaciones que cierran en menos de 24 h (o ya vencidas) o con semáforo rojo.
  const urgentes = useMemo(() => compras.filter(c => (minutosEsperando(c.solicitadoAt) ?? 0) >= 60 * 24).length
    + negocios.filter(n => n.semaforo === 'ROJO' || (n.cierre.horasRestantes != null && n.cierre.horasRestantes < 24)).length, [compras, negocios]);

  const hayFiltrosActivos = filtroAsistente !== 'TODOS' || filtroSemaforo !== 'TODOS';
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
        <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-3"><TarjetaCargando /><TarjetaCargando /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Aprobaciones' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <Encabezado titulo="Aprobaciones"
          descripcion={negocios.length + compras.length + conteoEM === 0
            ? 'Lo que Negocios y Compras te mandan a aprobar aparece aquí. Ahora no hay nada pendiente.'
            : 'Lo que Negocios y Compras te mandaron a aprobar. Cada tarjeta dice qué falta y tiene el botón para hacerlo.'} />

        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        <div role="tablist" aria-label="Qué aprobar" data-testid="aprob-pestanas" className="flex gap-1 border-b border-linea dark:border-slate-800">
          {([
            { v: 'auditor' as const, titulo: 'Licitaciones', n: negocios.length + conteoEM, nota: 'técnico y comercial' },
            { v: 'compras' as const, titulo: 'Compras', n: compras.length, nota: 'compras, márgenes y renuncias' },
          ]).map(t => {
            const activa = vista === t.v;
            return (
              <button key={t.v} type="button" role="tab" aria-selected={activa} data-testid={`pestana-${t.v}`}
                onClick={() => { vistaElegida.current = true; setVista(t.v); }}
                className={`-mb-px flex items-center gap-2 px-4 h-11 text-[14px] font-medium border-b-2 transition-colors duration-150 ${activa ? 'border-marca text-marca dark:text-teal-300 dark:border-teal-400' : 'border-transparent text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-200'}`}>
                {t.titulo}
                <span className={`min-w-[22px] px-1.5 h-[22px] inline-flex items-center justify-center rounded-full text-[12px] tabular-nums ${activa ? 'bg-marca-suave text-marca dark:bg-teal-500/15 dark:text-teal-300' : t.n > 0 ? 'bg-slate-100 text-tinta dark:bg-slate-800 dark:text-slate-200' : 'bg-slate-50 text-tinta-3 dark:bg-slate-800/50'}`}>{t.n}</span>
              </button>
            );
          })}
          {urgentes > 0 && <span className="ml-auto self-center text-[13px] text-urgente dark:text-red-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden />{urgentes} {urgentes === 1 ? 'urgente' : 'urgentes'}</span>}
        </div>

        {(compras.length > 0 || negocios.length > 0 || conteoEM > 0) && (
          <div className={`${BARRA_FILTROS} flex items-center gap-2`} data-testid="aprob-buscador">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-label="Buscar en todas las aprobaciones"
                placeholder="Buscar en todas las aprobaciones: código, licitación, organismo, producto o tienda…" className={CAMPO} />
            </div>
            {busqueda && <button onClick={() => setBusqueda('')} className="flex items-center gap-1 px-2 h-8 text-[13px] font-medium text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-200"><X size={13} /> Limpiar</button>}
          </div>
        )}

        {/* Opciones del Auditor: primero, porque frenan el paso a Pre-postulación de cada licitación */}
        <div className={vista === 'compras' ? 'hidden' : ''}><BandejaAuditorEM onConteo={setConteoEM} busqueda={busqueda} /></div>

        {loading ? (
          <div className="space-y-3"><TarjetaCargando /><TarjetaCargando /></div>
        ) : negocios.length === 0 && compras.length === 0 && conteoEM === 0 ? (
          <Vacio icono={<Inbox size={28} />} titulo="No hay nada esperando tu aprobación"
            texto="Cuando un asistente deje listo el bloque técnico o comercial de un negocio, o Compras mande algo a aprobar, aparece aquí." />
        ) : (
          <div className="space-y-8">
            {vista === 'compras' && compras.length === 0 && <Vacio icono={<Inbox size={28} />} titulo="No hay compras por aprobar" texto="Compras rápidas, cuadros comparativos, márgenes y renuncias aparecen aquí." />}
            {vista === 'auditor' && negocios.length === 0 && conteoEM === 0 && <Vacio icono={<Inbox size={28} />} titulo="No hay licitaciones por aprobar" texto="Cuando un asistente deje listo el bloque técnico o comercial de un negocio, aparece aquí." />}
            {/* COMPRAS: sus propios filtros (tipo de aprobación, quién lo mandó, antigüedad) */}
            {vista === 'compras' && compras.length > 0 && (
              <section className="space-y-3" data-testid="aprob-seccion-compras" aria-label="Compras">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">Compras</h2>
                  <span className="text-[13px] text-tinta-2 dark:text-slate-400">{comprasFiltradas.length === compras.length ? `${compras.length} por aprobar` : `${comprasFiltradas.length} de ${compras.length}`} en {agruparPorLicitacion(comprasFiltradas).length} {agruparPorLicitacion(comprasFiltradas).length === 1 ? 'licitación' : 'licitaciones'}</span>
                </div>
                <div className={`${BARRA_FILTROS} space-y-2`} data-testid="filtros-compras">
                  <div className="flex flex-wrap items-center gap-2">
                    {solicitantes.length > 1 && (
                      <select value={filtroSolicitante} onChange={e => setFiltroSolicitante(e.target.value)} className={SELECT_CLS} aria-label="Quién lo mandó">
                        <option value="TODOS">Quién lo mandó: todos</option>
                        {solicitantes.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={() => setSoloAntiguos(v => !v)} aria-pressed={soloAntiguos}
                      className={`${CHIP} h-9 border ${soloAntiguos ? 'bg-red-50 text-urgente border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30' : 'text-tinta-2 dark:text-slate-300 border-linea dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden /> Esperan más de un día
                    </button>
                    {hayFiltrosCompras && <button onClick={limpiarFiltrosCompras} className="flex items-center gap-1 px-2 h-8 text-[13px] font-medium text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-200"><X size={13} /> Limpiar</button>}
                  </div>
                  <div className={GRUPO_CHIPS} role="group" aria-label="Tipo de aprobación">
                    <button type="button" onClick={() => setFiltroTipo('TODOS')} className={`${CHIP} ${filtroTipo === 'TODOS' ? CHIP_ON : CHIP_OFF}`}>Todos ({compras.length})</button>
                    {TIPOS_COMPRAS.filter(t => compras.some(c => c.tipo === t.v)).map(t => (
                      <button key={t.v} type="button" onClick={() => setFiltroTipo(t.v)} className={`${CHIP} ${filtroTipo === t.v ? CHIP_ON : CHIP_OFF}`}>
                        {t.label} ({compras.filter(c => c.tipo === t.v).length})
                      </button>
                    ))}
                  </div>
                </div>
                {comprasFiltradas.length === 0 ? (
                  <Vacio icono={<Search size={22} />} titulo="Nada de Compras calza con esos filtros" accion={<Boton tamano="sm" onClick={limpiarFiltrosCompras}>Limpiar filtros</Boton>} />
                ) : (
                  <Lista className="space-y-3"><AnimatePresence initial={false}>{agruparPorLicitacion(comprasFiltradas).map(g => <GrupoAprobacionCompras key={g.negocioId} items={g.items} onResuelto={comprasResuelta} />)}</AnimatePresence></Lista>
                )}
              </section>
            )}

            {/* AUDITOR (licitaciones): sus propios filtros (código/organismo, asistente, urgencia de cierre) */}
            {vista === 'auditor' && negocios.length > 0 && (
              <section className="space-y-3" data-testid="aprob-seccion-auditor" aria-label="Auditor">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">Licitaciones</h2>
                  <span className="text-[13px] text-tinta-2 dark:text-slate-400">{negociosFiltrados.length === negocios.length ? `${negocios.length} por visar` : `${negociosFiltrados.length} de ${negocios.length}`}</span>
                </div>
                <div className={`flex flex-wrap items-center gap-2 ${BARRA_FILTROS}`} data-testid="filtros-auditor">
                  {asistentes.length > 1 && (
                    <select value={filtroAsistente} onChange={e => setFiltroAsistente(e.target.value)} className={SELECT_CLS} aria-label="Asistente">
                      <option value="TODOS">Todos los asistentes</option>
                      {asistentes.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  )}
                  <div className={GRUPO_CHIPS} role="group" aria-label="Urgencia de cierre">
                    {SEMAFOROS.map(sm => (
                      <button key={sm.value} onClick={() => setFiltroSemaforo(sm.value)} className={`${CHIP} ${filtroSemaforo === sm.value ? CHIP_ON : CHIP_OFF}`}>
                        {sm.dot && <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} aria-hidden />} {sm.label}
                      </button>
                    ))}
                  </div>
                  {hayFiltrosActivos && <button onClick={limpiarFiltros} className="flex items-center gap-1 px-2 h-8 text-[13px] font-medium text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-200"><X size={13} /> Limpiar</button>}
                </div>
                {listaVisible.length === 0 ? (
                  <Vacio icono={<Search size={22} />} titulo="Ninguna licitación calza con esos filtros" accion={<Boton tamano="sm" onClick={limpiarFiltros}>Limpiar filtros</Boton>} />
                ) : (
                  <Lista className="space-y-3"><AnimatePresence initial={false}>
                    {listaVisible.map(n => (
                      <TarjetaNegocioAprobacion
                        key={n.negocioId} negocio={n}
                        onAprobarBloque={aprobarBloque} onRechazarBloque={rechazarBloque}
                        onAprobarTodo={aprobarTodo} aprobadoFlash={flashAprobados.has(n.negocioId)}
                        esAdmin={usuario?.rol === 'admin'} onEliminar={eliminarNegocio}
                      />
                    ))}
                  </AnimatePresence></Lista>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
