'use client';

// Modificar una orden de compra YA creada desde Licitank (Obuma: comprasOc.update.json).
// Se puede cambiar cantidad, precio y descripción de cada línea, la observación, la fecha de entrega y el método de despacho.
// Obuma reemplaza todas las líneas al actualizar: el servidor reenvía la orden completa y verifica lo que quedó guardado.
import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { METODOS_DESPACHO_OBUMA } from '@/app/lib/obuma-despacho';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';

interface LineaOc { codId: string; nombre: string; descripcion: string; cantidad: number; precio: number; subtotal: number }
interface OcLeida {
  id: string; folio: string | null; estado: string; internacional: boolean; tipoCambio: number; bloqueo: string | null; aviso?: string | null;
  observacion: string; fechaEntrega: string; metodoDespacho: string; neto: number; iva: number; total: number; lineas: LineaOc[];
}

const fmt = (n: number, dec = 0) => n.toLocaleString('es-CL', { maximumFractionDigits: dec });
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

export function ModificarOcObumaModal({ negocioId, obumaCompraOcId, folio, proveedor, onCerrar, onGuardado }: {
  negocioId: number; obumaCompraOcId: string; folio: string | null; proveedor: string; onCerrar: () => void; onGuardado: () => void;
}) {
  const toast = useToast();
  const [oc, setOc] = useState<OcLeida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [lineas, setLineas] = useState<{ codId: string; cantidad: string; precio: string; descripcion: string }[]>([]);
  const [observacion, setObservacion] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [metodo, setMetodo] = useState('');

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/orden-compra-obuma/modificar?ocId=${obumaCompraOcId}`)
      .then(r => r.json()).then(d => {
        if (!vivo) return;
        if (!d.oc) { setError(d.error || 'No se pudo leer la orden de compra.'); return; }
        const o: OcLeida = d.oc;
        setOc(o);
        setLineas(o.lineas.map(l => ({ codId: l.codId, cantidad: String(l.cantidad).replace('.', ','), precio: String(l.precio).replace('.', ','), descripcion: l.descripcion })));
        setObservacion(o.observacion); setFechaEntrega(o.fechaEntrega); setMetodo(o.metodoDespacho);
      }).catch(() => vivo && setError('No se pudo leer la orden de compra.'));
    return () => { vivo = false; };
  }, [negocioId, obumaCompraOcId]);

  const decimales = oc?.internacional ? 2 : 0;
  const lineasValidas = lineas.every(l => num(l.cantidad) > 0 && num(l.precio) >= 0);
  const subtotalNuevo = lineas.reduce((s, l) => s + (num(l.cantidad) || 0) * (num(l.precio) || 0), 0);
  const cambio = !!oc && (
    observacion !== oc.observacion || fechaEntrega !== oc.fechaEntrega || metodo !== oc.metodoDespacho
    || lineas.some((l, i) => num(l.cantidad) !== oc.lineas[i].cantidad || num(l.precio) !== oc.lineas[i].precio || l.descripcion !== oc.lineas[i].descripcion));

  async function guardar() {
    if (!oc) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/modificar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ocId: obumaCompraOcId, observacion, fechaEntrega, metodoDespacho: metodo,
          lineas: lineas.map(l => ({ codId: l.codId, cantidad: num(l.cantidad), precio: num(l.precio), descripcion: l.descripcion })),
        }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error('No se pudo modificar la orden', d.error || 'Intenta de nuevo.'); return; }
      toast.success('Orden modificada', `OC ${d.folio ?? folio ?? ''} actualizada y verificada en Obuma.`);
      onGuardado(); onCerrar();
    } catch {
      toast.error('No se pudo modificar la orden', 'Sin conexión con el servidor.');
    } finally { setGuardando(false); }
  }

  const campo = 'w-full text-[12.5px] border border-zinc-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-teal-500';
  return (
    <Modal open onClose={onCerrar} size="lg" title={`Modificar OC ${folio ?? ''} · ${proveedor}`}
      subtitle="Los cambios se aplican de verdad en Obuma. Obuma reemplaza las líneas, así que se reenvía la orden completa."
      footer={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={guardar} disabled={guardando || !oc || !!oc.bloqueo || !cambio || !lineasValidas}
          icono={guardando ? <Loader2 size={15} className="animate-spin" /> : undefined}>Guardar cambios en Obuma</Boton>
      </>}>
      {error && <p className="text-[12.5px] text-rose-700">{error}</p>}
      {!oc && !error && <p className="text-[12px] text-zinc-400 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Leyendo la orden en Obuma…</p>}
      {oc && (
        <div className="space-y-3">
          {oc.bloqueo && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">{oc.bloqueo} No se puede modificar desde Licitank.</p>}
          {oc.aviso && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">{oc.aviso}</p>}
          {oc.internacional && <p className="text-[11.5px] text-zinc-500">Orden internacional: los precios están en la moneda extranjera de la orden (tipo de cambio {fmt(oc.tipoCambio, 2)}).</p>}
          <div className="space-y-2">
            {oc.lineas.map((l, i) => (
              <div key={l.codId} className="rounded-lg border border-zinc-200 px-3 py-2 space-y-1.5">
                <p className="text-[12.5px] font-medium text-zinc-900">{l.nombre}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="text-[11px] text-zinc-500">Cantidad
                    <input inputMode="decimal" value={lineas[i]?.cantidad ?? ''} disabled={!!oc.bloqueo} className={campo}
                      onChange={e => setLineas(ls => ls.map((x, k) => k === i ? { ...x, cantidad: e.target.value } : x))} /></label>
                  <label className="text-[11px] text-zinc-500">Precio neto unitario
                    <input inputMode="decimal" value={lineas[i]?.precio ?? ''} disabled={!!oc.bloqueo} className={campo}
                      onChange={e => setLineas(ls => ls.map((x, k) => k === i ? { ...x, precio: e.target.value } : x))} /></label>
                  <p className="text-[11px] text-zinc-500 sm:col-span-2">Subtotal
                    <span className="block text-[13px] font-semibold tabular-nums text-zinc-900 pt-1.5">{fmt((num(lineas[i]?.cantidad ?? '0') || 0) * (num(lineas[i]?.precio ?? '0') || 0), decimales)}</span></p>
                </div>
                <label className="block text-[11px] text-zinc-500">Descripción del producto
                  <textarea rows={2} maxLength={1000} value={lineas[i]?.descripcion ?? ''} disabled={!!oc.bloqueo} className={`${campo} resize-y`}
                    placeholder="Opcional"
                    onChange={e => setLineas(ls => ls.map((x, k) => k === i ? { ...x, descripcion: e.target.value } : x))} /></label>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-[11px] text-zinc-500">Fecha de entrega
              <input type="date" value={fechaEntrega} disabled={!!oc.bloqueo} onChange={e => setFechaEntrega(e.target.value)} className={campo} /></label>
            <label className="text-[11px] text-zinc-500">Método de despacho
              <select value={metodo} disabled={!!oc.bloqueo} onChange={e => setMetodo(e.target.value)} className={campo}>
                {!METODOS_DESPACHO_OBUMA.includes(metodo as any) && <option value={metodo}>{metodo || '—'}</option>}
                {METODOS_DESPACHO_OBUMA.map(m => <option key={m} value={m}>{m}</option>)}
              </select></label>
          </div>
          <label className="block text-[11px] text-zinc-500">Observación de la orden
            <textarea rows={2} maxLength={500} value={observacion} disabled={!!oc.bloqueo} onChange={e => setObservacion(e.target.value)} className={`${campo} resize-y`} /></label>
          <p className="text-[12.5px] text-zinc-700">Neto nuevo: <b className="tabular-nums">{fmt(subtotalNuevo, decimales)}</b>
            {!oc.internacional && <> · con IVA ≈ <b className="tabular-nums">{fmt(Math.round(subtotalNuevo * 1.19))}</b></>}
            <span className="text-zinc-500"> (antes {fmt(oc.neto || oc.total, decimales)} neto)</span></p>
        </div>
      )}
    </Modal>
  );
}
