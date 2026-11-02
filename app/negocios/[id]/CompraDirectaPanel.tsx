'use client';

// COMPRA DIRECTA (ítems que no se cotizan: ferretería, retail): un proveedor y un precio neto de referencia, sin documento.
// Vive en «2 · Cotizaciones» junto a «Registrar cotización» y «Cargar varias», porque es otra forma de dejar un producto cubierto
// con precio (antes estaba suelta en cada fila de «1 · Productos», donde nadie la buscaba). Escribe la misma cotización
// (origen 'directa') por la misma API: no cambia ninguna regla.
import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { irAFase } from '@/app/compras/[negocioId]/comprasNavegacion';
import { Boton } from '@/app/components/ui/kit/Boton';

export interface InicialDirecta { productoId?: number; proveedor?: string; precio?: number; link?: string }
interface ProductoMin { id: number; descripcion: string; cantidad?: number | null }

const VACIO = { proveedor: '', rut: '', precio: '', motivo: '', modelo: '', link: '' };
const inputCls = 'w-full h-10 text-sm text-tinta border border-linea rounded-lg px-3 bg-white outline-none transition-colors focus:border-marca focus:ring-2 focus:ring-marca/20 placeholder:text-tinta-3 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100';
const labelCls = 'block text-xs font-medium text-tinta-2 mb-1';

/** Monto chileno con decimales: «63.016,806723», «63016,806», «10.670» (miles) o «63016.81» (punto decimal). Sin dato válido → 0. */
const montoCL = (t: string): number => {
  const s = t.replace(/[^\d.,]/g, '');
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : 0;
};
const redondear2 = (n: number) => Math.round(n * 100) / 100;
const clp2 = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 });

/** Da formato al RUT mientras se escribe: «778977893» → «77.897.789-3». */
const formatearRutVivo = (v: string) => {
  const limpio = v.replace(/[^\dkK]/g, '').toUpperCase().slice(0, 9);
  if (limpio.length < 2) return limpio;
  return `${limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${limpio.slice(-1)}`;
};

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
  const [directa, setDirecta] = useState({ ...VACIO, proveedor: inicial?.proveedor || '', precio: inicial?.precio ? String(redondear2(inicial.precio)).replace('.', ',') : '', link: inicial?.link || '', motivo: inicial?.link ? 'Precio leído del link del costeo' : '' });
  const [guardando, setGuardando] = useState(false);
  // «Por comprar» = el jefe la aprueba ANTES de comprar; «Ya comprada» = ya se pagó en la tienda y el jefe la ratifica (llega con aviso).
  const [yaComprada, setYaComprada] = useState(false);
  // Los precios de tienda/retail se publican CON IVA (caso real 1191: $119.990 en la tienda = $100.832 neto): se marca por defecto y se guarda el neto.
  const [conIva, setConIva] = useState(true);
  // Flete de la compra: si lo hay, se guarda aparte del precio del producto y se suma al total del proveedor (se precarga en la OC).
  const [tieneFlete, setTieneFlete] = useState(false);
  const [fleteTexto, setFleteTexto] = useState('');
  const [fleteConIva, setFleteConIva] = useState(true);
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
    setDirecta(d => ({ ...d, proveedor: x.nombreEmpresa, rut: x.rut ? formatearRutVivo(x.rut) : d.rut }));
    if (x.obumaProveedorId) setProvObuma({ estado: 'existe', razonSocial: x.nombreEmpresa });
    else if (x.rut) verificarProveedorObuma(x.rut);
    else setProvObuma({ estado: 'idle' });
  };

  const producto = productos.find(p => p.id === productoId) ?? null;
  const precioIngresado = montoCL(directa.precio);
  const precio = redondear2(conIva ? precioIngresado / 1.19 : precioIngresado);   // neto unitario (con decimales): lo que se guarda
  const fleteIngresado = montoCL(fleteTexto);
  const fleteNeto = tieneFlete ? redondear2(fleteConIva ? fleteIngresado / 1.19 : fleteIngresado) : 0;
  const cantidad = Math.max(1, Number(producto?.cantidad) || 1);
  // Compra rápida: la tienda lleva RUT válido (obligatorio) y el jefe de ventas la aprueba antes de comprar.
  const puedeRegistrar = !!producto && !!directa.proveedor.trim() && !!precio && rutValidoCL(directa.rut) && provObuma.estado !== 'invalido' && (!tieneFlete || fleteNeto > 0) && !guardando;

  const registrar = async () => {
    if (!producto || !puedeRegistrar) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origen: 'directa', yaComprada, proveedorId: provId, proveedorNombre: directa.proveedor.trim(), proveedorRut: directa.rut.trim() || null, precioUnitario: precio,
          descripcionLibre: [producto.descripcion, directa.modelo.trim() ? `Marca/modelo: ${directa.modelo.trim()}` : ''].filter(Boolean).join(' · '),
          notas: `Compra directa sin cotización${directa.motivo.trim() ? `: ${directa.motivo.trim()}` : ''}. Precio neto de referencia${conIva ? ` (el precio de la tienda, $${clp2(precioIngresado)}, incluye IVA)` : ''}.${directa.link.trim() ? ` Link de referencia: ${directa.link.trim()}` : ''}`,
          // Con flete: «aparte» con su monto neto. Sin flete: $0 explícito (retiro en tienda), para que no quede «por confirmar».
          despachoModalidad: tieneFlete ? 'PROVEEDOR' : 'TIENDA', fleteCondicion: tieneFlete ? 'APARTE' : 'SIN_COSTO', fleteMonto: tieneFlete ? fleteNeto : 0,
          items: [{ productoId: producto.id, precioUnitario: precio, cumple: 'CUMPLE' }],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Compra rápida enviada al jefe de ventas', yaComprada ? 'Como ya la compraste, la ratifica él: le llegó el aviso. El producto queda «Comprado».' : 'Apruébala él antes de comprar. Al aprobarla, el producto pasa a «Comprado» y podrás crear el SKU y la OC.');
      await onRegistrada();
      onCerrar();
    } catch (e: any) {
      toast.error('No se pudo registrar la compra directa', e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="@container space-y-4" data-testid="form-compra-directa">
      <p className="text-sm text-tinta-2">Para ítems de bajo monto o de retail (ferretería, tienda): anota la tienda, su RUT y el precio. <b className="font-semibold text-tinta">El jefe de ventas la aprueba antes de comprar</b>; aprobada, el producto pasa a «Comprado» y puedes crear el SKU y la OC. Lo demás, cotízalo.</p>
      <div className="grid grid-cols-1 @md:grid-cols-2 gap-x-4 gap-y-3">
        <div className="@md:col-span-2">
          <label className={labelCls}>Producto</label>
          <Select value={productoId == null ? '' : String(productoId)} onChange={v => setProductoId(v ? Number(v) : null)} placeholder="Elige el producto que se compra directo…"
            options={productos.map(p => ({ value: String(p.id), label: p.descripcion }))} />
        </div>
        <div className="relative">
          <label className={labelCls} htmlFor="directa-proveedor">Proveedor</label>
          <input id="directa-proveedor" value={directa.proveedor} onChange={e => { setDirecta(d => ({ ...d, proveedor: e.target.value })); setProvId(null); setBuscarNombre(true); setProvObuma({ estado: 'idle' }); }}
            placeholder="Nombre o RUT (ej. Sodimac)" autoComplete="off" className={inputCls} />
          {sugerencias.length > 0 && (
            <ul data-testid="sugerencias-proveedor" className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
              {sugerencias.map(x => (
                <li key={x.id}>
                  <button type="button" onMouseDown={e => { e.preventDefault(); elegirProveedor(x); }} className="w-full text-left px-2.5 py-1.5 hover:bg-teal-50 text-[12.5px]">
                    <span className="font-semibold text-zinc-800">{x.nombreEmpresa}</span>
                    <span className="text-tinta-3"> · {x.rut || 'sin RUT'}{x.obumaProveedorId ? ' · en Obuma' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className={labelCls} htmlFor="directa-rut">RUT de la tienda <span className="font-normal text-urgente">(obligatorio)</span></label>
          <input id="directa-rut" value={directa.rut} onChange={e => { setDirecta(d => ({ ...d, rut: formatearRutVivo(e.target.value) })); setProvObuma({ estado: 'idle' }); setProvId(null); setBuscarNombre(false); setSugerencias([]); }}
            onBlur={e => verificarProveedorObuma(e.target.value)} placeholder="Se verifica en Obuma" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="directa-precio">{conIva ? 'Precio de la tienda (con IVA)' : 'Precio neto unitario'}</label>
          <input id="directa-precio" inputMode="decimal" value={directa.precio} onChange={e => setDirecta(d => ({ ...d, precio: e.target.value }))} placeholder="Acepta decimales (ej. 63.016,81)" className={inputCls} />
          <label className="flex items-center gap-1.5 mt-2 text-xs text-tinta-2 cursor-pointer" data-testid="directa-con-iva">
            <input type="checkbox" checked={conIva} onChange={e => setConIva(e.target.checked)} className="accent-teal-600" /> El precio incluye IVA
          </label>
          {precioIngresado > 0 && <p className="text-xs text-tinta-3 mt-1" data-testid="directa-neto-calculado">{conIva ? <>Se guarda como <b>{clp2(precio)}</b> neto + IVA {clp2(precioIngresado - precio)}</> : <>Con IVA serían <b>{clp2(precio * 1.19)}</b></>}</p>}
        </div>
        <div>
          <label className={labelCls} htmlFor="directa-modelo">Marca y modelo <span className="font-normal text-tinta-3">(opcional)</span></label>
          <input id="directa-modelo" value={directa.modelo} onChange={e => setDirecta(d => ({ ...d, modelo: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="directa-link">Link del producto <span className="font-normal text-tinta-3">(opcional)</span></label>
          <input id="directa-link" value={directa.link} onChange={e => setDirecta(d => ({ ...d, link: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="directa-motivo">Motivo <span className="font-normal text-tinta-3">(opcional)</span></label>
          <input id="directa-motivo" value={directa.motivo} onChange={e => setDirecta(d => ({ ...d, motivo: e.target.value }))} placeholder="Precio de lista, ítem menor…" className={inputCls} />
        </div>
      </div>
      {provObuma.estado !== 'idle' && (
        <p data-testid="proveedor-obuma" className={`text-xs font-medium ${provObuma.estado === 'existe' ? 'text-exito' : provObuma.estado === 'no_existe' ? 'text-alerta' : provObuma.estado === 'cargando' ? 'text-zinc-500' : 'text-urgente'}`}>
          {provObuma.estado === 'cargando' && 'Consultando Obuma…'}
          {provObuma.estado === 'existe' && `✓ Ya existe en Obuma: ${provObuma.razonSocial}. Proveedor conocido.`}
          {provObuma.estado === 'no_existe' && (<>Proveedor nuevo: no existe en Obuma. Hay que crearlo antes de emitir la orden de compra, y se le exige la factura antes de pagar.{' '}
            <button type="button" onClick={() => irAFase('obuma', { accion: 'crear-proveedor', rut: directa.rut.trim(), nombre: directa.proveedor.trim() })}
              className="underline font-semibold text-marca hover:text-marca-fuerte">Ir a crear proveedor</button> (puedes registrar la compra directa ahora y crearlo después).</>)}
          {provObuma.estado === 'invalido' && 'El RUT no es válido (revisa el dígito verificador).'}
          {provObuma.estado === 'error' && 'No se pudo consultar Obuma ahora; puedes registrar igual y se verificará después.'}
        </p>
      )}
      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap border-t border-linea pt-3" role="radiogroup" aria-label="¿Tiene flete?" data-testid="directa-flete">
        <span className="text-xs font-medium text-tinta-2">¿Tiene flete?</span>
        <label className="flex items-center gap-1.5 text-sm text-tinta cursor-pointer"><input type="radio" name="directa-flete" checked={!tieneFlete} onChange={() => setTieneFlete(false)} /> No <span className="text-tinta-3">(retiro en tienda)</span></label>
        <label className="flex items-center gap-1.5 text-sm text-tinta cursor-pointer"><input type="radio" name="directa-flete" checked={tieneFlete} onChange={() => setTieneFlete(true)} /> Sí</label>
        {tieneFlete && (
          <>
            <input aria-label="Monto del flete" inputMode="decimal" value={fleteTexto} onChange={e => setFleteTexto(e.target.value)} placeholder="Monto del flete" className={`${inputCls} !w-40`} />
            <label className="flex items-center gap-1.5 text-xs text-tinta-2 cursor-pointer"><input type="checkbox" checked={fleteConIva} onChange={e => setFleteConIva(e.target.checked)} className="accent-teal-600" /> incluye IVA</label>
          </>
        )}
      </div>
      {!!producto && precio > 0 && (
        <p className="text-xs text-tinta-2" data-testid="directa-total-con-flete">
          Producto {clp2(precio * cantidad)} neto{cantidad > 1 ? ` (${cantidad} × ${clp2(precio)})` : ''}
          {tieneFlete && fleteNeto > 0 ? <> + flete {clp2(fleteNeto)} = <b>{clp2(precio * cantidad + fleteNeto)}</b> neto</> : null}
        </p>
      )}
      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap border-t border-linea pt-3" role="radiogroup" aria-label="¿Ya se compró?" data-testid="directa-ya-comprada">
        <span className="text-xs font-medium text-tinta-2">¿Ya se compró?</span>
        <label className="flex items-center gap-1.5 text-sm text-tinta cursor-pointer"><input type="radio" name="directa-ya-comprada" checked={!yaComprada} onChange={() => setYaComprada(false)} /> Por comprar <span className="text-tinta-3">(el jefe la aprueba antes)</span></label>
        <label className="flex items-center gap-1.5 text-sm text-tinta cursor-pointer"><input type="radio" name="directa-ya-comprada" checked={yaComprada} onChange={() => setYaComprada(true)} /> Ya comprada <span className="text-tinta-3">(el jefe la ratifica)</span></label>
      </div>
      <div className="flex items-center gap-2 flex-wrap border-t border-linea pt-4">
        <Boton variante="primario" onClick={registrar} disabled={!puedeRegistrar}>{guardando ? 'Guardando…' : 'Enviar a aprobación del jefe'}</Boton>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        {!producto && <span className="text-xs text-tinta-3">Elige primero el producto.</span>}
        {!!producto && !rutValidoCL(directa.rut) && <span className="text-xs text-urgente">Falta el RUT de la tienda (válido).</span>}
      </div>
    </div>
  );
}
