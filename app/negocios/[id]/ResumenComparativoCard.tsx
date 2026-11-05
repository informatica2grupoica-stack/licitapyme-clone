'use client';

// RESUMEN COMPARATIVO — ¿coinciden lo costeado, el plan de compra de Licitank y lo comprado de verdad
// en Obuma? Por producto y por orden de compra, todo NETO. Solo lectura: lee /resumen-comparativo.
// Diseño: skill licitank-ui (bloques rounded-2xl, rótulos en minúscula, estado con punto, teal como marca).
import { useCallback, useEffect, useState } from 'react';
import { CompararOcModal, colorEstadoOc } from './CompararOcModal';
import { GastoExtraModal } from './GastoExtraModal';
import { useToast } from '@/app/components/ui/toast';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { Esqueleto } from '@/app/components/ui/kit/Estructura';
import { IconAlertTriangle as Alerta, IconCircleCheck as Check, IconRefresh as Refrescar, IconPlus as Mas } from '@tabler/icons-react';

interface Fila {
  productoId: number; producto: string; cantidad: number;
  ventaUnit: number | null; ventaNeto: number | null; costeoUnit: number | null; costeoNeto: number | null;
  planProveedor: string | null; planUnit: number | null; planNeto: number | null;
  obumaProveedor: string | null; obumaOc: string | null; obumaEstado: string | null; obumaSku: string | null;
  obumaUnit: number | null; obumaNeto: number | null; otroProveedor: boolean;
}
interface PorOc { ocFolio: string; proveedor: string | null; estado: string | null; planNeto: number | null; obumaNeto: number; facturadoNeto: number; facturas: number }
interface CuadreLado { obumaCantidad: number; obumaTotal: number; licitankCantidad: number; licitankTotal: number; diferencias: { concepto: string; monto: number; gastoPropio?: { descripcion: string; categoria: string } }[]; sinExplicar: number }
interface Resumen {
  cuadre: { proyectoFolio: number | null; proyectoNombre: string | null; oc: CuadreLado; facturas: CuadreLado; soloEnOc: string[]; cuadra: boolean } | null;
  filas: Fila[];
  lineasSinPlan: { ocFolio: string; proveedor: string | null; producto: string; sku: string | null; cantidad: number | null; neto: number | null }[];
  porOc: PorOc[];
  gastosExtra: { id: number; categoria: string; descripcion: string; monto: number; moneda: string; fecha: string | null; origen: 'licitank' | 'obuma' }[];
  totales: { venta: number; costeo: number; plan: number; obumaOc: number; facturado: number; gastosExtra: number; margenRealNeto: number; margenRealPct: number | null };
  avisos: string[];
}

const fmt = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const estadoLegible = (e: string | null) => e ? e.charAt(0) + e.slice(1).toLowerCase() : '—';

// Piezas de tabla comunes (tarjeta con borde fino, encabezado en minúscula, filas separadas por línea).
const CAJA_TABLA = 'overflow-x-auto rounded-2xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const THEAD = 'bg-slate-50/80 text-left text-[11px] text-tinta-2 dark:bg-slate-800/60 dark:text-slate-400';
const TH = 'px-3 py-2 font-medium';
const TR = 'border-t border-linea/70 align-top dark:border-slate-800';
const TFOOT = 'border-t border-linea bg-slate-50/80 font-semibold text-tinta dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-100';
const SUB = 'block text-[11px] text-tinta-3';

/** Diferencia de A contra B (A − B) con su % y color: pagar más que la referencia es rojo, menos es verde. */
function Dif({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null || b === 0) return <span className="text-tinta-3">—</span>;
  const d = Math.round(a - b);
  const pct = Math.round(((a - b) / b) * 1000) / 10;
  if (Math.abs(pct) < 1) return <span className="text-tinta-2">≈ igual</span>;
  return <span className={`font-semibold ${d > 0 ? 'text-urgente' : 'text-exito'}`}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))} <span className="font-normal">({pct > 0 ? '+' : ''}{String(pct).replace('.', ',')}%)</span></span>;
}

function Titulo({ children, detalle, accion }: { children: React.ReactNode; detalle?: string; accion?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3 flex-wrap">
      <h3 className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">
        {children}{detalle && <span className="ml-2 text-[12px] font-normal text-tinta-3">{detalle}</span>}
      </h3>
      {accion}
    </div>
  );
}

export function ResumenComparativoCard({ negocioId }: { negocioId: number }) {
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparando, setComparando] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [agregandoGasto, setAgregandoGasto] = useState<{ categoria: string; descripcion?: string; monto?: number } | null>(null);   // null = cerrado
  const [sincronizando, setSincronizando] = useState(false);
  const toast = useToast();
  const recargar = useCallback(() => setVersion(v => v + 1), []);

  // Corre YA la sincronización con Obuma (la misma del cron de las 07:45) y vuelve a armar el comparativo.
  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/sincronizar-obuma`, { method: 'POST' }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      toast.success('Obuma sincronizado', `${r.resumen?.candidatas ?? 0} compra(s) de Obuma cruzadas con licitaciones nuestras.`);
      recargar();
    } catch (e: any) { toast.error('No se pudo sincronizar con Obuma', e.message); }
    finally { setSincronizando(false); }
  };

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/resumen-comparativo`).then(x => x.json())
      .then(d => { if (!vivo) return; if (d.success) setR(d.resumen); else setError(d.error || 'No se pudo armar el comparativo.'); })
      .catch(() => vivo && setError('No se pudo armar el comparativo.'));
    return () => { vivo = false; };
  }, [negocioId, version]);

  if (error) return <p className="px-1 py-2 text-[12.5px] text-urgente">{error}</p>;
  if (!r) return (
    <div className="space-y-3" aria-label="Armando el comparativo">
      <Esqueleto className="h-20 rounded-2xl" />
      <div className="grid grid-cols-3 gap-3">{[0, 1, 2, 3, 4, 5].map(i => <Esqueleto key={i} className="h-[84px] rounded-2xl" />)}</div>
      <Esqueleto className="h-48 rounded-2xl" />
    </div>
  );
  const t = r.totales;
  const coincide = r.avisos.length === 0;

  return (
    <div className="@container space-y-6" data-testid="resumen-comparativo">
      <div className="rounded-2xl border border-linea bg-white px-5 py-4 shadow-tarjeta space-y-1.5 dark:bg-slate-900 dark:border-slate-800" data-testid="comparativo-guia">
        <p className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">Para qué sirve esta pestaña</p>
        <p className="text-[12.5px] text-tinta-2 dark:text-slate-400">Compara tres cosas para cada producto: <b className="text-tinta dark:text-slate-200">lo que se costeó</b> al ofertar, <b className="text-tinta dark:text-slate-200">la cotización elegida</b> en Licitank y <b className="text-tinta dark:text-slate-200">lo que de verdad se compró</b> en Obuma. Así ves si pagaste más o menos de lo previsto. Es solo para mirar: no hay nada que llenar.</p>
        <ul className="text-[12.5px] text-tinta-2 space-y-0.5 dark:text-slate-400">
          <li><b className="text-exito">Verde</b> = pagaste menos que la referencia · <b className="text-urgente">Rojo</b> = pagaste más · «≈ igual» = diferencia menor al 1 %.</li>
          <li>Todos los montos son <b className="text-tinta dark:text-slate-200">sin IVA</b>, salvo la tabla de «Cuadre con Obuma», que va con IVA como la muestra Obuma.</li>
          <li>Si algo no coincide, el recuadro de abajo dice qué. Corrígelo en Obuma (o anota el gasto en «Gastos extra») y esta pantalla se actualiza sola.</li>
        </ul>
      </div>

      <div className={`rounded-2xl border px-5 py-3.5 ${coincide ? 'border-green-200 bg-green-50/60 dark:bg-green-950/30 dark:border-green-900' : 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-900'}`}>
        <p className={`text-[13.5px] font-semibold flex items-center gap-2 ${coincide ? 'text-exito' : 'text-alerta'}`}>
          {coincide ? <Check size={16} /> : <Alerta size={16} />}
          {coincide ? 'Costeo, cotización elegida y Obuma coinciden.' : `Hay ${r.avisos.length} cosa(s) que no coinciden — revisar`}
        </p>
        {r.avisos.length > 0 && <ul className="mt-1.5 list-disc pl-6 space-y-0.5 text-[12.5px] text-amber-900 dark:text-amber-200">{r.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      </div>

      {r.cuadre && (
        <div className={`rounded-2xl border px-5 py-4 ${r.cuadre.cuadra ? 'border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800' : 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-900'}`} data-testid="cuadre-obuma">
          <p className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100 flex items-center gap-2 flex-wrap">
            Cuadre con el proyecto en Obuma{r.cuadre.proyectoFolio ? ` · PR-${r.cuadre.proyectoFolio}` : ''}
            <span className="text-[12px] font-normal text-tinta-3">con IVA, como lo muestra Obuma</span>
            <span className="text-[12px] font-medium"><Estado color={r.cuadre.cuadra ? '#15803d' : '#b45309'}>{r.cuadre.cuadra ? 'Cuadra' : 'No cuadra'}</Estado></span>
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className="text-left text-[11px] text-tinta-2 dark:text-slate-400">
                  <th className="py-1.5 pr-3 font-medium"> </th>
                  <th className="py-1.5 px-3 font-medium text-right">En Obuma</th>
                  <th className="py-1.5 px-3 font-medium text-right">En Licitank</th>
                  <th className="py-1.5 px-3 font-medium text-right">Obuma − Licitank</th>
                  <th className="py-1.5 pl-3 font-medium">Por qué</th>
                </tr>
              </thead>
              <tbody>
                {([['Órdenes de compra', r.cuadre.oc], ['Facturas', r.cuadre.facturas]] as const).map(([nombre, l]) => (
                  <tr key={nombre} className={TR}>
                    <td className="py-2 pr-3 font-semibold text-tinta whitespace-nowrap dark:text-slate-100">{nombre}</td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-tinta dark:text-slate-200">{fmt(l.obumaTotal)}<span className={SUB}>{l.obumaCantidad} documento(s)</span></td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-tinta dark:text-slate-200">{fmt(l.licitankTotal)}<span className={SUB}>{l.licitankCantidad} documento(s)</span></td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap font-semibold text-tinta dark:text-slate-100">{fmt(l.obumaTotal - l.licitankTotal)}</td>
                    <td className="py-2 pl-3 text-tinta-2 dark:text-slate-300">
                      {l.diferencias.length === 0 && Math.abs(l.sinExplicar) <= 2 && <span className="text-exito font-semibold">Cuadra exacto.</span>}
                      {l.diferencias.map((d, i) => (
                        <span key={i} className="block">
                          <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{d.monto >= 0 ? '+' : '−'} {fmt(Math.abs(d.monto))}</span> · {d.concepto}
                          {d.gastoPropio && <button type="button" onClick={() => setAgregandoGasto({ categoria: d.gastoPropio!.categoria, descripcion: d.gastoPropio!.descripcion, monto: Math.abs(d.monto) })} className="ml-2 text-[12px] font-medium text-marca hover:text-marca-fuerte">Registrar en Gastos extra</button>}
                        </span>
                      ))}
                      {Math.abs(l.sinExplicar) > 2 && <span className="block font-semibold text-alerta">{l.sinExplicar > 0 ? '+' : '−'} {fmt(Math.abs(l.sinExplicar))} sin explicar (puede faltar sincronizar con Obuma)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.cuadre.soloEnOc.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[12px] text-amber-900 space-y-0.5 dark:text-amber-200">{r.cuadre.soloEnOc.map((t, i) => <li key={i}>{t}</li>)}</ul>
          )}
          <p className="mt-2 text-[12px] text-tinta-3">{r.cuadre.cuadra ? 'Todo lo que Obuma tiene en este proyecto está en Licitank o está explicado arriba.' : 'Hay diferencias sin explicar: sincroniza con Obuma y, si siguen, avisa al administrador.'} Lo que Licitank deja fuera es porque Obuma lo tiene mal (OC anulada, factura duplicada o enlazada a la OC equivocada): se corrige en Obuma y aquí se actualiza solo.</p>
        </div>
      )}

      <div>
        <div className="grid grid-cols-2 @xl:grid-cols-3 @5xl:grid-cols-6 gap-3">
          {([
            ['Venta ganada', t.venta],
            ['Costeado', t.costeo],
            ['Cotización elegida', t.plan],
            ['OC en Obuma', t.obumaOc],
            ['Facturado', t.facturado],
            ['Gastos extra', t.gastosExtra],
          ] as const).map(([n, v]) => (
            <div key={n} className="rounded-2xl border border-linea bg-white px-4 py-3 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
              <p className="text-[11px] text-tinta-2 flex items-center justify-between gap-2 dark:text-slate-400">
                {n}
                {n === 'Gastos extra' && (
                  <button type="button" onClick={() => setAgregandoGasto({ categoria: '' })} title="Agregar un gasto extra" aria-label="Agregar gasto extra" data-testid="agregar-gasto-extra"
                    className="w-6 h-6 rounded-lg bg-marca hover:bg-marca-fuerte text-white flex items-center justify-center transition-colors duration-150"><Mas size={14} /></button>
                )}
              </p>
              <p className="mt-0.5 text-[20px] leading-tight font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{fmt(v)}</p>
              <p className="text-[11px] text-tinta-3">neto</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[13px] text-tinta-2 dark:text-slate-400">
            Margen real (OC de Obuma + gastos extra): <b className="font-semibold text-tinta tabular-nums dark:text-slate-100">{fmt(t.margenRealNeto)}</b>
            {t.margenRealPct != null && <> ({String(t.margenRealPct).replace('.', ',')}% de la venta)</>} · contra lo costeado: <Dif a={t.obumaOc + t.gastosExtra} b={t.costeo} />
          </p>
          <span className="flex items-center gap-2.5 text-[12px] text-tinta-3">
            Las OC y facturas de Obuma se copian una vez al día (07:45).
            <Boton tamano="sm" onClick={sincronizar} disabled={sincronizando} data-testid="sincronizar-obuma"
              icono={<Refrescar size={14} className={sincronizando ? 'animate-spin' : ''} />}>
              {sincronizando ? 'Sincronizando…' : 'Sincronizar con Obuma ahora'}
            </Boton>
          </span>
        </div>
      </div>

      <div>
        <Titulo detalle="todo neto">Por producto</Titulo>
        <div className={CAJA_TABLA}>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className={THEAD}>
                <th className={TH}>Producto</th>
                <th className={`${TH} text-right`}>Cant.</th>
                <th className={`${TH} text-right`}>Venta</th>
                <th className={`${TH} text-right`}>Costeo</th>
                <th className={TH}>Cotización elegida</th>
                <th className={TH}>Comprado en Obuma</th>
                <th className={`${TH} text-right`}>Obuma vs costeo</th>
              </tr>
            </thead>
            <tbody className="text-tinta-2 dark:text-slate-300">
              {r.filas.map(f => (
                <tr key={f.productoId} className={TR}>
                  <td className="px-3 py-2 font-semibold text-tinta min-w-[170px] dark:text-slate-100">{f.producto}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.cantidad}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(f.ventaNeto)}<span className={SUB}>{fmt(f.ventaUnit)} c/u</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(f.costeoNeto)}<span className={SUB}>{fmt(f.costeoUnit)} c/u</span></td>
                  <td className="px-3 py-2 tabular-nums">
                    {f.planProveedor ? <>{fmt(f.planNeto)}<span className={SUB}>{f.planProveedor} · {fmt(f.planUnit)} c/u</span></> : <span className="text-tinta-3">sin cotización</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {f.obumaOc ? (
                      <>
                        {fmt(f.obumaNeto)}
                        <span className={SUB}>{f.obumaProveedor} · OC {f.obumaOc}{f.obumaEstado ? ` · ${estadoLegible(f.obumaEstado)}` : ''} · {fmt(f.obumaUnit)} c/u</span>
                        {f.obumaSku && <span className="block text-[11px] font-medium text-tinta-2 dark:text-slate-400">SKU {f.obumaSku}</span>}
                        {f.otroProveedor && <span className="block text-[11px] font-medium text-alerta">Proveedor distinto a la cotización elegida</span>}
                      </>
                    ) : <span className="text-alerta font-medium">sin OC en Obuma</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums"><Dif a={f.obumaNeto} b={f.costeoNeto} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={TFOOT}>
                <td className="px-3 py-2" colSpan={2}>{r.filas.length} productos</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(t.venta)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(t.costeo)}</td>
                <td className="px-3 py-2 tabular-nums">{fmt(t.plan)}</td>
                <td className="px-3 py-2 tabular-nums">{fmt(r.filas.reduce((s, f) => s + (f.obumaNeto ?? 0), 0))}</td>
                <td className="px-3 py-2 text-right"><Dif a={r.filas.reduce((s, f) => s + (f.obumaNeto ?? 0), 0)} b={t.costeo} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
        {r.lineasSinPlan.length > 0 && (
          <p className="mt-2 text-[12px] text-tinta-3">
            Además, en Obuma hay líneas que no son un producto de la cotización elegida: {r.lineasSinPlan.map(l => `${l.producto.slice(0, 40)} (OC ${l.ocFolio}, ${fmt(l.neto)})`).join(' · ')}.
          </p>
        )}
      </div>

      <div data-testid="resumen-gastos-extra">
        <Titulo detalle="se suman al costo real" accion={
          <span className="inline-flex items-center gap-1">
            <Boton tamano="sm" variante="fantasma" onClick={() => setAgregandoGasto({ categoria: 'Garantía de fiel cumplimiento' })}>+ Garantía</Boton>
            <Boton tamano="sm" variante="secundario" onClick={() => setAgregandoGasto({ categoria: '' })} icono={<Mas size={14} />}>Agregar gasto extra</Boton>
          </span>
        }>Gastos extra del proyecto</Titulo>
        {r.gastosExtra.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-[12.5px] text-tinta-3 dark:border-slate-700">Sin gastos extra. Usa «+» para agregar uno (flete, garantía, horas extras…).</p>}
        {r.gastosExtra.length > 0 && (
          <div className={CAJA_TABLA}>
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Categoría</th>
                  <th className={TH}>Descripción</th>
                  <th className={TH}>Fecha</th>
                  <th className={`${TH} text-right`}>Monto</th>
                </tr>
              </thead>
              <tbody className="text-tinta-2 dark:text-slate-300">
                {r.gastosExtra.map(g => (
                  <tr key={g.id} className={TR}>
                    <td className="px-3 py-2 font-semibold text-tinta whitespace-nowrap dark:text-slate-100">{g.categoria}</td>
                    <td className="px-3 py-2">{g.descripcion}{g.origen === 'obuma' && <span className="ml-2 text-[11px] font-medium text-tinta-3"><Estado color="#0891b2">desde Obuma</Estado></span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{g.fecha ? g.fecha.split('-').reverse().join('-') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-tinta dark:text-slate-100">{g.moneda === 'CLP' ? fmt(g.monto) : <span className="text-alerta">{g.monto} {g.moneda} (no suma)</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TFOOT}>
                  <td className="px-3 py-2" colSpan={3}>{r.gastosExtra.length} gasto(s)</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(t.gastosExtra)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div>
        <Titulo detalle="cotización elegida contra Obuma contra factura">Por orden de compra</Titulo>
        <div className={CAJA_TABLA}>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className={THEAD}>
                <th className={TH}>OC</th>
                <th className={TH}>Proveedor</th>
                <th className={TH}>Estado</th>
                <th className={`${TH} text-right`}>Cotización elegida</th>
                <th className={`${TH} text-right`}>OC Obuma</th>
                <th className={`${TH} text-right`}>Facturado</th>
                <th className={`${TH} text-right`}>OC − factura</th>
                <th className={`${TH} text-right`}>Ver</th>
              </tr>
            </thead>
            <tbody className="text-tinta-2 dark:text-slate-300">
              {r.porOc.map(o => (
                <tr key={o.ocFolio} className={`${TR} align-middle`}>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">OC {o.ocFolio}</td>
                  <td className="px-3 py-2 font-semibold text-tinta dark:text-slate-100">{o.proveedor || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><Estado color={colorEstadoOc(o.estado)}>{estadoLegible(o.estado)}</Estado></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(o.planNeto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(o.obumaNeto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {o.facturas ? <span className="font-semibold text-tinta dark:text-slate-100">{fmt(o.facturadoNeto)}</span>
                      : <span className="text-alerta font-medium">{/facturad/i.test(o.estado || '') ? 'falta traer la factura' : 'sin factura'}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.facturas ? <Dif a={o.obumaNeto} b={o.facturadoNeto} /> : <span className="text-tinta-3">—</span>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap"><button type="button" onClick={() => setComparando(o.ocFolio)} className="text-[12.5px] font-medium text-marca hover:text-marca-fuerte" data-testid={`comparar-${o.ocFolio}`}>Comparar</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={TFOOT}>
                <td className="px-3 py-2" colSpan={3}>{r.porOc.length} OC</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.porOc.reduce((s, o) => s + (o.planNeto ?? 0), 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(t.obumaOc)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(t.facturado)}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-tinta-3">«Comparar» abre, lado a lado, la cotización elegida, la OC de Obuma y la factura de esa orden. Si Obuma la marca facturada y aquí falta la factura, la trae sola al abrir.</p>
      </div>
      {agregandoGasto !== null && <GastoExtraModal negocioId={negocioId} categoriaInicial={agregandoGasto.categoria || undefined} descripcionInicial={agregandoGasto.descripcion} montoInicial={agregandoGasto.monto} onCerrar={() => setAgregandoGasto(null)} onGuardado={() => { setAgregandoGasto(null); recargar(); }} />}
      {comparando && <CompararOcModal negocioId={negocioId} ocFolio={comparando} onCerrar={() => setComparando(null)} onSincronizado={recargar} />}
    </div>
  );
}
