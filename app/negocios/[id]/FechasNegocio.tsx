'use client';

// ── Fechas del negocio ─────────────────────────────────────────────────────────
// Mismos datos y regla que tenía SeccionFechas (page.tsx): los hitos se ordenan cronológicamente y
// "Vamos aquí" es el primero aún no cumplido. Ahora con un resumen (próximo hito y avance) y un cronograma
// donde cada hito dice si ya se cumplió, cuándo es y cuánto falta. Estilo bento (skill licitank-ui) con la
// línea de tiempo horizontal compartida (kit/LineaTiempo).
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { IconCalendarEvent as CalendarEvent, IconCheck as Check, IconFlag as Flag, IconTimeline as Timeline } from '@tabler/icons-react';
import { useContador } from '@/app/lib/use-contador';
import { LineaTiempo } from '@/app/components/ui/kit/LineaTiempo';
import { Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';

// Bloques del sistema de diseño (skill licitank-ui), igual que el bento del Resumen.
const BLOQUE = 'bg-white border border-linea rounded-2xl shadow-tarjeta p-5 h-full dark:bg-slate-900 dark:border-slate-800';
function Rotulo({ icono, children, tono }: { icono: React.ReactNode; children: React.ReactNode; tono?: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px] text-tinta-2 dark:text-slate-400">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${tono || 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{icono}</span>
      {children}
    </span>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const TZ = 'America/Santiago';
const mayus = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const fechaLarga = (t: number) => mayus(new Date(t).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }));
const hora = (t: number) => new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

function Aparece({ i = 0, children, x }: { i?: number; children: React.ReactNode; x?: boolean }) {
  const reducido = useReducedMotion();
  return (
    <motion.div className="min-w-0" initial={reducido ? false : x ? { opacity: 0, x: -10 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.04, ease: [0.22, 1, 0.36, 1] }}>
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

  if (!licitacion) {
    return <div className={`${BLOQUE} space-y-3`}><Esqueleto className="h-5 w-40" /><Esqueleto className="h-16 w-full" /></div>;
  }
  if (items.length === 0) {
    return <Vacio icono={<CalendarEvent size={28} stroke={1.5} />} titulo="Sin fechas disponibles" texto="Mercado Público no informó un cronograma para esta licitación." />;
  }
  const urgente = diasProxima !== null && diasProxima <= 1;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-3">
        {/* ── Dónde vamos ── */}
        <Aparece>
          <section className={BLOQUE}>
            <Rotulo icono={proxima ? <Flag size={16} /> : <Check size={16} />} tono={proxima ? (urgente ? 'bg-red-50 text-urgente dark:bg-red-950/50' : 'bg-marca-suave text-marca dark:bg-teal-950/40') : 'bg-emerald-50 text-exito dark:bg-emerald-950/40'}>
              {proxima ? 'Próximo hito' : 'Proceso completo'}
            </Rotulo>
            {proxima ? (
              <div className="mt-4 flex items-end justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[24px] font-semibold tracking-tight leading-tight text-tinta dark:text-slate-50">{proxima.label}</p>
                  <p className="mt-1.5 text-[13px] text-tinta-2 dark:text-slate-400 tabular-nums">{fechaLarga(proxima.t)} · {hora(proxima.t)}</p>
                </div>
                <p className={`text-[34px] font-semibold tracking-tight leading-none tabular-nums ${urgente ? 'text-urgente' : 'text-marca'}`}>
                  {diasProxima === 0 ? 'Hoy' : diasProxima === 1 ? 'Mañana' : <>{Math.round(animDias)}<span className="text-base font-medium text-tinta-2 dark:text-slate-400"> días</span></>}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-tinta-2 dark:text-slate-300">Todos los hitos del cronograma ya se cumplieron.</p>
            )}
          </section>
        </Aparece>

        {/* ── Avance ── */}
        <Aparece i={1}>
          <section className={BLOQUE}>
            <Rotulo icono={<Timeline size={16} />}>Avance del cronograma</Rotulo>
            <div className="mt-4 flex items-end justify-between gap-3">
              <p className="text-[28px] font-semibold tracking-tight leading-none tabular-nums text-tinta dark:text-slate-50">{Math.round(animPct)}<span className="text-base font-medium text-tinta-2"> %</span></p>
              <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{cumplidas} de {items.length} hitos cumplidos</p>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-3">
              <motion.div className="h-full rounded-full bg-marca" initial={reducido ? false : { width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          </section>
        </Aparece>
      </div>

      {/* ── Cronograma ── */}
      <Aparece i={2}>
        <section className={BLOQUE}>
          <div className="flex items-center justify-between gap-3 mb-5">
            <Rotulo icono={<CalendarEvent size={16} />}>Cronograma</Rotulo>
            <span className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{items.length} hitos · {fmtRel(items[items.length - 1].t).toLowerCase()} el último</span>
          </div>
          <LineaTiempo hitos={items.map(f => ({ etiqueta: f.label, t: f.t }))} />
        </section>
      </Aparece>
    </div>
  );
}
