'use client';

// RESUMEN DE GASTO (OBUMA) — pedido explícito del usuario (22-sep-2026): "nos falta un resumen en
// el módulo de compra... de cuánto gastamos, las OC creadas y las facturas realizadas". Hasta hoy
// ese número solo se veía en la ficha de la licitación (bloque "Compras (Obuma)",
// ComprasObumaBloque.tsx) — acá se trae DENTRO del módulo de Compras, en la pestaña "Compra,
// Importación y Logística" donde ya vive el resto de lo administrativo con Obuma.
//
// Las 3 cifras principales (OC creadas, compras cruzadas, facturas) leen de BASE — mismo criterio
// que el resto de la pantalla, sin llamar a Obuma en cada carga. El total del Proyecto completo
// (agrupando centros de costo hermanos, ver gastosDelProyectoPorLicitacion en obuma.ts) sigue
// siendo una consulta EN VIVO aparte, a un clic — no autoload.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconReceipt as Receipt, IconLoader2 as Loader2, IconFolderSearch as FolderSearch, IconEye as Eye } from '@tabler/icons-react';
import { FacturaVisor } from './FacturaVisor';

interface ResumenGastos {
  ocCreadas: { cantidad: number; totalNeto: number; proveedores: { nombre: string; folio: string | null; total: number; fecha: string }[] };
  comprasCruzadas: { cantidad: number; total: number; neto: number };
  ocsObuma?: { folio: string; proveedor: string | null; estado: string | null; fecha: string | null; neto: number; total: number; skus: string[]; lineas: { producto: string; sku: string | null; cantidad: number | null; precio: number | null; subtotal: number | null }[] }[];
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

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ResumenGastosCard({ negocioId }: { negocioId: number }) {
  const [facturaAbierta, setFacturaAbierta] = useState<string | null>(null);
  const toast = useToast();
  const [resumen, setResumen] = useState<ResumenGastos | null>(null);
  const [licitacionCodigo, setLicitacionCodigo] = useState<string | null>(null);
  const [cobertura, setCobertura] = useState<{ total: number; cubiertos: number; directos: number; sinCubrir: string[] } | null>(null);
  const [ocCliente, setOcCliente] = useState<{ numero: string | null; aceptadaAt: string | null; emitidaAt: string | null; monto: number | null } | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <div className="bg-white rounded-2xl border border-zinc-200 p-4 flex items-center gap-2 text-[12px] text-zinc-400"><Loader2 size={14} className="animate-spin" /> Cargando resumen de gasto…</div>;
  }
  if (!resumen) return null;

  // Neto, igual que lo costeado: antes se mostraba el total con IVA de las compras.
  const gastadoReal = resumen.ocCreadas.totalNeto || resumen.comprasCruzadas.neto || null;
  const sinDatos = resumen.ocCreadas.cantidad === 0 && resumen.comprasCruzadas.cantidad === 0;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <Receipt size={15} className="text-zinc-400" />
        <span className="text-[13px] font-bold text-zinc-700">Gasto real</span>
        {gastadoReal != null && (
          <span className="ml-auto text-[13px] font-bold text-zinc-800">{fmtCLP(gastadoReal)}</span>
        )}
      </div>

      {sinDatos ? (
        <p className="px-4 py-3 text-[11.5px] text-zinc-400">
          Todavía no hay órdenes de compra ni facturas cruzadas para este negocio.
        </p>
      ) : (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">OC creadas</p>
            <p className="text-[15px] font-bold text-zinc-800 mt-0.5">{fmtCLP(resumen.ocCreadas.totalNeto)}</p>
            <p className="text-[11px] text-zinc-400">{resumen.ocCreadas.cantidad} orden{resumen.ocCreadas.cantidad !== 1 ? 'es' : ''} emitida{resumen.ocCreadas.cantidad !== 1 ? 's' : ''} desde Licitank</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">Compras cruzadas</p>
            <p className="text-[15px] font-bold text-zinc-800 mt-0.5">{fmtCLP(resumen.comprasCruzadas.neto)}</p>
            <p className="text-[11px] text-zinc-400">{resumen.comprasCruzadas.cantidad} compra{resumen.comprasCruzadas.cantidad !== 1 ? 's' : ''} en Obuma, neto · {fmtCLP(resumen.comprasCruzadas.total)} con IVA</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">Facturas realizadas</p>
            <p className="text-[15px] font-bold text-zinc-800 mt-0.5">{fmtCLP(resumen.facturas.total)}</p>
            <p className="text-[11px] text-zinc-400">{resumen.facturas.cantidad} factura{resumen.facturas.cantidad !== 1 ? 's' : ''} real{resumen.facturas.cantidad !== 1 ? 'es' : ''} con XML</p>
          </div>
        </div>
      )}

      {cobertura && cobertura.total > 0 && (
        <div className="px-4 pb-3" data-testid="resumen-cobertura">
          <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 flex-wrap ${cobertura.cubiertos === cobertura.total ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
            <p className="text-[13px] font-bold text-zinc-800">
              Productos cubiertos: {cobertura.cubiertos} de {cobertura.total}
              {cobertura.directos > 0 && <span className="font-medium text-zinc-500"> · {cobertura.directos} por compra directa</span>}
            </p>
            {cobertura.sinCubrir.length > 0 && (
              <p className="text-[11.5px] text-amber-800 min-w-0 truncate" title={cobertura.sinCubrir.join(' · ')}>Faltan: {cobertura.sinCubrir.slice(0, 3).map(n => n.split(' - ')[0].slice(0, 40)).join(' · ')}{cobertura.sinCubrir.length > 3 ? ` y ${cobertura.sinCubrir.length - 3} más` : ''}</p>
            )}
          </div>
        </div>
      )}

      {(ocCliente || resumen.ocCreadas.proveedores.length > 0 || (resumen.ocsObuma?.length ?? 0) > 0 || (resumen.facturas.detalle?.length ?? 0) > 0) && (
        <div className="px-4 pb-3 space-y-3" data-testid="resumen-documentos">
          {ocCliente && (
            <div>
              <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Orden de compra del cliente</p>
              <p className="text-[12.5px] text-zinc-700">N° <b>{ocCliente.numero || '—'}</b>{ocCliente.monto != null && <> · {fmtCLP(ocCliente.monto)}</>}{ocCliente.aceptadaAt ? <> · aceptada el {ocCliente.aceptadaAt.slice(0, 10).split('-').reverse().join('-')}</> : ocCliente.emitidaAt ? <> · emitida el {ocCliente.emitidaAt.slice(0, 10).split('-').reverse().join('-')} (sin aceptar)</> : null}</p>
            </div>
          )}
          {(resumen.ocsObuma?.length ?? 0) > 0 && (
            <div data-testid="resumen-oc-obuma">
              <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Órdenes de compra y SKU realizados en Obuma <span className="normal-case font-medium text-zinc-400">· hechos directo, no desde Licitank</span></p>
              <div className="overflow-x-auto rounded-lg border border-sky-100">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="bg-sky-50/60 text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-1.5 font-semibold">Proveedor / OC</th>
                      <th className="px-3 py-1.5 font-semibold">Producto</th>
                      <th className="px-3 py-1.5 font-semibold whitespace-nowrap">SKU</th>
                      <th className="px-3 py-1.5 font-semibold text-right">Cant.</th>
                      <th className="px-3 py-1.5 font-semibold text-right whitespace-nowrap">P. unit. neto</th>
                      <th className="px-3 py-1.5 font-semibold text-right">Subtotal neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.ocsObuma!.map(o => (
                      (o.lineas.length ? o.lineas : [{ producto: '—', sku: null, cantidad: null, precio: null, subtotal: o.neto }]).map((l, i) => (
                        <tr key={`${o.folio}-${i}`} className={`align-top ${i === 0 ? 'border-t border-zinc-200' : 'border-t border-zinc-100'}`}>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {i === 0 && (
                              <>
                                <b className="text-zinc-800">{o.proveedor || 'Proveedor'}</b>
                                <span className="block text-[11px] text-zinc-400">
                                  OC {o.folio}{o.fecha ? ` · ${o.fecha.slice(0, 10).split('-').reverse().join('-')}` : ''}
                                  {o.estado && <span className="ml-1.5 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">{o.estado}</span>}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-700 min-w-[220px]" title={l.producto}>{l.producto.length > 110 ? `${l.producto.slice(0, 110)}…` : l.producto}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap font-semibold text-indigo-600 tabular-nums">{l.sku || <span className="text-zinc-300 font-normal">sin SKU</span>}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{l.cantidad ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{l.precio != null ? fmtCLP(l.precio) : '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-zinc-800">{fmtCLP(l.subtotal)}</td>
                        </tr>
                      ))
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {resumen.ocCreadas.proveedores.length > 0 && (
            <div>
              <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Órdenes de compra emitidas desde Licitank</p>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
                {resumen.ocCreadas.proveedores.map((o, i) => (
                  <li key={`${o.folio}-${i}`} className="px-3 py-1.5 flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate"><b className="text-zinc-800">{o.nombre}</b> <span className="text-zinc-400">· OC {o.folio || 's/folio'} · {o.fecha.split('-').reverse().join('-')}</span></span>
                    <span className="font-semibold text-zinc-800 tabular-nums">{fmtCLP(o.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(resumen.facturas.descartadas?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2" data-testid="resumen-facturas-descartadas">
              <p className="text-[10.5px] font-semibold text-amber-800 uppercase tracking-wide mb-1">Facturas que no se suman — revisar en Obuma</p>
              <ul className="space-y-1">
                {resumen.facturas.descartadas!.map((f, i) => (
                  <li key={`${f.folio}-${i}`} className="text-[12px] text-amber-900">
                    <b>{f.proveedor || 'Proveedor'}</b> · folio {f.folio} · {fmtCLP(f.total)} — {f.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(resumen.facturas.detalle?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Facturas de compra</p>
              <div className="overflow-x-auto rounded-lg border border-zinc-100">
                <table className="w-full text-[12px] border-collapse" data-testid="resumen-facturas-tabla">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-1.5 font-semibold">Proveedor</th>
                      <th className="px-3 py-1.5 font-semibold whitespace-nowrap">Folio</th>
                      <th className="px-3 py-1.5 font-semibold whitespace-nowrap">Fecha</th>
                      <th className="px-3 py-1.5 font-semibold whitespace-nowrap">OC Obuma</th>
                      <th className="px-3 py-1.5 font-semibold text-right whitespace-nowrap">Neto</th>
                      <th className="px-3 py-1.5 font-semibold text-right whitespace-nowrap">IVA</th>
                      <th className="px-3 py-1.5 font-semibold text-right whitespace-nowrap">Total</th>
                      <th className="px-3 py-1.5 font-semibold text-right">Ver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.facturas.detalle!.map((f, i) => {
                      const neto = f.total != null ? Math.round(f.total / 1.19) : null;
                      return (
                        <tr key={`${f.folio}-${i}`} className="border-t border-zinc-100">
                          <td className="px-3 py-1.5 font-semibold text-zinc-800">{f.proveedor || 'Proveedor'}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-zinc-600">{f.folio}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-zinc-600">{f.fecha ? f.fecha.slice(0, 10).split('-').reverse().join('-') : '—'}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-zinc-600">{f.ocFolio ? `OC ${f.ocFolio}` : '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{fmtCLP(neto)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{f.total != null && neto != null ? fmtCLP(f.total - neto) : '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-zinc-800">{fmtCLP(f.total)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
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
                    <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold text-zinc-800">
                      <td className="px-3 py-1.5" colSpan={4}>{resumen.facturas.cantidad} facturas</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtCLP(Math.round(resumen.facturas.total / 1.19))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtCLP(resumen.facturas.total - Math.round(resumen.facturas.total / 1.19))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtCLP(resumen.facturas.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {resumen.montoCosteado != null && gastadoReal != null && (
        <p className="px-4 pb-3 text-[11.5px] text-zinc-500">
          Costeado: <b className="text-zinc-700">{fmtCLP(resumen.montoCosteado)}</b>
          {resumen.variacionPct != null && (
            <span className={resumen.variacionPct > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>
              {' '}· {resumen.variacionPct > 0 ? '+' : ''}{resumen.variacionPct}% {resumen.variacionPct > 0 ? 'sobre lo presupuestado' : 'bajo lo presupuestado'}
            </span>
          )}
        </p>
      )}

      <div className="px-4 pb-4">
        {estadoProyecto === 'idle' && licitacionCodigo && (
          <button onClick={consultarProyecto}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
            <FolderSearch size={12} /> Ver gastos del Proyecto completo en Obuma
          </button>
        )}
        {estadoProyecto === 'cargando' && (
          <span className="text-[11px] text-zinc-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Consultando Obuma…</span>
        )}
        {estadoProyecto === 'error' && <span className="text-[11px] text-rose-500">No se pudo consultar Obuma ahora.</span>}
        {estadoProyecto === 'sin_datos' && <span className="text-[11px] text-zinc-400">Esta licitación todavía no tiene un centro de costo armado en Obuma.</span>}
        {estadoProyecto === 'ok' && proyecto && (
          <div className="text-[11.5px] text-zinc-600 bg-indigo-50/60 border border-indigo-100 rounded-lg px-3 py-2">
            <p><b>{fmtCLP(proyecto.totalOcNeto ?? Math.round(proyecto.totalOc / 1.19))}</b> neto · {fmtCLP(proyecto.totalOc)} con IVA, en {proyecto.cantidadOc} orden{proyecto.cantidadOc !== 1 ? 'es' : ''} de compra del Proyecto completo{proyecto.cantidadAnuladas ? ` (sin contar ${proyecto.cantidadAnuladas} anulada${proyecto.cantidadAnuladas !== 1 ? 's' : ''})` : ''}
              {proyecto.centrosDeCostoDelProyecto.length > 1 && <> ({proyecto.centrosDeCostoDelProyecto.length} centros de costo)</>}
            </p>
          </div>
        )}
      </div>
      {facturaAbierta && <FacturaVisor negocioId={negocioId} dteId={facturaAbierta} onCerrar={() => setFacturaAbierta(null)} />}
    </div>
  );
}
