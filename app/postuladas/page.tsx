'use client';

// Apartado "Postuladas" — rediseño orientado al RESULTADO.
//
// Cada licitación postulada se cruza EN VIVO con la API de Mercado Público
// (/api/licitacion-adjudicacion) y se clasifica en tres estados de color:
//   · GANADA (verde)      → MP adjudicó y una de NUESTRAS empresas ganó ≥1 línea.
//                           OJO: una licitación se adjudica a VARIOS proveedores por
//                           línea; podemos ser uno de ellos. Se muestran TODOS los
//                           ganadores y se resaltan los nuestros.
//   · PERDIDA (rojo)      → MP adjudicó pero no ganamos ninguna línea (se muestra a
//                           quién se la adjudicaron, con toda la info de la API).
//   · EN EVALUACIÓN (ámbar) → aún sin resultado publicado.
//
// Roles: cada perfil ve SOLO sus postuladas; el admin ve TODAS y puede filtrarlas por
// perfil, empresa y resultado. El filtrado por rol lo hace /api/negocios.

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import {
  Send, ExternalLink, Building2, Calendar, Loader2, Inbox, FileText,
  Award, Trophy, Users, FileCheck2, ChevronDown, ChevronUp,
  Pencil, Trash2, Undo2, X, Save, Wallet, CheckCircle2,
  XCircle, Hourglass, DoorOpen, DoorClosed,
} from 'lucide-react';
import dayjs from 'dayjs';

const ESTADO_POSTULADA = 'POSTULADA';

type Resultado = 'ganada' | 'perdida' | 'evaluacion';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_estado?: string | null;
  estado_pipeline: string | null;
  monto_ofertado?: number;
  empresa_id?: number | null;
  empresa_nombre?: string | null;
  usuario_nombre?: string;
  usuario_email?: string;
  aperturada?: number;                 // 1 si el poller del portal ya detectó la apertura
  apertura_detectada_en?: string | null;
}
interface EmpresaOpc { id: number; razon_social: string; }
interface DocCache { documento_nombre: string; documento_url_local: string; categoria: string | null; }

interface LineaAdjudicada {
  correlativo?: number;
  producto?: string;
  descripcion?: string;
  cantidad?: number;
  unidad?: string;
  montoUnitario: number | null;
  rutProveedor: string | null;
  proveedor: string | null;
  esNuestra?: boolean;
}
interface Adjudicacion {
  esAdjudicada: boolean;
  estado?: string | null;
  fechaAdjudicacion?: string | null;
  ganamos?: boolean;
  montoNuestro?: number | null;
  adjudicacion?: {
    tipo?: number;
    numeroResolucion?: string | null;
    numeroOferentes?: number | null;
    urlActa?: string | null;
  } | null;
  lineasAdjudicadas?: LineaAdjudicada[];
  montoAdjudicadoTotal?: number | null;
}

function fmtCLP(n: number | null | undefined) {
  if (n == null || n === 0) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

// Orden de aparición: primero las ganadas (celebrar), luego en evaluación, luego perdidas.
const ORDEN: Record<Resultado, number> = { ganada: 0, evaluacion: 1, perdida: 2 };

// Clasifica una postulada según lo que dice la API de MP.
function resultadoDe(adj: Adjudicacion | null | undefined): Resultado {
  if (adj?.esAdjudicada && adj.ganamos) return 'ganada';
  if (adj?.esAdjudicada) return 'perdida';
  return 'evaluacion';
}

// Metadatos visuales por resultado (un solo lugar → coherencia de color en toda la vista).
const META: Record<Resultado, {
  label: string; short: string; color: string; ring: string; soft: string;
  text: string; border: string; icon: typeof Trophy;
}> = {
  ganada: {
    label: 'Ganada', short: 'Ganadas', color: '#059669', ring: 'rgba(5,150,105,.35)',
    soft: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: Trophy,
  },
  perdida: {
    label: 'Perdida', short: 'Perdidas', color: '#dc2626', ring: 'rgba(220,38,38,.30)',
    soft: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: XCircle,
  },
  evaluacion: {
    label: 'En evaluación', short: 'En evaluación', color: '#d97706', ring: 'rgba(217,119,6,.30)',
    soft: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Hourglass,
  },
};

// ── Badge de resultado (con animación) ────────────────────────────────────────
function ResultadoBadge({ r, pulso }: { r: Resultado; pulso?: boolean }) {
  const m = META[r];
  const Icon = m.icon;
  return (
    <span
      className="pp-badge inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-bold border"
      style={{ backgroundColor: m.color + '16', color: m.color, borderColor: m.color + '3d' }}
    >
      {pulso && <span className="pp-pulse" style={{ background: m.color }} />}
      <Icon size={11} /> {m.label}
    </span>
  );
}

// ── Chip de apertura (detectado leyendo el portal de MP) ──────────────────────
// Verde "Aperturada" cuando el poster ya vio el acto de apertura; gris "Sin apertura"
// mientras no. El estado lo trae /api/negocios desde la tabla licitacion_apertura.
function AperturaChip({ aperturada }: { aperturada: boolean }) {
  return aperturada ? (
    <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-bold border bg-sky-50 text-sky-700 border-sky-200"
      title="Mercado Público ya realizó el acto de apertura de esta licitación">
      <DoorOpen size={11} /> Aperturada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-medium border bg-slate-100 text-slate-400 border-slate-200"
      title="Aún sin acto de apertura en Mercado Público">
      <DoorClosed size={11} /> Sin apertura
    </span>
  );
}

// Agrupa las líneas por proveedor adjudicado → un resumen "quién ganó qué y por cuánto".
// Cruza por RUT con nuestras empresas (esNuestra ya viene calculado desde el servidor).
interface Ganador {
  rut: string | null; proveedor: string; lineas: number;
  cantidad: number; monto: number; esNuestra: boolean;
}
function agruparGanadores(lineas: LineaAdjudicada[]): Ganador[] {
  const m = new Map<string, Ganador>();
  for (const l of lineas) {
    const key = (l.rutProveedor || l.proveedor || '—').toUpperCase();
    const g = m.get(key) || {
      rut: l.rutProveedor ?? null, proveedor: l.proveedor || 'Proveedor adjudicado',
      lineas: 0, cantidad: 0, monto: 0, esNuestra: !!l.esNuestra,
    };
    g.lineas++;
    g.cantidad += Number(l.cantidad) || 0;
    g.monto += (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1);
    g.esNuestra = g.esNuestra || !!l.esNuestra;
    m.set(key, g);
  }
  // Nuestro primero, luego por monto descendente.
  return Array.from(m.values()).sort((a, b) =>
    (a.esNuestra === b.esNuestra ? b.monto - a.monto : a.esNuestra ? -1 : 1));
}

// ── Detalle de adjudicación (todos los ganadores por línea) ───────────────────
function BloqueAdjudicacion({ adj }: { adj: Adjudicacion }) {
  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const ganamos = !!adj.ganamos;
  const acc = ganamos ? META.ganada : META.perdida;
  const ganadores = useMemo(() => agruparGanadores(lineas), [lineas]);
  // En las perdidas se muestra el detalle por línea abierto de una (para ver al ganador sin clic).
  const [abierto, setAbierto] = useState(!ganamos);

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="rounded-xl border p-3" style={{ borderColor: acc.color + '33', background: acc.color + '0c' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border"
            style={{ color: acc.color, background: acc.color + '18', borderColor: acc.color + '33' }}>
            {ganamos ? <Trophy size={11} /> : <Award size={11} />}
            {ganamos ? `Ganamos ${nuestras} línea${nuestras !== 1 ? 's' : ''}` : 'Adjudicada a terceros'}
          </span>
          {adj.fechaAdjudicacion && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Calendar size={11} /> {dayjs(adj.fechaAdjudicacion).format('DD/MM/YYYY')}
            </span>
          )}
          {meta?.numeroOferentes != null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Users size={11} /> {meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}
            </span>
          )}
          {meta?.numeroResolucion && (
            <span className="text-[11px] text-slate-500">Res. N° {meta.numeroResolucion}</span>
          )}
        </div>

        {/* Resumen por ganador (siempre visible): quién se adjudicó, RUT, líneas y monto */}
        {ganadores.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {ganadores.length === 1 ? 'Adjudicado a' : `Adjudicado a ${ganadores.length} proveedores`}
            </p>
            {ganadores.map((g, i) => (
              <div key={i}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 border ${
                  g.esNuestra ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
                }`}>
                <div className="min-w-0">
                  <p className={`text-[12px] font-semibold truncate ${g.esNuestra ? 'text-emerald-800' : 'text-slate-700'}`}
                    title={g.proveedor}>
                    {g.esNuestra
                      ? <CheckCircle2 size={11} className="inline mr-1 -mt-0.5 text-emerald-600" />
                      : <Building2 size={10} className="inline mr-1 text-slate-400" />}
                    {g.proveedor}
                    {g.esNuestra && <span className="ml-1.5 text-[8.5px] font-black tracking-wide text-emerald-600 uppercase">Nosotros</span>}
                  </p>
                  <p className="text-[10.5px] text-slate-500">
                    {g.rut ? g.rut : 'RUT no informado'} · {g.lineas} línea{g.lineas !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-[12.5px] font-bold text-slate-800 whitespace-nowrap">{fmtCLP(g.monto)}</span>
              </div>
            ))}
          </div>
        )}

        {lineas.length > 0 && (
          <>
            <button
              onClick={() => setAbierto(o => !o)}
              className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 hover:text-slate-800 transition-colors"
            >
              {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {abierto ? 'Ocultar' : 'Ver'} adjudicación por línea ({lineas.length})
            </button>
            {abierto && (
              <div className="pp-lines mt-2 space-y-1.5">
                {lineas.map((l, i) => {
                  const totalLinea = (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1);
                  return (
                  <div key={i}
                    className={`flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 border transition-colors ${
                      l.esNuestra ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
                    }`}>
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-medium text-slate-700 truncate" title={l.producto || l.descripcion}>
                        {l.correlativo ? `${l.correlativo}. ` : ''}{l.producto || l.descripcion || `Línea ${l.correlativo ?? i + 1}`}
                      </p>
                      <p className={`text-[10.5px] truncate ${l.esNuestra ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}
                        title={`${l.proveedor || ''} ${l.rutProveedor || ''}`}>
                        {l.esNuestra
                          ? <CheckCircle2 size={10} className="inline mr-0.5 -mt-0.5" />
                          : <Award size={9} className="inline mr-0.5" />}
                        {l.proveedor || 'Proveedor adjudicado'}
                        {l.rutProveedor ? ` · ${l.rutProveedor}` : ''}
                      </p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {l.esNuestra && (
                        <span className="block text-[8.5px] font-black tracking-wide text-emerald-600 uppercase">Nosotros</span>
                      )}
                      <span className="text-[11.5px] font-bold text-slate-800">{fmtCLP(totalLinea)}</span>
                      {l.cantidad != null && (
                        <span className="block text-[9.5px] text-slate-400">
                          {l.cantidad} {l.unidad || 'u'} × {fmtCLP(l.montoUnitario)}
                        </span>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {meta?.urlActa && (
          <a href={meta.urlActa} target="_blank" rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold hover:underline"
            style={{ color: acc.color }}>
            <FileCheck2 size={12} /> Ver acta de adjudicación <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta de una postulada ──────────────────────────────────────────────────
function PostuladaCard({ n, adj, cargandoAdj, index, isAdmin, empresas, onRevertida, onActualizada }: {
  n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; index: number;
  isAdmin: boolean; empresas: EmpresaOpc[];
  onRevertida: (id: number) => void;
  onActualizada: (id: number, patch: { monto_ofertado?: number; estado_pipeline?: string; empresa_id?: number | null; empresa_nombre?: string | null }) => void;
}) {
  const [docs, setDocs] = useState<DocCache[]>([]);
  const [editando, setEditando] = useState(false);
  const [montoEdit, setMontoEdit] = useState<string>(n.monto_ofertado ? String(n.monto_ofertado) : '');
  const [estadoEdit, setEstadoEdit] = useState<string>(n.estado_pipeline || ESTADO_POSTULADA);
  const [empresaEdit, setEmpresaEdit] = useState<string>(n.empresa_id ? String(n.empresa_id) : '');
  const [guardando, setGuardando] = useState(false);
  const perfilCol = colorUsuario(n.usuario_email || n.usuario_nombre || '');
  const confirmar = useConfirm();
  const toast = useToast();

  const r = resultadoDe(adj);
  const m = META[r];

  useEffect(() => {
    fetch(`/api/documentos/cache/${encodeURIComponent(n.licitacion_codigo)}`)
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        const todos: DocCache[] = d?.documentos || d?.docs || [];
        setDocs(todos.filter(x => (x.categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS'));
      })
      .catch(() => {});
  }, [n.licitacion_codigo]);

  const guardarEdicion = async () => {
    setGuardando(true);
    try {
      const monto = parseInt(String(montoEdit).replace(/\D/g, ''), 10) || 0;
      const empresaId = empresaEdit ? Number(empresaEdit) : null;
      const res = await fetch(`/api/negocios/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto_ofertado: monto, estado_pipeline: estadoEdit, empresa_id: empresaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Postulada actualizada');
      setEditando(false);
      const empresaNombre = empresas.find(e => e.id === empresaId)?.razon_social ?? null;
      onActualizada(n.id, { monto_ofertado: monto, estado_pipeline: estadoEdit, empresa_id: empresaId, empresa_nombre: empresaNombre });
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message);
    } finally {
      setGuardando(false);
    }
  };

  const revertir = async () => {
    const ok = await confirmar({
      titulo: '¿Quitar de Postuladas?',
      mensaje: 'La licitación volverá a "En proceso" y saldrá de este apartado. No se elimina el negocio.',
      confirmarLabel: 'Quitar', peligro: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/negocios/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: 'EN_PROCESO' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo revertir');
      toast.success('Devuelta a En proceso');
      onRevertida(n.id);
    } catch (e: any) {
      toast.error('No se pudo revertir', e?.message);
    }
  };

  const borrarDoc = async (d: DocCache) => {
    const ok = await confirmar({
      titulo: '¿Eliminar documento?',
      mensaje: `"${d.documento_nombre}" se eliminará de forma permanente.`,
      confirmarLabel: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    const prev = docs;
    setDocs(ds => ds.filter(x => x !== d));
    try {
      const res = await fetch(`/api/documentos/${encodeURIComponent(n.licitacion_codigo)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: d.documento_url_local, nombre: d.documento_nombre }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Documento eliminado');
    } catch (e: any) {
      setDocs(prev);
      toast.error('No se pudo eliminar', e?.message);
    }
  };

  // Métrica derecha según resultado.
  const metricaResultado = r === 'ganada'
    ? { label: 'Ganamos', valor: fmtCLP(adj?.montoNuestro), cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', sub: 'text-emerald-700' }
    : r === 'perdida'
    ? { label: 'Adjudicado (total)', valor: fmtCLP(adj?.montoAdjudicadoTotal), cls: 'bg-rose-50 border-rose-200 text-rose-800', sub: 'text-rose-700' }
    : { label: 'Postulamos con', valor: fmtCLP(n.monto_ofertado), cls: 'bg-amber-50 border-amber-200 text-amber-800', sub: 'text-amber-700' };

  return (
    <div
      className="group relative bg-white border border-slate-200 rounded-2xl p-4 pl-5 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
    >
      {/* Barra de color por resultado */}
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: m.color }} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-mono font-semibold text-slate-500">{n.licitacion_codigo}</span>
            {!cargandoAdj && <ResultadoBadge r={r} pulso={r === 'ganada'} />}
            <AperturaChip aperturada={!!n.aperturada} />
            {isAdmin && (n.usuario_nombre || n.usuario_email) && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                <span style={{ background: perfilCol }} className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
                  {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
                </span>
                {n.usuario_nombre || n.usuario_email}
              </span>
            )}
          </div>
          <h3 className="text-[14px] font-semibold text-slate-800 truncate">{n.licitacion_nombre || 'Sin nombre'}</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[12px] text-slate-500">
            <span className="inline-flex items-center gap-1 min-w-0"><Building2 size={12} className="flex-shrink-0" /><span className="truncate max-w-[240px]">{n.licitacion_organismo || '—'}</span></span>
            {n.licitacion_cierre && <span className="inline-flex items-center gap-1"><Calendar size={12} />{dayjs(n.licitacion_cierre).format('DD/MM/YYYY')}</span>}
          </div>
          {n.empresa_nombre && (
            <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
              <Building2 size={11} /> {n.empresa_nombre}
            </span>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          {isAdmin && !editando && (
            <>
              <button onClick={() => setEditando(true)} title="Editar monto y estado"
                className="inline-flex items-center text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition-colors">
                <Pencil size={13} />
              </button>
              <button onClick={revertir} title="Quitar de Postuladas (vuelve a En proceso)"
                className="inline-flex items-center text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors">
                <Undo2 size={13} />
              </button>
            </>
          )}
          <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
            Ver <ExternalLink size={12} />
          </Link>
        </div>
      </div>

      {editando && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">Monto ofertado</span>
              <input type="text" inputMode="numeric" value={montoEdit}
                onChange={e => setMontoEdit(e.target.value)} placeholder="$"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">Estado</span>
              <select value={estadoEdit} onChange={e => setEstadoEdit(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                {ESTADOS_PIPELINE.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-semibold text-slate-600">Empresa con la que se postuló</span>
              <select value={empresaEdit} onChange={e => setEmpresaEdit(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">— Sin especificar —</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razon_social}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Si cambias el estado a uno distinto de <b>Postulada</b>, saldrá de este apartado.</p>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={() => { setEditando(false); setMontoEdit(n.monto_ofertado ? String(n.monto_ofertado) : ''); setEstadoEdit(n.estado_pipeline || ESTADO_POSTULADA); setEmpresaEdit(n.empresa_id ? String(n.empresa_id) : ''); }}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-200/60 px-3 py-1.5 rounded-lg transition-colors">
              <X size={13} /> Cancelar
            </button>
            <button onClick={guardarEdicion} disabled={guardando}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-3.5 py-1.5 rounded-lg transition-colors">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
            </button>
          </div>
        </div>
      )}

      {/* Presupuesto real · Postulamos con · Métrica de resultado */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Presupuesto real</p>
          <p className="text-[13.5px] font-bold text-slate-800">{fmtCLP(n.licitacion_monto)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Postulamos con</p>
          <p className="text-[13.5px] font-bold text-slate-800">{fmtCLP(n.monto_ofertado)}</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${metricaResultado.cls}`}>
          <p className={`text-[10.5px] ${metricaResultado.sub}`}>{metricaResultado.label}</p>
          <p className="text-[13.5px] font-bold">{cargandoAdj ? '…' : metricaResultado.valor}</p>
        </div>
      </div>

      {/* Detalle de adjudicación (ganada o perdida) */}
      {adj?.esAdjudicada && <BloqueAdjudicacion adj={adj} />}

      {/* En evaluación: estado según MP */}
      {!cargandoAdj && !adj?.esAdjudicada && (
        <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <Hourglass size={12} /> Sin resultado aún{adj?.estado ? ` · MP: ${adj.estado}` : ''}
        </div>
      )}

      {docs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Documentos propios ({docs.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {docs.map((d, i) => (
              <span key={i}
                className="group/doc inline-flex items-center gap-1 text-[11.5px] text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md pl-2 pr-1 py-1 transition-colors max-w-[240px]">
                <a href={d.documento_url_local} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-w-0">
                  <FileText size={11} className="flex-shrink-0 text-slate-400" />
                  <span className="truncate">{d.documento_nombre}</span>
                </a>
                <button onClick={() => borrarDoc(d)} title="Eliminar documento"
                  className="flex-shrink-0 p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors">
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// KPI tile.
function KpiCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="pp-kpi bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1">{label}</p>
          <p className="text-[26px] font-black leading-none tabular-nums text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1 truncate">{sub}</p>}
        </div>
        <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: color + '18', color }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function PostuladasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [empresasOpc, setEmpresasOpc] = useState<EmpresaOpc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfilSel, setPerfilSel] = useState<string>('');
  const [empresaSel, setEmpresaSel] = useState<string>('');
  const [resultadoSel, setResultadoSel] = useState<Resultado | ''>('');

  // Estado de cada postulada (adjudicación + apertura). Se resuelve TODO en el servidor en
  // una sola llamada (/api/postuladas/estado) → los totales aparecen juntos, sin animación
  // "una por una". adjMap por código; la apertura se refleja en cada negocio (n.aperturada).
  const [adjMap, setAdjMap] = useState<Record<string, Adjudicacion | null>>({});
  const [estadoCargado, setEstadoCargado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/negocios');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
        const todas: Negocio[] = data.negocios || [];
        setNegocios(todas.filter(n => n.estado_pipeline === ESTADO_POSTULADA));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  useEffect(() => {
    fetch('/api/empresas').then(r => r.json()).then(d => {
      if (d.success) setEmpresasOpc(d.empresas || []);
    }).catch(() => {});
  }, []);

  // Cruce con MP en UNA sola llamada al servidor (adjudicación cache-first + apertura).
  useEffect(() => {
    if (negocios.length === 0) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/postuladas/estado');
        const d = await r.json();
        if (cancelado) return;
        if (d?.estados) {
          setAdjMap(d.estados);
          // Reflejar el estado de apertura en cada tarjeta (chip Aperturada / Sin apertura).
          setNegocios(prev => prev.map(n => ({ ...n, aperturada: d.estados[n.licitacion_codigo]?.aperturada ? 1 : 0 })));
        }
      } catch { /* si falla, se muestran los negocios sin cruce */ }
      finally { if (!cancelado) setEstadoCargado(true); }
    })();
    return () => { cancelado = true; };
  }, [negocios.length]);

  // Perfiles presentes (filtro admin).
  const perfiles = useMemo(() => {
    const m = new Map<string, { email: string; nombre: string; total: number }>();
    for (const n of negocios) {
      const email = n.usuario_email || n.usuario_nombre || '—';
      const e = m.get(email) || { email, nombre: n.usuario_nombre || n.usuario_email || '—', total: 0 };
      e.total++; m.set(email, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Empresas presentes (filtro).
  const empresasFiltro = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; total: number }>();
    for (const n of negocios) {
      if (!n.empresa_id) continue;
      const id = String(n.empresa_id);
      const e = m.get(id) || { id, nombre: n.empresa_nombre || `Empresa ${id}`, total: 0 };
      e.total++; m.set(id, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Filtro por perfil + empresa (base para tabs de resultado y KPIs).
  const base = useMemo(
    () => negocios
      .filter(n => !perfilSel || (n.usuario_email || n.usuario_nombre) === perfilSel)
      .filter(n => !empresaSel || String(n.empresa_id || '') === empresaSel),
    [negocios, perfilSel, empresaSel],
  );

  const resultadoDeNegocio = useCallback(
    (n: Negocio): Resultado => resultadoDe(adjMap[n.licitacion_codigo]),
    [adjMap],
  );

  // Conteo por resultado (sobre la base filtrada por perfil/empresa).
  const conteo = useMemo(() => {
    const c = { ganada: 0, perdida: 0, evaluacion: 0 };
    for (const n of base) c[resultadoDeNegocio(n)]++;
    return c;
  }, [base, resultadoDeNegocio]);

  const visibles = useMemo(() => {
    return base
      .filter(n => !resultadoSel || resultadoDeNegocio(n) === resultadoSel)
      .sort((a, b) => {
        const da = ORDEN[resultadoDeNegocio(a)] - ORDEN[resultadoDeNegocio(b)];
        if (da !== 0) return da;
        return dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf();
      });
  }, [base, resultadoSel, resultadoDeNegocio]);

  // KPIs.
  const stats = useMemo(() => {
    let montoGanado = 0;
    for (const n of base) {
      const a = adjMap[n.licitacion_codigo];
      if (a?.ganamos && a.montoNuestro) montoGanado += a.montoNuestro;
    }
    const resueltasTotal = conteo.ganada + conteo.perdida;
    return {
      total: base.length,
      ...conteo,
      montoGanado,
      exito: resueltasTotal ? Math.round((conteo.ganada / resueltasTotal) * 100) : null,
    };
  }, [base, conteo, adjMap]);

  const TABS: { id: Resultado | ''; label: string; count: number; color: string }[] = [
    { id: '', label: 'Todas', count: base.length, color: '#334155' },
    { id: 'ganada', label: 'Ganadas', count: conteo.ganada, color: META.ganada.color },
    { id: 'evaluacion', label: 'En evaluación', count: conteo.evaluacion, color: META.evaluacion.color },
    { id: 'perdida', label: 'Perdidas', count: conteo.perdida, color: META.perdida.color },
  ];

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Postuladas' }]}>
      {/* Animaciones y estados de la vista */}
      <style>{`
        @keyframes ppUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes ppLines { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @keyframes ppPulse { 0% { box-shadow: 0 0 0 0 var(--c); } 70% { box-shadow: 0 0 0 5px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        @keyframes ppShimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
        .pp-card { animation: ppUp .45s cubic-bezier(.22,1,.36,1) both; }
        .pp-kpi { animation: ppUp .4s ease both; }
        .pp-lines { animation: ppLines .25s ease both; }
        .pp-pulse { width: 6px; height: 6px; border-radius: 9999px; --c: rgba(5,150,105,.5); animation: ppPulse 1.8s infinite; }
        .pp-shimmer { background-image: linear-gradient(90deg, #f1f5f9 0px, #e2e8f0 80px, #f1f5f9 160px); background-size: 400px 100%; animation: ppShimmer 1.2s infinite linear; }
        @media (prefers-reduced-motion: reduce) { .pp-card, .pp-kpi, .pp-lines, .pp-pulse, .pp-shimmer { animation: none !important; } }
      `}</style>

      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Send size={24} className="text-amber-600" /> Postuladas
            </h1>
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-2">
              {cargando
                ? 'Cargando…'
                : `${base.length} oferta${base.length !== 1 ? 's' : ''} presentada${base.length !== 1 ? 's' : ''}`}
              {!cargando && !estadoCargado && base.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] text-slate-400">
                  <Loader2 size={12} className="animate-spin" /> resolviendo resultados…
                </span>
              )}
            </p>
          </div>
        </div>

        {/* KPIs */}
        {!cargando && !error && base.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <KpiCard icon={<Trophy size={22} />} label="Ganadas" value={stats.ganada}
              sub={stats.exito != null ? `${stats.exito}% de efectividad` : 'Resultados en curso'} color={META.ganada.color} />
            <KpiCard icon={<XCircle size={22} />} label="Perdidas" value={stats.perdida} sub="Adjudicadas a terceros" color={META.perdida.color} />
            <KpiCard icon={<Hourglass size={22} />} label="En evaluación" value={stats.evaluacion} sub="Aún sin resultado" color={META.evaluacion.color} />
            <KpiCard icon={<Wallet size={22} />} label="Monto ganado" value={fmtCLP(stats.montoGanado || null)} sub="Lo adjudicado a nosotros" color="#7c3aed" />
          </div>
        )}

        {/* Tabs de resultado */}
        {!cargando && !error && base.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {TABS.map(t => {
              const activo = resultadoSel === t.id;
              return (
                <button key={t.id || 'all'} onClick={() => setResultadoSel(t.id)}
                  style={activo ? { backgroundColor: t.color, borderColor: t.color } : { borderColor: t.color + '40', color: t.color }}
                  className={`inline-flex items-center gap-2 text-[12.5px] font-bold px-3.5 py-2 rounded-xl border transition-all ${
                    activo ? 'text-white shadow-sm' : 'bg-white hover:bg-slate-50'
                  }`}>
                  {t.label}
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[11px] font-black"
                    style={activo ? { background: 'rgba(255,255,255,.25)', color: '#fff' } : { background: t.color + '18', color: t.color }}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Filtro por perfil (admin) */}
        {isAdmin && perfiles.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mr-1 inline-flex items-center gap-1">
              <Users size={12} /> Perfil
            </span>
            <button onClick={() => setPerfilSel('')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                perfilSel === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>
              Todos <span className="opacity-70">({negocios.length})</span>
            </button>
            {perfiles.map(p => {
              const activo = perfilSel === p.email;
              const col = colorUsuario(p.email);
              return (
                <button key={p.email} onClick={() => setPerfilSel(activo ? '' : p.email)}
                  style={activo ? { backgroundColor: col, borderColor: col } : { borderColor: col + '55' }}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                    activo ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  <span style={{ background: activo ? 'rgba(255,255,255,.35)' : col }}
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
                    {inicialesUsuario(p.nombre, p.email)}
                  </span>
                  {p.nombre} <span className="opacity-70">({p.total})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Filtro por empresa */}
        {empresasFiltro.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mr-1 inline-flex items-center gap-1">
              <Building2 size={12} /> Empresa
            </span>
            <button onClick={() => setEmpresaSel('')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                empresaSel === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>
              Todas
            </button>
            {empresasFiltro.map(e => {
              const activo = empresaSel === e.id;
              return (
                <button key={e.id} onClick={() => setEmpresaSel(activo ? '' : e.id)}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                    activo ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}>
                  {e.nombre} <span className="opacity-70">({e.total})</span>
                </button>
              );
            })}
          </div>
        )}

        {cargando ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-20 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : error ? (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        ) : visibles.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-100">
            <Inbox size={36} className="text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {base.length === 0 ? 'Todavía no hay licitaciones postuladas' : 'Nada en este filtro'}
            </h3>
            <p className="text-sm text-gray-400">
              {base.length === 0
                ? <>Marca una licitación como <b>Postulada</b> en su estado y aparecerá aquí.</>
                : 'Prueba con otro resultado, perfil o empresa.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
            {visibles.map((n, i) => (
              <PostuladaCard key={n.id} n={n}
                adj={adjMap[n.licitacion_codigo] ?? null}
                cargandoAdj={!estadoCargado}
                index={i} isAdmin={!!isAdmin} empresas={empresasOpc}
                onRevertida={id => setNegocios(prev => prev.filter(x => x.id !== id))}
                onActualizada={(id, patch) => setNegocios(prev =>
                  patch.estado_pipeline && patch.estado_pipeline !== ESTADO_POSTULADA
                    ? prev.filter(x => x.id !== id)
                    : prev.map(x => x.id === id ? { ...x, ...patch } : x)
                )}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
