'use client';

// "PROYECTOS" DE OBUMA — pedido explícito del usuario (22-sep-2026): "ver si tenemos lo mismo de
// Obuma... para hacer una comparación". Reescrita el mismo día tras un hallazgo grande: soporte de
// Obuma confirmó por correo el endpoint `/v1.0/ext-proyectos.list.json`, que trae el módulo REAL de
// Proyectos (nombre, cliente, Referencia, presupuesto, costo, facturado, estado) SIN necesitar el
// access-url de v2.0 que la cuenta no tiene contratado. Reemplaza la reconstrucción aproximada +
// login-scraping de antes — ahora es todo por API real, en vivo, sin guardar ninguna clave personal.
// Ver app/lib/compras-proyectos-obuma.ts.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import {
  IconLoader2 as Loader2, IconSearch as Search, IconFolders as Folders, IconLink as LinkIcon,
  IconExternalLink as ExternalLink, IconWallet as Wallet, IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp, IconBuilding as Building2, IconRefresh as RefreshCw, IconFolderX as FolderX,
} from '@tabler/icons-react';

interface NegocioCoincidente { negocioId: number; licitacionCodigo: string; licitacionNombre: string | null }
interface OcDelProyecto {
  compraOcId: string; folio: string | null; fecha: string | null; estado: string | null;
  proveedorNombre: string | null; proveedorRut: string | null; total: number;
}
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
  ocs: OcDelProyecto[]; ocsTruncadas: boolean; ultimaFecha: string | null;
}

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const ESTADO_COLOR: Record<string, string> = {
  Abierto: 'bg-sky-50 text-sky-700 border-sky-200',
  Cerrado: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  Cancelado: 'bg-rose-50 text-rose-600 border-rose-200',
  Rechazado: 'bg-rose-50 text-rose-600 border-rose-200',
  'En proceso': 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function ProyectosObumaPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [proyectos, setProyectos] = useState<ProyectoObuma[]>([]);
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [q, setQ] = useState('');
  const [soloCoincidentes, setSoloCoincidentes] = useState(false);
  const [soloConFicha, setSoloConFicha] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [ocAbierta, setOcAbierta] = useState<string | null>(null);
  const [itemsPorFolio, setItemsPorFolio] = useState<Record<string, EstadoItems>>({});

  const puedeVer = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async (forzar = false) => {
    if (forzar) setActualizando(true); else setLoading(true);
    try {
      const res = await fetch(`/api/compras/proyectos-obuma${forzar ? '?forzar=1' : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProyectos(data.proyectos || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los proyectos de Obuma', e.message);
    } finally {
      setLoading(false); setActualizando(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  const toggleOc = async (folio: string | null) => {
    if (!folio) return;
    if (ocAbierta === folio) { setOcAbierta(null); return; }
    setOcAbierta(folio);
    if (itemsPorFolio[folio]) return;
    setItemsPorFolio(m => ({ ...m, [folio]: { estado: 'cargando' } }));
    try {
      const res = await fetch(`/api/compras/proyectos-obuma/items?folio=${encodeURIComponent(folio)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo consultar');
      setItemsPorFolio(m => ({ ...m, [folio]: { estado: 'listo', items: data.items } }));
    } catch (e: any) {
      setItemsPorFolio(m => ({ ...m, [folio]: { estado: 'error' } }));
      toast.error('No se pudieron cargar los ítems de la OC', e.message);
    }
  };

  const stats = useMemo(() => {
    const conFicha = proyectos.filter(p => p.tieneProyectoReal).length;
    const conNegocio = proyectos.filter(p => p.negociosCoincidentes.length > 0).length;
    const totalGasto = proyectos.reduce((s, p) => s + p.totalGastado, 0);
    const totalFacturado = proyectos.reduce((s, p) => s + p.totalFacturado, 0);
    return { total: proyectos.length, conFicha, conNegocio, totalGasto, totalFacturado };
  }, [proyectos]);

  const filtrados = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return proyectos.filter(p => {
      if (soloCoincidentes && p.negociosCoincidentes.length === 0) return false;
      if (soloConFicha && !p.tieneProyectoReal) return false;
      if (!texto) return true;
      const campos = [p.nombre, p.referencia, p.cliente, ...p.centros.map(c => c.nombre), ...p.negociosCoincidentes.map(n => n.licitacionCodigo)];
      return campos.some(v => (v || '').toLowerCase().includes(texto));
    });
  }, [proyectos, q, soloCoincidentes, soloConFicha]);

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Proyectos (Obuma)' }]}>
        <div className="p-6 flex items-center justify-center text-zinc-400"><Loader2 className="animate-spin" size={20} /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  if (loading) {
    return (
      <AppLayout breadcrumb={[{ label: 'Proyectos (Obuma)' }]}>
        <div className="p-4 sm:p-6 max-w-5xl mx-auto">
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="animate-spin text-indigo-500" size={26} />
            <p className="text-[13px] font-semibold text-zinc-600">Consultando los Proyectos reales de Obuma…</p>
            <p className="text-[11.5px] text-zinc-400 max-w-sm">
              Primera carga: recorre Proyectos, clientes, centros de costo, órdenes de compra y facturas de
              toda la cuenta. Cacheado 5 minutos — las próximas veces va a estar lista al toque.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Proyectos (Obuma)' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0"><Folders size={17} className="text-indigo-600" /></div>
            <div>
              <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Proyectos (Obuma)</h1>
              <p className="text-[12px] text-zinc-500">Dato real, por API — nombre, cliente, presupuesto y facturación reales de Obuma</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, cliente, referencia, licitación…"
                className="pl-8 pr-3 py-2 text-[12.5px] border border-zinc-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 w-64" />
            </div>
            <button onClick={() => cargar(true)} disabled={actualizando} title="Volver a consultar Obuma (ignora la caché de 5 min)"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 px-3 py-2 rounded-lg flex-shrink-0">
              {actualizando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Folders size={11} /> Total</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.total}</p>
          </div>
          <button onClick={() => setSoloConFicha(v => !v)}
            className={`text-left rounded-xl border p-3 transition-colors ${soloConFicha ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Folders size={11} /> Con ficha real</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.conFicha}</p>
          </button>
          <button onClick={() => setSoloCoincidentes(v => !v)}
            className={`text-left rounded-xl border p-3 transition-colors ${soloCoincidentes ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><LinkIcon size={11} /> Con negocio nuestro</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.conNegocio}</p>
          </button>
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Wallet size={11} /> Gasto en OC</p>
            <p className="text-[15px] font-bold text-zinc-900 mt-0.5">{fmtCLP(stats.totalGasto)}</p>
          </div>
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Wallet size={11} /> Facturado real</p>
            <p className="text-[15px] font-bold text-emerald-700 mt-0.5">{fmtCLP(stats.totalFacturado)}</p>
          </div>
        </div>

        {filtrados.length === 0 ? (
          <p className="text-center text-[12px] text-zinc-400 py-8">Sin resultados para este filtro.</p>
        ) : (
          <div className="space-y-2.5">
            {filtrados.map(p => (
              <div key={p.proyectoId} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[12.5px] font-bold text-zinc-800">
                        {p.tieneProyectoReal
                          ? (p.nombre || `Proyecto #${p.folio}`)
                          : (p.centros[0]?.nombre || 'Centro de costo sin nombre')}
                      </p>
                      {p.estado && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${ESTADO_COLOR[p.estado] || 'bg-zinc-50 text-zinc-500 border-zinc-200'}`}>
                          {p.estado}
                        </span>
                      )}
                      {!p.tieneProyectoReal && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-zinc-50 text-zinc-400 border-zinc-200 inline-flex items-center gap-0.5">
                          <FolderX size={9} /> sin ficha de Proyecto
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-zinc-500 mt-0.5 truncate">
                      {p.tieneProyectoReal
                        ? [p.cliente, p.referencia && `Ref: ${p.referencia}`].filter(Boolean).join(' · ')
                        : p.centros.map(c => c.nombre || `(ID ${c.id})`).join(' · ')}
                    </p>
                    {p.fechaIngreso && <p className="text-[10px] text-zinc-400 mt-0.5">Ingresado: {p.fechaIngreso}</p>}
                  </div>
                  <div className="text-right whitespace-nowrap flex-shrink-0">
                    {p.tieneProyectoReal ? (
                      <>
                        <p className="text-[13.5px] font-bold text-zinc-800">{fmtCLP(p.precioNeto)}</p>
                        <p className="text-[10px] text-zinc-400">presup. {fmtCLP(p.presupuesto)} · costo {fmtCLP(p.costo)}</p>
                      </>
                    ) : (
                      <p className="text-[13.5px] font-bold text-zinc-800">{fmtCLP(p.totalGastado)}</p>
                    )}
                    {p.cantidadFacturas > 0 && (
                      <p className="text-[10.5px] text-emerald-700 font-semibold">facturado {fmtCLP(p.totalFacturado)}</p>
                    )}
                    <button onClick={() => setExpandido(v => v === p.proyectoId ? null : p.proyectoId)}
                      className="text-[10.5px] text-indigo-600 hover:text-indigo-700 font-semibold inline-flex items-center gap-0.5">
                      {p.cantidadOc} OC{p.cantidadFacturas > 0 ? ` · ${p.cantidadFacturas} facturas` : ''}
                      {expandido === p.proyectoId ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                  </div>
                </div>

                {p.negociosCoincidentes.length > 0 && (
                  <div className="px-4 py-2.5 border-t border-zinc-100 bg-emerald-50/50 flex flex-wrap gap-1.5">
                    {p.negociosCoincidentes.map(n => (
                      <a key={n.negocioId} href={`/compras/${n.negocioId}`} target="_blank" rel="noreferrer"
                        className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-2 py-1 rounded-full inline-flex items-center gap-1">
                        <LinkIcon size={10} /> {n.licitacionCodigo}{n.licitacionNombre ? ` — ${n.licitacionNombre.slice(0, 40)}` : ''} <ExternalLink size={10} />
                      </a>
                    ))}
                  </div>
                )}

                {expandido === p.proyectoId && (
                  <div className="border-t border-zinc-100">
                    {p.ocs.length === 0 ? (
                      <p className="px-4 py-3 text-[11.5px] text-zinc-400">Sin órdenes de compra para este proyecto.</p>
                    ) : (
                      <div className="divide-y divide-zinc-50">
                        {p.ocs.map(oc => (
                          <div key={oc.compraOcId}>
                            <button type="button" onClick={() => toggleOc(oc.folio)} disabled={!oc.folio}
                              className="w-full px-4 py-2 flex items-center justify-between gap-3 text-[11.5px] text-left hover:bg-zinc-50/80 disabled:hover:bg-transparent disabled:cursor-default">
                              <div className="min-w-0 flex items-center gap-1.5">
                                <Building2 size={11} className="text-zinc-300 flex-shrink-0" />
                                <span className="font-semibold text-zinc-700 truncate">{oc.proveedorNombre || 'Proveedor sin nombre'}</span>
                                {oc.proveedorRut && <span className="text-zinc-400 flex-shrink-0">· {oc.proveedorRut}</span>}
                                {oc.folio && <span className="text-zinc-400 flex-shrink-0">· folio {oc.folio}</span>}
                                {oc.estado && <span className="text-zinc-400 flex-shrink-0">· {oc.estado}</span>}
                              </div>
                              <div className="text-right flex-shrink-0 whitespace-nowrap flex items-center gap-1.5">
                                <span className="font-bold text-zinc-700">{fmtCLP(oc.total)}</span>
                                {oc.fecha && <span className="text-zinc-400">{oc.fecha.slice(0, 10)}</span>}
                                {oc.folio && (ocAbierta === oc.folio ? <ChevronUp size={11} className="text-zinc-300" /> : <ChevronDown size={11} className="text-zinc-300" />)}
                              </div>
                            </button>
                            {oc.folio && ocAbierta === oc.folio && (
                              <div className="px-4 pb-2.5 pl-7">
                                {itemsPorFolio[oc.folio]?.estado === 'cargando' && (
                                  <p className="text-[10.5px] text-zinc-400 flex items-center gap-1 pt-1"><Loader2 size={10} className="animate-spin" /> Cargando ítems…</p>
                                )}
                                {itemsPorFolio[oc.folio]?.estado === 'error' && (
                                  <p className="text-[10.5px] text-amber-600 pt-1">No se pudieron cargar los ítems.</p>
                                )}
                                {itemsPorFolio[oc.folio]?.estado === 'listo' && (
                                  <div className="pt-1 space-y-0.5">
                                    {(itemsPorFolio[oc.folio] as { estado: 'listo'; items: ItemOc[] }).items.length === 0 ? (
                                      <p className="text-[10.5px] text-zinc-400">Sin ítems registrados para esta OC.</p>
                                    ) : (itemsPorFolio[oc.folio] as { estado: 'listo'; items: ItemOc[] }).items.map((it, i) => (
                                      <div key={i} className="flex items-center justify-between gap-3 text-[10.5px] text-zinc-500">
                                        <span className="truncate">{it.nombre}</span>
                                        <span className="flex-shrink-0 whitespace-nowrap">{it.cantidad} × {fmtCLP(it.precioUnitario)} = <b className="text-zinc-700">{fmtCLP(it.subtotal)}</b></span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                        {p.ocsTruncadas && (
                          <p className="px-4 py-2 text-[10.5px] text-zinc-400">
                            Mostrando las {p.ocs.length} más recientes de {p.cantidadOc} en total.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
