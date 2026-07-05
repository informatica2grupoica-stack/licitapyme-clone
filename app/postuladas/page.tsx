'use client';

// Apartado "Postuladas": licitaciones marcadas como POSTULADA (estado 7POSTULADO_JV).
// Muestra el presupuesto REAL de la licitación vs el MONTO OFERTADO (lo que se postuló),
// y los documentos PROPIOS subidos (incluido el costeo).
//
// Roles: cada perfil ve SOLO sus postuladas; el admin ve TODAS y puede filtrarlas por
// perfil (igual que en Negocios) — el filtrado por rol ya lo hace /api/negocios.
//
// Adjudicación: al pinchar/cargar cada tarjeta se consulta EN VIVO la API de Mercado
// Público (/api/licitacion-adjudicacion). Si MP ya adjudicó (CodigoEstado 8) se muestra
// el "resultado aperturado": ganador por línea, monto, N° de oferentes y link al acta.

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { getEstadoPipeline } from '@/app/lib/pipeline';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import {
  Send, ExternalLink, Building2, Calendar, Loader2, Inbox, FileText,
  Award, Trophy, Users, FileCheck2, ChevronDown, ChevronUp,
} from 'lucide-react';
import dayjs from 'dayjs';

const ESTADO_POSTULADA = '7POSTULADO_JV';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  estado_pipeline: string | null;
  monto_ofertado?: number;
  usuario_nombre?: string;
  usuario_email?: string;
}
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
}
interface Adjudicacion {
  esAdjudicada: boolean;
  estado?: string;
  fechaAdjudicacion?: string | null;
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

// ── Bloque "Resultado de adjudicación" ────────────────────────────────────────
function BloqueAdjudicacion({ adj }: { adj: Adjudicacion }) {
  const [abierto, setAbierto] = useState(false);
  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
            <Trophy size={11} /> Adjudicada
          </span>
          {adj.fechaAdjudicacion && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
              <Calendar size={11} /> {dayjs(adj.fechaAdjudicacion).format('DD/MM/YYYY')}
            </span>
          )}
          {meta?.numeroOferentes != null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
              <Users size={11} /> {meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}
            </span>
          )}
          {meta?.numeroResolucion && (
            <span className="text-[11px] text-emerald-700">Res. N° {meta.numeroResolucion}</span>
          )}
          {adj.montoAdjudicadoTotal ? (
            <span className="ml-auto text-[12px] font-bold text-emerald-800">
              Adjudicado: {fmtCLP(adj.montoAdjudicadoTotal)}
            </span>
          ) : null}
        </div>

        {/* Detalle por línea (aperturado): quién ganó y por cuánto */}
        {lineas.length > 0 && (
          <>
            <button
              onClick={() => setAbierto(o => !o)}
              className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700 hover:text-emerald-800"
            >
              {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {abierto ? 'Ocultar' : 'Ver'} adjudicación por línea ({lineas.length})
            </button>
            {abierto && (
              <div className="mt-2 space-y-1.5">
                {lineas.map((l, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 bg-white border border-emerald-100 rounded-lg px-2.5 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-medium text-slate-700 truncate" title={l.producto || l.descripcion}>
                        {l.producto || l.descripcion || `Línea ${l.correlativo ?? i + 1}`}
                      </p>
                      <p className="text-[10.5px] text-emerald-700 truncate" title={`${l.proveedor || ''} ${l.rutProveedor || ''}`}>
                        <Award size={9} className="inline mr-0.5" />
                        {l.proveedor || 'Proveedor adjudicado'}
                        {l.rutProveedor ? ` · ${l.rutProveedor}` : ''}
                      </p>
                    </div>
                    <span className="text-[11.5px] font-bold text-slate-800 whitespace-nowrap">
                      {fmtCLP(l.montoUnitario)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {meta?.urlActa && (
          <a href={meta.urlActa} target="_blank" rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700 hover:text-emerald-800">
            <FileCheck2 size={12} /> Ver acta de adjudicación <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

// Tarjeta: carga sus documentos PROPIOS y su estado de adjudicación de forma perezosa.
function PostuladaCard({ n, color, label, isAdmin }: { n: Negocio; color: string; label: string; isAdmin: boolean }) {
  const [docs, setDocs] = useState<DocCache[]>([]);
  const [adj, setAdj] = useState<Adjudicacion | null>(null);
  const perfilCol = colorUsuario(n.usuario_email || n.usuario_nombre || '');

  useEffect(() => {
    fetch(`/api/documentos/cache/${encodeURIComponent(n.licitacion_codigo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const todos: DocCache[] = d?.documentos || d?.docs || [];
        setDocs(todos.filter(x => (x.categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS'));
      })
      .catch(() => {});
  }, [n.licitacion_codigo]);

  // Sondeo de adjudicación en vivo contra Mercado Público.
  useEffect(() => {
    fetch(`/api/licitacion-adjudicacion/${encodeURIComponent(n.licitacion_codigo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.success && d.esAdjudicada) setAdj(d); })
      .catch(() => {});
  }, [n.licitacion_codigo]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors"
      style={isAdmin ? { borderLeftColor: perfilCol, borderLeftWidth: 3 } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[11px] font-mono font-semibold text-slate-500">{n.licitacion_codigo}</span>
            {adj?.esAdjudicada ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                <Trophy size={10} /> Adjudicada
              </span>
            ) : (
              <span style={{ backgroundColor: color + '18', color, borderColor: color + '40' }}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border">
                <span style={{ backgroundColor: color }} className="w-1 h-1 rounded-full" />{label}
              </span>
            )}
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
            <span className="inline-flex items-center gap-1"><Building2 size={12} />{n.licitacion_organismo || '—'}</span>
            {n.licitacion_cierre && <span className="inline-flex items-center gap-1"><Calendar size={12} />{dayjs(n.licitacion_cierre).format('DD/MM/YYYY')}</span>}
          </div>
        </div>
        <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
          className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
          Ver <ExternalLink size={12} />
        </Link>
      </div>

      {/* Presupuesto real vs monto ofertado */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Presupuesto real</p>
          <p className="text-[14px] font-bold text-slate-800">{fmtCLP(n.licitacion_monto)}</p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <p className="text-[10.5px] text-amber-700">Postulamos con</p>
          <p className="text-[14px] font-bold text-amber-800">{fmtCLP(n.monto_ofertado)}</p>
        </div>
      </div>

      {/* Resultado de adjudicación (si MP ya adjudicó) */}
      {adj?.esAdjudicada && <BloqueAdjudicacion adj={adj} />}

      {/* Documentos propios subidos (incluido el costeo) */}
      {docs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Documentos propios ({docs.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {docs.map((d, i) => (
              <a key={i} href={d.documento_url_local} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11.5px] text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md px-2 py-1 transition-colors max-w-[220px]">
                <FileText size={11} className="flex-shrink-0 text-slate-400" />
                <span className="truncate">{d.documento_nombre}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PostuladasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfilSel, setPerfilSel] = useState<string>(''); // email del perfil (solo admin)

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

  const badge = getEstadoPipeline(ESTADO_POSTULADA);
  const color = badge?.color ?? '#B45309';
  const label = badge?.label ?? 'POSTULADA';

  // Perfiles presentes (para el filtro del admin), con su conteo.
  const perfiles = useMemo(() => {
    const m = new Map<string, { email: string; nombre: string; total: number }>();
    for (const n of negocios) {
      const email = n.usuario_email || n.usuario_nombre || '—';
      const e = m.get(email) || { email, nombre: n.usuario_nombre || n.usuario_email || '—', total: 0 };
      e.total++;
      m.set(email, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [negocios]);

  const visibles = useMemo(
    () => (perfilSel ? negocios.filter(n => (n.usuario_email || n.usuario_nombre) === perfilSel) : negocios),
    [negocios, perfilSel],
  );

  return (
    <AppLayout breadcrumb={[{ label: 'Postuladas' }]}>
      <div className="max-w-5xl mx-auto p-5 sm:p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="p-1.5 rounded-lg" style={{ backgroundColor: color + '18', color }}><Send size={18} /></span>
          <h1 className="text-[19px] font-bold text-slate-800">Postuladas</h1>
          <span className="ml-1 text-[12px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{visibles.length}</span>
        </div>
        <p className="text-[12.5px] text-slate-500 mb-4">
          {isAdmin
            ? 'Todas las licitaciones postuladas por los perfiles. Cuando Mercado Público adjudica, aparece el resultado (ganador, monto y acta).'
            : 'Tus licitaciones postuladas, con el monto ofertado y tus documentos. Cuando Mercado Público publique el resultado verás quién se adjudicó.'}
        </p>

        {/* Filtro por perfil (solo admin) */}
        {isAdmin && perfiles.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setPerfilSel('')}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                perfilSel === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}>
              Todos <span className="opacity-70">({negocios.length})</span>
            </button>
            {perfiles.map(p => {
              const activo = perfilSel === p.email;
              const col = colorUsuario(p.email);
              return (
                <button key={p.email} onClick={() => setPerfilSel(activo ? '' : p.email)}
                  style={activo ? { backgroundColor: col, borderColor: col } : { borderColor: col + '55' }}
                  className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
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

        {cargando ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : error ? (
          <div className="text-red-600 text-sm py-10 text-center">{error}</div>
        ) : visibles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 text-slate-400 py-16">
            <Inbox size={28} />
            <p className="text-sm">Todavía no hay licitaciones postuladas.</p>
            <p className="text-[12px]">Marca una licitación como <b>Postulada</b> en su estado y aparecerá aquí.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visibles.map(n => <PostuladaCard key={n.id} n={n} color={color} label={label} isAdmin={!!isAdmin} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
