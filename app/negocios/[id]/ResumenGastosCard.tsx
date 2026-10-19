'use client';

// SEGUIMIENTO · RESUMEN — «cómo va la compra» de un vistazo (pedido 22-sep-2026: cuánto gastamos, las OC creadas y las facturas).
// Rehecho el 19-oct-2026 porque se veía desordenado (la misma información repetida en cuatro bloques). Ahora, de arriba hacia abajo:
//   1. cuatro tarjetas de avance (productos con proveedor · órdenes de compra · facturas · gasto contra lo costeado),
//   2. una sola barra «costeado vs gastado»,
//   3. UNA tabla de órdenes de compra (las de Licitank y las hechas directo en Obuma, sin repetir), con las líneas al abrirlas,
//   4. las facturas, y al pie la OC del cliente y el gasto del Proyecto completo en Obuma (consulta en vivo, a un clic).
// Las cifras leen de BASE, sin llamar a Obuma en cada carga.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconLoader2 as Loader2, IconFolderSearch as FolderSearch, IconEye as Eye, IconChevronRight as Chevron } from '@tabler/icons-react';
import { FacturaVisor } from './FacturaVisor';
import { enfocarProducto } from '@/app/compras/[negocioId]/comprasNavegacion';

interface LineaOc { producto: string; sku: string | null; cantidad: number | null; precio: number | null; subtotal: number | null }
interface ResumenGastos {
  ocCreadas: { cantidad: number; totalNeto: number; proveedores: { nombre: string; folio: string | null; total: number; fecha: string }[] };
  comprasCruzadas: { cantidad: number; total: number; neto: number };
  ocsObuma?: { folio: string; proveedor: string | null; estado: string | null; fecha: string | null; neto: number; total: number; skus: string[]; lineas: LineaOc[] }[];
  facturas: {
    cantidad: number; total: number;
    detalle?: { dteId?: string; folio: string; proveedor: string | null; total: number | null; fecha: string | null; xmlUrl: string | null; ocFolio?: string | null }[];
    descartadas?: { dteId?: string; folio: string; proveedor: string | null; total: number | null; fecha: string | null; xmlUrl: string | null; motivo: string }[];
  };
  montoCosteado: number | null;
  variacionPct: number | null;
}
interface GastosProyecto {
  centroCostoNombre: string; relProyectoId: string | null;
  centrosDeCostoDelProyecto: { id: string; nombre: string }[];
  totalOc: number; cantidadOc: number; totalOcNeto?: number; cantidadAnuladas?: number;
}
/** Una fila de la tabla de órdenes de compra: las emitidas desde Licitank y las hechas directo en Obuma, sin repetir. */
interface FilaOc { folio: string; proveedor: string; fecha: string | null; estado: string | null; origen: 'licitank' | 'obuma'; neto: number | null; total: number | null; lineas: LineaOc[] }

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (f: string | null | undefined) => f ? f.slice(0, 10).split('-').reverse().join('-') : '—';
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

type Tono = 'ok' | 'pendiente' | 'neutro' | 'alerta';
const TONO: Record<Tono, { borde: string; circulo: string }> = {
  ok: { borde: 'border-emerald-200 bg-emerald-50/50', circulo: 'bg-emerald-600 text-white' },
  pendiente: { borde: 'border-amber-200 bg-amber-50/50', circulo: 'bg-amber-500 text-white' },
  alerta: { borde: 'border-rose-200 bg-rose-50/50', circulo: 'bg-rose-600 text-white' },
  neutro: { borde: 'border-zinc-200 bg-white', circulo: 'bg-zinc-300 text-white' },
};

function TarjetaAvance({ n, titulo, valor, detalle, tono, accion }: { n: number; titulo: string; valor: string; detalle: string; tono: Tono; accion?: { texto: string; onClick: () => void } }) {
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${TONO[tono].borde}`}>
      <div className="flex items-center gap-2">
        <span className={`flex-shrink-0 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${TONO[tono].circulo}`}>{tono === 'ok' ? '✔' : n}</span>
        <p className="text-[11.5px] font-bold text-zinc-600 uppercase tracking-wide">{titulo}</p>
      </div>
      <p className="text-[20px] font-bold text-zinc-900 tabular-nums leading-tight mt-1.5">{valor}</p>
      <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-snug">{detalle}</p>
      {accion && <button type="button" onClick={accion.onClick} className="mt-1.5 text-[11.5px] font-semibold text-teal-700 hover:text-teal-900">{accion.texto} →</button>}
    </div>
  );
}

export function ResumenGastosCard({ negocioId }: { negocioId: number }) {
  const [facturaAbierta, setFacturaAbierta] = useState<string | null>(null);
  const toast = useToast();
  const [resumen, setResumen] = useState<ResumenGastos | null>(null);
  const [licitacionCodigo, setLicitacionCodigo] = useState<string | null>(null);
  const [cobertura, setCobertura] = useState<{ total: number; cubiertos: number; directos: number; sinCubrir: string[] } | null>(null);
  const [ocCliente, setOcCliente] = useState<{ numero: string | null; aceptadaAt: string | null; emitidaAt: string | null; monto: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  const [proyecto, setProyecto] = useState<GastosProyecto | null>(null);
  const [estadoProyecto, setEstadoProyecto] = useState<'idle' | 'cargando' | 'ok' | 'sin_datos' | 'error'>('idle');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/compras/${negocioId}/resumen-gastos`);
      const d = await r.json();
      if (d.success) { setResumen(d.resumen); setLicitacionCodigo(d.licitacionCodigo || null); setCobertura(d.cobertura || null); setOcCliente(d.ocCliente || null); }
    } catch (e: any) {
      toast.error('No se pudo cargar el resumen de gasto', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const consultarProyecto = () => {
    if (!licitacionCodigo) return;
    setEstadoProyecto('cargando');
    fetch(`/api/obuma-compras/gastos-proyecto?codigo=${encodeURIComponent(licitacionCodigo)}`)
      .then(r => r.json())
      .then(d => {
        if (!d?.success) { setEstadoProyecto('error'); return; }
        if (!d.gastos) { setEstadoProyecto('sin_datos'); return; }
        setProyecto(d.gastos); setEstadoProyecto('ok');
      })
      .catch(() => setEstadoProyecto('error'));
  };

  // Tabla única de órdenes de compra: lo de Obuma manda (tiene neto, total, estado y líneas); lo emitido desde Licitank se marca como tal
  // y, si Obuma todavía no lo trae (la sincronización va con retraso), se agrega con lo que Licitank guardó.
  const filasOc = useMemo<FilaOc[]>(() => {
    if (!resumen) return [];
    const delicitank = new Map(resumen.ocCreadas.proveedores.filter(o => o.folio).map(o => [String(o.folio), o]));
    const filas: FilaOc[] = (resumen.ocsObuma ?? []).map(o => ({
      folio: o.folio, proveedor: o.proveedor || 'Proveedor', fecha: o.fecha, estado: o.estado,
      origen: delicitank.has(String(o.folio)) ? 'licitank' : 'obuma', neto: o.neto, total: o.total, lineas: o.lineas,
    }));
    for (const o of resumen.ocCreadas.proveedores) {
      if (o.folio && filas.some(f => f.folio === String(o.folio))) continue;
      filas.push({ folio: o.folio || 's/folio', proveedor: o.nombre, fecha: o.fecha, estado: null, origen: 'licitank', neto: o.total, total: null, lineas: [] });
    }
    return filas.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [resumen]);

  if (loading) {
    return <div className="bg-white rounded-2xl border border-zinc-200 p-4 flex items-center gap-2 text-[12px] text-zinc-400"><Loader2 size={14} className="animate-spin" /> Cargando el seguimiento…</div>;
  }
  if (!resumen) return (
    <div className="text-[13px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="flex-1 min-w-[220px]"><b className="text-zinc-800">No se pudo cargar el seguimiento.</b> No significa que no haya gasto: el servidor no respondió. Los números aparecen cuando hay órdenes de compra emitidas o compras registradas en Obuma.</span>
      <button type="button" onClick={() => { setLoading(true); void cargar(); }} className="text-[12.5px] font-semibold text-teal-700 hover:text-teal-900">Reintentar</button>
    </div>
  );

  // Gasto real = lo que Obuma tiene (sin anuladas), neto, igual que lo costeado; si Obuma aún no trae nada, lo que guardó Licitank.
  const gastado = resumen.comprasCruzadas.neto || resumen.ocCreadas.totalNeto || null;
  const costeado = resumen.montoCosteado;
  const variacion = costeado && costeado > 0 && gastado != null ? Math.round(((gastado - costeado) / costeado) * 1000) / 10 : null;
  const nOc = filasOc.length;
  const nFac = resumen.facturas.cantidad;
  const facturasPorOc = new Map<string, string[]>();
  for (const f of resumen.facturas.detalle ?? []) if (f.ocFolio) facturasPorOc.set(String(f.ocFolio), [...(facturasPorOc.get(String(f.ocFolio)) ?? []), f.folio]);
  const totalNetoOc = filasOc.reduce((s, f) => s + (f.neto ?? 0), 0);
  const alternar = (folio: string) => setAbiertas(prev => { const n = new Set(prev); if (n.has(folio)) n.delete(folio); else n.add(folio); return n; });
  const todosCubiertos = !!cobertura && cobertura.total > 0 && cobertura.cubiertos === cobertura.total;
  const irAOrdenes = () => enfocarProducto('pasos', null);

  return (
    <div className="space-y-4" data-testid="resumen-seguimiento">
      <p className="text-[12.5px] text-zinc-500">Esta pestaña es solo para <b className="text-zinc-700">mirar cómo va la compra</b>: no hay nada que llenar. Se actualiza sola a medida que haces las cosas en las otras pestañas y en Obuma.</p>

      {/* 1. Avance en cuatro pasos */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5" data-testid="resumen-guia" aria-label="Avance de la compra">
        <TarjetaAvance n={1} titulo="Productos con proveedor"
          valor={cobertura && cobertura.total > 0 ? `${cobertura.cubiertos} de ${cobertura.total}` : '—'}
          detalle={!cobertura || cobertura.total === 0 ? 'Aún no hay productos para revisar.'
            : todosCubiertos ? `Todos tienen proveedor${cobertura.directos > 0 ? ` (${cobertura.directos} por compra directa)` : ''}.`
            : `Faltan: ${cobertura.sinCubrir.slice(0, 2).map(n => n.split(' - ')[0].slice(0, 28)).join(', ')}${cobertura.sinCubrir.length > 2 ? ` y ${cobertura.sinCubrir.length - 2} más` : ''}.`}
          tono={!cobertura || cobertura.total === 0 ? 'neutro' : todosCubiertos ? 'ok' : 'pendiente'} />
        <TarjetaAvance n={2} titulo="Órdenes de compra"
          valor={nOc > 0 ? String(nOc) : '0'}
          detalle={nOc > 0 ? `${plural(nOc, 'orden emitida', 'órdenes emitidas')} · ${fmtCLP(totalNetoOc)} neto.` : 'Todavía no se emitió ninguna.'}
          tono={nOc > 0 ? 'ok' : 'pendiente'} accion={nOc === 0 ? { texto: 'Ir a Órdenes y facturas', onClick: irAOrdenes } : undefined} />
        <TarjetaAvance n={3} titulo="Facturas recibidas"
          valor={String(nFac)}
          detalle={nFac > 0 ? `${plural(nFac, 'factura registrada', 'facturas registradas')} en Obuma · ${fmtCLP(resumen.facturas.total)} con IVA.` : nOc > 0 ? 'Aún no llega ninguna. Cuando el proveedor la entregue y se registre en Obuma, aparece aquí sola.' : 'Se esperan cuando haya órdenes emitidas.'}
          tono={nFac > 0 ? 'ok' : nOc > 0 ? 'pendiente' : 'neutro'} />
        <TarjetaAvance n={4} titulo="Gasto vs costeado"
          valor={gastado != null ? fmtCLP(gastado) : '—'}
          detalle={variacion == null ? 'Se compara contra lo costeado cuando haya gasto.' : variacion > 0 ? `${variacion}% más de lo previsto (neto).` : variacion < 0 ? `${Math.abs(variacion)}% menos de lo previsto (neto).` : 'Igual a lo previsto (neto).'}
          tono={variacion == null ? 'neutro' : variacion > 0 ? 'alerta' : 'ok'} />
      </section>

      {/* 2. Costeado vs gastado (una sola vez) */}
      {costeado != null && gastado != null && (
        <section className="bg-white rounded-xl border border-zinc-200 px-4 py-3" aria-label="Costeado contra gastado">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-[13px] font-bold text-zinc-800">Lo costeado contra lo gastado <span className="font-normal text-zinc-400">(neto, sin IVA)</span></p>
            {variacion != null && (
              <span className={`text-[12px] font-bold px-2.5 py-0.5 rounded-full border ${variacion > 0 ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
                {variacion > 0 ? '+' : ''}{variacion}% {variacion > 0 ? 'sobre lo costeado' : 'bajo lo costeado'}
              </span>
            )}
          </div>
          <div className="mt-2 h-3 rounded-full bg-zinc-100 overflow-hidden" role="img" aria-label={`Gastado ${fmtCLP(gastado)} de ${fmtCLP(costeado)} costeados`}>
            <div className={`h-full rounded-full ${gastado > costeado ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, Math.round((gastado / Math.max(costeado, 1)) * 100))}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] text-zinc-600 tabular-nums">
            <span>Gastado <b className="text-zinc-900">{fmtCLP(gastado)}</b></span>
            <span>Costeado <b className="text-zinc-900">{fmtCLP(costeado)}</b></span>
          </div>
        </section>
      )}

      {/* 3. Órdenes de compra: una sola tabla */}
      <section className="bg-white rounded-xl border border-zinc-200 overflow-hidden" data-testid="resumen-documentos" aria-label="Órdenes de compra">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
          <p className="text-[13.5px] font-bold text-zinc-800">Órdenes de compra</p>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{nOc}</span>
          <p className="text-[11.5px] text-zinc-400 flex-1 min-w-[200px]">Las emitidas desde Licitank y las hechas directo en Obuma. Toca una fila para ver sus productos.</p>
        </div>
        {nOc === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-zinc-400">Todavía no hay órdenes de compra: aparecen cuando se emite la primera o cuando se registra una en Obuma.</p>
        ) : (
          <div className="overflow-x-auto" data-testid="resumen-oc-obuma">
            <table className="w-full text-[12.5px] min-w-[860px]">
              <thead>
                <tr className="text-left text-[10.5px] font-bold uppercase text-zinc-400 border-b border-zinc-100 bg-zinc-50/60">
                  <th className="px-3 py-2 w-7" />
                  <th className="px-2 py-2">OC</th>
                  <th className="px-2 py-2">Proveedor</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Hecha</th>
                  <th className="px-2 py-2 text-right">Neto</th>
                  <th className="px-2 py-2 text-right">Con IVA</th>
                  <th className="px-2 py-2">Factura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filasOc.map(f => {
                  const abierta = abiertas.has(f.folio);
                  const facturas = facturasPorOc.get(f.folio) ?? [];
                  const anulada = /anulad/i.test(f.estado || '');
                  return (
                    <FilaOrden key={f.folio} f={f} abierta={abierta} anulada={anulada} facturas={facturas} onAlternar={() => alternar(f.folio)} />
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 border-t border-zinc-200 font-bold text-zinc-800">
                  <td className="px-3 py-2" colSpan={6}>Total de las {nOc} órdenes</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtCLP(totalNetoOc)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtCLP(filasOc.reduce((s, f) => s + (f.total ?? (f.neto != null ? Math.round(f.neto * 1.19) : 0)), 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* 4. Facturas */}
      <section className="bg-white rounded-xl border border-zinc-200 overflow-hidden" aria-label="Facturas de compra">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
          <p className="text-[13.5px] font-bold text-zinc-800">Facturas de compra</p>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{nFac}</span>
        </div>
        {(resumen.facturas.descartadas?.length ?? 0) > 0 && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2" data-testid="resumen-facturas-descartadas">
            <p className="text-[10.5px] font-semibold text-amber-800 uppercase tracking-wide mb-1">Facturas que no se suman — revisar en Obuma</p>
            <ul className="space-y-1">
              {resumen.facturas.descartadas!.map((f, i) => (
                <li key={`${f.folio}-${i}`} className="text-[12px] text-amber-900"><b>{f.proveedor || 'Proveedor'}</b> · folio {f.folio} · {fmtCLP(f.total)} — {f.motivo}</li>
              ))}
            </ul>
          </div>
        )}
        {(resumen.facturas.detalle?.length ?? 0) === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-zinc-400">{nOc > 0 ? 'Todavía no llega ninguna factura. Cuando el proveedor entregue la suya y se registre en Obuma, aparece aquí sola.' : 'Las facturas aparecen cuando hay órdenes de compra emitidas.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[720px]" data-testid="resumen-facturas-tabla">
              <thead>
                <tr className="text-left text-[10.5px] font-bold uppercase text-zinc-400 border-b border-zinc-100 bg-zinc-50/60">
                  <th className="px-4 py-2">Proveedor</th>
                  <th className="px-2 py-2">Folio</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">De la OC</th>
                  <th className="px-2 py-2 text-right">Neto</th>
                  <th className="px-2 py-2 text-right">IVA</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Ver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {resumen.facturas.detalle!.map((f, i) => {
                  const neto = f.total != null ? Math.round(f.total / 1.19) : null;
                  return (
                    <tr key={`${f.folio}-${i}`}>
                      <td className="px-4 py-2 font-semibold text-zinc-800">{f.proveedor || 'Proveedor'}</td>
                      <td className="px-2 py-2 tabular-nums text-zinc-600">{f.folio}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-zinc-600">{fmtFecha(f.fecha)}</td>
                      <td className="px-2 py-2 tabular-nums text-zinc-600">{f.ocFolio ? `OC ${f.ocFolio}` : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-zinc-700">{fmtCLP(neto)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-zinc-700">{f.total != null && neto != null ? fmtCLP(f.total - neto) : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-zinc-800">{fmtCLP(f.total)}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-3">
                          {f.xmlUrl && f.dteId && <button type="button" onClick={() => setFacturaAbierta(f.dteId!)} title="Ver la factura" aria-label={`Ver factura ${f.folio}`} className="text-teal-700 hover:text-teal-900"><Eye size={16} /></button>}
                          {f.xmlUrl && <a href={f.xmlUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-900">XML</a>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 border-t border-zinc-200 font-bold text-zinc-800">
                  <td className="px-4 py-2" colSpan={4}>{plural(nFac, 'factura', 'facturas')}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtCLP(Math.round(resumen.facturas.total / 1.19))}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtCLP(resumen.facturas.total - Math.round(resumen.facturas.total / 1.19))}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtCLP(resumen.facturas.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* 5. Pie: OC del cliente y Proyecto completo en Obuma */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {ocCliente && (
          <div className="bg-white rounded-xl border border-zinc-200 px-4 py-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase tracking-wide">Orden de compra del cliente</p>
            <p className="text-[13px] text-zinc-800 mt-0.5">N° <b>{ocCliente.numero || '—'}</b>{ocCliente.monto != null && <> · {fmtCLP(ocCliente.monto)}</>}</p>
            <p className="text-[11.5px] text-zinc-500">{ocCliente.aceptadaAt ? `Aceptada el ${fmtFecha(ocCliente.aceptadaAt)}` : ocCliente.emitidaAt ? `Emitida el ${fmtFecha(ocCliente.emitidaAt)}, todavía sin aceptar` : ''}</p>
          </div>
        )}
        <div className="bg-white rounded-xl border border-zinc-200 px-4 py-3">
          <p className="text-[10.5px] font-bold text-zinc-400 uppercase tracking-wide">Proyecto completo en Obuma</p>
          {estadoProyecto === 'idle' && licitacionCodigo && (
            <button onClick={consultarProyecto} className="mt-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
              <FolderSearch size={13} /> Ver cuánto se ha gastado en total (consulta a Obuma)
            </button>
          )}
          {estadoProyecto === 'cargando' && <span className="mt-1 text-[12px] text-zinc-400 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Consultando Obuma…</span>}
          {estadoProyecto === 'error' && <span className="mt-1 block text-[12px] text-rose-500">No se pudo consultar Obuma ahora.</span>}
          {estadoProyecto === 'sin_datos' && <span className="mt-1 block text-[12px] text-zinc-400">Esta licitación todavía no tiene un centro de costo armado en Obuma.</span>}
          {estadoProyecto === 'ok' && proyecto && (
            <p className="mt-1 text-[12.5px] text-zinc-700"><b>{fmtCLP(proyecto.totalOcNeto ?? Math.round(proyecto.totalOc / 1.19))}</b> neto · {fmtCLP(proyecto.totalOc)} con IVA, en {plural(proyecto.cantidadOc, 'orden', 'órdenes')} de compra{proyecto.cantidadAnuladas ? ` (sin contar ${plural(proyecto.cantidadAnuladas, 'anulada', 'anuladas')})` : ''}
              {proyecto.centrosDeCostoDelProyecto.length > 1 && <> · {proyecto.centrosDeCostoDelProyecto.length} centros de costo</>}</p>
          )}
        </div>
      </section>
      {facturaAbierta && <FacturaVisor negocioId={negocioId} dteId={facturaAbierta} onCerrar={() => setFacturaAbierta(null)} />}
    </div>
  );
}

/** Fila de una orden de compra, con sus productos al abrirla. */
function FilaOrden({ f, abierta, anulada, facturas, onAlternar }: { f: FilaOc; abierta: boolean; anulada: boolean; facturas: string[]; onAlternar: () => void }) {
  const estadoCls = anulada ? 'bg-zinc-100 text-zinc-500 border-zinc-200'
    : /emitid|aprobad|recibid|cerrad/i.test(f.estado || '') ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-800 border-amber-200';
  return (
    <>
      <tr className={`cursor-pointer hover:bg-zinc-50/70 ${anulada ? 'opacity-60' : ''}`} onClick={onAlternar} data-testid={`resumen-oc-${f.folio}`}>
        <td className="px-3 py-2"><Chevron size={14} className={`text-zinc-400 transition-transform ${abierta ? 'rotate-90' : ''}`} /></td>
        <td className="px-2 py-2 font-bold text-zinc-800 tabular-nums whitespace-nowrap">OC {f.folio}</td>
        <td className="px-2 py-2 text-zinc-800">{f.proveedor}</td>
        <td className="px-2 py-2 whitespace-nowrap text-zinc-600">{fmtFecha(f.fecha)}</td>
        <td className="px-2 py-2">{f.estado ? <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${estadoCls}`}>{f.estado}</span> : <span className="text-zinc-300">—</span>}</td>
        <td className="px-2 py-2">
          <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full border ${f.origen === 'licitank' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>{f.origen === 'licitank' ? 'Desde Licitank' : 'Directo en Obuma'}</span>
        </td>
        <td className="px-2 py-2 text-right tabular-nums font-semibold text-zinc-800">{fmtCLP(f.neto)}</td>
        <td className="px-2 py-2 text-right tabular-nums text-zinc-600">{fmtCLP(f.total ?? (f.neto != null ? Math.round(f.neto * 1.19) : null))}</td>
        <td className="px-2 py-2 text-[11.5px]">{facturas.length > 0 ? <span className="font-semibold text-emerald-700">✔ {facturas.join(', ')}</span> : <span className="text-zinc-400">sin factura</span>}</td>
      </tr>
      {abierta && (
        <tr className="bg-zinc-50/60">
          <td />
          <td colSpan={8} className="px-2 py-2.5">
            {f.lineas.length === 0 ? (
              <p className="text-[11.5px] text-zinc-400">Obuma todavía no trae las líneas de esta orden (la sincronización tarda un poco).</p>
            ) : (
              <table className="w-full text-[12px] bg-white rounded-lg border border-zinc-100">
                <thead>
                  <tr className="text-left text-[10px] font-bold uppercase text-zinc-400">
                    <th className="px-3 py-1.5">Producto</th><th className="px-2 py-1.5">SKU</th><th className="px-2 py-1.5 text-right">Cant.</th>
                    <th className="px-2 py-1.5 text-right">Precio neto c/u</th><th className="px-2 py-1.5 text-right">Subtotal neto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {f.lineas.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-zinc-700" title={l.producto}>{l.producto.length > 90 ? `${l.producto.slice(0, 90)}…` : l.producto}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{l.sku ? <span className="font-semibold text-indigo-600">{l.sku}</span> : <span className="text-zinc-300">sin SKU</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">{l.cantidad ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">{l.precio != null ? fmtCLP(l.precio) : '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-zinc-800">{fmtCLP(l.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
