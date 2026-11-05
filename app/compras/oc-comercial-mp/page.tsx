'use client';

// /compras/oc-comercial-mp — menú «OC Comercial MP» (pedido del dueño, 05-nov-2026): todas las órdenes de compra que Comercial MP
// emite desde Licitank (migration-180, compras_oc_propia), de todas las licitaciones, con su licitación, ítems y factura.
// Solo lectura: emitir, subir la factura y anular se hacen en el negocio (Compras → Órdenes y facturas → paso 1).
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_LK } from '@/app/components/ui/kit/movimiento';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { Encabezado, TarjetaCargando, Vacio } from '@/app/components/ui/kit/Estructura';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Tarjeta, Datos, Dato, Estado } from '@/app/components/ui/kit/Tarjeta';
import { IconSearch as Search, IconFileInvoice as FileInvoice, IconChevronDown as ChevronDown } from '@tabler/icons-react';

interface Oc {
  id: number; folio: string; estado: 'EMITIDA' | 'FACTURADA' | 'ANULADA'; fechaOc: string; fechaEntrega: string | null;
  proveedor: { nombre: string; rut: string };
  items: { productoId: number | null; codigo: string | null; descripcion: string; cantidad: number; precio: number }[];
  neto: number; iva: number; total: number; formaPago: string | null; direccionDespacho: string | null; condiciones: string | null;
  factura: { folio: string | null; fecha: string | null; neto: number | null; total: number | null; url: string | null; nombre: string | null; emparejo: string | null; subidaPor: string | null; subidaAt: string | null } | null;
  anuladaMotivo: string | null; creadoPor: string | null; createdAt: string;
  negocioId: number; licitacionCodigo: string | null; licitacionNombre: string | null;
}
type Filtro = 'todas' | 'EMITIDA' | 'FACTURADA' | 'ANULADA';

const clp = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`;
const fecha = (s: string | null) => {
  if (!s) return null;
  const [a, m, d] = s.slice(0, 10).split('-');
  return a && m && d ? `${d}-${m}-${a}` : s;
};
const EMPAREJO: Record<string, string> = { REFERENCIA: 'la factura cita la OC', MONTO: 'mismo neto, confirmado a mano', MANUAL: 'PDF, datos ingresados a mano' };
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function EstadoOc({ oc }: { oc: Oc }) {
  if (oc.estado === 'FACTURADA') return <span className="text-emerald-700 dark:text-emerald-400"><Estado color="#10b981">Facturada</Estado></span>;
  if (oc.estado === 'ANULADA') return <span className="text-tinta-3"><Estado color="#cbd5e1">Anulada</Estado></span>;
  return <span className="text-amber-700 dark:text-amber-400"><Estado color="#f59e0b">Esperando la factura</Estado></span>;
}

export default function OcComercialMpPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [ocs, setOcs] = useState<Oc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [abierta, setAbierta] = useState<number | null>(null);

  const puedeVer = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial || !!usuario?.permisos?.compras_ver || !!usuario?.permisos?.compras_auditor;

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    fetch('/api/compras/oc-comercial-mp')
      .then(async r => { const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo cargar'); setOcs(d.ocs); })
      .catch(e => setError(e.message));
  }, [cargandoSesion, puedeVer, router]);

  const porFecha = useMemo(() => (ocs ?? []).filter(o => (!desde || o.fechaOc >= desde) && (!hasta || o.fechaOc <= hasta)), [ocs, desde, hasta]);
  const visibles = useMemo(() => {
    const t = sinTildes(q.trim());
    return porFecha.filter(o => (filtro === 'todas' || o.estado === filtro) && (!t || sinTildes([
      o.folio, o.licitacionCodigo, o.licitacionNombre, o.proveedor.nombre, o.proveedor.rut, o.factura?.folio, String(o.negocioId),
      ...o.items.map(i => `${i.codigo ?? ''} ${i.descripcion}`),
    ].filter(Boolean).join(' ')).includes(t)));
  }, [porFecha, filtro, q]);

  const vigentes = porFecha.filter(o => o.estado !== 'ANULADA');
  const esperando = porFecha.filter(o => o.estado === 'EMITIDA');
  const facturadas = porFecha.filter(o => o.estado === 'FACTURADA');
  const sumaVisibles = visibles.filter(o => o.estado !== 'ANULADA').reduce((s, o) => s + o.total, 0);

  return (
    <AppLayout breadcrumb={[{ label: 'OC Comercial MP' }]}>
      <div className="@container max-w-6xl mx-auto px-4 py-6">
        <Encabezado titulo="Órdenes de compra de Comercial MP"
          descripcion="Las OC que Comercial MP emite desde Licitank, de todas las licitaciones, con su factura. Se emiten, se facturan y se anulan dentro de cada negocio, en Compras → Órdenes y facturas." />

        {error ? (
          <Vacio titulo="No se pudieron cargar las órdenes de compra" texto={error} />
        ) : ocs === null ? (
          <div className="grid gap-3"><TarjetaCargando /><TarjetaCargando /><TarjetaCargando /></div>
        ) : ocs.length === 0 ? (
          <Vacio icono={<FileInvoice size={28} />} titulo="Todavía no hay órdenes de compra de Comercial MP"
            texto="Se emiten desde un negocio de Comercial MP: Compras → Órdenes y facturas → paso 1 → «Nueva OC». Aparecen aquí apenas se emiten." />
        ) : (
          <>
            <Lista className="grid grid-cols-2 @3xl:grid-cols-4 gap-3">
              <Indicador rotulo="Órdenes emitidas" valor={vigentes.length} detalle={`${porFecha.length - vigentes.length} anulada${porFecha.length - vigentes.length === 1 ? '' : 's'}`} />
              <Indicador rotulo="Total comprado (con IVA)" valor={vigentes.reduce((s, o) => s + o.total, 0)} formato={clp} detalle={`neto ${clp(vigentes.reduce((s, o) => s + o.neto, 0))}`} />
              <Indicador rotulo="Esperando la factura" valor={esperando.length} detalle={`${clp(esperando.reduce((s, o) => s + o.total, 0))} por facturar`} />
              <Indicador rotulo="Facturado" valor={facturadas.reduce((s, o) => s + (o.factura?.total ?? 0), 0)} formato={clp} detalle={`${facturadas.length} factura${facturadas.length === 1 ? '' : 's'}`} />
            </Lista>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Pestanas id="oc-mp" valor={filtro} onCambio={setFiltro} opciones={[
                { valor: 'todas', etiqueta: 'Todas', contador: porFecha.length },
                { valor: 'EMITIDA', etiqueta: 'Esperando factura', contador: esperando.length },
                { valor: 'FACTURADA', etiqueta: 'Facturadas', contador: facturadas.length },
                { valor: 'ANULADA', etiqueta: 'Anuladas', contador: porFecha.length - vigentes.length },
              ]} />
              <label className="relative flex-1 min-w-[220px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Folio, licitación, proveedor, producto o factura"
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-linea bg-white text-sm text-tinta placeholder:text-tinta-3 focus:outline-none focus:ring-2 focus:ring-marca/40 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" />
              </label>
              <span className="flex items-center gap-2 text-xs text-tinta-2 dark:text-slate-400">
                Desde <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="h-9 px-2 rounded-lg border border-linea bg-white text-[13px] dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" />
                hasta <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="h-9 px-2 rounded-lg border border-linea bg-white text-[13px] dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" />
              </span>
            </div>
            <p className="mt-3 text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
              {visibles.length} orden{visibles.length === 1 ? '' : 'es'} · {clp(sumaVisibles)} con IVA{visibles.some(o => o.estado === 'ANULADA') ? ' (sin contar anuladas)' : ''}
            </p>

            {visibles.length === 0 ? (
              <div className="mt-3"><Vacio titulo="Ninguna orden calza con el filtro" texto="Cambia la búsqueda, las fechas o la pestaña." /></div>
            ) : (
              <Lista className="mt-3 grid gap-2.5">
                <AnimatePresence initial={false}>
                  {visibles.map(oc => <FilaOc key={oc.id} oc={oc} abierta={abierta === oc.id} onAbrir={() => setAbierta(abierta === oc.id ? null : oc.id)} />)}
                </AnimatePresence>
              </Lista>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

function FilaOc({ oc, abierta, onAbrir }: { oc: Oc; abierta: boolean; onAbrir: () => void }) {
  const dif = oc.factura?.neto != null ? Math.round(oc.factura.neto - oc.neto) : null;
  return (
    <Tarjeta className="!p-0">
      <button type="button" onClick={onAbrir} aria-expanded={abierta}
        className="w-full text-left px-4 py-3.5 rounded-xl transition-colors duration-150 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 grid grid-cols-[1fr_auto] @3xl:grid-cols-[150px_1fr_170px_150px_20px] items-center gap-x-4 gap-y-1">
        <div>
          <p className="text-[13px] font-semibold text-tinta dark:text-slate-100 tabular-nums">{oc.folio}</p>
          <p className="text-xs text-tinta-3 tabular-nums">{fecha(oc.fechaOc)}</p>
        </div>
        <div className="min-w-0 order-3 @3xl:order-none col-span-2 @3xl:col-span-1">
          <p className="text-[13px] text-tinta dark:text-slate-100 truncate" title={oc.licitacionNombre ?? undefined}>
            <span className="font-medium tabular-nums">{oc.licitacionCodigo ?? `Negocio ${oc.negocioId}`}</span>
            {oc.licitacionNombre && <span className="text-tinta-2 dark:text-slate-400"> · {oc.licitacionNombre}</span>}
          </p>
          <p className="text-xs text-tinta-3 truncate">{oc.proveedor.nombre} · {oc.items.length} producto{oc.items.length === 1 ? '' : 's'}</p>
        </div>
        <div className="text-xs order-4 @3xl:order-none"><EstadoOc oc={oc} />{oc.factura?.folio && <p className="text-tinta-3 mt-0.5 tabular-nums">factura {oc.factura.folio}</p>}</div>
        <div className="text-right">
          <p className={`text-[13px] font-semibold tabular-nums ${oc.estado === 'ANULADA' ? 'text-tinta-3 line-through' : 'text-tinta dark:text-slate-100'}`}>{clp(oc.total)}</p>
          <p className="text-xs text-tinta-3 tabular-nums">neto {clp(oc.neto)}</p>
        </div>
        <ChevronDown size={16} className={`hidden @3xl:block text-slate-400 transition-transform duration-[250ms] ease-lk ${abierta ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
      {abierta && (
        <motion.div key="detalle" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE_LK }} className="overflow-hidden">
        <div className="px-4 pb-4 border-t border-linea/80 dark:border-slate-800">
          <div className="pt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] text-tinta-2 dark:text-slate-400 text-left">
                  <th className="py-1.5 pr-3 font-normal">Código</th><th className="py-1.5 pr-3 font-normal">Producto</th>
                  <th className="py-1.5 pr-3 font-normal text-right">Cantidad</th><th className="py-1.5 pr-3 font-normal text-right">Precio neto</th>
                  <th className="py-1.5 font-normal text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {oc.items.map((it, i) => (
                  <tr key={i} className="border-t border-linea/60 dark:border-slate-800">
                    <td className="py-1.5 pr-3 text-tinta-2 dark:text-slate-400">{it.codigo ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-tinta dark:text-slate-100">{it.descripcion}</td>
                    <td className="py-1.5 pr-3 text-right">{it.cantidad.toLocaleString('es-CL')}</td>
                    <td className="py-1.5 pr-3 text-right">{clp(it.precio)}</td>
                    <td className="py-1.5 text-right font-medium">{clp(it.cantidad * it.precio)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="tabular-nums">
                <tr className="border-t border-linea dark:border-slate-700"><td colSpan={4} className="pt-2 pr-3 text-right text-tinta-2 dark:text-slate-400">Neto</td><td className="pt-2 text-right">{clp(oc.neto)}</td></tr>
                <tr><td colSpan={4} className="pr-3 text-right text-tinta-2 dark:text-slate-400">IVA 19 %</td><td className="text-right">{clp(oc.iva)}</td></tr>
                <tr><td colSpan={4} className="pr-3 text-right text-tinta dark:text-slate-100 font-medium">Total</td><td className="text-right font-semibold">{clp(oc.total)}</td></tr>
              </tfoot>
            </table>
          </div>

          <Datos columnas={4}>
            <Dato rotulo="Proveedor"><span title={`${oc.proveedor.nombre} · ${oc.proveedor.rut}`}>{`${oc.proveedor.nombre} · ${oc.proveedor.rut}`}</span></Dato>
            <Dato rotulo="Fecha de entrega">{fecha(oc.fechaEntrega)}</Dato>
            <Dato rotulo="Forma de pago">{oc.formaPago}</Dato>
            <Dato rotulo="Emitida por">{oc.creadoPor}</Dato>
            <Dato rotulo="Despacho">{oc.direccionDespacho && <span title={oc.direccionDespacho}>{oc.direccionDespacho}</span>}</Dato>
            <Dato rotulo="Negocio">{`#${oc.negocioId}`}</Dato>
            {oc.estado === 'ANULADA' && <Dato rotulo="Motivo de anulación">{oc.anuladaMotivo && <span title={oc.anuladaMotivo}>{oc.anuladaMotivo}</span>}</Dato>}
          </Datos>

          {oc.factura && (
            <Datos columnas={4}>
              <Dato rotulo="Factura">{oc.factura.folio}</Dato>
              <Dato rotulo="Fecha de la factura">{fecha(oc.factura.fecha)}</Dato>
              <Dato rotulo="Neto / total facturado">{`${clp(oc.factura.neto)} / ${clp(oc.factura.total)}`}</Dato>
              <Dato rotulo="Diferencia con la OC (neto)">
                {dif == null ? undefined : dif === 0
                  ? <span className="text-emerald-700 dark:text-emerald-400">Cuadra</span>
                  : <span className="text-amber-700 dark:text-amber-400">{dif > 0 ? '+' : ''}{clp(dif)}</span>}
              </Dato>
              <Dato rotulo="Cómo se emparejó">{oc.factura.emparejo ? EMPAREJO[oc.factura.emparejo] ?? oc.factura.emparejo : undefined}</Dato>
              <Dato rotulo="Subida por">{[oc.factura.subidaPor, fecha(oc.factura.subidaAt)].filter(Boolean).join(' · ') || undefined}</Dato>
            </Datos>
          )}

          {oc.condiciones && <p className="mt-3 text-xs text-tinta-2 dark:text-slate-400 whitespace-pre-line">{oc.condiciones}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <a href={`/api/compras/oc-comercial-mp?pdf=${oc.id}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center h-8 px-3 text-[13px] font-medium rounded-lg border border-linea dark:border-slate-700 text-tinta dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800">Ver PDF de la OC</a>
            {oc.factura?.url && (
              <a href={oc.factura.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center h-8 px-3 text-[13px] font-medium rounded-lg border border-linea dark:border-slate-700 text-tinta dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800">Ver la factura</a>
            )}
            <Link href={`/compras/${oc.negocioId}`}
              className="inline-flex items-center h-8 px-3 text-[13px] font-medium rounded-lg text-marca hover:bg-marca-suave">Ir al negocio en Compras</Link>
          </div>
        </div>
        </motion.div>
      )}
      </AnimatePresence>
    </Tarjeta>
  );
}
