'use client';

// RESUMEN DEL AUDITOR: todo lo realizado en el Auditor de un vistazo — por línea, la opción aprobada, su costo, el precio de venta y el margen;
// más el estado de Pre-postulación (certificado y compromisos). Solo lectura.
import { useEffect, useMemo, useState } from 'react';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';
import type { PanelAuditorDTO, OpcionDTO } from '@/app/lib/auditor-opciones';
import type { PrePostulacionDTO } from '@/app/lib/auditor-prepostulacion';

const clp = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n));
const ESTADO_OP: Record<string, { label: string; cls: string }> = {
  aprobada: { label: 'Aprobada', cls: 'bg-emerald-600 text-white' }, en_aprobacion: { label: 'En aprobación', cls: 'bg-amber-100 text-amber-800' },
  definitiva: { label: 'Firmada', cls: 'bg-indigo-100 text-indigo-700' }, verificada: { label: 'Verificada', cls: 'bg-emerald-100 text-emerald-700' },
  formalizada: { label: 'Formalizada', cls: 'bg-sky-100 text-sky-700' }, tanteo: { label: 'Tanteo', cls: 'bg-zinc-100 text-zinc-600' },
};
const TEC: Record<string, string> = { CUMPLE: 'Cumple', NO_CUMPLE: 'No cumple', CON_PENDIENTES: 'Falta dato', SIN_EVALUAR: 'Sin evaluar', NO_CORRIDO: 'Sin comparar', NO_APLICA: 'No aplica', SIN_REQUISITOS: 'Sin requisitos' };

/** La opción que se ofertará en la línea: la aprobada; si no, la que está en aprobación o firmada. */
const opcionElegida = (opciones: OpcionDTO[]): OpcionDTO | null =>
  opciones.find(o => o.estado === 'aprobada') ?? opciones.find(o => o.estado === 'en_aprobacion') ?? opciones.find(o => o.estado === 'definitiva') ?? null;

export function ResumenAuditorPanel({ negocioId, onIrAlAuditor, panelInicial, preInicial }: {
  negocioId: number; onIrAlAuditor: () => void;
  /** Vista previa en servidor (scripts/scratch/_preview-post.tsx): evita el fetch. */
  panelInicial?: PanelAuditorDTO & { presupuesto?: { neto: number | null } | null }; preInicial?: PrePostulacionDTO;
}) {
  const [panel, setPanel] = useState<(PanelAuditorDTO & { presupuesto?: { neto: number | null } | null }) | null>(panelInicial ?? null);
  const [pre, setPre] = useState<PrePostulacionDTO | null>(preInicial ?? null);
  const [cargando, setCargando] = useState(!panelInicial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (panelInicial) return;
    let vivo = true;
    (async () => {
      try {
        const [a, p] = await Promise.all([
          fetch(`/api/negocios/${negocioId}/auditor`).then(r => r.json()),
          fetch(`/api/negocios/${negocioId}/prepostulacion`).then(r => r.json()).catch(() => null),
        ]);
        if (!vivo) return;
        if (!a?.success) throw new Error(a?.error || 'No se pudo cargar el resumen del Auditor');
        setPanel(a);
        setPre(p?.success && !p.migracionPendiente ? p : null);
      } catch (e) { if (vivo) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [negocioId, panelInicial]);

  const filas = useMemo(() => (panel?.lineas ?? []).filter(l => !l.noOfertada).map(l => {
    const o = opcionElegida(l.opciones);
    const costo = o?.verificacion?.costoNetoUnitario ?? null;
    const venta = l.precioVentaUnitario;
    const cant = l.cantidad ?? 0;
    return { l, o, costo, venta, cant, totalCosto: costo != null ? costo * cant : null, totalVenta: venta != null ? venta * cant : null,
      margen: costo != null && venta ? Math.round(((venta - costo) / venta) * 1000) / 10 : null };
  }), [panel]);

  const conOpcion = filas.filter(f => f.o);
  const costoTotal = conOpcion.reduce((n, f) => n + (f.totalCosto ?? 0), 0);
  const ventaTotal = conOpcion.reduce((n, f) => n + (f.totalVenta ?? 0), 0);
  const margenTotal = ventaTotal > 0 ? Math.round(((ventaTotal - costoTotal) / ventaTotal) * 1000) / 10 : null;
  const presupuesto = panel?.presupuesto?.neto ?? null;

  return (
    <div className="space-y-4">
      {/* 2 · Resumen de lo realizado en el Auditor */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
          <h3 className="text-[13.5px] font-bold text-zinc-900">Resumen de lo realizado en el Auditor</h3>
          <span className="text-[11.5px] text-zinc-400">La opción de cada línea, su costo, el precio de venta y el margen.</span>
          <button onClick={onIrAlAuditor} className="ml-auto text-[12px] font-semibold text-indigo-600 hover:underline">Abrir el Auditor</button>
        </div>
        {cargando ? (
          <div className="flex items-center gap-2 text-[12.5px] text-zinc-400 px-5 py-8 justify-center"><Loader2 size={14} className="animate-spin" /> Cargando resumen…</div>
        ) : error || !panel ? (
          <p className="px-5 py-6 text-[12.5px] text-rose-600">{error || 'No se pudo cargar el resumen.'}</p>
        ) : (
          <>
            <div className="px-5 py-4 grid gap-3 grid-cols-2 lg:grid-cols-4 border-b border-zinc-100">
              <Dato titulo="Líneas con opción" valor={`${conOpcion.length} de ${filas.length}`} alerta={conOpcion.length < filas.length} />
              <Dato titulo={`Costo total (neto)${conOpcion.length < filas.length ? ' · parcial' : ''}`} valor={clp(costoTotal)} />
              <Dato titulo={`Venta total (neto)${conOpcion.length < filas.length ? ' · parcial' : ''}`} valor={clp(ventaTotal)} sub={presupuesto != null ? `Presupuesto ${clp(presupuesto)}` : undefined} alerta={presupuesto != null && conOpcion.length === filas.length && ventaTotal > presupuesto} />
              <Dato titulo="Margen" valor={margenTotal != null ? `${margenTotal}%` : '—'} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-400">
                    <th className="px-5 py-2 font-bold">Línea</th><th className="px-3 py-2 font-bold">Producto y proveedor</th><th className="px-3 py-2 font-bold text-right">Cant.</th>
                    <th className="px-3 py-2 font-bold text-right">Costo unit.</th><th className="px-3 py-2 font-bold text-right">Venta unit.</th><th className="px-3 py-2 font-bold text-right">Margen</th>
                    <th className="px-3 py-2 font-bold">Técnico</th><th className="px-5 py-2 font-bold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.filter(f => f.o).map(f => (
                    <tr key={f.l.filaId} className="border-t border-zinc-100 align-top">
                      <td className="px-5 py-2.5 whitespace-nowrap"><b className="text-zinc-800">{f.l.item}</b> <span className="text-zinc-500">{f.l.detalle.split(' - ')[0].slice(0, 24)}</span></td>
                      {f.o && (
                        <>
                          <td className="px-3 py-2.5"><p className="font-semibold text-zinc-800">{[f.o.marca, f.o.modelo].filter(Boolean).join(' ') || 'Producto sin identificar'}</p><p className="text-zinc-400">{f.o.proveedorRazonSocial || '—'}</p></td>
                          <td className="px-3 py-2.5 text-right">{f.cant || '—'}</td>
                          <td className="px-3 py-2.5 text-right">{clp(f.costo)}</td>
                          <td className="px-3 py-2.5 text-right">{clp(f.venta)}</td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${f.margen != null && f.margen < 20 ? 'text-rose-600' : 'text-zinc-700'}`}>{f.margen != null ? `${f.margen}%` : '—'}</td>
                          <td className="px-3 py-2.5 text-zinc-600">{TEC[f.o.tecnico.estado] || f.o.tecnico.estado}</td>
                          <td className="px-5 py-2.5"><span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${ESTADO_OP[f.o.estado]?.cls || 'bg-zinc-100 text-zinc-600'}`}>{ESTADO_OP[f.o.estado]?.label || f.o.estado}</span>{f.o.firmadaPorNombre && <p className="text-[10.5px] text-zinc-400 mt-0.5">{f.o.firmadaPorNombre}</p>}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  {filas.some(f => !f.o) && (
                    <tr className="border-t border-zinc-100"><td colSpan={8} className="px-5 py-3 text-zinc-500">
                      <b className="text-zinc-700">Sin opción aprobada todavía:</b> {filas.filter(f => !f.o).map(f => `línea ${f.l.item}`).join(', ')}. <button onClick={onIrAlAuditor} className="text-indigo-600 font-semibold hover:underline">Ir al Auditor</button>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {pre && (
              <div className="px-5 py-3 border-t border-zinc-100 text-[12px] text-zinc-600 flex gap-x-6 gap-y-1 flex-wrap">
                <span>Certificado de admisibilidad: <b>{pre.certificado.cumplidas} de {pre.certificado.total}</b> causales cumplidas</span>
                <span>Compromisos técnico-administrativos: <b>{pre.candado.resumen.confirmados} de {pre.candado.resumen.total - pre.candado.resumen.noAplica}</b> confirmados</span>
                {panel.totalCostosAsociados > 0 && <span>Costos asociados: <b>{clp(panel.totalCostosAsociados)}</b></span>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Dato({ titulo, valor, sub, alerta }: { titulo: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wide text-zinc-400 font-bold">{titulo}</p>
      <p className={`text-[16px] font-bold ${alerta ? 'text-rose-600' : 'text-zinc-800'}`}>{valor}</p>
      {sub && <p className="text-[11px] text-zinc-400">{sub}</p>}
    </div>
  );
}
