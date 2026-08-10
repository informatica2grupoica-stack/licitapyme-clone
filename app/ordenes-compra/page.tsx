'use client';

// /ordenes-compra — vista de gestión transversal de TODAS las órdenes de compra de Mercado Público
// (las dos empresas), con filtros por fecha, ítem/texto libre, empresa y estado. Los datos ya están
// en nuestra base (los trae el cron diario, ver app/lib/ordenes-compra.ts) — la API de MP no permite
// consultar por licitación, así que no hay nada que pedirle al portal desde acá.
//
// "Usar como experiencia" NO reasigna la OC (ya está fija a la licitación que la generó, se
// adjudicó ahí) — copia su PDF a "Documentos Propios" de OTRA licitación en la que se está
// postulando, como respaldo de experiencia/track record. Reusa /api/documentos/guardar, el mismo
// endpoint con el que el usuario sube documentos a mano (misma caja "Documentos Propios").
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { Select } from '@/app/components/ui/Select';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import {
  Receipt, Loader2, Search, Filter, X, Calendar, Building2, Package, ChevronDown, ChevronUp,
  ExternalLink, Eye, Download, ArrowUpRight, FolderInput, Check,
} from 'lucide-react';

interface ItemOC { descripcion: string; cantidad: number | null; precioNeto: number | null; total: number | null }
interface OrdenCompra {
  codigo: string;
  esNuestra: boolean;
  proveedorNombre: string | null;
  nombre: string | null;
  estado: string | null;
  codigoEstado: number | null;
  tipo: string | null;
  fechaEnvio: string | null;
  fechaCreacion: string | null;
  fechaAceptacion: string | null;
  moneda: string | null;
  totalNeto: number | null;
  total: number | null;
  compradorOrganismo: string | null;
  compradorUnidad: string | null;
  compradorContacto: string | null;
  compradorMail: string | null;
  items: ItemOC[];
  url: string;
  pdfUrl: string | null;
  licitacionCodigo: string | null;
  licitacionNombre: string | null;
  empresaId: number | null;
  empresaNombre: string | null;
}
interface Empresa { id: number; razon_social: string }
interface NegocioBusqueda { licitacion_codigo: string; licitacion_nombre: string | null; licitacion_organismo: string | null }

const ESTADOS_OC: Array<{ value: string; label: string }> = [
  { value: '4', label: 'Enviada a proveedor' },
  { value: '5', label: 'En proceso' },
  { value: '6', label: 'Aceptada' },
  { value: '9', label: 'Cancelada' },
  { value: '12', label: 'Recepción conforme' },
  { value: '13', label: 'Pendiente de recepcionar' },
  { value: '14', label: 'Recepcionada parcialmente' },
  { value: '15', label: 'Recepción conforme incompleta' },
];

const PAGE_SIZE = 30;

function colorEstado(codigo: number | null): { fondo: string; texto: string; borde: string } {
  if (codigo === 9) return { fondo: 'bg-rose-50', texto: 'text-rose-700', borde: 'border-rose-200' };
  if (codigo === 6 || codigo === 12) return { fondo: 'bg-emerald-50', texto: 'text-emerald-700', borde: 'border-emerald-200' };
  return { fondo: 'bg-amber-50', texto: 'text-amber-700', borde: 'border-amber-200' };
}

const fmtCLP = (n: number | null | undefined, moneda?: string | null) => {
  if (n == null) return '—';
  if (moneda && moneda !== 'CLP') return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)} ${moneda}`;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
};
const fmtFecha = (f: string | null) => {
  if (!f) return null;
  try { return new Date(f).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }); } catch { return null; }
};

// Modal "Usar como experiencia": busca una licitación (negocios) y copia el PDF de la OC a su
// caja "Experiencia" dentro de Documentos Propios. Se puede mandar a VARIAS licitaciones sin
// cerrar el modal — cada envío queda marcado con un check en la lista de resultados.
function EnviarExperienciaModal({ oc, onClose }: { oc: OrdenCompra; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<NegocioBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [enviandoA, setEnviandoA] = useState<string | null>(null);
  const [enviadosA, setEnviadosA] = useState<Set<string>>(new Set());
  const [pdfUrl, setPdfUrl] = useState(oc.pdfUrl);
  const toast = useToast();

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResultados([]); return; }
    setBuscando(true);
    const timer = setTimeout(() => {
      fetch(`/api/negocios/buscar?q=${encodeURIComponent(t)}`)
        .then(r => r.json())
        .then(d => setResultados(d.success ? (d.negocios || []) : []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const enviar = async (negocio: NegocioBusqueda) => {
    setEnviandoA(negocio.licitacion_codigo);
    try {
      let url = pdfUrl;
      if (!url) {
        const r = await fetch('/api/ordenes-compra/pdf', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigoOC: oc.codigo }),
        });
        const d = await r.json().catch(() => null);
        if (!d?.success || !d.url) throw new Error(d?.error || 'No se pudo obtener el PDF de la orden');
        url = d.url; setPdfUrl(url);
      }
      const res = await fetch('/api/documentos/guardar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacionCodigo: negocio.licitacion_codigo,
          documentoNombre: `OC_${oc.codigo}_experiencia.pdf`,
          url, categoria: 'DOCUMENTOS_PROPIOS', subcategoria: 'Experiencia',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo enviar');
      setEnviadosA(prev => new Set(prev).add(negocio.licitacion_codigo));
      toast.success('Enviada como experiencia', `${oc.codigo} → Documentos Propios de ${negocio.licitacion_codigo}`);
    } catch (e: any) {
      toast.error('Error al enviar', e.message || 'Intenta de nuevo');
    } finally {
      setEnviandoA(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 overlay-in"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md modal-in">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center"><FolderInput size={16} className="text-indigo-600" /></div>
            <div>
              <h3 className="text-[13px] font-bold text-slate-800">Usar como experiencia</h3>
              <p className="text-[11px] text-slate-500 font-mono">{oc.codigo}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"><X size={16} className="text-slate-500" /></button>
        </div>

        <div className="px-6 py-4">
          <p className="text-[12px] text-slate-500 mb-3">
            Copia el PDF de esta orden a <b>Documentos Propios → Experiencia</b> de la licitación que
            elijas — sirve para respaldar experiencia al postular a otra oportunidad. No mueve ni
            cambia la licitación de origen de esta OC.
          </p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar por código o nombre de la licitación destino…"
              className="w-full pl-8 pr-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
            {buscando ? (
              <div className="flex items-center justify-center py-4"><Loader2 size={16} className="animate-spin text-indigo-500" /></div>
            ) : q.trim().length < 2 ? (
              <p className="text-[12px] text-slate-400 text-center py-4">Escribe al menos 2 caracteres</p>
            ) : resultados.length === 0 ? (
              <p className="text-[12px] text-slate-400 text-center py-4">Sin resultados</p>
            ) : resultados.map(n => {
              const enviado = enviadosA.has(n.licitacion_codigo);
              const cargando = enviandoA === n.licitacion_codigo;
              return (
                <button key={n.licitacion_codigo} disabled={cargando} onClick={() => enviar(n)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 flex items-center gap-2
                    ${enviado ? 'bg-emerald-50 border-emerald-200' : 'border-transparent hover:bg-slate-50 hover:border-slate-200'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-mono text-slate-400">{n.licitacion_codigo}</p>
                    <p className="text-[12.5px] font-semibold text-slate-700 truncate">{n.licitacion_nombre || '—'}</p>
                    {n.licitacion_organismo && <p className="text-[11px] text-slate-400 truncate">{n.licitacion_organismo}</p>}
                  </div>
                  {cargando ? <Loader2 size={15} className="animate-spin text-indigo-500 flex-shrink-0" />
                    : enviado ? <Check size={15} className="text-emerald-600 flex-shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccionesDocumento({ codigo, nombre, pdfUrlInicial, onVer }: { codigo: string; nombre: string; pdfUrlInicial: string | null; onVer: (doc: VisorDoc) => void }) {
  const [url, setUrl] = useState(pdfUrlInicial);
  const [cargando, setCargando] = useState<'ver' | 'descargar' | null>(null);

  const asegurarUrl = async (): Promise<string | null> => {
    if (url) return url;
    try {
      const r = await fetch('/api/ordenes-compra/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigoOC: codigo }),
      });
      const d = await r.json().catch(() => null);
      if (d?.success && d.url) { setUrl(d.url); return d.url; }
      return null;
    } catch { return null; }
  };

  const ver = async () => { setCargando('ver'); const u = await asegurarUrl(); setCargando(null); if (u) onVer({ nombre, url: u }); };
  const descargar = async () => {
    setCargando('descargar'); const u = await asegurarUrl(); setCargando(null);
    if (!u) return;
    const a = document.createElement('a'); a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={ver} disabled={cargando !== null} title="Ver"
        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50">
        {cargando === 'ver' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
      </button>
      <button type="button" onClick={descargar} disabled={cargando !== null} title="Descargar"
        className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50">
        {cargando === 'descargar' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      </button>
    </div>
  );
}

function FilaOrden({ oc, onVer, onEnviarExperiencia }: { oc: OrdenCompra; onVer: (doc: VisorDoc) => void; onEnviarExperiencia: (oc: OrdenCompra) => void }) {
  const [abierto, setAbierto] = useState(false);
  const c = colorEstado(oc.codigoEstado);
  const fecha = fmtFecha(oc.fechaEnvio) || fmtFecha(oc.fechaCreacion);

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.fondo} ${c.texto}`}><Receipt size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-slate-800 font-mono">{oc.codigo}</span>
            {oc.estado && <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${c.fondo} ${c.texto} ${c.borde}`}>{oc.estado}</span>}
            {oc.empresaNombre && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{oc.empresaNombre}</span>}
            {fecha && <span className="text-[10.5px] text-slate-400">{fecha}</span>}
          </div>
          {oc.compradorOrganismo && (
            <p className="mt-1 text-[12px] text-slate-600 flex items-center gap-1.5 min-w-0">
              <Building2 size={12} className="flex-shrink-0 text-slate-400" />
              <span className="truncate" title={`${oc.compradorOrganismo}${oc.compradorUnidad ? ` · ${oc.compradorUnidad}` : ''}`}>
                {oc.compradorOrganismo}{oc.compradorUnidad ? ` · ${oc.compradorUnidad}` : ''}
              </span>
            </p>
          )}
          {oc.licitacionCodigo ? (
            <Link href={`/licitacion/${encodeURIComponent(oc.licitacionCodigo)}`}
              className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700">
              {oc.licitacionNombre || oc.licitacionCodigo} <ArrowUpRight size={11} />
            </Link>
          ) : (
            <span className="mt-1 block text-[11.5px] text-slate-400">Sin licitación de origen detectada</span>
          )}
        </div>
        <div className="text-right whitespace-nowrap">
          <span className="block text-[14px] font-bold text-slate-800">{fmtCLP(oc.total, oc.moneda)}</span>
          {oc.totalNeto != null && oc.totalNeto !== oc.total && <span className="block text-[11px] text-slate-400">neto {fmtCLP(oc.totalNeto, oc.moneda)}</span>}
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 bg-slate-50/60">
        {oc.items.length > 0 && (
          <button onClick={() => setAbierto(o => !o)} className="text-[11.5px] font-semibold text-slate-600 hover:text-slate-800 inline-flex items-center gap-1">
            <Package size={12} /> {oc.items.length} ítem{oc.items.length !== 1 ? 's' : ''}
            {abierto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => onEnviarExperiencia(oc)}
            className="text-[11.5px] font-semibold text-slate-600 hover:text-indigo-600 inline-flex items-center gap-1"
            title="Copiar a Documentos Propios de otra licitación">
            <FolderInput size={13} /> Usar como experiencia
          </button>
          <AccionesDocumento codigo={oc.codigo} nombre={`OC_${oc.codigo}.pdf`} pdfUrlInicial={oc.pdfUrl} onVer={onVer} />
          <a href={oc.url} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
            <ExternalLink size={12} /> Mercado Público
          </a>
        </div>
      </div>

      {abierto && oc.items.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 space-y-1.5">
          {oc.items.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 text-[12px]">
              <span className="text-slate-700 min-w-0" title={it.descripcion}>{it.descripcion || `Ítem ${i + 1}`}</span>
              <span className="text-slate-500 whitespace-nowrap">
                {it.cantidad != null ? `${it.cantidad} × ` : ''}{fmtCLP(it.precioNeto, oc.moneda)}
                {it.total != null && <b className="ml-2 text-slate-700">{fmtCLP(it.total, oc.moneda)}</b>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrdenesCompraPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const puedeVer = usuario?.rol === 'admin';

  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [total, setTotal] = useState(0);
  const [sumaTotal, setSumaTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migracionPendiente, setMigracionPendiente] = useState(false);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [incluirTerceros, setIncluirTerceros] = useState(false);
  const [visorDoc, setVisorDoc] = useState<VisorDoc | null>(null);
  const [experienciaOC, setExperienciaOC] = useState<OrdenCompra | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    fetch('/api/empresas').then(r => r.json()).then(d => { if (d.success) setEmpresas(d.empresas || []); }).catch(() => {});
  }, []);

  const cargar = useCallback(async (offset: number) => {
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (qDebounced) params.set('q', qDebounced);
      if (empresaId) params.set('empresaId', empresaId);
      if (estado) params.set('estado', estado);
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      if (incluirTerceros) params.set('incluirTerceros', '1');
      const res = await fetch(`/api/ordenes-compra/listado?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setMigracionPendiente(!!data.migracionPendiente);
      setTotal(data.total || 0);
      setSumaTotal(data.sumaTotal || 0);
      setOrdenes(prev => offset === 0 ? (data.ordenes || []) : [...prev, ...(data.ordenes || [])]);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [qDebounced, empresaId, estado, desde, hasta, incluirTerceros]);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar(0);
  }, [cargandoSesion, puedeVer, router, cargar]);

  const hayFiltro = !!qDebounced || !!empresaId || !!estado || !!desde || !!hasta || incluirTerceros;
  const limpiar = () => { setQ(''); setEmpresaId(''); setEstado(''); setDesde(''); setHasta(''); setIncluirTerceros(false); };

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Órdenes de compra' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Órdenes de compra' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0"><Receipt size={17} className="text-indigo-600" /></div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900 leading-tight">Órdenes de compra</h1>
              <p className="text-[12px] text-slate-500">
                {loading ? 'Cargando…' : `${total} orden${total !== 1 ? 'es' : ''}${hayFiltro ? ' con estos filtros' : ''} · ${fmtCLP(sumaTotal)}`}
              </p>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar código, organismo, proveedor, licitación o ítem…"
              className="pl-8 pr-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none w-80" />
          </div>
        </div>

        {migracionPendiente && <Banner variante="warning">Falta aplicar la migración de órdenes de compra en la base de datos.</Banner>}
        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: () => cargar(0) }}>{error}</Banner>}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-slate-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>

          <Select value={empresaId} onChange={setEmpresaId} minWidth={180}
            placeholder="Todas las empresas"
            options={[{ value: '', label: 'Todas las empresas' }, ...empresas.map(e => ({ value: String(e.id), label: e.razon_social }))]} />

          <Select value={estado} onChange={setEstado} minWidth={190}
            placeholder="Todos los estados"
            options={[{ value: '', label: 'Todos los estados' }, ...ESTADOS_OC]} />

          <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1">
            <Calendar size={13} className="text-slate-400 flex-shrink-0" />
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} max={hasta || undefined}
              className="text-[12px] text-slate-700 bg-transparent outline-none w-[118px]" title="Emitida desde" />
            <span className="text-slate-300">–</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} min={desde || undefined}
              className="text-[12px] text-slate-700 bg-transparent outline-none w-[118px]" title="Emitida hasta" />
            {(desde || hasta) && (
              <button onClick={() => { setDesde(''); setHasta(''); }} title="Quitar rango" className="text-slate-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
            )}
          </div>

          <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 border border-slate-200 rounded-lg px-2.5 py-2 cursor-pointer hover:bg-slate-50">
            <input type="checkbox" checked={incluirTerceros} onChange={e => setIncluirTerceros(e.target.checked)} className="accent-indigo-600" />
            Incluir de terceros
          </label>

          {hayFiltro && (
            <button onClick={limpiar} className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-2 rounded-lg transition-colors">
              <X size={12} /> Limpiar
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : ordenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Receipt size={28} className="text-slate-300" />
            <p className="text-[13.5px] font-semibold text-slate-500">{hayFiltro ? 'Sin resultados' : 'Todavía no hay órdenes de compra'}</p>
            <p className="text-[12px] text-slate-400">{hayFiltro ? 'Prueba ajustando los filtros.' : 'El cron diario revisa Mercado Público y las trae solas.'}</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {ordenes.map(oc => (
                <FilaOrden key={oc.codigo} oc={oc} onVer={setVisorDoc} onEnviarExperiencia={setExperienciaOC} />
              ))}
            </div>
            {ordenes.length < total && (
              <div className="flex justify-center pt-2">
                <button onClick={() => cargar(ordenes.length)} disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-4 py-2 text-[12.5px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50">
                  {loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
                  Cargar más ({ordenes.length} de {total})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />
      {experienciaOC && <EnviarExperienciaModal oc={experienciaOC} onClose={() => setExperienciaOC(null)} />}
    </AppLayout>
  );
}
