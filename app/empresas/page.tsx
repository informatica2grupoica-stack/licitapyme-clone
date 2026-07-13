'use client';

// Sección "Empresas" (solo admin): ficha de cada empresa con la que se postula.
// Crear / editar / eliminar. Los datos se usan al marcar una licitación como Postulada
// (selector de empresa) y se muestran/filtran en el apartado Postuladas.

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import {
  Building2, Plus, Pencil, Trash2, Loader2, X, Save, Inbox,
  User, Landmark, Mail, Phone, MapPin, ShieldCheck,
} from 'lucide-react';

interface Empresa {
  id: number;
  razon_social: string;
  rut: string;
  direccion?: string | null;
  region?: string | null;
  giro?: string | null;
  tipo_persona_juridica?: string | null;
  fecha_sociedad?: string | null;
  representante_nombre?: string | null;
  representante_rut?: string | null;
  representante_cargo?: string | null;
  email1?: string | null;
  telefono1?: string | null;
  email2?: string | null;
  telefono2?: string | null;
  banco_tipo_cuenta?: string | null;
  banco_numero?: string | null;
  banco_nombre?: string | null;
  banco_email?: string | null;
}

const VACIA: Partial<Empresa> = { razon_social: '', rut: '' };

// Un input etiquetado, compacto y consistente.
function Campo({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-600">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <input
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-indigo-400"
      />
    </label>
  );
}

function EmpresaModal({ inicial, onCerrar, onGuardada }: {
  inicial: Partial<Empresa>; onCerrar: () => void; onGuardada: () => void;
}) {
  const [f, setF] = useState<Partial<Empresa>>(inicial);
  const [guardando, setGuardando] = useState(false);
  const toast = useToast();
  const esEdicion = !!inicial.id;
  const set = (k: keyof Empresa) => (v: string) => setF(prev => ({ ...prev, [k]: v }));

  const guardar = async () => {
    if (!String(f.razon_social || '').trim() || !String(f.rut || '').trim()) {
      toast.error('Razón social y RUT son obligatorios'); return;
    }
    setGuardando(true);
    try {
      const url = esEdicion ? `/api/empresas/${inicial.id}` : '/api/empresas';
      const res = await fetch(url, {
        method: esEdicion ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success(esEdicion ? 'Empresa actualizada' : 'Empresa creada');
      onGuardada();
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <p className="text-[14px] font-bold text-slate-800 flex items-center gap-2">
            <Building2 size={16} className="text-indigo-600" />
            {esEdicion ? 'Editar empresa' : 'Nueva empresa'}
          </p>
          <button onClick={onCerrar} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 transition-colors"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Datos generales */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Building2 size={13} /> Datos de la empresa</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Razón social" value={f.razon_social || ''} onChange={set('razon_social')} required />
              <Campo label="RUT" value={f.rut || ''} onChange={set('rut')} placeholder="76.902.659-2" required />
              <Campo label="Dirección" value={f.direccion || ''} onChange={set('direccion')} />
              <Campo label="Región" value={f.region || ''} onChange={set('region')} />
              <Campo label="Giro" value={f.giro || ''} onChange={set('giro')} />
              <Campo label="Tipo persona jurídica" value={f.tipo_persona_juridica || ''} onChange={set('tipo_persona_juridica')} />
              <div className="sm:col-span-2">
                <Campo label="Fecha / constitución de sociedad" value={f.fecha_sociedad || ''} onChange={set('fecha_sociedad')} placeholder="Fecha y notaría" />
              </div>
            </div>
          </section>

          {/* Representante legal */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><User size={13} /> Representante legal</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Campo label="Nombre" value={f.representante_nombre || ''} onChange={set('representante_nombre')} />
              <Campo label="RUT" value={f.representante_rut || ''} onChange={set('representante_rut')} />
              <Campo label="Cargo" value={f.representante_cargo || ''} onChange={set('representante_cargo')} />
            </div>
          </section>

          {/* Contactos */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Mail size={13} /> Contactos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Email 1" value={f.email1 || ''} onChange={set('email1')} />
              <Campo label="Teléfono 1" value={f.telefono1 || ''} onChange={set('telefono1')} />
              <Campo label="Email 2" value={f.email2 || ''} onChange={set('email2')} />
              <Campo label="Teléfono 2" value={f.telefono2 || ''} onChange={set('telefono2')} />
            </div>
          </section>

          {/* Banco */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Landmark size={13} /> Datos bancarios</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Tipo de cuenta" value={f.banco_tipo_cuenta || ''} onChange={set('banco_tipo_cuenta')} placeholder="Cuenta corriente / vista" />
              <Campo label="N° de cuenta" value={f.banco_numero || ''} onChange={set('banco_numero')} />
              <Campo label="Banco" value={f.banco_nombre || ''} onChange={set('banco_nombre')} />
              <Campo label="Email de pagos" value={f.banco_email || ''} onChange={set('banco_email')} />
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
          <button onClick={onCerrar}
            className="px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-[13px] font-semibold rounded-lg transition-colors">
            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function EmpresaCard({ e, onEditar, onEliminar }: { e: Empresa; onEditar: () => void; onEliminar: () => void; }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
              <Building2 size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14px] font-bold text-slate-800 truncate">{e.razon_social}</h3>
              <p className="text-[11.5px] font-mono text-slate-500">{e.rut}</p>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          <button onClick={onEditar} title="Editar"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"><Pencil size={14} /></button>
          <button onClick={onEliminar} title="Eliminar"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-1.5 text-[12px] text-slate-600">
        {e.giro && <p className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.giro}</span></p>}
        {(e.direccion || e.region) && <p className="flex items-center gap-1.5"><MapPin size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{[e.direccion, e.region].filter(Boolean).join(' · ')}</span></p>}
        {e.representante_nombre && <p className="flex items-center gap-1.5"><User size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.representante_nombre}{e.representante_rut ? ` · ${e.representante_rut}` : ''}</span></p>}
        {e.email1 && <p className="flex items-center gap-1.5"><Mail size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.email1}</span></p>}
        {e.telefono1 && <p className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.telefono1}</span></p>}
        {(e.banco_nombre || e.banco_numero) && <p className="flex items-center gap-1.5"><Landmark size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{[e.banco_nombre, e.banco_tipo_cuenta, e.banco_numero].filter(Boolean).join(' · ')}</span></p>}
      </div>
    </div>
  );
}

export default function EmpresasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Partial<Empresa> | null>(null);
  const confirmar = useConfirm();
  const toast = useToast();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/empresas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
      setEmpresas(data.empresas || []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const eliminar = async (e: Empresa) => {
    const ok = await confirmar({
      titulo: '¿Eliminar empresa?',
      mensaje: `"${e.razon_social}" dejará de aparecer en el selector. Las licitaciones ya postuladas con ella conservan la referencia.`,
      confirmarLabel: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    const prev = empresas;
    setEmpresas(list => list.filter(x => x.id !== e.id));
    try {
      const res = await fetch(`/api/empresas/${e.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Empresa eliminada');
    } catch (err: any) {
      setEmpresas(prev);
      toast.error('No se pudo eliminar', err?.message);
    }
  };

  if (!isAdmin) {
    return (
      <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Empresas' }]}>
        <div className="p-8 text-center text-slate-500">Esta sección es solo para administradores.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Empresas' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 size={24} className="text-indigo-600" /> Empresas
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {cargando ? 'Cargando…' : `${empresas.length} empresa${empresas.length !== 1 ? 's' : ''} con la${empresas.length !== 1 ? 's' : ''} que se postula`}
            </p>
          </div>
          <button onClick={() => setModal({ ...VACIA })}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors self-start">
            <Plus size={16} /> Nueva empresa
          </button>
        </div>

        {cargando ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-20 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : error ? (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        ) : empresas.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-slate-100">
            <Inbox size={36} className="text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Aún no hay empresas</h3>
            <p className="text-sm text-gray-400">Crea la primera con el botón <b>Nueva empresa</b>.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {empresas.map(e => (
              <EmpresaCard key={e.id} e={e} onEditar={() => setModal(e)} onEliminar={() => eliminar(e)} />
            ))}
          </div>
        )}
      </div>

      {modal && (
        <EmpresaModal
          inicial={modal}
          onCerrar={() => setModal(null)}
          onGuardada={() => { setModal(null); cargar(); }}
        />
      )}
    </AppLayout>
  );
}
