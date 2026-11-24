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
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { MiniaturaDoc, urlInline } from '@/app/negocios/[id]/MiniaturaDoc';
import { IconReceipt as Receipt, IconLoader2 as Loader2, IconSearch as Search, IconFilter as Filter, IconX as X, IconCalendar as Calendar, IconBuilding as Building2, IconPackage as Package, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconExternalLink as ExternalLink, IconEye as Eye, IconDownload as Download, IconArrowUpRight as ArrowUpRight, IconFolderSymlink as FolderInput, IconCheck as Check } from '@tabler/icons-react';

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

// licitank-ui: el color del estado va en el punto del texto (no en pastillas); se deduce del nombre de la clase.
function colorDeClase(clase: string): string {
  if (/rose|red/.test(clase)) return '#dc2626';
  if (/amber/.test(clase)) return '#d97706';
  if (/emerald|green/.test(clase)) return '#16a34a';
  return '#64748b';
}

function colorEstado(codigo: number | null): { fondo: string; texto: string; borde: string } {
  if (codigo === 9) return { fondo: 'bg-rose-50', texto: 'text-rose-700', borde: 'border-rose-200' };
  if (codigo === 6 || codigo === 12) return { fondo: 'bg-emerald-50', texto: 'text-emerald-700', borde: 'border-emerald-200' };
  return { fondo: 'bg-amber-50', texto: 'text-amber-700', borde: 'border-amber-200' };
}

const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const CAMPO = 'h-9 rounded-lg border border-linea bg-white text-sm text-tinta outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overlay-in"
      role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-flotante w-full max-w-xl modal-in">
        <div className="px-5 py-4 border-b border-linea dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-50">Usar como experiencia</h3>
            <p className="text-xs text-tinta-2 dark:text-slate-400 font-mono mt-0.5">{oc.codigo}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800"><X size={18} stroke={1.75} /></button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[13px] text-tinta-2 dark:text-slate-400 mb-3">
            Copia el PDF de esta orden a <b>Documentos Propios → Experiencia</b> de la licitación que
            elijas — sirve para respaldar experiencia al postular a otra oportunidad. No mueve ni
            cambia la licitación de origen de esta OC.
          </p>
          <div className="relative">
            <Search size={16} stroke={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar por código o nombre de la licitación destino…"
              className={`w-full pl-9 pr-3 ${CAMPO}`} />
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
            {buscando ? (
              <div className="flex items-center justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
            ) : q.trim().length < 2 ? (
              <p className="text-[13px] text-tinta-2 text-center py-4">Escribe al menos 2 caracteres</p>
            ) : resultados.length === 0 ? (
              <p className="text-[13px] text-tinta-2 text-center py-4">Sin resultados</p>
            ) : resultados.map(n => {
              const enviado = enviadosA.has(n.licitacion_codigo);
              const cargando = enviandoA === n.licitacion_codigo;
              return (
                <button key={n.licitacion_codigo} disabled={cargando} onClick={() => enviar(n)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 flex items-center gap-2
                    ${enviado ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900' : 'border-transparent hover:bg-slate-50 hover:border-linea dark:hover:bg-slate-800'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-tinta-2 dark:text-slate-400">{n.licitacion_codigo}</p>
                    <p className="text-[13px] font-medium text-tinta dark:text-slate-100 truncate">{n.licitacion_nombre || '—'}</p>
                    {n.licitacion_organismo && <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">{n.licitacion_organismo}</p>}
                  </div>
                  {cargando ? <Loader2 size={16} className="animate-spin text-slate-400 flex-shrink-0" />
                    : enviado ? <Check size={16} stroke={1.75} className="text-exito flex-shrink-0" /> : null}
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
      <Tooltip label="Ver el PDF">
        <button type="button" onClick={ver} disabled={cargando !== null} aria-label="Ver el PDF"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 disabled:opacity-50 dark:hover:bg-slate-800">
          {cargando === 'ver' ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} stroke={1.75} />}
        </button>
      </Tooltip>
      <Tooltip label="Descargar el PDF">
        <button type="button" onClick={descargar} disabled={cargando !== null} aria-label="Descargar el PDF"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 disabled:opacity-50 dark:hover:bg-slate-800">
          {cargando === 'descargar' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} stroke={1.75} />}
        </button>
      </Tooltip>
    </div>
  );
}

// Miniatura de la OC dentro del desplegable. Solo en pantallas anchas (en móvil basta el ojo, así no se cargan iframes);
// el PDF se pide recién cuando la fila se despliega.
function MiniaturaOc({ oc, onVer }: { oc: OrdenCompra; onVer: (doc: VisorDoc) => void }) {
  const [ancha, setAncha] = useState(false);
  const [url, setUrl] = useState(oc.pdfUrl);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const act = () => setAncha(mq.matches);
    act(); mq.addEventListener('change', act);
    return () => mq.removeEventListener('change', act);
  }, []);
  useEffect(() => {
    if (!ancha || url) return;
    let vivo = true;
    fetch('/api/ordenes-compra/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigoOC: oc.codigo }) })
      .then(r => r.json()).then(d => { if (vivo && d?.success && d.url) setUrl(d.url); }).catch(() => {});
    return () => { vivo = false; };
  }, [ancha, url, oc.codigo]);
  if (!ancha) return null;
  const nombre = `OC_${oc.codigo}.pdf`;
  return <MiniaturaDoc src={url ? urlInline(url) : null} titulo={oc.codigo} detalle={oc.estado} ancho={150} onAbrir={() => { if (url) onVer({ nombre, url }); }} />;
}

interface OcAceptacion extends OrdenCompra { limite: string | null; horas: number | null; aceptadaEn: string | null }

// Etiqueta de plazo para aceptar la OC: «Vence hoy 23:59», «Venció hace 2 d», «Vence en 3 d (09-11)».
function etiquetaPlazo(oc: OcAceptacion): { texto: string; clase: string } {
  if (oc.horas == null || !oc.limite) return { texto: 'Plazo sin calcular', clase: 'bg-slate-100 text-slate-500 border-slate-200' };
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const dia = oc.limite.slice(0, 10);
  const dd = dia.split('-').reverse().slice(0, 2).join('-');
  if (oc.horas <= 0) {
    const h = Math.abs(oc.horas);
    return { texto: `Venció hace ${h >= 24 ? `${Math.floor(h / 24)} d` : `${Math.max(1, Math.round(h))} h`}`, clase: 'bg-rose-50 text-rose-700 border-rose-200' };
  }
  if (dia === hoy) return { texto: `Vence hoy ${oc.limite.slice(11, 16)}`, clase: 'bg-rose-50 text-rose-700 border-rose-200' };
  const dias = Math.ceil(oc.horas / 24);
  return { texto: `Vence en ${dias} d (${dd})`, clase: dias <= 2 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200' };
}

function FilaOrden({ oc, onVer, onEnviarExperiencia, etiqueta }: { oc: OrdenCompra; onVer: (doc: VisorDoc) => void; onEnviarExperiencia?: (oc: OrdenCompra) => void; etiqueta?: { texto: string; clase: string } }) {
  const [abierto, setAbierto] = useState(false);
  const c = colorEstado(oc.codigoEstado);
  const fecha = fmtFecha(oc.fechaEnvio) || fmtFecha(oc.fechaCreacion);

  return (
    <div className={`${SUPERFICIE} overflow-hidden`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800"><Receipt size={18} stroke={1.75} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-tinta dark:text-slate-50 font-mono">{oc.codigo}</span>
            {etiqueta && <span className="text-xs font-medium text-tinta-2 dark:text-slate-300"><Estado color={colorDeClase(etiqueta.clase)}>{etiqueta.texto}</Estado></span>}
            {oc.estado && <span className="text-xs font-medium text-tinta-2 dark:text-slate-300"><Estado color={colorDeClase(c.texto)}>{oc.estado}</Estado></span>}
            {oc.empresaNombre && <span className="text-xs text-tinta-2 dark:text-slate-400">· {oc.empresaNombre}</span>}
            {fecha && <span className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{fecha}</span>}
          </div>
          {oc.compradorOrganismo && (
            <p className="mt-1 text-[13px] text-tinta-2 dark:text-slate-300 flex items-center gap-1.5 min-w-0">
              <Building2 size={16} stroke={1.75} className="flex-shrink-0 text-slate-400" />
              <span className="truncate" title={`${oc.compradorOrganismo}${oc.compradorUnidad ? ` · ${oc.compradorUnidad}` : ''}`}>
                {oc.compradorOrganismo}{oc.compradorUnidad ? ` · ${oc.compradorUnidad}` : ''}
              </span>
            </p>
          )}
          {oc.licitacionCodigo ? (
            <Link href={`/licitacion/${encodeURIComponent(oc.licitacionCodigo)}`}
              className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-marca hover:underline">
              {oc.licitacionNombre || oc.licitacionCodigo} <ArrowUpRight size={16} stroke={1.75} />
            </Link>
          ) : (
            <span className="mt-1 block text-xs text-tinta-2 dark:text-slate-400">Sin licitación de origen detectada</span>
          )}
        </div>
        <div className="text-right whitespace-nowrap">
          <span className="block text-[15px] font-semibold tabular-nums text-tinta dark:text-slate-50">{fmtCLP(oc.total, oc.moneda)}</span>
          {oc.totalNeto != null && oc.totalNeto !== oc.total && <span className="block text-xs tabular-nums text-tinta-2 dark:text-slate-400">neto {fmtCLP(oc.totalNeto, oc.moneda)}</span>}
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-t border-linea dark:border-slate-800">
        <button onClick={() => setAbierto(o => !o)} aria-expanded={abierto} className="text-[13px] font-medium text-tinta-2 hover:text-tinta dark:text-slate-300 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 rounded">
          <Package size={16} stroke={1.75} /> {oc.items.length > 0 ? `${oc.items.length} ítem${oc.items.length !== 1 ? 's' : ''}` : 'Detalle'}
          {abierto ? <ChevronUp size={16} stroke={1.75} /> : <ChevronDown size={16} stroke={1.75} />}
        </button>
        <div className="ml-auto flex items-center gap-1 @xl:gap-3">
          {onEnviarExperiencia && <button onClick={() => onEnviarExperiencia(oc)}
            className="text-[13px] font-medium text-tinta-2 hover:text-marca dark:text-slate-300 inline-flex h-8 items-center gap-1.5 rounded px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60"
            title="Usar como experiencia: copiar a Documentos Propios de otra licitación" aria-label="Usar como experiencia">
            <FolderInput size={16} stroke={1.75} /> <span className="hidden @xl:inline whitespace-nowrap">Usar como experiencia</span>
          </button>}
          <AccionesDocumento codigo={oc.codigo} nombre={`OC_${oc.codigo}.pdf`} pdfUrlInicial={oc.pdfUrl} onVer={onVer} />
          <a href={oc.url} target="_blank" rel="noopener noreferrer" title="Ver en Mercado Público" aria-label="Ver en Mercado Público"
            className="text-[13px] font-medium text-marca hover:underline inline-flex h-8 items-center gap-1.5 rounded px-1.5">
            <ExternalLink size={16} stroke={1.75} /> <span className="hidden @xl:inline whitespace-nowrap">Mercado Público</span>
          </a>
        </div>
      </div>

      {abierto && (
        <div className="flex gap-4 px-4 py-3 border-t border-linea dark:border-slate-800">
          <MiniaturaOc oc={oc} onVer={onVer} />
          <div className="min-w-0 flex-1 space-y-3">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 @xl:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
              {([
                ['Comprador', [oc.compradorOrganismo, oc.compradorUnidad].filter(Boolean).join(' · ')],
                ['Contacto', [oc.compradorContacto, oc.compradorMail].filter(Boolean).join(' · ')],
                ['Enviada', fmtFecha(oc.fechaEnvio) || fmtFecha(oc.fechaCreacion)],
                ['Aceptada', fmtFecha(oc.fechaAceptacion)],
                ['Tipo', oc.tipo],
              ] as Array<[string, string | null]>).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] text-tinta-3 dark:text-slate-500">{k}</dt>
                  <dd className="text-[13px] font-semibold text-tinta dark:text-slate-100 break-words">{v}</dd>
                </div>
              ))}
            </dl>

            {oc.items.length === 0 ? <p className="text-[13px] text-tinta-2 dark:text-slate-400">Esta orden no trae ítems detallados.</p> : (
              <div className="text-[13px]">
                <div className="hidden @xl:grid grid-cols-[minmax(0,1fr)_56px_112px_120px] gap-3 border-b border-linea pb-1.5 text-[11px] text-tinta-3 dark:border-slate-800 dark:text-slate-500">
                  <span>Ítem</span><span className="text-right">Cant.</span><span className="text-right">Precio neto</span><span className="text-right">Total</span>
                </div>
                {oc.items.map((it, i) => (
                  <div key={i} className="grid grid-cols-1 gap-0.5 border-b border-linea py-2 last:border-b-0 dark:border-slate-800 @xl:grid-cols-[minmax(0,1fr)_56px_112px_120px] @xl:gap-3">
                    <span className="text-tinta dark:text-slate-200 break-words">{it.descripcion || `Ítem ${i + 1}`}</span>
                    <span className="tabular-nums text-tinta-2 dark:text-slate-400 @xl:text-right">{it.cantidad != null ? <><span className="@xl:hidden">Cant. </span>{it.cantidad}</> : ''}</span>
                    <span className="tabular-nums text-tinta-2 dark:text-slate-400 @xl:text-right">{fmtCLP(it.precioNeto, oc.moneda)}</span>
                    <span className="tabular-nums font-semibold text-tinta dark:text-slate-100 @xl:text-right">{fmtCLP(it.total, oc.moneda)}</span>
                  </div>
                ))}
                {oc.totalNeto != null && oc.total != null && (
                  <div className="mt-1 flex justify-end gap-x-6 border-t border-linea pt-2 text-tinta-2 tabular-nums dark:border-slate-800 dark:text-slate-400">
                    <span>Neto {fmtCLP(oc.totalNeto, oc.moneda)}</span>
                    {oc.total !== oc.totalNeto && <span>IVA {fmtCLP(oc.total - oc.totalNeto, oc.moneda)}</span>}
                    <span className="font-semibold text-tinta dark:text-slate-100">Total {fmtCLP(oc.total, oc.moneda)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Pestaña «Aceptación»: arriba las OC por aceptar (la que vence antes primero), abajo las ya aceptadas.
function PestanaAceptacion({ onVer }: { onVer: (doc: VisorDoc) => void }) {
  const [porAceptar, setPorAceptar] = useState<OcAceptacion[]>([]);
  const [aceptadas, setAceptadas] = useState<OcAceptacion[]>([]);
  const [totalPor, setTotalPor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ordenes-compra/aceptacion');
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo cargar');
      setPorAceptar(d.porAceptar || []); setAceptadas(d.aceptadas || []); setTotalPor(d.totalPorAceptar || 0);
      setError(null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Esqueleto key={i} className="h-24 rounded-xl" />)}</div>;
  if (error) return <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>;

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const venceHoy = porAceptar.filter(o => o.limite && o.horas != null && o.horas > 0 && o.limite.slice(0, 10) === hoy).length;
  const vencidas = porAceptar.filter(o => o.horas != null && o.horas <= 0).length;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Por aceptar</h2>
          <span className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
            {totalPor} orden{totalPor !== 1 ? 'es' : ''} · {venceHoy} vence{venceHoy !== 1 ? 'n' : ''} hoy · {vencidas} vencida{vencidas !== 1 ? 's' : ''}
          </span>
        </div>
        {porAceptar.length === 0
          ? <p className="text-[13px] text-tinta-2 dark:text-slate-400 py-4">No hay órdenes pendientes de aceptar.</p>
          : porAceptar.map(oc => <FilaOrden key={oc.codigo} oc={oc} onVer={onVer} etiqueta={etiquetaPlazo(oc)} />)}
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Aceptadas</h2>
          <span className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{aceptadas.length} orden{aceptadas.length !== 1 ? 'es' : ''} · las más recientes primero</span>
        </div>
        {aceptadas.length === 0
          ? <p className="text-[13px] text-tinta-2 dark:text-slate-400 py-4">Todavía no hay órdenes aceptadas.</p>
          : aceptadas.map(oc => (
            <FilaOrden key={oc.codigo} oc={oc} onVer={onVer}
              etiqueta={{ texto: oc.aceptadaEn ? `Aceptada ${fmtFecha(oc.aceptadaEn) ?? ''}`.trim() : 'Aceptada', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' }} />
          ))}
      </section>
    </div>
  );
}

export default function OrdenesCompraPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  // Admin, o perfil de Compras (permiso compras / compras_todo).
  // Solo lectura: no puede copiar OC como experiencia a otras licitaciones.
  const soloLectura = usuario?.rol !== 'admin' && !usuario?.permisos?.compras && !usuario?.permisos?.compras_todo && !usuario?.permisos?.compras_auditor;
  const puedeVer = usuario?.rol === 'admin' || !!usuario?.permisos?.compras || !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras_ver || !!usuario?.permisos?.compras_auditor;

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
  const [pestana, setPestana] = useState<'todas' | 'aceptacion'>('todas');

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
        <div className="mx-auto max-w-5xl space-y-3 p-4 sm:p-6"><Esqueleto className="h-7 w-56" />{Array.from({ length: 4 }).map((_, i) => <Esqueleto key={i} className="h-24 rounded-xl" />)}</div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Órdenes de compra' }]}>
      <div className="@container w-full px-4 py-4 @3xl:px-8 @3xl:py-6 max-w-[1800px] mx-auto space-y-4">
        <Encabezado
          titulo="Órdenes de compra"
          descripcion={loading ? 'Cargando…' : `${total} orden${total !== 1 ? 'es' : ''}${hayFiltro ? ' con estos filtros' : ''} · ${fmtCLP(sumaTotal)}`}
          acciones={pestana === 'todas' ? (
            <div className="relative w-full @xl:w-80">
              <Search size={16} stroke={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar órdenes de compra"
                placeholder="Buscar código, organismo o ítem…"
                className={`w-full pl-9 pr-3 ${CAMPO} placeholder:text-tinta-3`} />
            </div>
          ) : undefined}
        />

        <Pestanas id="oc" valor={pestana} onCambio={setPestana}
          opciones={[{ valor: 'todas', etiqueta: 'Todas' }, { valor: 'aceptacion', etiqueta: 'Aceptación' }]} />

        {pestana === 'aceptacion' ? <PestanaAceptacion onVer={setVisorDoc} /> : <>
        {migracionPendiente && <Banner variante="warning">Falta aplicar la migración de órdenes de compra en la base de datos.</Banner>}
        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: () => cargar(0) }}>{error}</Banner>}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-tinta-2 dark:text-slate-400 flex items-center gap-1.5 mr-1"><Filter size={16} stroke={1.75} className="text-slate-400" /> Filtros</span>

          <Select value={empresaId} onChange={setEmpresaId} minWidth={180}
            placeholder="Todas las empresas"
            options={[{ value: '', label: 'Todas las empresas' }, ...empresas.map(e => ({ value: String(e.id), label: e.razon_social }))]} />

          <Select value={estado} onChange={setEstado} minWidth={190}
            placeholder="Todos los estados"
            options={[{ value: '', label: 'Todos los estados' }, ...ESTADOS_OC]} />

          <div className={`flex items-center gap-1.5 px-2.5 ${CAMPO}`}>
            <Calendar size={16} stroke={1.75} className="text-slate-400 flex-shrink-0" />
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} max={hasta || undefined}
              className="text-[13px] text-tinta dark:text-slate-100 bg-transparent outline-none w-[118px]" title="Emitida desde" aria-label="Emitida desde" />
            <span className="text-tinta-3">–</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} min={desde || undefined}
              className="text-[13px] text-tinta dark:text-slate-100 bg-transparent outline-none w-[118px]" title="Emitida hasta" aria-label="Emitida hasta" />
            {(desde || hasta) && (
              <button onClick={() => { setDesde(''); setHasta(''); }} aria-label="Quitar rango" title="Quitar rango" className="text-slate-400 hover:text-urgente flex-shrink-0"><X size={16} stroke={1.75} /></button>
            )}
          </div>

          <label className={`flex items-center gap-2 px-2.5 text-[13px] font-medium text-tinta dark:text-slate-100 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 ${CAMPO}`}>
            <input type="checkbox" checked={incluirTerceros} onChange={e => setIncluirTerceros(e.target.checked)} className="accent-teal-600" />
            Incluir de terceros
          </label>

          {hayFiltro && (
            <Boton variante="fantasma" onClick={limpiar} icono={<X size={16} stroke={1.75} />}>Limpiar</Boton>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Esqueleto key={i} className="h-24 rounded-xl" />)}</div>
        ) : ordenes.length === 0 ? (
          <Vacio icono={<Receipt size={28} stroke={1.75} />}
            titulo={hayFiltro ? 'Sin resultados' : 'Todavía no hay órdenes de compra'}
            texto={hayFiltro ? 'Prueba ajustando los filtros.' : 'El cron diario revisa Mercado Público y las trae solas.'}
            accion={hayFiltro ? <Boton tamano="sm" onClick={limpiar}>Quitar filtros</Boton> : undefined} />
        ) : (
          <>
            <div className="space-y-2">
              {ordenes.map(oc => (
                <FilaOrden key={oc.codigo} oc={oc} onVer={setVisorDoc} onEnviarExperiencia={soloLectura ? undefined : setExperienciaOC} />
              ))}
            </div>
            {ordenes.length < total && (
              <div className="flex justify-center pt-2">
                <Boton onClick={() => cargar(ordenes.length)} disabled={loadingMore}
                  icono={loadingMore ? <Loader2 size={16} className="animate-spin" /> : undefined}>
                  {loadingMore ? 'Cargando…' : `Cargar más (${ordenes.length} de ${total})`}
                </Boton>
              </div>
            )}
          </>
        )}
        </>}
      </div>

      <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />
      {experienciaOC && <EnviarExperienciaModal oc={experienciaOC} onClose={() => setExperienciaOC(null)} />}
    </AppLayout>
  );
}
