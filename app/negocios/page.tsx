'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  Briefcase, Plus, Search, ExternalLink, Trash2,
  Calendar, DollarSign, Building2, AlertCircle, Loader2,
  ChevronDown, X, RefreshCw, Users,
} from 'lucide-react';
import { getEstadoPipeline } from '@/app/lib/pipeline';

interface Etiqueta { id: number; nombre: string; color: string; }

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_estado: string | null;
  licitacion_tipo: string | null;
  licitacion_region: string | null;
  estado_pipeline: string | null;
  monto_ofertado: number;
  usuario_nombre: string;
  usuario_email: string;
  etiquetas: Etiqueta[];
  comentarios_count: number;
  updated_at: string;
}

interface Usuario { id: number; nombre: string; email: string; }

const TIPO_BADGE: Record<string, string> = {
  'LE': 'bg-red-500', 'LP': 'bg-blue-500', 'LQ': 'bg-purple-500',
  'CO': 'bg-green-500', 'L1': 'bg-orange-500',
};

const TIPOS_FILTRO = ['LE', 'LP', 'LQ', 'CO', 'L1'];

function PipelineBadge({ estadoId }: { estadoId: string | null }) {
  const e = getEstadoPipeline(estadoId || '1ASIGNADO');
  if (!e) return null;
  return (
    <span
      style={{ backgroundColor: e.color + '18', color: e.color, borderColor: e.color + '40' }}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border"
    >
      <span style={{ backgroundColor: e.color }} className="w-1 h-1 rounded-full flex-shrink-0" />
      {e.label}
    </span>
  );
}

function formatMonto(n: number | null): string {
  if (!n) return '$0';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

function diasRestantes(fecha: string | null): string {
  if (!fecha) return '';
  const diff = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  if (diff < 0) return 'Vencida';
  if (diff === 0) return 'Hoy';
  return `${diff}d`;
}

// ── Modal para asignar nueva licitación ──────────────────────────────────────
function ModalAsignar({
  open, onClose, onSuccess, usuarios, etiquetas,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  usuarios: Usuario[];
  etiquetas: Etiqueta[];
}) {
  const [form, setForm] = useState({
    codigo: '', asignado_a: '', etiqueta_ids: [] as number[],
  });
  const [buscando, setBuscando] = useState(false);
  const [licitacion, setLicitacion] = useState<any>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const buscarLicitacion = async () => {
    if (!form.codigo.trim()) return;
    setBuscando(true);
    setError('');
    setLicitacion(null);
    try {
      const res = await fetch(`/api/licitacion-completa/${encodeURIComponent(form.codigo.trim())}`);
      const data = await res.json();
      if (!res.ok || !data.licitacion) throw new Error(data.error || 'No encontrada');
      setLicitacion(data.licitacion);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuscando(false);
    }
  };

  const guardar = async () => {
    if (!form.codigo || !form.asignado_a) {
      setError('Código y usuario son requeridos'); return;
    }
    setGuardando(true);
    try {
      const res = await fetch('/api/negocios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacion_codigo: form.codigo.trim(),
          asignado_a: parseInt(form.asignado_a),
          etiqueta_ids: form.etiqueta_ids,
          licitacion_nombre: licitacion?.nombre,
          licitacion_organismo: licitacion?.organismo,
          licitacion_monto: licitacion?.monto_estimado || licitacion?.monto_total,
          licitacion_cierre: licitacion?.fecha_cierre,
          licitacion_estado: licitacion?.estado,
          licitacion_tipo: licitacion?.tipo_licitacion,
          licitacion_region: licitacion?.region,
          licitacion_descripcion: licitacion?.descripcion,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSuccess();
      onClose();
      setForm({ codigo: '', asignado_a: '', etiqueta_ids: [] });
      setLicitacion(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Plus size={20} className="text-blue-600" /> Asignar licitación
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-lg text-sm">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          {/* Buscar código */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Código de licitación</label>
            <div className="flex gap-2">
              <input
                value={form.codigo}
                onChange={e => setForm(p => ({ ...p, codigo: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && buscarLicitacion()}
                placeholder="ej: 1234-56-LE26"
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
              <button
                onClick={buscarLicitacion}
                disabled={buscando}
                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {buscando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              </button>
            </div>
          </div>

          {/* Preview licitación */}
          {licitacion && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
              <p className="font-semibold text-gray-900 line-clamp-2">{licitacion.nombre}</p>
              <p className="text-gray-500 mt-0.5">{licitacion.organismo}</p>
              <p className="text-blue-600 font-medium mt-1">
                {formatMonto(licitacion.monto_estimado || licitacion.monto_total)}
              </p>
            </div>
          )}

          {/* Asignar a */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Asignar a usuario</label>
            <select
              value={form.asignado_a}
              onChange={e => setForm(p => ({ ...p, asignado_a: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">Seleccionar usuario...</option>
              {usuarios.map(u => (
                <option key={u.id} value={u.id}>{u.nombre || u.email}</option>
              ))}
            </select>
          </div>

          {/* Etiquetas */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Líneas de negocio</label>
            <div className="flex flex-wrap gap-2">
              {etiquetas.map(et => {
                const sel = form.etiqueta_ids.includes(et.id);
                return (
                  <button
                    key={et.id}
                    onClick={() => setForm(p => ({
                      ...p,
                      etiqueta_ids: sel
                        ? p.etiqueta_ids.filter(x => x !== et.id)
                        : [...p.etiqueta_ids, et.id],
                    }))}
                    style={sel ? { backgroundColor: et.color, borderColor: et.color } : {}}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                      sel ? 'text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {et.nombre}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !form.codigo || !form.asignado_a}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : null}
            Asignar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
function NegociosContent() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios]     = useState<Negocio[]>([]);
  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
  const [etiquetas, setEtiquetas]   = useState<Etiqueta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [filtroUsuario, setFiltroUsuario] = useState('');
  const [filtroEtiqueta, setFiltroEtiqueta] = useState('');
  const [filtroTipo, setFiltroTipo]         = useState('');
  const [showModal, setShowModal]   = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filtroUsuario ? `/api/negocios?usuarioId=${filtroUsuario}` : '/api/negocios';
      const [negRes, etRes] = await Promise.all([
        fetch(url),
        fetch('/api/etiquetas'),
      ]);
      const negData = await negRes.json();
      const etData = await etRes.json();
      if (!negData.success) throw new Error(negData.error);
      setNegocios(negData.negocios || []);
      setUsuarios(negData.usuarios || []);
      if (etData.success) setEtiquetas(etData.etiquetas || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filtroUsuario]);

  useEffect(() => { cargar(); }, [cargar]);

  const eliminar = async (id: number) => {
    if (!confirm('¿Quitar esta licitación del panel de negocios?')) return;
    await fetch(`/api/negocios/${id}`, { method: 'DELETE' });
    setNegocios(prev => prev.filter(n => n.id !== id));
  };

  const negociosFiltrados = negocios.filter(n => {
    const matchSearch = search === '' ||
      n.licitacion_nombre?.toLowerCase().includes(search.toLowerCase()) ||
      n.licitacion_codigo?.toLowerCase().includes(search.toLowerCase()) ||
      n.licitacion_organismo?.toLowerCase().includes(search.toLowerCase());
    const matchEt = filtroEtiqueta === '' ||
      n.etiquetas.some(e => String(e.id) === filtroEtiqueta);
    const tipoDelCodigo = n.licitacion_codigo?.match(/-(LE|LP|LQ|CO|L1)\d/)?.[1] || '';
    const matchTipo = filtroTipo === '' || tipoDelCodigo === filtroTipo;
    return matchSearch && matchEt && matchTipo;
  });

  const ESTADO_COLOR: Record<string, string> = {
    'Publicada': 'bg-green-100 text-green-700',
    'Adjudicada': 'bg-blue-100 text-blue-700',
    'Cerrada': 'bg-gray-100 text-gray-500',
  };

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Negocios' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Briefcase size={24} className="text-blue-600" /> Negocios
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Cargando...' : `${negociosFiltrados.length} licitacion${negociosFiltrados.length !== 1 ? 'es' : ''} asignada${negociosFiltrados.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={cargar} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <Plus size={15} /> Asignar licitación
              </button>
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="space-y-2 mb-4">
          {/* Fila 1: búsqueda + selects */}
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-52"
              />
            </div>

            {isAdmin && usuarios.length > 0 && (
              <select
                value={filtroUsuario}
                onChange={e => setFiltroUsuario(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Todos los usuarios</option>
                {usuarios.map(u => (
                  <option key={u.id} value={u.id}>{u.nombre || u.email}</option>
                ))}
              </select>
            )}

            {etiquetas.length > 0 && (
              <select
                value={filtroEtiqueta}
                onChange={e => setFiltroEtiqueta(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Todas las líneas</option>
                {etiquetas.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            )}
          </div>

          {/* Fila 2: filtro por tipo (chips) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400 font-medium mr-0.5">Tipo:</span>
            <button
              onClick={() => setFiltroTipo('')}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                filtroTipo === ''
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              Todos
            </button>
            {TIPOS_FILTRO.map(t => {
              const bg = TIPO_BADGE[t] || 'bg-gray-400';
              const isActive = filtroTipo === t;
              return (
                <button
                  key={t}
                  onClick={() => setFiltroTipo(isActive ? '' : t)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                    isActive
                      ? `${bg} text-white border-transparent`
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
            <AlertCircle size={16} /> {error}
            <button onClick={cargar} className="ml-auto hover:underline">Reintentar</button>
          </div>
        )}

        {/* Tabla */}
        {!loading && !error && (
          negociosFiltrados.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
              <Briefcase size={36} className="text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                {search || filtroEtiqueta ? 'Sin resultados' : 'No hay licitaciones asignadas'}
              </h3>
              <p className="text-sm text-gray-400">
                {isAdmin
                  ? 'Usa "Asignar licitación" para agregar un proyecto al panel'
                  : 'El administrador aún no te ha asignado licitaciones'
                }
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Tabla header */}
              <div className="hidden md:grid grid-cols-[1fr_2.5fr_1.5fr_1fr_1.2fr_1fr_auto] gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <span>ID</span>
                <span>Nombre</span>
                <span>Organismo</span>
                <span>Tipo</span>
                <span>Monto disponible</span>
                <span>Cierre</span>
                <span></span>
              </div>

              {/* Filas */}
              <div className="divide-y divide-gray-50">
                {negociosFiltrados.map(neg => {
                  const estadoCls = ESTADO_COLOR[neg.licitacion_estado || ''] || 'bg-gray-100 text-gray-500';
                  const tipo = neg.licitacion_codigo?.match(/-(LE|LP|LQ|CO|L1)\d/)?.[1] || '';
                  const tipoBg = TIPO_BADGE[tipo] || 'bg-gray-400';
                  const dias = diasRestantes(neg.licitacion_cierre);
                  const diasCls = dias === 'Vencida' ? 'text-gray-400' :
                    dias.replace('d', '') !== '' && parseInt(dias) <= 3 ? 'text-red-500 font-semibold' :
                    parseInt(dias) <= 7 ? 'text-orange-500' : 'text-gray-500';

                  return (
                    <Link
                      key={neg.id}
                      href={`/negocios/${neg.id}`}
                      className="grid md:grid-cols-[1fr_2.5fr_1.5fr_1fr_1.2fr_1fr_auto] gap-3 px-4 py-3.5 hover:bg-blue-50/30 transition-colors items-center group"
                    >
                      {/* ID + usuario */}
                      <div>
                        <p className="text-xs font-mono text-gray-600 font-semibold">{neg.licitacion_codigo}</p>
                        {isAdmin && (
                          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <Users size={9} /> {neg.usuario_nombre || neg.usuario_email}
                          </p>
                        )}
                      </div>

                      {/* Nombre + etiquetas + pipeline */}
                      <div>
                        <p className="text-sm text-gray-800 line-clamp-1 font-medium group-hover:text-blue-600 transition-colors">
                          {neg.licitacion_nombre || 'Sin nombre'}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <PipelineBadge estadoId={neg.estado_pipeline} />
                          {neg.etiquetas.slice(0, 2).map(et => (
                            <span
                              key={et.id}
                              style={{ backgroundColor: et.color + '20', color: et.color, borderColor: et.color + '40' }}
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold border"
                            >
                              {et.nombre}
                            </span>
                          ))}
                          {neg.comentarios_count > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                              {neg.comentarios_count} com.
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Organismo */}
                      <p className="text-xs text-gray-500 line-clamp-2 hidden md:block">
                        {neg.licitacion_organismo}
                      </p>

                      {/* Tipo */}
                      <div className="hidden md:block">
                        {tipo && (
                          <span className={`${tipoBg} text-white text-xs px-2 py-0.5 rounded font-bold`}>
                            {tipo}
                          </span>
                        )}
                      </div>

                      {/* Monto */}
                      <div className="hidden md:block">
                        <p className="text-sm text-gray-700 font-medium">{formatMonto(neg.licitacion_monto)}</p>
                        {neg.monto_ofertado > 0 && (
                          <p className="text-xs text-gray-400">Ofertado: {formatMonto(neg.monto_ofertado)}</p>
                        )}
                      </div>

                      {/* Cierre */}
                      <div className="hidden md:block text-sm">
                        {neg.licitacion_cierre ? (
                          <>
                            <p className="text-gray-600">{new Date(neg.licitacion_cierre).toLocaleDateString('es-CL')}</p>
                            <p className={`text-xs ${diasCls}`}>{dias}</p>
                          </>
                        ) : <span className="text-gray-400">—</span>}
                      </div>

                      {/* Acciones */}
                      <div className="flex items-center gap-1" onClick={e => e.preventDefault()}>
                        {neg.licitacion_estado && (
                          <span className={`text-xs px-2 py-0.5 rounded-full hidden lg:inline-flex ${estadoCls}`}>
                            {neg.licitacion_estado}
                          </span>
                        )}
                        {isAdmin && (
                          <button
                            onClick={e => { e.preventDefault(); eliminar(neg.id); }}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* Skeleton loading */}
        {loading && (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-4 py-4 border-b border-gray-50 animate-pulse flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-24" />
                <div className="h-4 bg-gray-100 rounded flex-1" />
                <div className="h-4 bg-gray-100 rounded w-32" />
              </div>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <ModalAsignar
          open={showModal}
          onClose={() => setShowModal(false)}
          onSuccess={cargar}
          usuarios={usuarios}
          etiquetas={etiquetas}
        />
      )}
    </AppLayout>
  );
}

export default function NegociosPage() {
  return <Suspense><NegociosContent /></Suspense>;
}
