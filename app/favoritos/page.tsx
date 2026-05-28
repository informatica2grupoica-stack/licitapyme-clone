'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession }  from '@/app/lib/session-context';
import { useToast }    from '@/app/components/ui/toast';
import {
  Star, ExternalLink, Trash2, Search, Building2, Calendar,
  DollarSign, MapPin, RefreshCw, AlertCircle, FileText,
  UserPlus, ChevronDown, Check, Loader2, X,
} from 'lucide-react';
import { extractTipoFromCodigo, getTipoLicitacion, TIPO_COLOR_CLASS } from '@/app/lib/tipos-licitacion';

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

const ESTADO_COLOR: Record<string, string> = {
  'Publicada':  'bg-green-100 text-green-700',
  'Adjudicada': 'bg-blue-100 text-blue-700',
  'Cerrada':    'bg-gray-100 text-gray-600',
  'Desierta':   'bg-red-100 text-red-600',
  'Suspendida': 'bg-yellow-100 text-yellow-700',
  'Revocada':   'bg-orange-100 text-orange-700',
};

function formatMonto(monto: number | null, moneda = 'CLP'): string {
  if (!monto) return '—';
  if (moneda === 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(monto);
  }
  return `${moneda} ${monto.toLocaleString()}`;
}

function diasHastaCierre(fecha: string | null): { label: string; color: string } | null {
  if (!fecha) return null;
  const diff = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { label: 'Vencida',   color: 'text-gray-400' };
  if (diff === 0) return { label: 'Hoy',      color: 'text-red-600 font-semibold' };
  if (diff <= 3)  return { label: `${diff}d`, color: 'text-red-500 font-semibold' };
  if (diff <= 7)  return { label: `${diff}d`, color: 'text-orange-500' };
  return { label: `${diff}d`, color: 'text-gray-500' };
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
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl scale-in overflow-hidden">
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-10 h-1 bg-zinc-200 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600/10 rounded-lg flex items-center justify-center">
              <UserPlus size={15} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-zinc-900 leading-none">Asignar a perfil</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">Agregar al pipeline de negocios</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div className="bg-zinc-50 border border-zinc-200/60 rounded-xl p-3.5">
            <p className="text-[13px] font-semibold text-zinc-900 line-clamp-2 mb-1.5">
              {favorito.nombre || favorito.codigo}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
              <span className="font-mono text-blue-600 font-semibold">{favorito.codigo}</span>
              {tipo && (
                <span className={`${TIPO_COLOR_CLASS[tipo] || 'bg-gray-500'} text-white text-[10px] px-1.5 py-0.5 rounded font-bold`}>
                  {tipo}
                </span>
              )}
              {favorito.organismo && <span className="truncate">{favorito.organismo}</span>}
            </div>
          </div>

          {exito ? (
            <div className="flex flex-col items-center py-6 gap-3 slide-in-up">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center">
                <Check size={26} className="text-emerald-600" strokeWidth={2.5} />
              </div>
              <p className="font-bold text-zinc-900 text-[14px]">¡Listo!</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">
                  Usuario destino *
                </label>
                <div className="relative">
                  <select
                    value={usuarioId}
                    onChange={e => setUsuarioId(e.target.value ? parseInt(e.target.value) : '')}
                    className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-[13px] text-zinc-800 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 outline-none appearance-none pr-9"
                  >
                    <option value="">Selecciona un usuario…</option>
                    {usuarios.map(u => (
                      <option key={u.id} value={u.id}>{u.nombre || u.email.split('@')[0]}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                </div>
              </div>

              {etiquetas.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">
                    Líneas de negocio
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {etiquetas.map(et => {
                      const sel = etiquetaIds.includes(et.id);
                      return (
                        <button
                          key={et.id}
                          type="button"
                          onClick={() => setEtiquetaIds(p => sel ? p.filter(x => x !== et.id) : [...p, et.id])}
                          style={sel ? { backgroundColor: et.color + '18', color: et.color, borderColor: et.color + '60' } : {}}
                          className={`inline-flex items-center gap-1 text-[12px] px-3 py-1 rounded-full border font-medium transition-all ${
                            sel ? 'shadow-sm' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                          }`}
                        >
                          {sel && <Check size={10} strokeWidth={3} />}
                          {et.nombre}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 border border-zinc-200 text-zinc-600 rounded-xl text-[13px] font-semibold hover:bg-zinc-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={asignar}
                  disabled={guardando || !usuarioId}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-semibold hover:bg-blue-500 disabled:opacity-40"
                >
                  {guardando ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  Asignar
                </button>
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

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Favoritos' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Star size={24} className="text-amber-500 fill-amber-500" />
              Mis favoritos
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Cargando…' : `${favoritosFiltrados.length} de ${favoritos.length} guardada${favoritos.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Search size={15} /> Buscar licitaciones
            </Link>
            <button onClick={cargarFavoritos} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Filtros */}
        {favoritos.length > 0 && (
          <div className="space-y-2 mb-4">
            <div className="relative w-full max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filtrar por nombre, organismo o código…"
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            {tiposDisponibles.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400 font-medium">Tipo:</span>
                <button
                  onClick={() => setFiltroTipo('')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                    filtroTipo === '' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  Todos
                </button>
                {tiposDisponibles.map(t => {
                  const info = getTipoLicitacion(t);
                  const bg   = TIPO_COLOR_CLASS[t] || 'bg-gray-400';
                  return (
                    <button
                      key={t}
                      onClick={() => setFiltroTipo(filtroTipo === t ? '' : t)}
                      title={info?.label}
                      className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                        filtroTipo === t ? `${bg} text-white border-transparent` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}
                    >
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
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
            <AlertCircle size={16} /> {error}
            <button onClick={cargarFavoritos} className="ml-auto hover:underline">Reintentar</button>
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Lista */}
        {!loading && !error && (
          <>
            {favoritosFiltrados.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Star size={28} className="text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  {search || filtroTipo ? 'Sin resultados' : 'No tienes favoritos aún'}
                </h3>
                <p className="text-gray-500 text-sm mb-6">
                  {search || filtroTipo ? 'Cambia los filtros' : 'Busca licitaciones y guárdalas con la estrella ★'}
                </p>
                {!search && !filtroTipo && (
                  <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                    <Search size={15} /> Ir al buscador
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {favoritosFiltrados.map(fav => {
                  const cierre     = diasHastaCierre(fav.fecha_cierre);
                  const estadoClass = ESTADO_COLOR[fav.estado || ''] || 'bg-gray-100 text-gray-600';
                  const monto      = formatMonto(fav.monto_total || fav.monto_estimado, fav.moneda);
                  const tipo       = extractTipoFromCodigo(fav.codigo);
                  const tipoInfo   = tipo ? getTipoLicitacion(tipo) : null;
                  const tipoBg     = tipo ? (TIPO_COLOR_CLASS[tipo] || 'bg-gray-500') : '';

                  return (
                    <div
                      key={fav.codigo}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all p-4 sm:p-5"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                          <FileText size={18} className="text-blue-600" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                {tipo && (
                                  <span
                                    className={`${tipoBg} text-white text-[10px] font-black px-1.5 py-0.5 rounded flex-shrink-0`}
                                    title={tipoInfo?.label}
                                  >
                                    {tipo}
                                  </span>
                                )}
                                <Link
                                  href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
                                  className="text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors line-clamp-1"
                                >
                                  {fav.nombre || 'Sin nombre'}
                                </Link>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                                {fav.organismo && (
                                  <span className="flex items-center gap-1 text-xs text-gray-500 truncate max-w-[200px]">
                                    <Building2 size={11} /> {fav.organismo}
                                  </span>
                                )}
                                {fav.region && (
                                  <span className="flex items-center gap-1 text-xs text-gray-500">
                                    <MapPin size={11} /> {fav.region.replace('Región de ', '').replace('Región del ', '').replace('Región Metropolitana de ', 'RM')}
                                  </span>
                                )}
                                {monto !== '—' && (
                                  <span className="flex items-center gap-1 text-xs text-gray-600 font-medium">
                                    <DollarSign size={11} /> {monto}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {fav.estado && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoClass}`}>
                                  {fav.estado}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-50">
                            <div className="flex items-center gap-3 text-xs text-gray-400">
                              {fav.fecha_cierre && (
                                <span className="flex items-center gap-1">
                                  <Calendar size={11} />
                                  {new Date(fav.fecha_cierre).toLocaleDateString('es-CL')}
                                  {cierre && <span className={`ml-1 ${cierre.color}`}>({cierre.label})</span>}
                                </span>
                              )}
                              <span className="font-mono text-[11px]">{fav.codigo}</span>
                            </div>

                            <div className="flex items-center gap-1">
                              {isAdmin && (
                                <button
                                  onClick={() => setAsignando(fav)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-500 transition-colors font-semibold shadow-sm shadow-blue-600/20"
                                >
                                  <UserPlus size={12} /> Asignar
                                </button>
                              )}
                              <Link
                                href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                              >
                                <ExternalLink size={12} /> Ver
                              </Link>
                              <button
                                onClick={() => eliminarFavorito(fav.codigo)}
                                disabled={eliminando === fav.codigo}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <Trash2 size={12} />
                                {eliminando === fav.codigo ? '…' : 'Quitar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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
