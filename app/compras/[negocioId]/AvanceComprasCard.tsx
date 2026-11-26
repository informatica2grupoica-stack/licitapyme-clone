'use client';

// AVANCE DE LA LICITACIÓN (Compras): lo que las dos personas que la trabajan necesitan ver sin preguntarse.
// Por producto: cuántas cotizaciones tiene, qué proveedor se eligió, si está aprobado, si tiene SKU y OC, quién lo hizo y qué falta.
// Lee GET /api/compras/[negocioId]/avance (solo base de datos). Sustituye al botón «Obuma» bajo el flujo de pasos.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconLoader2 as Loader2, IconRefresh as RefreshCw, IconCheck as Check, IconCircleDashed as Pendiente, IconAlertTriangle as Alerta, IconCircleHalf2 as Parcial, IconArrowRight as ArrowRight, IconBell as Bell } from '@tabler/icons-react';
import { irAFase, enfocarProducto, type FaseCompras } from './comprasNavegacion';
import type { Avance, ClavePaso, EstadoPaso, ItemAvance, PasoAvance } from '@/app/lib/compras-avance-core';
import type { EventoNovedad } from './useNovedadesCompras';

// Semáforo: verde = hecho, ámbar = a medias, gris = falta, rojo = rechazado. Misma paleta en celdas, segmentos y leyenda.
const COLOR: Record<EstadoPaso, string> = {
  hecho: 'text-emerald-800 dark:text-emerald-300', parcial: 'text-amber-800 dark:text-amber-300', falta: 'text-slate-500 dark:text-slate-400', rechazado: 'text-rose-800 dark:text-rose-300',
};
const FONDO: Record<EstadoPaso, string> = {
  hecho: 'bg-emerald-50 dark:bg-emerald-950/30', parcial: 'bg-amber-50 dark:bg-amber-950/30', falta: 'bg-slate-50 dark:bg-slate-900/40', rechazado: 'bg-rose-50 dark:bg-rose-950/30',
};
const SEGMENTO: Record<EstadoPaso, string> = { hecho: 'bg-emerald-500', parcial: 'bg-amber-400', falta: 'bg-slate-300 dark:bg-slate-600', rechazado: 'bg-rose-500' };
const bordeFila = (i: ItemAvance) => i.completo ? 'border-l-emerald-500' : i.pasos.some(p => p.estado === 'rechazado') ? 'border-l-rose-500' : i.pasos.some(p => p.estado !== 'falta') ? 'border-l-amber-400' : 'border-l-slate-200 dark:border-l-slate-700';
function IconoPaso({ estado }: { estado: EstadoPaso }) {
  if (estado === 'hecho') return <Check size={13} className="text-emerald-600 flex-shrink-0" strokeWidth={3} />;
  if (estado === 'parcial') return <Parcial size={13} className="text-amber-600 flex-shrink-0" />;
  if (estado === 'rechazado') return <Alerta size={13} className="text-rose-600 flex-shrink-0" />;
  return <Pendiente size={13} className="text-slate-400 flex-shrink-0" />;
}

// «2026-11-26 11:05:00» → «26/11 11:05»
const fmtCorto = (s: string | null) => (s && s.length >= 16 ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : s ?? '');

/** A qué paso del flujo lleva cada pendiente. */
const DESTINO: Record<ClavePaso, { fase: FaseCompras; pestana: string | null }> = {
  cotizar: { fase: 'costeo', pestana: null }, elegir: { fase: 'costeo', pestana: null },
  aprobar: { fase: 'aprobacion', pestana: null }, sku: { fase: 'aprobacion', pestana: null }, oc: { fase: 'compra', pestana: 'pasos' },
};

function Celda({ p }: { p: PasoAvance }) {
  return (
    <td className="px-1 py-1.5 align-top min-w-[108px]">
      <div className={`rounded-md px-1.5 py-1 h-full ${FONDO[p.estado]}`}>
        <div className={`flex items-start gap-1 text-[12px] font-semibold leading-tight ${COLOR[p.estado]}`}>
          <span className="mt-[1px]"><IconoPaso estado={p.estado} /></span>
          <span className="break-words min-w-0">{p.texto}</span>
        </div>
        {p.por && <p className="text-[10.5px] text-tinta-2 dark:text-slate-400 mt-0.5 pl-[17px] leading-tight">{p.por}{p.at ? ` · ${fmtCorto(p.at)}` : ''}</p>}
      </div>
    </td>
  );
}

export function AvanceComprasCard({ negocioId, novedades, onVistas, version }: {
  negocioId: number; novedades: EventoNovedad[]; onVistas: () => void;
  /** Cambia cuando algo se movió (tareas, novedades): recarga el avance. */
  version: number;
}) {
  const [avance, setAvance] = useState<Avance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [soloFalta, setSoloFalta] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/avance`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar el avance');
      setAvance(data.avance); setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar, version]);

  // El «correlativo» del acta se repite (varios productos bajo la línea 1): se numera por posición en la lista completa.
  const posicion = useMemo(() => new Map((avance?.items ?? []).map((i, n) => [i.id, n + 1])), [avance]);
  const items = useMemo(() => (avance?.items ?? []).filter(i => !soloFalta || !i.completo), [avance, soloFalta]);

  if (cargando && !avance) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  if (error && !avance) return <p className="text-[13px] text-rose-700 py-4">{error}</p>;
  if (!avance) return null;

  const ir = (it: ItemAvance) => {
    const clave = it.pasos.find(p => p.estado === 'rechazado')?.clave ?? it.pasos.find(p => p.estado === 'falta' || p.estado === 'parcial')?.clave;
    if (!clave) return;
    const d = DESTINO[clave];
    irAFase(d.fase);
    setTimeout(() => document.getElementById('compras-flujo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    enfocarProducto(d.pestana, it.id);
  };

  return (
    <div className="space-y-3" data-testid="avance-compras">
      {/* Progreso general */}
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold text-tinta dark:text-slate-100">{avance.hechos} de {avance.total} pasos hechos</p>
            <p className="text-[12px] text-tinta-2 dark:text-slate-400">{avance.itemsCompletos} de {avance.items.length} productos listos</p>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 mt-1.5 overflow-hidden" role="progressbar" aria-valuenow={avance.porcentaje} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-teal-600 rounded-full transition-[width] duration-300" style={{ width: `${avance.porcentaje}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {avance.globales.map(g => (
            <span key={g.clave} title={g.por ? `${g.por}${g.at ? ` · ${fmtCorto(g.at)}` : ''}` : undefined}
              className={`inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-full border ${
                g.estado === 'hecho' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : g.estado === 'rechazado' ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : g.estado === 'parcial' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 dark:bg-slate-950/40 border-linea dark:border-slate-800 text-tinta-2'}`}>
              <IconoPaso estado={g.estado} /> {g.titulo}: {g.texto}
            </span>
          ))}
        </div>
      </div>

      {/* Lo que hizo la otra persona desde la última visita */}
      {novedades.length > 0 && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 dark:bg-teal-950/20 dark:border-teal-900 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-semibold text-teal-800 dark:text-teal-300 flex items-center gap-1.5"><Bell size={14} /> Desde tu última visita ({novedades.length})</p>
            <button type="button" onClick={onVistas} className="text-[12px] font-semibold text-teal-700 hover:text-teal-900">Marcar como visto</button>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {novedades.slice(-6).reverse().map((e, i) => (
              <li key={`${e.creadoAt}-${i}`} className="text-[12px] text-tinta dark:text-slate-200 leading-snug">
                <span className="font-semibold">{e.actor}</span> · {e.mensaje} <span className="text-tinta-2 dark:text-slate-500">({fmtCorto(e.creadoAt)})</span>
              </li>
            ))}
          </ul>
          {novedades.length > 6 && <p className="text-[11.5px] text-tinta-2 mt-1">y {novedades.length - 6} más en la pestaña Actividad.</p>}
        </div>
      )}

      {/* Tabla por producto */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11.5px] text-tinta-2 dark:text-slate-400" aria-label="Leyenda de colores">
        {([['hecho', 'Hecho'], ['parcial', 'A medias'], ['falta', 'Falta'], ['rechazado', 'Rechazado']] as const).map(([k, t]) => (
          <span key={k} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${SEGMENTO[k]}`} /> {t}</span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-tinta dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={soloFalta} onChange={e => setSoloFalta(e.target.checked)} className="accent-teal-600" /> Solo lo que falta
        </label>
        <button type="button" onClick={cargar} disabled={cargando} className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-50">
          <RefreshCw size={12} className={cargando ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-tinta-2 dark:text-slate-400 py-4 text-center">{avance.items.length === 0 ? 'Esta licitación todavía no tiene productos.' : 'Todos los productos están listos.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-linea dark:border-slate-800">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/40 text-[11.5px] text-tinta-2 dark:text-slate-400">
                <th className="px-2 py-1.5 font-semibold">Producto</th>
                {avance.items[0]?.pasos.map(p => <th key={p.clave} className="px-2 py-1.5 font-semibold whitespace-nowrap">{p.titulo}</th>)}
                <th className="px-2 py-1.5 font-semibold">Falta</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} data-producto-id={it.id} className={`border-t border-linea dark:border-slate-800 border-l-4 ${bordeFila(it)} hover:bg-slate-50/60 dark:hover:bg-slate-900/40`}>
                  <td className="px-2 py-2 align-top max-w-[220px]">
                    <p className="text-[12.5px] font-semibold text-tinta dark:text-slate-100 leading-tight">{posicion.get(it.id)}. {it.descripcion}</p>
                    <div className="flex gap-0.5 mt-1.5" aria-label={`${it.pasos.filter(p => p.estado === 'hecho').length} de ${it.pasos.length} pasos hechos`}>
                      {it.pasos.map(p => <span key={p.clave} title={`${p.titulo}: ${p.texto}`} className={`h-1.5 flex-1 rounded-full ${SEGMENTO[p.estado]}`} />)}
                    </div>
                  </td>
                  {it.pasos.map(p => <Celda key={p.clave} p={p} />)}
                  <td className="px-2 py-2 align-top min-w-[130px]">
                    {it.falta ? (
                      <button type="button" onClick={() => ir(it)} className="inline-flex items-center gap-1 text-left text-[12px] font-semibold text-teal-700 hover:text-teal-900">
                        {it.falta} <ArrowRight size={12} className="flex-shrink-0" />
                      </button>
                    ) : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><Check size={13} strokeWidth={3} /> Listo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
