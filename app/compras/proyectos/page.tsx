'use client';

// "PROYECTOS" DE OBUMA — pedido explícito del usuario (22-sep-2026): "ver si tenemos lo mismo de
// Obuma... para hacer una comparación". Vista v1-only: Obuma no nos deja leer el Proyecto real
// (v2.0, pide un header `access-url` que la cuenta no tiene contratado) — esto agrupa los centros
// de costo por su `rel_proyecto_id` (hallazgo del 22-sep-2026, no documentado por Obuma) y cruza
// contra nuestras licitaciones. Ver app/lib/compras-proyectos-obuma.ts.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import {
  IconLoader2 as Loader2, IconSearch as Search, IconFolders as Folders, IconLink as LinkIcon,
  IconAlertTriangle as AlertTriangle, IconExternalLink as ExternalLink, IconWallet as Wallet, IconFolderX as FolderX,
  IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconBuilding as Building2,
} from '@tabler/icons-react';

interface NegocioCoincidente { negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; centroCostoNombre: string }
interface OcDelProyecto {
  compraOcId: string; folio: string | null; fecha: string | null; estado: string | null;
  proveedorNombre: string | null; proveedorRut: string | null; total: number;
}
interface ProyectoObuma {
  proyectoId: string; tieneProyectoReal: boolean;
  centros: { id: string; nombre: string; codigo: string; activo: boolean }[];
  totalGastado: number; cantidadOc: number;
  negociosCoincidentes: NegocioCoincidente[];
  ocs: OcDelProyecto[]; ocsTruncadas: boolean;
}

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export default function ProyectosObumaPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [proyectos, setProyectos] = useState<ProyectoObuma[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [soloCoincidentes, setSoloCoincidentes] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  const puedeVer = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/compras/proyectos-obuma');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProyectos(data.proyectos || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los proyectos de Obuma', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  const stats = useMemo(() => {
    const conNegocio = proyectos.filter(p => p.negociosCoincidentes.length > 0).length;
    const totalGasto = proyectos.reduce((s, p) => s + p.totalGastado, 0);
    return { total: proyectos.length, conNegocio, sinNegocio: proyectos.length - conNegocio, totalGasto };
  }, [proyectos]);

  const filtrados = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return proyectos.filter(p => {
      if (soloCoincidentes && p.negociosCoincidentes.length === 0) return false;
      if (!texto) return true;
      const enCentros = p.centros.some(c => c.nombre.toLowerCase().includes(texto) || c.codigo.toLowerCase().includes(texto));
      const enNegocios = p.negociosCoincidentes.some(n => n.licitacionCodigo.toLowerCase().includes(texto) || (n.licitacionNombre || '').toLowerCase().includes(texto));
      return enCentros || enNegocios;
    });
  }, [proyectos, q, soloCoincidentes]);

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Proyectos (Obuma)' }]}>
        <div className="p-6 flex items-center justify-center text-zinc-400"><Loader2 className="animate-spin" size={20} /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Proyectos (Obuma)' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0"><Folders size={17} className="text-indigo-600" /></div>
            <div>
              <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Proyectos (Obuma)</h1>
              <p className="text-[12px] text-zinc-500">{stats.total} proyecto(s) reconstruidos desde los centros de costo</p>
            </div>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, código o licitación…"
              className="pl-8 pr-3 py-2 text-[12.5px] border border-zinc-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 w-64" />
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5 text-[11.5px] text-amber-800">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
          <p>
            Obuma todavía no nos da acceso al módulo real de Proyectos (v2.0 — pide un header{' '}
            <code className="bg-amber-100 px-1 rounded">access-url</code> que la cuenta no tiene contratado).
            Esto es una <b>reconstrucción con datos de v1</b>: agrupa los centros de costo que comparten el
            mismo Proyecto de Obuma (por su <code className="bg-amber-100 px-1 rounded">rel_proyecto_id</code>),
            con su gasto real, sin nombre ni ficha del Proyecto en sí.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Folders size={11} /> Total</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.total}</p>
          </div>
          <button onClick={() => setSoloCoincidentes(v => !v)}
            className={`text-left rounded-xl border p-3 transition-colors ${soloCoincidentes ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><LinkIcon size={11} /> Con negocio nuestro</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.conNegocio}</p>
          </button>
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><FolderX size={11} /> Sin negocio nuestro</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.sinNegocio}</p>
          </div>
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Wallet size={11} /> Gasto total</p>
            <p className="text-[16px] font-bold text-zinc-900 mt-0.5">{fmtCLP(stats.totalGasto)}</p>
          </div>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center text-zinc-400"><Loader2 className="animate-spin" size={18} /></div>
        ) : filtrados.length === 0 ? (
          <p className="text-center text-[12px] text-zinc-400 py-8">Sin resultados para este filtro.</p>
        ) : (
          <div className="space-y-2.5">
            {filtrados.map(p => (
              <div key={p.proyectoId} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-zinc-800">
                      {p.tieneProyectoReal ? `Proyecto Obuma #${p.proyectoId}` : 'Centro de costo suelto (sin Proyecto)'}
                    </p>
                    <p className="text-[11.5px] text-zinc-500 mt-0.5">
                      {p.centros.map(c => c.nombre || `(sin nombre, ID ${c.id})`).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="text-[13.5px] font-bold text-zinc-800">{fmtCLP(p.totalGastado)}</p>
                    <button onClick={() => setExpandido(v => v === p.proyectoId ? null : p.proyectoId)}
                      className="text-[10.5px] text-indigo-600 hover:text-indigo-700 font-semibold inline-flex items-center gap-0.5">
                      {p.cantidadOc} OC · {p.centros.length} centro{p.centros.length !== 1 ? 's' : ''} de costo
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
                          <div key={oc.compraOcId} className="px-4 py-2 flex items-center justify-between gap-3 text-[11.5px]">
                            <div className="min-w-0 flex items-center gap-1.5">
                              <Building2 size={11} className="text-zinc-300 flex-shrink-0" />
                              <span className="font-semibold text-zinc-700 truncate">{oc.proveedorNombre || 'Proveedor sin nombre'}</span>
                              {oc.proveedorRut && <span className="text-zinc-400 flex-shrink-0">· {oc.proveedorRut}</span>}
                              {oc.folio && <span className="text-zinc-400 flex-shrink-0">· folio {oc.folio}</span>}
                              {oc.estado && <span className="text-zinc-400 flex-shrink-0">· {oc.estado}</span>}
                            </div>
                            <div className="text-right flex-shrink-0 whitespace-nowrap">
                              <span className="font-bold text-zinc-700">{fmtCLP(oc.total)}</span>
                              {oc.fecha && <span className="text-zinc-400 ml-2">{oc.fecha.slice(0, 10)}</span>}
                            </div>
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
