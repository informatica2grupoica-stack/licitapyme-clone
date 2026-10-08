'use client';

// CREAR PROVEEDOR EN OBUMA — un solo formulario para todo el módulo de Compras (pestaña "Obuma", orden de compra,
// compra directa). Escritura real contra Obuma: solo ocurre cuando la persona aprieta "Crear en Obuma".
import { useState, useEffect } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconBolt as Zap, IconLoader2 as Loader2 } from '@tabler/icons-react';

export const formProveedorVacio = {
  rut: '', razonSocial: '', nombreFantasia: '', contacto: '', giro: '', direccion: '', comuna: '', region: '', pais: 'CHILE',
  telefono: '', celular: '', email: '', website: '', observacion: '', cuentaContable: '',
  esSupermercado: false, esFactoring: false,
  // Configuración financiera — confirmada en vivo contra Obuma 22-sep-2026 (ver obuma.ts, crearProveedorObuma).
  formaPago: '', centroCosto: '', bancoCuenta: '', nroCuenta: '', tipoCuenta: '', tipoProveedorId: '', tags: '',
};
export type FormProveedor = typeof formProveedorVacio;
interface FormaPago { id: string; codigo: string; nombre: string }

export function CrearProveedorObumaModal({ negocioId, inicial, onCerrar, onCreado }: {
  negocioId: number; inicial?: Partial<FormProveedor>; onCerrar: () => void; onCreado: (p: { rut: string; razonSocial: string }) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormProveedor>({ ...formProveedorVacio, ...inicial });
  const [formasPago, setFormasPago] = useState<FormaPago[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch('/api/compras/obuma-formas-pago').then(r => r.json()).then(d => { if (vivo && d.success) setFormasPago(d.formas || []); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  const crear = async () => {
    if (!form.rut.trim() || !form.razonSocial.trim()) { toast.error('Faltan datos', 'RUT y razón social son obligatorios.'); return; }
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/proveedor`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success('Proveedor creado en Obuma', form.razonSocial);
      onCreado({ rut: form.rut, razonSocial: form.razonSocial });
    } catch (e: any) {
      toast.error('No se pudo crear el proveedor', e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => onCerrar()}>
      <div className="bg-white rounded-xl border border-zinc-200 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <p className="px-4 py-3 text-[12px] font-bold text-zinc-800 border-b border-zinc-100 flex items-center gap-1.5">
          <Zap size={13} className="text-indigo-600" /> Crear proveedor en Obuma
        </p>
        <div className="p-4 space-y-2">
          <p className="text-[10.5px] text-zinc-400">Escritura real contra Obuma — se crea de verdad al guardar. Son los campos documentados de la API (obuma.cl/ayuda/articulo/157); solo RUT y razón social son obligatorios para crear.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10.5px] font-semibold text-zinc-500 col-span-1">
              RUT *
              <input value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Razón social *
              <input value={form.razonSocial} onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Nombre fantasía
              <input value={form.nombreFantasia} onChange={e => setForm(f => ({ ...f, nombreFantasia: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Contacto <span className="font-normal text-zinc-400">(pide Obuma)</span>
              <input value={form.contacto} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Giro comercial
              <input value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500 col-span-2">
              Dirección
              <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Comuna
              <input value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Región
              <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              País
              <input value={form.pais} onChange={e => setForm(f => ({ ...f, pais: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Teléfono <span className="font-normal text-zinc-400">(pide Obuma)</span>
              <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Celular
              <input value={form.celular} onChange={e => setForm(f => ({ ...f, celular: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Email <span className="font-normal text-zinc-400">(pide Obuma)</span>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Sitio web
              <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Cuenta contable <span className="font-normal text-zinc-400">(código, opcional)</span>
              <input value={form.cuentaContable} onChange={e => setForm(f => ({ ...f, cuentaContable: e.target.value }))}
                placeholder="ej. 2.1.01.001" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Forma de pago <span className="font-normal text-zinc-400">(opcional)</span>
              <select value={form.formaPago} onChange={e => setForm(f => ({ ...f, formaPago: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                <option value="">— sin definir —</option>
                {formasPago.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Centro de costo <span className="font-normal text-zinc-400">(ID de Obuma, opcional)</span>
              <input value={form.centroCosto} onChange={e => setForm(f => ({ ...f, centroCosto: e.target.value }))}
                placeholder="ej. 4491" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Banco <span className="font-normal text-zinc-400">(ID de Obuma, opcional)</span>
              <input value={form.bancoCuenta} onChange={e => setForm(f => ({ ...f, bancoCuenta: e.target.value }))}
                placeholder="mismo ID que ves en Obuma" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Tipo de cuenta <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.tipoCuenta} onChange={e => setForm(f => ({ ...f, tipoCuenta: e.target.value }))}
                placeholder="ej. Cuenta Corriente" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              N° de cuenta <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.nroCuenta} onChange={e => setForm(f => ({ ...f, nroCuenta: e.target.value }))}
                placeholder="ej. 164-28444-03" className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500 col-span-2">
              Observación
              <textarea value={form.observacion} onChange={e => setForm(f => ({ ...f, observacion: e.target.value }))} rows={2}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-600">
              <input type="checkbox" checked={form.esSupermercado} onChange={e => setForm(f => ({ ...f, esSupermercado: e.target.checked }))} className="accent-indigo-600" />
              Es supermercado
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-600">
              <input type="checkbox" checked={form.esFactoring} onChange={e => setForm(f => ({ ...f, esFactoring: e.target.checked }))} className="accent-indigo-600" />
              Es factoring
            </label>
          </div>
          <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            Forma de pago, centro de costo, banco, tipo y N° de cuenta se mandan junto con la creación (confirmado en vivo, 22-sep-2026 — no están en la doc pública de Obuma, pero la API los acepta). El ID del banco no tiene catálogo público: usá el mismo que ves en el desplegable del formulario web de Obuma. "Tipo de proveedor" no tiene campo acá todavía — se completa después, directo en Obuma, si hace falta.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-zinc-100 flex items-center gap-2">
          <button onClick={crear} disabled={guardando || !form.rut.trim() || !form.razonSocial.trim()}
            className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {guardando ? <Loader2 size={12} className="animate-spin" /> : 'Crear en Obuma'}
          </button>
          <button onClick={() => onCerrar()} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
        </div>
      </div>
    </div>
  
  );
}
