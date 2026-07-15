'use client';

// Apartado "Adjudicadas" — el RESULTADO ya resuelto de las postuladas.
//
// Cuando MP publica el resultado, el cron auto-promueve la postulada a ADJUDICADA (ganamos
// ≥1 línea con una de nuestras empresas) o PERDIDA (se adjudicó a terceros). Aquí viven esas
// licitaciones ya cerradas, con dos pestañas: Ganadas | Perdidas. Los datos de adjudicación
// (líneas, acta, montos) se traen de MP vía /api/licitacion-adjudicacion (cache final).
//
// Roles: cada perfil ve SOLO lo suyo; el admin ve todo y filtra por perfil/empresa. El
// filtrado por rol lo hace /api/negocios.

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useRealtime } from '@/app/lib/use-realtime';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import {
  Trophy, XCircle, ExternalLink, Building2, Calendar, Loader2, Inbox,
  Award, Users, FileCheck2, ChevronDown, ChevronUp, CheckCircle2, Wallet, Target,
} from 'lucide-react';
import dayjs from 'dayjs';

type Resultado = 'ganada' | 'perdida';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  estado_pipeline: string | null;
  monto_ofertado?: number;
  empresa_id?: number | null;
  empresa_nombre?: string | null;
  usuario_nombre?: string;
  usuario_email?: string;
}
interface LineaAdjudicada {
  correlativo?: number; producto?: string; descripcion?: string; cantidad?: number;
  montoUnitario: number | null; rutProveedor: string | null; proveedor: string | null; esNuestra?: boolean;
}
interface Adjudicacion {
  esAdjudicada: boolean; fechaAdjudicacion?: string | null; ganamos?: boolean; montoNuestro?: number | null;
  adjudicacion?: { numeroResolucion?: string | null; numeroOferentes?: number | null; urlActa?: string | null } | null;
  lineasAdjudicadas?: LineaAdjudicada[]; montoAdjudicadoTotal?: number | null;
}

function fmtCLP(n: number | null | undefined) {
  if (n == null || n === 0) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

const META: Record<Resultado, { label: string; short: string; color: string; icon: typeof Trophy }> = {
  ganada:  { label: 'Ganada',  short: 'Ganadas',  color: '#059669', icon: Trophy },
  perdida: { label: 'Perdida', short: 'Perdidas', color: '#dc2626', icon: XCircle },
};

// Resultado real: si tenemos el detalle de adjudicación (cache MP), manda ESE (ganamos por RUT
// ≥1 línea). Si aún no cargó, caemos al estado ya promovido. Así no dependemos de que el cron
// haya movido estado_pipeline: la verdad es la misma que ve Postuladas.
function resultadoDe(n: Negocio, adj?: Adjudicacion | null): Resultado {
  if (adj && adj.esAdjudicada) return adj.ganamos ? 'ganada' : 'perdida';
  return n.estado_pipeline === 'PERDIDA' ? 'perdida' : 'ganada';
}


// ── Detalle de adjudicación (líneas + acta) ───────────────────────────────────
function BloqueAdjudicacion({ adj, ganamos }: { adj: Adjudicacion; ganamos: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const acc = ganamos ? META.ganada : META.perdida;
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
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Calendar size={11} /> {dayjs(adj.fechaAdjudicacion).format('DD/MM/YYYY')}</span>
          )}
          {meta?.numeroOferentes != null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Users size={11} /> {meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}</span>
          )}
          {meta?.numeroResolucion && <span className="text-[11px] text-slate-500">Res. N° {meta.numeroResolucion}</span>}
        </div>

        {lineas.length > 0 && (
          <>
            <button onClick={() => setAbierto(o => !o)}
              className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 hover:text-slate-800 transition-colors">
              {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {abierto ? 'Ocultar' : 'Ver'} adjudicación por línea ({lineas.length})
            </button>
            {abierto && (
              <div className="mt-2 space-y-1.5">
                {lineas.map((l, i) => (
                  <div key={i} className={`flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 border ${l.esNuestra ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-medium text-slate-700 truncate" title={l.producto || l.descripcion}>{l.producto || l.descripcion || `Línea ${l.correlativo ?? i + 1}`}</p>
                      <p className={`text-[10.5px] truncate ${l.esNuestra ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`} title={`${l.proveedor || ''} ${l.rutProveedor || ''}`}>
                        {l.esNuestra ? <CheckCircle2 size={10} className="inline mr-0.5 -mt-0.5" /> : <Award size={9} className="inline mr-0.5" />}
                        {l.proveedor || 'Proveedor adjudicado'}{l.rutProveedor ? ` · ${l.rutProveedor}` : ''}
                      </p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {l.esNuestra && <span className="block text-[8.5px] font-black tracking-wide text-emerald-600 uppercase">Nosotros</span>}
                      <span className="text-[11.5px] font-bold text-slate-800">{fmtCLP(l.montoUnitario)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {meta?.urlActa && (
          <a href={meta.urlActa} target="_blank" rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold hover:underline" style={{ color: acc.color }}>
            <FileCheck2 size={12} /> Ver acta de adjudicación <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta ───────────────────────────────────────────────────────────────────
function Card({ n, adj, cargandoAdj, isAdmin }: { n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; isAdmin: boolean }) {
  const r = resultadoDe(n, adj);
  const m = META[r];
  const perfilCol = colorUsuario(n.usuario_email || n.usuario_nombre || '');
  const metrica = r === 'ganada'
    ? { label: 'Ganamos', valor: fmtCLP(adj?.montoNuestro ?? n.monto_ofertado ?? null), cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', sub: 'text-emerald-700' }
    : { label: 'Adjudicado (total)', valor: fmtCLP(adj?.montoAdjudicadoTotal), cls: 'bg-rose-50 border-rose-200 text-rose-800', sub: 'text-rose-700' };

  return (
    <div className="relative bg-white border border-slate-200 rounded-2xl p-4 pl-5 overflow-hidden hover:shadow-lg transition-all duration-300">
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: m.color }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-mono font-semibold text-slate-500">{n.licitacion_codigo}</span>
            <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-bold border"
              style={{ backgroundColor: m.color + '16', color: m.color, borderColor: m.color + '3d' }}>
              <m.icon size={11} /> {m.label}
            </span>
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
        <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
          className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
          Ver <ExternalLink size={12} />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Presupuesto real</p>
          <p className="text-[13.5px] font-bold text-slate-800">{fmtCLP(n.licitacion_monto)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10.5px] text-slate-500">Postulamos con</p>
          <p className="text-[13.5px] font-bold text-slate-800">{fmtCLP(n.monto_ofertado)}</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${metrica.cls}`}>
          <p className={`text-[10.5px] ${metrica.sub}`}>{metrica.label}</p>
          <p className="text-[13.5px] font-bold">{cargandoAdj ? '…' : metrica.valor}</p>
        </div>
      </div>

      {adj?.esAdjudicada
        ? <BloqueAdjudicacion adj={adj} ganamos={r === 'ganada'} />
        : !cargandoAdj && (
            <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <Award size={12} /> Sin detalle de adjudicación en Mercado Público
            </div>
          )}
    </div>
  );
}

function KpiCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1">{label}</p>
          <p className="text-[26px] font-black leading-none tabular-nums text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1 truncate">{sub}</p>}
        </div>
        <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: color + '18', color }}>{icon}</div>
      </div>
    </div>
  );
}

export default function AdjudicadasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfilSel, setPerfilSel] = useState<string>('');
  const [resultadoSel, setResultadoSel] = useState<Resultado | ''>('');

  const [adjMap, setAdjMap] = useState<Record<string, Adjudicacion | null>>({});
  const [resueltos, setResueltos] = useState<Set<string>>(new Set());
  // El cruce con el cache llega en 1 llamada. Hasta que esté, no pintamos conteos (evita el
  // salto de "solo promovidas" → total). Así el resultado aparece completo de una.
  const [cruceListo, setCruceListo] = useState(false);

  // Tiempo real: el cron de 2h refresca el cache de adjudicación desde MP y publica un
  // evento; también llega cuando alguien mueve una postulada. Sube `version` → recarga.
  const [version, setVersion] = useState(0);
  useRealtime(useCallback(() => setVersion(v => v + 1), []));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/negocios', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
        const todas: Negocio[] = data.negocios || [];
        // Universo amplio: además de las ya promovidas (ADJUDICADA/PERDIDA), incluimos las que
        // siguen en POSTULADA pero MP ya adjudicó. El gate `esResuelta` (por cache) deja solo las
        // realmente resueltas → el resultado real aparece aquí sin esperar la promoción del cron.
        const univ = todas.filter(n => ['ADJUDICADA', 'PERDIDA', 'POSTULADA', 'POSIBLE_ADJ'].includes(n.estado_pipeline || ''));
        setNegocios(univ);
        if (univ.length === 0) setCruceListo(true); // nada que cruzar
      } catch (e: any) { setError(String(e?.message ?? e)); }
      finally { setCargando(false); }
    })();
  }, [version]);

  // Cruce con la adjudicación en UNA sola llamada al servidor (SOLO cache de la BD, sin tocar
  // MP): el resultado aparece de una, sin ir subiendo progresivamente y sin recargar cada vez.
  // El refresco lo hace el cron cada 2h cuando MP publica un cambio de estado.
  useEffect(() => {
    if (negocios.length === 0) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/postuladas/estado', { cache: 'no-store' });
        const d = await r.json();
        if (cancelado) return;
        if (d?.estados) setAdjMap(d.estados);
      } catch { /* sin cruce → cae a la clasificación por estado */ }
      finally {
        if (!cancelado) {
          setResueltos(new Set(negocios.map(n => n.licitacion_codigo).filter(Boolean)));
          setCruceListo(true);
        }
      }
    })();
    return () => { cancelado = true; };
  }, [negocios]);

  // Gate de "resuelta": manda el cache de adjudicación (esAdjudicada); si aún no cargó, el estado
  // ya promovido. Solo las resueltas se muestran en Adjudicadas.
  const esResuelta = useCallback((n: Negocio) => {
    const a = adjMap[n.licitacion_codigo];
    if (a) return a.esAdjudicada;
    return n.estado_pipeline === 'ADJUDICADA' || n.estado_pipeline === 'PERDIDA';
  }, [adjMap]);
  const resueltas = useMemo(() => negocios.filter(esResuelta), [negocios, esResuelta]);

  const perfiles = useMemo(() => {
    const m = new Map<string, { email: string; nombre: string; total: number }>();
    for (const n of resueltas) {
      const email = n.usuario_email || n.usuario_nombre || '—';
      const e = m.get(email) || { email, nombre: n.usuario_nombre || n.usuario_email || '—', total: 0 };
      e.total++; m.set(email, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [resueltas]);

  const base = useMemo(
    () => resueltas.filter(n => !perfilSel || (n.usuario_email || n.usuario_nombre) === perfilSel),
    [resueltas, perfilSel]);

  const conteo = useMemo(() => {
    const c = { ganada: 0, perdida: 0 };
    for (const n of base) c[resultadoDe(n, adjMap[n.licitacion_codigo])]++;
    return c;
  }, [base, adjMap]);

  const visibles = useMemo(
    () => base.filter(n => !resultadoSel || resultadoDe(n, adjMap[n.licitacion_codigo]) === resultadoSel)
      .sort((a, b) => dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf()),
    [base, resultadoSel, adjMap]);

  const stats = useMemo(() => {
    let montoGanado = 0;
    for (const n of base) {
      if (resultadoDe(n, adjMap[n.licitacion_codigo]) !== 'ganada') continue;
      const a = adjMap[n.licitacion_codigo];
      montoGanado += (a?.montoNuestro ?? n.monto_ofertado ?? 0) || 0;
    }
    const total = conteo.ganada + conteo.perdida;
    return { montoGanado, exito: total ? Math.round((conteo.ganada / total) * 100) : null };
  }, [base, conteo, adjMap]);

  const TABS: { id: Resultado | ''; label: string; count: number; color: string }[] = [
    { id: '', label: 'Todas', count: base.length, color: '#334155' },
    { id: 'ganada', label: 'Ganadas', count: conteo.ganada, color: META.ganada.color },
    { id: 'perdida', label: 'Perdidas', count: conteo.perdida, color: META.perdida.color },
  ];

  // Hasta que el cruce con el cache no esté listo, tratamos la vista como "cargando" para no
  // mostrar un conteo parcial que luego salta.
  const cargandoTodo = cargando || !cruceListo;

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Adjudicadas' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Trophy size={24} className="text-emerald-600" /> Adjudicadas
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {cargandoTodo ? 'Cargando…' : `${base.length} resuelta${base.length !== 1 ? 's' : ''} · resultado real de Mercado Público`}
            </p>
          </div>
        </div>

        {!cargandoTodo && !error && base.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <KpiCard icon={<Trophy size={22} />} label="Ganadas" value={conteo.ganada} sub={stats.exito != null ? `${stats.exito}% de efectividad` : undefined} color={META.ganada.color} />
            <KpiCard icon={<XCircle size={22} />} label="Perdidas" value={conteo.perdida} sub="Adjudicadas a terceros" color={META.perdida.color} />
            <KpiCard icon={<Target size={22} />} label="Tasa de éxito" value={stats.exito != null ? `${stats.exito}%` : '—'} sub="ganadas / resueltas" color="#7c3aed" />
            <KpiCard icon={<Wallet size={22} />} label="Monto ganado" value={fmtCLP(stats.montoGanado || null)} sub="Lo adjudicado a nosotros" color="#0d9488" />
          </div>
        )}

        {!cargandoTodo && !error && base.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {TABS.map(t => {
              const activo = resultadoSel === t.id;
              return (
                <button key={t.id || 'all'} onClick={() => setResultadoSel(t.id)}
                  style={activo ? { backgroundColor: t.color, borderColor: t.color } : { borderColor: t.color + '40', color: t.color }}
                  className={`inline-flex items-center gap-2 text-[12.5px] font-bold px-3.5 py-2 rounded-xl border transition-all ${activo ? 'text-white shadow-sm' : 'bg-white hover:bg-slate-50'}`}>
                  {t.label}
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[11px] font-black"
                    style={activo ? { background: 'rgba(255,255,255,.25)', color: '#fff' } : { background: t.color + '18', color: t.color }}>{t.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {isAdmin && perfiles.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mr-1 inline-flex items-center gap-1"><Users size={12} /> Perfil</span>
            <button onClick={() => setPerfilSel('')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${perfilSel === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
              Todos <span className="opacity-70">({resueltas.length})</span>
            </button>
            {perfiles.map(p => {
              const activo = perfilSel === p.email;
              const col = colorUsuario(p.email);
              return (
                <button key={p.email} onClick={() => setPerfilSel(activo ? '' : p.email)}
                  style={activo ? { backgroundColor: col, borderColor: col } : { borderColor: col + '55' }}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${activo ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  <span style={{ background: activo ? 'rgba(255,255,255,.35)' : col }} className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
                    {inicialesUsuario(p.nombre, p.email)}
                  </span>
                  {p.nombre} <span className="opacity-70">({p.total})</span>
                </button>
              );
            })}
          </div>
        )}

        {cargandoTodo ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-20 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : error ? (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        ) : visibles.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-100">
            <Inbox size={36} className="text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {base.length === 0 ? 'Todavía no hay licitaciones resueltas' : 'Nada en este filtro'}
            </h3>
            <p className="text-sm text-gray-400">
              {base.length === 0
                ? <>Cuando Mercado Público publique el resultado de una postulada, aparecerá aquí como <b>Ganada</b> o <b>Perdida</b>.</>
                : 'Prueba con otro resultado o perfil.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
            {visibles.map(n => (
              <Card key={n.id} n={n} adj={adjMap[n.licitacion_codigo] ?? null}
                cargandoAdj={!resueltos.has(n.licitacion_codigo)} isAdmin={!!isAdmin} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
