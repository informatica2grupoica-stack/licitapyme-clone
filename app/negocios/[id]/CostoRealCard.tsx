'use client';

// COSTO REAL DEL NEGOCIO + CIERRE CON RESULTADO FINAL (24-sep-2026).
// Junta lo que antes vivía en cuatro lugares que no se hablaban —costo real del costeo, gastos
// extra, gastos registrados e importación— y lo contrasta con Obuma. Al terminar el negocio,
// "Cerrar resultado" congela la utilidad real para que el ciclo no se pierda al entregar.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { useRealtime } from '@/app/lib/use-realtime';
import { IconScale as Scale, IconLoader2 as Loader2, IconLock as Lock, IconAlertTriangle as AlertTriangle } from '@tabler/icons-react';

interface Comparativo {
  ventaNeta: number; costoNetoEstimado: number; utilidadEstimada: number; margenEstimado: number | null;
  costoNetoReal: number | null; utilidadReal: number | null; margenReal: number | null; variacionCosto: number | null;
  filasConCostoReal: number; filasTotales: number; gastosAdicionales: number; realCompleto: boolean;
}
interface Resultado {
  tieneCosteo: boolean; gastosOtraMoneda: number; comparativo: Comparativo;
  lineas: { costeoOfertado: number; costeoGastosExtra: number; gastosRegistrados: number; importacion: number; total: number; fuente?: 'oc' | 'costeo' };
  obuma: { gastado: number; facturas: number; diferenciaPct: number | null } | null;
  alertas: { codigo: string; mensaje: string }[];
}
interface Cierre {
  utilidadReal: number; margenRealPct: number | null; costoReal: number; incompleto: boolean;
  motivoIncompleto: string | null; cerradoPorNombre: string | null; cerradoAt: string;
}

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%`;

function Linea({ etiqueta, valor, nota, fuerte }: { etiqueta: string; valor: number; nota?: string; fuerte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${fuerte ? 'border-t border-zinc-200 mt-1 pt-1.5' : ''}`}>
      <span className={`text-[12px] ${fuerte ? 'font-bold text-zinc-800' : 'text-zinc-600'}`}>{etiqueta}{nota && <span className="text-[10.5px] text-zinc-400"> · {nota}</span>}</span>
      <span className={`tabular-nums ${fuerte ? 'text-[14px] font-bold text-zinc-900' : 'text-[12.5px] font-semibold text-zinc-700'}`}>{fmtCLP(valor)}</span>
    </div>
  );
}

// ── Detalle del costo real (pedido del dueño, 12-nov-2026: «que sea más entendible y me muestre detallado el costo real») ──────────
// Sale de «Seguimiento · Comparativo» (mismos datos): cada producto con su OC, los fletes/armado que van en OC y los gastos sin OC.
interface FilaComp { productoId: number; producto: string; cantidad: number | null; ventaNeto: number | null; costeoNeto: number | null; planNeto: number | null; obumaProveedor: string | null; planProveedor: string | null; obumaOc: string | null; obumaNeto: number | null }
interface GastoComp { id: number; categoria: string; descripcion: string; monto: number; moneda: string; fecha: string | null }

function Bloque({ titulo, total, nota, children }: { titulo: string; total: number; nota: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="border border-zinc-200 rounded-xl overflow-hidden">
      <button type="button" onClick={() => setAbierto(a => !a)} aria-expanded={abierto}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-zinc-50 hover:bg-zinc-100 text-left">
        <span className="text-[12.5px] font-semibold text-zinc-800">{abierto ? '▾' : '▸'} {titulo} <span className="text-[11px] font-normal text-zinc-500">· {nota}</span></span>
        <span className="text-[13px] font-bold tabular-nums text-zinc-900">{fmtCLP(total)}</span>
      </button>
      {abierto && <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}

function DetalleCostoReal({ negocioId, venta, costoTotal, utilidad, margen }: { negocioId: number; venta: number; costoTotal: number; utilidad: number; margen: number | null }) {
  const [d, setD] = useState<{ filas: FilaComp[]; gastos: GastoComp[] } | null>(null);
  useEffect(() => {
    fetch(`/api/compras/${negocioId}/resumen-comparativo`).then(r => r.json())
      .then(j => { if (j?.success) setD({ filas: j.resumen.filas || [], gastos: (j.resumen.gastosExtra || []).filter((g: GastoComp) => String(g.moneda || 'CLP').toUpperCase() === 'CLP') }); })
      .catch(() => {});
  }, [negocioId, costoTotal]);
  if (!d) return null;
  const real = (f: FilaComp) => f.obumaNeto ?? f.planNeto ?? 0;
  const productos = d.filas.filter(f => (f.ventaNeto ?? 0) > 0);
  const fletes = d.filas.filter(f => !((f.ventaNeto ?? 0) > 0) && real(f) > 0);
  const totProd = productos.reduce((s, f) => s + real(f), 0);
  const totCost = productos.reduce((s, f) => s + (f.costeoNeto ?? 0), 0);
  const totFlete = fletes.reduce((s, f) => s + real(f), 0);
  const totGasto = d.gastos.reduce((s, g) => s + Number(g.monto || 0), 0);
  const th = 'px-3 py-1.5 text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide text-left';
  const td = 'px-3 py-1.5 text-[12px] text-zinc-700';
  const tdN = `${td} text-right tabular-nums`;
  return (
    <div className="px-4 pb-4 space-y-2">
      <p className="text-[12.5px] text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 leading-relaxed">
        Vendiste <b>{fmtCLP(venta)}</b> neto. Gastaste <b>{fmtCLP(costoTotal)}</b>: <b>{fmtCLP(totProd)}</b> en los {productos.length} productos,{' '}
        <b>{fmtCLP(totFlete)}</b> en fletes y armado, y <b>{fmtCLP(totGasto)}</b> en gastos sin OC. Te quedan <b className="text-emerald-700">{fmtCLP(utilidad)}</b> de utilidad
        {margen != null && <> (<b>{fmtPct(margen)}</b> de la venta)</>}.
      </p>
      <Bloque titulo="Productos comprados" total={totProd} nota={`${productos.length} productos · costeado ${fmtCLP(totCost)} · ${totProd <= totCost ? 'ahorro' : 'sobrecosto'} ${fmtCLP(Math.abs(totCost - totProd))}`}>
        <table className="w-full">
          <thead><tr><th className={th}>Producto</th><th className={th}>Proveedor</th><th className={th}>OC</th><th className={`${th} text-right`}>Cant.</th><th className={`${th} text-right`}>Costeado</th><th className={`${th} text-right`}>Real (OC)</th><th className={`${th} text-right`}>Diferencia</th></tr></thead>
          <tbody>{productos.map(f => {
            const dif = real(f) - (f.costeoNeto ?? 0);
            return (
              <tr key={f.productoId} className="border-t border-zinc-100">
                <td className={td}>{f.producto}</td><td className={td}>{f.obumaProveedor ?? f.planProveedor ?? '—'}</td><td className={td}>{f.obumaOc ?? '—'}</td>
                <td className={tdN}>{f.cantidad ?? '—'}</td><td className={tdN}>{fmtCLP(f.costeoNeto)}</td><td className={`${tdN} font-semibold`}>{fmtCLP(real(f))}</td>
                <td className={`${tdN} ${Math.abs(dif) < 1 ? 'text-zinc-400' : dif < 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{Math.abs(dif) < 1 ? 'igual' : `${dif > 0 ? '+' : '−'}${fmtCLP(Math.abs(dif))}`}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </Bloque>
      {fletes.length > 0 && (
        <Bloque titulo="Fletes y armado" total={totFlete} nota={`${fletes.length} · van dentro de las OC`}>
          <table className="w-full">
            <thead><tr><th className={th}>Concepto</th><th className={th}>Proveedor</th><th className={th}>OC</th><th className={`${th} text-right`}>Monto</th></tr></thead>
            <tbody>{fletes.map(f => (
              <tr key={f.productoId} className="border-t border-zinc-100">
                <td className={td}>{f.producto}</td><td className={td}>{f.obumaProveedor ?? f.planProveedor ?? '—'}</td><td className={td}>{f.obumaOc ?? '—'}</td><td className={`${tdN} font-semibold`}>{fmtCLP(real(f))}</td>
              </tr>
            ))}</tbody>
          </table>
        </Bloque>
      )}
      {d.gastos.length > 0 && (
        <Bloque titulo="Gastos sin OC" total={totGasto} nota={`${d.gastos.length} · horas extra, colación, salidas…`}>
          <table className="w-full">
            <thead><tr><th className={th}>Categoría</th><th className={th}>Descripción</th><th className={th}>Fecha</th><th className={`${th} text-right`}>Monto</th></tr></thead>
            <tbody>{d.gastos.map(g => (
              <tr key={g.id} className="border-t border-zinc-100">
                <td className={td}>{g.categoria}</td><td className={td}>{g.descripcion}</td><td className={td}>{g.fecha ? String(g.fecha).slice(0, 10) : '—'}</td><td className={`${tdN} font-semibold`}>{fmtCLP(Number(g.monto))}</td>
              </tr>
            ))}</tbody>
          </table>
        </Bloque>
      )}
    </div>
  );
}

/** `permitirCierre=false`: solo se ve el comparativo. El cierre con resultado final vive en la pestaña
 *  "Entrega y Cierre" — cerrar en plena compra congelaría un costo que todavía se está cargando. */
export function CostoRealCard({ negocioId, puedeOperar, permitirCierre = true }: { negocioId: number; puedeOperar: boolean; permitirCierre?: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [res, setRes] = useState<Resultado | null>(null);
  const [cierre, setCierre] = useState<Cierre | null>(null);
  const [loading, setLoading] = useState(true);
  const [motivo, setMotivo] = useState('');
  const [cerrando, setCerrando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/compras/${negocioId}/costo-real`);
      const d = await r.json();
      if (d.success) { setRes(d.resultado); setCierre(d.cierre); }
    } catch (e: any) {
      toast.error('No se pudo calcular el costo real', e.message);
    } finally { setLoading(false); }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar]);
  // Sincronizado con el costeo: el editor avisa al guardar (misma pestaña, al instante) y el servidor
  // publica el cambio por SSE (otras pestañas/usuarios); useRealtime también refresca al volver a la
  // pestaña y cada minuto. Antes esta tarjeta leía una sola vez al abrirse y quedaba con lo viejo.
  useRealtime(cargar);
  useEffect(() => {
    const alGuardar = (e: Event) => { if ((e as CustomEvent).detail?.negocioId === negocioId) cargar(); };
    window.addEventListener('costeo-guardado', alGuardar);
    return () => window.removeEventListener('costeo-guardado', alGuardar);
  }, [negocioId, cargar]);

  const cerrar = async () => {
    setCerrando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/costo-real`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivoIncompleto: motivo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo cerrar el resultado'); return; }
      toast.success('Resultado cerrado');
      setMotivo(''); await cargar(); await recargarCompartido();
    } finally { setCerrando(false); }
  };

  if (loading) return <div className="bg-white rounded-2xl border border-zinc-200 p-4 flex items-center gap-2 text-[12px] text-zinc-400"><Loader2 size={14} className="animate-spin" /> Calculando costo real…</div>;
  if (!res) return null;
  if (!res.tieneCosteo) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 px-4 py-3 text-[12px] text-zinc-400">
        <b className="text-zinc-600">Costo real del negocio:</b> este negocio todavía no tiene un costeo guardado por el equipo de licitaciones.
      </div>
    );
  }

  const c = res.comparativo;
  const hayReal = c.costoNetoReal != null;
  const faltan = c.filasTotales - c.filasConCostoReal;
  const motivoCorto = !c.realCompleto && motivo.trim().length < 10;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <Scale size={15} className="text-zinc-400" />
        <span className="text-[13px] font-bold text-zinc-700">Costo real del negocio</span>
        {cierre && <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><Lock size={11} /> Resultado cerrado</span>}
      </div>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">De dónde sale el costo real</p>
          {res.lineas.fuente === 'oc' ? (
            <>
              <Linea etiqueta="Órdenes de compra" valor={res.lineas.costeoOfertado} nota="todo lo comprado, con fletes y armado que van en las OC" />
              <Linea etiqueta="Gastos sin OC" valor={res.lineas.gastosRegistrados} nota="horas extra, colación, salidas…" />
            </>
          ) : (
            <>
              <Linea etiqueta="Ítems del costeo" valor={res.lineas.costeoOfertado} nota={`${c.filasConCostoReal} de ${c.filasTotales} con costo real`} />
              <Linea etiqueta="Gastos extra del costeo" valor={res.lineas.costeoGastosExtra} nota="flete, horas extra, imprevistos" />
              <Linea etiqueta="Gastos registrados" valor={res.lineas.gastosRegistrados} nota="flete, horas extra…" />
            </>
          )}
          <Linea etiqueta="Importación" valor={res.lineas.importacion} nota="flete, aduana, logística" />
          <Linea etiqueta="Costo real total" valor={res.lineas.total} fuerte />
          {(!res.obuma || res.obuma.gastado === 0) && (
            <p className="text-[11px] text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5 mt-2">
              Todavía no hay una compra registrada en Obuma para este negocio: estos montos son los que hay cargados en el Costeo (columna «Costo unit. REAL»), no una compra real. Se vuelven reales cuando se emiten las órdenes de compra.
            </p>
          )}
          {res.gastosOtraMoneda > 0 && (
            <p className="text-[10.5px] text-amber-600 mt-1">Hay gastos en otra moneda sin convertir que no están en el total.</p>
          )}
        </div>
        <div>
          <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Contra lo vendido</p>
          <Linea etiqueta="Venta neta" valor={c.ventaNeta} />
          <Linea etiqueta="Costo estimado al postular" valor={c.costoNetoEstimado} nota={`utilidad ${fmtCLP(c.utilidadEstimada)} · ${fmtPct(c.margenEstimado)}`} />
          {hayReal ? (
            <>
              <Linea etiqueta="Utilidad real" valor={c.utilidadReal ?? 0} nota={`${fmtPct(c.margenReal)} de margen`} fuerte />
              <p className={`text-[11.5px] mt-1 ${c.variacionCosto != null && c.variacionCosto > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-700 font-semibold'}`}>
                Costo real {fmtPct(c.variacionCosto != null ? Math.abs(c.variacionCosto) : null)} {c.variacionCosto != null && c.variacionCosto > 0 ? 'sobre' : 'bajo'} lo estimado al postular
              </p>
            </>
          ) : <p className="text-[11.5px] text-zinc-400 mt-2">Sin costo real cargado todavía: se carga ítem por ítem en el Costeo (columna &quot;Costo unit. REAL&quot;).</p>}
          {hayReal && !c.realCompleto && (
            <p className="text-[11px] text-amber-600 mt-1">Parcial: faltan {faltan} ítem(s) con costo real — la utilidad todavía sale alta.</p>
          )}
        </div>
      </div>

      {res.lineas.fuente === 'oc' && hayReal && (
        <DetalleCostoReal negocioId={negocioId} venta={c.ventaNeta} costoTotal={res.lineas.total} utilidad={c.utilidadReal ?? 0} margen={c.margenReal} />
      )}

      {res.obuma && (
        <p className="px-4 pb-3 text-[11.5px] text-zinc-500">
          Contraste Obuma: <b className="text-zinc-700">{fmtCLP(res.obuma.gastado)}</b> en OC · {fmtCLP(res.obuma.facturas)} facturado
          {res.obuma.diferenciaPct != null && <> · <span className={Math.abs(res.obuma.diferenciaPct) > 10 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>{res.obuma.diferenciaPct > 0 ? '+' : ''}{fmtPct(res.obuma.diferenciaPct)} vs costeo</span></>}
        </p>
      )}

      {res.alertas.length > 0 && (
        <div className="px-4 pb-3 space-y-1.5">
          {res.alertas.map(a => (
            <p key={a.codigo} className="flex items-start gap-1.5 text-[11.5px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
              <AlertTriangle size={13} className="flex-shrink-0 mt-px" /> {a.mensaje}
            </p>
          ))}
        </div>
      )}

      {!permitirCierre && !cierre ? null : cierre ? (
        <div className="px-4 py-3 border-t border-zinc-100 bg-emerald-50/40 text-[11.5px] text-zinc-600">
          Cerrado el <b>{cierre.cerradoAt}</b>{cierre.cerradoPorNombre && <> por <b>{cierre.cerradoPorNombre}</b></>}: costo real <b>{fmtCLP(cierre.costoReal)}</b>, utilidad real <b>{fmtCLP(cierre.utilidadReal)}</b> ({fmtPct(cierre.margenRealPct)}).
          {cierre.incompleto && <span className="text-amber-700"> Se cerró con ítems sin costo real: &quot;{cierre.motivoIncompleto}&quot;.</span>}
          {puedeOperar && permitirCierre && hayReal && (
            <span className="inline-flex items-center gap-2 ml-2 flex-wrap">
              {!c.realCompleto && (
                <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo de cerrar con ítems sin costo real"
                  className="min-w-[200px] text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:border-indigo-400" />
              )}
              <button onClick={cerrar} disabled={cerrando || motivoCorto}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-40">
                {cerrando ? 'Cerrando…' : 'Volver a cerrar con los números de hoy'}
              </button>
            </span>
          )}
        </div>
      ) : puedeOperar && permitirCierre && hayReal && (
        <div className="px-4 py-3 border-t border-zinc-100 flex items-center gap-2 flex-wrap">
          {!c.realCompleto && (
            <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder={`Faltan ${faltan} ítem(s) con costo real: ¿por qué se cierra igual?`}
              className="flex-1 min-w-[220px] text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-400" />
          )}
          <button onClick={cerrar} disabled={cerrando || motivoCorto}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-lg px-3 py-1.5">
            {cerrando ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />} Cerrar resultado
          </button>
        </div>
      )}
    </div>
  );
}
