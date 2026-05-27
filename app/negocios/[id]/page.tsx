'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  ArrowLeft, Building2, Calendar, DollarSign, MapPin, Tag,
  MessageSquare, Send, Trash2, Loader2, AlertCircle, ExternalLink,
  FileText, User, ShieldCheck, Edit3, Check, X,
} from 'lucide-react';

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
  licitacion_descripcion: string | null;
  monto_ofertado: number;
  usuario_nombre: string;
  usuario_email: string;
  admin_nombre: string | null;
  etiquetas: Etiqueta[];
  created_at: string;
}

interface Comentario {
  id: number;
  comentario: string;
  created_at: string;
  usuario_id: number;
  usuario_nombre: string;
  usuario_email: string;
  etiqueta_id: number | null;
  etiqueta_nombre: string | null;
  etiqueta_color: string | null;
}

function formatMonto(n: number | null): string {
  if (!n) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

function getIniciales(nombre: string | null, email: string): string {
  if (nombre) return nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email[0].toUpperCase();
}

const AVATAR_COLORS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-purple-500 to-pink-600',
  'from-orange-500 to-amber-600',
  'from-cyan-500 to-sky-600',
];

function avatarColor(id: number) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }

// ── Sección Comentarios ───────────────────────────────────────────────────────
function SeccionComentarios({ negocioId, etiquetas }: { negocioId: number; etiquetas: Etiqueta[] }) {
  const { usuario } = useSession();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState('');
  const [etiquetaSel, setEtiquetaSel] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/negocios/${negocioId}/comentarios`);
      const data = await res.json();
      if (data.success) setComentarios(data.comentarios || []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/negocios/${negocioId}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comentario: texto.trim(), etiqueta_id: etiquetaSel }),
      });
      if (res.ok) {
        setTexto('');
        setEtiquetaSel(null);
        await cargar();
      }
    } catch { /* silencioso */ }
    finally { setEnviando(false); }
  };

  const eliminar = async (id: number) => {
    await fetch(`/api/negocios/${negocioId}/comentarios?comentarioId=${id}`, { method: 'DELETE' });
    setComentarios(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
        <MessageSquare size={18} className="text-blue-600" />
        Comentarios
        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">{comentarios.length}</span>
      </h3>

      {/* Hilo */}
      <div className="space-y-3">
        {loading && (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1">
                  <div className="h-3 bg-gray-200 rounded w-1/4 mb-2" />
                  <div className="h-4 bg-gray-100 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && comentarios.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6 bg-gray-50 rounded-xl">
            Sé el primero en comentar este proyecto
          </p>
        )}

        {comentarios.map(c => (
          <div key={c.id} className="flex gap-3 group">
            {/* Avatar */}
            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarColor(c.usuario_id)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5`}>
              {getIniciales(c.usuario_nombre, c.usuario_email)}
            </div>
            {/* Contenido */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-800">
                  {c.usuario_nombre || c.usuario_email.split('@')[0]}
                </span>
                {c.etiqueta_nombre && (
                  <span
                    style={{ backgroundColor: (c.etiqueta_color || '#3B82F6') + '20', color: c.etiqueta_color || '#3B82F6', borderColor: (c.etiqueta_color || '#3B82F6') + '50' }}
                    className="text-xs px-2 py-0.5 rounded-full font-semibold border"
                  >
                    {c.etiqueta_nombre}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  {new Date(c.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{c.comentario}</p>
            </div>
            {/* Eliminar */}
            {(c.usuario_id === usuario?.id || usuario?.rol === 'admin') && (
              <button
                onClick={() => eliminar(c.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 rounded-lg text-gray-300 hover:text-red-500 transition-all flex-shrink-0 self-start mt-0.5"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Formulario nuevo comentario */}
      <form onSubmit={enviar} className="border-t border-gray-100 pt-4">
        {/* Selector de etiqueta */}
        {etiquetas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="text-xs text-gray-400 self-center">Etiqueta:</span>
            {etiquetas.map(et => {
              const sel = etiquetaSel === et.id;
              return (
                <button
                  key={et.id}
                  type="button"
                  onClick={() => setEtiquetaSel(sel ? null : et.id)}
                  style={sel ? { backgroundColor: et.color, borderColor: et.color } : {}}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-all ${
                    sel ? 'text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {et.nombre}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(e as any); } }}
            placeholder="Escribí un comentario... (Enter para enviar)"
            rows={2}
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
          />
          <button
            type="submit"
            disabled={enviando || !texto.trim()}
            className="self-end px-3 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white rounded-xl transition-colors"
          >
            {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Página detalle ────────────────────────────────────────────────────────────
function DetalleNegocioContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seccion, setSeccion] = useState<'resumen' | 'comentarios'>('resumen');
  const [editMonto, setEditMonto] = useState(false);
  const [montoTemp, setMontoTemp] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [negRes, etRes] = await Promise.all([
        fetch(`/api/negocios/${id}`),
        fetch('/api/etiquetas'),
      ]);
      const negData = await negRes.json();
      const etData = await etRes.json();
      if (!negRes.ok) throw new Error(negData.error || 'No encontrado');
      setNegocio(negData.negocio);
      setMontoTemp(String(negData.negocio.monto_ofertado || ''));
      if (etData.success) setEtiquetas(etData.etiquetas || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardarMonto = async () => {
    const monto = parseInt(montoTemp.replace(/\D/g, '')) || 0;
    await fetch(`/api/negocios/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monto_ofertado: monto }),
    });
    setNegocio(prev => prev ? { ...prev, monto_ofertado: monto } : prev);
    setEditMonto(false);
  };

  if (loading) {
    return (
      <AppLayout breadcrumb={[{ label: 'Negocios', href: '/negocios' }, { label: '...' }]}>
        <div className="p-8 space-y-4 animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
        </div>
      </AppLayout>
    );
  }

  if (error || !negocio) {
    return (
      <AppLayout breadcrumb={[{ label: 'Negocios', href: '/negocios' }, { label: 'Error' }]}>
        <div className="p-8">
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            <AlertCircle size={16} /> {error || 'No encontrado'}
          </div>
        </div>
      </AppLayout>
    );
  }

  const tipo = negocio.licitacion_codigo?.match(/-(LE|LP|LQ|CO|L1)\d/)?.[1] || '';
  const TIPO_BG: Record<string, string> = {
    'LE': 'bg-red-500', 'LP': 'bg-blue-500', 'LQ': 'bg-purple-500',
    'CO': 'bg-green-500', 'L1': 'bg-orange-500',
  };

  return (
    <AppLayout breadcrumb={[
      { label: 'Negocios', href: '/negocios' },
      { label: negocio.licitacion_codigo },
    ]}>
      <div className="flex h-full">
        {/* Panel izquierdo: sub-navegación */}
        <aside className="hidden lg:flex flex-col w-52 border-r border-gray-100 bg-white flex-shrink-0">
          {/* Volver */}
          <div className="px-3 py-3 border-b border-gray-100">
            <Link href="/negocios" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <ArrowLeft size={15} /> Volver
            </Link>
          </div>
          {/* Secciones negocio */}
          <nav className="px-3 py-4 space-y-0.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 pb-1">El negocio</p>
            {([
              { key: 'resumen', label: 'Resumen' },
              { key: 'comentarios', label: 'Comentarios' },
            ] as const).map(s => (
              <button
                key={s.key}
                onClick={() => setSeccion(s.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  seccion === s.key
                    ? 'bg-red-50 text-red-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenido principal */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
            {/* Header del negocio */}
            <div className="mb-6">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-xs font-mono text-gray-500 font-semibold">
                      ▶ ID {negocio.licitacion_codigo}
                    </span>
                    {tipo && (
                      <span className={`${TIPO_BG[tipo] || 'bg-gray-400'} text-white text-xs px-2 py-0.5 rounded font-bold`}>
                        {tipo}
                      </span>
                    )}
                    {negocio.licitacion_estado && (
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                        negocio.licitacion_estado === 'Publicada'
                          ? 'bg-green-100 text-green-700 border border-green-200'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {negocio.licitacion_estado}
                      </span>
                    )}
                  </div>
                  <h1 className="text-xl font-bold text-gray-900 leading-snug">
                    {negocio.licitacion_nombre || 'Sin nombre'}
                  </h1>
                  <p className="text-sm text-gray-500 mt-1 uppercase tracking-wide">
                    {negocio.licitacion_organismo}
                  </p>
                </div>
                {/* Acciones */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <a
                    href={`https://www.mercadopublico.cl/Licitacion/Detalle/${negocio.licitacion_codigo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <ExternalLink size={14} /> Ver en MP
                  </a>
                  <Link
                    href={`/licitacion/${encodeURIComponent(negocio.licitacion_codigo)}`}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    Ver detalle completo
                  </Link>
                </div>
              </div>

              {/* Etiquetas */}
              {negocio.etiquetas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {negocio.etiquetas.map(et => (
                    <span
                      key={et.id}
                      style={{ backgroundColor: et.color + '15', color: et.color, borderColor: et.color + '40' }}
                      className="text-xs px-2.5 py-0.5 rounded-full font-semibold border"
                    >
                      {et.nombre}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Mobile nav tabs */}
            <div className="flex gap-1 mb-5 lg:hidden bg-gray-100 p-1 rounded-xl">
              {([
                { key: 'resumen', label: 'Resumen' },
                { key: 'comentarios', label: 'Comentarios' },
              ] as const).map(s => (
                <button
                  key={s.key}
                  onClick={() => setSeccion(s.key)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    seccion === s.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* ── Sección Resumen ── */}
            {seccion === 'resumen' && (
              <div className="space-y-5">
                {/* KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white border border-gray-100 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-1">Monto disponible</p>
                    <p className="text-base font-bold text-gray-900">{formatMonto(negocio.licitacion_monto)}</p>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-gray-400">Monto ofertado</p>
                      <button
                        onClick={() => setEditMonto(!editMonto)}
                        className="text-gray-300 hover:text-blue-500 transition-colors"
                      >
                        <Edit3 size={11} />
                      </button>
                    </div>
                    {editMonto ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={montoTemp}
                          onChange={e => setMontoTemp(e.target.value)}
                          className="w-full text-sm border-b border-blue-400 outline-none py-0.5"
                          autoFocus
                        />
                        <button onClick={guardarMonto} className="text-green-500"><Check size={13} /></button>
                        <button onClick={() => setEditMonto(false)} className="text-gray-400"><X size={13} /></button>
                      </div>
                    ) : (
                      <p className="text-base font-bold text-gray-700">{formatMonto(negocio.monto_ofertado || null)}</p>
                    )}
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-1">Fecha de cierre</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {negocio.licitacion_cierre
                        ? new Date(negocio.licitacion_cierre).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </p>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-1">Responsable</p>
                    <p className="text-sm font-semibold text-gray-800">{negocio.usuario_nombre || negocio.usuario_email}</p>
                    {isAdmin && negocio.admin_nombre && (
                      <p className="text-xs text-gray-400">Asignado por {negocio.admin_nombre}</p>
                    )}
                  </div>
                </div>

                {/* Descripción */}
                {negocio.licitacion_descripcion && (
                  <div className="bg-white border border-gray-100 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <FileText size={15} className="text-gray-400" /> Descripción
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                      {negocio.licitacion_descripcion}
                    </p>
                  </div>
                )}

                {/* Info adicional */}
                <div className="bg-white border border-gray-100 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Información general</h3>
                  <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                    {negocio.licitacion_organismo && (
                      <div className="flex items-start gap-2">
                        <Building2 size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <dt className="text-xs text-gray-400">Organismo</dt>
                          <dd className="text-gray-700 font-medium">{negocio.licitacion_organismo}</dd>
                        </div>
                      </div>
                    )}
                    {negocio.licitacion_region && (
                      <div className="flex items-start gap-2">
                        <MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <dt className="text-xs text-gray-400">Región</dt>
                          <dd className="text-gray-700 font-medium">{negocio.licitacion_region}</dd>
                        </div>
                      </div>
                    )}
                    {negocio.licitacion_tipo && (
                      <div className="flex items-start gap-2">
                        <Tag size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <dt className="text-xs text-gray-400">Tipo</dt>
                          <dd className="text-gray-700 font-medium">{negocio.licitacion_tipo}</dd>
                        </div>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <Calendar size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <dt className="text-xs text-gray-400">Asignado el</dt>
                        <dd className="text-gray-700 font-medium">
                          {new Date(negocio.created_at).toLocaleDateString('es-CL')}
                        </dd>
                      </div>
                    </div>
                  </dl>
                </div>
              </div>
            )}

            {/* ── Sección Comentarios ── */}
            {seccion === 'comentarios' && (
              <div className="bg-white border border-gray-100 rounded-xl p-5">
                <SeccionComentarios negocioId={negocio.id} etiquetas={etiquetas} />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

export default function DetalleNegocioPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-red-500" />
      </div>
    }>
      <DetalleNegocioContent />
    </Suspense>
  );
}