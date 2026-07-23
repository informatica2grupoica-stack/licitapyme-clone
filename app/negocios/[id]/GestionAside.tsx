// app/negocios/[id]/GestionAside.tsx
// Columna derecha de gestión de un negocio (Estado/pipeline, Postular, Descartar, Productos a
// costeo, Responsable/Reasignar, Historial, Quitar de Negocios). Componente COMPARTIDO entre
// /negocios/[id] y /licitacion/[codigo]: es la MISMA columna en ambas vistas — así nunca se
// desalinean (el problema que teníamos con dos menús separados, ahora con dos columnas separadas).
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Check, PlayCircle, Ban, ShoppingCart, Loader2,
  UserPlus, FolderOpen, History, ExternalLink, Trash2, Send, Building2,
  DollarSign as DollarSignIcon,
} from 'lucide-react';
import { Select } from '@/app/components/ui/Select';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { ESTADOS_PIPELINE, getEstadoPipeline, normalizarEstado } from '@/app/lib/pipeline';
import { semaforoRevision } from '@/app/lib/asignacion';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { motivosParaEstado, nivelPorEstado, NIVEL_LABEL, componerMotivo } from '@/app/lib/motivos-descarte';

function fmt(n: number | null | undefined): string {
  if (!n) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

export function fmtFecha(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

function avatarGrad(id: number): string {
  const grads = ['from-blue-500 to-indigo-600', 'from-emerald-500 to-teal-600', 'from-purple-500 to-pink-600', 'from-orange-500 to-amber-600', 'from-cyan-500 to-sky-600'];
  return grads[id % grads.length];
}

function iniciales(nombre: string | null, email: string): string {
  if (nombre) return nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email[0].toUpperCase();
}

// ── Mini-historial de la licitación (de la tabla actividad_usuario) ────────────
// Exportado: la vista SIN asignar de /licitacion/[codigo] también lo usa (el historial no
// depende de que exista un negocio — es por código de licitación).
export interface EventoLic {
  id: number; tipo: string; mensaje: string | null;
  actor_id: number | null; actor_nombre: string | null; actor_email: string | null;
  created_at: string;
}
const EVENTO_META: Record<string, { label: string; color: string }> = {
  asignacion:            { label: 'Asignación',        color: '#059669' },
  cambio_pipeline:       { label: 'Cambio de estado',  color: '#0891b2' },
  cambio_etiqueta:       { label: 'Líneas de negocio', color: '#7c3aed' },
  comentario_negocio:    { label: 'Comentario',        color: '#2563eb' },
  comentario_licitacion: { label: 'Comentario',        color: '#2563eb' },
  ver_licitacion:        { label: 'Vio la licitación', color: '#64748b' },
  ver_seccion:           { label: 'Revisó',            color: '#64748b' },
  ver_documento:         { label: 'Vio documento',     color: '#64748b' },
  ver_cita:              { label: 'Verificó fuente',   color: '#7c3aed' },
  favorito:              { label: 'Favorito',          color: '#ca8a04' },
  viabilidad:            { label: 'Viabilidad IA',     color: '#d97706' },
  costeo:                { label: 'Costeo',             color: '#0d9488' },
  documento:             { label: 'Documento',         color: '#0d9488' },
  estado_mp:             { label: 'Estado en Mercado Público', color: '#dc2626' },
};
function eventoMeta(tipo: string) {
  return EVENTO_META[tipo] || { label: (tipo || 'Evento').replace(/_/g, ' '), color: '#64748b' };
}
function tiempoRel(fecha: string): string {
  const diff = Date.now() - new Date(fecha).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(fecha).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short' });
}
function fechaHoraChile(fecha: string): string {
  return new Date(fecha).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ACCIONES_VISTA = new Set(['ver_licitacion', 'ver_seccion', 'ver_documento', 'ver_cita']);
interface EventoAgrupado extends EventoLic { veces: number; primera: string }

function agruparEventos(eventos: EventoLic[]): EventoAgrupado[] {
  const porClave = new Map<string, EventoAgrupado>();
  const sueltos: EventoAgrupado[] = [];
  for (const e of eventos) {
    if (!ACCIONES_VISTA.has(e.tipo)) { sueltos.push({ ...e, veces: 1, primera: e.created_at }); continue; }
    const clave = `${e.actor_id}|${e.tipo}|${e.mensaje}`;
    const prev = porClave.get(clave);
    if (!prev) { porClave.set(clave, { ...e, veces: 1, primera: e.created_at }); continue; }
    prev.veces++;
    if (new Date(e.created_at) > new Date(prev.created_at)) { prev.created_at = e.created_at; prev.id = e.id; }
    if (new Date(e.created_at) < new Date(prev.primera)) prev.primera = e.created_at;
  }
  return [...sueltos, ...porClave.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function Timeline({ orden }: { orden: EventoAgrupado[] }) {
  return (
    <div className="space-y-0">
      {orden.map((e, i) => {
        const m = eventoMeta(e.tipo);
        const quien = e.actor_nombre || e.actor_email || 'Sistema';
        const col = colorUsuario(e.actor_email ?? e.actor_id ?? quien);
        const ultimo = i === orden.length - 1;
        const titulo = e.veces > 1
          ? `${e.veces} veces · primera: ${fechaHoraChile(e.primera)} · última: ${fechaHoraChile(e.created_at)}`
          : fechaHoraChile(e.created_at);
        return (
          <div key={`${e.tipo}-${e.id}`} className="flex gap-2.5">
            <div className="flex flex-col items-center flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full mt-1.5" style={{ background: m.color }} />
              {!ultimo && <span className="w-px flex-1 bg-zinc-200 my-0.5" />}
            </div>
            <div className="pb-3 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap" title={titulo}>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: m.color, background: m.color + '18' }}>{m.label}</span>
                <span className="text-[10px] text-zinc-400">{fechaHoraChile(e.created_at)}</span>
                <span className="text-[10px] text-zinc-400">· {tiempoRel(e.created_at)}</span>
                {e.veces > 1 && (
                  <span className="text-[9.5px] font-bold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-full">{e.veces} veces</span>
                )}
              </div>
              <p className="text-[11.5px] text-zinc-600 mt-0.5 leading-snug">{e.mensaje || m.label}</p>
              <span className="inline-flex items-center gap-1 mt-1 text-[10.5px] font-semibold" style={{ color: col }}>
                <span className="w-3.5 h-3.5 rounded-full text-white text-[7px] font-bold flex items-center justify-center" style={{ background: col }}>
                  {inicialesUsuario(quien, null)}
                </span>
                {quien}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HistorialLicitacion({ eventos }: { eventos: EventoLic[] }) {
  const [expandido, setExpandido] = useState(false);
  if (eventos.length === 0) return <p className="text-[11px] text-zinc-400">Aún no hay actividad registrada.</p>;
  const orden = agruparEventos(eventos);
  return (
    <div>
      <div className={`pr-1 ${expandido ? '' : 'max-h-[300px] overflow-y-auto scrollbar-thin'}`}>
        <Timeline orden={orden} />
      </div>
      {orden.length > 6 && (
        <button onClick={() => setExpandido(e => !e)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
          {expandido ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expandido ? 'Compactar historial' : `Ver todo (${orden.length} eventos)`}
        </button>
      )}
    </div>
  );
}

// ── Pipeline Selector ─────────────────────────────────────────────────────────
function PipelineSelector({ current, onChange }: { current: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const estado = getEstadoPipeline(current);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border border-zinc-200 rounded-xl bg-white hover:border-zinc-300 transition-colors">
        {estado ? <span className="text-[13px] font-bold" style={{ color: estado.color }}>{estado.label}</span>
          : <span className="text-[13px] text-zinc-400">Sin etapa</span>}
        <ChevronDown size={13} className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 overflow-hidden scale-in max-h-72 overflow-y-auto">
          {ESTADOS_PIPELINE.map(est => (
            <button key={est.id} onClick={() => { onChange(est.id); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-50 transition-colors ${current === est.id ? 'bg-zinc-50' : ''}`}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: est.color }} />
              <span className="text-[13px] font-semibold" style={{ color: est.color }}>{est.label}</span>
              {current === est.id && <Check size={12} className="ml-auto text-zinc-400" />}
            </button>
          ))}
          <button onClick={() => { onChange(''); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-zinc-50 border-t border-zinc-100 text-[13px] text-zinc-400">
            Sin etiqueta
          </button>
        </div>
      )}
    </div>
  );
}

export interface NegocioGestion {
  id: number;
  licitacion_codigo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  estado_pipeline: string | null;
  monto_ofertado: number;
  empresa_id: number | null;
  empresa_nombre: string | null;
  asignado_a: number;
  usuario_nombre: string;
  usuario_email: string;
  etiquetas: { id: number; nombre: string; color: string }[];
  created_at: string;
  updated_at: string;
}

export function GestionAside({
  negocio, onNegocioChange, viabIA, isAdmin, fechaPublicacion, documentosCount, mpUrl,
  onDocumentosRefrescar, onEliminado, onIrAViabilidad,
}: {
  negocio: NegocioGestion;
  onNegocioChange: (patch: Partial<NegocioGestion>) => void;
  viabIA: any;
  isAdmin: boolean;
  fechaPublicacion: string | null | undefined;
  documentosCount: number;
  mpUrl: string;
  onDocumentosRefrescar?: () => void;
  onEliminado: () => void;
  onIrAViabilidad?: () => void;
}) {
  const toast = useToast();
  const confirmar = useConfirm();

  const [descarteOpen, setDescarteOpen] = useState(false);
  const [motivoSel, setMotivoSel] = useState('');
  const [motivoDescarte, setMotivoDescarte] = useState('');
  const [postularOpen, setPostularOpen] = useState(false);
  const [montoPostular, setMontoPostular] = useState('');
  const [empresaPostular, setEmpresaPostular] = useState('');
  const [empresas, setEmpresas] = useState<{ id: number; razon_social: string }[]>([]);
  const [usuariosLista, setUsuariosLista] = useState<{ id: number; nombre: string | null; email: string }[]>([]);
  const [mostrarReasignar, setMostrarReasignar] = useState(false);
  const [historial, setHistorial] = useState<EventoLic[]>([]);
  const [productosCosteoLoading, setProductosCosteoLoading] = useState(false);

  useEffect(() => {
    if (!descarteOpen && !postularOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDescarteOpen(false); setPostularOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [descarteOpen, postularOpen]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/usuarios').then(r => r.json()).then(d => { if (d.success) setUsuariosLista(d.usuarios || []); }).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    fetch('/api/empresas').then(r => r.json()).then(d => { if (d.success) setEmpresas(d.empresas || []); }).catch(() => {});
  }, []);

  const fetchHistorial = useCallback(async () => {
    try {
      const r = await fetch(`/api/historial?codigo=${encodeURIComponent(negocio.licitacion_codigo)}&limit=100`);
      const d = await r.json();
      if (d.success) setHistorial(d.eventos || []);
    } catch { /* silencioso */ }
  }, [negocio.licitacion_codigo]);
  useEffect(() => { fetchHistorial(); }, [fetchHistorial]);

  const cambiarEstado = async (estadoId: string, motivo?: string) => {
    // "En proceso" EXIGE viabilidad IA realizada (el servidor tiene el mismo guard).
    if (estadoId === 'EN_PROCESO' && !viabIA) {
      toast.error('Primero realiza la viabilidad IA', 'El análisis de viabilidad debe estar hecho antes de pasar a "En proceso".');
      onIrAViabilidad?.();
      return;
    }
    if (estadoId === 'DESCARTADA' && !motivo) { setDescarteOpen(true); return; }
    if (estadoId === 'POSTULADA') {
      setMontoPostular(String(negocio.monto_ofertado || ''));
      setEmpresaPostular(String(negocio.empresa_id || ''));
      setPostularOpen(true);
      return;
    }
    const estadoAnterior = negocio.estado_pipeline;
    onNegocioChange({ estado_pipeline: estadoId || null });
    try {
      const res = await fetch(`/api/negocios/${negocio.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: estadoId || null, motivo: motivo || undefined }),
      });
      const data = await res.json();
      if (data.migration_needed) {
        toast.error('Falta ejecutar migration-4-pipeline.sql en Bluehost phpMyAdmin');
        onNegocioChange({ estado_pipeline: estadoAnterior });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Error');
      const estadoInfo = estadoId ? getEstadoPipeline(estadoId) : null;
      toast.success(estadoInfo ? `Etapa: ${estadoInfo.label}` : 'Etapa removida');
      fetchHistorial();
    } catch (e: any) {
      onNegocioChange({ estado_pipeline: estadoAnterior });
      toast.error('Error al actualizar etapa', e?.message);
    }
  };

  const handleProductosCosteo = async () => {
    if (productosCosteoLoading) return;
    setProductosCosteoLoading(true);
    toast.success('Buscando productos y precios…', 'Puede tardar ~30-60s');
    try {
      const r = await fetch(`/api/documentos/generar-costeo/${encodeURIComponent(negocio.licitacion_codigo)}?precios=1`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('No se pudo generar', j.error || 'Error al buscar productos'); return; }
      toast.success('Costeo con precios listo', 'Revisa el Excel en Documentos Propios');
      onDocumentosRefrescar?.();
    } catch {
      toast.error('Error de red al buscar productos');
    } finally {
      setProductosCosteoLoading(false);
    }
  };

  const confirmarPostular = async () => {
    const monto = parseInt(String(montoPostular).replace(/\D/g, ''), 10);
    if (!monto || monto <= 0) { toast.error('Ingresa el monto que ofertaste'); return; }
    setPostularOpen(false);
    const empresaId = empresaPostular ? Number(empresaPostular) : null;
    const empresaNombre = empresas.find(e => e.id === empresaId)?.razon_social ?? null;
    const estadoAnterior = negocio.estado_pipeline;
    const montoAnterior = negocio.monto_ofertado;
    const empresaAnterior = { id: negocio.empresa_id, nombre: negocio.empresa_nombre };
    onNegocioChange({ estado_pipeline: 'POSTULADA', monto_ofertado: monto, empresa_id: empresaId, empresa_nombre: empresaNombre });
    try {
      const res = await fetch(`/api/negocios/${negocio.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: 'POSTULADA', monto_ofertado: monto, empresa_id: empresaId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      toast.success('Marcada como Postulada');
    } catch (e: any) {
      onNegocioChange({ estado_pipeline: estadoAnterior, monto_ofertado: montoAnterior, empresa_id: empresaAnterior.id, empresa_nombre: empresaAnterior.nombre });
      toast.error('Error al postular', e?.message);
    }
  };

  const reasignar = async (nuevoId: number) => {
    if (!nuevoId || nuevoId === negocio.asignado_a) return;
    try {
      const res = await fetch(`/api/negocios/${negocio.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asignado_a: nuevoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      const u = usuariosLista.find(x => x.id === nuevoId);
      onNegocioChange({ asignado_a: nuevoId, usuario_nombre: u?.nombre || '', usuario_email: u?.email || '' });
      toast.success('Licitación reasignada', u ? `Ahora es de ${u.nombre || u.email}` : undefined);
      fetchHistorial();
    } catch (e: any) {
      toast.error('No se pudo reasignar', e?.message);
    }
  };

  const eliminar = async () => {
    const ok = await confirmar({
      titulo: '¿Quitar esta licitación de Negocios?',
      mensaje: 'Se quitará del panel. Podrás volver a asignarla después.',
      confirmarLabel: 'Quitar', peligro: true,
    });
    if (!ok) return;
    await fetch(`/api/negocios/${negocio.id}`, { method: 'DELETE' });
    toast.info('Licitación removida');
    onEliminado();
  };

  const sem = (negocio.estado_pipeline || '') !== 'DESCARTADA' ? semaforoRevision(negocio.updated_at) : null;

  return (
    <>
      <aside className="hidden xl:flex flex-col w-56 border-l border-zinc-200/80 bg-white flex-shrink-0 overflow-y-auto p-4 gap-5">

        <div>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Estado</p>
          <PipelineSelector current={negocio.estado_pipeline} onChange={cambiarEstado} />
          <div className="flex gap-1.5 mt-2">
            {negocio.estado_pipeline !== 'EN_PROCESO' && (
              <button onClick={() => cambiarEstado('EN_PROCESO')}
                title={!viabIA ? 'Bloqueado: primero realiza el análisis de viabilidad IA' : undefined}
                className={`flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold border rounded-lg py-1.5 transition-colors ${
                  viabIA ? 'text-violet-700 bg-violet-50 hover:bg-violet-100 border-violet-200' : 'text-zinc-400 bg-zinc-50 border-zinc-200 cursor-not-allowed'
                }`}>
                <PlayCircle size={12} /> En proceso
              </button>
            )}
            {negocio.estado_pipeline !== 'DESCARTADA' && (
              <button onClick={() => { setMotivoDescarte(''); setDescarteOpen(true); }}
                className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg py-1.5 transition-colors">
                <Ban size={12} /> Descartar
              </button>
            )}
          </div>

          <div className="mt-2">
            <button onClick={handleProductosCosteo} disabled={productosCosteoLoading}
              title="Busca productos y precios de mercado (Chile) para los ítems del costeo y regenera el Excel con precios"
              className="flex items-center justify-center gap-1.5 w-full text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg py-1.5 transition-colors disabled:opacity-60">
              {productosCosteoLoading ? <><Loader2 size={12} className="animate-spin" /> Buscando productos…</> : <><ShoppingCart size={12} /> Productos a costeo</>}
            </button>
            <p className="text-[10px] text-zinc-400 mt-1 leading-snug">
              Precios de mercado para <strong className="text-zinc-500">{negocio.usuario_nombre || negocio.usuario_email.split('@')[0]}</strong>. El Excel queda en Documentos Propios.
            </p>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Asignación</p>
          <p className="text-[12px] text-zinc-600 font-medium">{fmtFecha(negocio.created_at)}</p>
          {sem && (
            <span className={`mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-lg ${sem.bg} ${sem.text}`}
              title={`${sem.dias} día${sem.dias === 1 ? '' : 's'} sin cambio de estado`}>
              <span style={{ background: sem.color }} className="w-2 h-2 rounded-full animate-pulse" />
              {sem.etiqueta} sin cambios
            </span>
          )}
        </div>

        <div>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Responsable</p>
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarGrad(negocio.asignado_a)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
              {iniciales(negocio.usuario_nombre, negocio.usuario_email)}
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-zinc-800 truncate">{negocio.usuario_nombre || negocio.usuario_email.split('@')[0]}</p>
              <p className="text-[11px] text-zinc-400 truncate">{negocio.usuario_email}</p>
            </div>
          </div>
          {isAdmin && usuariosLista.length > 0 && (
            <div className="mt-2">
              {!mostrarReasignar ? (
                <button onClick={() => setMostrarReasignar(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 text-[12px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg py-1.5 transition-colors">
                  <UserPlus size={13} /> Reasignar responsable
                </button>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-zinc-400">Mover a otro perfil (conserva historial y estado):</p>
                  <Select
                    value={String(negocio.asignado_a)}
                    onChange={v => { reasignar(Number(v)); setMostrarReasignar(false); }}
                    options={usuariosLista.map(u => ({
                      value: String(u.id), label: u.nombre || u.email,
                      color: colorUsuario(u.email || u.nombre || ''), description: u.email,
                    }))} />
                  <button onClick={() => setMostrarReasignar(false)} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
                </div>
              )}
            </div>
          )}
        </div>

        {negocio.etiquetas.length > 0 && (
          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Líneas de negocio</p>
            <div className="flex flex-col gap-1">
              {negocio.etiquetas.map(et => (
                <span key={et.id} style={{ backgroundColor: et.color + '18', color: et.color, borderColor: et.color + '50' }}
                  className="text-[11.5px] font-bold px-2.5 py-1 rounded-lg border w-fit">
                  {et.nombre}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Publicación</p>
          <p className="text-[12px] text-zinc-600 font-medium">{fmtFecha(fechaPublicacion || negocio.created_at)}</p>
        </div>

        <div>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Cierre</p>
          <p className="text-[12px] text-zinc-600 font-medium">{fmtFecha(negocio.licitacion_cierre)}</p>
        </div>

        {documentosCount > 0 && (
          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Documentos</p>
            <span className="flex items-center gap-2 text-[12px] text-zinc-600 font-semibold">
              <FolderOpen size={12} /> {documentosCount} archivo{documentosCount > 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <History size={11} /> Historial
          </p>
          <HistorialLicitacion eventos={historial} />
        </div>

        <div className="mt-auto pt-4 border-t border-zinc-100 space-y-2">
          <a href={mpUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 w-full px-3 py-2 border border-zinc-200 text-zinc-600 text-[12.5px] font-semibold rounded-xl hover:bg-zinc-50 transition-colors">
            <ExternalLink size={13} /> Ver en Mercado Público
          </a>
          {isAdmin && (
            <button onClick={eliminar}
              className="flex items-center gap-2 w-full px-3 py-2 text-red-500 text-[12.5px] font-semibold rounded-xl hover:bg-red-50 transition-colors">
              <Trash2 size={13} /> Quitar de Negocios
            </button>
          )}
        </div>
      </aside>

      {/* Modal: descartar con motivo obligatorio */}
      {descarteOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setDescarteOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-red-50 rounded-t-2xl">
              <Ban size={16} className="text-red-600" />
              <p className="text-[14px] font-bold text-red-800">Descartar licitación</p>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[13px] text-slate-600">
                Selecciona el <strong>motivo</strong> del descarte (obligatorio) y agrega comentarios. Queda registrado quién y cuándo, y se ve en el apartado <em>Descartadas</em>.
              </p>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">
                <Ban size={11} className="text-red-500" /> {NIVEL_LABEL[nivelPorEstado(normalizarEstado(negocio.estado_pipeline))]}
              </div>
              <Select
                value={motivoSel}
                onChange={setMotivoSel}
                placeholder="— Selecciona el motivo —"
                options={motivosParaEstado(normalizarEstado(negocio.estado_pipeline)).map(m => ({ value: m, label: m }))} />
              <textarea
                value={motivoDescarte}
                onChange={e => setMotivoDescarte(e.target.value)}
                rows={3}
                placeholder={motivoSel.startsWith('Otro') ? 'Describe el motivo (obligatorio)…' : 'Comentarios adicionales (opcional)…'}
                className="w-full text-[13px] rounded-lg border border-slate-200 p-2.5 focus:ring-2 focus:ring-red-500/20 focus:border-red-400 outline-none resize-y"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setDescarteOpen(false)}
                  className="px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    if (!motivoSel) { toast.error('Selecciona el motivo del descarte'); return; }
                    if (motivoSel.startsWith('Otro') && !motivoDescarte.trim()) { toast.error('Describe el motivo del descarte'); return; }
                    setDescarteOpen(false);
                    await cambiarEstado('DESCARTADA', componerMotivo(motivoSel, motivoDescarte));
                  }}
                  disabled={!motivoSel || (motivoSel.startsWith('Otro') && !motivoDescarte.trim())}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold rounded-lg transition-colors disabled:opacity-50">
                  <Ban size={14} /> Descartar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal POSTULAR — pide el monto ofertado mostrando el presupuesto real */}
      {postularOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setPostularOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-amber-50 rounded-t-2xl">
              <Send size={16} className="text-amber-600" />
              <p className="text-[14px] font-bold text-amber-800">Marcar como Postulada</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
                <span className="text-[12px] text-slate-500">Presupuesto real de la licitación</span>
                <span className="text-[14px] font-bold text-slate-800">{fmt(negocio.licitacion_monto)}</span>
              </div>
              <div>
                <label className="block text-[12.5px] font-semibold text-slate-700 mb-1">¿Con cuánto postulaste? (monto ofertado)</label>
                <div className="relative">
                  <DollarSignIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text" inputMode="numeric" autoFocus
                    value={montoPostular ? new Intl.NumberFormat('es-CL').format(Number(String(montoPostular).replace(/\D/g, '')) || 0) : ''}
                    onChange={e => setMontoPostular(e.target.value.replace(/\D/g, ''))}
                    placeholder="0"
                    className="w-full text-[13px] rounded-lg border border-slate-200 pl-7 pr-3 py-2.5 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 outline-none"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">En pesos (CLP). Se verá en el apartado Postuladas.</p>
              </div>
              <div>
                <label className="block text-[12.5px] font-semibold text-slate-700 mb-1">¿Con qué empresa postulaste?</label>
                <Select
                  value={empresaPostular}
                  onChange={setEmpresaPostular}
                  icon={<Building2 size={14} />}
                  placeholder="— Sin especificar —"
                  options={[{ value: '', label: '— Sin especificar —' }, ...empresas.map(e => ({ value: String(e.id), label: e.razon_social }))]} />
                {empresas.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-600">No hay empresas cargadas. Créalas en la sección <b>Empresas</b>.</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPostularOpen(false)}
                  className="px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button onClick={confirmarPostular}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
                  <Send size={14} /> Postular
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
