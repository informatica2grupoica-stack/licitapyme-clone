'use client';

// Vista detallada de una factura (DTE) cruzada desde Obuma — reemplaza abrir el XML crudo
// (ilegible para cualquiera que no sea un sistema) por una representación real de la factura:
// emisor/receptor, detalle de ítems, totales. El XML se pide a /api/obuma-compras/factura, que lo
// baja y lo parsea server-side (app/lib/dte-parser.ts) — acá solo se pinta.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, FileCode2, Building2, ArrowRight } from 'lucide-react';

interface DteItem { descripcion: string; detalle: string | null; cantidad: number | null; unidad: string | null; precioUnitario: number | null; monto: number | null; exento: boolean }
interface DteReferencia { tipo: string | null; folio: string | null; fecha: string | null; razon: string | null }
interface DteParte { rut: string | null; razonSocial: string | null; giro: string | null; direccion: string | null; comuna: string | null; ciudad: string | null }
interface DteParseado {
  tipoDte: string | null; tipoDteNombre: string; folio: string | null;
  fechaEmision: string | null; fechaVencimiento: string | null; formaPago: string | null;
  emisor: DteParte; receptor: DteParte;
  totales: { neto: number | null; exento: number | null; iva: number | null; tasaIva: number | null; total: number | null };
  detalle: DteItem[]; referencias: DteReferencia[];
}

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (f: string | null) => {
  if (!f) return null;
  try { return new Date(`${f}T00:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }); }
  catch { return f; }
};

function BloqueParte({ titulo, parte }: { titulo: string; parte: DteParte }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1.5">
        <Building2 size={11} /> {titulo}
      </p>
      <p className="text-[13.5px] font-bold text-slate-800">{parte.razonSocial || '—'}</p>
      {parte.rut && <p className="text-[12px] text-slate-500 font-mono mt-0.5">{parte.rut}</p>}
      {parte.giro && <p className="text-[11.5px] text-slate-500 mt-1">{parte.giro}</p>}
      {(parte.direccion || parte.comuna) && (
        <p className="text-[11.5px] text-slate-400 mt-1">
          {[parte.direccion, parte.comuna, parte.ciudad].filter(Boolean).join(', ')}
        </p>
      )}
    </div>
  );
}

export function FacturaObumaModal({ codigo, compraOcId, dteId, onClose }: {
  codigo: string; compraOcId: string; dteId: string; onClose: () => void;
}) {
  const [factura, setFactura] = useState<DteParseado | null>(null);
  const [s3Link, setS3Link] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/obuma-compras/factura?codigo=${encodeURIComponent(codigo)}&compraOcId=${encodeURIComponent(compraOcId)}&dteId=${encodeURIComponent(dteId)}`)
      .then(r => r.json())
      .then(d => {
        if (!vivo) return;
        if (d?.success) { setFactura(d.factura); setS3Link(d.s3Link); }
        else setError(d?.error || 'No se pudo cargar la factura');
      })
      .catch(() => { if (vivo) setError('Error de red al pedir la factura'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [codigo, compraOcId, dteId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl my-0 sm:my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 sticky top-0 bg-white sm:rounded-t-2xl">
          <span className="text-[13px] font-bold text-slate-700">
            {factura ? factura.tipoDteNombre : 'Factura'}{factura?.folio ? ` N° ${factura.folio}` : ''}
          </span>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {cargando && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-[13px]">
              <Loader2 size={16} className="animate-spin" /> Cargando la factura…
            </div>
          )}

          {!cargando && error && (
            <div className="flex items-start gap-2 text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px]">
              <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {!cargando && factura && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  {fmtFecha(factura.fechaEmision) && (
                    <p className="text-[12.5px] text-slate-500">Emitida el {fmtFecha(factura.fechaEmision)}</p>
                  )}
                  {factura.formaPago && <p className="text-[12px] text-slate-400">Forma de pago: {factura.formaPago}</p>}
                </div>
                <span className="text-[20px] font-bold text-slate-800">{fmtCLP(factura.totales.total)}</span>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <BloqueParte titulo="Emisor (proveedor)" parte={factura.emisor} />
                <BloqueParte titulo="Receptor (nosotros)" parte={factura.receptor} />
              </div>

              {factura.detalle.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-[10.5px] uppercase tracking-wide">
                        <th className="text-left font-bold px-3 py-2">Descripción</th>
                        <th className="text-right font-bold px-3 py-2 whitespace-nowrap">Cant.</th>
                        <th className="text-right font-bold px-3 py-2 whitespace-nowrap">Precio unit.</th>
                        <th className="text-right font-bold px-3 py-2 whitespace-nowrap">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {factura.detalle.map((it, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-700">
                            {it.descripcion}
                            {it.detalle && it.detalle !== it.descripcion && (
                              <span className="block text-[11px] text-slate-400">{it.detalle}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{it.cantidad ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmtCLP(it.precioUnitario)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">{fmtCLP(it.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-end">
                <div className="w-full sm:w-64 space-y-1 text-[12.5px]">
                  {factura.totales.neto != null && (
                    <div className="flex justify-between text-slate-500"><span>Neto</span><span>{fmtCLP(factura.totales.neto)}</span></div>
                  )}
                  {factura.totales.exento != null && (
                    <div className="flex justify-between text-slate-500"><span>Exento</span><span>{fmtCLP(factura.totales.exento)}</span></div>
                  )}
                  {factura.totales.iva != null && (
                    <div className="flex justify-between text-slate-500">
                      <span>IVA{factura.totales.tasaIva != null ? ` (${factura.totales.tasaIva}%)` : ''}</span>
                      <span>{fmtCLP(factura.totales.iva)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200">
                    <span>Total</span><span>{fmtCLP(factura.totales.total)}</span>
                  </div>
                </div>
              </div>

              {factura.referencias.length > 0 && (
                <div className="pt-1">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Referencias</p>
                  <div className="flex flex-wrap gap-1.5">
                    {factura.referencias.map((r, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11.5px] text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">
                        <ArrowRight size={10} /> {r.razon || r.tipo} N° {r.folio}{fmtFecha(r.fecha) ? ` · ${fmtFecha(r.fecha)}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {s3Link && (
                <div className="pt-2 border-t border-slate-100">
                  <a href={s3Link} target="_blank" rel="noopener noreferrer"
                    className="text-[11.5px] font-semibold text-slate-400 hover:text-slate-600 inline-flex items-center gap-1">
                    <FileCode2 size={12} /> Ver el XML original
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
