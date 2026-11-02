'use client';

// ANALÍTICA DE COMPRAS — todo el módulo en una pantalla: lo ganado, cómo van las entregas, quién carga con qué,
// de dónde vienen los negocios, tiempos del proceso OC, tareas, gastos, proveedores, incidencias y resultado.
// Solo lectura. Datos: app/lib/compras-analitica.ts. Sistema de diseño: skill licitank-ui (sin pastillas, sin
// degradados, paleta teal/pizarra/ámbar/cian/verde/naranja/rosa/piedra) y reglas de dataviz (una sola escala,
// marcas finas con extremo redondeado, 2 px entre segmentos, color por entidad y no por posición).
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { Banner } from '@/app/components/ui/Banner';
import { useRealtime } from '@/app/lib/use-realtime';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Encabezado, Seccion } from '@/app/components/ui/kit/Estructura';
import { IconArrowLeft as ArrowLeft, IconChartBar as BarChart3, IconLoader2 as Loader2 } from '@tabler/icons-react';
import type { AnaliticaCompras, ClaveEstadoEntrega } from '@/app/lib/compras-analitica';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtMes = (m: string) => { const [y, mo] = m.split('-'); return `${MESES[Number(mo) - 1]} ${y.slice(2)}`; };
const fmtM = (n: number) => (Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1).replace('.', ',')}M` : Math.abs(n) >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);
const fmtN = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n));
const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%`);

// Paleta categórica en orden fijo (teal, pizarra, ámbar, cian, verde, naranja, rosa, piedra) y colores de estado reservados.
const COLOR = { teal: '#0f766e', pizarra: '#64748b', ambar: '#d97706', cian: '#0891b2', verde: '#16a34a', naranja: '#ea580c', rosa: '#e11d48', piedra: '#78716c' };
const ESTADO: Record<ClaveEstadoEntrega, { label: string; color: string }> = {
  ENTREGADA: { label: 'Entregadas', color: COLOR.verde },
  EN_PLAZO: { label: 'En plazo', color: COLOR.teal },
  ENTREGA_VENCIDA: { label: 'Entrega vencida', color: COLOR.rosa },
  ESPERANDO_OC: { label: 'Esperando la OC', color: COLOR.ambar },
  SIN_PLAZO: { label: 'Sin plazo calculable', color: COLOR.piedra },
  PRECOMPRA: { label: 'Pre-compras', color: COLOR.pizarra },
  NO_REALIZADA: { label: 'No realizadas', color: '#d4d4d8' },
};
const EJE = { fontSize: 12, fill: '#71717a' };

function Tarjeta({ titulo, sub, children, className = '' }: { titulo: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800 px-5 py-4 ${className}`}>
      <h3 className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">{titulo}</h3>
      {sub && <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">{sub}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SinDatos({ texto = 'Todavía no hay datos para este gráfico.' }: { texto?: string }) {
  return <p className="text-sm text-tinta-3 py-8 text-center">{texto}</p>;
}

interface Punto { nombre: string; valor: number; color?: string; detalle?: string }

// Barras horizontales: una escala, extremo redondeado, valor al final de cada barra y detalle en el tooltip.
function BarrasH({ datos, formato, color = COLOR.teal, ancho = 132 }: { datos: Punto[]; formato: (n: number) => string; color?: string; ancho?: number }) {
  if (!datos.length) return <SinDatos />;
  return (
    <div style={{ height: datos.length * 34 + 12 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nombre" width={ancho} tick={EJE} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={{ fill: 'rgba(100,116,139,0.08)' }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as Punto;
            return (
              <div className="rounded-lg border border-linea bg-white px-3 py-2 shadow-flotante text-xs">
                <div className="font-medium text-tinta">{p.nombre}</div>
                <div className="tabular-nums text-tinta-2">{formato(p.valor)}</div>
                {p.detalle && <div className="text-tinta-3 mt-0.5">{p.detalle}</div>}
              </div>
            );
          }} />
          <Bar dataKey="valor" barSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {datos.map((d, i) => <Cell key={i} fill={d.color ?? color} />)}
            <LabelList dataKey="valor" position="right" formatter={(v: unknown) => formato(Number(v))} style={{ fontSize: 12, fill: '#3f3f46', fontVariantNumeric: 'tabular-nums' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Barras apiladas horizontales con 2 px de separación entre segmentos (tareas, incidencias).
function ApiladasH({ datos, series }: { datos: Array<Record<string, number | string>>; series: Array<{ key: string; label: string; color: string }> }) {
  if (!datos.length) return <SinDatos />;
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
        {series.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-tinta-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <div style={{ height: datos.length * 34 + 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke="#f4f4f5" />
            <XAxis type="number" tick={EJE} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="nombre" width={132} tick={EJE} tickLine={false} axisLine={false} interval={0} />
            <Tooltip cursor={{ fill: 'rgba(100,116,139,0.08)' }} contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 12 }} />
            {series.map(s => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} barSize={14} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function AnaliticaComprasPage() {
  const router = useRouter();
  const { usuario, cargando: cargandoSesion } = useSession();
  const [a, setA] = useState<AnaliticaCompras | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const permitido = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.aprobar_comercial || !!usuario?.permisos?.compras_ver;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/compras/analitica');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar la analítica');
      setA(data.analitica);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la analítica');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!permitido) { router.replace('/compras'); return; }
    cargar();
  }, [cargandoSesion, permitido, router, cargar]);
  useRealtime(cargar);

  if (cargandoSesion || !permitido) {
    return <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }]}><div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div></AppLayout>;
  }

  const avanceTareas = a && a.kpis.tareasTotal > 0 ? Math.round((a.kpis.tareasHechas / a.kpis.tareasTotal) * 100) : 0;

  return (
    <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }, { label: 'Analítica' }]}>
      <div className="@container p-4 sm:p-6 max-w-7xl mx-auto">
        <Encabezado
          titulo="Analítica de Compras"
          descripcion="Qué se ganó, cómo van las entregas y quién lleva cada negocio. Se actualiza sola cuando llega o se acepta una OC."
          acciones={
            <>
              <Link href="/compras" className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-lg border border-linea bg-white text-tinta shadow-tarjeta hover:bg-slate-50 transition-colors">
                <ArrowLeft size={15} /> Volver a Compras
              </Link>
              <Link href="/compras/dashboard" className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-lg border border-linea bg-white text-tinta shadow-tarjeta hover:bg-slate-50 transition-colors">
                <BarChart3 size={15} /> Dashboard
              </Link>
            </>
          }
        />

        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}
        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {a && (
          <div className="space-y-8">
            <Lista className="grid grid-cols-1 @xl:grid-cols-3 gap-3">
              <Indicador rotulo="Negocios en Compras" valor={a.kpis.negocios} detalle={`${a.kpis.urgentes} de entrega rápida`} />
              <Indicador rotulo="Entregas vencidas" valor={a.kpis.entregasVencidas} detalle={`${a.kpis.esperandoOC} esperando la OC`} />
              <Indicador rotulo="Avance de tareas" valor={avanceTareas} formato={n => `${n}%`} detalle={`${fmtN(a.kpis.tareasHechas)} de ${fmtN(a.kpis.tareasTotal)} · ${fmtN(a.kpis.tareasVencidas)} vencidas`} />
            </Lista>

            <Seccion titulo="Lo ganado">
              <div className="grid grid-cols-1 @4xl:grid-cols-[1.4fr_1fr] gap-4">
                <Tarjeta titulo="Monto ganado por mes" sub="Neto, según la fecha de adjudicación. El detalle del mes muestra cuántos negocios fueron.">
                  {a.porMes.length === 0 ? <SinDatos /> : (
                    <div style={{ height: 260 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={a.porMes.map(m => ({ mes: fmtMes(m.mes), monto: m.monto, n: m.n }))} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                          <CartesianGrid vertical={false} stroke="#f4f4f5" />
                          <XAxis dataKey="mes" tick={EJE} tickLine={false} axisLine={{ stroke: '#e4e4e7' }} />
                          <YAxis tick={EJE} tickLine={false} axisLine={false} tickFormatter={fmtM} width={56} />
                          <Tooltip cursor={{ fill: 'rgba(100,116,139,0.08)' }} content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as { mes: string; monto: number; n: number };
                            return (
                              <div className="rounded-lg border border-linea bg-white px-3 py-2 shadow-flotante text-xs">
                                <div className="font-medium text-tinta capitalize">{p.mes}</div>
                                <div className="tabular-nums text-tinta-2">{fmtM(p.monto)} · {p.n} negocio{p.n === 1 ? '' : 's'}</div>
                              </div>
                            );
                          }} />
                          <Bar dataKey="monto" fill={COLOR.teal} barSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                            <LabelList dataKey="n" position="top" formatter={(v: unknown) => `${v}`} style={{ fontSize: 11, fill: '#71717a' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Tarjeta>
                <Tarjeta titulo="Estado de la entrega" sub="Cuántos negocios hay en cada situación, hoy.">
                  <BarrasH formato={fmtN} ancho={150}
                    datos={a.estadoEntrega.map(e => ({ nombre: ESTADO[e.clave].label, valor: e.n, color: ESTADO[e.clave].color, detalle: `${fmtM(e.monto)} en juego` }))} />
                </Tarjeta>
              </div>
            </Seccion>

            <Seccion titulo="Quién y dónde">
              <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-4">
                <Tarjeta titulo="Monto por encargado" sub="Neto de los negocios que lleva cada persona.">
                  <BarrasH formato={fmtM} color={COLOR.pizarra}
                    datos={a.porEncargado.map(e => ({ nombre: e.nombre, valor: e.monto, detalle: `${e.negocios} negocio${e.negocios === 1 ? '' : 's'} · ${e.tareasVencidas} tareas vencidas` }))} />
                </Tarjeta>
                <Tarjeta titulo="Monto por comuna o región" sub="Las 8 con más monto; el resto va junto.">
                  <BarrasH formato={fmtM} color={COLOR.cian}
                    datos={a.porLugar.map(l => ({ nombre: l.lugar, valor: l.monto, detalle: `${l.n} negocio${l.n === 1 ? '' : 's'}` }))} />
                </Tarjeta>
              </div>
            </Seccion>

            <Seccion titulo="Proceso de la orden de compra">
              <div className="grid grid-cols-1 @3xl:grid-cols-3 gap-3">
                <Tarjeta titulo="De la adjudicación a la OC" sub="Promedio en días corridos, solo con OC recibida.">
                  <p className="text-[28px] font-semibold tracking-tight tabular-nums text-tinta">{a.tiempos.adjudicacionAOC != null ? `${String(a.tiempos.adjudicacionAOC).replace('.', ',')} d` : '—'}</p>
                </Tarjeta>
                <Tarjeta titulo="De la OC a su aceptación" sub="Promedio en días corridos, solo OC ya aceptadas.">
                  <p className="text-[28px] font-semibold tracking-tight tabular-nums text-tinta">{a.tiempos.ocAAceptacion != null ? `${String(a.tiempos.ocAAceptacion).replace('.', ',')} d` : '—'}</p>
                </Tarjeta>
                <Tarjeta titulo="OC recibidas" sub="Negocios con y sin OC del cliente.">
                  <BarrasH formato={fmtN} ancho={90} datos={[
                    { nombre: 'Con OC', valor: a.tiempos.conOC, color: COLOR.teal },
                    { nombre: 'Sin OC', valor: a.tiempos.sinOC, color: COLOR.ambar },
                  ]} />
                </Tarjeta>
              </div>
            </Seccion>

            <Seccion titulo="Tareas e incidencias">
              <div className="grid grid-cols-1 @4xl:grid-cols-[1.4fr_1fr] gap-4">
                <Tarjeta titulo="Tareas por categoría" sub="Hechas, en curso, pendientes y vencidas de los negocios activos.">
                  <ApiladasH
                    series={[
                      { key: 'hechas', label: 'Hechas', color: COLOR.teal },
                      { key: 'enCurso', label: 'En curso', color: COLOR.cian },
                      { key: 'pendientes', label: 'Pendientes', color: COLOR.piedra },
                      { key: 'vencidas', label: 'Vencidas', color: COLOR.rosa },
                    ]}
                    datos={a.tareasPorCategoria.map(t => ({ nombre: t.categoria, hechas: t.hechas, enCurso: t.enCurso, pendientes: t.pendientes, vencidas: t.vencidas }))} />
                </Tarjeta>
                <Tarjeta titulo="Incidencias" sub="Por naturaleza: abiertas y cerradas.">
                  <ApiladasH
                    series={[{ key: 'abiertas', label: 'Abiertas', color: COLOR.ambar }, { key: 'cerradas', label: 'Cerradas', color: COLOR.pizarra }]}
                    datos={a.incidencias.map(i => ({ nombre: i.naturaleza, abiertas: i.abiertas, cerradas: i.cerradas }))} />
                </Tarjeta>
              </div>
            </Seccion>

            <Seccion titulo="Dinero">
              <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-4">
                <Tarjeta titulo="Compras por proveedor" sub="Órdenes de compra emitidas, neto. Los 8 con más monto.">
                  <BarrasH formato={fmtM} color={COLOR.naranja} ancho={150}
                    datos={a.proveedores.map(p => ({ nombre: p.nombre, valor: p.monto, detalle: `${p.ordenes} orden${p.ordenes === 1 ? '' : 'es'} de compra` }))} />
                </Tarjeta>
                <Tarjeta titulo="Gastos adicionales por categoría" sub="Lo registrado como gasto extra de los negocios.">
                  <BarrasH formato={fmtM} color={COLOR.ambar} ancho={150} datos={a.gastos.map(g => ({ nombre: g.categoria, valor: g.monto }))} />
                </Tarjeta>
              </div>
              {a.resultados && (
                <Lista className="grid grid-cols-2 @3xl:grid-cols-4 gap-3 mt-4">
                  <Indicador rotulo="Margen estimado" valor={Math.round((a.resultados.margenEstimadoPct ?? 0) * 10)} formato={n => fmtPct(a.resultados!.margenEstimadoPct == null ? null : n / 10)} detalle={`${a.resultados.negociosRealCompleto} negocios con costo real completo`} />
                  <Indicador rotulo="Margen real" valor={Math.round((a.resultados.margenRealPct ?? 0) * 10)} formato={n => fmtPct(a.resultados!.margenRealPct == null ? null : n / 10)} detalle="Solo sobre costo real completo" />
                  <Indicador rotulo="Utilidad real" valor={a.resultados.utilidadRealTotal} formato={fmtM} detalle={`${a.resultados.cerrados} negocios cerrados`} />
                  <Indicador rotulo="Con desvío de costo" valor={a.resultados.conDesvio} detalle={`${a.resultados.conUtilidadNegativa} con utilidad negativa`} />
                </Lista>
              )}
            </Seccion>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
