'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession }  from '@/app/lib/session-context';
import { useToast }    from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Tarjeta, Datos, Dato, Estado } from '@/app/components/ui/kit/Tarjeta';
import { IconStar as Star, IconExternalLink as ExternalLink, IconTrash as Trash2, IconSearch as Search, IconRefresh as RefreshCw, IconUserPlus as UserPlus, IconCheck as Check, IconLoader2 as Loader2, IconX as X } from '@tabler/icons-react';
import { extractTipoFromCodigo, getTipoLicitacion } from '@/app/lib/tipos-licitacion';
import { estadoEfectivoNombre } from '@/app/lib/estado-mp';

interface Favorito {
  id:              number;
  codigo:          string;
  nombre:          string;
  organismo:       string;
  monto_total:     number | null;
  monto_estimado:  number | null;
  moneda:          string;
  fecha_cierre:    string | null;
  estado:          string | null;
  tipo_licitacion: string | null;
  region:          string | null;
  created_at:      string;
}

interface Usuario  { id: number; nombre: string | null; email: string; }
interface Etiqueta { id: number; nombre: string; color: string; }

// Color del punto del estado de la licitación (texto + punto, sin pastilla).
const ESTADO_COLOR: Record<string, string> = {
  'Publicada':  '#16a34a',
  'Adjudicada': '#0d9488',
  'Cerrada':    '#64748b',
  'Desierta':   '#dc2626',
  'Suspendida': '#d97706',
  'Revocada':   '#ea580c',
};

function formatMonto(monto: number | null, moneda = 'CLP'): string {
  if (!monto) return '—';
  if (moneda === 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(monto);
  }
  return `${moneda} ${monto.toLocaleString('es-CL')}`;
}

// Cierre en días de calendario: «Hoy», «Mañana», «en 5 días». Rojo hoy/mañana, ámbar hasta 3 días.
function diasHastaCierre(fecha: string | null): { label: string; color: string } | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const diff = Math.round((dia.getTime() - hoy.getTime()) / 86400000);
  if (diff < 0)   return { label: 'Vencida',  color: '#94a3b8' };
  if (diff === 0) return { label: 'Hoy',      color: '#dc2626' };
  if (diff === 1) return { label: 'Mañana',   color: '#dc2626' };
  if (diff <= 3)  return { label: `En ${diff} días`, color: '#d97706' };
  return { label: `En ${diff} días`, color: '#475569' };
}

// ── Modal Asignar (inline, sin shared) ────────────────────────────────────────
function ModalAsignar({
  favorito,
  usuarios,
  etiquetas,
  onClose,
  onSuccess,
}: {
  favorito:  Favorito;
  usuarios:  Usuario[];
  etiquetas: Etiqueta[];
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [usuarioId, setUsuarioId]     = useState<number | ''>('');
  const [etiquetaIds, setEtiquetaIds] = useState<number[]>([]);
  const [guardando, setGuardando]     = useState(false);
  const [exito, setExito]             = useState(false);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  const tipo = extractTipoFromCodigo(favorito.codigo);

  const asignar = async () => {
    if (!usuarioId) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/negocios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacion_codigo:    favorito.codigo,
          licitacion_nombre:    favorito.nombre,
          licitacion_organismo: favorito.organismo,
          licitacion_monto:     favorito.monto_total || favorito.monto_estimado,
          licitacion_cierre:    favorito.fecha_cierre,
          licitacion_estado:    favorito.estado,
          licitacion_tipo:      favorito.tipo_licitacion || tipo,
          licitacion_region:    favorito.region,
          asignado_a:           usuarioId,
          etiqueta_ids:         etiquetaIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error('Error al asignar', data.error); return; }
      setExito(true);
      toast.success('Asignado correctamente', 'Aparecerá en el panel Negocios');
      setTimeout(onSuccess, 800);
    } catch { toast.error('Error de conexión'); }
    finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-xl rounded-t-2xl sm:rounded-xl shadow-flotante scale-in overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-linea dark:border-slate-800">
          <div>
            <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-50">Asignar a un perfil</h3>
            <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">Se agrega al pipeline de Negocios.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800">
            <X size={18} stroke={1.75} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <div>
            <p className="text-[13px] font-medium text-tinta dark:text-slate-100 line-clamp-2">
              {favorito.nombre || favorito.codigo}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-tinta-2 dark:text-slate-400">
              <span className="font-mono">{favorito.codigo}</span>
              {tipo && <><span aria-hidden>·</span><span>{tipo}</span></>}
              {favorito.organismo && <><span aria-hidden>·</span><span className="truncate">{favorito.organismo}</span></>}
            </p>
          </div>

          {exito ? (
            <div className="flex flex-col items-center py-6 gap-3 slide-in-up">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-exito dark:bg-emerald-950/40">
                <Check size={24} stroke={2} />
              </span>
              <p className="font-semibold text-tinta dark:text-slate-100 text-[15px]">Listo, quedó asignada</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[13px] font-medium text-tinta dark:text-slate-200 mb-1 block">
                  Perfil destino
                </label>
                <Select
                  value={usuarioId === '' ? '' : String(usuarioId)}
                  onChange={v => setUsuarioId(v ? parseInt(v) : '')}
                  placeholder="Elige un perfil…"
                  options={usuarios.map(u => ({ value: String(u.id), label: u.nombre || u.email.split('@')[0], description: u.email }))} />
              </div>

              {etiquetas.length > 0 && (
                <div>
                  <label className="text-[13px] font-medium text-tinta dark:text-slate-200 mb-1.5 block">
                    Líneas de negocio <span className="font-normal text-tinta-2 dark:text-slate-400">(opcional)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {etiquetas.map(et => {
                      const sel = etiquetaIds.includes(et.id);
                      return (
                        <button
                          key={et.id}
                          type="button"
                          aria-pressed={sel}
                          onClick={() => setEtiquetaIds(p => sel ? p.filter(x => x !== et.id) : [...p, et.id])}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${
                            sel ? 'border-marca bg-marca-suave text-marca' : 'border-linea text-tinta-2 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span aria-hidden style={{ backgroundColor: et.color }} className="h-1.5 w-1.5 rounded-full" />
                          {et.nombre}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Boton onClick={onClose}>Cancelar</Boton>
                <Boton variante="primario" onClick={asignar} disabled={guardando || !usuarioId}
                  icono={guardando ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} stroke={1.75} />}>
                  {guardando ? 'Asignando…' : 'Asignar'}
                </Boton>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function FavoritosPage() {
  const { usuario }  = useSession();
  const toast        = useToast();
  const isAdmin      = usuario?.rol === 'admin';

  const [favoritos, setFavoritos]   = useState<Favorito[]>([]);
  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
  const [etiquetas, setEtiquetas]   = useState<Etiqueta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [asignando, setAsignando]   = useState<Favorito | null>(null);

  const cargarFavoritos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const promises: Promise<any>[] = [fetch('/api/favorites'), fetch('/api/etiquetas')];
      if (isAdmin) promises.push(fetch('/api/usuarios'));
      const results = await Promise.all(promises);
      const jsonResults = await Promise.all(results.map(r => r.json()));
      const favData = jsonResults[0];
      const etData  = jsonResults[1];
      const usData  = jsonResults[2]; // defined only when isAdmin
      if (!favData.success) throw new Error(favData.error);
      setFavoritos(favData.favorites || []);
      if (etData.success) setEtiquetas(etData.etiquetas || []);
      if (isAdmin && usData?.success) setUsuarios(usData.usuarios || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar favoritos');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { cargarFavoritos(); }, [cargarFavoritos]);

  const eliminarFavorito = async (codigo: string) => {
    setEliminando(codigo);
    try {
      await fetch(`/api/favorites?codigo=${encodeURIComponent(codigo)}`, { method: 'DELETE' });
      setFavoritos(prev => prev.filter(f => f.codigo !== codigo));
      toast.success('Quitado de favoritos');
    } catch {
      toast.error('Error al eliminar');
    } finally {
      setEliminando(null);
    }
  };

  // Tipos disponibles en la lista actual
  const tiposDisponibles = [...new Set(
    favoritos.map(f => extractTipoFromCodigo(f.codigo)).filter(Boolean)
  )].sort();

  const favoritosFiltrados = favoritos.filter(f => {
    const matchSearch = search === '' ||
      f.nombre?.toLowerCase().includes(search.toLowerCase()) ||
      f.organismo?.toLowerCase().includes(search.toLowerCase()) ||
      f.codigo?.toLowerCase().includes(search.toLowerCase());
    const tipoFav = extractTipoFromCodigo(f.codigo);
    const matchTipo = filtroTipo === '' || tipoFav === filtroTipo;
    return matchSearch && matchTipo;
  });

  const BTN_FILTRO = 'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60';
  const FILTRO_ON  = 'border-marca bg-marca-suave text-marca';
  const FILTRO_OFF = 'border-linea text-tinta-2 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800';

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Favoritos' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Mis favoritos"
          descripcion={loading ? 'Cargando…' : `${favoritosFiltrados.length} de ${favoritos.length} guardada${favoritos.length !== 1 ? 's' : ''}`}
          acciones={
            <>
              <Link href="/"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-marca px-3.5 text-sm font-medium text-white shadow-tarjeta transition-colors hover:bg-marca-fuerte focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 focus-visible:ring-offset-1">
                <Search size={16} stroke={1.75} /> Buscar licitaciones
              </Link>
              <Boton onClick={cargarFavoritos} aria-label="Actualizar" className="!px-0 w-9">
                <RefreshCw size={16} stroke={1.75} className={loading ? 'animate-spin text-slate-400' : 'text-slate-400'} />
              </Boton>
            </>
          }
        />

        {/* Filtros */}
        {favoritos.length > 0 && (
          <div className="space-y-3 mb-5">
            <div className="relative w-full max-w-md">
              <Search size={16} stroke={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filtrar por nombre, organismo o código…"
                aria-label="Filtrar favoritos"
                className="h-9 w-full rounded-lg border border-linea bg-white pl-9 pr-3 text-sm text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            {tiposDisponibles.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] text-tinta-2 dark:text-slate-400 mr-1">Tipo</span>
                <button onClick={() => setFiltroTipo('')} aria-pressed={filtroTipo === ''}
                  className={`${BTN_FILTRO} ${filtroTipo === '' ? FILTRO_ON : FILTRO_OFF}`}>
                  Todos
                </button>
                {tiposDisponibles.map(t => {
                  const info = getTipoLicitacion(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setFiltroTipo(filtroTipo === t ? '' : t)}
                      aria-pressed={filtroTipo === t}
                      title={info?.label}
                      className={`${BTN_FILTRO} ${filtroTipo === t ? FILTRO_ON : FILTRO_OFF}`}
                    >
                      <span aria-hidden style={{ backgroundColor: info?.color || '#94a3b8' }} className="h-1.5 w-1.5 rounded-full" />
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4">
            <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargarFavoritos }}>{error}</Banner>
          </div>
        )}

        {/* Carga */}
        {loading && (
          <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
            {[1, 2, 3, 4].map(i => <Esqueleto key={i} className="h-36 rounded-xl" />)}
          </div>
        )}

        {/* Lista */}
        {!loading && !error && (
          <>
            {favoritosFiltrados.length === 0 ? (
              <Vacio
                icono={<Star size={28} stroke={1.75} />}
                titulo={search || filtroTipo ? 'Sin resultados' : 'Aún no tienes favoritos'}
                texto={search || filtroTipo ? 'Cambia o quita los filtros para ver tus licitaciones guardadas.' : 'Busca licitaciones y guárdalas con la estrella.'}
                accion={!search && !filtroTipo
                  ? <Link href="/" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-marca px-3 text-[13px] font-medium text-white shadow-tarjeta hover:bg-marca-fuerte focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60"><Search size={16} stroke={1.75} /> Ir al buscador</Link>
                  : <Boton tamano="sm" onClick={() => { setSearch(''); setFiltroTipo(''); }}>Quitar filtros</Boton>}
              />
            ) : (
              <Lista className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
                {favoritosFiltrados.map(fav => {
                  const cierre = diasHastaCierre(fav.fecha_cierre);
                  // MP guarda el estado como código (5, 8…): se muestra su nombre, y «Cerrada» si ya venció el plazo.
                  const estadoNombre = estadoEfectivoNombre(fav.estado, fav.fecha_cierre);
                  const monto  = formatMonto(fav.monto_total || fav.monto_estimado, fav.moneda);
                  const tipo   = extractTipoFromCodigo(fav.codigo);
                  const tipoInfo = tipo ? getTipoLicitacion(tipo) : null;
                  const region = fav.region
                    ? fav.region.replace('Región de ', '').replace('Región del ', '').replace('Región Metropolitana de ', 'RM')
                    : null;

                  return (
                    <Tarjeta key={fav.codigo}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
                            className="text-[15px] font-semibold text-tinta hover:text-marca transition-colors line-clamp-2 dark:text-slate-50"
                          >
                            {fav.nombre || 'Sin nombre'}
                          </Link>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-tinta-2 dark:text-slate-400">
                            <span className="font-mono">{fav.codigo}</span>
                            {tipo && <span title={tipoInfo?.label}><span aria-hidden>· </span>{tipo}</span>}
                          </p>
                        </div>
                        {estadoNombre && (
                          <span className="flex-shrink-0 text-xs font-medium text-tinta dark:text-slate-200">
                            <Estado color={ESTADO_COLOR[estadoNombre] || '#64748b'}>{estadoNombre}</Estado>
                          </span>
                        )}
                      </div>

                      <Datos columnas={2}>
                        <Dato rotulo="Organismo">{fav.organismo || undefined}</Dato>
                        <Dato rotulo="Región">{region || undefined}</Dato>
                        <Dato rotulo="Monto">{monto !== '—' ? monto : undefined}</Dato>
                        <Dato rotulo="Cierre">
                          {fav.fecha_cierre ? (
                            <>
                              {new Date(fav.fecha_cierre).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '')}
                              {cierre && <span className="ml-1.5 text-xs font-medium" style={{ color: cierre.color }}>{cierre.label}</span>}
                            </>
                          ) : undefined}
                        </Dato>
                      </Datos>

                      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-linea/80 pt-3 dark:border-slate-800">
                        <button
                          onClick={() => eliminarFavorito(fav.codigo)}
                          disabled={eliminando === fav.codigo}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-tinta-2 transition-colors hover:bg-red-50 hover:text-urgente focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-red-950/40"
                        >
                          <Trash2 size={16} stroke={1.75} />
                          {eliminando === fav.codigo ? 'Quitando…' : 'Quitar'}
                        </button>
                        <Link
                          href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          <ExternalLink size={16} stroke={1.75} /> Ver
                        </Link>
                        {isAdmin && (
                          <Boton variante="primario" tamano="sm" onClick={() => setAsignando(fav)} icono={<UserPlus size={16} stroke={1.75} />}>
                            Asignar
                          </Boton>
                        )}
                      </div>
                    </Tarjeta>
                  );
                })}
              </Lista>
            )}
          </>
        )}
      </div>

      {/* Modal asignar */}
      {asignando && (
        <ModalAsignar
          favorito={asignando}
          usuarios={usuarios}
          etiquetas={etiquetas}
          onClose={() => setAsignando(null)}
          onSuccess={() => { setAsignando(null); }}
        />
      )}
    </AppLayout>
  );
}
