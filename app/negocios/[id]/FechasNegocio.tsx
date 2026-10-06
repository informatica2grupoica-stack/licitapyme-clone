'use client';

// ── Fechas del negocio ─────────────────────────────────────────────────────────
// Mismos datos y regla que tenía SeccionFechas (page.tsx): los hitos se ordenan cronológicamente y
// "Vamos aquí" es el primero aún no cumplido. Ahora con un resumen (próximo hito y avance) y un cronograma
// donde cada hito dice si ya se cumplió, cuándo es y cuánto falta.
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { IconCalendarEvent as CalendarEvent, IconCheck as Check, IconFlag as Flag, IconTimeline as Timeline } from '@tabler/icons-react';
import { useContador } from '@/app/lib/use-contador';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TZ = 'America/Santiago';
const mayus = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const fechaLarga = (t: number) => mayus(new Date(t).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }));
const hora = (t: number) => new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

function Aparece({ i = 0, children, x }: { i?: number; children: React.ReactNode; x?: boolean }) {
  const reducido = useReducedMotion();
  return (
    <motion.div className="min-w-0" initial={reducido ? false : x ? { opacity: 0, x: -10 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.38, delay: Math.min(i, 12) * 0.05, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

export function FechasNegocio({ licitacion }: { licitacion: any | null }) {
  const [ahora] = useState(() => Date.now());
  const reducido = useReducedMotion();
  const items = licitacion ? ([
    { label: 'Publicación',           value: licitacion.FechaPublicacion },
    { label: 'Cierre',                value: licitacion.FechaCierre },
    { label: 'Creación',              value: licitacion.FechaCreacion },
    { label: 'Adjudicación',          value: licitacion.FechaAdjudicacion },
    { label: 'Inicio preguntas',      value: licitacion.FechaInicioPreguntas },
    { label: 'Fin preguntas',         value: licitacion.FechaFinPreguntas },
    { label: 'Pub. respuestas',       value: licitacion.FechaPublicacionRespuestas },
    { label: 'Apertura técnica',      value: licitacion.FechaAperturaTecnica },
    { label: 'Apertura económica',    value: licitacion.FechaAperturaEconomica },
    { label: 'Estimada adjudicación', value: licitacion.FechaEstimadaAdjudicacion },
    { label: 'Visita terreno',        value: licitacion.FechaVisitaTerreno },
    { label: 'Entrega antecedentes',  value: licitacion.FechaEntregaAntecedentes },
  ] as Array<{ label: string; value?: string }>)
    .filter(f => f.value)
    // Parsear + ordenar cronológicamente (se descartan las que no parsean).
    .map(f => ({ label: f.label, value: f.value as string, t: new Date(f.value as string).getTime() }))
    .filter(f => !Number.isNaN(f.t))
    .sort((a, b) => a.t - b.t) : [];

  // "Vamos aquí" = primer hito aún no cumplido (fecha >= ahora). -1 si todo ya pasó.
  const idxProxima = items.findIndex(f => f.t >= ahora);
  const cumplidas = items.filter(f => f.t < ahora).length;
  const pct = items.length ? Math.round((cumplidas / items.length) * 100) : 0;
  const proxima = idxProxima >= 0 ? items[idxProxima] : null;
  const diasProxima = proxima ? Math.round((proxima.t - ahora) / 86_400_000) : null;
  const animDias = useContador(diasProxima && diasProxima > 0 ? diasProxima : 0);
  const animPct = useContador(pct);

  const fmtRel = (t: number) => {
    const d = Math.round((t - ahora) / 86_400_000);
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Mañana';
    if (d === -1) return 'Ayer';
    return d > 0 ? `En ${d} días` : `Hace ${-d} días`;
  };

  if (!licitacion) return <div className="text-[13px] text-zinc-400 py-8 text-center">Cargando datos de la API…</div>;
  if (items.length === 0) {
    return (
      <div className="bg-white border border-zinc-200/70 rounded-2xl p-10 text-center">
        <CalendarEvent size={28} className="text-zinc-300 mx-auto mb-3" />
        <p className="text-[14px] font-bold text-zinc-600">Sin fechas disponibles</p>
        <p className="text-[12.5px] text-zinc-400 mt-1">Mercado Público no informó un cronograma para esta licitación.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-4 items-start">
      {/* ── Resumen: dónde vamos y cuánto avanzó ── */}
      <div className="space-y-3">
        <Aparece>
          <div className={`border rounded-2xl p-5 ${proxima ? 'bg-violet-50/50 border-violet-200' : 'bg-emerald-50/50 border-emerald-200'}`}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-3"><Flag size={14} className={proxima ? 'text-violet-600' : 'text-emerald-600'} />{proxima ? 'Próximo hito' : 'Proceso completo'}</p>
            {proxima ? (<>
              <p className="text-[22px] font-black text-zinc-900 leading-tight">{proxima.label}</p>
              <p className="text-[34px] font-black leading-none tabular-nums text-violet-700 mt-3">
                {diasProxima === 0 ? 'Hoy' : `${Math.round(animDias)} ${diasProxima === 1 ? 'Día' : 'Días'}`}
              </p>
              <p className="text-[13px] text-zinc-600 mt-3 leading-snug">{fechaLarga(proxima.t)}<span className="block font-semibold text-zinc-800">{hora(proxima.t)}</span></p>
            </>) : (
              <p className="text-[14px] text-emerald-800 leading-snug">Todos los hitos del cronograma ya se cumplieron.</p>
            )}
          </div>
        </Aparece>
        <Aparece i={1}>
          <div className="bg-white border border-zinc-200/70 rounded-2xl p-5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-2">Avance del cronograma</p>
            <div className="flex items-end justify-between gap-3">
              <p className="text-[28px] font-black leading-none tabular-nums text-zinc-900">{Math.round(animPct)}<span className="text-[16px] text-zinc-400"> %</span></p>
              <p className="text-[12.5px] text-zinc-500 pb-0.5">{cumplidas} de {items.length} hitos cumplidos</p>
            </div>
            <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden mt-3">
              <motion.div className="h-full rounded-full bg-violet-600" initial={reducido ? false : { width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          </div>
        </Aparece>
      </div>

      {/* ── Cronograma ── */}
      <Aparece i={1}>
        <section className="bg-white border border-zinc-200/70 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-5">
            <h3 className="flex items-center gap-2.5 text-[15px] font-black text-zinc-900"><span className="w-8 h-8 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center"><Timeline size={17} /></span>Cronograma</h3>
            <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-600">{items.length} hitos</span>
          </div>
          <ol>
            {items.map((f, i) => {
              const pasada = f.t < ahora;
              const esProxima = i === idxProxima;
              const ultimo = i === items.length - 1;
              return (
                <li key={f.label}>
                  <Aparece i={i + 2} x>
                    <div className="flex gap-3.5">
                      <div className="flex flex-col items-center flex-shrink-0">
                        <span className="relative">
                          {esProxima && <span className="absolute -inset-1.5 rounded-full bg-violet-400/30 animate-ping" />}
                          <span className={`relative w-7 h-7 rounded-full flex items-center justify-center border-2 ${esProxima ? 'bg-violet-600 border-violet-600 text-white' : pasada ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-zinc-300 text-zinc-300'}`}>
                            {pasada ? <Check size={14} stroke={3} /> : esProxima ? <Flag size={13} /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-300" />}
                          </span>
                        </span>
                        {!ultimo && <span className={`w-0.5 flex-1 rounded-full my-1 ${pasada ? 'bg-emerald-200' : 'bg-zinc-200'}`} />}
                      </div>
                      <div className={`min-w-0 flex-1 ${ultimo ? '' : 'pb-5'}`}>
                        <div className={`rounded-xl px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-x-4 gap-y-1.5 ${esProxima ? 'bg-violet-50 border border-violet-200' : 'border border-transparent'}`}>
                          <div className="min-w-0">
                            <p className={`text-[14.5px] font-bold leading-tight ${esProxima ? 'text-violet-800' : pasada ? 'text-zinc-500' : 'text-zinc-900'}`}>{f.label}</p>
                            <p className={`text-[12.5px] mt-0.5 ${pasada ? 'text-zinc-400' : 'text-zinc-600'}`}>{fechaLarga(f.t)} · {hora(f.t)}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                            <span className={`text-[11.5px] font-bold px-2 py-0.5 rounded-full ${esProxima ? 'bg-violet-600 text-white' : pasada ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                              {esProxima ? `Vamos aquí · ${fmtRel(f.t)}` : pasada ? 'Cumplida' : 'Pendiente'}
                            </span>
                            {!esProxima && <span className="text-[11.5px] text-zinc-400 tabular-nums">{fmtRel(f.t)}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Aparece>
                </li>
              );
            })}
          </ol>
        </section>
      </Aparece>
    </div>
  );
}
