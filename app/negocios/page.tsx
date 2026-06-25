'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  Briefcase, Plus, Search, ExternalLink, Trash2,
  Calendar, DollarSign, Building2, AlertCircle, Loader2,
  ChevronDown, X, RefreshCw, Users, List, LayoutGrid,
  CalendarDays, ChevronLeft, ChevronRight, ArrowRight, FileText,
} from 'lucide-react';
import { Modal, Badge, Group, Text, ActionIcon, Paper, ScrollArea, Stack, Button, Progress, SimpleGrid } from '@mantine/core';
import dayjs from 'dayjs';
import { getEstadoPipeline } from '@/app/lib/pipeline';
import { extractTipoFromCodigo, getTipoLicitacion, TIPO_COLOR_CLASS, TIPOS_LICITACION } from '@/app/lib/tipos-licitacion';

interface Etiqueta { id: number; nombre: string; color: string; }

// ── Color e iniciales por usuario (consistente entre chips de carga y tarjetas) ──
const USER_COLORS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#3b82f6', '#a855f7', '#f97316', '#84cc16'];
function colorUsuario(seed: string | number | null | undefined): string {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}
function inicialesUsuario(nombre?: string | null, email?: string | null): string {
  const base = (nombre || email || '?').trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

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
  tiene_documentos?: number;
  viabilidad_semaforo?: string | null;
  viabilidad_score?: number | null;
}

interface Usuario { id: number; nombre: string; email: string; }
interface Carga { usuario_id: number; nombre?: string; email?: string; total: number; porTipo?: Record<string, number>; }

// Semáforo de viabilidad (colores/labels compactos para las tarjetas).
const SEMAFORO: Record<string, { label: string; color: string; bg: string; text: string }> = {
  VERDE:     { label: 'Viable',     color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  AMARILLO:  { label: 'Media-alta', color: '#eab308', bg: 'bg-yellow-50',  text: 'text-yellow-700' },
  NARANJA:   { label: 'Media',      color: '#f97316', bg: 'bg-orange-50',  text: 'text-orange-700' },
  ROJO:      { label: 'Baja',       color: '#ef4444', bg: 'bg-red-50',     text: 'text-red-700' },
  ROJO_DURO: { label: 'Descartar',  color: '#b91c1c', bg: 'bg-red-100',    text: 'text-red-800' },
};

// Todos los tipos ordenados por uso típico (públicos primero)
const TIPOS_FILTRO = TIPOS_LICITACION.map(t => t.codigo);

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
            <Plus size={20} className="text-indigo-600" /> Asignar licitación
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-gray-400">
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
                className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
              <button
                onClick={buscarLicitacion}
                disabled={buscando}
                className="px-4 py-2.5 bg-slate-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
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
              <p className="text-indigo-600 font-medium mt-1">
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
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
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
                      sel ? 'text-white' : 'bg-white border-slate-200 text-gray-600 hover:border-gray-400'
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
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !form.codigo || !form.asignado_a}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-300 transition-colors"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : null}
            Asignar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta compacta de negocio (vista agrupada por categoría) ────────────────
function NegocioCard({ neg, isAdmin, onEliminar }: {
  neg: Negocio; isAdmin: boolean; onEliminar: (id: number) => void;
}) {
  const tipo  = extractTipoFromCodigo(neg.licitacion_codigo || '');
  const tipoBg = TIPO_COLOR_CLASS[tipo] || 'bg-gray-400';
  const dias = diasRestantes(neg.licitacion_cierre);
  const diasCls = dias === 'Vencida' ? 'text-gray-400'
    : dias.replace('d', '') !== '' && parseInt(dias) <= 3 ? 'text-red-500 font-semibold'
    : parseInt(dias) <= 7 ? 'text-orange-500' : 'text-gray-500';
  const col = colorUsuario(neg.usuario_email || neg.usuario_nombre);
  return (
    <Link
      href={`/negocios/${neg.id}`}
      style={{ borderLeftColor: col, borderLeftWidth: 3 }}
      className="block bg-white rounded-xl border border-slate-200 p-3 hover:border-indigo-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-mono text-gray-500 font-semibold">{neg.licitacion_codigo}</p>
        <div className="flex items-center gap-1" onClick={e => e.preventDefault()}>
          {tipo && <span className={`${tipoBg} text-white text-[10px] px-1.5 py-0.5 rounded font-bold`}>{tipo}</span>}
          {isAdmin && (
            <button onClick={e => { e.preventDefault(); onEliminar(neg.id); }}
              className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 transition-colors">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      <p className="text-[13px] text-gray-800 font-medium line-clamp-2 mt-1 group-hover:text-indigo-600 transition-colors">
        {neg.licitacion_nombre || 'Sin nombre'}
      </p>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <PipelineBadge estadoId={neg.estado_pipeline} />
        {neg.viabilidad_semaforo && SEMAFORO[neg.viabilidad_semaforo] && (
          <span
            style={{ borderColor: SEMAFORO[neg.viabilidad_semaforo].color + '40' }}
            className={`inline-flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full border ${SEMAFORO[neg.viabilidad_semaforo].bg} ${SEMAFORO[neg.viabilidad_semaforo].text}`}
            title={`Viabilidad: ${SEMAFORO[neg.viabilidad_semaforo].label}`}
          >
            <span style={{ background: SEMAFORO[neg.viabilidad_semaforo].color }} className="w-1.5 h-1.5 rounded-full" />
            {SEMAFORO[neg.viabilidad_semaforo].label}{neg.viabilidad_score != null ? ` ${neg.viabilidad_score}` : ''}
          </span>
        )}
        {neg.tiene_documentos ? (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100" title="Tiene documentos descargados">
            <FileText size={9} /> Docs
          </span>
        ) : null}
        {isAdmin && (
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 font-medium">
            <span style={{ background: col }} className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
              {inicialesUsuario(neg.usuario_nombre, neg.usuario_email)}
            </span>
            {neg.usuario_nombre || neg.usuario_email}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
        <span className="text-[12px] text-gray-700 font-medium">{formatMonto(neg.licitacion_monto)}</span>
        {dias && <span className={`text-[11px] ${diasCls}`}>{dias}</span>}
      </div>
    </Link>
  );
}

// ── Vista calendario (por fecha de cierre) ───────────────────────────────────────
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function VistaCalendario({ negocios, onAbrirDia }: { negocios: Negocio[]; onAbrirDia: (key: string) => void }) {
  const [mes, setMes] = useState(() => dayjs().startOf('month'));

  const porDia = useMemo(() => {
    const m = new Map<string, Negocio[]>();
    for (const n of negocios) {
      if (!n.licitacion_cierre) continue;
      const k = dayjs(n.licitacion_cierre).format('YYYY-MM-DD');
      (m.get(k) || m.set(k, []).get(k)!).push(n);
    }
    return m;
  }, [negocios]);

  const inicio = mes.startOf('month');
  const offset = (inicio.day() + 6) % 7; // lunes = 0
  const gridStart = inicio.subtract(offset, 'day');
  const dias = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const hoy = dayjs().format('YYYY-MM-DD');

  return (
    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between" mb="md">
        <ActionIcon variant="subtle" color="gray" onClick={() => setMes(m => m.subtract(1, 'month'))} aria-label="Mes anterior"><ChevronLeft size={18} /></ActionIcon>
        <Text fw={700} fz="lg">{MESES[mes.month()]} {mes.year()}</Text>
        <ActionIcon variant="subtle" color="gray" onClick={() => setMes(m => m.add(1, 'month'))} aria-label="Mes siguiente"><ChevronRight size={18} /></ActionIcon>
      </Group>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {SEMANA.map(d => <div key={d} className="text-center text-[11px] font-bold text-slate-400 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map(d => {
          const k = d.format('YYYY-MM-DD');
          const items = porDia.get(k) || [];
          const fueraMes = d.month() !== mes.month();
          const esHoy = k === hoy;
          return (
            <button key={k} disabled={items.length === 0} onClick={() => items.length && onAbrirDia(k)}
              className={`min-h-[70px] rounded-lg border p-1.5 text-left align-top transition-colors ${fueraMes ? 'bg-slate-50/40 border-transparent' : 'border-slate-100'} ${items.length ? 'hover:border-indigo-300 hover:bg-indigo-50/50 cursor-pointer' : 'cursor-default'}`}>
              <div className="flex items-center justify-between">
                <span className={esHoy ? 'bg-indigo-600 text-white rounded-full w-5 h-5 inline-flex items-center justify-center text-[11px] font-bold' : `text-[12px] ${fueraMes ? 'text-slate-300' : 'text-slate-600'}`}>{d.date()}</span>
                {items.length > 0 && <span className="text-[10px] font-bold text-indigo-600 tabular-nums">{items.length}</span>}
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {items.slice(0, 6).map((n, i) => (
                  <span key={i} title={n.usuario_nombre || n.usuario_email} style={{ background: colorUsuario(n.usuario_email || n.usuario_nombre) }} className="w-2 h-2 rounded-full" />
                ))}
                {items.length > 6 && <span className="text-[8px] text-slate-400 leading-none self-center">+{items.length - 6}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </Paper>
  );
}

// ── Tarjeta de carga de trabajo por perfil (con mini-gráfico por tipo) ────────────
function CargaCard({ c, nombre, email, activo, isAdmin, onClick }: {
  c: Carga; nombre: string | null; email: string | null; activo: boolean; isAdmin: boolean; onClick: () => void;
}) {
  const col = colorUsuario(email || c.usuario_id);
  const tipos = Object.entries(c.porTipo || {}).sort((a, b) => b[1] - a[1]);
  return (
    <Paper
      withBorder radius="md" p="sm"
      onClick={isAdmin ? onClick : undefined}
      style={{ borderColor: activo ? col : undefined, borderWidth: activo ? 2 : 1, cursor: isAdmin ? 'pointer' : 'default' }}
      className={isAdmin ? 'transition-shadow hover:shadow-sm' : ''}
    >
      <Group gap={8} wrap="nowrap" justify="space-between" mb={tipos.length ? 8 : 0}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <span style={{ background: col }} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white text-[11px] font-bold flex-shrink-0">
            {inicialesUsuario(nombre, email)}
          </span>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} lineClamp={1}>{nombre || email || 'Tú'}</Text>
            <Text size="xs" c="dimmed">licitación{c.total !== 1 ? 'es' : ''}</Text>
          </div>
        </Group>
        <Text fz={26} fw={800} lh={1} style={{ color: col }} className="tabular-nums flex-shrink-0">{c.total}</Text>
      </Group>
      {tipos.length > 0 && (
        <>
          <Progress.Root size="md" radius="sm">
            {tipos.map(([t, n]) => (
              <Progress.Section key={t} value={(n / c.total) * 100} color={getTipoLicitacion(t)?.color || '#94a3b8'} />
            ))}
          </Progress.Root>
          <Group gap={10} mt={6}>
            {tipos.slice(0, 6).map(([t, n]) => (
              <span key={t} className="inline-flex items-center gap-1 text-[10.5px] text-gray-600">
                <span style={{ background: getTipoLicitacion(t)?.color || '#94a3b8' }} className="w-2 h-2 rounded-sm flex-shrink-0" />
                <strong>{t}</strong> {n}
              </span>
            ))}
          </Group>
        </>
      )}
    </Paper>
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
  const [vista, setVista]           = useState<'lista' | 'categoria' | 'calendario'>('categoria');
  const [carga, setCarga]           = useState<Carga[]>([]);
  const [diaSel, setDiaSel]         = useState<string | null>(null);

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
      setCarga(negData.carga || []);
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
    const tipoDelCodigo = extractTipoFromCodigo(n.licitacion_codigo || '');
    const matchTipo = filtroTipo === '' || tipoDelCodigo === filtroTipo;
    return matchSearch && matchEt && matchTipo;
  });

  // Tipos presentes (para el select de filtro), en orden canónico.
  const tiposPresentes = useMemo(() => {
    const s = new Set<string>();
    for (const n of negocios) { const t = extractTipoFromCodigo(n.licitacion_codigo || ''); if (t) s.add(t); }
    return TIPOS_FILTRO.filter(t => s.has(t));
  }, [negocios]);

  // Agrupar por categoría (línea de negocio = primera etiqueta del negocio).
  // Cada categoría es una "cajita"; los negocios sin etiqueta van a "Sin categoría".
  const gruposCategoria = (() => {
    const porCat = new Map<number, { nombre: string; color: string; items: Negocio[] }>();
    const sinCat: Negocio[] = [];
    for (const n of negociosFiltrados) {
      const cat = n.etiquetas?.[0];
      if (!cat) { sinCat.push(n); continue; }
      if (!porCat.has(cat.id)) porCat.set(cat.id, { nombre: cat.nombre, color: cat.color, items: [] });
      porCat.get(cat.id)!.items.push(n);
    }
    const grupos = Array.from(porCat.entries())
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (sinCat.length > 0) grupos.push({ id: 0, nombre: 'Sin categoría', color: '#94a3b8', items: sinCat });
    return grupos;
  })();

  const ESTADO_COLOR: Record<string, string> = {
    'Publicada': 'bg-green-100 text-green-700',
    'Adjudicada': 'bg-blue-100 text-blue-700',
    'Cerrada': 'bg-slate-100 text-gray-500',
  };

  // Licitaciones que cierran el día seleccionado (para el modal del calendario).
  const itemsDia = diaSel
    ? negociosFiltrados.filter(n => n.licitacion_cierre && dayjs(n.licitacion_cierre).format('YYYY-MM-DD') === diaSel)
    : [];

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Negocios' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Briefcase size={24} className="text-indigo-600" /> Negocios
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Cargando...' : `${negociosFiltrados.length} licitacion${negociosFiltrados.length !== 1 ? 'es' : ''} asignada${negociosFiltrados.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={cargar} className="p-2 hover:bg-slate-100 rounded-lg text-gray-500">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <Plus size={15} /> Asignar licitación
              </button>
            )}
          </div>
        </div>

        {/* Carga de trabajo por perfil (recuadros con mini-gráfico por tipo) */}
        {carga.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                {isAdmin ? 'Carga de trabajo por perfil' : 'Tu carga de trabajo'}
              </span>
              {isAdmin && filtroUsuario && (
                <button onClick={() => setFiltroUsuario('')} className="text-xs text-indigo-600 hover:underline font-semibold">Ver todos</button>
              )}
            </div>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="sm">
              {carga.map(c => {
                const nombre = c.nombre || (c.usuario_id === usuario?.id ? usuario?.nombre : null) || null;
                const email  = c.email  || (c.usuario_id === usuario?.id ? usuario?.email  : null) || null;
                return (
                  <CargaCard
                    key={c.usuario_id} c={c} nombre={nombre} email={email}
                    activo={String(c.usuario_id) === filtroUsuario} isAdmin={isAdmin}
                    onClick={() => setFiltroUsuario(String(c.usuario_id) === filtroUsuario ? '' : String(c.usuario_id))}
                  />
                );
              })}
            </SimpleGrid>
          </div>
        )}

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
                className="pl-8 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-52"
              />
            </div>

            {isAdmin && usuarios.length > 0 && (
              <select
                value={filtroUsuario}
                onChange={e => setFiltroUsuario(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
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
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="">Todas las líneas</option>
                {etiquetas.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            )}

            <select
              value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">Todos los tipos</option>
              {tiposPresentes.map(t => (
                <option key={t} value={t}>{t} · {getTipoLicitacion(t)?.label || t}</option>
              ))}
            </select>

            {/* Toggle de vista: por categoría (cajitas) / lista */}
            <div className="ml-auto flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setVista('categoria')}
                title="Vista por categoría"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  vista === 'categoria' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <LayoutGrid size={13} /> Categorías
              </button>
              <button
                onClick={() => setVista('lista')}
                title="Vista lista"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  vista === 'lista' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <List size={13} /> Lista
              </button>
              <button
                onClick={() => setVista('calendario')}
                title="Vista calendario (por fecha de cierre)"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  vista === 'calendario' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <CalendarDays size={13} /> Calendario
              </button>
            </div>
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
            <div className="text-center py-20 bg-white rounded-xl border border-slate-100">
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
          ) : vista === 'calendario' ? (
            /* ── Vista calendario (por fecha de cierre) ── */
            <VistaCalendario negocios={negociosFiltrados} onAbrirDia={setDiaSel} />
          ) : vista === 'categoria' ? (
            /* ── Vista por categoría (cajitas) ── */
            <div className="space-y-5">
              {gruposCategoria.map(grupo => (
                <div key={grupo.id} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span style={{ backgroundColor: grupo.color }} className="w-3 h-3 rounded-full flex-shrink-0" />
                    <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: grupo.color }}>{grupo.nombre}</h3>
                    <span className="text-xs text-gray-400 font-medium">{grupo.items.length}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {grupo.items.map(neg => (
                      <NegocioCard key={neg.id} neg={neg} isAdmin={isAdmin} onEliminar={eliminar} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              {/* Tabla header */}
              <div className="hidden md:grid grid-cols-[1fr_2.5fr_1.5fr_1fr_1.2fr_1fr_auto] gap-3 px-4 py-2.5 bg-slate-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
                  const estadoCls = ESTADO_COLOR[neg.licitacion_estado || ''] || 'bg-slate-100 text-gray-500';
                  const tipo  = extractTipoFromCodigo(neg.licitacion_codigo || '');
                  const tipoBg = TIPO_COLOR_CLASS[tipo] || 'bg-gray-400';
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
                        <p className="text-sm text-gray-800 line-clamp-1 font-medium group-hover:text-indigo-600 transition-colors">
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
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-gray-500">
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
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-4 py-4 border-b border-gray-50 animate-pulse flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-24" />
                <div className="h-4 bg-slate-100 rounded flex-1" />
                <div className="h-4 bg-slate-100 rounded w-32" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal del día del calendario: licitaciones que cierran ese día */}
      <Modal
        opened={!!diaSel}
        onClose={() => setDiaSel(null)}
        size="lg"
        radius="md"
        scrollAreaComponent={ScrollArea.Autosize}
        title={
          <Text fw={700}>
            Cierres del {diaSel ? dayjs(diaSel).format('DD/MM/YYYY') : ''}
            <Text span c="dimmed" fw={400} size="sm"> · {itemsDia.length} licitación{itemsDia.length !== 1 ? 'es' : ''}</Text>
          </Text>
        }
      >
        <Stack gap="sm">
          {itemsDia.map(neg => {
            const col = colorUsuario(neg.usuario_email || neg.usuario_nombre);
            const tipo = extractTipoFromCodigo(neg.licitacion_codigo || '');
            return (
              <Paper key={neg.id} withBorder radius="md" p="sm" style={{ borderLeft: `3px solid ${col}` }}>
                <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
                  <div style={{ minWidth: 0 }}>
                    <Group gap={6} mb={3}>
                      <Text size="xs" ff="monospace" c="dimmed">{neg.licitacion_codigo}</Text>
                      {tipo && <Badge size="xs" variant="filled" color="gray">{tipo}</Badge>}
                      <PipelineBadge estadoId={neg.estado_pipeline} />
                    </Group>
                    <Text size="sm" fw={600} lineClamp={2}>{neg.licitacion_nombre || 'Sin nombre'}</Text>
                    {neg.licitacion_organismo && <Text size="xs" c="dimmed" lineClamp={1} mt={2}>{neg.licitacion_organismo}</Text>}
                    <Group gap={12} mt={5}>
                      <Text size="xs" fw={700} c="teal.7">{formatMonto(neg.licitacion_monto)}</Text>
                      {isAdmin && (
                        <Group gap={5}>
                          <span style={{ background: col }} className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
                            {inicialesUsuario(neg.usuario_nombre, neg.usuario_email)}
                          </span>
                          <Text size="xs" c="dimmed">{neg.usuario_nombre || neg.usuario_email}</Text>
                        </Group>
                      )}
                    </Group>
                  </div>
                  <Button component={Link} href={`/negocios/${neg.id}`} size="xs" variant="light"
                    rightSection={<ArrowRight size={13} />} onClick={() => setDiaSel(null)} className="flex-shrink-0">
                    Entrar
                  </Button>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      </Modal>

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

