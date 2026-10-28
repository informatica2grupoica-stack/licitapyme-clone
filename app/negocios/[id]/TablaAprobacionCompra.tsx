'use client';

// «QUÉ SE VA A APROBAR»: tabla línea por línea con lo que paga el cliente, lo costeado, lo que se compra y a quién, la diferencia, el
// margen, la ficha técnica y un veredicto con el motivo. Antes el jefe de ventas aprobaba mirando solo dos totales. Solo lectura:
// las decisiones siguen en los dos hitos de abajo.
import { useEffect, useState, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { irAFase, enfocarProducto } from '@/app/compras/[negocioId]/comprasNavegacion';
import { IconLoader2 as Loader2, IconCircleCheck as Ok, IconAlertTriangle as Alerta, IconCircleX as No, IconHelpCircle as Duda } from '@tabler/icons-react';
import type { TablaAprobacion, LineaAprobacion } from '@/app/lib/compras-aprobacion-tabla';
import { FichaAprobacionModal } from './FichaAprobacionModal';

const clp = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const corto = (d: string) => d.split(' - ')[0];

const ESTADO: Record<LineaAprobacion['estado'], { texto: string; clase: string }> = {
  PASA: { texto: 'Pasa', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REVISAR: { texto: 'Revisar', clase: 'bg-amber-50 text-amber-800 border-amber-200' },
  NO_PASA: { texto: 'No pasa', clase: 'bg-rose-50 text-rose-700 border-rose-200' },
};
// Las dos mitades del veredicto: precio (proveedor, pérdida, vs. costeado, margen) y ficha (comparación técnica con las bases).
const PARTE: Record<LineaAprobacion['estado'], { texto: string; punto: string }> = {
  PASA: { texto: 'OK', punto: 'bg-emerald-500' },
  REVISAR: { texto: 'por revisar', punto: 'bg-amber-500' },
  NO_PASA: { texto: 'no pasa', punto: 'bg-rose-500' },
};
function ParteVeredicto({ rotulo, estado }: { rotulo: string; estado: LineaAprobacion['estado'] | null }) {
  const p = estado ? PARTE[estado] : null;
  return (
    <span className="flex items-center gap-1.5 text-zinc-600 whitespace-nowrap">
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${p ? p.punto : 'bg-zinc-300'}`} />{rotulo}: <span className="font-semibold text-zinc-800">{p ? p.texto : 'sin proveedor'}</span>
    </span>
  );
}
const TECNICO: Record<string, { texto: string; clase: string }> = {
  CUMPLE: { texto: 'Cumple', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NO_CUMPLE: { texto: 'No cumple', clase: 'bg-rose-50 text-rose-700 border-rose-200' },
  FALTA_DATO: { texto: 'Falta dato', clase: 'bg-amber-50 text-amber-800 border-amber-200' },
  SIN_COMPARAR: { texto: 'Sin comparar', clase: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  SIN_FICHA: { texto: 'Sin ficha', clase: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  SIN_COMPRA: { texto: '—', clase: 'bg-zinc-50 text-zinc-400 border-zinc-200' },
};

interface DecisionLinea { estado: 'APROBADA' | 'RECHAZADA' | 'CORREGIDA'; comentario: string | null; porNombre: string | null; corregidoPorNombre?: string | null; notaCorreccion?: string | null }
const aDecision = (l: any): [number, DecisionLinea] => [l.productoId, { estado: l.estado, comentario: l.comentario, porNombre: l.porNombre, corregidoPorNombre: l.corregidoPorNombre, notaCorreccion: l.notaCorreccion }];

export function TablaAprobacionCompra({ negocioId, refresco, esJefeDeVentas, puedeOperar, compraEstado, onAprobarCompra, onRapidaCambio }: {
  negocioId: number; refresco: string; esJefeDeVentas: boolean; puedeOperar: boolean; compraEstado: string | null; onAprobarCompra: () => Promise<unknown> | void;
  /** Se llama tras aprobar/rechazar una compra rápida (para que la pantalla habilite el SKU y la OC de ese producto). */
  onRapidaCambio?: () => Promise<unknown> | void;
}) {
  const toast = useToast();
  // Aprobación POR PRODUCTO (migration-147): el jefe va aprobando cada línea y, con todas aprobadas, aprueba la compra completa con un botón.
  const [decisiones, setDecisiones] = useState<Record<number, DecisionLinea>>({});
  const [tablaLineasOk, setTablaLineasOk] = useState(true);
  const [rechazando, setRechazando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  // Encargado: producto del que está escribiendo «qué corregí» y el texto.
  const [corrigiendo, setCorrigiendo] = useState<number | null>(null);
  const [notaCorreccion, setNotaCorreccion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aprobandoCompra, setAprobandoCompra] = useState(false);
  const [tabla, setTabla] = useState<TablaAprobacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'TODAS' | 'PROBLEMAS'>('TODAS');
  const [fichaDe, setFichaDe] = useState<LineaAprobacion | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/aprobaciones/tabla`).then(r => r.json());
      if (d.success) { setTabla(d.tabla); setError(null); } else setError(d.error || 'No se pudo cargar');
    } catch (e: any) { setError(e.message || 'No se pudo cargar'); }
  }, [negocioId]);
  const cargarDecisiones = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/aprobaciones/linea`).then(r => r.json());
      if (!d.success) return;
      setTablaLineasOk(d.tablaOk !== false);
      setDecisiones(Object.fromEntries((d.lineas || []).map(aDecision)));
    } catch { /* sin decisiones: la tabla se ve igual */ }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar, refresco]);
  // También con `refresco`: si otra persona aprueba (o se restaura una aprobación) la tabla se recargaba sola pero las decisiones por producto no.
  useEffect(() => { cargarDecisiones(); }, [cargarDecisiones, refresco]);

  const decidir = async (productoIds: number[], decision: 'APROBAR' | 'RECHAZAR' | 'QUITAR', comentario?: string) => {
    setGuardando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/aprobaciones/linea`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoIds, decision, comentario: comentario || null }) }).then(x => x.json());
      if (!r.success) throw new Error(r.error || 'No se pudo guardar');
      setDecisiones(Object.fromEntries((r.lineas || []).map(aDecision)));
      setRechazando(null); setMotivo('');
    } catch (e: any) { toast.error('No se pudo guardar', e.message); }
    finally { setGuardando(false); }
  };
  // Compra rápida (tienda, sin cotización ni ficha): el jefe la aprueba o rechaza en la misma fila; aprobada, ese producto puede crear SKU y OC.
  const decidirRapida = async (productoId: number, decision: 'APROBAR' | 'RECHAZAR', comentario?: string) => {
    setGuardando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/compra-rapida`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId, decision, comentario: comentario || null }) }).then(x => x.json());
      if (!r.success) throw new Error(r.error || 'No se pudo guardar');
      setRechazando(null); setMotivo('');
      await cargar(); await onRapidaCambio?.();
      toast.success(decision === 'APROBAR' ? 'Compra rápida aprobada' : 'Compra rápida rechazada', decision === 'APROBAR' ? 'Ese producto ya puede crear su SKU y su OC.' : 'Le avisamos al encargado.');
    } catch (e: any) { toast.error('No se pudo guardar', e.message); }
    finally { setGuardando(false); }
  };
  // El encargado avisa que ya corrigió un producto rechazado: queda «Corregido» y el jefe de ventas recibe aviso para revisarlo de nuevo.
  const marcarCorregido = async (productoId: number) => {
    setGuardando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/aprobaciones/linea`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId, decision: 'CORREGIDO', comentario: notaCorreccion }) }).then(x => x.json());
      if (!r.success) throw new Error(r.error || 'No se pudo guardar');
      setDecisiones(Object.fromEntries((r.lineas || []).map(aDecision)));
      setCorrigiendo(null); setNotaCorreccion('');
      toast.success('Aviso enviado al jefe de ventas', 'Vuelve a revisar este producto.');
    } catch (e: any) { toast.error('No se pudo avisar', e.message); }
    finally { setGuardando(false); }
  };
  const irACorregir = (productoId: number, pestana: 'fichas' | 'cotizaciones') => { irAFase('costeo'); enfocarProducto(pestana, productoId); };
  useEffect(() => {
    const h = () => { cargar(); };
    window.addEventListener('compras:fichas-cambio', h);
    return () => window.removeEventListener('compras:fichas-cambio', h);
  }, [cargar]);

  if (error) return <p className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">No se pudo mostrar el detalle de lo que se aprueba: {error} <button onClick={cargar} className="underline font-semibold ml-1">Reintentar</button></p>;
  // Esqueleto con el alto aproximado de la tabla: antes un spinner chico dejaba subir las compuertas («0 de 2») y todo saltaba al cargar.
  if (!tabla) return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5" role="status" aria-live="polite" aria-label="Armando el detalle de lo que se aprueba">
      <p className="flex items-center gap-2 text-[12px] text-zinc-400"><Loader2 size={14} className="animate-spin" /> Armando el detalle de lo que se aprueba…</p>
      {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-9 rounded-lg bg-zinc-100 animate-pulse" />)}
    </div>
  );

  const t = tabla.totales;
  const conteo = { PASA: 0, REVISAR: 0, NO_PASA: 0 } as Record<string, number>;
  tabla.lineas.forEach(l => { conteo[l.estado]++; });
  const visibles = tabla.lineas.filter(l => filtro === 'TODAS' || l.estado !== 'PASA');
  const ventaTotal = t.venta, costoTotal = t.compra + t.flete;
  // Una compra rápida se decide con su propia aprobación (l.compraRapida.estado); el resto, con la aprobación por producto.
  const estadoDe = (l: LineaAprobacion): string | undefined => l.compraRapida ? (l.compraRapida.estado === 'PENDIENTE' ? undefined : l.compraRapida.estado) : decisiones[l.productoId]?.estado;
  const aprobados = tabla.lineas.filter(l => estadoDe(l) === 'APROBADA').length;
  const rechazados = tabla.lineas.filter(l => estadoDe(l) === 'RECHAZADA').length;
  const corregidos = tabla.lineas.filter(l => decisiones[l.productoId]?.estado === 'CORREGIDA').length;
  const sinDecidir = tabla.lineas.length - aprobados - rechazados;
  const todosAprobados = tabla.lineas.length > 0 && aprobados === tabla.lineas.length;
  const compraAprobada = compraEstado === 'APROBADA' || compraEstado === 'APROBADA_CON_MODIFICACION';
  const pasanSinDecidir = tabla.lineas.filter(l => l.estado === 'PASA' && !l.compraRapida && !decisiones[l.productoId]).map(l => l.productoId);

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
          {esJefeDeVentas && pasanSinDecidir.length > 0 && tablaLineasOk && (
            <button type="button" onClick={() => decidir(pasanSinDecidir, 'APROBAR')} disabled={guardando} data-testid="apr-aprobar-los-que-pasan"
              className="text-[11.5px] font-semibold text-emerald-800 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2.5 py-1 rounded-lg">Aprobar los {pasanSinDecidir.length} que pasan</button>
          )}
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
                <th className="px-2 py-2" title="Pasa = el precio Y la ficha técnica están bien. Debajo se ve cada uno por separado.">Veredicto</th>
                <th className="px-2 py-2 min-w-[190px]">Tu aprobación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visibles.map(l => {
                const e = ESTADO[l.estado], te = TECNICO[l.tecnico.estado];
                return (
                  <tr key={l.productoId} className={l.compraRapida?.estado === 'RECHAZADA' ? 'bg-rose-100 animate-pulse' : l.estado === 'NO_PASA' ? 'bg-rose-50/40' : ''} data-testid={`apr-linea-${l.productoId}`} data-producto-id={l.productoId}>
                    <td className="px-3 py-2 text-zinc-400 align-top">{l.linea ?? ''}</td>
                    <td className="px-2 py-2 align-top max-w-[260px]">
                      <p className="font-semibold text-zinc-800 leading-snug">{corto(l.descripcion)}</p>
                      {l.compraRapida && (
                        <p className={`mt-1 inline-block text-[11px] font-bold px-1.5 py-0.5 rounded border ${l.compraRapida.yaComprada ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`} data-testid={`apr-rapida-${l.productoId}`}
                          title={`${l.compraRapida.proveedor ?? ''} · RUT ${l.compraRapida.rut ?? ''} · ${clp(l.compraRapida.precio)} neto c/u`}>
                          ⚡ Compra rápida · {l.compraRapida.yaComprada ? 'Ya comprada' : 'Por comprar'} · {l.compraRapida.proveedor} · {clp(l.compraRapida.precio)}
                        </p>
                      )}
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
                      {l.proveedor && !['SIN_FICHA', 'SIN_COMPRA'].includes(l.tecnico.estado)
                        ? <button type="button" onClick={() => setFichaDe(l)} data-testid={`apr-ficha-${l.productoId}`} title="Ver la ficha y su comparación con las bases"
                            className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded border underline decoration-dotted underline-offset-2 hover:shadow-sm ${te.clase}`}>{te.texto}{l.tecnico.total > 0 ? ` ${l.tecnico.cumple}/${l.tecnico.total}` : ''}</button>
                        : <span className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded border ${te.clase}`}>{te.texto}</span>}
                      {l.tecnico.modelo && <span className="block text-[10.5px] text-zinc-400 mt-0.5">{l.tecnico.modelo}</span>}
                    </td>
                    <td className="px-2 py-2 align-top"><span className={`inline-flex items-center gap-1 text-[11.5px] font-bold px-2 py-0.5 rounded-full border ${e.clase}`}>{l.estado === 'NO_PASA' ? <No size={12} /> : l.estado === 'REVISAR' ? <Alerta size={12} /> : <Ok size={12} />}{e.texto}</span>
                      {/* Qué dijo cada parte: el «Pasa» solo no decía si era por el precio o por la ficha (28-oct-2026). */}
                      <span className="mt-1 block space-y-0.5 text-[11px] leading-snug" data-testid={`apr-partes-${l.productoId}`}>
                        <ParteVeredicto rotulo="Precio" estado={l.porPrecio} />
                        <ParteVeredicto rotulo="Ficha" estado={l.porFicha} />
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top" data-testid={`apr-decision-${l.productoId}`}>
                      {(() => {
                        if (l.compraRapida) {
                          const r = l.compraRapida;
                          if (r.estado === 'APROBADA') return (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">{r.yaComprada ? '✔ Ratificada' : '✔ Aprobada'}</span>
                              {esJefeDeVentas && rechazando !== l.productoId && (
                                <button type="button" onClick={() => { setRechazando(l.productoId); setMotivo(''); }} disabled={guardando} data-testid={`apr-deshacer-${l.productoId}`} className="block text-[11px] font-semibold text-rose-700 underline">Deshacer aprobación</button>
                              )}
                              {esJefeDeVentas && rechazando === l.productoId && (
                                <div className="space-y-1">
                                  <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Qué está errado?" autoFocus className="w-full text-[11.5px] border border-rose-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-rose-400" />
                                  <div className="flex items-center gap-1.5">
                                    <button type="button" onClick={() => decidirRapida(l.productoId, 'RECHAZAR', motivo)} disabled={guardando || !motivo.trim()} className="text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 px-2 py-1 rounded-lg">Deshacer y rechazar</button>
                                    <button type="button" onClick={() => { setRechazando(null); setMotivo(''); }} className="text-[11px] text-zinc-500">Cancelar</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                          if (r.estado === 'RECHAZADA') return (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-300">✖ Rechazada</span>
                              {r.comentario && <span className="block text-[11px] text-rose-700 leading-snug">{r.comentario}</span>}
                              <span className="block text-[11px] text-zinc-500">{puedeOperar ? 'Corrígela y reenvíala desde Costeo → Productos.' : 'El encargado debe corregirla.'}</span>
                            </div>
                          );
                          if (!esJefeDeVentas) return <span className="text-[11.5px] text-zinc-400">Pendiente del jefe de ventas</span>;
                          if (rechazando === l.productoId) return (
                            <div className="space-y-1">
                              <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué se rechaza?" autoFocus className="w-full text-[11.5px] border border-rose-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-rose-400" />
                              <div className="flex items-center gap-1.5">
                                <button type="button" onClick={() => decidirRapida(l.productoId, 'RECHAZAR', motivo)} disabled={guardando || !motivo.trim()} className="text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 px-2 py-1 rounded-lg">Rechazar</button>
                                <button type="button" onClick={() => { setRechazando(null); setMotivo(''); }} className="text-[11px] text-zinc-500">Cancelar</button>
                              </div>
                            </div>
                          );
                          return (
                            <div className="flex items-center gap-1.5">
                              <button type="button" onClick={() => decidirRapida(l.productoId, 'APROBAR')} disabled={guardando} className="text-[11.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-2.5 py-1 rounded-lg">{r.yaComprada ? 'Ratificar' : 'Aprobar'}</button>
                              <button type="button" onClick={() => { setRechazando(l.productoId); setMotivo(''); }} disabled={guardando} className="text-[11.5px] font-semibold text-rose-700 border border-rose-300 hover:bg-rose-50 disabled:opacity-40 px-2.5 py-1 rounded-lg">Rechazar</button>
                            </div>
                          );
                        }
                        const d = decisiones[l.productoId];
                        if (d?.estado === 'CORREGIDA') return (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300">↻ Corregido: por revisar</span>
                            {d.comentario && <span className="block text-[11px] text-rose-700 leading-snug">Se rechazó por: {d.comentario}</span>}
                            <span className="block text-[11px] text-zinc-600 leading-snug"><b>{d.corregidoPorNombre || 'El encargado'}</b> dice: {d.notaCorreccion}</span>
                            {!esJefeDeVentas && <span className="block text-[11px] text-zinc-400">Esperando que el jefe de ventas lo revise de nuevo</span>}
                            {esJefeDeVentas && rechazando !== l.productoId && (
                              <div className="flex items-center gap-1.5 pt-0.5">
                                <button type="button" onClick={() => decidir([l.productoId], 'APROBAR')} disabled={guardando} className="text-[11.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-2.5 py-1 rounded-lg">Aprobar</button>
                                <button type="button" onClick={() => { setRechazando(l.productoId); setMotivo(''); }} disabled={guardando} className="text-[11.5px] font-semibold text-rose-700 border border-rose-300 hover:bg-rose-50 disabled:opacity-40 px-2.5 py-1 rounded-lg">Rechazar</button>
                              </div>
                            )}
                            {esJefeDeVentas && rechazando === l.productoId && (
                              <div className="space-y-1">
                                <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Qué sigue mal?" autoFocus className="w-full text-[11.5px] border border-rose-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-rose-400" />
                                <div className="flex items-center gap-1.5">
                                  <button type="button" onClick={() => decidir([l.productoId], 'RECHAZAR', motivo)} disabled={guardando || !motivo.trim()} className="text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 px-2 py-1 rounded-lg">Rechazar</button>
                                  <button type="button" onClick={() => { setRechazando(null); setMotivo(''); }} className="text-[11px] text-zinc-500">Cancelar</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                        if (d) return (
                          <div className="space-y-0.5">
                            <span className={`inline-flex items-center gap-1 text-[11.5px] font-bold px-2 py-0.5 rounded-full border ${d.estado === 'APROBADA' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>{d.estado === 'APROBADA' ? '✔ Aprobado' : '✖ Rechazado'}</span>
                            {d.comentario && <span className="block text-[11px] text-zinc-500 leading-snug">{d.comentario}</span>}
                            {d.estado === 'RECHAZADA' && puedeOperar && (
                              <div className="space-y-1 pt-0.5" data-testid={`apr-corregir-${l.productoId}`}>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <button type="button" onClick={() => irACorregir(l.productoId, 'fichas')} className="text-[11px] font-semibold text-teal-800 border border-teal-300 bg-teal-50 hover:bg-teal-100 px-2 py-1 rounded-lg">Corregir ficha</button>
                                  <button type="button" onClick={() => irACorregir(l.productoId, 'cotizaciones')} className="text-[11px] font-semibold text-teal-800 border border-teal-300 bg-teal-50 hover:bg-teal-100 px-2 py-1 rounded-lg">Corregir cotización</button>
                                </div>
                                {corrigiendo === l.productoId ? (
                                  <div className="space-y-1">
                                    <input value={notaCorreccion} onChange={e => setNotaCorreccion(e.target.value)} placeholder="¿Qué corregiste? (obligatorio)" autoFocus className="w-full text-[11.5px] border border-amber-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-amber-400" />
                                    <div className="flex items-center gap-1.5">
                                      <button type="button" onClick={() => marcarCorregido(l.productoId)} disabled={guardando || !notaCorreccion.trim()} className="text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 px-2 py-1 rounded-lg">Enviar al jefe</button>
                                      <button type="button" onClick={() => { setCorrigiendo(null); setNotaCorreccion(''); }} className="text-[11px] text-zinc-500">Cancelar</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => { setCorrigiendo(l.productoId); setNotaCorreccion(''); }} className="text-[11px] font-semibold text-amber-800 border border-amber-300 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg">Ya corregí: volver a revisar</button>
                                )}
                              </div>
                            )}
                            {esJefeDeVentas && <button type="button" onClick={() => decidir([l.productoId], 'QUITAR')} disabled={guardando} className="block text-[11px] text-zinc-400 hover:text-zinc-700 underline decoration-dotted">Deshacer</button>}
                          </div>
                        );
                        if (!esJefeDeVentas) return <span className="text-[11.5px] text-zinc-400">Pendiente del jefe de ventas</span>;
                        if (rechazando === l.productoId) return (
                          <div className="space-y-1">
                            <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué se rechaza?" autoFocus
                              className="w-full text-[11.5px] border border-rose-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-rose-400" />
                            <div className="flex items-center gap-1.5">
                              <button type="button" onClick={() => decidir([l.productoId], 'RECHAZAR', motivo)} disabled={guardando || !motivo.trim()} className="text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 px-2 py-1 rounded-lg">Rechazar</button>
                              <button type="button" onClick={() => { setRechazando(null); setMotivo(''); }} className="text-[11px] text-zinc-500">Cancelar</button>
                            </div>
                          </div>
                        );
                        return (
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => decidir([l.productoId], 'APROBAR')} disabled={guardando || !tablaLineasOk} className="text-[11.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-2.5 py-1 rounded-lg">Aprobar</button>
                            <button type="button" onClick={() => { setRechazando(l.productoId); setMotivo(''); }} disabled={guardando || !tablaLineasOk} className="text-[11.5px] font-semibold text-rose-700 border border-rose-300 hover:bg-rose-50 disabled:opacity-40 px-2.5 py-1 rounded-lg">Rechazar</button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
              {visibles.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-zinc-400">Ninguna línea con observaciones.</td></tr>}
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
                <td className="px-2 py-2" colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Cierre: con todos los productos aprobados, la compra completa se aprueba con UN botón */}
      <div className={`rounded-xl border-2 px-4 py-3 flex items-center gap-4 flex-wrap ${compraAprobada ? 'border-emerald-300 bg-emerald-50' : todosAprobados ? 'border-teal-400 bg-teal-50/60' : 'border-zinc-200 bg-zinc-50'}`} data-testid="apr-cierre">
        <div className="flex-1 min-w-[240px]">
          <p className="text-[15px] font-extrabold text-zinc-900 tabular-nums">{aprobados} de {tabla.lineas.length} productos aprobados</p>
          <p className="text-[12.5px] text-zinc-600">
            {!tablaLineasOk ? 'Falta aplicar la migración 147 para aprobar producto por producto (node scripts/aplicar-migration-147.mjs).'
              : compraAprobada ? '✔ La compra completa ya está aprobada.'
              : corregidos > 0 && esJefeDeVentas ? `${corregidos} producto(s) corregido(s) esperan tu revisión: apruébalos o recházalos de nuevo.`
              : rechazados > 0 ? `Hay ${rechazados} producto(s) rechazado(s): corrígelos (o deshaz el rechazo) antes de aprobar la compra completa.`
              : sinDecidir > 0 ? `Faltan ${sinDecidir} por aprobar. Apruébalos uno a uno arriba, o usa «Aprobar los que pasan».`
              : compraEstado !== 'PENDIENTE' ? 'Todos aprobados. Falta que el encargado envíe la propuesta (Paso A, más abajo).'
              : 'Todos los productos están aprobados: ya puedes aprobar la compra completa.'}
          </p>
        </div>
        {esJefeDeVentas && !compraAprobada && (
          <button type="button" disabled={!todosAprobados || compraEstado !== 'PENDIENTE' || aprobandoCompra} data-testid="apr-aprobar-compra-completa"
            onClick={async () => { setAprobandoCompra(true); try { await onAprobarCompra(); } finally { setAprobandoCompra(false); } }}
            className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-lg">
            {aprobandoCompra && <Loader2 size={14} className="animate-spin" />} Aprobar la compra completa
          </button>
        )}
      </div>
      {fichaDe?.proveedor && (
        <FichaAprobacionModal negocioId={negocioId} productoId={fichaDe.productoId} producto={corto(fichaDe.descripcion)} proveedor={fichaDe.proveedor}
          proveedorRut={fichaDe.compraRapida?.proveedor === fichaDe.proveedor ? fichaDe.compraRapida.rut : null}
          compraUnit={fichaDe.compraUnit} costeadoUnit={fichaDe.costeadoUnit} puedeOperar={puedeOperar} onClose={() => setFichaDe(null)} />
      )}
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
