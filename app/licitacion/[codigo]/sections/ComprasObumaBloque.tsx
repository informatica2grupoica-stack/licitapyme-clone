'use client';

// Bloque "Compras (Obuma)" — el otro lado de OrdenesCompraBloque: mientras esa muestra lo que el
// organismo nos COMPRA (la venta), esta muestra lo que NOSOTROS compramos en nuestro ERP para
// cumplir esa licitación (el costo real: proveedor, ítems, monto). Los datos los deja el cron
// (app/lib/obuma-compras.ts) — acá solo se leen de nuestra base.
import { useEffect, useState } from 'react';
import { ShoppingBag, Building2, Package, Loader2, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { useRealtime } from '@/app/lib/use-realtime';
import { FacturaObumaModal } from './FacturaObumaModal';

interface ItemCompra { descripcion: string; cantidad: number | null; precio: number | null; subtotal: number | null }
interface FacturaObuma {
  tipoDcto: string; folioDte: string; dteId: string;
  total: number | null; fecha: string | null;
  proveedorRazonSocial: string | null; proveedorRut: string | null;
  s3Link: string | null;
}
interface CompraObuma {
  compraOcId: string;
  folio: string | null;
  fechaIngreso: string | null;
  referencia: string | null;
  estado: string | null;
  neto: number | null;
  total: number | null;
  proveedorRut: string | null;
  proveedorRazonSocial: string | null;
  items: ItemCompra[];
  facturas: FacturaObuma[];
}

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (f: string | null) => {
  if (!f) return null;
  try { return new Date(f).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }); } catch { return null; }
};

function FilaCompra({ c, onVerFactura }: { c: CompraObuma; onVerFactura: (dteId: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-white">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-sky-50 text-sky-700">
          <ShoppingBag size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-slate-800 font-mono">Folio {c.folio || c.compraOcId}</span>
            {c.estado && (
              <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200">
                {c.estado}
              </span>
            )}
          </div>
          {c.proveedorRazonSocial && (
            <p className="mt-1 text-[12px] text-slate-600 flex items-center gap-1.5 min-w-0">
              <Building2 size={12} className="flex-shrink-0 text-slate-400" />
              <span className="truncate" title={c.proveedorRazonSocial}>
                {c.proveedorRazonSocial}{c.proveedorRut ? ` · ${c.proveedorRut}` : ''}
              </span>
            </p>
          )}
          {fmtFecha(c.fechaIngreso) && <p className="mt-0.5 text-[11.5px] text-slate-400">Ingresada el {fmtFecha(c.fechaIngreso)}</p>}
          {c.referencia && <p className="mt-0.5 text-[11px] text-slate-400 truncate" title={c.referencia}>Ref: {c.referencia}</p>}
        </div>
        <div className="text-right whitespace-nowrap">
          <span className="block text-[14px] font-bold text-slate-800">{fmtCLP(c.total)}</span>
          {c.neto != null && c.neto !== c.total && (
            <span className="block text-[11px] text-slate-400">neto {fmtCLP(c.neto)}</span>
          )}
        </div>
      </div>

      {(c.items.length > 0 || c.facturas.length > 0) && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-2 border-t border-slate-100 bg-slate-50/60">
          {c.items.length > 0 && (
            <button onClick={() => setAbierto(o => !o)}
              className="text-[11.5px] font-semibold text-slate-600 hover:text-slate-800 inline-flex items-center gap-1">
              <Package size={12} /> {c.items.length} ítem{c.items.length !== 1 ? 's' : ''}
              {abierto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          {c.facturas.map(f => (
            f.s3Link ? (
              <button key={f.dteId} type="button" onClick={() => onVerFactura(f.dteId)}
                title={`Ver la factura${f.total != null ? ` · ${fmtCLP(f.total)}` : ''}`}
                className="text-[11.5px] font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                <FileText size={12} /> Factura {f.folioDte}
              </button>
            ) : (
              <span key={f.dteId} className="text-[11.5px] text-slate-400 inline-flex items-center gap-1">
                <FileText size={12} /> Factura {f.folioDte} (sin XML)
              </span>
            )
          ))}
        </div>
      )}
      {abierto && c.items.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 space-y-1.5">
          {c.items.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 text-[12px]">
              <span className="text-slate-700 min-w-0" title={it.descripcion}>{it.descripcion || `Ítem ${i + 1}`}</span>
              <span className="text-slate-500 whitespace-nowrap">
                {it.cantidad != null ? `${it.cantidad} × ` : ''}{fmtCLP(it.precio)}
                {it.subtotal != null && <b className="ml-2 text-slate-700">{fmtCLP(it.subtotal)}</b>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComprasObumaBloque({ codigo }: { codigo: string }) {
  const [compras, setCompras] = useState<CompraObuma[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [facturaAbierta, setFacturaAbierta] = useState<{ compraOcId: string; dteId: string } | null>(null);

  const cargar = () => {
    fetch(`/api/obuma-compras?codigo=${encodeURIComponent(codigo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setCompras(d?.success ? (d.compras || []) : []))
      .catch(() => setCompras([]))
      .finally(() => setCargando(false));
  };
  useEffect(() => { setCargando(true); cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [codigo]);
  // El cron avisa por SSE cuando guarda una compra nueva, mismo canal que las OC de MP.
  useRealtime(cargar, { intervaloMs: 300_000 });

  if (cargando) return null;
  // Sin compras cruzadas: no se muestra nada (a diferencia de OrdenesCompraBloque, que siempre
  // explica el estado) — la mayoría de las licitaciones no van a tener una compra en Obuma
  // referenciada, y un bloque vacío en cada ficha sería ruido, no información.
  if (!compras || compras.length === 0) return null;

  const total = compras.reduce((s, c) => s + (c.total || 0), 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <ShoppingBag size={15} className="text-slate-400" />
        <span className="text-[13px] font-bold text-slate-700">Compras (Obuma)</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
          {compras.length} compra{compras.length !== 1 ? 's' : ''}
        </span>
        <span className="ml-auto text-[12.5px] font-bold text-slate-800">{fmtCLP(total)}</span>
      </div>
      <p className="px-5 py-2.5 text-[11.5px] text-slate-400 border-b border-slate-100">
        Lo que compramos en nuestro ERP para esta licitación — el costo real, cruzado por la
        referencia que se escribe al crear la orden de compra en Obuma.
      </p>
      <div className="p-3 space-y-2">
        {compras.map(c => (
          <FilaCompra key={c.compraOcId} c={c}
            onVerFactura={dteId => setFacturaAbierta({ compraOcId: c.compraOcId, dteId })} />
        ))}
      </div>

      {facturaAbierta && (
        <FacturaObumaModal codigo={codigo} compraOcId={facturaAbierta.compraOcId} dteId={facturaAbierta.dteId}
          onClose={() => setFacturaAbierta(null)} />
      )}
    </div>
  );
}
