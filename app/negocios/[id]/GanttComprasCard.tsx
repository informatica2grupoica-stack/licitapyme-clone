'use client';

// GANTT DE COMPRAS POR FASES — pedido del usuario (09-oct-2026): una LÍNEA PADRE arriba que se va
// llenando con los hitos (adjudicación → OC → plazo de entrega) y, debajo, las tareas agrupadas en
// tres fases: antes de la OC, desde que llega la OC y dentro del plazo de entrega. Los tramos de
// cada tarea vienen planificados en HORAS desde el hito del que cuelgan (app/lib/compras-plan.ts);
// si ese hito aún no existe la tarea queda sin barra ("se calcula al llegar la OC"), nunca con una
// fecha inventada. El plazo de entrega parte desde donde lo digan las BASES (llegada o aceptación
// de la OC); si no lo aclaran, el inicio queda "por validar".
//
// Las tareas manuales no tienen plan: siguen mostrándose como registro (creadoAt → cierre/plazo/hoy).
import { useEffect, useMemo, useState } from 'react';
import { IconTimeline as GanttChartSquare, IconCircleCheck as CheckCircle2, IconPlayerPlay as PlayCircle, IconAlertTriangle as AlertTriangle, IconCircle as Circle, IconUserFilled as UserFilled, IconFlag as Flag, IconWand as Wand, IconChevronDown as ChevronDown } from '@tabler/icons-react';
import type { FaseTarea, HitosGantt } from '@/app/lib/compras-plan';

interface TareaGantt {
  id: number; categoria: string; titulo: string;
  estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA';
  responsableNombre: string | null;
  plazoAt: string | null; creadoAt: string; cerradoAt: string | null; vencida: boolean;
  fase?: FaseTarea | null; planInicioAt?: string | null; planFinAt?: string | null;
  esManual?: boolean; hallazgo?: boolean;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const LABEL_COL = 'grid-cols-[150px_1fr] sm:grid-cols-[240px_1fr]';
const MS_HORA = 3_600_000;
const MS_DIA = 24 * MS_HORA;

const FASES: Array<{ clave: FaseTarea | 'PROPIAS'; titulo: string; ayuda: string }> = [
  { clave: 'PRE_OC', titulo: 'Antes de la OC', ayuda: 'Desde la adjudicación hasta que llega la orden de compra' },
  { clave: 'POST_OC', titulo: 'Desde que llega la OC', ayuda: 'Hitos administrativos y de compra una vez emitida la OC' },
  { clave: 'ENTREGA', titulo: 'Plazo de entrega', ayuda: 'Lo que ocurre mientras corre el plazo de entrega' },
  { clave: 'PROPIAS', titulo: 'Tareas propias del proyecto', ayuda: 'Tareas manuales: se grafican como registro' },
];

// Fechas "de pared": el servidor entrega 'YYYY-MM-DD HH:mm:ss' ya en hora de Chile; se leen como UTC
// para que no haya conversión de zona en el medio.
function ms(s: string): number {
  const [f, h] = s.replace('T', ' ').slice(0, 19).split(' ');
  const [y, m, d] = f.split('-').map(Number);
  const [hh, mi] = (h || '00:00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh || 0, mi || 0);
}
const ahoraPared = () => Date.now() - new Date().getTimezoneOffset() * 60_000;
const fmtCorta = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`; };
const fmtHora = (t: number) => { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const fmtFechaHora = (t: number) => (t % MS_DIA === 0 ? fmtCorta(t) : `${fmtCorta(t)} ${fmtHora(t)}`);
const fmtDur = (a: number, b: number) => { const h = Math.max(1, Math.round((b - a) / MS_HORA)); return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`; };
const fmtRestante = (dif: number) => { const h = Math.round(Math.abs(dif) / MS_HORA); return h < 48 ? `${Math.max(1, h)} h` : `${Math.round(h / 24)} d`; };

const ESTILO_ESTADO: Record<string, { barra: string; punto: string; Icon: typeof Circle }> = {
  HECHA: { barra: 'bg-gradient-to-r from-emerald-500 to-emerald-400', punto: 'bg-emerald-500', Icon: CheckCircle2 },
  EN_CURSO: { barra: 'bg-gradient-to-r from-teal-500 to-teal-400', punto: 'bg-teal-500', Icon: PlayCircle },
  VENCIDA: { barra: 'bg-gradient-to-r from-rose-500 to-rose-400', punto: 'bg-rose-500', Icon: AlertTriangle },
  PENDIENTE: { barra: 'bg-zinc-300', punto: 'bg-zinc-300', Icon: Circle },
};

const CLAVE_ABIERTO = 'compras:gantt-tareas-abierto';

interface Fila { t: TareaGantt; desde: number | null; hasta: number | null; claveEstado: string; estilo: typeof ESTILO_ESTADO[string] }

export function GanttComprasCard({ tareas, hitos = null, plegable = true }: { tareas: TareaGantt[]; hitos?: HitosGantt | null; plegable?: boolean }) {
  const [abierto, setAbierto] = useState(!plegable);
  useEffect(() => {
    if (!plegable) return;
    try { setAbierto(localStorage.getItem(CLAVE_ABIERTO) === '1'); } catch { /* sin almacenamiento: queda cerrado */ }
  }, [plegable]);
  const alternar = () => setAbierto(v => { const n = !v; try { localStorage.setItem(CLAVE_ABIERTO, n ? '1' : '0'); } catch { /* no se pudo recordar */ } return n; });

  const { filasPorFase, inicio, total, hoy, marcas, intervaloDia } = useMemo(() => {
    const hoy = ahoraPared();
    const filas: Fila[] = tareas.map(t => {
      const claveEstado = t.estado !== 'HECHA' && t.vencida ? 'VENCIDA' : t.estado;
      let desde: number | null = null, hasta: number | null = null;
      if (t.planInicioAt && t.planFinAt) { desde = ms(t.planInicioAt); hasta = ms(t.planFinAt); }
      else if (!t.fase) {   // tarea manual: registro real
        desde = ms(t.creadoAt);
        hasta = t.estado === 'HECHA' ? ms(t.cerradoAt || t.creadoAt) : (t.plazoAt ? ms(t.plazoAt) : hoy);
      } else if (t.estado === 'HECHA') {   // se hizo antes de que el hito tuviera fecha
        desde = ms(t.creadoAt); hasta = ms(t.cerradoAt || t.creadoAt);
      }
      if (desde != null && hasta != null && hasta <= desde) hasta = desde + MS_HORA;
      return { t, desde, hasta, claveEstado, estilo: ESTILO_ESTADO[claveEstado] };
    });

    const puntos: number[] = [hoy];
    if (hitos) {
      puntos.push(ms(hitos.adjudicacion), ms(hitos.ocLimite));
      for (const f of [hitos.ocEmitida, hitos.ocAceptada, hitos.inicioPlazo, hitos.entrega]) if (f) puntos.push(ms(f));
    }
    for (const f of filas) { if (f.desde != null) puntos.push(f.desde); if (f.hasta != null) puntos.push(f.hasta); }
    const minimo = Math.min(...puntos), maximo = Math.max(...puntos);
    const inicio = Math.floor(minimo / MS_DIA) * MS_DIA;
    const total = Math.max(MS_DIA * 2, Math.ceil((maximo - inicio) / MS_DIA) * MS_DIA + MS_DIA);

    const dias = Math.round(total / MS_DIA);
    const intervaloDia = dias <= 14 ? 1 : dias <= 35 ? 2 : dias <= 70 ? 7 : 14;
    const marcas: number[] = [];
    for (let d = 0; d <= dias; d += intervaloDia) marcas.push(inicio + d * MS_DIA);

    const filasPorFase: Record<string, Fila[]> = { PRE_OC: [], POST_OC: [], ENTREGA: [], PROPIAS: [] };
    for (const f of filas) filasPorFase[f.t.fase ?? 'PROPIAS'].push(f);
    for (const k of Object.keys(filasPorFase)) filasPorFase[k].sort((a, b) => (a.desde ?? Infinity) - (b.desde ?? Infinity));
    return { filasPorFase, inicio, total, hoy, marcas, intervaloDia };
  }, [tareas, hitos]);

  if (tareas.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8 flex flex-col items-center justify-center gap-2 text-center">
        <GanttChartSquare size={26} className="text-zinc-300" />
        <p className="text-[13px] font-semibold text-zinc-500">Todavía no hay tareas para graficar</p>
        <p className="text-[11.5px] text-zinc-400">El Gantt aparece apenas se siembre el checklist de Compras.</p>
      </div>
    );
  }

  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - inicio) / total) * 100))}%`;
  const pctAncho = (a: number, b: number) => `${Math.max(0, ((Math.min(b, inicio + total) - Math.max(a, inicio)) / total) * 100)}%`;
  const todas = Object.values(filasPorFase).flat();
  const hechas = todas.filter(f => f.t.estado === 'HECHA').length;
  const vencidas = todas.filter(f => f.t.estado !== 'HECHA' && f.t.vencida).length;
  const enCurso = todas.filter(f => f.t.estado === 'EN_CURSO' && !f.t.vencida).length;
  const pendientes = todas.length - hechas - vencidas - enCurso;
  const proxima = todas
    .filter(f => f.t.estado !== 'HECHA' && f.t.plazoAt)
    .sort((a, b) => ms(a.t.plazoAt!) - ms(b.t.plazoAt!))
    .map(f => ({ t: f.t, vence: fmtCorta(ms(f.t.plazoAt!)) }))[0] ?? null;

  // ── Línea padre ──────────────────────────────────────────────────────────────────────────────
  const adj = hitos ? ms(hitos.adjudicacion) : null;
  const ocLimite = hitos ? ms(hitos.ocLimite) : null;
  const ocLlego = hitos?.ocEmitida ? ms(hitos.ocEmitida) : null;
  const ocAceptada = hitos?.ocAceptada ? ms(hitos.ocAceptada) : null;
  const ocAceptadaProy = hitos?.ocAceptadaProyectada ? ms(hitos.ocAceptadaProyectada) : null;
  const iniPlazo = hitos?.inicioPlazo ? ms(hitos.inicioPlazo) : null;
  const entrega = hitos?.entrega ? ms(hitos.entrega) : null;
  const ocAtrasada = ocLlego == null && ocLimite != null && ocLimite < hoy;
  const desdeBases = hitos?.inicioPlazoTipo === 'OC_ACEPTADA' ? 'la aceptación de la OC' : hitos?.inicioPlazoTipo === 'OC_EMITIDA' ? 'la llegada de la OC' : hitos?.inicioPlazoTipo === 'ADJUDICACION' ? 'la adjudicación' : null;

  // Tramo 1 (antes de la OC): hasta que llega; si no ha llegado, hasta el límite de aceptación.
  const finPre = ocLlego ?? ocLimite;
  // Tramo 2 (entrega): del inicio del plazo hasta la entrega.
  const llenado = (a: number, b: number) => Math.min(b, Math.max(a, hoy));

  const hitosLinea: Array<{ t: number; etiqueta: string; hecho: boolean; alerta?: boolean }> = [];
  if (adj != null) hitosLinea.push({ t: adj, etiqueta: 'Adjudicación', hecho: true });
  if (ocLlego != null) hitosLinea.push({ t: ocLlego, etiqueta: 'OC llegó', hecho: true });
  else if (ocLimite != null) hitosLinea.push({ t: ocLimite, etiqueta: hitos?.ocLimiteEstimado ? 'Límite OC (tope legal)' : 'Límite OC', hecho: false, alerta: ocAtrasada });
  if (ocAceptada != null && ocAceptada !== ocLlego) hitosLinea.push({ t: ocAceptada, etiqueta: 'OC aceptada', hecho: true });
  else if (ocAceptadaProy != null) hitosLinea.push({ t: ocAceptadaProy, etiqueta: 'Aceptar OC (límite)', hecho: false, alerta: ocAceptadaProy < hoy });
  if (iniPlazo != null && iniPlazo !== ocLlego && iniPlazo !== ocAceptada && iniPlazo !== adj) hitosLinea.push({ t: iniPlazo, etiqueta: 'Inicia el plazo', hecho: iniPlazo <= hoy && !hitos?.inicioProyectado });
  if (entrega != null) hitosLinea.push({ t: entrega, etiqueta: hitos?.entregaOficial ? 'Entrega' : hitos?.inicioProyectado ? 'Entrega (proyectada)' : 'Entrega (estimada)', hecho: false, alerta: entrega < hoy });

  // Etiquetas de hitos cercanos: se escalonan en hasta tres alturas para que no se pisen.
  const hitosOrdenados = [...hitosLinea].sort((a, b) => a.t - b.t).reduce<Array<typeof hitosLinea[number] & { nivel: number }>>((acc, h) => {
    const prev = acc[acc.length - 1];
    acc.push({ ...h, nivel: prev && (h.t - prev.t) / total < 0.2 ? (prev.nivel + 1) % 3 : 0 });
    return acc;
  }, []);
  const maxNivel = Math.max(0, ...hitosOrdenados.map(h => h.nivel));

  const estadoPlazo = !hitos ? null
    : hitos.entrega != null ? `Entrega ${fmtCorta(entrega!)}${hitos.entregaOficial ? '' : hitos.inicioProyectado ? ' (proyectada: si se acepta el último día)' : ' (estimada)'}${desdeBases ? ` · el plazo corre desde ${desdeBases} (bases)` : ''}`
    : hitos.inicioPlazoTipo == null ? 'Inicio del plazo por validar: las bases no dicen desde cuándo corre'
    : `Entrega: se calcula ${hitos.inicioPlazoTipo === 'OC_ACEPTADA' ? 'al aceptarse la OC' : 'al llegar la OC'} (el plazo corre desde ${desdeBases}, según las bases)`;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <button type="button" onClick={plegable ? alternar : undefined} aria-expanded={abierto} disabled={!plegable} data-testid="gantt-tareas-toggle"
        className={`w-full flex items-center justify-between gap-3 px-5 py-3.5 bg-gradient-to-r from-teal-600 to-teal-700 flex-wrap text-left ${plegable ? 'cursor-pointer hover:from-teal-700 hover:to-teal-800' : 'cursor-default'}`}>
        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          <GanttChartSquare size={17} className="text-white flex-shrink-0" />
          <span className="text-[14px] font-bold text-white">Gantt de tareas</span>
          {!abierto && (
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] font-bold text-white bg-white/20 px-2 py-0.5 rounded-full">{hechas}/{todas.length} hechas</span>
              {vencidas > 0 && <span className="text-[10.5px] font-bold text-white bg-rose-500 px-2 py-0.5 rounded-full">{vencidas} vencida{vencidas === 1 ? '' : 's'}</span>}
              {proxima && <span className="text-[11px] text-teal-50 truncate max-w-[420px]">Próxima: <b className="font-semibold">{proxima.t.titulo}</b> · {proxima.t.vencida ? 'venció' : 'vence'} {proxima.vence}</span>}
            </span>
          )}
        </div>
        <span className="flex items-center gap-2 text-[11px] text-teal-50 flex-shrink-0">
          {abierto && <span>{fmtCorta(inicio)} — {fmtCorta(inicio + total - MS_DIA)}</span>}
          {plegable && <span className="inline-flex items-center gap-1 font-semibold">{abierto ? 'Ocultar' : 'Ver detalle'} <ChevronDown size={15} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} /></span>}
        </span>
      </button>
      {abierto && (<>

      <div className="flex items-center gap-2 flex-wrap px-4 sm:px-5 pt-4">
        <span className="text-[11px] font-bold text-zinc-600 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-full">{todas.length} tarea{todas.length === 1 ? '' : 's'}</span>
        {hechas > 0 && <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">{hechas} hecha{hechas === 1 ? '' : 's'}</span>}
        {enCurso > 0 && <span className="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">{enCurso} en curso</span>}
        {vencidas > 0 && <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">{vencidas} vencida{vencidas === 1 ? '' : 's'}</span>}
        {pendientes > 0 && <span className="text-[11px] font-bold text-zinc-500 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-full">{pendientes} pendiente{pendientes === 1 ? '' : 's'}</span>}
      </div>

      <div className="px-4 sm:px-5 pt-3 pb-5">
        {/* Eje de fechas — mismas columnas que las filas de abajo. */}
        <div className={`grid ${LABEL_COL} gap-2 mb-1`}>
          <div />
          <div className="relative h-5">
            {marcas.map((m, i) => (
              <span key={i} className={`absolute top-0 text-[9.5px] font-semibold -translate-x-1/2 ${Math.floor(hoy / MS_DIA) === Math.floor(m / MS_DIA) ? 'text-rose-500' : 'text-zinc-400'}`}
                style={{ left: pct(m) }}>
                {fmtCorta(m)}
              </span>
            ))}
          </div>
        </div>

        {/* LÍNEA PADRE: el proyecto completo. Se va llenando a medida que pasan los hitos. */}
        {hitos && adj != null && finPre != null && (
          <div className={`grid ${LABEL_COL} gap-2 items-center rounded-xl bg-zinc-50 border border-zinc-200 -mx-1.5 px-1.5 py-2 mb-4`} data-testid="gantt-linea-padre">
            <div className="min-w-0">
              <p className="text-[11.5px] font-bold text-zinc-800">Proyecto completo</p>
              <p className="text-[9.5px] text-zinc-500 leading-snug">{estadoPlazo}</p>
            </div>
            <div className="relative" style={{ height: 52 + 12 * maxNivel }}>
              {marcas.map((m, i) => <div key={i} className="absolute top-0 bottom-0 w-px bg-zinc-200/70" style={{ left: pct(m) }} />)}
              {/* Antes de la OC */}
              <div className="absolute top-4 h-4 rounded-l-full bg-amber-100 overflow-hidden" title={`Antes de la OC: ${fmtCorta(adj)} → ${fmtCorta(finPre)}`}
                style={{ left: pct(adj), width: pctAncho(adj, finPre) }}>
                <div className={`h-full ${ocAtrasada ? 'bg-rose-500' : ocLlego != null ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${finPre > adj ? ((llenado(adj, finPre) - adj) / (finPre - adj)) * 100 : 100}%` }} />
              </div>
              {/* Plazo de entrega */}
              {iniPlazo != null && entrega != null ? (
                <div className="absolute top-4 h-4 rounded-r-full bg-teal-100 overflow-hidden" title={`Plazo de entrega: ${fmtCorta(iniPlazo)} → ${fmtCorta(entrega)}`}
                  style={{ left: pct(iniPlazo), width: pctAncho(iniPlazo, entrega) }}>
                  <div className={`h-full ${entrega < hoy ? 'bg-rose-500' : hitos.inicioProyectado ? 'bg-teal-400' : 'bg-teal-600'}`} style={{ width: `${entrega > iniPlazo ? ((llenado(iniPlazo, entrega) - iniPlazo) / (entrega - iniPlazo)) * 100 : 100}%` }} />
                </div>
              ) : (
                <div className="absolute top-4 h-4 rounded-r-full border border-dashed border-zinc-300 flex items-center px-2 text-[9px] font-semibold text-zinc-400 whitespace-nowrap overflow-hidden"
                  style={{ left: pct(finPre), width: `max(120px, ${pctAncho(finPre, finPre + 10 * MS_DIA)})` }}>
                  {hitos.inicioPlazoTipo == null ? 'Plazo de entrega: inicio por validar' : `Plazo de entrega${hitos.plazoEntregaDias != null ? ` (${hitos.plazoEntregaDias} d)` : ''}: parte con ${hitos.inicioPlazoTipo === 'OC_ACEPTADA' ? 'la aceptación de la OC' : 'la OC'}`}
                </div>
              )}
              {/* Hitos */}
              {hitosOrdenados.map((h, i) => (
                <div key={i} className="absolute top-0 -translate-x-1/2 z-10" style={{ left: pct(h.t) }} title={`${h.etiqueta} · ${fmtCorta(h.t)}`}>
                  <span className={`block w-2.5 h-2.5 rotate-45 border-2 mx-auto ${h.hecho ? 'bg-emerald-500 border-emerald-600' : h.alerta ? 'bg-rose-500 border-rose-600' : 'bg-white border-zinc-400'}`} />
                  {h.nivel > 0 && <span className="block w-px bg-zinc-300 mx-auto" style={{ height: 24 + 12 * h.nivel }} />}
                  <span className={`block text-[9px] font-bold whitespace-nowrap ${h.nivel > 0 ? '' : 'mt-6'} ${h.hecho ? 'text-emerald-700' : h.alerta ? 'text-rose-600' : 'text-zinc-500'}`}>{h.etiqueta} · {fmtCorta(h.t)}</span>
                </div>
              ))}
              <div className="absolute top-0 bottom-0 w-0.5 bg-rose-300 z-10" style={{ left: pct(hoy) }} />
            </div>
          </div>
        )}

        <div className="space-y-4">
          {FASES.map(fase => {
            const items = filasPorFase[fase.clave];
            if (!items || items.length === 0) return null;
            const hechasFase = items.filter(f => f.t.estado === 'HECHA').length;
            return (
              <div key={fase.clave}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <p className="text-[10.5px] font-bold text-teal-700 bg-teal-50 inline-block px-2 py-0.5 rounded-full uppercase" title={fase.ayuda}>{fase.titulo}</p>
                  <span className="text-[10px] font-semibold text-zinc-400">{hechasFase}/{items.length} hechas</span>
                </div>
                <div className="space-y-1">
                  {items.map(({ t, desde, hasta, claveEstado, estilo }) => {
                    const conBarra = desde != null && hasta != null;
                    const esperaHito = !conBarra && !!t.fase;
                    const restante = t.plazoAt ? ms(t.plazoAt) - hoy : null;
                    const estadoTxt = t.estado === 'HECHA' ? `Hecha ${fmtCorta(ms(t.cerradoAt || t.creadoAt))}`
                      : restante == null ? 'Sin plazo'
                      : restante < 0 ? `Venció hace ${fmtRestante(restante)}`
                      : `Vence en ${fmtRestante(restante)}`;
                    const estadoClase = t.estado === 'HECHA' ? 'text-emerald-600' : restante != null && restante < 0 ? 'text-rose-600' : restante != null && restante <= MS_DIA ? 'text-amber-600' : 'text-zinc-500';
                    return (
                      <div key={t.id} className={`grid ${LABEL_COL} gap-2 items-center rounded-lg -mx-1.5 px-1.5 py-1.5 transition-colors hover:bg-zinc-50`}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <estilo.Icon size={12} className={`flex-shrink-0 ${claveEstado === 'VENCIDA' ? 'text-rose-500' : claveEstado === 'HECHA' ? 'text-emerald-500' : claveEstado === 'EN_CURSO' ? 'text-teal-500' : 'text-zinc-300'}`} />
                            <span className="text-[11.5px] font-semibold text-zinc-700 truncate" title={t.titulo}>{t.titulo}</span>
                            {t.esManual && <span title="Tarea propia del proyecto"><Wand size={10} className="flex-shrink-0 text-indigo-400" /></span>}
                            {t.hallazgo && <span title="Quedó un hallazgo registrado"><Flag size={10} className="flex-shrink-0 text-rose-500" /></span>}
                          </div>
                          <p className="text-[9.5px] text-zinc-400 truncate pl-[18px]">
                            {conBarra ? `${fmtFechaHora(desde!)} → ${fmtFechaHora(hasta!)} · ${fmtDur(desde!, hasta!)}` : esperaHito ? 'Sin fecha todavía' : ''}
                            {t.responsableNombre && <span className="inline-flex items-center gap-0.5 ml-1"><UserFilled size={9} className="inline -mt-0.5" /> {t.responsableNombre}</span>}
                          </p>
                        </div>
                        <div className="relative h-6">
                          {marcas.map((m, i) => <div key={i} className="absolute top-0 bottom-0 w-px bg-zinc-100" style={{ left: pct(m) }} />)}
                          <div className="absolute top-0 bottom-0 w-0.5 bg-rose-300 z-10" style={{ left: pct(hoy) }} />
                          {conBarra ? (<>
                            <div
                              title={`${t.titulo} · ${fmtFechaHora(desde!)} → ${fmtFechaHora(hasta!)} · ${fmtDur(desde!, hasta!)}${t.responsableNombre ? ` · ${t.responsableNombre}` : ''}`}
                              className={`absolute top-1 bottom-1 rounded-full shadow-sm ring-1 ring-black/5 transition-all hover:brightness-95 hover:scale-y-110 ${estilo.barra}`}
                              style={{ left: pct(desde!), width: `max(6px, ${pctAncho(desde!, hasta!)})` }} />
                            <span className={`absolute top-1/2 text-[10px] font-bold whitespace-nowrap z-10 ${estadoClase}`}
                              style={{ left: pct(hasta!), transform: 'translate(6px, -50%)' }}>
                              {estadoTxt}
                            </span>
                          </>) : esperaHito ? (
                            <span className="absolute inset-y-1 left-0 right-0 rounded-full border border-dashed border-zinc-200 flex items-center px-3 text-[9.5px] font-semibold text-zinc-400 truncate">
                              {t.fase === 'ENTREGA' ? 'Se calcula cuando corra el plazo de entrega' : 'Se calcula al llegar la OC'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3.5 flex-wrap mt-4 pt-3 border-t border-zinc-100 text-[10.5px] text-zinc-500">
          {([['HECHA', 'Hecha'], ['EN_CURSO', 'En curso'], ['VENCIDA', 'Vencida'], ['PENDIENTE', 'Pendiente']] as const).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${ESTILO_ESTADO[k].punto}`} /> {label}</span>
          ))}
          <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-rose-300 inline-block rounded-full" /> Hoy</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rotate-45 bg-emerald-500 inline-block" /> Hito cumplido</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rotate-45 bg-white border border-zinc-400 inline-block" /> Hito pendiente</span>
          {intervaloDia > 1 && <span className="text-zinc-400">Eje cada {intervaloDia} días</span>}
        </div>
      </div>
      </>)}
    </div>
  );
}
