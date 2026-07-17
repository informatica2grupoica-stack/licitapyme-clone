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
//
// UI: dos vistas conmutables (LISTA por defecto — filas expandibles con el detalle de la
// adjudicación — y TARJETAS), buscador de texto, filtros multi-select (perfil/empresa),
// orden configurable y paginación en el cliente.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useRealtime } from '@/app/lib/use-realtime';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { StatCard } from '@/app/components/ui/StatCard';
import {
  Trophy, XCircle, ExternalLink, Building2, Calendar, Inbox,
  Award, Users, FileCheck2, ChevronDown, ChevronUp, CheckCircle2, Wallet, Target,
  Search, LayoutList, LayoutGrid, X, ArrowUpDown, ChevronLeft, ChevronRight,
} from 'lucide-react';
import dayjs from 'dayjs';

type Resultado = 'ganada' | 'perdida';
type Vista = 'lista' | 'tarjetas';
type Orden = 'recientes' | 'antiguas' | 'monto_ganado' | 'presupuesto' | 'nombre';

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
  if (n == null || !Number.isFinite(n) || n === 0) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}
// Fecha defensiva: zero-dates de MySQL o basura no deben pintar "Invalid Date".
function fmtFecha(s: string | null | undefined, formato = 'DD/MM/YYYY') {
  if (!s) return '—';
  const d = dayjs(s);
  return d.isValid() ? d.format(formato) : '—';
}
const tsDe = (s: string | null | undefined) => { const d = dayjs(s ?? ''); return d.isValid() ? d.valueOf() : 0; };

const META: Record<Resultado, { label: string; short: string; color: string; icon: typeof Trophy }> = {
  ganada:  { label: 'Ganada',  short: 'Ganadas',  color: '#059669', icon: Trophy },
  perdida: { label: 'Perdida', short: 'Perdidas', color: '#dc2626', icon: XCircle },
};

const OPCIONES_ORDEN: { value: Orden; label: string }[] = [
  { value: 'recientes', label: 'Más recientes' },
  { value: 'antiguas', label: 'Más antiguas' },
  { value: 'monto_ganado', label: 'Monto del resultado' },
  { value: 'presupuesto', label: 'Presupuesto' },
  { value: 'nombre', label: 'Nombre A-Z' },
];

// Resultado real: si el cache de MP trae el dato COMPLETO (esAdjudicada + ganamos calculado),
// manda ese. Si viene parcial o aún no cargó, cae al estado ya promovido por el cron.
function resultadoDe(n: Negocio, adj?: Adjudicacion | null): Resultado {
  if (adj?.esAdjudicada && typeof adj.ganamos === 'boolean') return adj.ganamos ? 'ganada' : 'perdida';
  return n.estado_pipeline === 'PERDIDA' ? 'perdida' : 'ganada';
}

// Monto que mostramos como "resultado": lo ganado por nosotros o el total adjudicado a terceros.
function montoResultado(n: Negocio, adj: Adjudicacion | null, r: Resultado): number | null {
  if (r === 'ganada') return adj?.montoNuestro ?? n.monto_ofertado ?? null;
  return adj?.montoAdjudicadoTotal ?? null;
}

// ── Detalle de adjudicación (líneas + acta) ───────────────────────────────────
function BloqueAdjudicacion({ adj, ganamos, defaultAbierto = false }: { adj: Adjudicacion; ganamos: boolean; defaultAbierto?: boolean }) {
  const [abierto, setAbierto] = useState(defaultAbierto);
  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const acc = ganamos ? META.ganada : META.perdida;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: acc.color + '33', background: acc.color + '0c' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border"
          style={{ color: acc.color, background: acc.color + '18', borderColor: acc.color + '33' }}>
          {ganamos ? <Trophy size={11} /> : <Award size={11} />}
          {ganamos ? (nuestras > 0 ? `Ganamos ${nuestras} línea${nuestras !== 1 ? 's' : ''}` : 'Ganada') : 'Adjudicada a terceros'}
        </span>
        {adj.fechaAdjudicacion && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Calendar size={11} /> {fmtFecha(adj.fechaAdjudicacion)}</span>
        )}
        {meta?.numeroOferentes != null && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Users size={11} /> {meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}</span>
        )}
        {meta?.numeroResolucion && <span className="text-[11px] text-slate-500">Res. N° {meta.numeroResolucion}</span>}
      </div>

      {lineas.length > 0 && (
        <>
          <button onClick={() => setAbierto(o => !o)} aria-expanded={abierto}
            className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 hover:text-slate-800 transition-colors">
            {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {abierto ? 'Ocultar' : 'Ver'} adjudicación por línea ({lineas.length})
          </button>
          <div className="colapsable" data-abierto={abierto ? '1' : '0'}>
            <div className="colapsable-inner">
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
                      {l.esNuestra && <span className="block text-[9px] font-black tracking-wide text-emerald-600 uppercase">Nosotros</span>}
                      <span className="text-[11.5px] font-bold text-slate-800">{fmtCLP(l.montoUnitario)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {meta?.urlActa && (
        <a href={meta.urlActa} target="_blank" rel="noopener noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold hover:underline" style={{ color: acc.color }}>
          <FileCheck2 size={12} /> Ver acta de adjudicación <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

// ── Chips compartidos entre vistas ────────────────────────────────────────────
function BadgeResultado({ r }: { r: Resultado }) {
  const m = META[r];
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-bold border whitespace-nowrap"
      style={{ backgroundColor: m.color + '16', color: m.color, borderColor: m.color + '3d' }}>
      <m.icon size={11} /> {m.label}
    </span>
  );
}

function ChipPerfil({ n }: { n: Negocio }) {
  if (!n.usuario_nombre && !n.usuario_email) return null;
  const col = colorUsuario(n.usuario_email || n.usuario_nombre || '');
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium min-w-0" title={n.usuario_email}>
      <span style={{ background: col }} className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[8.5px] font-bold flex-shrink-0">
        {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
      </span>
      <span className="truncate">{n.usuario_nombre || n.usuario_email}</span>
    </span>
  );
}

// ── Vista TARJETA ─────────────────────────────────────────────────────────────
function Card({ n, adj, cargandoAdj, isAdmin }: { n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; isAdmin: boolean }) {
  const r = resultadoDe(n, adj);
  const m = META[r];
  const metrica = r === 'ganada'
    ? { label: 'Ganamos', valor: fmtCLP(adj?.montoNuestro ?? n.monto_ofertado ?? null), cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', sub: 'text-emerald-700' }
    : { label: 'Adjudicado (total)', valor: fmtCLP(adj?.montoAdjudicadoTotal), cls: 'bg-rose-50 border-rose-200 text-rose-800', sub: 'text-rose-700' };

  return (
    <div className="relative bg-white border border-slate-200 rounded-2xl p-4 pl-5 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: m.color }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-mono font-semibold text-slate-500">{n.licitacion_codigo}</span>
            <BadgeResultado r={r} />
            {isAdmin && <ChipPerfil n={n} />}
          </div>
          <h3 className="text-[14px] font-semibold text-slate-800 line-clamp-2 leading-snug" title={n.licitacion_nombre}>{n.licitacion_nombre || 'Sin nombre'}</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[12px] text-slate-500">
            <span className="inline-flex items-center gap-1 min-w-0"><Building2 size={12} className="flex-shrink-0" /><span className="truncate max-w-[240px]">{n.licitacion_organismo || '—'}</span></span>
            {n.licitacion_cierre && <span className="inline-flex items-center gap-1"><Calendar size={12} />{fmtFecha(n.licitacion_cierre)}</span>}
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
        ? <div className="mt-3 pt-3 border-t border-slate-100"><BloqueAdjudicacion adj={adj} ganamos={r === 'ganada'} /></div>
        : !cargandoAdj && (
            <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <Award size={12} /> Sin detalle de adjudicación en Mercado Público
            </div>
          )}
    </div>
  );
}

// ── Vista LISTA (fila expandible) ─────────────────────────────────────────────
// Los templates del grid se declaran COMPLETOS (Tailwind los extrae estáticamente):
// para no-admin la columna Perfil no existe (evita un hueco muerto de 150px).
const GRID_ADMIN = 'lg:grid-cols-[minmax(0,1fr)_150px_170px_130px_96px_70px]';
const GRID_USER  = 'lg:grid-cols-[minmax(0,1fr)_170px_130px_96px_70px]';

function Fila({ n, adj, cargandoAdj, isAdmin }: { n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; isAdmin: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const r = resultadoDe(n, adj);
  const m = META[r];
  const monto = montoResultado(n, adj, r);
  const lineas = adj?.lineasAdjudicadas || [];
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const expandible = !!adj?.esAdjudicada;

  return (
    <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden transition-shadow hover:shadow-md">
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: m.color }} />
      <div
        role={expandible ? 'button' : undefined}
        tabIndex={expandible ? 0 : undefined}
        aria-expanded={expandible ? abierta : undefined}
        aria-label={expandible ? `Detalle de ${n.licitacion_codigo}` : undefined}
        onClick={() => expandible && setAbierta(o => !o)}
        onKeyDown={e => {
          // Solo cuando el evento nace en la FILA: si viene de un link/botón interno
          // (p.ej. Enter sobre "Ver"), se respeta la acción del elemento.
          if (e.target !== e.currentTarget) return;
          if (expandible && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setAbierta(o => !o); }
        }}
        className={`grid grid-cols-[1fr_auto] ${isAdmin ? GRID_ADMIN : GRID_USER} items-center gap-x-3 gap-y-1 pl-4 pr-3 py-2.5 ${expandible ? 'cursor-pointer' : ''}`}>

        {/* Código + nombre + organismo */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10.5px] font-mono font-semibold text-slate-500">{n.licitacion_codigo}</span>
            <BadgeResultado r={r} />
            {r === 'ganada' && nuestras > 0 && (
              <span className="hidden sm:inline-flex text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-px">
                {nuestras} línea{nuestras !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-slate-800 truncate mt-0.5" title={n.licitacion_nombre}>{n.licitacion_nombre || 'Sin nombre'}</p>
          <p className="text-[11px] text-slate-500 truncate flex items-center gap-1"><Building2 size={10} className="flex-shrink-0" />{n.licitacion_organismo || '—'}</p>
        </div>

        {/* Perfil (solo admin: la columna no existe para usuarios) */}
        {isAdmin && <div className="hidden lg:block min-w-0"><ChipPerfil n={n} /></div>}

        {/* Empresa */}
        <div className="hidden lg:block min-w-0">
          {n.empresa_nombre
            ? <span className="inline-flex items-center gap-1 max-w-full text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5"><Building2 size={10} className="flex-shrink-0" /><span className="truncate">{n.empresa_nombre}</span></span>
            : <span className="text-[11px] text-slate-400">—</span>}
        </div>

        {/* Monto resultado */}
        <div className="hidden lg:block text-right">
          <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: m.color }}>{r === 'ganada' ? 'Ganamos' : 'Adjudicado'}</p>
          <p className="text-[13px] font-bold text-slate-800 tabular-nums">{cargandoAdj ? '…' : fmtCLP(monto)}</p>
        </div>

        {/* Fecha cierre */}
        <div className="hidden lg:block text-right">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Cierre</p>
          <p className="text-[12px] font-semibold text-slate-600 tabular-nums">{fmtFecha(n.licitacion_cierre, 'DD/MM/YY')}</p>
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-1 row-start-1 col-start-2 lg:row-auto lg:col-auto">
          <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            title="Ver licitación"
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors">
            <ExternalLink size={14} />
          </Link>
          {expandible && (
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400">
              {abierta ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          )}
        </div>

        {/* Resumen compacto en móvil (con etiqueta del monto: en perdidas es plata de terceros) */}
        <div className="lg:hidden col-span-2 flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
          {isAdmin && <ChipPerfil n={n} />}
          {n.empresa_nombre && <span className="inline-flex items-center gap-1 font-semibold text-indigo-700"><Building2 size={10} />{n.empresa_nombre}</span>}
          <span className="inline-flex items-center gap-1">
            <span className="font-semibold uppercase text-[9.5px] tracking-wide" style={{ color: m.color }}>{r === 'ganada' ? 'Ganamos' : 'Adjudicado'}</span>
            <span className="font-bold text-slate-700 tabular-nums">{cargandoAdj ? '…' : fmtCLP(monto)}</span>
          </span>
          {n.licitacion_cierre && <span className="inline-flex items-center gap-1"><Calendar size={10} />{fmtFecha(n.licitacion_cierre, 'DD/MM/YY')}</span>}
        </div>
      </div>

      {/* Detalle expandido — con transición de altura (grid 0fr→1fr) */}
      {expandible && (
        <div className="colapsable" data-abierto={abierta ? '1' : '0'}>
          <div className="colapsable-inner">
            <div className="px-4 pb-3 pt-1 border-t border-slate-100 bg-slate-50/50">
              <p className="text-[12.5px] font-semibold text-slate-700 mt-2">{n.licitacion_nombre}</p>
              <div className="grid grid-cols-3 gap-2 my-2.5 max-w-xl">
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-1.5">
                  <p className="text-[10px] text-slate-500">Presupuesto real</p>
                  <p className="text-[12.5px] font-bold text-slate-800">{fmtCLP(n.licitacion_monto)}</p>
                </div>
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-1.5">
                  <p className="text-[10px] text-slate-500">Postulamos con</p>
                  <p className="text-[12.5px] font-bold text-slate-800">{fmtCLP(n.monto_ofertado)}</p>
                </div>
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-1.5">
                  <p className="text-[10px]" style={{ color: m.color }}>{r === 'ganada' ? 'Ganamos' : 'Adjudicado (total)'}</p>
                  <p className="text-[12.5px] font-bold" style={{ color: m.color }}>{fmtCLP(monto)}</p>
                </div>
              </div>
              {adj?.esAdjudicada && <BloqueAdjudicacion adj={adj} ganamos={r === 'ganada'} defaultAbierto />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Esqueleto de carga (shimmer) — reserva KPIs + toolbar + filas para no saltar al cargar.
function Esqueleto({ vista }: { vista: Vista }) {
  const filas = Array.from({ length: 6 });
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 animate-pulse">
            <div className="h-3 w-20 bg-slate-200 rounded mb-3" />
            <div className="h-7 w-16 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-3 mb-5 animate-pulse">
        <div className="h-9 w-64 bg-slate-100 rounded-xl mb-2.5" />
        <div className="h-9 w-full max-w-md bg-slate-100 rounded-lg" />
      </div>
      {vista === 'tarjetas' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
          {filas.map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 animate-pulse">
              <div className="h-3 w-40 bg-slate-200 rounded mb-3" />
              <div className="h-4 w-3/4 bg-slate-200 rounded mb-2" />
              <div className="h-3 w-1/2 bg-slate-100 rounded mb-4" />
              <div className="grid grid-cols-3 gap-2">
                <div className="h-12 bg-slate-100 rounded-lg" /><div className="h-12 bg-slate-100 rounded-lg" /><div className="h-12 bg-slate-100 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filas.map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl px-4 py-3 animate-pulse flex items-center gap-4">
              <div className="flex-1">
                <div className="h-3 w-36 bg-slate-200 rounded mb-2" />
                <div className="h-4 w-2/3 bg-slate-200 rounded" />
              </div>
              <div className="h-4 w-24 bg-slate-100 rounded hidden lg:block" />
              <div className="h-4 w-20 bg-slate-100 rounded hidden lg:block" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Paginación ────────────────────────────────────────────────────────────────
// Números con elipsis: 1 … (p-1) p (p+1) … N. Siempre visibles primera y última.
function numerosPagina(actual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, 2, total - 1, total, actual - 1, actual, actual + 1]);
  const nums = [...set].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push('…');
    out.push(nums[i]);
  }
  return out;
}

function Paginacion({ pagina, totalPaginas, total, desde, hasta, porPagina, onPagina, onPorPagina }: {
  pagina: number; totalPaginas: number; total: number; desde: number; hasta: number; porPagina: number;
  onPagina: (p: number) => void; onPorPagina: (n: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-5">
      <div className="flex items-center gap-3 text-[12px] text-slate-500">
        <span><b className="text-slate-700">{desde}–{hasta}</b> de <b className="text-slate-700">{total}</b></span>
        <span className="inline-flex items-center gap-1.5">
          Por página
          <Select value={String(porPagina)} onChange={v => onPorPagina(Number(v))} minWidth={70}
            options={[10, 25, 50].map(nv => ({ value: String(nv), label: String(nv) }))} />
        </span>
      </div>
      {totalPaginas > 1 && (
        <nav className="flex items-center gap-1" aria-label="Paginación">
          <button onClick={() => onPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronLeft size={15} />
          </button>
          {numerosPagina(pagina, totalPaginas).map((p, i) => p === '…'
            ? <span key={`e${i}`} className="w-8 text-center text-slate-400 text-[12px]">…</span>
            : (
              <button key={p} onClick={() => onPagina(p)} aria-current={p === pagina ? 'page' : undefined}
                className={`inline-flex items-center justify-center min-w-[32px] h-8 px-1 rounded-lg text-[12.5px] font-semibold transition-colors ${
                  p === pagina ? 'bg-slate-800 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {p}
              </button>
            ))}
          <button onClick={() => onPagina(pagina + 1)} disabled={pagina >= totalPaginas} aria-label="Página siguiente"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronRight size={15} />
          </button>
        </nav>
      )}
    </div>
  );
}

export default function AdjudicadasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCruce, setErrorCruce] = useState(false);

  // ── Estado de la UI (vista, buscador, filtros, orden, paginación) ──────────
  const [vista, setVista] = useState<Vista>('lista');
  const [q, setQ] = useState('');
  const [fPerfil, setFPerfil] = useState<string[]>([]);
  const [fEmpresa, setFEmpresa] = useState<string[]>([]);
  const [resultadoSel, setResultadoSel] = useState<Resultado | ''>('');
  const [orden, setOrden] = useState<Orden>('recientes');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const listaRef = useRef<HTMLDivElement>(null);

  // Preferencia de vista persistida (por navegador). En efecto y con try/catch:
  // el acceso a localStorage puede LANZAR con almacenamiento bloqueado.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('adjudicadas_vista');
      if (v === 'lista' || v === 'tarjetas') setVista(v);
    } catch { /* almacenamiento bloqueado */ }
  }, []);
  const cambiarVista = (v: Vista) => { setVista(v); try { window.localStorage.setItem('adjudicadas_vista', v); } catch { /* privado */ } };

  const [adjMap, setAdjMap] = useState<Record<string, Adjudicacion | null>>({});
  const [resueltos, setResueltos] = useState<Set<string>>(new Set());
  // El cruce con el cache llega en 1 llamada. Hasta que esté, no pintamos conteos (evita el
  // salto de "solo promovidas" → total). Así el resultado aparece completo de una.
  const [cruceListo, setCruceListo] = useState(false);
  const [cruceVersion, setCruceVersion] = useState(0); // para el botón Reintentar

  // Tiempo real: el cron de 2h refresca el cache de adjudicación desde MP y publica un
  // evento; también llega cuando alguien mueve una postulada. Sube `version` → recarga.
  const [version, setVersion] = useState(0);
  useRealtime(useCallback(() => setVersion(v => v + 1), []));

  useEffect(() => {
    let cancelado = false; // una respuesta vieja no debe pisar a la nueva
    (async () => {
      try {
        const res = await fetch('/api/negocios', { cache: 'no-store' });
        const data = await res.json();
        if (cancelado) return;
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
        const todas: Negocio[] = data.negocios || [];
        // Universo amplio: además de las ya promovidas (ADJUDICADA/PERDIDA), incluimos las que
        // siguen en POSTULADA pero MP ya adjudicó. El gate `esResuelta` (por cache) deja solo las
        // realmente resueltas → el resultado real aparece aquí sin esperar la promoción del cron.
        const univ = todas.filter(n => n.licitacion_codigo && ['ADJUDICADA', 'PERDIDA', 'POSTULADA', 'POSIBLE_ADJ'].includes(n.estado_pipeline || ''));
        // Dedup defensivo por código (bug conocido de filas duplicadas al reasignar):
        // se conserva la fila más reciente (id mayor) por licitación.
        const porCodigo = new Map<string, Negocio>();
        for (const n of univ) {
          const prev = porCodigo.get(n.licitacion_codigo);
          if (!prev || n.id > prev.id) porCodigo.set(n.licitacion_codigo, n);
        }
        setNegocios([...porCodigo.values()]);
        setError(null); // un fallo transitorio anterior no debe quedar pegado
        if (porCodigo.size === 0) setCruceListo(true); // nada que cruzar
      } catch (e: any) {
        if (cancelado) return;
        setError(String(e?.message ?? e));
        setCruceListo(true); // sin esto el error quedaba oculto tras el skeleton eterno
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
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
        if (d?.estados) { setAdjMap(d.estados); setErrorCruce(false); }
        else setErrorCruce(true);
      } catch {
        // sin cruce → cae a la clasificación por estado, pero se AVISA (banner con reintentar)
        if (!cancelado) setErrorCruce(true);
      } finally {
        if (!cancelado) {
          setResueltos(new Set(negocios.map(n => n.licitacion_codigo).filter(Boolean)));
          setCruceListo(true);
        }
      }
    })();
    return () => { cancelado = true; };
  }, [negocios, cruceVersion]);

  // Gate de "resuelta": manda el cache de adjudicación (esAdjudicada); si aún no cargó, el estado
  // ya promovido. Solo las resueltas se muestran en Adjudicadas.
  const esResuelta = useCallback((n: Negocio) => {
    const a = adjMap[n.licitacion_codigo];
    if (a) return a.esAdjudicada;
    return n.estado_pipeline === 'ADJUDICADA' || n.estado_pipeline === 'PERDIDA';
  }, [adjMap]);
  const resueltas = useMemo(() => negocios.filter(esResuelta), [negocios, esResuelta]);

  // ── Opciones de filtros con conteo (solo lo presente en los datos) ──────────
  const opcionesPerfil = useMemo(() => {
    const m = new Map<string, { nombre: string; total: number }>();
    for (const n of resueltas) {
      const email = n.usuario_email || n.usuario_nombre || '—';
      const e = m.get(email) || { nombre: n.usuario_nombre || n.usuario_email || '—', total: 0 };
      e.total++; m.set(email, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
      .map(([email, v]) => ({ value: email, label: v.nombre, color: colorUsuario(email), count: v.total }));
  }, [resueltas]);

  const opcionesEmpresa = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of resueltas) if (n.empresa_nombre) m.set(n.empresa_nombre, (m.get(n.empresa_nombre) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ value: v, label: v, count: c }));
  }, [resueltas]);

  // Filtros FANTASMA: si tras un refetch una selección ya no existe entre las opciones,
  // se poda sola (si no, seguiría filtrando sin que haya control visible que lo muestre).
  useEffect(() => {
    const vals = new Set(opcionesPerfil.map(o => o.value));
    setFPerfil(p => p.every(v => vals.has(v)) ? p : p.filter(v => vals.has(v)));
  }, [opcionesPerfil]);
  useEffect(() => {
    const vals = new Set(opcionesEmpresa.map(o => o.value));
    setFEmpresa(p => p.every(v => vals.has(v)) ? p : p.filter(v => vals.has(v)));
  }, [opcionesEmpresa]);

  // ── Cadena de filtrado: perfil/empresa/búsqueda → base (para KPIs y tabs) ───
  const base = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return resueltas.filter(n =>
      (fPerfil.length === 0 || fPerfil.includes(n.usuario_email || n.usuario_nombre || '—')) &&
      (fEmpresa.length === 0 || (!!n.empresa_nombre && fEmpresa.includes(n.empresa_nombre))) &&
      (!texto
        || (n.licitacion_nombre || '').toLowerCase().includes(texto)
        || (n.licitacion_codigo || '').toLowerCase().includes(texto)
        || (n.licitacion_organismo || '').toLowerCase().includes(texto)
        || (n.empresa_nombre || '').toLowerCase().includes(texto)
        // El perfil solo es un campo visible (y por tanto buscable) para el admin.
        || (isAdmin && ((n.usuario_nombre || '').toLowerCase().includes(texto)
          || (n.usuario_email || '').toLowerCase().includes(texto)))));
  }, [resueltas, fPerfil, fEmpresa, q, isAdmin]);

  const conteo = useMemo(() => {
    const c = { ganada: 0, perdida: 0 };
    for (const n of base) c[resultadoDe(n, adjMap[n.licitacion_codigo])]++;
    return c;
  }, [base, adjMap]);

  const visibles = useMemo(() => {
    const lista = base.filter(n => !resultadoSel || resultadoDe(n, adjMap[n.licitacion_codigo]) === resultadoSel);
    const val = (n: Negocio) => montoResultado(n, adjMap[n.licitacion_codigo] ?? null, resultadoDe(n, adjMap[n.licitacion_codigo])) ?? -1;
    switch (orden) {
      case 'antiguas':     return lista.sort((a, b) => tsDe(a.licitacion_cierre) - tsDe(b.licitacion_cierre));
      case 'monto_ganado': return lista.sort((a, b) => val(b) - val(a));
      case 'presupuesto':  return lista.sort((a, b) => (b.licitacion_monto ?? -1) - (a.licitacion_monto ?? -1));
      case 'nombre':       return lista.sort((a, b) => (a.licitacion_nombre || '').localeCompare(b.licitacion_nombre || '', 'es'));
      default:             return lista.sort((a, b) => tsDe(b.licitacion_cierre) - tsDe(a.licitacion_cierre));
    }
  }, [base, resultadoSel, adjMap, orden]);

  // ── Paginación en cliente sobre el resultado filtrado/ordenado ──────────────
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const enPagina = useMemo(
    () => visibles.slice((paginaSegura - 1) * porPagina, paginaSegura * porPagina),
    [visibles, paginaSegura, porPagina]);
  // Cambio de filtro/orden vuelve a la página 1 (cambiar de VISTA no: son los mismos datos).
  useEffect(() => { setPagina(1); }, [q, fPerfil, fEmpresa, resultadoSel, orden, porPagina]);
  // Si los datos en vivo encogen el total, el estado no puede quedar apuntando a una
  // página que ya no existe (el clamp del render solo corrige lo visible).
  useEffect(() => { if (pagina > totalPaginas) setPagina(totalPaginas); }, [pagina, totalPaginas]);

  const irAPagina = (p: number) => {
    setPagina(Math.min(Math.max(1, p), totalPaginas));
    // El usuario quedaba mirando el FONDO de la lista nueva: subir al inicio del listado.
    listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  const hayFiltros = q.trim() !== '' || fPerfil.length > 0 || fEmpresa.length > 0 || resultadoSel !== '';
  const limpiarFiltros = () => { setQ(''); setFPerfil([]); setFEmpresa([]); setResultadoSel(''); };

  // Hasta que el cruce con el cache no esté listo, tratamos la vista como "cargando" para no
  // mostrar un conteo parcial que luego salta.
  const cargandoTodo = cargando || !cruceListo;

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Adjudicadas' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Encabezado */}
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

        {/* Aviso no bloqueante: el detalle de adjudicación (cache MP) no cargó */}
        {!cargandoTodo && errorCruce && (
          <Banner variante="warning" className="mb-4"
            accion={{ label: 'Reintentar', onClick: () => setCruceVersion(v => v + 1) }}>
            No se pudo cargar el detalle de adjudicación desde el servidor — se muestra la
            clasificación por estado, que puede estar incompleta.
          </Banner>
        )}

        {cargandoTodo ? (
          <Esqueleto vista={vista} />
        ) : error ? (
          <Banner variante="error" accion={{ label: 'Reintentar', onClick: () => { setCargando(true); setVersion(v => v + 1); } }}>
            {error}
          </Banner>
        ) : (
          <>
            {/* KPIs */}
            {resueltas.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
                <div className="stagger-item" style={{ '--stagger-i': 0 } as React.CSSProperties}>
                  <StatCard icon={<Trophy size={22} />} label="Ganadas" value={conteo.ganada} sub={stats.exito != null ? `${stats.exito}% de efectividad` : undefined} color={META.ganada.color} />
                </div>
                <div className="stagger-item" style={{ '--stagger-i': 1 } as React.CSSProperties}>
                  <StatCard icon={<XCircle size={22} />} label="Perdidas" value={conteo.perdida} sub="Adjudicadas a terceros" color={META.perdida.color} />
                </div>
                <div className="stagger-item" style={{ '--stagger-i': 2 } as React.CSSProperties}>
                  <StatCard icon={<Target size={22} />} label="Tasa de éxito" value={stats.exito != null ? `${stats.exito}%` : '—'} sub="ganadas / resueltas" color="#7c3aed" />
                </div>
                <div className="stagger-item" style={{ '--stagger-i': 3 } as React.CSSProperties}>
                  <StatCard icon={<Wallet size={22} />} label="Monto ganado" value={stats.montoGanado || '—'} formato={fmtCLP} sub="Lo adjudicado a nosotros" color="#0d9488" />
                </div>
              </div>
            )}

            {/* Barra de herramientas: tabs resultado · vista · buscador · filtros · orden */}
            {resueltas.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-3 mb-5 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Tabs de resultado */}
                  <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-0.5">
                    {TABS.map(t => {
                      const activo = resultadoSel === t.id;
                      return (
                        <button key={t.id || 'all'} onClick={() => setResultadoSel(t.id)}
                          className={`inline-flex items-center gap-1.5 text-[12.5px] font-bold px-3 py-1.5 rounded-lg transition-all ${
                            activo ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                          style={activo ? { color: t.color } : undefined}>
                          {t.label}
                          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[10.5px] font-black"
                            style={{ background: t.color + (activo ? '18' : '10'), color: activo ? t.color : '#64748b' }}>{t.count}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex-1 min-w-[160px]" />

                  {/* Conmutador de vista */}
                  <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-0.5" role="group" aria-label="Tipo de vista">
                    <button onClick={() => cambiarVista('lista')} title="Vista de lista" aria-pressed={vista === 'lista'}
                      className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                        vista === 'lista' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      <LayoutList size={14} /> Lista
                    </button>
                    <button onClick={() => cambiarVista('tarjetas')} title="Vista de tarjetas" aria-pressed={vista === 'tarjetas'}
                      className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                        vista === 'tarjetas' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      <LayoutGrid size={14} /> Tarjetas
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Buscador */}
                  <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={e => setQ(e.target.value)}
                      placeholder={isAdmin ? 'Buscar por nombre, código, organismo, empresa o perfil…' : 'Buscar por nombre, código, organismo o empresa…'}
                      className="w-full pl-8 pr-8 py-2 text-[13px] border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none" />
                    {q && (
                      <button onClick={() => setQ('')} title="Limpiar búsqueda"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Filtros multi-select */}
                  {isAdmin && opcionesPerfil.length > 1 && (
                    <MultiSelect label="Perfil" icon={<Users size={13} />} options={opcionesPerfil} selected={fPerfil} onChange={setFPerfil} />
                  )}
                  {opcionesEmpresa.length > 1 && (
                    <MultiSelect label="Empresa" icon={<Building2 size={13} />} options={opcionesEmpresa} selected={fEmpresa} onChange={setFEmpresa} />
                  )}

                  {/* Orden */}
                  <Select value={orden} onChange={v => setOrden(v as Orden)} options={OPCIONES_ORDEN}
                    icon={<ArrowUpDown size={13} />} minWidth={190} />

                  {hayFiltros && (
                    <button onClick={limpiarFiltros}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-lg px-2.5 py-2 transition-colors">
                      <X size={13} /> Limpiar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Contenido */}
            <div ref={listaRef} className="scroll-mt-16">
              {visibles.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-100 fade-in">
                  <Inbox size={36} className="text-gray-300 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">
                    {resueltas.length === 0 ? 'Todavía no hay licitaciones resueltas' : 'Nada con estos filtros'}
                  </h3>
                  <p className="text-sm text-gray-400">
                    {resueltas.length === 0
                      ? <>Cuando Mercado Público publique el resultado de una postulada, aparecerá aquí como <b>Ganada</b> o <b>Perdida</b>.</>
                      : isAdmin ? 'Prueba con otra búsqueda, resultado o perfil.' : 'Prueba con otra búsqueda, resultado o empresa.'}
                  </p>
                  {hayFiltros && resueltas.length > 0 && (
                    <button onClick={limpiarFiltros}
                      className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-600 hover:text-indigo-700">
                      <X size={14} /> Limpiar filtros
                    </button>
                  )}
                </div>
              ) : vista === 'tarjetas' ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
                  {enPagina.map((n, i) => (
                    <div key={n.id} className="stagger-item" style={{ '--stagger-i': Math.min(i, 12) } as React.CSSProperties}>
                      <Card n={n} adj={adjMap[n.licitacion_codigo] ?? null}
                        cargandoAdj={!resueltos.has(n.licitacion_codigo)} isAdmin={!!isAdmin} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Encabezado de columnas (solo escritorio) */}
                  <div className={`hidden lg:grid ${isAdmin ? GRID_ADMIN : GRID_USER} gap-x-3 px-4 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-500`}>
                    <span>Licitación</span>
                    {isAdmin && <span>Perfil</span>}
                    <span>Empresa</span>
                    <span className="text-right">Resultado $</span>
                    <span className="text-right">Cierre</span>
                    <span />
                  </div>
                  {enPagina.map((n, i) => (
                    <div key={n.id} className="stagger-item" style={{ '--stagger-i': Math.min(i, 12) } as React.CSSProperties}>
                      <Fila n={n} adj={adjMap[n.licitacion_codigo] ?? null}
                        cargandoAdj={!resueltos.has(n.licitacion_codigo)} isAdmin={!!isAdmin} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Paginacion
              pagina={paginaSegura} totalPaginas={totalPaginas} total={visibles.length}
              desde={(paginaSegura - 1) * porPagina + 1}
              hasta={Math.min(paginaSegura * porPagina, visibles.length)}
              porPagina={porPagina} onPagina={irAPagina} onPorPagina={setPorPagina} />
          </>
        )}
      </div>
    </AppLayout>
  );
}
