'use client';

// «PROYECTOS (OBUMA)» — pedido explícito del dueño (22-sep-2026): «ver si tenemos lo mismo de Obuma… para hacer una
// comparación». Todo sale por API real de Obuma (ext-proyectos + centros de costo + comprasOc + compras), sin login.
// Ver app/lib/compras-proyectos-obuma.ts.
//
// Rediseñada el 2026-11-20 (licitank-ui) y revisada contra Obuma «al 100 %» (pedido del dueño: «con todos los gastos y OC»):
//  · Las OC ANULADAS ya no se suman como gasto (antes sumaban $164 M en 29 proyectos): se muestran aparte.
//  · Todo en NETO, como la ficha del Proyecto (presupuesto, costo y precio son netos); el «con IVA» va al lado.
//  · «Facturado real» pasó a llamarse «Gasto contabilizado»: son facturas de COMPRA, no lo facturado al cliente
//    (eso es «Facturado al cliente», de la ficha).
//  · Cada proyecto lista TODAS sus OC y todos sus documentos de gasto (facturas, boletas, gastos propios, notas de crédito).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Tarjeta, Dato, Estado } from '@/app/components/ui/kit/Tarjeta';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import {
  IconLoader2 as Loader2, IconSearch as Search, IconX as X, IconExternalLink as ExternalLink,
  IconChevronDown as ChevronDown, IconRefresh as RefreshCw, IconFileSpreadsheet as FileSpreadsheet,
  IconFolders as Folders, IconLink as LinkIcon,
} from '@tabler/icons-react';

interface NegocioCoincidente { negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; aproximado?: boolean; estadoCompra?: string | null }
interface OcDelProyecto {
  compraOcId: string; folio: string | null; fecha: string | null; estado: string | null;
  proveedorNombre: string | null; proveedorRut: string | null; total: number; neto?: number;
}
interface DocumentoDelProyecto {
  folio: string; tipo: string; proveedorNombre: string | null; total: number; neto?: number;
  observacion: string | null; fecha: string | null;
}
interface ResumenOc { cantidad: number; neto: number; total: number }
interface ItemOc { nombre: string; cantidad: number; precioUnitario: number; subtotal: number }
type EstadoItems = { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; items: ItemOc[] };

interface ProyectoObuma {
  proyectoId: string; tieneProyectoReal: boolean; folio: number | null;
  nombre: string | null; referencia: string | null; cliente: string | null;
  presupuesto: number | null; costo: number | null; precioNeto: number | null; facturadoMonto: number | null;
  estado: string | null; fechaIngreso: string | null; fechaInicio: string | null;
  centros: { id: string; nombre: string; codigo: string; activo: boolean }[];
  totalGastado: number; cantidadOc: number; totalFacturado: number; cantidadFacturas: number;
  negociosCoincidentes: NegocioCoincidente[];
  ocs: OcDelProyecto[]; ocsTruncadas: boolean; ordenFecha: string | null;
  documentos: DocumentoDelProyecto[];
  ocVigentes?: ResumenOc; ocPendientes?: ResumenOc; ocAnuladas?: { cantidad: number; total: number };
  documentosNeto?: number; documentosTruncados?: boolean;
  ocEnOtroCentro?: { codigo: string; cantidad: number; neto: number; ocs: (OcDelProyecto & { centroNombre: string | null })[] };
}
interface MetaProyectos {
  totalReportadoPorObuma: number | null; totalConFicha: number; completo: boolean; fuentesConError: string[];
  generadoAt?: string; leidoDeObuma?: { oc: number; documentos: number; proyectos: number };
}

// «Sin ficha» = centros de costo de Obuma que no son un proyecto (administración, gasto general): acumulan miles de OC y
// mezclarlos con los proyectos inflaba los totales, por eso van en su propia pestaña y no entran en «Todos».
const SIN_FICHA = 'Centros sin proyecto';
// Proyectos de prueba del equipo («TEST», «CLIENTE DE PRUEBAS»): no son negocios y desfasaban los conteos de Canceladas.
const PRUEBAS = 'Pruebas';
const esPrueba = (p: ProyectoObuma) => p.tieneProyectoReal && (/\b(test|prueba)/i.test(p.nombre || '') || /\bpruebas?\b/i.test(p.cliente || ''));
// Color por estado: ámbar = en curso, cian = abierto, gris = cerrado, rojo = cancelado/rechazado (no se concretó).
const COLOR_ESTADO: Record<string, string> = {
  'En proceso': '#d97706', Abierto: '#0891b2', Cerrado: '#64748b', Cancelado: '#dc2626', Rechazado: '#dc2626', [SIN_FICHA]: '#94a3b8', [PRUEBAS]: '#94a3b8',
};
const ORDEN_ESTADOS = ['En proceso', 'Abierto', 'Cerrado', 'Cancelado', 'Rechazado', PRUEBAS, SIN_FICHA];
const estadoDe = (p: ProyectoObuma) => (!p.tieneProyectoReal ? SIN_FICHA : esPrueba(p) ? PRUEBAS : (p.estado || 'Sin estado'));

// Estado de la compra en Compras y qué estado de Obuma le corresponde. Si no coinciden, hay que corregir uno de los dos.
const ETIQUETA_COMPRA: Record<string, string> = {
  PRECOMPRA: 'Pre-compra', ABIERTA: 'Abierta', EN_PROCESO: 'En proceso', ENTREGADA: 'Entregada', CERRADA: 'Cerrada', PAGADA: 'Pagada', CANCELADA: 'Cancelada',
};
const OBUMA_ESPERADO: Record<string, string[]> = {
  ABIERTA: ['Abierto'], EN_PROCESO: ['En proceso'], ENTREGADA: ['En proceso'], CERRADA: ['Cerrado'], PAGADA: ['Cerrado'], CANCELADA: ['Cancelado', 'Rechazado'],
};
/** Negocios del proyecto cuyo estado en Compras no calza con el del proyecto en Obuma. */
const desfaseCompras = (p: ProyectoObuma) => !p.tieneProyectoReal ? [] : p.negociosCoincidentes.filter(n => {
  const esperado = n.estadoCompra ? OBUMA_ESPERADO[n.estadoCompra] : null;
  return esperado && !esperado.includes(p.estado || '');
});

// Estado de la OC en Obuma: FACTURADA ya está en los documentos de compra; EMITIDA/SOLICITADA es plata comprometida sin factura;
// ANULADA no es gasto (ni se suma).
const COLOR_OC: Record<string, string> = { FACTURADA: '#16a34a', EMITIDA: '#d97706', SOLICITADA: '#d97706', ANULADA: '#dc2626' };
const nombreEstadoOc = (e: string | null) => { const t = (e || '').toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : 'Sin estado'; };

// Tipo de documento de compra (códigos del SII que usa Obuma). 0 = gasto propio sin documento (horas extras, retiros…).
const TIPO_DOC: Record<string, string> = {
  '0': 'Gasto propio', '32': 'Factura exenta', '33': 'Factura', '34': 'Factura exenta', '35': 'Boleta', '38': 'Boleta exenta',
  '39': 'Boleta electrónica', '41': 'Boleta exenta electrónica', '43': 'Liquidación-factura', '52': 'Guía de despacho',
  '56': 'Nota de débito', '61': 'Nota de crédito', '914': 'Declaración de ingreso (DIN)',
};

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
// Montos grandes de los indicadores: «$1.919 MM». Las tarjetas muestran el monto exacto.
const fmtMM = (n: number) => Math.abs(n) < 1_000_000 ? fmtCLP(n) : `$${Math.round(n / 1_000_000).toLocaleString('es-CL')} MM`;
const fmtFecha = (s: string | null | undefined) => {
  const d = dayjs(s ?? ''); if (!d.isValid()) return '';
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', ...(d.year() === dayjs().year() ? {} : { year: 'numeric' }) }).format(d.toDate()).replace('.', '');
};
const sumar = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((s, x) => s + f(x), 0);

// Link real al documento de la OC en Obuma — patrón confirmado en vivo (22-sep-2026, el usuario copió el link real del botón
// "Ver PDF" y se verificó contra la API que `id` = compra_oc_id). Pide sesión iniciada en Obuma, como cualquier link a otro sistema.
const urlOcEnObuma = (compraOcId: string) => `https://app.obuma.cl/obuma2.0/mod-compras/oc/iframe-main.php?id=${compraOcId}`;

const POR_TANDA = 25;

export default function ProyectosObumaPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [proyectos, setProyectos] = useState<ProyectoObuma[]>([]);
  const [meta, setMeta] = useState<MetaProyectos | null>(null);
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [q, setQ] = useState('');
  const [soloCoincidentes, setSoloCoincidentes] = useState(false);
  const [estadoFiltro, setEstadoFiltro] = useState('');
  // Cuántas tarjetas se ven: se reinicia solo cuando cambia algún filtro (la firma va junto al número, sin efectos).
  const [tanda, setTanda] = useState({ firma: '', n: POR_TANDA });

  const puedeVer = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial || !!usuario?.permisos?.compras_ver || !!usuario?.permisos?.compras_auditor;

  const cargar = useCallback(async (forzar = false) => {
    if (forzar) setActualizando(true); else setLoading(true);
    try {
      const res = await fetch(`/api/compras/proyectos-obuma${forzar ? '?forzar=1' : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProyectos(data.proyectos || []);
      setMeta(data.meta || null);
      if (forzar) toast.success('Datos de Obuma actualizados', 'Se volvió a leer todo desde Obuma.');
    } catch (e) {
      toast.error('No se pudieron cargar los proyectos de Obuma', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false); setActualizando(false);
    }
  }, [toast]);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  const exportar = async () => {
    setExportando(true);
    try {
      const res = await fetch('/api/compras/proyectos-obuma/exportar');
      if (!res.ok) throw new Error('No se pudo generar el Excel');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `proyectos-obuma-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('No se pudo exportar a Excel', e instanceof Error ? e.message : String(e));
    } finally {
      setExportando(false);
    }
  };

  // Búsqueda + «solo los que están en Licitank»; las pestañas de estado cuentan sobre ESTO (para que el número de cada pestaña sea el que verás).
  const base = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return proyectos.filter(p => {
      if (soloCoincidentes && p.negociosCoincidentes.length === 0) return false;
      if (!texto) return true;
      const campos = [p.nombre, p.referencia, p.cliente, ...p.centros.map(c => c.nombre), ...p.negociosCoincidentes.map(n => n.licitacionCodigo)];
      return campos.some(v => (v || '').toLowerCase().includes(texto));
    });
  }, [proyectos, q, soloCoincidentes]);

  const conteoEstados = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of base) c[estadoDe(p)] = (c[estadoDe(p)] || 0) + 1;
    return c;
  }, [base]);

  // «Todos» = los proyectos con ficha; los centros de costo sueltos solo se ven en su pestaña.
  const filtrados = useMemo(() => base.filter(p => (estadoFiltro ? estadoDe(p) === estadoFiltro : p.tieneProyectoReal)), [base, estadoFiltro]);
  const totalConFicha = useMemo(() => base.filter(p => p.tieneProyectoReal).length, [base]);

  // Indicadores sobre lo que se ve (cada cifra dice de qué conjunto es).
  const totales = useMemo(() => ({
    ocNeto: sumar(filtrados, p => p.ocVigentes?.neto ?? 0),
    ocCant: sumar(filtrados, p => p.ocVigentes?.cantidad ?? 0),
    anuladasCant: sumar(filtrados, p => p.ocAnuladas?.cantidad ?? 0),
    anuladasTotal: sumar(filtrados, p => p.ocAnuladas?.total ?? 0),
    pendNeto: sumar(filtrados, p => p.ocPendientes?.neto ?? 0),
    pendCant: sumar(filtrados, p => p.ocPendientes?.cantidad ?? 0),
    docsNeto: sumar(filtrados, p => p.documentosNeto ?? 0),
    docsCant: sumar(filtrados, p => p.cantidadFacturas),
    conNegocio: filtrados.filter(p => p.negociosCoincidentes.length > 0).length,
    desfases: filtrados.filter(p => desfaseCompras(p).length > 0).length,
  }), [filtrados]);

  const firma = `${q}|${soloCoincidentes}|${estadoFiltro}`;
  const visibles = tanda.firma === firma ? tanda.n : POR_TANDA;

  const hayFiltros = q.trim() !== '' || soloCoincidentes || estadoFiltro !== '';
  const limpiar = () => { setQ(''); setSoloCoincidentes(false); setEstadoFiltro(''); };

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Proyectos (Obuma)' }]}>
        <div className="p-6 flex items-center justify-center text-tinta-3"><Loader2 className="animate-spin" size={20} /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Proyectos (Obuma)' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Proyectos (Obuma)"
          descripcion="Lo que Obuma tiene de cada proyecto: su ficha, las órdenes de compra y los gastos contabilizados. Los montos son netos (sin IVA), igual que la ficha, salvo donde dice «con IVA»."
          acciones={
            <>
              <Boton onClick={exportar} disabled={exportando || loading} title="Exportar todos los proyectos y sus órdenes de compra a Excel"
                icono={exportando ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} stroke={1.75} />}>
                {exportando ? 'Exportando…' : 'Exportar'}
              </Boton>
              <Boton onClick={() => cargar(true)} disabled={actualizando || loading} title="Volver a leer Obuma ahora (ignora lo guardado)"
                icono={<RefreshCw size={16} stroke={1.75} className={actualizando ? 'animate-spin' : ''} />}>
                {actualizando ? 'Actualizando…' : 'Actualizar'}
              </Boton>
            </>
          }
        />

        {loading ? (
          <>
            <p className="mb-4 text-[13px] text-tinta-2 dark:text-slate-400 max-w-2xl">
              Leyendo Obuma: proyectos, centros de costo, órdenes de compra y documentos de compra de toda la cuenta. La primera vez
              toma un rato; después queda guardado y abre al tiro.
            </p>
            <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-linea bg-white dark:bg-slate-900 px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
                  <Esqueleto className="h-3 w-24" /><Esqueleto className="mt-3 h-7 w-28" />
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-linea bg-white dark:bg-slate-900 px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
                  <Esqueleto className="h-4 w-2/3" /><Esqueleto className="mt-2 h-3 w-1/3" />
                  <div className="mt-4 grid grid-cols-4 gap-3"><Esqueleto className="h-8" /><Esqueleto className="h-8" /><Esqueleto className="h-8" /><Esqueleto className="h-8" /></div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {meta && (
              meta.completo ? (
                <Banner variante="success" className="mb-4">
                  {meta.totalReportadoPorObuma != null
                    ? <>Están los {meta.totalConFicha} de {meta.totalReportadoPorObuma} proyectos que Obuma dice tener</>
                    : <>Sin problemas al consultar Obuma</>}
                  {meta.leidoDeObuma && <> y se leyeron completas sus {meta.leidoDeObuma.oc.toLocaleString('es-CL')} órdenes de compra y {meta.leidoDeObuma.documentos.toLocaleString('es-CL')} documentos de compra</>}
                  {meta.generadoAt && <> (datos de {dayjs(meta.generadoAt).format('D MMM · HH:mm')}; «Actualizar» vuelve a leer Obuma)</>}.
                </Banner>
              ) : (
                <Banner variante="warning" className="mb-4" accion={{ label: 'Actualizar', onClick: () => cargar(true), cargando: actualizando }}>
                  {meta.totalReportadoPorObuma != null && meta.totalConFicha !== meta.totalReportadoPorObuma
                    && <>Obuma dice tener {meta.totalReportadoPorObuma} proyectos, pero solo se pudieron traer {meta.totalConFicha}. </>}
                  {meta.fuentesConError.length > 0 && <>Fuentes que fallaron esta vez: {meta.fuentesConError.join(', ')}. </>}
                  Las cifras de abajo pueden estar incompletas.
                </Banner>
              )
            )}

            {/* Indicadores del conjunto que se ve */}
            <Lista className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
              <Indicador rotulo="Proyectos" valor={filtrados.length}
                detalle={`${totales.conNegocio} están en Licitank${totales.desfases ? ` · ${totales.desfases} con estado distinto en Compras` : ''}${hayFiltros ? ' · del filtro actual' : ''}`} />
              <Indicador rotulo="OC vigentes (neto)" valor={totales.ocNeto} formato={fmtMM}
                detalle={`${totales.ocCant.toLocaleString('es-CL')} OC · sin ${totales.anuladasCant} anuladas (${fmtMM(totales.anuladasTotal)})`} />
              <Indicador rotulo="Comprometido sin factura (neto)" valor={totales.pendNeto} formato={fmtMM}
                detalle={`${totales.pendCant} OC emitidas o solicitadas`} />
              <Indicador rotulo="Gasto contabilizado (neto)" valor={totales.docsNeto} formato={fmtMM}
                detalle={`${totales.docsCant.toLocaleString('es-CL')} documentos de compra`} />
            </Lista>

            {/* Filtros */}
            <div className="mt-5 mb-5 rounded-xl border border-linea bg-white dark:bg-slate-900 p-3 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <Pestanas id="proyectos-estado" valor={estadoFiltro} onCambio={setEstadoFiltro}
                  opciones={[
                    { valor: '', etiqueta: 'Todos', contador: totalConFicha },
                    ...ORDEN_ESTADOS.filter(e => conteoEstados[e]).map(e => ({ valor: e, etiqueta: e, contador: conteoEstados[e] })),
                  ]} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-linea pt-3 dark:border-slate-800">
                <div className="relative w-full @2xl:w-80">
                  <Search size={16} stroke={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, cliente, referencia o licitación…"
                    aria-label="Buscar proyectos"
                    className="h-9 w-full rounded-lg border border-linea bg-white dark:bg-slate-900 pl-9 pr-8 text-sm text-tinta placeholder:text-tinta-3 focus:outline-none focus:ring-2 focus:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                  {q && (
                    <button onClick={() => setQ('')} aria-label="Limpiar búsqueda" title="Limpiar búsqueda"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-tinta dark:hover:bg-slate-800">
                      <X size={14} stroke={1.75} />
                    </button>
                  )}
                </div>
                <Boton tamano="sm" onClick={() => setSoloCoincidentes(v => !v)} aria-pressed={soloCoincidentes}
                  title="Muestra solo los proyectos de Obuma cuya licitación ya tienes como negocio en Licitank (su código está en la referencia o el nombre del proyecto)"
                  className={soloCoincidentes ? 'border-marca/50 text-marca' : ''} icono={<LinkIcon size={16} stroke={1.75} />}>
                  Solo los que están en Licitank
                </Boton>
                {hayFiltros && <Boton tamano="sm" variante="fantasma" onClick={limpiar} icono={<X size={16} stroke={1.75} />}>Limpiar filtros</Boton>}
              </div>
            </div>

            {filtrados.length === 0 ? (
              <Vacio icono={<Folders size={28} stroke={1.5} />} titulo="Ningún proyecto con estos filtros"
                texto="Prueba con otra búsqueda o con otro estado."
                accion={hayFiltros ? <Boton tamano="sm" onClick={limpiar} icono={<X size={16} stroke={1.75} />}>Limpiar filtros</Boton> : undefined} />
            ) : (
              <>
                <Lista key={firma} className="space-y-3">
                  {filtrados.slice(0, visibles).map(p => <TarjetaProyecto key={p.proyectoId} p={p} />)}
                </Lista>
                <div className="mt-4 flex items-center justify-between gap-3 text-xs text-tinta-2 dark:text-slate-400">
                  <span className="tabular-nums">Mostrando {Math.min(visibles, filtrados.length)} de {filtrados.length} proyectos</span>
                  {visibles < filtrados.length && (
                    <Boton tamano="sm" onClick={() => setTanda({ firma, n: visibles + POR_TANDA })}>
                      Ver {Math.min(POR_TANDA, filtrados.length - visibles)} más
                    </Boton>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ── Un proyecto ───────────────────────────────────────────────────────────────
function TarjetaProyecto({ p }: { p: ProyectoObuma }) {
  const [abierta, setAbierta] = useState(false);
  const estado = estadoDe(p);
  const activo = estado === 'En proceso' || estado === 'Abierto'; // en un proyecto vigente estos avisos importan; en uno cerrado son historia
  const titulo = p.tieneProyectoReal ? (p.nombre || `Proyecto #${p.folio}`) : (p.centros[0]?.nombre || 'Centro de costo sin nombre');
  const sub = p.tieneProyectoReal
    ? [p.folio != null && `Folio ${p.folio}`, p.cliente, p.referencia && `Ref. ${p.referencia}`].filter(Boolean).join(' · ')
    : p.centros.map(c => c.nombre || `(ID ${c.id})`).join(' · ');

  const vig = p.ocVigentes, pend = p.ocPendientes, anul = p.ocAnuladas;
  // Las OC ya facturadas deberían verse en los documentos de compra: si no se parecen, falta imputar una factura al proyecto o hay gasto sin OC.
  const facturadasNeto = (vig?.neto ?? 0) - (pend?.neto ?? 0);
  const docsNeto = p.documentosNeto ?? 0;
  const dif = facturadasNeto - docsNeto;
  const mostrarDif = p.cantidadOc > 0 && Math.abs(dif) > 1000;
  // Qué hay para abrir (si no hay nada, no se muestra el botón).
  const detalle = [
    p.cantidadOc > 0 && `${p.cantidadOc} OC`,
    p.cantidadFacturas > 0 && `${p.cantidadFacturas} documentos de gasto`,
    p.ocEnOtroCentro && `${p.ocEnOtroCentro.cantidad} OC de otro centro`,
  ].filter(Boolean) as string[];

  return (
    <Tarjeta>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-tinta line-clamp-2 dark:text-slate-50" title={titulo}>{titulo}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-tinta-2 dark:text-slate-400">
            <span className="font-medium text-tinta dark:text-slate-100"><Estado color={COLOR_ESTADO[estado] || '#94a3b8'}>{p.tieneProyectoReal ? estado : 'Centro de costo sin proyecto'}</Estado></span>
            {sub && <span className="min-w-0 truncate" title={sub}>{sub}</span>}
          </p>
        </div>
        {p.tieneProyectoReal && p.precioNeto != null && (
          <div className="text-right">
            <p className="text-xs text-tinta-2 dark:text-slate-400">Precio de venta (neto)</p>
            <p className="text-lg font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{fmtCLP(p.precioNeto)}</p>
          </div>
        )}
      </div>

      {p.tieneProyectoReal && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-linea/80 pt-3 @3xl:grid-cols-4 dark:border-slate-800">
          <Dato rotulo="Presupuesto (ficha)">{fmtCLP(p.presupuesto)}</Dato>
          <Dato rotulo="Costo estimado (ficha)">{fmtCLP(p.costo)}</Dato>
          <Dato rotulo="Facturado al cliente (ficha)">{fmtCLP(p.facturadoMonto)}</Dato>
          <Dato rotulo="Inicio">{p.fechaInicio ? fmtFecha(p.fechaInicio) || '—' : '—'}</Dato>
        </dl>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-linea/80 pt-3 @3xl:grid-cols-4 dark:border-slate-800">
        <Dato rotulo="OC vigentes (neto)">
          {fmtCLP(vig?.neto ?? 0)}<span className="block text-xs font-normal text-tinta-2 dark:text-slate-400">{vig?.cantidad ?? 0} OC</span>
        </Dato>
        <Dato rotulo="Comprometido sin factura (neto)">
          {fmtCLP(pend?.neto ?? 0)}<span className="block text-xs font-normal text-tinta-2 dark:text-slate-400">{pend?.cantidad ?? 0} OC emitidas</span>
        </Dato>
        <Dato rotulo="Gasto contabilizado (neto)">
          {fmtCLP(docsNeto)}<span className="block text-xs font-normal text-tinta-2 dark:text-slate-400">{p.cantidadFacturas} documentos</span>
        </Dato>
        <Dato rotulo="OC anuladas (no suman)">
          {anul?.cantidad ? fmtCLP(anul.total) : '—'}<span className="block text-xs font-normal text-tinta-2 dark:text-slate-400">{anul?.cantidad ? `${anul.cantidad} OC, con IVA` : 'ninguna'}</span>
        </Dato>
      </dl>

      {/* Avisos de datos de Obuma: lo que el equipo debería corregir allá (esta pantalla solo lee) */}
      {(p.ocEnOtroCentro || (p.tieneProyectoReal && p.centros.length === 0)) && (
        <div className="mt-3 space-y-1 border-t border-linea/80 pt-3 text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
          {p.tieneProyectoReal && p.centros.length === 0 && (
            <p className={activo ? 'font-medium text-alerta' : ''}>
              Este proyecto no tiene centro de costo en Obuma, por eso no se le puede asignar ninguna OC ni gasto.
            </p>
          )}
          {p.ocEnOtroCentro && (
            <p className={activo ? 'font-medium text-alerta' : ''}>
              Obuma tiene {p.ocEnOtroCentro.cantidad} OC que mencionan {p.ocEnOtroCentro.codigo} ({fmtCLP(p.ocEnOtroCentro.neto)} neto) pero están en el centro
              de costo de otro proyecto; no suman aquí. Se corrigen en Obuma: ábrelo abajo para ver cuáles.
            </p>
          )}
        </div>
      )}

      {p.negociosCoincidentes.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-linea/80 pt-3 text-xs dark:border-slate-800">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-tinta-2 dark:text-slate-400">Negocio en Compras</span>
            {p.negociosCoincidentes.map(n => (
              <span key={n.negocioId} className="inline-flex flex-wrap items-center gap-x-2">
                <a href={`/compras/${n.negocioId}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded font-medium text-marca hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60"
                  title={n.licitacionNombre || undefined}>
                  {n.licitacionCodigo}{n.licitacionNombre ? ` — ${n.licitacionNombre.slice(0, 40)}` : ''} <ExternalLink size={12} stroke={1.75} />
                </a>
                {n.estadoCompra && <span className="font-medium text-tinta dark:text-slate-100">{ETIQUETA_COMPRA[n.estadoCompra] || n.estadoCompra} en Compras</span>}
                {n.aproximado && <span className="text-tinta-2 dark:text-slate-400" title="El código del proyecto en Obuma no es idéntico (otra modalidad, ej. R126 en vez de LP26); se unió por organismo, número y año">· unido por número</span>}
              </span>
            ))}
          </p>
          {desfaseCompras(p).map(n => (
            <p key={n.negocioId} className="font-medium text-alerta">
              En Compras está «{ETIQUETA_COMPRA[n.estadoCompra || ''] || n.estadoCompra}» y en Obuma el proyecto está «{p.estado}»: corrige uno de los dos.
            </p>
          ))}
        </div>
      )}

      {detalle.length > 0 && (
        <div className="mt-3 border-t border-linea/80 pt-2 dark:border-slate-800">
          <Boton tamano="sm" variante="fantasma" onClick={() => setAbierta(v => !v)} aria-expanded={abierta}
            icono={<ChevronDown size={16} stroke={1.75} className={`transition-transform duration-150 ${abierta ? 'rotate-180' : ''}`} />}>
            {abierta ? 'Ocultar' : 'Ver'} {detalle.join(' · ')}
          </Boton>
        </div>
      )}

      {abierta && (
        <div className="mt-1">
          {mostrarDif && (
            <p className="mb-3 text-xs text-tinta-2 dark:text-slate-400">
              Las OC ya facturadas suman <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{fmtCLP(facturadasNeto)}</span> y
              los documentos de gasto <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{fmtCLP(docsNeto)}</span> (neto):
              hay <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{fmtCLP(Math.abs(dif))}</span> {dif > 0 ? 'más en OC que en documentos' : 'más en documentos que en OC'}.
              Revisa en Obuma si falta imputar una factura a este proyecto o si hay gasto sin OC.
            </p>
          )}
          <div className="grid gap-x-6 gap-y-4 @4xl:grid-cols-2">
            <div>
              <h4 className="text-[13px] font-semibold text-tinta dark:text-slate-100">Órdenes de compra <span className="tabular-nums text-tinta-3">{p.cantidadOc}</span></h4>
              {p.ocs.length === 0 ? (
                <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">Sin órdenes de compra para este proyecto.</p>
              ) : (
                <ul className="mt-1 divide-y divide-linea dark:divide-slate-800">
                  {p.ocs.map(oc => <FilaOc key={oc.compraOcId} oc={oc} />)}
                </ul>
              )}
              {p.ocsTruncadas && <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">Mostrando las {p.ocs.length} más recientes de {p.cantidadOc}; los totales de arriba cuentan todas.</p>}
            </div>
            <div>
              <h4 className="text-[13px] font-semibold text-tinta dark:text-slate-100">Documentos de gasto <span className="tabular-nums text-tinta-3">{p.cantidadFacturas}</span></h4>
              {p.documentos.length === 0 ? (
                <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">Sin documentos de compra contabilizados en este proyecto.</p>
              ) : (
                <ul className="mt-1 divide-y divide-linea dark:divide-slate-800">
                  {p.documentos.map((d, i) => <FilaDocumento key={`${d.tipo}-${d.folio}-${i}`} d={d} />)}
                </ul>
              )}
              {p.documentosTruncados && <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">Mostrando {p.documentos.length} de {p.cantidadFacturas}; el total de arriba cuenta todos.</p>}
            </div>
          </div>
          {p.ocEnOtroCentro && (
            <div className="mt-4">
              <h4 className="text-[13px] font-semibold text-tinta dark:text-slate-100">
                OC de otro centro de costo que mencionan {p.ocEnOtroCentro.codigo} <span className="tabular-nums text-tinta-3">{p.ocEnOtroCentro.cantidad}</span>
              </h4>
              <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">No suman en este proyecto (Obuma las tiene en otro). Si son de este proyecto, hay que cambiarles el centro de costo en Obuma.</p>
              <ul className="mt-1 divide-y divide-linea @4xl:columns-2 @4xl:gap-x-6 dark:divide-slate-800">
                {p.ocEnOtroCentro.ocs.map(oc => <FilaOc key={oc.compraOcId} oc={oc} centro={oc.centroNombre ?? 'sin centro de costo'} />)}
              </ul>
              {p.ocEnOtroCentro.cantidad > p.ocEnOtroCentro.ocs.length && <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">Mostrando {p.ocEnOtroCentro.ocs.length} de {p.ocEnOtroCentro.cantidad}.</p>}
            </div>
          )}
        </div>
      )}
    </Tarjeta>
  );
}

// Una OC: se abre para ver sus ítems (se piden a Obuma recién al abrirla).
function FilaOc({ oc, centro }: { oc: OcDelProyecto; centro?: string }) {
  const toast = useToast();
  const [abierta, setAbierta] = useState(false);
  const [items, setItems] = useState<EstadoItems | null>(null);
  const clave = (oc.estado || '').toUpperCase();
  const anulada = clave === 'ANULADA';

  const alternar = async () => {
    if (!oc.folio) return;
    if (abierta) { setAbierta(false); return; }
    setAbierta(true);
    if (items?.estado === 'listo') return;
    setItems({ estado: 'cargando' });
    try {
      const res = await fetch(`/api/compras/proyectos-obuma/items?folio=${encodeURIComponent(oc.folio)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo consultar');
      setItems({ estado: 'listo', items: data.items });
    } catch (e) {
      setItems({ estado: 'error' });
      toast.error('No se pudieron cargar los ítems de la OC', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <li>
      <button type="button" onClick={alternar} disabled={!oc.folio} aria-expanded={oc.folio ? abierta : undefined}
        className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-tinta dark:text-slate-100">{oc.proveedorNombre || 'Proveedor sin nombre'}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-tinta-2 dark:text-slate-400">
            <span className="font-medium text-tinta dark:text-slate-100"><Estado color={COLOR_OC[clave] || '#94a3b8'}>{nombreEstadoOc(oc.estado)}</Estado></span>
            {oc.folio && <span className="tabular-nums">OC {oc.folio}</span>}
            {oc.proveedorRut && <span className="tabular-nums">{oc.proveedorRut}</span>}
            {fmtFecha(oc.fecha) && <span>{fmtFecha(oc.fecha)}</span>}
            {centro && <span className="min-w-0 truncate" title={centro}>en «{centro}»</span>}
          </span>
        </span>
        <span className="flex-shrink-0 text-right">
          <span className={`block text-[13px] font-semibold tabular-nums ${anulada ? 'text-tinta-3 line-through' : 'text-tinta dark:text-slate-50'}`}>{fmtCLP(oc.neto ?? oc.total)}</span>
          <span className="block text-xs tabular-nums text-tinta-2 dark:text-slate-400">{fmtCLP(oc.total)} con IVA</span>
        </span>
      </button>
      {abierta && oc.folio && (
        <div className="px-2 pb-2.5">
          <a href={urlOcEnObuma(oc.compraOcId)} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-marca hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60">
            <ExternalLink size={12} stroke={1.75} /> Ver esta OC en Obuma
          </a>
          {items?.estado === 'cargando' && <div className="mt-2 space-y-1.5"><Esqueleto className="h-3 w-full" /><Esqueleto className="h-3 w-2/3" /></div>}
          {items?.estado === 'error' && <p className="mt-1 text-xs text-alerta">No se pudieron cargar los ítems. Ciérrala y ábrela de nuevo para reintentar.</p>}
          {items?.estado === 'listo' && (
            items.items.length === 0
              ? <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">Sin ítems registrados para esta OC.</p>
              : (
                <ul className="mt-1.5 space-y-0.5">
                  {items.items.map((it, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 text-xs text-tinta-2 dark:text-slate-400">
                      <span className="min-w-0 truncate" title={it.nombre}>{it.nombre}</span>
                      <span className="flex-shrink-0 whitespace-nowrap tabular-nums">{it.cantidad} × {fmtCLP(it.precioUnitario)} = <span className="font-semibold text-tinta dark:text-slate-100">{fmtCLP(it.subtotal)}</span></span>
                    </li>
                  ))}
                </ul>
              )
          )}
        </div>
      )}
    </li>
  );
}

// Un documento de gasto: factura, boleta, nota de crédito (resta) o gasto propio.
function FilaDocumento({ d }: { d: DocumentoDelProyecto }) {
  const tipo = TIPO_DOC[d.tipo] || `Documento ${d.tipo}`;
  const quien = d.proveedorNombre || d.observacion || 'Gasto propio';
  const resta = d.total < 0;
  return (
    <li className="flex items-start justify-between gap-3 px-2 py-2">
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-tinta dark:text-slate-100">
          {tipo}{d.folio && d.folio !== '0' ? ` N° ${d.folio}` : ''}
        </span>
        <span className="block truncate text-xs text-tinta-2 dark:text-slate-400" title={quien}>
          {[quien, fmtFecha(d.fecha)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="flex-shrink-0 text-right">
        <span className={`block text-[13px] font-semibold tabular-nums ${resta ? 'text-urgente' : 'text-tinta dark:text-slate-50'}`}>{fmtCLP(d.neto ?? d.total)}</span>
        <span className="block text-xs tabular-nums text-tinta-2 dark:text-slate-400">{fmtCLP(d.total)} con IVA{resta ? ' · resta' : ''}</span>
      </span>
    </li>
  );
}
