'use client';

// CATÁLOGO DE PROVEEDORES — ficha completa (nombre de empresa, RUT, contacto, categoría, giro,
// datos bancarios). Transversal a todos los negocios, mismo criterio que Fleteros: se da de alta
// una vez y queda disponible para cualquier cotización futura.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import {
  Loader2, Plus, X, Search, Building2, Mail, Phone, Landmark, ChevronDown, ChevronUp,
} from 'lucide-react';

interface Proveedor {
  id: number; rut: string | null; nombreEmpresa: string; nombreFantasia: string | null;
  categoria: string | null; giro: string | null; contactoNombre: string | null; correo: string | null; telefono: string | null;
  direccion: string | null; comuna: string | null; region: string | null;
  banco: string | null; tipoCuenta: string | null; numeroCuenta: string | null; titularCuenta: string | null;
  rutTitular: string | null; correoPagos: string | null; notas: string | null; activo: boolean;
}

const FORM_VACIO = {
  rut: '', nombreEmpresa: '', nombreFantasia: '', categoria: '', giro: '', contactoNombre: '', correo: '', telefono: '',
  direccion: '', comuna: '', region: '', banco: '', tipoCuenta: '', numeroCuenta: '', titularCuenta: '', rutTitular: '',
  correoPagos: '', notas: '',
};

export default function ProveedoresPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [formAbierto, setFormAbierto] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [expandido, setExpandido] = useState<number | null>(null);

  const esAdmin = usuario?.rol === 'admin';
  const puedeVer = esAdmin || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async (busqueda?: string) => {
    try {
      const res = await fetch(`/api/compras/proveedores${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProveedores(data.proveedores || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los proveedores', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  useEffect(() => {
    const t = setTimeout(() => cargar(q), 300);
    return () => clearTimeout(t);
  }, [q, cargar]);

  const crear = async () => {
    if (!form.nombreEmpresa.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/compras/proveedores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success('Proveedor agregado');
      setProveedores(data.proveedores);
      setForm(FORM_VACIO); setFormAbierto(false);
    } catch (e: any) {
      toast.error('No se pudo agregar el proveedor', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Proveedores' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Proveedores' }]}>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0"><Building2 size={17} className="text-teal-600" /></div>
            <div>
              <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Proveedores</h1>
              <p className="text-[12px] text-zinc-500">{proveedores.length} proveedor(es) en el catálogo</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre o RUT…"
                className="pl-8 pr-3 py-2 text-[12.5px] border border-zinc-200 rounded-lg outline-none focus:ring-1 focus:ring-teal-500 w-56" />
            </div>
            <button onClick={() => setFormAbierto(v => !v)} className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-2 rounded-lg">
              <Plus size={14} /> Agregar
            </button>
          </div>
        </div>

        {formAbierto && (
          <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Building2 size={11} /> Identidad</p>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.nombreEmpresa} onChange={e => setForm(f => ({ ...f, nombreEmpresa: e.target.value }))} placeholder="Nombre de la empresa (razón social) *"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 col-span-2" />
              <input value={form.nombreFantasia} onChange={e => setForm(f => ({ ...f, nombreFantasia: e.target.value }))} placeholder="Nombre de fantasía"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))} placeholder="RUT"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} placeholder="Categoría / rubro"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))} placeholder="Giro"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>

            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1 pt-1"><Mail size={11} /> Contacto</p>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.contactoNombre} onChange={e => setForm(f => ({ ...f, contactoNombre: e.target.value }))} placeholder="Nombre de contacto"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Teléfono"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.correo} onChange={e => setForm(f => ({ ...f, correo: e.target.value }))} placeholder="Correo"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} placeholder="Dirección"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))} placeholder="Comuna"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="Región"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>

            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1 pt-1"><Landmark size={11} /> Datos de transferencia</p>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.banco} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))} placeholder="Banco"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.tipoCuenta} onChange={e => setForm(f => ({ ...f, tipoCuenta: e.target.value }))} placeholder="Tipo de cuenta"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.numeroCuenta} onChange={e => setForm(f => ({ ...f, numeroCuenta: e.target.value }))} placeholder="N° de cuenta"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.titularCuenta} onChange={e => setForm(f => ({ ...f, titularCuenta: e.target.value }))} placeholder="Titular de la cuenta"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.rutTitular} onChange={e => setForm(f => ({ ...f, rutTitular: e.target.value }))} placeholder="RUT del titular"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.correoPagos} onChange={e => setForm(f => ({ ...f, correoPagos: e.target.value }))} placeholder="Correo para pagos/facturas"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>

            <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2} placeholder="Notas…"
              className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />

            <div className="flex items-center gap-2">
              <button onClick={crear} disabled={!form.nombreEmpresa.trim() || guardando} className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setFormAbierto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="divide-y divide-zinc-100">
              {proveedores.map(p => (
                <div key={p.id}>
                  <button onClick={() => setExpandido(v => v === p.id ? null : p.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors text-left">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-zinc-800">{p.nombreEmpresa}{p.nombreFantasia && <span className="text-zinc-400 font-normal"> ({p.nombreFantasia})</span>}</p>
                      <p className="text-[11px] text-zinc-400">{[p.rut, p.categoria].filter(Boolean).join(' · ')}</p>
                    </div>
                    {expandido === p.id ? <ChevronUp size={15} className="text-zinc-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-zinc-400 flex-shrink-0" />}
                  </button>
                  {expandido === p.id && (
                    <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] text-zinc-600 bg-zinc-50/60">
                      {p.giro && <p><span className="text-zinc-400">Giro:</span> {p.giro}</p>}
                      {p.contactoNombre && <p className="flex items-center gap-1"><Mail size={11} className="text-zinc-400" /> {p.contactoNombre}</p>}
                      {p.telefono && <p className="flex items-center gap-1"><Phone size={11} className="text-zinc-400" /> {p.telefono}</p>}
                      {p.correo && <p>{p.correo}</p>}
                      {(p.direccion || p.comuna) && <p>{[p.direccion, p.comuna, p.region].filter(Boolean).join(', ')}</p>}
                      {p.banco && <p className="flex items-center gap-1"><Landmark size={11} className="text-zinc-400" /> {p.banco} — {p.tipoCuenta} {p.numeroCuenta}</p>}
                      {p.titularCuenta && <p>Titular: {p.titularCuenta} {p.rutTitular && `(${p.rutTitular})`}</p>}
                      {p.correoPagos && <p>Pagos: {p.correoPagos}</p>}
                      {p.notas && <p className="col-span-2 text-zinc-400 italic">{p.notas}</p>}
                    </div>
                  )}
                </div>
              ))}
              {proveedores.length === 0 && <p className="px-4 py-10 text-center text-[12px] text-zinc-400">Sin proveedores todavía.</p>}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
