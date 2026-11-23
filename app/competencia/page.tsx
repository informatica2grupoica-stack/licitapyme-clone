'use client';

// «Competencia y mercado» — fase 1: Resumen y Competidores (diseño en docs/diseno-modulo-competencia.md).
// Lee lo mismo que /adjudicadas (/api/negocios + /api/postuladas/estado, solo cache de la BD), así que cada empresa-cliente
// ve solo lo suyo. Los cálculos viven en app/lib/competencia-core.ts. Productos, Organismos y Precios vienen en fases siguientes.

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useRealtime } from '@/app/lib/use-realtime';
import { Banner } from '@/app/components/ui/Banner';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Dona } from '@/app/components/ui/kit/Dona';
import { Encabezado, Esqueleto, TarjetaCargando, Vacio } from '@/app/components/ui/kit/Estructura';
import { IconChevronDown as ChevronDown, IconSearch as Search, IconX as X, IconUsersGroup as UsersGroup } from '@tabler/icons-react';
import dayjs from 'dayjs';
import {
  calcularCompetencia, universoResuelto, type NegocioComp, type AdjComp, type Competidor, type PorEmpresa,
} from '@/app/lib/competencia-core';

type Pestana = 'resumen' | 'competidores';
type Orden = 'licitaciones' | 'monto';

const SERIE = ['#0d9488', '#475569', '#d97706', '#0891b2', '#ea580c', '#db2777'];
const OTROS = '__otros';
const TARJETA = 'rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900';

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtMM = (n: number) => Math.abs(n) < 1_000_000 ? fmtCLP(n) : `$${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MM`;
const fmtPct = (x: number | null) => x == null ? '—' : `${Math.round(x * 100)} %`;
function fmtFecha(s: string | null) {
  const d = dayjs(s ?? '');
  if (!s || !d.isValid()) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', ...(d.year() === dayjs().year() ? {} : { year: 'numeric' }) }).format(d.toDate()).replace('.', '');
}

function FilaCompetidor({ c, color }: { c: Competidor; color: string }) {
  const [abierta, setAbierta] = useState(false);
  const porEmpresa = [...c.detalle.reduce((m, d) => m.set(d.empresa || 'Sin empresa', (m.get(d.empresa || 'Sin empresa') || 0) + 1), new Map<string, number>())]
    .sort((x, y) => y[1] - x[1]);
  return (
    <li>
      <button type="button" onClick={() => setAbierta(v => !v)} aria-expanded={abierta}
        className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800 ${abierta ? 'bg-slate-50 dark:bg-slate-800' : ''}`}>
        <span aria-hidden style={{ backgroundColor: color }} className="h-2 w-2 flex-shrink-0 rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-tinta dark:text-slate-100" title={c.nombre}>{c.nombre}</span>
          {c.rut && <span className="block text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">RUT {c.rut}</span>}
        </span>
        <span className="flex-shrink-0 text-right">
          <span className="block text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-50">{c.licitaciones} {c.licitaciones !== 1 ? 'licitaciones' : 'licitación'}</span>
          <span className="block text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">se llevó {fmtMM(c.monto)}</span>
        </span>
        <ChevronDown size={16} stroke={1.75} aria-hidden className={`flex-shrink-0 text-slate-400 transition-transform duration-150 ${abierta ? 'rotate-180' : ''}`} />
      </button>
      <div className="colapsable" data-abierto={abierta ? '1' : '0'}>
        <div className="colapsable-inner">
          <div className="px-2 pb-3 pt-1">
            <p className="text-[11px] text-tinta-2 dark:text-slate-400">Nos ganó cuando postulamos con</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-tinta dark:text-slate-100">
              {porEmpresa.map(([emp, n]) => <span key={emp}>{emp} <span className="font-semibold tabular-nums">{n}</span></span>)}
            </div>
            <p className="mt-3 text-[11px] text-tinta-2 dark:text-slate-400">En estas licitaciones</p>
            <ul className="mt-1 divide-y divide-linea dark:divide-slate-800">
              {c.detalle.map(d => (
                <li key={d.codigo} className="flex items-start justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <Link href={`/licitacion/${encodeURIComponent(d.codigo)}`} title={d.nombre}
                      className="block truncate rounded text-[13px] font-medium text-tinta hover:text-marca hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:text-slate-100">
                      {d.nombre}
                    </Link>
                    <p className="truncate text-xs text-tinta-2 dark:text-slate-400">
                      <span className="font-mono">{d.codigo}</span>
                      {d.organismo ? ` · ${d.organismo}` : ''}
                      {d.empresa ? ` · postulamos con ${d.empresa}` : ' · sin empresa asignada'}
                      {d.fecha ? ` · adjudicada ${fmtFecha(d.fecha)}` : ''}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-50">{fmtCLP(d.monto)}</p>
                    <p className="text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">{d.lineas === d.lineasTotal ? 'toda la licitación' : `${d.lineas} de ${d.lineasTotal} líneas`}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </li>
  );
}

function EfectividadPorEmpresa({ filas }: { filas: PorEmpresa[] }) {
  return (
    <div className={TARJETA}>
      <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">¿Qué tan seguido gana cada empresa?</h3>
      <p className="mt-0.5 mb-3 text-xs text-tinta-2 dark:text-slate-400">Ganadas ÷ (ganadas + perdidas), solo con resultado en Mercado Público. Es la empresa nuestra con que se postuló.</p>
      <ul className="divide-y divide-linea dark:divide-slate-800">
        {filas.map(f => {
          const total = f.ganadas + f.perdidas;
          return (
            <li key={f.empresa} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-medium text-tinta dark:text-slate-100">{f.empresa}</span>
                <span className="flex-shrink-0 text-[15px] font-semibold tabular-nums text-tinta dark:text-slate-50">{fmtPct(f.efectividad)} <span className="text-xs font-normal text-tinta-2 dark:text-slate-400">de efectividad</span></span>
              </div>
              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${f.ganadas} ganadas y ${f.perdidas} perdidas`}>
                <span style={{ width: `${total ? (f.ganadas / total) * 100 : 0}%`, backgroundColor: '#059669' }} />
                <span style={{ width: `${total ? (f.perdidas / total) * 100 : 0}%`, backgroundColor: '#dc2626' }} />
              </div>
              <p className="mt-1 text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">
                {f.ganadas} ganadas · {f.perdidas} perdidas · {total} con resultado{f.montoGanado ? ` · ganó ${fmtMM(f.montoGanado)}` : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function CompetenciaPage() {
  const [negocios, setNegocios] = useState<(NegocioComp & { id: number })[]>([]);
  const [adj, setAdj] = useState<Record<string, AdjComp | null>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCruce, setErrorCruce] = useState(false);
  const [reintento, setReintento] = useState(0);
  const [version, setVersion] = useState(0);
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [q, setQ] = useState('');
  const [orden, setOrden] = useState<Orden>('licitaciones');
  const [verTodos, setVerTodos] = useState(false);
  useRealtime(useCallback(() => setVersion(v => v + 1), []));

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/negocios', { cache: 'no-store' });
        const d = await r.json();
        if (cancelado) return;
        if (!r.ok) throw new Error(d.error || 'No se pudo cargar');
        const univ = universoResuelto(d.negocios || []);
        setNegocios(univ); setError(null);
        if (univ.length > 0) {
          try {
            const r2 = await fetch('/api/postuladas/estado', { cache: 'no-store' });
            const d2 = await r2.json();
            if (cancelado) return;
            if (d2?.estados) { setAdj(d2.estados); setErrorCruce(false); } else setErrorCruce(true);
          } catch { if (!cancelado) setErrorCruce(true); }
        }
      } catch (e: unknown) {
        if (!cancelado) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [version, reintento]);

  const { resumen, competidores, porEmpresa } = useMemo(() => calcularCompetencia(negocios, adj), [negocios, adj]);

  const porMonto = useMemo(() => [...competidores].sort((a, b) => b.monto - a.monto), [competidores]);
  const top = porMonto.slice(0, 6);
  const resto = porMonto.slice(6);
  const color = useMemo(() => new Map(top.map((c, i) => [c.clave, SERIE[i]])), [top]);
  const tajadas = [
    ...top.map(c => ({ clave: c.clave, etiqueta: c.nombre, valor: c.monto, color: color.get(c.clave)! })),
    ...(resto.length ? [{ clave: OTROS, etiqueta: `Otros ${resto.length} competidores`, valor: resto.reduce((s, c) => s + c.monto, 0), color: '#94a3b8' }] : []),
  ];
  const pctTop = resumen.montoAdjudicadoATerceros ? Math.round((top.reduce((s, c) => s + c.monto, 0) / resumen.montoAdjudicadoATerceros) * 100) : 0;
  const centro = resumen.montoAdjudicadoATerceros >= 1_000_000 ? `$${Math.round(resumen.montoAdjudicadoATerceros / 1_000_000).toLocaleString('es-CL')} MM` : fmtCLP(resumen.montoAdjudicadoATerceros);

  const listaCompleta = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t ? competidores.filter(c => c.nombre.toLowerCase().includes(t) || (c.rut || '').toLowerCase().includes(t)) : competidores;
    return [...base].sort((a, b) => orden === 'monto' ? b.monto - a.monto : b.licitaciones - a.licitaciones || b.monto - a.monto);
  }, [competidores, q, orden]);

  const LIMITE = 8;
  const hayDatos = resumen.resueltas > 0;

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Competencia y mercado' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8">
        <Encabezado titulo="Competencia y mercado"
          descripcion={cargando ? 'Cargando…' : hayDatos
            ? `Contra quién competimos, según el acta de adjudicación de Mercado Público · ${resumen.resueltas} licitaciones resueltas`
            : 'Contra quién competimos, según el acta de adjudicación de Mercado Público'} />

        {!cargando && errorCruce && (
          <Banner variante="warning" className="mb-4" accion={{ label: 'Reintentar', onClick: () => setReintento(v => v + 1) }}>
            No se pudo cargar el detalle de adjudicación desde el servidor: las cifras pueden estar incompletas.
          </Banner>
        )}

        {cargando ? (
          <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4">
            <TarjetaCargando /><TarjetaCargando /><TarjetaCargando /><TarjetaCargando />
            <Esqueleto className="h-72 @2xl:col-span-2 @5xl:col-span-4" />
          </div>
        ) : error ? (
          <Banner variante="error" accion={{ label: 'Reintentar', onClick: () => { setCargando(true); setReintento(v => v + 1); } }}>{error}</Banner>
        ) : !hayDatos ? (
          <Vacio icono={<UsersGroup size={28} stroke={1.5} />} titulo="Aún no hay licitaciones resueltas"
            texto="Cuando Mercado Público publique el resultado de tus postuladas, aquí verás quién se las llevó." />
        ) : (
          <>
            <div className="mb-5"><Pestanas id="competencia" valor={pestana} onCambio={setPestana}
              opciones={[{ valor: 'resumen', etiqueta: 'Resumen' }, { valor: 'competidores', etiqueta: 'Competidores', contador: competidores.length }]} /></div>

            {pestana === 'resumen' && (
              <>
                <Lista className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
                  <Indicador rotulo="Efectividad" valor={resumen.efectividad == null ? 0 : Math.round(resumen.efectividad * 100)} formato={n => `${n} %`}
                    detalle={`${resumen.ganadas} ganadas · ${resumen.perdidas} perdidas`} />
                  <Indicador rotulo="Competidores que nos ganaron" valor={resumen.competidoresDistintos}
                    detalle={`en ${resumen.perdidasConDetalle} perdidas con detalle`} />
                  <Indicador rotulo="Adjudicado a terceros" valor={resumen.montoAdjudicadoATerceros} formato={fmtMM}
                    detalle="en nuestras perdidas (precio × cantidad)" />
                  <Indicador rotulo="Oferentes por licitación" valor={resumen.oferentesMediana ?? 0} formato={n => resumen.oferentesMediana == null ? '—' : String(n)}
                    detalle={resumen.oferentesMediana == null ? 'Mercado Público no informó el dato' : `mediana, de ${resumen.oferentesConDato} con dato`} />
                </Lista>

                {resumen.perdidasSinDetalle > 0 && (
                  <p className="mt-3 text-xs text-tinta-2 dark:text-slate-400">
                    {resumen.perdidasSinDetalle} de las {resumen.perdidas} perdidas no traen el detalle por línea (desiertas, revocadas o sin acta) y no entran en los competidores.
                  </p>
                )}

                <div className="mt-5 grid gap-3 @4xl:grid-cols-2">
                  {competidores.length > 0 && (
                    <div className={TARJETA}>
                      <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Cuánta plata se llevaron</h3>
                      <p className="mt-0.5 mb-3 text-xs text-tinta-2 dark:text-slate-400">Monto adjudicado a cada competidor en nuestras perdidas. Toca uno para verlo en Competidores.</p>
                      <Dona tajadas={tajadas} formato={fmtMM} centroValor={centro} centroTexto="a terceros"
                        onElegir={c => { if (c !== OTROS) { setQ(competidores.find(x => x.clave === c)?.nombre || ''); setPestana('competidores'); } }}
                        descripcion={`${fmtMM(resumen.montoAdjudicadoATerceros)} adjudicados a competidores: ${tajadas.map(t => `${t.etiqueta} ${fmtMM(t.valor)}`).join(', ')}`} />
                      <p className="mt-3 border-t border-linea pt-2.5 text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
                        Nos ganaron <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{competidores.length}</span> competidores distintos.
                        {resto.length > 0 && <> Los {top.length} que más se llevaron suman el <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{pctTop} %</span>; el resto está muy repartido.</>}
                      </p>
                    </div>
                  )}
                  <div className={TARJETA}>
                    <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Quién nos ganó más veces</h3>
                    <p className="mt-0.5 mb-2 text-xs text-tinta-2 dark:text-slate-400">Licitaciones perdidas donde se llevó al menos una línea. Ábrelo para ver dónde y contra qué empresa nuestra.</p>
                    {competidores.length === 0
                      ? <p className="py-6 text-center text-sm text-tinta-2 dark:text-slate-400">Ninguna perdida trae el detalle por línea.</p>
                      : <ul className="divide-y divide-linea dark:divide-slate-800">
                          {competidores.slice(0, LIMITE).map(c => <FilaCompetidor key={c.clave} c={c} color={color.get(c.clave) || '#94a3b8'} />)}
                        </ul>}
                    {competidores.length > LIMITE && (
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-linea pt-2 text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
                        <span className="tabular-nums">{LIMITE} de {competidores.length} competidores</span>
                        <Boton tamano="sm" variante="fantasma" onClick={() => setPestana('competidores')}>Ver los {competidores.length}</Boton>
                      </div>
                    )}
                  </div>
                </div>

                {porEmpresa.length > 0 && <div className="mt-3"><EfectividadPorEmpresa filas={porEmpresa} /></div>}
              </>
            )}

            {pestana === 'competidores' && (
              <div className={TARJETA}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Competidores que nos ganaron</h3>
                    <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">Cada empresa que se adjudicó al menos una línea de nuestras perdidas.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pestanas id="orden-competidores" valor={orden} onCambio={setOrden}
                      opciones={[{ valor: 'licitaciones', etiqueta: 'Más veces' }, { valor: 'monto', etiqueta: 'Más plata' }]} />
                    <div className="relative w-56">
                      <Search size={16} stroke={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre o RUT…" aria-label="Buscar competidor"
                        className="h-9 w-full rounded-lg border border-linea bg-white pl-9 pr-8 text-sm text-tinta placeholder:text-tinta-3 focus:outline-none focus:ring-2 focus:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                      {q && (
                        <button onClick={() => setQ('')} aria-label="Limpiar búsqueda"
                          className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-tinta dark:hover:bg-slate-800">
                          <X size={14} stroke={1.75} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {listaCompleta.length === 0
                  ? <Vacio titulo="Ningún competidor coincide" texto="Prueba con otro nombre o RUT." accion={q ? <Boton tamano="sm" onClick={() => setQ('')}>Ver todos</Boton> : undefined} />
                  : <ul className="divide-y divide-linea dark:divide-slate-800">
                      {(verTodos || q ? listaCompleta : listaCompleta.slice(0, 25)).map(c => <FilaCompetidor key={c.clave} c={c} color={color.get(c.clave) || '#94a3b8'} />)}
                    </ul>}
                {!q && listaCompleta.length > 25 && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-linea pt-2 text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
                    <span className="tabular-nums">{verTodos ? listaCompleta.length : 25} de {listaCompleta.length} competidores</span>
                    <Boton tamano="sm" variante="fantasma" onClick={() => setVerTodos(v => !v)}>{verTodos ? 'Ver menos' : `Ver los ${listaCompleta.length}`}</Boton>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
