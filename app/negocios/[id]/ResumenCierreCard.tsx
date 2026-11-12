'use client';

// «Factura y cierre» — la foto completa del proyecto al cerrarlo (skill licitank-ui, estilo bento del Resumen):
// lo que se ganó, lo costeado contra lo real, a dónde se fue lo vendido (torta), cada OC con sus facturas y lo ganado línea por línea.
// Solo lee de /costo-real y /resumen-comparativo; no calcula nada propio salvo los porcentajes de la torta.
import { useEffect, useState } from 'react';
import { IconChevronDown as ChevronDown, IconEye as Eye } from '@tabler/icons-react';
import { OrdenCompraVisor } from './OrdenCompraVisor';

interface Comp {
  ventaNeta: number; costoNetoEstimado: number; utilidadEstimada: number; margenEstimado: number | null;
  costoNetoReal: number | null; utilidadReal: number | null; margenReal: number | null; variacionCosto: number | null;
}
interface Lineas { costeoOfertado: number; costeoGastosExtra: number; gastosRegistrados: number; importacion: number; total: number; fuente?: 'oc' | 'costeo' }
interface Fila { productoId: number; producto: string; cantidad: number | null; ventaNeto: number | null; costeoNeto: number | null; planNeto: number | null; obumaNeto: number | null; obumaOc: string | null }
interface PorOc { ocFolio: string; proveedor: string | null; estado: string | null; obumaNeto: number; facturadoNeto: number; facturas: number; ocPropia?: boolean }
interface Datos { comp: Comp; lineas: Lineas; filas: Fila[]; porOc: PorOc[]; ocCliente: number }

const CACHE = new Map<number, Datos>();   // al volver a la pestaña sale al instante y se refresca por detrás

const clp = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(1).replace('.', ',')} %`;

const SUPERFICIE = 'bg-white border border-linea rounded-2xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const ROTULO = 'text-[11px] text-tinta-2/80 dark:text-slate-400';

function Rotulo({ icono, children }: { icono?: React.ReactNode; children: React.ReactNode }) {
  return <p className="flex items-center gap-2 text-[12.5px] font-medium text-tinta-2 dark:text-slate-300">{icono}{children}</p>;
}

// Torta simple (SVG): cada tramo es una parte de lo vendido. El centro dice el margen.
function Torta({ tramos, centro, sub }: { tramos: { nombre: string; valor: number; color: string }[]; centro: string; sub: string }) {
  const total = tramos.reduce((s, t) => s + t.valor, 0) || 1;
  let acumulado = 0;
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative w-40 h-40 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" role="img" aria-label="De dónde sale lo vendido">
          <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="6" className="stroke-slate-100 dark:stroke-slate-800" />
          {tramos.map(t => {
            const largo = (t.valor / total) * 100;
            const el = <circle key={t.nombre} cx="18" cy="18" r="15.9155" fill="none" strokeWidth="6" stroke={t.color}
              strokeDasharray={`${Math.max(largo - 0.6, 0)} ${100 - Math.max(largo - 0.6, 0)}`} strokeDashoffset={-acumulado} />;
            acumulado += largo;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{centro}</span>
          <span className={ROTULO}>{sub}</span>
        </div>
      </div>
      <ul className="space-y-2 min-w-[180px] flex-1">
        {tramos.map(t => (
          <li key={t.nombre} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="flex items-center gap-2 text-tinta-2 dark:text-slate-300"><span aria-hidden className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />{t.nombre}</span>
            <span className="tabular-nums text-tinta dark:text-slate-100"><span className="font-medium">{clp(t.valor)}</span> <span className="text-tinta-3 dark:text-slate-500 text-[11px]">· {pct((t.valor / total) * 100)}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResumenCierreCard({ negocioId }: { negocioId: number }) {
  const [d, setD] = useState<Datos | null>(CACHE.get(negocioId) ?? null);
  const [folio, setFolio] = useState<string | null>(null);
  const [lineasAbiertas, setLineasAbiertas] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch(`/api/compras/${negocioId}/costo-real`).then(r => r.json()),
      fetch(`/api/compras/${negocioId}/resumen-comparativo`).then(r => r.json()),
    ]).then(([cr, rc]) => {
      if (!vivo || !cr?.success || !rc?.success) return;
      const nuevo: Datos = {
        comp: cr.resultado.comparativo, lineas: cr.resultado.lineas,
        filas: rc.resumen.filas || [], porOc: rc.resumen.porOc || [], ocCliente: rc.resumen.totales?.ventaGanada ?? cr.resultado.comparativo.ventaNeta,
      };
      CACHE.set(negocioId, nuevo); setD(nuevo);
    }).catch(() => {});
    return () => { vivo = false; };
  }, [negocioId]);

  if (!d) return <div className={`${SUPERFICIE} h-40 mb-3 animate-none bg-slate-50 dark:bg-slate-900/60`} aria-busy="true" />;

  const { comp, lineas, filas, porOc } = d;
  const costoReal = comp.costoNetoReal ?? lineas.total;
  const utilidad = comp.utilidadReal ?? (comp.ventaNeta - costoReal);
  const mejora = comp.costoNetoEstimado - costoReal;           // + = se gastó menos de lo estimado
  const ordenes = lineas.fuente === 'oc' ? lineas.costeoOfertado : lineas.costeoOfertado + lineas.costeoGastosExtra;
  const tramos = [
    { nombre: 'Órdenes de compra', valor: ordenes, color: '#0d9488' },
    { nombre: 'Gastos sin OC', valor: lineas.gastosRegistrados, color: '#d97706' },
    { nombre: 'Importación', valor: lineas.importacion, color: '#0891b2' },
    { nombre: 'Utilidad', valor: Math.max(utilidad, 0), color: '#16a34a' },
  ].filter(t => t.valor > 0);

  const ganadas = filas.filter(f => (f.ventaNeto ?? 0) > 0);
  const real = (f: Fila) => f.obumaNeto ?? f.planNeto ?? 0;
  const ocs = porOc.filter(o => o.estado !== 'ANULADA');
  const totOc = ocs.reduce((s, o) => s + o.obumaNeto, 0);
  const totFac = ocs.reduce((s, o) => s + o.facturadoNeto, 0);

  const th = 'px-3 py-2 text-[11px] font-medium text-tinta-2/80 dark:text-slate-400 text-left whitespace-nowrap';
  const td = 'px-3 py-2 text-[12.5px] text-tinta-2 dark:text-slate-300';
  const tdN = `${td} text-right tabular-nums whitespace-nowrap`;

  return (
    <div className="@container mb-3 space-y-3" data-testid="resumen-cierre">
      <div className="grid gap-3 @3xl:grid-cols-[1fr_1.15fr]">
        {/* Lo ganado, lo costeado y lo real */}
        <section className={`${SUPERFICIE} p-5`}>
          <Rotulo>Lo que se ganó</Rotulo>
          <p className="mt-2 text-[30px] leading-none font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{clp(comp.ventaNeta)}</p>
          <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">venta neta · {ganadas.length} producto{ganadas.length === 1 ? '' : 's'} ganado{ganadas.length === 1 ? '' : 's'}</p>
          <dl className="mt-4 pt-4 border-t border-linea/80 dark:border-slate-800 grid grid-cols-2 gap-x-4 gap-y-3">
            <div><dt className={ROTULO}>Costo estimado al postular</dt><dd className="mt-0.5 text-[15px] font-medium tabular-nums text-tinta dark:text-slate-100">{clp(comp.costoNetoEstimado)}</dd></div>
            <div><dt className={ROTULO}>Costo real</dt><dd className="mt-0.5 text-[15px] font-medium tabular-nums text-tinta dark:text-slate-100">{clp(costoReal)}</dd></div>
            <div><dt className={ROTULO}>Utilidad estimada</dt><dd className="mt-0.5 text-[15px] font-medium tabular-nums text-tinta dark:text-slate-100">{clp(comp.utilidadEstimada)} <span className="text-xs text-tinta-3 dark:text-slate-500">· {pct(comp.margenEstimado)}</span></dd></div>
            <div><dt className={ROTULO}>Utilidad real</dt><dd className="mt-0.5 text-[15px] font-medium tabular-nums text-exito">{clp(utilidad)} <span className="text-xs text-tinta-3 dark:text-slate-500">· {pct(comp.margenReal)}</span></dd></div>
          </dl>
          <div className="mt-4">
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full bg-marca" style={{ width: `${Math.min(100, comp.costoNetoEstimado > 0 ? (costoReal / comp.costoNetoEstimado) * 100 : 0)}%`, transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)' }} />
            </div>
            <p className="mt-1.5 text-xs text-tinta-2 dark:text-slate-400">
              {mejora >= 0
                ? <>Se gastó <span className="font-medium text-exito tabular-nums">{clp(mejora)}</span> menos de lo estimado{comp.variacionCosto != null ? ` (${pct(Math.abs(comp.variacionCosto))})` : ''}.</>
                : <>Se gastó <span className="font-medium text-urgente tabular-nums">{clp(-mejora)}</span> más de lo estimado.</>}
            </p>
          </div>
        </section>

        {/* A dónde se fue lo vendido */}
        <section className={`${SUPERFICIE} p-5`}>
          <Rotulo>¿A dónde se fue lo que se vendió?</Rotulo>
          <div className="mt-4"><Torta tramos={tramos} centro={pct(comp.margenReal)} sub="de utilidad" /></div>
        </section>
      </div>

      {/* Órdenes de compra y sus facturas */}
      <section className={`${SUPERFICIE} overflow-hidden`}>
        <div className="px-5 pt-4 pb-3 flex items-baseline justify-between gap-3 flex-wrap">
          <Rotulo>Órdenes de compra y sus facturas</Rotulo>
          <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">Comprado {clp(totOc)} · facturado {clp(totFac)}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-t border-linea/80 dark:border-slate-800">
              <th className={th}>OC</th><th className={th}>Proveedor</th><th className={`${th} text-right`}>Comprado (neto)</th><th className={`${th} text-right`}>Facturado (neto)</th><th className={th}>Facturas</th><th className={th} />
            </tr></thead>
            <tbody>
              {ocs.map(o => {
                const ok = o.facturadoNeto >= o.obumaNeto * 0.99 && o.facturas > 0;
                return (
                  <tr key={o.ocFolio} className="border-t border-linea/60 dark:border-slate-800">
                    <td className={`${td} font-medium text-tinta dark:text-slate-100 tabular-nums`}>{o.ocFolio}</td>
                    <td className={td}>{o.proveedor ?? '—'}</td>
                    <td className={tdN}>{clp(o.obumaNeto)}</td>
                    <td className={tdN}>{clp(o.facturadoNeto)}</td>
                    <td className={td}>
                      <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-exito' : 'bg-alerta'}`} />{ok ? `Facturada${o.facturas > 1 ? ` (${o.facturas})` : ''}` : o.facturas > 0 ? 'Facturada en parte' : 'Sin factura'}</span>
                    </td>
                    <td className={`${td} text-right`}>
                      {!o.ocPropia && <button type="button" onClick={() => setFolio(o.ocFolio)} className="inline-flex items-center gap-1 text-xs font-medium text-marca hover:text-marca-fuerte"><Eye size={14} /> Ver OC</button>}
                    </td>
                  </tr>
                );
              })}
              {ocs.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-xs text-tinta-2 dark:text-slate-400">Este proyecto no tiene órdenes de compra a proveedores.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lo ganado, línea por línea */}
      <section className={`${SUPERFICIE} overflow-hidden`}>
        <button type="button" onClick={() => setLineasAbiertas(a => !a)} aria-expanded={lineasAbiertas}
          className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
          <Rotulo>Lo ganado, producto por producto</Rotulo>
          <span className="flex items-center gap-2 text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{ganadas.length} productos <ChevronDown size={16} className={`transition-transform duration-150 ${lineasAbiertas ? 'rotate-180' : ''}`} /></span>
        </button>
        {lineasAbiertas && (
          <div className="overflow-x-auto border-t border-linea/80 dark:border-slate-800">
            <table className="w-full">
              <thead><tr>
                <th className={th}>Producto</th><th className={`${th} text-right`}>Cant.</th><th className={`${th} text-right`}>Vendido</th><th className={`${th} text-right`}>Costeado</th><th className={`${th} text-right`}>Comprado</th><th className={`${th} text-right`}>Diferencia</th><th className={th}>OC</th>
              </tr></thead>
              <tbody>
                {ganadas.map(f => {
                  const dif = real(f) - (f.costeoNeto ?? 0);
                  return (
                    <tr key={f.productoId} className="border-t border-linea/60 dark:border-slate-800">
                      <td className={`${td} max-w-[320px]`}>{f.producto}</td>
                      <td className={tdN}>{f.cantidad ?? '—'}</td>
                      <td className={tdN}>{clp(f.ventaNeto)}</td>
                      <td className={tdN}>{clp(f.costeoNeto)}</td>
                      <td className={`${tdN} font-medium text-tinta dark:text-slate-100`}>{clp(real(f))}</td>
                      <td className={`${tdN} ${Math.abs(dif) < 1 ? 'text-tinta-3' : dif < 0 ? 'text-exito' : 'text-urgente'}`}>{Math.abs(dif) < 1 ? 'igual' : `${dif > 0 ? '+' : '−'}${clp(Math.abs(dif))}`}</td>
                      <td className={`${td} tabular-nums`}>{f.obumaOc ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {folio && <OrdenCompraVisor negocioId={negocioId} folio={folio} onCerrar={() => setFolio(null)} />}
    </div>
  );
}
