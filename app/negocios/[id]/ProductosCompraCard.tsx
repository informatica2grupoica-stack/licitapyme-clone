'use client';

// PRODUCTOS Y COBERTURA (spec §14) — un producto/línea ganada por fila, con su subestado de
// cumplimiento. "Cobertura total o nada": el proyecto solo es entregable cuando TODOS los
// productos vigentes (no renunciados) llegan a ENTREGADO.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Package, Loader2, X, Flag } from 'lucide-react';

type Subestado = 'PENDIENTE' | 'COTIZANDO' | 'COMPRADO' | 'EN_BODEGA' | 'LISTO_ENTREGA' | 'ENTREGADO' | 'RENUNCIADO';

interface Producto {
  id: number; correlativo: number | null; descripcion: string; cantidad: number | null; unidad: string | null;
  montoUnitario: number | null; subestado: Subestado;
  renunciaMotivo: string | null; renunciaPropuestaPorNombre: string | null; renunciaAprobadaPorNombre: string | null;
}
interface Cobertura { total: number; listos: number; renunciados: number; cobertura: boolean }

const SUBESTADO_LABEL: Record<Subestado, string> = {
  PENDIENTE: 'Pendiente', COTIZANDO: 'Cotizando', COMPRADO: 'Comprado', EN_BODEGA: 'En bodega',
  LISTO_ENTREGA: 'Listo para entrega', ENTREGADO: 'Entregado', RENUNCIADO: 'Renunciado',
};
const OPCIONES_SUBESTADO = (Object.keys(SUBESTADO_LABEL) as Subestado[])
  .filter(s => s !== 'RENUNCIADO').map(s => ({ value: s, label: SUBESTADO_LABEL[s] }));

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ProductosCompraCard({ negocioId, puedeOperar, esJefeDeVentas }: { negocioId: number; puedeOperar: boolean; esJefeDeVentas: boolean }) {
  const toast = useToast();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cobertura, setCobertura] = useState<Cobertura | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState<number | null>(null);
  const [renunciaAbierta, setRenunciaAbierta] = useState<number | null>(null);
  const [motivoRenuncia, setMotivoRenuncia] = useState('');

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/productos`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProductos(data.productos || []);
      setCobertura(data.cobertura || null);
    } catch (e: any) {
      toast.error('No se pudieron cargar los productos', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (body: Record<string, unknown>) => {
    const productoId = body.productoId as number;
    setGuardando(productoId);
    try {
      const res = await fetch(`/api/compras/${negocioId}/productos`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      setProductos(data.productos); setCobertura(data.cobertura);
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
    } finally {
      setGuardando(null);
    }
  };

  const proponerRenuncia = async (productoId: number) => {
    if (!motivoRenuncia.trim()) return;
    await accion({ productoId, accion: 'proponer_renuncia', motivo: motivoRenuncia.trim() });
    setRenunciaAbierta(null); setMotivoRenuncia('');
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  if (productos.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5"><Package size={14} /> Productos y cobertura</p>
        {cobertura && (
          <span className={`text-[11.5px] font-bold px-2 py-0.5 rounded-full border ${
            cobertura.cobertura ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'
          }`}>
            {cobertura.listos} de {cobertura.total} listos para entrega
            {cobertura.renunciados > 0 && ` · ${cobertura.renunciados} renunciado(s)`}
          </span>
        )}
      </div>
      <div className="divide-y divide-zinc-100">
        {productos.map(p => (
          <div key={p.id} className={`px-4 py-3 ${p.subestado === 'RENUNCIADO' ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-zinc-800">{p.descripcion}</p>
                <p className="text-[11px] text-zinc-400">
                  {[
                    p.cantidad != null && `${p.cantidad}${p.unidad ? ` ${p.unidad}` : ''}`,
                    // OJO: esto es lo que VENDIMOS (precio unitario de la oferta), no lo que cuesta
                    // comprarlo — vienen de columnas distintas del costeo (motor-comercial.ts:
                    // precioUnitarioSinDecimales vs costoUnitarioNeto). Sin la etiqueta, se leía
                    // como un techo de compra y llevaba a pensar que había margen para pagar hasta
                    // ese monto, cuando en realidad ahí no queda nada de utilidad. El costo real
                    // está en "Ver costeo" (misma burbuja) y en las cotizaciones de este Auditor.
                    p.montoUnitario != null && `venta unitaria: ${fmtCLP(p.montoUnitario)}`,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                {p.subestado === 'RENUNCIADO' ? (
                  <span className="text-[10.5px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-full">Renunciado</span>
                ) : puedeOperar ? (
                  <Select value={p.subestado} onChange={v => accion({ productoId: p.id, accion: 'subestado', subestado: v })}
                    options={OPCIONES_SUBESTADO} minWidth={150} disabled={guardando === p.id} />
                ) : (
                  <span className="text-[11px] font-semibold text-zinc-600">{SUBESTADO_LABEL[p.subestado]}</span>
                )}
                {puedeOperar && p.subestado !== 'RENUNCIADO' && !p.renunciaMotivo && (
                  <button onClick={() => { setRenunciaAbierta(p.id); setMotivoRenuncia(''); }}
                    className="text-[10.5px] font-semibold text-rose-500 hover:text-rose-700">Renunciar</button>
                )}
              </div>
            </div>

            {p.renunciaMotivo && p.subestado !== 'RENUNCIADO' && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                <p className="text-[11px] text-amber-800"><Flag size={11} className="inline mr-1" />Renuncia propuesta por {p.renunciaPropuestaPorNombre}: {p.renunciaMotivo}</p>
                {esJefeDeVentas && (
                  <button onClick={() => accion({ productoId: p.id, accion: 'aprobar_renuncia' })}
                    className="flex-shrink-0 text-[10.5px] font-bold text-white bg-amber-600 hover:bg-amber-700 px-2 py-1 rounded-lg">Aprobar renuncia</button>
                )}
              </div>
            )}

            {renunciaAbierta === p.id && (
              <div className="mt-2 flex items-center gap-2">
                <input autoFocus value={motivoRenuncia} onChange={e => setMotivoRenuncia(e.target.value)}
                  placeholder="Motivo de la renuncia a esta línea…"
                  className="flex-1 text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                <button onClick={() => proponerRenuncia(p.id)} disabled={!motivoRenuncia.trim()}
                  className="text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Proponer</button>
                <button onClick={() => setRenunciaAbierta(null)} className="text-zinc-400 hover:text-zinc-600"><X size={15} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
