'use client';

// Factura de venta al cliente final: se sube acá, se ve en miniatura y al subirla se marca sola la tarea «Factura y cierre del proyecto».
import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { MiniaturaDoc, urlInline } from './MiniaturaDoc';
import { FacturaVisor } from './FacturaVisor';
import { IconReceipt as Receipt, IconFileCode as FileCode, IconUpload as Upload, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconTrash as Trash2, IconDownload as Download } from '@tabler/icons-react';

interface Factura { id: number; archivoUrl: string; archivoNombre: string; numero: string | null; emitidaAt: string | null; pagadaAt: string | null; subidaPorNombre: string | null; creadaAt: string; origen: 'OBUMA' | 'MANUAL'; xmlUrl: string | null }

interface FacturaObuma { tipo: 33 | 34; folio: string; fecha: string; neto: number; total: number; pagado: boolean; anulada: boolean; ocReferida: string | null; yaCargada: boolean }

const esPdf = (n: string) => /\.pdf$/i.test(n);
const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
const fechaCl = (f: string) => f.split('-').reverse().join('-');

export function FacturaVentaCard({ negocioId, puedeOperar, razonSocialFactura }: { negocioId: number; puedeOperar: boolean; razonSocialFactura?: string | null }) {
  const toast = useToast();
  const { recargar } = useCompras();
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const [verXml, setVerXml] = useState<number | null>(null);
  const [numero, setNumero] = useState('');
  const [emitidaAt, setEmitidaAt] = useState('');
  const [pagadaAt, setPagadaAt] = useState('');
  const archivo = useRef<HTMLInputElement>(null);
  const [obuma, setObuma] = useState<{ ocs: string[]; facturas: FacturaObuma[]; error?: string } | null>(null);
  const [cargandoFolio, setCargandoFolio] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/factura-venta`).then(r => r.json()).then(d => { if (vivo && d?.success) setFacturas(d.facturas || []); })
      .catch(() => {}).finally(() => vivo && setCargando(false));
    // Aparte: Obuma tarda unos segundos y no debe atrasar la tarjeta.
    fetch(`/api/compras/${negocioId}/factura-venta/obuma`).then(r => r.json())
      .then(d => { if (vivo) setObuma(d?.success ? { ocs: d.ocs || [], facturas: d.facturas || [] } : { ocs: [], facturas: [], error: d?.error || 'No se pudo consultar Obuma.' }); })
      .catch(() => { if (vivo) setObuma({ ocs: [], facturas: [], error: 'No se pudo consultar Obuma.' }); });
    return () => { vivo = false; };
  }, [negocioId]);

  const cargarDeObuma = async (f: FacturaObuma) => {
    setCargandoFolio(f.folio);
    try {
      const res = await fetch(`/api/compras/${negocioId}/factura-venta/obuma`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: f.tipo, folio: f.folio }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo cargar');
      setFacturas(d.facturas || []);
      if (d.obuma) setObuma({ ocs: d.obuma.ocs || [], facturas: d.obuma.facturas || [] });
      toast.success(`Factura ${f.folio} cargada desde Obuma`, d.tareaMarcada ? 'La tarea «Factura y cierre del proyecto» quedó marcada como hecha.' : undefined);
      recargar();
    } catch (e: any) {
      toast.error('No se pudo cargar la factura', e.message);
    } finally { setCargandoFolio(null); }
  };

  const subir = async (f: File) => {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('file', f); fd.append('numero', numero); fd.append('emitidaAt', emitidaAt); fd.append('pagadaAt', pagadaAt);
      const res = await fetch(`/api/compras/${negocioId}/factura-venta`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo subir');
      setFacturas(d.facturas || []); setNumero(''); setEmitidaAt(''); setPagadaAt('');
      toast.success('Factura subida', d.tareaMarcada ? 'La tarea «Factura y cierre del proyecto» quedó marcada como hecha.' : undefined);
      recargar();
    } catch (e: any) {
      toast.error('No se pudo subir la factura', e.message);
    } finally {
      setSubiendo(false);
      if (archivo.current) archivo.current.value = '';
    }
  };

  const guardarPago = async (id: number, pagadaAt: string) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/factura-venta`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pagadaAt }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo guardar');
      setFacturas(d.facturas || []);
    } catch (e: any) { toast.error('No se pudo guardar la fecha de pago', e.message); }
  };

  const quitar = async (id: number) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/factura-venta?id=${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo quitar');
      setFacturas(d.facturas || []);
    } catch (e: any) { toast.error('No se pudo quitar la factura', e.message); }
  };

  if (cargando) return null;

  return (
    <div className="bg-white border border-linea rounded-2xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800 overflow-hidden mb-3" data-testid="factura-venta">
      <div className="px-5 pt-4">
        <p className="flex items-center gap-2 text-[12.5px] font-medium text-tinta-2 dark:text-slate-300"><Receipt size={15} className="text-slate-400" /> Factura de venta al cliente</p>
        <p className="text-xs text-tinta-2 dark:text-slate-400 mt-1">
          Sube aquí la factura emitida{razonSocialFactura ? ` a nombre de ${razonSocialFactura}` : ''}. Al subirla, la tarea «Factura y cierre del proyecto» se marca sola como hecha.
        </p>
      </div>
      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-linea dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 px-4 py-3" data-testid="factura-venta-obuma">
          <p className="text-[12px] font-semibold text-tinta dark:text-slate-200">En Obuma</p>
          {!obuma && <p className="flex items-center gap-1.5 text-[11.5px] text-tinta-2 mt-1"><Loader2 size={12} className="animate-spin" /> Buscando la factura en Obuma…</p>}
          {obuma?.error && <p className="text-[11.5px] text-amber-700 mt-1">{obuma.error}</p>}
          {obuma && !obuma.error && obuma.ocs.length === 0 && <p className="text-[11.5px] text-tinta-2 mt-1">Esta licitación todavía no tiene OC del cliente, así que no hay factura que buscar.</p>}
          {obuma && !obuma.error && obuma.ocs.length > 0 && obuma.facturas.length === 0 && (
            <p className="text-[11.5px] text-tinta-2 mt-1">Obuma todavía no tiene una factura con la OC {obuma.ocs.join(', ')}.</p>
          )}
          {obuma && obuma.facturas.length > 0 && (
            <ul className="mt-2 divide-y divide-linea dark:divide-slate-800">
              {obuma.facturas.map(f => (
                <li key={`${f.tipo}-${f.folio}`} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[12px] ${f.anulada ? 'text-slate-400' : 'text-tinta dark:text-slate-200'}`}>
                  <span className="font-semibold tabular-nums min-w-[110px]">{f.tipo === 34 ? 'Exenta' : 'Factura'} {f.folio}</span>
                  <span className="tabular-nums">{fechaCl(f.fecha)}</span>
                  <span className="tabular-nums">{pesos(f.neto)} neto</span>
                  <span className="text-tinta-2">OC {f.ocReferida}</span>
                  {f.anulada ? <span>Anulada con nota de crédito</span>
                    : <span className={f.pagado ? 'text-emerald-700' : 'text-amber-700'}>{f.pagado ? 'Pagada' : 'Por cobrar'}</span>}
                  <span className="ml-auto">
                    {f.yaCargada ? <span className="flex items-center gap-1 text-emerald-700 font-medium"><CheckCircle2 size={13} /> Cargada</span>
                      : !f.anulada && puedeOperar && (
                        <button type="button" onClick={() => cargarDeObuma(f)} disabled={cargandoFolio !== null}
                          className="flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 hover:text-teal-800 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                          {cargandoFolio === f.folio ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Cargar esta factura
                        </button>)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {facturas.length > 0 && (
          <div className="flex gap-4 flex-wrap">
            {facturas.map(f => (
              <div key={f.id} className="flex gap-3">
                {/* Traída de Obuma (con XML): se ve la factura dibujada por Licitank. Subida a mano: se ve el PDF. */}
                <MiniaturaDoc src={esPdf(f.archivoNombre) ? urlInline(f.archivoUrl) : null} titulo={f.numero ? `Factura ${f.numero}` : f.archivoNombre.replace(/\.[^.]+$/, '')}
                  detalle={f.emitidaAt ? `Emitida ${f.emitidaAt}` : f.creadaAt}
                  onAbrir={() => f.origen === 'OBUMA' && f.xmlUrl ? setVerXml(f.id) : setVisor({ nombre: f.archivoNombre, url: f.archivoUrl })} />
                <div className="text-[11.5px] text-zinc-500 space-y-1.5 min-w-[170px]">
                  <p className="text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 size={13} /> {f.origen === 'OBUMA' ? 'Traída de Obuma' : `Subida por ${f.subidaPorNombre || '—'}`}</p>
                  {f.origen === 'OBUMA' && f.xmlUrl && (
                    <p className="flex items-center gap-3">
                      <button type="button" onClick={() => setVerXml(f.id)} className="font-semibold text-teal-700 hover:text-teal-900">Ver factura</button>
                      <button type="button" onClick={() => setVisor({ nombre: f.archivoNombre, url: f.archivoUrl })} className="hover:text-zinc-800">PDF</button>
                      <a href={f.xmlUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-zinc-800"><FileCode size={12} /> XML</a>
                    </p>)}
                  <label className="block">Pago del cliente
                    <input type="date" defaultValue={f.pagadaAt || ''} disabled={!puedeOperar} onBlur={e => { if (e.target.value !== (f.pagadaAt || '')) guardarPago(f.id, e.target.value); }}
                      className="block mt-0.5 text-[12px] border border-zinc-200 rounded-lg px-2 py-1 text-zinc-700" />
                  </label>
                  {!f.pagadaAt && <p className="text-amber-600">Falta registrar cuándo pagó el cliente.</p>}
                  {puedeOperar && <button type="button" onClick={() => quitar(f.id)} className="flex items-center gap-1 text-zinc-400 hover:text-rose-600"><Trash2 size={12} /> Quitar</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {puedeOperar && (
          <div className="space-y-2">
            {facturas.length === 0 && <p className="text-[12px] font-semibold text-zinc-700">Todavía no se sube la factura de venta.</p>}
            <div className="grid gap-2 sm:grid-cols-3">
              <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="N° de factura (opcional)" className="text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <label className="text-[11px] text-zinc-500">Fecha de emisión (opcional)
                <input type="date" value={emitidaAt} onChange={e => setEmitidaAt(e.target.value)} className="block w-full mt-0.5 text-[12px] border border-zinc-200 rounded-lg px-2 py-1 text-zinc-700" /></label>
              <label className="text-[11px] text-zinc-500">Fecha de pago del cliente (opcional)
                <input type="date" value={pagadaAt} onChange={e => setPagadaAt(e.target.value)} className="block w-full mt-0.5 text-[12px] border border-zinc-200 rounded-lg px-2 py-1 text-zinc-700" /></label>
            </div>
            <input ref={archivo} type="file" accept=".pdf,.xml,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); }} />
            <button type="button" onClick={() => archivo.current?.click()} disabled={subiendo}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3.5 py-2 rounded-lg">
              {subiendo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {facturas.length === 0 ? 'Subir la factura (PDF)' : 'Subir otra factura'}
            </button>
          </div>
        )}
        {!puedeOperar && facturas.length === 0 && <p className="text-[12px] text-zinc-500">Todavía no se sube la factura de venta.</p>}
      </div>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
      {verXml !== null && <FacturaVisor negocioId={negocioId} urlDatos={`/api/compras/${negocioId}/factura-venta/visor?id=${verXml}`} onCerrar={() => setVerXml(null)} />}
    </div>
  );
}
