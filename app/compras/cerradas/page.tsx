'use client';

// /compras/cerradas — menú «Compras cerradas», justo bajo «Compras» (pedido del dueño, 10-nov-2026).
// Los negocios que salieron de Compras, agrupados por mes de cierre (lo más reciente arriba): OC cancelada
// por el organismo (sale sola, compras-oc-cancelada.ts), entregadas y no realizadas (marca histórica) y
// pre-compras sin adjudicar. Solo lectura; «Reabrir» (jefe de ventas) lo devuelve a Compras.
// Skill licitank-ui: Encabezado, Indicador, Pestanas, Tarjeta + Datos, estados con punto, @container.
import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Boton } from '@/app/components/ui/kit/Boton';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { useToast } from '@/app/components/ui/toast';
import { IconSearch as Search, IconArchive as Archive, IconChevronDown as ChevronDown, IconBuilding as Building2, IconUsers as Users } from '@tabler/icons-react';

type Motivo = 'OC_CANCELADA' | 'ENTREGADA' | 'NO_REALIZADA' | 'PRECOMPRA_SIN_ADJUDICAR';
interface Cerrada {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; organismo: string | null;
  motivo: Motivo; nota: string | null; cerradaAt: string | null; cerradaPor: string | null;
  montoNuestro: number | null; encargado: string | null; postuladoPor: string | null; ganadoAt: string | null;
  cancelacion: { ocCodigo: string; canceladaAt: string | null; fundamento: string | null; fundamentadoPor: string | null; fundamentadoAt: string | null } | null;
}
type Pestana = 'todas' | Motivo;

const MOTIVOS: Record<Motivo, { etiqueta: string; color: string; clase: string }> = {
  OC_CANCELADA: { etiqueta: 'OC cancelada por el organismo', color: '#ef4444', clase: 'text-red-700 dark:text-red-400' },
  ENTREGADA: { etiqueta: 'Entregada', color: '#10b981', clase: 'text-emerald-700 dark:text-emerald-400' },
  NO_REALIZADA: { etiqueta: 'No realizada', color: '#94a3b8', clase: 'text-tinta-2 dark:text-slate-400' },
  PRECOMPRA_SIN_ADJUDICAR: { etiqueta: 'Pre-compra sin adjudicar', color: '#cbd5e1', clase: 'text-tinta-3' },
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LS = 'compras-cerradas-filtros';

const clp = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);
const fecha = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('-') : null);
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Fecha de cierre: la de cancelación que informa MP si la hay; si no, cuándo se marcó el cierre. */
const fechaCierre = (c: Cerrada) => c.cancelacion?.canceladaAt || c.cerradaAt?.slice(0, 10) || null;

export default function ComprasCerradasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [datos, setDatos] = useState<Cerrada[] | null>(null);
  const [puedeReabrir, setPuedeReabrir] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  // Filtros (se recuerdan entre visitas, como en Compras)
  const [pestana, setPestana] = useState<Pestana>('todas');
  const [q, setQ] = useState('');
  const [fOrg, setFOrg] = useState<string[]>([]);
  const [fEnc, setFEnc] = useState<string[]>([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [sinFundamento, setSinFundamento] = useState(false);
  const [hidratado, setHidratado] = useState(false);

  const p = usuario?.permisos;
  const puedeVer = !!(p?.compras_todo || p?.compras || p?.aprobar_comercial || p?.compras_administracion || p?.compras_bodega || p?.compras_ver || p?.compras_auditor);

  const cargar = useCallback(() => {
    fetch('/api/compras/cerradas')
      .then(async r => { const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo cargar'); setDatos(d.cerradas); setPuedeReabrir(!!d.puedeReabrir); })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(LS) || '{}');
      if (g.pestana) setPestana(g.pestana); if (g.q) setQ(g.q); if (Array.isArray(g.fOrg)) setFOrg(g.fOrg); if (Array.isArray(g.fEnc)) setFEnc(g.fEnc);
      if (g.desde) setDesde(g.desde); if (g.hasta) setHasta(g.hasta); if (g.sinFundamento) setSinFundamento(true);
    } catch { /* sin filtros guardados */ }
    setHidratado(true);
  }, []);
  useEffect(() => {
    if (!hidratado) return;
    try { localStorage.setItem(LS, JSON.stringify({ pestana, q, fOrg, fEnc, desde, hasta, sinFundamento })); } catch { /* cuota llena */ }
  }, [hidratado, pestana, q, fOrg, fEnc, desde, hasta, sinFundamento]);

  const todas = datos ?? [];
  const opciones = useMemo(() => {
    const cuenta = (vals: (string | null)[]) => {
      const m = new Map<string, number>();
      for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
      return [...m].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([value, count]) => ({ value, label: value, count }));
    };
    return { org: cuenta(todas.map(c => c.organismo)), enc: cuenta(todas.map(c => c.encargado)) };
  }, [todas]);

  // Todo menos la pestaña: así los contadores de las pestañas responden a los demás filtros.
  const filtradas = useMemo(() => {
    const t = sinTildes(q.trim());
    return todas.filter(c => {
      const f = fechaCierre(c);
      if (desde && (!f || f < desde)) return false;
      if (hasta && (!f || f > hasta)) return false;
      if (fOrg.length && !fOrg.includes(c.organismo || '')) return false;
      if (fEnc.length && !fEnc.includes(c.encargado || '')) return false;
      if (sinFundamento && !(c.cancelacion && !c.cancelacion.fundamento)) return false;
      if (t && !sinTildes([c.licitacionCodigo, c.licitacionNombre, c.organismo, c.encargado, c.postuladoPor, c.cancelacion?.ocCodigo, c.cancelacion?.fundamento, c.nota, String(c.negocioId)]
        .filter(Boolean).join(' ')).includes(t)) return false;
      return true;
    });
  }, [todas, q, fOrg, fEnc, desde, hasta, sinFundamento]);
  const visibles = useMemo(() => filtradas.filter(c => pestana === 'todas' || c.motivo === pestana), [filtradas, pestana]);

  const grupos = useMemo(() => {
    const orden = [...visibles].sort((a, b) => (fechaCierre(b) || '').localeCompare(fechaCierre(a) || '') || b.negocioId - a.negocioId);
    const m = new Map<string, Cerrada[]>();
    for (const c of orden) {
      const f = fechaCierre(c);
      const k = f ? f.slice(0, 7) : 'sin-fecha';
      m.set(k, [...(m.get(k) || []), c]);
    }
    return [...m].map(([k, items]) => ({
      k, items,
      titulo: k === 'sin-fecha' ? 'Sin fecha de cierre' : `${MESES[Number(k.slice(5, 7)) - 1]} de ${k.slice(0, 4)}`,
      monto: items.reduce((s, c) => s + (c.montoNuestro ?? 0), 0),
    }));
  }, [visibles]);

  const nMotivo = (m: Motivo) => filtradas.filter(c => c.motivo === m).length;
  const canceladas = todas.filter(c => c.motivo === 'OC_CANCELADA');
  const porFundamentar = todas.filter(c => c.cancelacion && !c.cancelacion.fundamento).length;
  const hayFiltro = !!q || fOrg.length > 0 || fEnc.length > 0 || !!desde || !!hasta || sinFundamento;
  const limpiar = () => { setQ(''); setFOrg([]); setFEnc([]); setDesde(''); setHasta(''); setSinFundamento(false); };

  const reabrir = async (c: Cerrada) => {
    if (!confirm(`¿Devolver ${c.licitacionCodigo} a Compras? Se quita el cierre «${MOTIVOS[c.motivo]?.etiqueta ?? c.motivo}».`)) return;
    try {
      const r = await fetch(`/api/compras/${c.negocioId}/cierre-legado`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo reabrir');
      toast.success('Volvió a Compras', c.licitacionCodigo);
      setAbierta(null);
      cargar();
    } catch (e: any) { toast.error('No se pudo reabrir', e.message); }
  };

  return (
    <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }, { label: 'Compras cerradas' }]}>
      <div className="@container max-w-6xl mx-auto px-4 py-6">
        <Encabezado titulo="Compras cerradas"
          descripcion="Los negocios que salieron de Compras, por fecha de cierre. Cuando el organismo cancela la orden de compra y no queda otra vigente, el negocio llega aquí solo y sus encargados tienen que fundamentar por qué." />

        {error ? (
          <Vacio titulo="No se pudieron cargar las compras cerradas" texto={error} accion={<Boton tamano="sm" onClick={() => { setError(null); cargar(); }}>Reintentar</Boton>} />
        ) : datos === null ? (
          <div className="grid gap-3"><TarjetaCargando /><TarjetaCargando /><TarjetaCargando /></div>
        ) : todas.length === 0 ? (
          <Vacio icono={<Archive size={28} />} titulo="No hay compras cerradas"
            texto="Aquí llegan los negocios cuya orden de compra cancela el organismo, y los que se marcan como entregados o no realizados." />
        ) : (
          <>
            <Lista className="grid grid-cols-2 @3xl:grid-cols-4 gap-3">
              <Indicador rotulo="Compras cerradas" valor={todas.length} detalle={`${nMotivo('ENTREGADA')} entregada${nMotivo('ENTREGADA') === 1 ? '' : 's'} con el filtro actual`} />
              <Indicador rotulo="OC canceladas por el organismo" valor={canceladas.length} detalle={porFundamentar ? `${porFundamentar} sin fundamentar` : 'todas fundamentadas'} />
              <Indicador rotulo="Monto adjudicado que se cayó" valor={canceladas.reduce((s, c) => s + (c.montoNuestro ?? 0), 0)} formato={clp} detalle="neto, de las OC canceladas" />
              <Indicador rotulo="En el filtro actual" valor={visibles.length} detalle={clp(visibles.reduce((s, c) => s + (c.montoNuestro ?? 0), 0))} />
            </Lista>

            <div className="mt-6">
              <Pestanas id="cerradas" valor={pestana} onCambio={setPestana} opciones={[
                { valor: 'todas', etiqueta: 'Todas', contador: filtradas.length },
                { valor: 'OC_CANCELADA', etiqueta: 'OC cancelada', contador: nMotivo('OC_CANCELADA') },
                { valor: 'ENTREGADA', etiqueta: 'Entregadas', contador: nMotivo('ENTREGADA') },
                { valor: 'NO_REALIZADA', etiqueta: 'No realizadas', contador: nMotivo('NO_REALIZADA') },
                { valor: 'PRECOMPRA_SIN_ADJUDICAR', etiqueta: 'Pre-compra sin adjudicar', contador: nMotivo('PRECOMPRA_SIN_ADJUDICAR') },
              ]} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="relative flex-1 min-w-[240px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Código, nombre, OC, encargado o fundamento"
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-linea bg-white text-sm text-tinta placeholder:text-tinta-3 focus:outline-none focus:ring-2 focus:ring-marca/40 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" />
              </label>
              {opciones.org.length > 0 && <MultiSelect label="Organismo" icon={<Building2 size={13} />} options={opciones.org} selected={fOrg} onChange={setFOrg} minWidth={260} />}
              {opciones.enc.length > 0 && <MultiSelect label="Encargado" icon={<Users size={13} />} options={opciones.enc} selected={fEnc} onChange={setFEnc} minWidth={220} />}
              <span className="flex items-center gap-2 text-xs text-tinta-2 dark:text-slate-400">
                Cerrada desde <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="h-9 px-2 rounded-lg border border-linea bg-white text-[13px] dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" />
                hasta <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="h-9 px-2 rounded-lg border border-linea bg-white text-[13px] dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" />
              </span>
              <button type="button" onClick={() => setSinFundamento(v => !v)} aria-pressed={sinFundamento}
                className={`h-9 px-3 rounded-lg border text-[13px] font-medium transition-colors duration-150 ${sinFundamento
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300'
                  : 'border-linea bg-white text-tinta-2 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>
                Sin fundamentar
              </button>
              {hayFiltro && <Boton variante="fantasma" tamano="sm" onClick={limpiar}>Limpiar filtros</Boton>}
            </div>

            {visibles.length === 0 ? (
              <div className="mt-5"><Vacio titulo="Ninguna compra cerrada calza con el filtro" texto="Cambia la búsqueda, las fechas o la pestaña." accion={hayFiltro ? <Boton tamano="sm" onClick={limpiar}>Limpiar filtros</Boton> : undefined} /></div>
            ) : (
              grupos.map(g => (
                <section key={g.k} className="mt-7">
                  <div className="mb-2.5 flex items-baseline justify-between gap-3">
                    <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 first-letter:uppercase">{g.titulo}</h2>
                    <span className="text-xs text-tinta-3 tabular-nums">{g.items.length} negocio{g.items.length === 1 ? '' : 's'} · {clp(g.monto)}</span>
                  </div>
                  <Lista className="grid gap-2.5">
                    <AnimatePresence initial={false}>
                      {g.items.map(c => (
                        <FilaCerrada key={c.negocioId} c={c} abierta={abierta === c.negocioId} puedeReabrir={puedeReabrir}
                          onAbrir={() => setAbierta(abierta === c.negocioId ? null : c.negocioId)} onReabrir={() => reabrir(c)} />
                      ))}
                    </AnimatePresence>
                  </Lista>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

function FilaCerrada({ c, abierta, puedeReabrir, onAbrir, onReabrir }: {
  c: Cerrada; abierta: boolean; puedeReabrir: boolean; onAbrir: () => void; onReabrir: () => void;
}) {
  const m = MOTIVOS[c.motivo] ?? { etiqueta: c.motivo, color: '#94a3b8', clase: 'text-tinta-2' };
  const faltaFundamento = !!c.cancelacion && !c.cancelacion.fundamento;
  return (
    <Tarjeta className="!p-0" layout>
      <button type="button" onClick={onAbrir} aria-expanded={abierta}
        className="w-full text-left px-4 py-3.5 rounded-xl transition-colors duration-150 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 grid grid-cols-[1fr_auto] @3xl:grid-cols-[1fr_210px_110px_130px_20px] items-center gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-[13px] text-tinta dark:text-slate-100 truncate" title={c.licitacionNombre ?? undefined}>
            <span className="font-semibold tabular-nums">{c.licitacionCodigo}</span>
            {c.licitacionNombre && <span className="text-tinta-2 dark:text-slate-400"> · {c.licitacionNombre}</span>}
          </p>
          <p className="text-xs text-tinta-3 truncate">{[c.organismo, c.encargado ? `encargado ${c.encargado}` : null].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        <div className="text-xs order-3 @3xl:order-none col-span-2 @3xl:col-span-1">
          <span className={m.clase}><Estado color={m.color}>{m.etiqueta}</Estado></span>
          {faltaFundamento && <p className="mt-0.5 text-amber-700 dark:text-amber-400">Falta el fundamento</p>}
        </div>
        <p className="hidden @3xl:block text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{fecha(fechaCierre(c)) ?? '—'}</p>
        <p className="text-right text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-100">{clp(c.montoNuestro)}</p>
        <ChevronDown size={16} className={`hidden @3xl:block text-slate-400 transition-transform duration-[250ms] ease-lk ${abierta ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {abierta && (
          <motion.div key="detalle" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_LK }} className="overflow-hidden">
            <div className="px-4 pb-4 border-t border-linea/80 dark:border-slate-800">
              {c.cancelacion && (
                <div className="pt-3">
                  <p className="text-[11px] text-tinta-2/80 dark:text-slate-400">Por qué se canceló</p>
                  {c.cancelacion.fundamento ? (
                    <>
                      <p className="mt-1 text-sm text-tinta dark:text-slate-100 whitespace-pre-line">{c.cancelacion.fundamento}</p>
                      <p className="mt-1 text-xs text-tinta-3">{[c.cancelacion.fundamentadoPor, fecha(c.cancelacion.fundamentadoAt)].filter(Boolean).join(' · ')}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">Todavía ningún encargado lo fundamentó. Les aparece un aviso que no se cierra hasta que lo hagan.</p>
                  )}
                </div>
              )}
              <Datos columnas={4}>
                <Dato rotulo="OC cancelada">{c.cancelacion?.ocCodigo}</Dato>
                <Dato rotulo="Fecha de cancelación">{fecha(c.cancelacion?.canceladaAt)}</Dato>
                <Dato rotulo="Cerrada">{[fecha(c.cerradaAt), c.cerradaPor].filter(Boolean).join(' · ') || undefined}</Dato>
                <Dato rotulo="Ganada el">{fecha(c.ganadoAt)}</Dato>
                <Dato rotulo="Encargado de Compras">{c.encargado}</Dato>
                <Dato rotulo="Postuló">{c.postuladoPor}</Dato>
                <Dato rotulo="Monto adjudicado (neto)">{c.montoNuestro != null ? clp(c.montoNuestro) : undefined}</Dato>
                <Dato rotulo="Negocio">{`#${c.negocioId}`}</Dato>
              </Datos>
              {c.nota && !c.cancelacion && <p className="mt-3 text-xs text-tinta-2 dark:text-slate-400 whitespace-pre-line">{c.nota}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/compras/${c.negocioId}`}
                  className="inline-flex items-center h-8 px-3 text-[13px] font-medium rounded-lg border border-linea dark:border-slate-700 text-tinta dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800">Ver el negocio en Compras</Link>
                {puedeReabrir && <Boton variante="fantasma" tamano="sm" onClick={onReabrir}>Reabrir en Compras</Boton>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Tarjeta>
  );
}
