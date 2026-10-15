'use client';

// COMPRA DIRECTA (ítems que no se cotizan: ferretería, retail): un proveedor y un precio neto de referencia, sin documento.
// Vive en «2 · Cotizaciones» junto a «Registrar cotización» y «Cargar varias», porque es otra forma de dejar un producto cubierto
// con precio (antes estaba suelta en cada fila de «1 · Productos», donde nadie la buscaba). Escribe la misma cotización
// (origen 'directa') por la misma API: no cambia ninguna regla.
import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { irAFase } from '@/app/compras/[negocioId]/comprasNavegacion';
import { IconX as X } from '@tabler/icons-react';

export interface InicialDirecta { productoId?: number; proveedor?: string; precio?: number; link?: string }
interface ProductoMin { id: number; descripcion: string }

const VACIO = { proveedor: '', rut: '', precio: '', motivo: '', modelo: '', link: '' };
const inputCls = 'w-full text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none bg-white';

const rutValidoCL = (rut: string) => {
  const t = rut.replace(/[.\s]/g, '').toUpperCase();
  const m = t.match(/^(\d{7,8})-?([\dK])$/);
  if (!m) return false;
  let suma = 0, mult = 2;
  for (let i = m[1].length - 1; i >= 0; i--) { suma += Number(m[1][i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const dv = 11 - (suma % 11);
  return m[2] === (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv));
};

export function CompraDirectaPanel({ negocioId, productos, inicial, onRegistrada, onCerrar }: {
  negocioId: number; productos: ProductoMin[]; inicial?: InicialDirecta | null; onRegistrada: () => void | Promise<void>; onCerrar: () => void;
}) {
  const toast = useToast();
  const [productoId, setProductoId] = useState<number | null>(inicial?.productoId ?? null);
  const [directa, setDirecta] = useState({ ...VACIO, proveedor: inicial?.proveedor || '', precio: inicial?.precio ? String(Math.round(inicial.precio)) : '', link: inicial?.link || '', motivo: inicial?.link ? 'Precio leído del link del costeo' : '' });
  const [guardando, setGuardando] = useState(false);
  // Solo se buscan sugerencias cuando se TIPEA el nombre (no al elegir uno ni al tocar el RUT).
  const [buscarNombre, setBuscarNombre] = useState(false);
  const [provId, setProvId] = useState<number | null>(null);
  const [sugerencias, setSugerencias] = useState<Array<{ id: number; nombreEmpresa: string; nombreFantasia: string | null; rut: string | null; obumaProveedorId: string | null }>>([]);
  // Un proveedor que no existe en Obuma es «nuevo»: hay que crearlo ahí antes de emitir la OC y se le exige la factura antes de pagar.
  const [provObuma, setProvObuma] = useState<{ estado: 'idle' | 'cargando' | 'existe' | 'no_existe' | 'invalido' | 'error'; razonSocial?: string }>({ estado: 'idle' });

  useEffect(() => {
    const q = directa.proveedor.trim();
    if (!buscarNombre || provId != null || q.length < 3) { setSugerencias([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/compras/proveedores?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (d.success) setSugerencias((d.proveedores || []).slice(0, 6));
      } catch { setSugerencias([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [directa.proveedor, provId, buscarNombre]);

  const verificarProveedorObuma = async (rutTexto: string) => {
    const rut = rutTexto.trim();
    if (!rut) { setProvObuma({ estado: 'idle' }); return; }
    if (!rutValidoCL(rut)) { setProvObuma({ estado: 'invalido' }); return; }
    setProvObuma({ estado: 'cargando' });
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/proveedor?rut=${encodeURIComponent(rut)}`);
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'error');
      if (d.existe && d.ficha) {
        setProvObuma({ estado: 'existe', razonSocial: d.ficha.razonSocial });
        setDirecta(x => ({ ...x, proveedor: x.proveedor.trim() ? x.proveedor : d.ficha.razonSocial }));
      } else setProvObuma({ estado: 'no_existe' });
    } catch { setProvObuma({ estado: 'error' }); }
  };

  const elegirProveedor = (x: { id: number; nombreEmpresa: string; rut: string | null; obumaProveedorId: string | null }) => {
    setProvId(x.id); setSugerencias([]); setBuscarNombre(false);
    setDirecta(d => ({ ...d, proveedor: x.nombreEmpresa, rut: x.rut || d.rut }));
    if (x.obumaProveedorId) setProvObuma({ estado: 'existe', razonSocial: x.nombreEmpresa });
    else if (x.rut) verificarProveedorObuma(x.rut);
    else setProvObuma({ estado: 'idle' });
  };

  const producto = productos.find(p => p.id === productoId) ?? null;
  const precio = Number(directa.precio.replace(/[^\d]/g, ''));
  const puedeRegistrar = !!producto && !!directa.proveedor.trim() && !!precio && provObuma.estado !== 'invalido' && !guardando;

  const registrar = async () => {
    if (!producto || !puedeRegistrar) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origen: 'directa', proveedorId: provId, proveedorNombre: directa.proveedor.trim(), proveedorRut: directa.rut.trim() || null, precioUnitario: precio,
          descripcionLibre: [producto.descripcion, directa.modelo.trim() ? `Marca/modelo: ${directa.modelo.trim()}` : ''].filter(Boolean).join(' · '),
          notas: `Compra directa sin cotización${directa.motivo.trim() ? `: ${directa.motivo.trim()}` : ''}. Precio neto de referencia.${directa.link.trim() ? ` Link de referencia: ${directa.link.trim()}` : ''}`,
          items: [{ productoId: producto.id, precioUnitario: precio, cumple: 'CUMPLE' }],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Compra directa registrada', 'El producto quedó cubierto y pasa a la comparación y a la orden de compra.');
      await onRegistrada();
      onCerrar();
    } catch (e: any) {
      toast.error('No se pudo registrar la compra directa', e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="border-b border-zinc-100 px-4 py-3 bg-teal-50/40" data-testid="form-compra-directa">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-[12.5px] font-bold text-teal-900">Compra directa — sin cotización</p>
          <p className="text-[11.5px] text-zinc-500">Para ítems de bajo monto o de retail (ferretería, tienda): anota a quién se compra y a qué precio neto. Cuenta como cubierto y pasa a la comparación y a la orden de compra; lo demás, cotízalo.</p>
        </div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar compra directa" className="text-zinc-400 hover:text-zinc-600 flex-shrink-0"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-3">
          <label className="block text-[11px] font-semibold text-zinc-500 mb-0.5">Producto</label>
          <Select value={productoId == null ? '' : String(productoId)} onChange={v => setProductoId(v ? Number(v) : null)} placeholder="Elige el producto que se compra directo…"
            options={productos.map(p => ({ value: String(p.id), label: p.descripcion }))} />
        </div>
        <div className="relative">
          <label className="block text-[11px] font-semibold text-zinc-500 mb-0.5" htmlFor="directa-proveedor">Proveedor</label>
          <input id="directa-proveedor" value={directa.proveedor} onChange={e => { setDirecta(d => ({ ...d, proveedor: e.target.value })); setProvId(null); setBuscarNombre(true); setProvObuma({ estado: 'idle' }); }}
            placeholder="Nombre o RUT (ej. Sodimac)" autoComplete="off" className={inputCls} />
          {sugerencias.length > 0 && (
            <ul data-testid="sugerencias-proveedor" className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
              {sugerencias.map(x => (
                <li key={x.id}>
                  <button type="button" onMouseDown={e => { e.preventDefault(); elegirProveedor(x); }} className="w-full text-left px-2.5 py-1.5 hover:bg-teal-50 text-[12.5px]">
                    <span className="font-semibold text-zinc-800">{x.nombreEmpresa}</span>
                    <span className="text-zinc-400"> · {x.rut || 'sin RUT'}{x.obumaProveedorId ? ' · en Obuma' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-500 mb-0.5" htmlFor="directa-rut">RUT</label>
          <input id="directa-rut" value={directa.rut} onChange={e => { setDirecta(d => ({ ...d, rut: e.target.value })); setProvObuma({ estado: 'idle' }); setProvId(null); setBuscarNombre(false); setSugerencias([]); }}
            onBlur={e => verificarProveedorObuma(e.target.value)} placeholder="Se verifica en Obuma" className={inputCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-500 mb-0.5" htmlFor="directa-precio">Precio neto unitario</label>
          <input id="directa-precio" inputMode="numeric" value={directa.precio} onChange={e => setDirecta(d => ({ ...d, precio: e.target.value }))} placeholder="Solo números" className={inputCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-500 mb-0.5" htmlFor="directa-modelo">Marca y modelo <span className="font-normal text-zinc-400">(opcional)</span></label>
          <input id="directa-modelo" value={directa.modelo} onChange={e => setDirecta(d => ({ ...d, modelo: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-500 mb-0.5" htmlFor="directa-link">Link del producto <span className="font-normal text-zinc-400">(opcional)</span></label>
          <input id="directa-link" value={directa.link} onChange={e => setDirecta(d => ({ ...d, link: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-500 mb-0.5" htmlFor="directa-motivo">Motivo <span className="font-normal text-zinc-400">(opcional)</span></label>
          <input id="directa-motivo" value={directa.motivo} onChange={e => setDirecta(d => ({ ...d, motivo: e.target.value }))} placeholder="Precio de lista, ítem menor…" className={inputCls} />
        </div>
      </div>
      {provObuma.estado !== 'idle' && (
        <p data-testid="proveedor-obuma" className={`text-[11.5px] font-semibold mt-2 ${provObuma.estado === 'existe' ? 'text-emerald-700' : provObuma.estado === 'no_existe' ? 'text-amber-700' : provObuma.estado === 'cargando' ? 'text-zinc-500' : 'text-rose-600'}`}>
          {provObuma.estado === 'cargando' && 'Consultando Obuma…'}
          {provObuma.estado === 'existe' && `✓ Ya existe en Obuma: ${provObuma.razonSocial}. Proveedor conocido.`}
          {provObuma.estado === 'no_existe' && (<>Proveedor nuevo: no existe en Obuma. Hay que crearlo antes de emitir la orden de compra, y se le exige la factura antes de pagar.{' '}
            <button type="button" onClick={() => irAFase('obuma', { accion: 'crear-proveedor', rut: directa.rut.trim(), nombre: directa.proveedor.trim() })}
              className="underline font-bold text-indigo-700 hover:text-indigo-900">Ir a crear proveedor</button> (puedes registrar la compra directa ahora y crearlo después).</>)}
          {provObuma.estado === 'invalido' && 'El RUT no es válido (revisa el dígito verificador).'}
          {provObuma.estado === 'error' && 'No se pudo consultar Obuma ahora; puedes registrar igual y se verificará después.'}
        </p>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={registrar} disabled={!puedeRegistrar} className="text-[12.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3.5 py-1.5 rounded-lg">
          {guardando ? 'Guardando…' : 'Registrar compra directa'}
        </button>
        <button type="button" onClick={onCerrar} className="text-[12.5px] font-semibold text-zinc-500 hover:text-zinc-700 px-2 py-1.5">Cancelar</button>
        {!producto && <span className="text-[11.5px] text-zinc-400">Elige primero el producto.</span>}
      </div>
    </div>
  );
}
