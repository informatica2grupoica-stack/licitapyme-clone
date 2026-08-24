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
import { ClipboardCheck, Loader2, Inbox, Search, X } from 'lucide-react';
import { TarjetaNegocioAprobacion, type NegocioAprobacion } from './TarjetaNegocioAprobacion';

const SEMAFOROS = [
  { value: 'TODOS', label: 'Todos', dot: 'bg-zinc-300 dark:bg-zinc-600' },
  { value: 'ROJO', label: 'Rojo', dot: 'bg-rose-500' },
  { value: 'AMARILLO', label: 'Amarillo', dot: 'bg-amber-500' },
  { value: 'VERDE', label: 'Verde', dot: 'bg-emerald-500' },
] as const;

export default function AprobacionesPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();

  const [negocios, setNegocios] = useState<NegocioAprobacion[]>([]);
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
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-500/15 flex items-center justify-center flex-shrink-0">
            <ClipboardCheck size={15} className="text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">Aprobaciones</h1>
            <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
              {negocios.length === 0 ? 'Sin nada pendiente' : `${negocios.length} negocio(s) con algo por revisar`}
            </p>
          </div>
        </div>

        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {/* Filtros */}
        {negocios.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar código, nombre u organismo…"
                className="w-full pl-8 pr-2.5 py-1.5 text-[12px] bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-zinc-700 dark:text-zinc-100 dark:placeholder:text-zinc-500 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>

            {asistentes.length > 1 && (
              <select
                value={filtroAsistente}
                onChange={e => setFiltroAsistente(e.target.value)}
                className="text-[12px] px-2.5 py-1.5 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-zinc-700 dark:text-zinc-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="TODOS">Todos los asistentes</option>
                {asistentes.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            )}

            <div className="flex items-center gap-1">
              {SEMAFOROS.map(s => (
                <button
                  key={s.value}
                  onClick={() => setFiltroSemaforo(s.value)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors ${
                    filtroSemaforo === s.value
                      ? 'bg-zinc-900 dark:bg-white/15 text-white dark:text-white'
                      : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {s.label}
                </button>
              ))}
            </div>

            {hayFiltrosActivos && (
              <button onClick={limpiarFiltros} className="flex items-center gap-1 px-2 py-1.5 text-[11.5px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          </div>
        ) : negocios.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Inbox size={28} className="text-zinc-300 dark:text-zinc-700" />
            <p className="text-[13.5px] font-semibold text-zinc-500 dark:text-zinc-400">No hay nada esperando tu aprobación</p>
            <p className="text-[12px] text-zinc-400 dark:text-zinc-500">Cuando un asistente cargue algo en el bloque técnico o comercial de un negocio, aparece acá.</p>
          </div>
        ) : listaVisible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center gap-2">
            <Search size={24} className="text-zinc-300 dark:text-zinc-700" />
            <p className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">Nada calza con esos filtros</p>
            <button onClick={limpiarFiltros} className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Limpiar filtros</button>
          </div>
        ) : (
          <div className="space-y-1.5">
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
      </div>
    </AppLayout>
  );
}
