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
import { useRealtime } from '@/app/lib/use-realtime';
import { ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { StatCard } from '@/app/components/ui/StatCard';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import {
  Send, ExternalLink, Building2, Calendar, Loader2, Inbox, FileText,
  Award, Trophy, Users, FileCheck2, ChevronDown, ChevronUp,
  Pencil, Trash2, Undo2, X, Save, Wallet, CheckCircle2,
  XCircle, Hourglass, DoorOpen, DoorClosed, Search, Filter, ArrowUpDown,
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
  codigoEstado?: number | null;
  fechaAdjudicacion?: string | null;
  // Fecha ESTIMADA de adjudicación (planificación del organismo, de la ficha MP) — cuándo
  // se decide. Y la apertura técnica. Sirven para ordenar por "la más cercana".
  fechaEstimadaAdjudicacion?: string | null;
  fechaAperturaTecnica?: string | null;
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

// ── Chip de FECHA DE ADJUDICACIÓN ─────────────────────────────────────────────
// La info que el usuario más pide en Postuladas: ¿cuándo se decide cada una? Si ya se
// adjudicó, muestra la fecha real; si sigue en evaluación, la ESTIMADA de la ficha MP con
// el "en X días" para saber de un vistazo cuál se resuelve antes. El color sube de tono a
// medida que se acerca (o si ya se pasó la fecha estimada sin resultado).
function FechaAdjChip({ adj }: { adj: Adjudicacion | null }) {
  if (!adj) return null;
  const iso = adj.esAdjudicada ? adj.fechaAdjudicacion : adj.fechaEstimadaAdjudicacion;
  if (!iso) return null;
  const d = dayjs(iso);
  if (!d.isValid()) return null;

  if (adj.esAdjudicada) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 bg-emerald-50 border-emerald-200 text-emerald-800"
        title={`Fecha de adjudicación: ${d.format('DD/MM/YYYY')}`}>
        <Award size={11} /> Adjudicada {d.format('DD/MM/YYYY')}
      </span>
    );
  }
  const dias = d.startOf('day').diff(dayjs().startOf('day'), 'day');
  const rel = dias < 0 ? `atrasada ${-dias} d` : dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
  const tono = dias < 0 ? 'bg-rose-50 border-rose-200 text-rose-700'
    : dias <= 3 ? 'bg-orange-50 border-orange-200 text-orange-800'
    : dias <= 10 ? 'bg-sky-50 border-sky-200 text-sky-800'
    : 'bg-slate-50 border-slate-200 text-slate-600';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 ${tono}`}
      title={`Fecha estimada de adjudicación (ficha de Mercado Público): ${d.format('DD/MM/YYYY HH:mm')}`}>
      <Hourglass size={11} /> Se decide {d.format('DD/MM/YYYY')} · {rel}
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
function PostuladaCard({ n, adj, cargandoAdj, docsIniciales, index, isAdmin, empresas, onRevertida, onActualizada }: {
  n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; docsIniciales: DocCache[]; index: number;
  isAdmin: boolean; empresas: EmpresaOpc[];
  onRevertida: (id: number) => void;
  onActualizada: (id: number, patch: { monto_ofertado?: number; estado_pipeline?: string; empresa_id?: number | null; empresa_nombre?: string | null }) => void;
}) {
  const [docs, setDocs] = useState<DocCache[]>(docsIniciales);
  const [expandido, setExpandido] = useState(false);
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

  // Los documentos propios llegan ya resueltos desde el padre (una sola llamada batch).
  useEffect(() => { setDocs(docsIniciales); }, [docsIniciales]);

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
    <div className="group relative bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition-colors">
      {/* Barra de color por resultado */}
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: m.color }} />

      {/* ── FILA COMPACTA (siempre visible; clic para expandir) ─────────────── */}
      <div className="flex items-center gap-3 py-2.5 pl-4 pr-3 cursor-pointer select-none"
        onClick={() => setExpandido(e => !e)}>
        <ChevronDown size={15} className={`flex-shrink-0 text-slate-300 transition-transform ${expandido ? 'rotate-180' : ''}`} />

        {/* Identidad: código + título + organismo */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10.5px] font-mono font-semibold text-slate-400 flex-shrink-0">{n.licitacion_codigo}</span>
            <h3 className="text-[13px] font-semibold text-slate-800 truncate">{n.licitacion_nombre || 'Sin nombre'}</h3>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1 min-w-0"><Building2 size={11} className="flex-shrink-0" /><span className="truncate max-w-[220px]">{n.licitacion_organismo || '—'}</span></span>
            {isAdmin && (n.usuario_nombre || n.usuario_email) && (
              <span className="inline-flex items-center gap-1 flex-shrink-0" title={n.usuario_nombre || n.usuario_email}>
                <span style={{ background: perfilCol }} className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white text-[7px] font-bold">
                  {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Estado + fecha de decisión (lo que se ordena) */}
        <div className="hidden sm:flex flex-col items-end gap-1 flex-shrink-0">
          {!cargandoAdj && <FechaAdjChip adj={adj} />}
          <div className="flex items-center gap-1.5">
            {n.aperturada ? <AperturaChip aperturada /> : null}
            {!cargandoAdj && <ResultadoBadge r={r} pulso={r === 'ganada'} />}
          </div>
        </div>

        {/* Monto ofertado (columna fija) */}
        <div className="hidden md:block text-right flex-shrink-0 w-[104px]">
          <p className="text-[9.5px] uppercase tracking-wide text-slate-400">Ofertamos</p>
          <p className="text-[12.5px] font-bold text-slate-700 truncate">{fmtCLP(n.monto_ofertado)}</p>
        </div>

        {/* Acciones (no propagan el clic de expandir) */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {isAdmin && (
            <>
              <button onClick={() => { setEditando(true); setExpandido(true); }} title="Editar monto y estado"
                className="inline-flex items-center text-slate-300 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition-colors opacity-0 group-hover:opacity-100">
                <Pencil size={13} />
              </button>
              <button onClick={revertir} title="Quitar de Postuladas (vuelve a En proceso)"
                className="inline-flex items-center text-slate-300 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100">
                <Undo2 size={13} />
              </button>
            </>
          )}
          <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 px-1.5 py-1 rounded-lg hover:bg-indigo-50">
            Ver <ExternalLink size={12} />
          </Link>
        </div>
      </div>

      {/* En móvil, la fecha de decisión no cabe en la fila → se muestra bajo el título */}
      <div className="sm:hidden flex items-center gap-2 flex-wrap px-4 pb-2 -mt-1">
        {!cargandoAdj && <FechaAdjChip adj={adj} />}
        {!cargandoAdj && <ResultadoBadge r={r} pulso={r === 'ganada'} />}
      </div>

      {/* ── DETALLE (acordeón) ──────────────────────────────────────────────── */}
      {expandido && (
      <div className="px-4 pb-4 pt-1 border-t border-slate-100">
      {n.empresa_nombre && (
        <span className="inline-flex items-center gap-1 mb-3 mt-2 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
          <Building2 size={11} /> {n.empresa_nombre}
        </span>
      )}

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
              <div className="mt-1"><Select value={estadoEdit} onChange={setEstadoEdit}
                options={ESTADOS_PIPELINE.map(e => ({ value: e.id, label: e.label }))} /></div>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-semibold text-slate-600">Empresa con la que se postuló</span>
              <div className="mt-1"><Select value={empresaEdit} onChange={setEmpresaEdit}
                placeholder="— Sin especificar —"
                options={[{ value: '', label: '— Sin especificar —' }, ...empresas.map(e => ({ value: String(e.id), label: e.razon_social }))]} /></div>
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

      {/* Presupuesto real · Postulamos con · (resultado solo si ya se adjudicó) */}
      <div className={`grid gap-2 mt-2 ${adj?.esAdjudicada ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Presupuesto real</p>
          <p className="text-[13.5px] font-bold text-slate-800">{fmtCLP(n.licitacion_monto)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Postulamos con</p>
          <p className="text-[13.5px] font-bold text-slate-800">{fmtCLP(n.monto_ofertado)}</p>
        </div>
        {adj?.esAdjudicada && (
          <div className={`rounded-lg border px-3 py-2 ${metricaResultado.cls}`}>
            <p className={`text-[10.5px] ${metricaResultado.sub}`}>{metricaResultado.label}</p>
            <p className="text-[13.5px] font-bold">{cargandoAdj ? '…' : metricaResultado.valor}</p>
          </div>
        )}
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
      )}
    </div>
  );
}

// KPI tile — delega en la StatCard compartida (mismo estilo en todos los dashboards);
// el wrapper pp-kpi conserva la animación de entrada propia de esta página.
function KpiCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="pp-kpi h-full">
      <StatCard icon={icon} label={label} value={value} sub={sub} color={color} />
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
  const [busqueda, setBusqueda] = useState<string>('');
  // Filtros de SELECCIÓN MÚLTIPLE (mismo patrón que Analizadas/Descartadas/Historial):
  // AND entre filtros, OR dentro de cada uno; vacío = sin filtrar por esa dimensión.
  const [perfilesSel, setPerfilesSel] = useState<string[]>([]);
  const [empresasSel, setEmpresasSel] = useState<string[]>([]);
  const [resultadoSel, setResultadoSel] = useState<Resultado | ''>('');
  // Filtro por estado de MP (Publicada/Cerrada/Adjudicada/Revocada/Desierta…) + "Aperturadas".
  const [estadosMpSel, setEstadosMpSel] = useState<string[]>([]);
  // Ordenamiento de las tarjetas y carga incremental (las adjudicaciones hacen pesada cada tarjeta).
  const [orden, setOrden] = useState<'adjudicacion' | 'resultado' | 'cierre' | 'monto'>('adjudicacion');
  const [maxVisibles, setMaxVisibles] = useState(24);

  // Estado de cada postulada (adjudicación + apertura). Se resuelve TODO en el servidor en
  // una sola llamada (/api/postuladas/estado) → los totales aparecen juntos, sin animación
  // "una por una". adjMap por código; la apertura se refleja en cada negocio (n.aperturada).
  const [adjMap, setAdjMap] = useState<Record<string, Adjudicacion | null>>({});
  const [estadoCargado, setEstadoCargado] = useState(false);
  // Documentos propios de TODAS las postuladas en UNA sola llamada (evita el N+1 de un
  // fetch por tarjeta). Mapa código → docs (solo categoría DOCUMENTOS_PROPIOS).
  const [docsPropiosMap, setDocsPropiosMap] = useState<Record<string, DocCache[]>>({});

  // Tiempo real: cada evento del SSE (alguien postuló, cambió una etapa, o el cron trajo
  // adjudicaciones/aperturas desde MP) sube `version` y re-dispara toda la cadena de carga:
  // negocios → estado (adjudicación + apertura) → refresco de aperturas.
  const [version, setVersion] = useState(0);
  useRealtime(useCallback(() => setVersion(v => v + 1), []));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/negocios', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
        const todas: Negocio[] = data.negocios || [];
        // Universo = TODO lo que pasó por postulación. Incluye las que siguen en POSTULADA,
        // las marcadas POSIBLE_ADJ, y las ya resueltas/promovidas (ADJUDICADA/PERDIDA) — así
        // Postuladas es el superconjunto real y sus ganadas/perdidas CUADRAN con /adjudicadas
        // (que muestra solo ese subconjunto). El resultado se clasifica por el cache de MP.
        setNegocios(todas.filter(n => ['POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA'].includes(n.estado_pipeline || '')));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setCargando(false);
      }
    })();
  }, [version]);

  useEffect(() => {
    fetch('/api/empresas').then(r => r.json()).then(d => {
      if (d.success) setEmpresasOpc(d.empresas || []);
    }).catch(() => {});
  }, []);

  // Documentos propios de todas las postuladas en UNA sola petición batch.
  useEffect(() => {
    const codigos = negocios.map(n => n.licitacion_codigo).filter(Boolean);
    if (codigos.length === 0) return;
    let cancelado = false;
    fetch('/api/documentos/cache/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigos, categoria: 'DOCUMENTOS_PROPIOS' }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelado && d?.docs) setDocsPropiosMap(d.docs); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [negocios]);

  // Cruce con MP en UNA sola llamada al servidor (adjudicación cache-first + apertura).
  useEffect(() => {
    if (negocios.length === 0) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/postuladas/estado', { cache: 'no-store' });
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
  }, [negocios.length, version]);

  // Refresco de APERTURAS en segundo plano (rasca el portal de MP, IP chilena) DESPUÉS de pintar
  // → no bloquea la carga instantánea, pero igual detecta las aperturadas aunque el cron aún no
  // haya corrido. Fusiona el resultado en cada tarjeta (chip Aperturada) sin recargar la página.
  useEffect(() => {
    if (!estadoCargado || negocios.length === 0) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/postuladas/aperturas');
        const d = await r.json();
        if (cancelado || !d?.aperturas) return;
        setNegocios(prev => prev.map(n => ({
          ...n,
          aperturada: (n.aperturada || d.aperturas[n.licitacion_codigo]) ? 1 : 0,
        })));
      } catch { /* portal no accesible (fuera de Chile) → se queda con lo de la tabla */ }
    })();
    return () => { cancelado = true; };
  }, [estadoCargado, negocios.length, version]);

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

  // Filtro por búsqueda (nombre / código / organismo) + perfil + empresa. Base para tabs y KPIs,
  // así el buscador acota TODO (conteos incluidos), no solo la lista visible.
  const base = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return negocios
      .filter(n => !q
        || (n.licitacion_nombre || '').toLowerCase().includes(q)
        || (n.licitacion_codigo || '').toLowerCase().includes(q)
        || (n.licitacion_organismo || '').toLowerCase().includes(q))
      .filter(n => perfilesSel.length === 0 || perfilesSel.includes(n.usuario_email || n.usuario_nombre || '—'))
      .filter(n => empresasSel.length === 0 || empresasSel.includes(String(n.empresa_id || '')));
  }, [negocios, busqueda, perfilesSel, empresasSel]);

  const resultadoDeNegocio = useCallback(
    (n: Negocio): Resultado => {
      const a = adjMap[n.licitacion_codigo];
      if (a) return resultadoDe(a);
      // Sin cache aún: si ya quedó resuelta por estado, respétalo (coincide con /adjudicadas
      // durante la carga y si MP no respondiera).
      if (n.estado_pipeline === 'ADJUDICADA') return 'ganada';
      if (n.estado_pipeline === 'PERDIDA') return 'perdida';
      return 'evaluacion';
    },
    [adjMap],
  );

  // Estado de MP por postulada (texto tal cual lo entrega la API vía cache). Fallback si aún
  // no hay dato en cache: usa el estado guardado en la licitación.
  const estadoMpDe = useCallback(
    (n: Negocio): string => adjMap[n.licitacion_codigo]?.estado || n.licitacion_estado || 'Sin dato',
    [adjMap],
  );

  const APERTURADAS = '__APERTURADAS__';

  // Lista de estados MP presentes (con conteo) + entrada especial "Aperturadas".
  const estadosMp = useMemo(() => {
    const m = new Map<string, number>();
    let aperturadas = 0;
    for (const n of base) {
      m.set(estadoMpDe(n), (m.get(estadoMpDe(n)) || 0) + 1);
      if (n.aperturada) aperturadas++;
    }
    const lista = Array.from(m.entries())
      .map(([estado, total]) => ({ id: estado, label: estado, total }))
      .sort((a, b) => b.total - a.total);
    if (aperturadas > 0) lista.unshift({ id: APERTURADAS, label: 'Aperturadas', total: aperturadas });
    return lista;
  }, [base, estadoMpDe]);

  // Conteo por resultado (sobre la base filtrada por perfil/empresa).
  const conteo = useMemo(() => {
    const c = { ganada: 0, perdida: 0, evaluacion: 0 };
    for (const n of base) c[resultadoDeNegocio(n)]++;
    return c;
  }, [base, resultadoDeNegocio]);

  // Fecha en que se DECIDE una postulada (ms): si ya se adjudicó, la fecha real; si sigue en
  // evaluación, la ESTIMADA de la ficha MP. null si no hay ninguna.
  const fechaDecisionDe = useCallback((n: Negocio): number | null => {
    const adj = adjMap[n.licitacion_codigo];
    const iso = adj?.esAdjudicada ? adj?.fechaAdjudicacion : adj?.fechaEstimadaAdjudicacion;
    const t = iso ? dayjs(iso).valueOf() : NaN;
    return Number.isFinite(t) ? t : null;
  }, [adjMap]);
  // Peso de grupo para el orden "adjudicación", pensado para "las más cercanas / lo que viene":
  //   0 = pendiente que se decide A FUTURO (lo próximo — arriba, de lo más pronto a lo más lejano)
  //   1 = pendiente ATRASADA (fecha estimada ya pasó sin resultado — la más reciente primero)
  //   2 = pendiente SIN fecha en la ficha
  //   3 = ya resuelta (ganada/perdida) — al final, la más reciente primero
  const pesoDecision = useCallback((n: Negocio, fecha: number | null): number => {
    if (adjMap[n.licitacion_codigo]?.esAdjudicada) return 3;
    if (fecha == null) return 2;
    return fecha >= dayjs().startOf('day').valueOf() ? 0 : 1;
  }, [adjMap]);

  const visibles = useMemo(() => {
    return base
      .filter(n => !resultadoSel || resultadoDeNegocio(n) === resultadoSel)
      .filter(n => estadosMpSel.length === 0
        || estadosMpSel.some(sel => sel === APERTURADAS ? !!n.aperturada : estadoMpDe(n) === sel))
      .sort((a, b) => {
        if (orden === 'adjudicacion') {
          // Fecha en que se DECIDE cada una (estimada de la ficha; si ya se adjudicó, la real).
          // Orden: primero las que aún no se deciden, de la más CERCANA a la más lejana; las
          // que ya se resolvieron o no traen fecha van al final.
          const fa = fechaDecisionDe(a), fb = fechaDecisionDe(b);
          const pa = pesoDecision(a, fa), pb = pesoDecision(b, fb);
          if (pa !== pb) return pa - pb;
          if (fa && fb && fa !== fb) {
            // Futuro (0): lo más pronto primero. Atrasadas (1) y resueltas (3): lo más reciente primero.
            return pa === 0 ? fa - fb : fb - fa;
          }
          return dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf();
        }
        if (orden === 'cierre') return dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf();
        if (orden === 'monto') return (b.monto_ofertado || b.licitacion_monto || 0) - (a.monto_ofertado || a.licitacion_monto || 0);
        const da = ORDEN[resultadoDeNegocio(a)] - ORDEN[resultadoDeNegocio(b)];
        if (da !== 0) return da;
        return dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf();
      });
  }, [base, resultadoSel, resultadoDeNegocio, estadosMpSel, estadoMpDe, orden, adjMap]);

  // Al cambiar cualquier filtro se reinicia la carga incremental de tarjetas.
  useEffect(() => { setMaxVisibles(24); }, [busqueda, perfilesSel, empresasSel, estadosMpSel, resultadoSel, orden]);

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

          {/* Buscador por nombre / ID de licitación (acota tabs, KPIs y lista). */}
          <div className="relative w-full sm:w-80">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o ID de licitación…"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition"
            />
            {busqueda && (
              <button onClick={() => setBusqueda('')} title="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* KPIs */}
        {!cargando && estadoCargado && !error && base.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <KpiCard icon={<Trophy size={22} />} label="Ganadas" value={stats.ganada}
              sub={stats.exito != null ? `${stats.exito}% de efectividad` : 'Resultados en curso'} color={META.ganada.color} />
            <KpiCard icon={<XCircle size={22} />} label="Perdidas" value={stats.perdida} sub="Adjudicadas a terceros" color={META.perdida.color} />
            <KpiCard icon={<Hourglass size={22} />} label="En evaluación" value={stats.evaluacion} sub="Aún sin resultado" color={META.evaluacion.color} />
            <KpiCard icon={<Wallet size={22} />} label="Monto ganado" value={fmtCLP(stats.montoGanado || null)} sub="Lo adjudicado a nosotros" color="#7c3aed" />
          </div>
        )}

        {/* Barra de control: tabs de resultado + filtros multi-select + orden (una sola tarjeta) */}
        {!cargando && !error && base.length + negocios.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 mb-5">
            {/* Tabs de resultado (segmentado) */}
            {estadoCargado && (
              <div className="flex flex-wrap gap-2 mb-3">
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

            {/* Filtros combinables + orden */}
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                <Filter size={12} /> Filtros
              </span>
              {isAdmin && perfiles.length > 1 && (
                <MultiSelect label="Perfil" icon={<Users size={13} />} selected={perfilesSel} onChange={setPerfilesSel}
                  options={perfiles.map(p => ({ value: p.email, label: p.nombre, color: colorUsuario(p.email), count: p.total }))} />
              )}
              {empresasFiltro.length > 1 && (
                <MultiSelect label="Empresa" icon={<Building2 size={13} />} selected={empresasSel} onChange={setEmpresasSel} minWidth={260}
                  options={empresasFiltro.map(e => ({ value: e.id, label: e.nombre, count: e.total }))} />
              )}
              {estadosMp.length > 1 && (
                <MultiSelect label="Estado MP" icon={<FileText size={13} />} selected={estadosMpSel} onChange={setEstadosMpSel} minWidth={230}
                  options={estadosMp.map(e => ({
                    value: e.id, label: e.label, count: e.total,
                    color: e.id === APERTURADAS ? '#0284c7' : undefined,
                  }))} />
              )}
              <div className="inline-flex items-center gap-1.5 ml-auto">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                  <ArrowUpDown size={12} /> Ordenar
                </span>
                <Select value={orden} onChange={v => setOrden(v as typeof orden)}
                  options={[
                    { value: 'adjudicacion', label: 'Adjudicación más cercana' },
                    { value: 'resultado', label: 'Resultado' },
                    { value: 'cierre', label: 'Cierre reciente' },
                    { value: 'monto', label: 'Monto (mayor)' },
                  ]} />
              </div>
            </div>

            {/* Chips de filtros activos */}
            {(perfilesSel.length > 0 || empresasSel.length > 0 || estadosMpSel.length > 0 || busqueda) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <span className="text-[11px] text-slate-400">Filtrando:</span>
                {busqueda && (
                  <button onClick={() => setBusqueda('')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 hover:opacity-75">
                    <Search size={10} /> “{busqueda}” <X size={11} />
                  </button>
                )}
                {perfilesSel.map(p => {
                  const per = perfiles.find(x => x.email === p);
                  const col = colorUsuario(p);
                  return (
                    <button key={p} onClick={() => setPerfilesSel(a => a.filter(x => x !== p))}
                      style={{ background: col + '18', color: col, borderColor: col + '40' }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border hover:opacity-75">
                      {per?.nombre || p} <X size={11} />
                    </button>
                  );
                })}
                {empresasSel.map(id => (
                  <button key={id} onClick={() => setEmpresasSel(a => a.filter(x => x !== id))}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 hover:opacity-75 max-w-[220px]">
                    <span className="truncate">{empresasFiltro.find(e => e.id === id)?.nombre || `Empresa ${id}`}</span> <X size={11} className="flex-shrink-0" />
                  </button>
                ))}
                {estadosMpSel.map(id => (
                  <button key={id} onClick={() => setEstadosMpSel(a => a.filter(x => x !== id))}
                    className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border hover:opacity-75 ${
                      id === APERTURADAS ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>
                    {id === APERTURADAS ? <DoorOpen size={11} /> : null}
                    {id === APERTURADAS ? 'Aperturadas' : id} <X size={11} />
                  </button>
                ))}
                <button onClick={() => { setBusqueda(''); setPerfilesSel([]); setEmpresasSel([]); setEstadosMpSel([]); }}
                  className="text-[11px] font-semibold text-slate-400 hover:text-red-600 underline ml-1">
                  Limpiar todo
                </button>
              </div>
            )}
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
              {negocios.length === 0 ? 'Todavía no hay licitaciones postuladas' : 'Nada en este filtro'}
            </h3>
            <p className="text-sm text-gray-400">
              {negocios.length === 0
                ? <>Marca una licitación como <b>Postulada</b> en su estado y aparecerá aquí.</>
                : busqueda ? 'Prueba con otro nombre o ID de licitación.' : 'Prueba con otro resultado, perfil o empresa.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {visibles.slice(0, maxVisibles).map((n, i) => (
                <PostuladaCard key={n.id} n={n}
                  adj={adjMap[n.licitacion_codigo] ?? null}
                  cargandoAdj={!estadoCargado}
                  docsIniciales={docsPropiosMap[n.licitacion_codigo] || []}
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
            {visibles.length > maxVisibles && (
              <div className="flex justify-center mt-5">
                <button onClick={() => setMaxVisibles(m => m + 24)}
                  className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-400 hover:shadow-sm px-5 py-2.5 rounded-xl transition-all">
                  <ChevronDown size={15} />
                  Mostrar más ({visibles.length - maxVisibles} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
