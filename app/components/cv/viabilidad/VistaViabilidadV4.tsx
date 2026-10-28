'use client';

// VISTA v4.0 + NIVEL DE ATRACTIVO v4.1 (02-oct-2026) — informes con `_schema: 'v4'`.
//
// Encabezado: NIVEL (MUY ALTO…EXCLUIDO), la ACCIÓN del asistente (Sigue / Consulta a CA / Suelta /
// Revisa la salida / Confirma el dato) y una línea con el porqué en lenguaje comercial. Sin
// número 0-100 ni GANABLE/NO VAMOS: el nivel lo calcula el código (score-viabilidad.ts). Si un dato
// clave quedó dudoso, el asistente lo confirma acá y el nivel se recalcula (sin IA).
//
// Pestañas (especificación 1, §6.4): Cómo ganar · Admisibilidad (antes "Riesgos": solo lo que deja
// fuera, contador del código, firma en 4 estados, causales sin analizar en ámbar) · Plazos y multa
// (hitos en su unidad original + total, inicio del plazo de entrega, multa en $/día) · Productos
// (lista única, "N de N", selector de líneas con su presupuesto y nivel) · Preparación (3 grupos).
// Cada dato con su cita: el ojo abre la página que calculó el código y resalta la FRASE exacta; si
// la frase no se encontró en las bases, la cita se ve en ámbar "no verificada".

import { useMemo, useState, Fragment } from 'react';
import { IconShieldCheck as ShieldCheck, IconPackage as Package, IconTarget as Target, IconClipboardCheck as ClipboardCheck, IconEye as Eye, IconLoader2 as Loader2, IconCheck as Check, IconClock as Clock } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { motion } from 'framer-motion';
import { PanelValidador, HintOjo } from './viabilidad-ui-comun';
import { AdmisibilidadV4, CabeceraV4, GanarV4, PlazosV4, PreparacionV4, ProductosV4, TarjetasClaveV4 } from './viabilidad-v4-bloques';

// ─── Confirmación de datos dudosos (recalcula el nivel en el servidor, sin IA) ───────────────
function DatosDudosos({ codigo, score, adjudicacion, onCambio }: { codigo: string; score: any; adjudicacion: any; onCambio: (score: any, adj: any) => void }) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dudosos: any[] = Array.isArray(score?.datos_dudosos) ? score.datos_dudosos : [];
  if (!dudosos.length) return null;
  const confirmar = async (clave: string, valor?: string) => {
    setEnviando(clave + (valor || '')); setError(null);
    try {
      const r = await fetch(`/api/cv/viabilidad-ia/${encodeURIComponent(codigo)}/nivel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'confirmar', clave, valor }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || 'No se pudo confirmar.'); return; }
      onCambio(j.score, j.adjudicacion);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setEnviando(null); }
  };
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 space-y-2.5 dark:bg-sky-950/30 dark:border-sky-900">
      <p className="text-[12.5px] font-semibold text-sky-900 flex items-center gap-1.5"><Eye size={14} /> Antes de decidir, confirma en el visor:</p>
      {dudosos.map((d: any) => (
        <div key={d.clave} className="bg-white rounded-xl border border-sky-100 p-3 dark:bg-slate-900 dark:border-sky-900">
          <p className="text-[12.5px] text-slate-700"><strong>{String(d.dato || '').charAt(0).toUpperCase() + String(d.dato || '').slice(1)}</strong> — {d.razon}.</p>
          {d.clave === 'adjudicacion' && adjudicacion?.pregunta_foro && (
            <p className="text-[11.5px] text-slate-500 mt-0.5">Si las bases no lo aclaran, pregunta en el foro: <em>“{adjudicacion.pregunta_foro}”</em></p>
          )}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {d.clave === 'adjudicacion' ? (<>
              <button disabled={!!enviando} onClick={() => confirmar('adjudicacion', 'GLOBAL')} className="h-8 inline-flex items-center gap-1.5 text-[13px] font-medium px-3 rounded-lg border border-linea bg-white shadow-tarjeta hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 dark:bg-slate-900 dark:border-slate-700">
                {enviando === 'adjudicacionGLOBAL' ? <Loader2 size={12} className="inline animate-spin" /> : null} Es global (todo a un proveedor)
              </button>
              <button disabled={!!enviando} onClick={() => confirmar('adjudicacion', 'POR_LINEAS')} className="h-8 inline-flex items-center gap-1.5 text-[13px] font-medium px-3 rounded-lg border border-linea bg-white shadow-tarjeta hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 dark:bg-slate-900 dark:border-slate-700">
                {enviando === 'adjudicacionPOR_LINEAS' ? <Loader2 size={12} className="inline animate-spin" /> : null} Es por línea (se puede repartir)
              </button>
            </>) : (
              <button disabled={!!enviando} onClick={() => confirmar(d.clave)} className="h-8 inline-flex items-center gap-1.5 text-[13px] font-medium px-3 rounded-lg border border-linea bg-white shadow-tarjeta hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 dark:bg-slate-900 dark:border-slate-700">
                {enviando === d.clave ? <Loader2 size={12} className="inline animate-spin" /> : <Check size={12} className="inline" />} Lo revisé en las bases: está bien
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-sky-700">Si no logras confirmarlo, consulta al jefe de ventas.</p>
      {error && <p className="text-[11.5px] text-red-600">{error}</p>}
    </div>
  );
}

// ─── Vista principal ───────────────────────────────────────────────────────────────────────
export function VistaV4({ informe, codigo, feedbackPanel, onInformeCambio }: { informe: any; codigo: string; feedbackPanel?: React.ReactNode; onInformeCambio?: (inf: any) => void }) {
  const { usuario } = useSession();
  const [tab, setTab] = useState<'ganar' | 'admisibilidad' | 'plazos' | 'productos' | 'preparacion'>('ganar');

  const s = informe.score || {};
  const t = informe.tarjeta_decision || {};
  const enRevision = informe.veredicto?.estado_veredicto === 'REVISION_HUMANA';
  const adj = informe.adjudicacion || {};
  const adm = informe.requisitos_admisibilidad || {};
  const prod = informe.productos || {};
  const items: any[] = useMemo(() => (Array.isArray(prod.items) ? prod.items : []), [prod.items]);
  const requisitos: any[] = Array.isArray(adm.requisitos) ? adm.requisitos : [];
  const causalesSin: any[] = Array.isArray(adm.posibles_causales_sin_analizar) ? adm.posibles_causales_sin_analizar : [];
  const esCA = usuario?.rol === 'admin';
  const nAdm = Number(adm.conteo ?? requisitos.length) || 0;

  const cambioNivel = (score: any, adjudicacion: any) => {
    onInformeCambio?.({ ...informe, score, ...(adjudicacion ? { adjudicacion } : {}) });
  };

  const tabs: Array<{ id: typeof tab; label: string; icon: React.ReactNode; badge?: string; badgeRojo?: boolean }> = [
    { id: 'ganar', label: 'Cómo ganar', icon: <Target size={14} /> },
    { id: 'admisibilidad', label: 'Admisibilidad', icon: <ShieldCheck size={14} />, badge: nAdm || causalesSin.length ? String(nAdm) + (causalesSin.length ? ` +${causalesSin.length}` : '') : undefined, badgeRojo: nAdm > 0 },
    { id: 'plazos', label: 'Plazos y multa', icon: <Clock size={14} /> },
    { id: 'productos', label: 'Productos', icon: <Package size={14} />, badge: items.length ? String(items.length) : undefined },
    { id: 'preparacion', label: 'Preparación', icon: <ClipboardCheck size={14} /> },
  ];

  return (
    <div className="space-y-3">
      <CabeceraV4 s={s} t={t} enRevision={enRevision} esCA={esCA} />

      <DatosDudosos codigo={codigo} score={s} adjudicacion={adj} onCambio={cambioNivel} />

      <PanelValidador validador={informe._validador} />

      <TarjetasClaveV4 informe={informe} onVerPlazos={() => setTab('plazos')} />

      {/* ── PESTAÑAS CON FORMA DE PESTAÑA ── la activa se funde con el panel de abajo (skill licitank-ui) */}
      <div>
        <div role="tablist" className="relative z-10 flex items-end gap-1 px-3 overflow-x-auto">
          {tabs.map(tb => {
            const on = tab === tb.id;
            return (
              <button key={tb.id} role="tab" aria-selected={on} onClick={() => setTab(tb.id)}
                className={`relative flex items-center gap-1.5 px-4 rounded-t-xl border border-b-0 text-sm whitespace-nowrap transition-colors duration-150 ${on
                  ? 'h-11 -mb-px bg-slate-50 border-linea font-semibold text-tinta dark:bg-slate-950 dark:border-slate-800 dark:text-slate-50'
                  : 'h-9 mb-0 bg-slate-100 border-transparent font-medium text-tinta-2 hover:bg-slate-200/70 hover:text-tinta dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-slate-200'}`}>
                {on && <motion.span layoutId="vista-v4-tab-top" className="absolute inset-x-2 top-0 h-0.5 rounded-b-full bg-marca" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />}
                <span className={on ? 'text-marca' : 'text-slate-400'}>{tb.icon}</span> {tb.label}
                {tb.badge && <span className={`text-xs font-semibold tabular-nums ${tb.badgeRojo ? 'text-urgente' : on ? 'text-marca' : 'text-tinta-3'}`}>{tb.badge}</span>}
              </button>
            );
          })}
        </div>
        <div className="rounded-2xl border border-linea bg-slate-50 p-4 space-y-3 dark:bg-slate-950 dark:border-slate-800">
      <HintOjo />

      <motion.div key={tab} className="space-y-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>
      {/* ═══ CÓMO GANAR ═══ */}
      {tab === 'ganar' && <GanarV4 informe={informe} />}

      {/* ═══ ADMISIBILIDAD ═══ */}
      {tab === 'admisibilidad' && <AdmisibilidadV4 informe={informe} />}

      {/* ═══ PLAZOS Y MULTA ═══ */}
      {tab === 'plazos' && <PlazosV4 informe={informe} />}

      {/* ═══ PRODUCTOS ═══ */}
      {tab === 'productos' && <ProductosV4 informe={informe} codigo={codigo} />}

      {/* ═══ PREPARACIÓN ═══ */}
      {tab === 'preparacion' && (<>
        <PreparacionV4 informe={informe} />
        {feedbackPanel}
      </>)}

      </motion.div>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center pt-1 tabular-nums">
        {(informe.pendientes_fase3?.length ?? 0) > 0 && <>Pendiente Fase 3: {informe.pendientes_fase3.join(', ')} · </>}
        Leídos {informe.documentos_leidos?.length ?? 0} doc(s){informe._citas ? ` · ${informe._citas.verificadas}/${informe._citas.total} citas verificadas` : ''} · <span className="text-teal-600 font-semibold">v4.0</span>
      </p>
    </div>
  );
}
