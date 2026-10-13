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
  // Condiciones comerciales del formulario web de Obuma.
  listaPrecio: '', tipoDespacho: '', medioDespacho: '', cuentaCorriente: false, creditoAprobado: '', diasPago: '', plazoPago: '', permitirDteSinOc: false,
};
export type FormProveedor = typeof formProveedorVacio;
// Bancos del desplegable del formulario web de Obuma de esta cuenta (leídos 09-oct-2026): [id, nombre].
// La API no publica este catálogo; si Obuma agrega bancos, hay que sumarlos acá.
const BANCOS_OBUMA: [string, string][] = [
  ['1', 'BANCO DE CHILE'], ['2', 'BANCO INTERNACIONAL'], ['3', 'SCOTIABANK CHILE'], ['4', 'BANCO DE CREDITO E INVERSIONES'],
  ['5', 'CORPBANCA'], ['6', 'BANCO BICE'], ['7', 'HSBC BANK'], ['8', 'BANCO SANTANDER-CHILE'], ['9', 'BANCO ITAÚ CHILE'],
  ['10', 'BANCO SECURITY'], ['11', 'BANCO FALABELLA'], ['12', 'DEUTSCHE BANK (CHILE)'], ['13', 'BANCO RIPLEY'],
  ['14', 'RABOBANK CHILE'], ['15', 'BANCO CONSORCIO'], ['16', 'BANCO PENTA'], ['17', 'BANCO PARIS'], ['18', 'BANCO BBVA'],
  ['19', 'BANCO DEL ESTADO DE CHILE'], ['20', 'BANCO EDWARDS'], ['21', 'BANCO DEL DESARROLLO'], ['22', 'Prepago Los Heroes'],
  ['23', 'COOPEUCH'], ['24', 'TENPO Prepago S.A.'], ['25', 'Mercado Pago'], ['26', 'Global66'], ['27', 'TAPP Caja los Andes'],
  ['28', 'Prex'], ['29', 'JP Morgan'], ['30', 'Copec Pay'], ['31', 'Fintual'],
];
interface FormaPago { id: string; codigo: string; nombre: string }

export function CrearProveedorObumaModal({ negocioId, inicial, onCerrar, onCreado }: {
  negocioId?: number; // sin negocio (catálogo de Proveedores) se crea por la ruta del catálogo
  inicial?: Partial<FormProveedor>; onCerrar: () => void; onCreado: (p: { rut: string; razonSocial: string }) => void;
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

  const listo = !!(form.rut.trim() && form.razonSocial.trim() && form.contacto.trim() && form.telefono.trim() && form.email.trim());

  const crear = async () => {
    if (!listo) { toast.error('Faltan datos', 'RUT, razón social, contacto, teléfono y e-mail son obligatorios (Obuma los exige).'); return; }
    setGuardando(true);
    try {
      const res = await fetch(negocioId != null ? `/api/compras/${negocioId}/orden-compra-obuma/proveedor` : '/api/compras/proveedores/crear-obuma', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      const nombres: Record<string, string> = { banco_cuenta: 'banco', nro_cuenta: 'N° de cuenta', tipo_cuenta: 'tipo de cuenta', tipo_despacho: 'tipo de despacho', cuenta_corriente: 'cuenta corriente', dte_sin_oc: 'DTE sin O.C.', forma_pago: 'forma de pago', centro_costo: 'centro de costo' };
      const faltan: string[] = (data.noGuardados || []).map((k: string) => nombres[k] || k);
      if (faltan.length) toast.warning('Proveedor creado, pero Obuma no guardó: ' + faltan.join(', '), 'Complétalos a mano en la ficha del proveedor en Obuma.');
      else toast.success('Proveedor creado en Obuma', form.razonSocial);
      onCreado({ rut: form.rut, razonSocial: form.razonSocial });
    } catch (e: any) {
      toast.error('No se pudo crear el proveedor', e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    // No se cierra al hacer clic fuera: solo con "Cancelar" o al crear (así no se pierde lo tipeado).
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-zinc-200 shadow-xl w-[96vw] max-w-7xl max-h-[94vh] overflow-y-auto">
        <p className="px-4 py-3 text-[12px] font-bold text-zinc-800 border-b border-zinc-100 flex items-center gap-1.5">
          <Zap size={13} className="text-indigo-600" /> Crear proveedor en Obuma
        </p>
        <div className="p-4 space-y-2">
          <p className="text-[10.5px] text-zinc-400">Escritura real contra Obuma — se crea de verdad al guardar. Son los campos documentados de la API (obuma.cl/ayuda/articulo/157); RUT, razón social, contacto, teléfono y e-mail son obligatorios (los exige Obuma).</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-[10.5px] font-semibold text-zinc-500 col-span-1">
              RUT *
              <input value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Razón social *
              <input value={form.razonSocial} onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Nombre fantasía
              <input value={form.nombreFantasia} onChange={e => setForm(f => ({ ...f, nombreFantasia: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Contacto *
              <input value={form.contacto} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Giro comercial
              <input value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500 col-span-2">
              Dirección
              <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Comuna
              <input value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Región
              <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              País
              <input value={form.pais} onChange={e => setForm(f => ({ ...f, pais: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Teléfono *
              <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Celular
              <input value={form.celular} onChange={e => setForm(f => ({ ...f, celular: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              E-mail *
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Sitio web
              <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Cuenta contable <span className="font-normal text-zinc-400">(código, opcional)</span>
              <input value={form.cuentaContable} onChange={e => setForm(f => ({ ...f, cuentaContable: e.target.value }))}
                placeholder="ej. 2.1.01.001" className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Forma de pago <span className="font-normal text-zinc-400">(opcional)</span>
              <select value={form.formaPago} onChange={e => setForm(f => ({ ...f, formaPago: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                <option value="">— sin definir —</option>
                {formasPago.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Centro de costo <span className="font-normal text-zinc-400">(ID de Obuma, opcional)</span>
              <input value={form.centroCosto} onChange={e => setForm(f => ({ ...f, centroCosto: e.target.value }))}
                placeholder="ej. 4491" className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Banco <span className="font-normal text-zinc-400">(opcional)</span>
              <select value={form.bancoCuenta} onChange={e => setForm(f => ({ ...f, bancoCuenta: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                <option value="">— sin definir —</option>
                {BANCOS_OBUMA.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </select>
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Tipo de cuenta <span className="font-normal text-zinc-400">(opcional)</span>
              <select value={form.tipoCuenta} onChange={e => setForm(f => ({ ...f, tipoCuenta: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                <option value="">— sin definir —</option>
                <option>Cuenta Corriente</option>
                <option>Cuenta Vista</option>
                <option>Cuenta Ahorro</option>
              </select>
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              N° de cuenta <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.nroCuenta} onChange={e => setForm(f => ({ ...f, nroCuenta: e.target.value }))}
                placeholder="ej. 164-28444-03" className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Lista de precio <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.listaPrecio} onChange={e => setForm(f => ({ ...f, listaPrecio: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Tipo de despacho <span className="font-normal text-zinc-400">(opcional)</span>
              <select value={form.tipoDespacho} onChange={e => setForm(f => ({ ...f, tipoDespacho: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                <option value="">— sin definir —</option>
                <option value="1">Por cuenta CLIENTE</option>
                <option value="2">EMISOR a instalaciones cliente</option>
              </select>
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Medio de despacho <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.medioDespacho} onChange={e => setForm(f => ({ ...f, medioDespacho: e.target.value }))}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Crédito aprobado <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.creditoAprobado} onChange={e => setForm(f => ({ ...f, creditoAprobado: e.target.value }))} inputMode="numeric"
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Días de pago <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.diasPago} onChange={e => setForm(f => ({ ...f, diasPago: e.target.value }))} inputMode="numeric"
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500">
              Plazo de pago (días) <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={form.plazoPago} onChange={e => setForm(f => ({ ...f, plazoPago: e.target.value }))} inputMode="numeric"
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="text-[10.5px] font-semibold text-zinc-500 col-span-2">
              Observación
              <textarea value={form.observacion} onChange={e => setForm(f => ({ ...f, observacion: e.target.value }))} rows={2}
                className="mt-0.5 w-full text-[13px] font-normal border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-600">
              <input type="checkbox" checked={form.esSupermercado} onChange={e => setForm(f => ({ ...f, esSupermercado: e.target.checked }))} className="accent-indigo-600" />
              Es supermercado
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-600">
              <input type="checkbox" checked={form.esFactoring} onChange={e => setForm(f => ({ ...f, esFactoring: e.target.checked }))} className="accent-indigo-600" />
              Es factoring
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-600">
              <input type="checkbox" checked={form.cuentaCorriente} onChange={e => setForm(f => ({ ...f, cuentaCorriente: e.target.checked }))} className="accent-indigo-600" />
              Cuenta corriente
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-600">
              <input type="checkbox" checked={form.permitirDteSinOc} onChange={e => setForm(f => ({ ...f, permitirDteSinOc: e.target.checked }))} className="accent-indigo-600" />
              Permitir ingreso DTE sin referencia a O.C. emitida
            </label>
          </div>
          <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            Probado el 09-oct-2026: la API de Obuma NO guarda banco, N° y tipo de cuenta, tipo de despacho ni cuenta corriente (responde OK y los deja vacíos). Se mandan igual, y si Obuma no los guarda te avisa al crear; hay que completarlos a mano en la ficha del proveedor en Obuma. "Tipo de proveedor" no tiene campo acá — también se completa en Obuma.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-zinc-100 flex items-center gap-2">
          <button onClick={crear} disabled={guardando || !listo}
            className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {guardando ? <Loader2 size={12} className="animate-spin" /> : 'Crear en Obuma'}
          </button>
          <button onClick={() => onCerrar()} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
        </div>
      </div>
    </div>
  
  );
}
