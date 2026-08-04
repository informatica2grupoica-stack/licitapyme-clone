'use client';

// Bloque "Órdenes de compra" dentro de la sección Resultado. Es el cierre real del ciclo: la
// adjudicación dice que ganamos, la orden de compra es la venta. Los datos los deja el cron
// (app/lib/ordenes-compra.ts) — acá solo se leen de nuestra base, porque la API de Mercado Público
// no permite consultar las órdenes de UNA licitación en vivo.
//
// Los ítems y el organismo comprador se muestran completos a propósito: son exactamente lo que
// después alimenta los certificados de experiencia de la memoria comercial.
import { useEffect, useState } from 'react';
import { Receipt, ExternalLink, ChevronDown, ChevronUp, Building2, Package, Loader2 } from 'lucide-react';
import { useRealtime } from '@/app/lib/use-realtime';

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
}

// Color por estado, con el mismo criterio de siempre: verde = cerrado a favor, ámbar = en curso,
// rojo = se cayó. Los códigos son los de la API (ver ESTADOS_OC en app/lib/ordenes-compra.ts).
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

function FilaOrden({ oc }: { oc: OrdenCompra }) {
  const [abierto, setAbierto] = useState(false);
  const c = colorEstado(oc.codigoEstado);
  const fecha = fmtFecha(oc.fechaEnvio) || fmtFecha(oc.fechaCreacion);

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-white">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.fondo} ${c.texto}`}>
          <Receipt size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-slate-800 font-mono">{oc.codigo}</span>
            {oc.estado && (
              <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${c.fondo} ${c.texto} ${c.borde}`}>
                {oc.estado}
              </span>
            )}
            {oc.tipo && <span className="text-[10.5px] text-slate-400">{oc.tipo}</span>}
          </div>
          {oc.compradorOrganismo && (
            <p className="mt-1 text-[12px] text-slate-600 flex items-center gap-1.5 min-w-0">
              <Building2 size={12} className="flex-shrink-0 text-slate-400" />
              <span className="truncate" title={`${oc.compradorOrganismo}${oc.compradorUnidad ? ` · ${oc.compradorUnidad}` : ''}`}>
                {oc.compradorOrganismo}{oc.compradorUnidad ? ` · ${oc.compradorUnidad}` : ''}
              </span>
            </p>
          )}
          {fecha && <p className="mt-0.5 text-[11.5px] text-slate-400">Emitida el {fecha}</p>}
        </div>
        <div className="text-right whitespace-nowrap">
          <span className="block text-[14px] font-bold text-slate-800">{fmtCLP(oc.total, oc.moneda)}</span>
          {oc.totalNeto != null && oc.totalNeto !== oc.total && (
            <span className="block text-[11px] text-slate-400">neto {fmtCLP(oc.totalNeto, oc.moneda)}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 bg-slate-50/60">
        {oc.items.length > 0 && (
          <button onClick={() => setAbierto(o => !o)}
            className="text-[11.5px] font-semibold text-slate-600 hover:text-slate-800 inline-flex items-center gap-1">
            <Package size={12} /> {oc.items.length} ítem{oc.items.length !== 1 ? 's' : ''}
            {abierto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
        <a href={oc.url} target="_blank" rel="noopener noreferrer"
          className="ml-auto text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
          <ExternalLink size={12} /> Ver en Mercado Público
        </a>
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

export function OrdenesCompraBloque({ codigo }: { codigo: string }) {
  const [ordenes, setOrdenes] = useState<OrdenCompra[] | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = () => {
    fetch(`/api/ordenes-compra?codigo=${encodeURIComponent(codigo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setOrdenes(d?.success ? (d.ordenes || []) : []))
      .catch(() => setOrdenes([]))
      .finally(() => setCargando(false));
  };
  useEffect(() => { setCargando(true); cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [codigo]);
  // El cron avisa por SSE cuando guarda una orden nueva — el bloque se repinta solo, sin recargar.
  // El respaldo por intervalo va largo (5 min, no los 60 s por defecto): una orden de compra
  // aparece una vez al día como mucho, no tiene sentido preguntar cada minuto.
  useRealtime(cargar, { intervaloMs: 300_000 });

  if (cargando) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-2 text-[13px] text-slate-500">
        <Loader2 size={15} className="animate-spin" /> Buscando órdenes de compra…
      </div>
    );
  }

  // NUESTRAS vs de terceros: una orden de esta misma licitación puede ser del competidor que ganó
  // (se detecta por el RUT del proveedor, ver es_nuestra en app/lib/ordenes-compra.ts). Sumar las
  // dos en un mismo total sería contar como venta propia la venta de otro.
  const nuestras = (ordenes || []).filter(o => o.esNuestra);
  const ajenas = (ordenes || []).filter(o => !o.esNuestra);
  const total = nuestras.reduce((s, o) => s + (o.total || 0), 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <Receipt size={15} className="text-slate-400" />
        <span className="text-[13px] font-bold text-slate-700">Órdenes de compra</span>
        {nuestras.length > 0 && (
          <>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{nuestras.length} nuestra{nuestras.length !== 1 ? 's' : ''}</span>
            <span className="ml-auto text-[12.5px] font-bold text-slate-800">{fmtCLP(total)}</span>
          </>
        )}
      </div>

      {nuestras.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-slate-500">
          Todavía no aparece ninguna orden de compra a nuestro nombre en esta licitación. El
          organismo la emite después de adjudicar, a veces semanas más tarde —
          <b> se revisa solo todos los días</b> y te llega un aviso en la campana y por correo
          apenas se emita.
        </p>
      ) : (
        <div className="p-3 space-y-2">
          {nuestras.map(oc => <FilaOrden key={oc.codigo} oc={oc} />)}
        </div>
      )}

      {ajenas.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-3">
          <p className="px-2 pb-2 text-[11.5px] text-slate-400">
            Otras órdenes de esta licitación ({ajenas.length}) — emitidas a otros proveedores, se
            muestran como referencia de lo que efectivamente compró el organismo.
          </p>
          <div className="space-y-2 opacity-75">
            {ajenas.map(oc => (
              <div key={oc.codigo} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                <div className="min-w-0">
                  <span className="text-[12px] font-semibold text-slate-700 font-mono">{oc.codigo}</span>
                  <p className="text-[11.5px] text-slate-500 truncate" title={oc.proveedorNombre || ''}>{oc.proveedorNombre || 'Otro proveedor'}</p>
                </div>
                <div className="text-right whitespace-nowrap">
                  <span className="block text-[12.5px] font-bold text-slate-700">{fmtCLP(oc.total, oc.moneda)}</span>
                  {oc.estado && <span className="block text-[10.5px] text-slate-400">{oc.estado}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
