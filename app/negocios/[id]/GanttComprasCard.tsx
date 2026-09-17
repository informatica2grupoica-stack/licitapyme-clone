'use client';

// GANTT DE TAREAS — pedido explícito del usuario (11-sep-2026): "saber qué se hizo en este
// proyecto, la carta Gantt real esa que hiciste es fea, tiene que ser una real profesional".
// Rediseñado con eje de fechas real (semanas), grilla vertical, barras con degradado/sombra y
// franja de "hoy" fija. Usa las tareas YA cargadas por el contexto de Compras (mismo array que la
// página de Tareas) — sin llamada de red aparte.
//
// OJO con lo que este Gantt NO es: las tareas de Compras no tienen fecha de inicio/fin
// PLANIFICADA de antemano (no hay "se calendarizó para el 5 de octubre"). Lo que sí hay es real:
// cuándo se creó la tarea (creadoAt), cuándo se cerró (cerradoAt) y cuál era su plazo (plazoAt).
// La barra va de creadoAt a cerradoAt (si ya se hizo) o a plazoAt/hoy (si sigue abierta) — es un
// registro de lo que pasó, no una planificación.
import { useMemo } from 'react';
import { IconTimeline as GanttChartSquare, IconCircleCheck as CheckCircle2, IconPlayerPlay as PlayCircle, IconAlertTriangle as AlertTriangle, IconCircle as Circle, IconUserFilled as UserFilled, IconFlag as Flag, IconWand as Wand } from '@tabler/icons-react';

interface TareaGantt {
  id: number; categoria: string; titulo: string;
  estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA';
  responsableNombre: string | null;
  plazoAt: string | null; creadoAt: string; cerradoAt: string | null; vencida: boolean;
  esManual?: boolean; hallazgo?: boolean;
}

const CATEGORIA_LABEL: Record<string, string> = { VALIDACION: 'Validación', ADMINISTRATIVO: 'Plazos administrativos', MANUAL: 'Tareas propias del proyecto' };
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const LABEL_COL = 'grid-cols-[150px_1fr] sm:grid-cols-[240px_1fr]';

function soloFecha(s: string): Date {
  const [f] = s.replace(' ', 'T').split('T');
  const [y, m, d] = f.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const diasEntre = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
const fmtCorta = (d: Date) => `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`;

const ESTILO_ESTADO: Record<string, { barra: string; punto: string; Icon: typeof Circle }> = {
  HECHA: { barra: 'bg-gradient-to-r from-emerald-500 to-emerald-400', punto: 'bg-emerald-500', Icon: CheckCircle2 },
  EN_CURSO: { barra: 'bg-gradient-to-r from-teal-500 to-teal-400', punto: 'bg-teal-500', Icon: PlayCircle },
  VENCIDA: { barra: 'bg-gradient-to-r from-rose-500 to-rose-400', punto: 'bg-rose-500', Icon: AlertTriangle },
  PENDIENTE: { barra: 'bg-zinc-300', punto: 'bg-zinc-300', Icon: Circle },
};

export function GanttComprasCard({ tareas }: { tareas: TareaGantt[] }) {
  const { filas, inicio, totalDias, hoy, marcas } = useMemo(() => {
    const hoy = soloFecha(new Date().toISOString());
    if (tareas.length === 0) return { filas: [], inicio: hoy, totalDias: 1, hoy, marcas: [] as Date[] };

    const inicio = tareas.reduce((min, t) => {
      const d = soloFecha(t.creadoAt);
      return d < min ? d : min;
    }, soloFecha(tareas[0].creadoAt));

    const fin = tareas.reduce((max, t) => {
      const d = soloFecha(t.cerradoAt || t.plazoAt || t.creadoAt);
      return d > max ? d : max;
    }, hoy);

    const totalDias = Math.max(1, diasEntre(inicio, fin)) + 2; // +2: un respiro al final

    const filas = [...tareas]
      .sort((a, b) => soloFecha(a.creadoAt).getTime() - soloFecha(b.creadoAt).getTime())
      .map(t => {
        const desde = soloFecha(t.creadoAt);
        const hasta = t.estado === 'HECHA' ? soloFecha(t.cerradoAt || t.creadoAt) : (t.plazoAt ? soloFecha(t.plazoAt) : hoy);
        const finReal = hasta < desde ? desde : hasta;
        const offset = diasEntre(inicio, desde);
        const largo = Math.max(1, diasEntre(desde, finReal) + 1);
        const claveEstado = t.estado !== 'HECHA' && t.vencida ? 'VENCIDA' : t.estado;
        return { t, offset, largo, estilo: ESTILO_ESTADO[claveEstado] };
      });

    // Marcas del eje (pedido explícito, 17-sep-2026: "no se donde comenzaron las tareas ni donde
    // terminaron con fecha o dias") — antes eran solo lunes, así que un proyecto de 8 días podía
    // mostrar UNA sola marca en toda la pantalla. Ahora el intervalo se adapta al rango: día por
    // día para proyectos cortos (lo normal acá, spec §15.7: "nuestros plazos son más cortos"),
    // cada 2-3 días para rangos medianos, semanal solo para proyectos largos.
    const intervalo = totalDias <= 14 ? 1 : totalDias <= 35 ? 2 : totalDias <= 70 ? 7 : 14;
    const marcas: Date[] = [];
    for (let d = 0; d <= totalDias; d += intervalo) marcas.push(new Date(inicio.getTime() + d * 86_400_000));

    return { filas, inicio, totalDias, hoy, marcas };
  }, [tareas]);

  if (tareas.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8 flex flex-col items-center justify-center gap-2 text-center">
        <GanttChartSquare size={26} className="text-zinc-300" />
        <p className="text-[13px] font-semibold text-zinc-500">Todavía no hay tareas para graficar</p>
        <p className="text-[11.5px] text-zinc-400">El Gantt aparece apenas se siembre el checklist de Compras.</p>
      </div>
    );
  }

  const porCategoria: Record<string, typeof filas> = {};
  for (const f of filas) (porCategoria[f.t.categoria] ||= []).push(f);
  const offsetHoy = diasEntre(inicio, hoy);
  const pct = (dias: number) => `${(dias / totalDias) * 100}%`;

  // Más detalle (pedido explícito, 17-sep-2026): un resumen de avance arriba, que se recalcula solo
  // con el mismo array `tareas` — a medida que se agregan tareas (manuales o del catálogo) o cambian
  // de estado en cualquier otra pantalla, este número crece o baja sin tocar nada acá.
  const hechas = filas.filter(f => f.t.estado === 'HECHA').length;
  const vencidas = filas.filter(f => f.t.estado !== 'HECHA' && f.t.vencida).length;
  const enCurso = filas.filter(f => f.t.estado === 'EN_CURSO' && !f.t.vencida).length;
  const pendientes = filas.length - hechas - vencidas - enCurso;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-teal-600 to-teal-700 flex-wrap">
        <div className="flex items-center gap-2">
          <GanttChartSquare size={17} className="text-white" />
          <span className="text-[14px] font-bold text-white">Gantt de tareas</span>
        </div>
        <span className="text-[11px] text-teal-50">{fmtCorta(inicio)} — hoy ({fmtCorta(hoy)})</span>
      </div>

      {/* Resumen de avance — crece o baja solo a medida que se agregan o cierran tareas en
          cualquier pantalla (mismo array `tareas` del contexto compartido). */}
      <div className="flex items-center gap-2 flex-wrap px-4 sm:px-5 pt-4">
        <span className="text-[11px] font-bold text-zinc-600 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-full">{filas.length} tarea{filas.length === 1 ? '' : 's'}</span>
        {hechas > 0 && <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">{hechas} hecha{hechas === 1 ? '' : 's'}</span>}
        {enCurso > 0 && <span className="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">{enCurso} en curso</span>}
        {vencidas > 0 && <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">{vencidas} vencida{vencidas === 1 ? '' : 's'}</span>}
        {pendientes > 0 && <span className="text-[11px] font-bold text-zinc-500 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-full">{pendientes} pendiente{pendientes === 1 ? '' : 's'}</span>}
      </div>

      <div className="px-4 sm:px-5 pt-3">
        <div className="flex items-center gap-3.5 flex-wrap text-[11px] text-zinc-500 pb-3">
          {([
            ['HECHA', 'Hecha'], ['EN_CURSO', 'En curso'], ['VENCIDA', 'Vencida'], ['PENDIENTE', 'Pendiente'],
          ] as const).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${ESTILO_ESTADO[k].punto}`} /> {label}
            </span>
          ))}
        </div>
      </div>

      <div className="px-4 sm:px-5 pb-5">
        {/* Eje de fechas — mismas columnas que las filas de abajo, así las semanas quedan
            alineadas con las barras sin medir nada en JS. */}
        <div className={`grid ${LABEL_COL} gap-2 mb-1`}>
          <div />
          <div className="relative h-5">
            {marcas.map((m, i) => (
              <span key={i} className={`absolute top-0 text-[9.5px] font-semibold -translate-x-1/2 ${diasEntre(inicio, m) === offsetHoy ? 'text-rose-500' : 'text-zinc-400'}`}
                style={{ left: pct(diasEntre(inicio, m)) }}>
                {fmtCorta(m)}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {Object.entries(porCategoria).map(([cat, items]) => (
            <div key={cat}>
              <p className="text-[10.5px] font-bold text-teal-700 bg-teal-50 inline-block px-2 py-0.5 rounded-full uppercase mb-2">
                {CATEGORIA_LABEL[cat] || cat}
              </p>
              <div className="space-y-1">
                {items.map(({ t, offset, largo, estilo }) => {
                  const dias = largo;
                  const hastaTexto = t.estado === 'HECHA' ? fmtCorta(soloFecha(t.cerradoAt || t.creadoAt)) : 'hoy';
                  return (
                  <div key={t.id}
                    className={`grid ${LABEL_COL} gap-2 items-center rounded-lg -mx-1.5 px-1.5 py-1.5 transition-colors hover:bg-zinc-50`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <estilo.Icon size={12} className={`flex-shrink-0 ${
                          estilo === ESTILO_ESTADO.VENCIDA ? 'text-rose-500' : estilo === ESTILO_ESTADO.HECHA ? 'text-emerald-500' : estilo === ESTILO_ESTADO.EN_CURSO ? 'text-teal-500' : 'text-zinc-300'
                        }`} />
                        <span className="text-[11.5px] font-semibold text-zinc-700 truncate" title={t.titulo}>{t.titulo}</span>
                        {t.esManual && <span title="Tarea propia del proyecto"><Wand size={10} className="flex-shrink-0 text-indigo-400" /></span>}
                        {t.hallazgo && <span title="Quedó un hallazgo registrado"><Flag size={10} className="flex-shrink-0 text-rose-500" /></span>}
                      </div>
                      <p className="text-[9.5px] text-zinc-400 truncate pl-[18px]">
                        {fmtCorta(soloFecha(t.creadoAt))} → {hastaTexto} · {dias} día{dias === 1 ? '' : 's'}
                        {t.responsableNombre && <span className="inline-flex items-center gap-0.5 ml-1"><UserFilled size={9} className="inline -mt-0.5" /> {t.responsableNombre}</span>}
                      </p>
                    </div>
                    <div className="relative h-6">
                      {/* Grilla vertical — mismo eje que el encabezado. */}
                      {marcas.map((m, i) => (
                        <div key={i} className="absolute top-0 bottom-0 w-px bg-zinc-100" style={{ left: pct(diasEntre(inicio, m)) }} />
                      ))}
                      {/* "Hoy" — línea propia, por encima de la grilla. */}
                      <div className="absolute top-0 bottom-0 w-0.5 bg-rose-300 z-10" style={{ left: pct(offsetHoy) }} />
                      {/* Fecha de inicio, pegada al borde izquierdo de la barra (pedido explícito,
                          17-sep-2026: "no se donde comenzaron las tareas ni donde terminaron"). */}
                      <span className="absolute top-1/2 text-[9px] font-semibold text-zinc-400 whitespace-nowrap z-10"
                        style={{ left: pct(offset), transform: 'translate(calc(-100% - 5px), -50%)' }}>
                        {fmtCorta(soloFecha(t.creadoAt))}
                      </span>
                      <div
                        title={`${t.titulo} · ${fmtCorta(soloFecha(t.creadoAt))} → ${hastaTexto} · ${dias} día${dias === 1 ? '' : 's'}${t.responsableNombre ? ` · ${t.responsableNombre}` : ''}`}
                        className={`absolute top-1 bottom-1 rounded-full shadow-sm ring-1 ring-black/5 transition-all hover:brightness-95 hover:scale-y-110 ${estilo.barra}`}
                        style={{ left: pct(offset), width: `max(6px, ${pct(largo)})` }}
                      />
                      {/* Fecha de término (o "hoy" si sigue abierta), pegada al borde derecho. */}
                      <span className="absolute top-1/2 text-[9px] font-semibold text-zinc-500 whitespace-nowrap z-10"
                        style={{ left: pct(offset + largo), transform: 'translate(5px, -50%)' }}>
                        {hastaTexto}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-zinc-100 text-[10.5px] text-zinc-400">
          <span className="w-0.5 h-3 bg-rose-300 inline-block rounded-full" /> Hoy
        </div>
      </div>
    </div>
  );
}
