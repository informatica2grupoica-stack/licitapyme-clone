'use client';

// «QUÉ SE VA A APROBAR»: tabla línea por línea con lo que paga el cliente, lo costeado, lo que se compra y a quién, la diferencia, el
// margen, la ficha técnica y un veredicto con el motivo. Antes el jefe de ventas aprobaba mirando solo dos totales. Solo lectura:
// las decisiones siguen en los dos hitos de abajo.
import { useEffect, useState, useCallback } from 'react';
import { IconLoader2 as Loader2, IconCircleCheck as Ok, IconAlertTriangle as Alerta, IconCircleX as No, IconHelpCircle as Duda } from '@tabler/icons-react';
import type { TablaAprobacion, LineaAprobacion } from '@/app/lib/compras-aprobacion-tabla';

const clp = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const corto = (d: string) => d.split(' - ')[0];

const ESTADO: Record<LineaAprobacion['estado'], { texto: string; clase: string }> = {
  PASA: { texto: 'Pasa', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REVISAR: { texto: 'Revisar', clase: 'bg-amber-50 text-amber-800 border-amber-200' },
  NO_PASA: { texto: 'No pasa', clase: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const TECNICO: Record<string, { texto: string; clase: string }> = {
  CUMPLE: { texto: 'Cumple', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NO_CUMPLE: { texto: 'No cumple', clase: 'bg-rose-50 text-rose-700 border-rose-200' },
  FALTA_DATO: { texto: 'Falta dato', clase: 'bg-amber-50 text-amber-800 border-amber-200' },
  SIN_COMPARAR: { texto: 'Sin comparar', clase: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  SIN_FICHA: { texto: 'Sin ficha', clase: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  SIN_COMPRA: { texto: '—', clase: 'bg-zinc-50 text-zinc-400 border-zinc-200' },
};

export function TablaAprobacionCompra({ negocioId, refresco }: { negocioId: number; refresco: string }) {
  const [tabla, setTabla] = useState<TablaAprobacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'TODAS' | 'PROBLEMAS'>('TODAS');

  const cargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/aprobaciones/tabla`).then(r => r.json());
      if (d.success) { setTabla(d.tabla); setError(null); } else setError(d.error || 'No se pudo cargar');
    } catch (e: any) { setError(e.message || 'No se pudo cargar'); }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar, refresco]);
  useEffect(() => {
    const h = () => { cargar(); };
    window.addEventListener('compras:fichas-cambio', h);
    return () => window.removeEventListener('compras:fichas-cambio', h);
  }, [cargar]);

  if (error) return <p className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">No se pudo mostrar el detalle de lo que se aprueba: {error} <button onClick={cargar} className="underline font-semibold ml-1">Reintentar</button></p>;
  if (!tabla) return <div className="flex items-center gap-2 text-[12px] text-zinc-400 py-4"><Loader2 size={14} className="animate-spin" /> Armando el detalle de lo que se aprueba…</div>;

  const t = tabla.totales;
  const conteo = { PASA: 0, REVISAR: 0, NO_PASA: 0 } as Record<string, number>;
  tabla.lineas.forEach(l => { conteo[l.estado]++; });
  const visibles = tabla.lineas.filter(l => filtro === 'TODAS' || l.estado !== 'PASA');
  const ventaTotal = t.venta, costoTotal = t.compra + t.flete;

  return (
    <div className="space-y-3" data-testid="tabla-aprobacion">
      <p className="text-[11px] font-bold text-zinc-400 uppercase px-0.5">Qué se va a aprobar</p>

      {/* Resumen en cuatro números */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Cifra titulo="El cliente paga" valor={clp(ventaTotal)} sub={`${t.lineasTotal} líneas ganadas`} />
        <Cifra titulo="Se había costeado" valor={clp(t.costeado)} sub="presupuesto al ofertar" />
        <Cifra titulo="Se va a comprar" valor={clp(costoTotal)} sub={`mercadería ${clp(t.compra)} + flete ${clp(t.flete)}`}
          alerta={costoTotal > t.costeado ? 'Sobre lo costeado' : null} bien={costoTotal <= t.costeado ? `${Math.round((1 - costoTotal / t.costeado) * 1000) / 10}% bajo lo costeado` : null} />
        <Cifra titulo="Margen" valor={t.margenCompletoPct != null ? `${t.margenCompletoPct}%` : '—'}
          sub={t.lineasSinCompra > 0 ? `${t.lineasSinCompra} línea(s) sin compra: costo estimado` : 'con todas las líneas'}
          alerta={t.margenCompletoPct != null && t.margenCompletoPct < 20 ? 'Bajo el mínimo de 20 %' : null} bien={t.margenCompletoPct != null && t.margenCompletoPct >= 20 ? 'Sobre el mínimo de 20 %' : null} />
      </div>

      {/* Lista de verificaciones: qué pasa y qué no */}
      <div className="bg-white rounded-xl border border-zinc-200 p-3.5">
        <p className="text-[12.5px] font-bold text-zinc-800 mb-2">Revisión automática antes de aprobar</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          {tabla.verificaciones.map(v => (
            <li key={v.titulo} className="flex items-start gap-2 text-[12px]">
              {v.ok === true ? <Ok size={15} className="text-emerald-600 flex-shrink-0 mt-0.5" /> : v.ok === false ? <No size={15} className="text-rose-600 flex-shrink-0 mt-0.5" /> : <Duda size={15} className="text-zinc-400 flex-shrink-0 mt-0.5" />}
              <span><b className="text-zinc-800">{v.titulo}.</b> <span className="text-zinc-500">{v.detalle}</span></span>
            </li>
          ))}
        </ul>
      </div>

      {/* Tabla por línea */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap px-3.5 py-2.5 bg-zinc-50 border-b border-zinc-100">
          <p className="text-[12.5px] font-bold text-zinc-800 mr-1">Detalle por producto</p>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">{conteo.PASA} pasan</span>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-200">{conteo.REVISAR} por revisar</span>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">{conteo.NO_PASA} no pasan</span>
          <div className="ml-auto flex rounded-lg border border-zinc-200 overflow-hidden text-[11.5px] font-semibold">
            {(['TODAS', 'PROBLEMAS'] as const).map(f => (
              <button key={f} type="button" onClick={() => setFiltro(f)} className={`px-2.5 py-1 ${filtro === f ? 'bg-teal-600 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}>{f === 'TODAS' ? 'Todas' : 'Solo con observaciones'}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[980px]">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase text-zinc-400 border-b border-zinc-100">
                <th className="px-3 py-2 w-8">#</th>
                <th className="px-2 py-2">Producto</th>
                <th className="px-2 py-2 text-right">Cant.</th>
                <th className="px-2 py-2 text-right">Cliente paga (c/u)</th>
                <th className="px-2 py-2 text-right">Costeado (c/u)</th>
                <th className="px-2 py-2">Se compra a</th>
                <th className="px-2 py-2 text-right">Precio compra (c/u)</th>
                <th className="px-2 py-2 text-right">Vs. costeado</th>
                <th className="px-2 py-2 text-right">Margen</th>
                <th className="px-2 py-2">Ficha técnica</th>
                <th className="px-2 py-2">Veredicto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visibles.map(l => {
                const e = ESTADO[l.estado], te = TECNICO[l.tecnico.estado];
                return (
                  <tr key={l.productoId} className={l.estado === 'NO_PASA' ? 'bg-rose-50/40' : ''} data-testid={`apr-linea-${l.productoId}`}>
                    <td className="px-3 py-2 text-zinc-400 align-top">{l.linea ?? ''}</td>
                    <td className="px-2 py-2 align-top max-w-[260px]">
                      <p className="font-semibold text-zinc-800 leading-snug">{corto(l.descripcion)}</p>
                      {l.motivos.length > 0 && <ul className="mt-1 space-y-0.5">{l.motivos.map(m => <li key={m} className="text-[11px] text-zinc-500 leading-snug">• {m}</li>)}</ul>}
                    </td>
                    <td className="px-2 py-2 text-right align-top tabular-nums">{l.cantidad ?? '—'}</td>
                    <td className="px-2 py-2 text-right align-top tabular-nums">{clp(l.ventaUnit)}</td>
                    <td className="px-2 py-2 text-right align-top tabular-nums text-zinc-500">{clp(l.costeadoUnit)}</td>
                    <td className="px-2 py-2 align-top">{l.proveedor ? <span className="text-zinc-800">{l.proveedor}</span> : <span className="text-rose-600 font-semibold">sin proveedor</span>}{l.plazoDias != null && <span className="block text-[10.5px] text-zinc-400">entrega {l.plazoDias} d</span>}</td>
                    <td className="px-2 py-2 text-right align-top tabular-nums font-semibold">{clp(l.compraUnit)}<span className="block text-[10.5px] font-normal text-zinc-400">total {clp(l.compraTotal)}</span></td>
                    <td className={`px-2 py-2 text-right align-top tabular-nums font-semibold ${l.difPct == null ? 'text-zinc-300' : l.difPct > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {l.difPct == null ? '—' : `${l.difPct > 0 ? '+' : ''}${l.difPct}%`}
                      {l.difTotal != null && <span className="block text-[10.5px] font-normal">{l.difTotal > 0 ? '+' : ''}{clp(l.difTotal)}</span>}
                    </td>
                    <td className={`px-2 py-2 text-right align-top tabular-nums font-semibold ${l.margenLineaPct == null ? 'text-zinc-300' : l.margenLineaPct < 20 ? 'text-amber-700' : 'text-zinc-700'}`}>{l.margenLineaPct == null ? '—' : `${l.margenLineaPct}%`}</td>
                    <td className="px-2 py-2 align-top">
                      <span className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded border ${te.clase}`} title={l.tecnico.modelo ? `Ficha de ${l.tecnico.modelo}` : undefined}>{te.texto}{l.tecnico.total > 0 ? ` ${l.tecnico.cumple}/${l.tecnico.total}` : ''}</span>
                      {l.tecnico.modelo && <span className="block text-[10.5px] text-zinc-400 mt-0.5">{l.tecnico.modelo}</span>}
                    </td>
                    <td className="px-2 py-2 align-top"><span className={`inline-flex items-center gap-1 text-[11.5px] font-bold px-2 py-0.5 rounded-full border ${e.clase}`}>{l.estado === 'NO_PASA' ? <No size={12} /> : l.estado === 'REVISAR' ? <Alerta size={12} /> : <Ok size={12} />}{e.texto}</span></td>
                  </tr>
                );
              })}
              {visibles.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-zinc-400">Ninguna línea con observaciones.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-50 font-bold text-zinc-800 border-t border-zinc-200">
                <td className="px-3 py-2" colSpan={3}>Total</td>
                <td className="px-2 py-2 text-right tabular-nums" title="Lo que paga el cliente">{clp(t.venta)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-500" title="Lo costeado">{clp(t.costeado)}</td>
                <td className="px-2 py-2 text-right text-[10.5px] uppercase text-zinc-400" colSpan={1}>Mercadería</td>
                <td className="px-2 py-2 text-right tabular-nums">{clp(t.compra)}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${t.compra > t.costeado ? 'text-rose-600' : 'text-emerald-600'}`}>{t.costeado > 0 ? `${t.compra > t.costeado ? '+' : ''}${Math.round(((t.compra - t.costeado) / t.costeado) * 1000) / 10}%` : '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums">{t.margenCompletoPct != null ? `${t.margenCompletoPct}%` : '—'}</td>
                <td className="px-2 py-2" colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function Cifra({ titulo, valor, sub, alerta, bien }: { titulo: string; valor: string; sub: string; alerta?: string | null; bien?: string | null }) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 px-3.5 py-3">
      <p className="text-[10.5px] font-bold uppercase text-zinc-400">{titulo}</p>
      <p className="text-[19px] font-bold text-zinc-900 tabular-nums leading-tight mt-0.5">{valor}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>
      {alerta && <p className="text-[11px] font-semibold text-rose-600 mt-1">{alerta}</p>}
      {bien && <p className="text-[11px] font-semibold text-emerald-600 mt-1">{bien}</p>}
    </div>
  );
}
